/**
 * IndexedDB chunk cache — Phase 3 Track A Step 5.
 *
 * Stores compressed chunk bytes keyed by (url, chunkIndex, offset).
 * Cache hits skip the network fetch; the bytes still go through the
 * worker pool for decode (cache stores compressed, not decoded).
 *
 * Why compressed not decoded:
 *   - Per-entry size ~150 KB vs ~500 KB → 3× more entries fit in budget
 *   - Structured-clone cost on write is 3× lower
 *   - Cache hit still saves the network round-trip (the dominant cost)
 *   - Worker decode is the same code path either way
 *
 * Storage strategy:
 *   - idb-keyval for key-value access (already a project dep)
 *   - In-memory index of {key → cachedAt, byteSize} for O(1) LRU
 *   - Configurable byte budget (default 512 MB)
 *   - LRU eviction on write when over budget
 *   - QuotaExceededError handling: aggressive evict + one retry
 *
 * Cache key derivation: FNV-1a hash of URL plus chunkIndex plus byteOffset.
 * Non-crypto, fast, collision-resistant for our key space (chunks within
 * one file have distinct byteOffsets; chunks across files have distinct
 * URL hashes).
 */

import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'

const INDEX_KEY = 'lazstream:cache:index:v1'
const CHUNK_KEY_PREFIX = 'lazstream:cache:chunk:'

interface IndexEntry {
  cachedAt: number
  byteSize: number
}

export interface CacheMetrics {
  entries: number
  totalBytes: number
  budgetBytes: number
  hits: number
  misses: number
  evictions: number
}

export class ChunkCache {
  private index = new Map<string, IndexEntry>()
  private totalBytes = 0
  private initialised = false
  private persistTimer: number | null = null
  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(public readonly budgetBytes: number = 512 * 1024 * 1024) {}

  /**
   * Load the in-memory index from IDB. Lazy-initialised on first
   * get/set; calling explicitly is optional but speeds up the first
   * cache check after app boot.
   */
  async init(): Promise<void> {
    if (this.initialised) return
    this.initialised = true
    try {
      const stored = await idbGet(INDEX_KEY) as Array<[string, IndexEntry]> | undefined
      if (stored) {
        this.index = new Map(stored)
        for (const [, meta] of this.index) {
          this.totalBytes += meta.byteSize
        }
      }
    } catch (err) {
      console.warn('[lazstream] cache index load failed:', err)
      this.index = new Map()
      this.totalBytes = 0
    }
    console.debug(
      `[lazstream] ChunkCache initialised: ${this.index.size} entries, ` +
      `${(this.totalBytes / 1024 / 1024).toFixed(1)} MB / ` +
      `${(this.budgetBytes / 1024 / 1024).toFixed(0)} MB budget`
    )
  }

  /** Returns cached compressed bytes or null on miss. */
  async get(key: string): Promise<ArrayBuffer | null> {
    if (!this.initialised) await this.init()
    const meta = this.index.get(key)
    if (!meta) {
      this.misses++
      return null
    }

    try {
      const bytes = await idbGet(CHUNK_KEY_PREFIX + key) as ArrayBuffer | undefined
      if (!bytes) {
        // Stale index entry — IDB doesn't have the data. Fix up index.
        this.index.delete(key)
        this.totalBytes -= meta.byteSize
        this.schedulePersist()
        this.misses++
        return null
      }
      // Touch for LRU
      meta.cachedAt = Date.now()
      this.schedulePersist()
      this.hits++
      return bytes
    } catch (err) {
      console.warn(`[lazstream] cache get failed for ${key}:`, err)
      this.misses++
      return null
    }
  }

  /** Store compressed bytes under key. Evicts oldest entries if over budget. */
  async set(key: string, value: ArrayBuffer): Promise<void> {
    if (!this.initialised) await this.init()
    const byteSize = value.byteLength

    if (byteSize > this.budgetBytes) {
      console.warn(
        `[lazstream] cache: chunk ${byteSize}B exceeds budget ${this.budgetBytes}B — skipped`
      )
      return
    }

    // If overwriting an existing key, free its byte allocation first
    const existing = this.index.get(key)
    if (existing) this.totalBytes -= existing.byteSize

    // Evict LRU entries until there's room
    while (this.totalBytes + byteSize > this.budgetBytes && this.index.size > 0) {
      const oldest = this.findOldest()
      if (!oldest) break
      await this.evict(oldest)
    }

    try {
      await idbSet(CHUNK_KEY_PREFIX + key, value)
      this.index.set(key, { cachedAt: Date.now(), byteSize })
      this.totalBytes += byteSize
      this.schedulePersist()
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') {
        // Browser-imposed limit hit. Evict aggressively (halve budget) and retry once.
        console.warn('[lazstream] cache QuotaExceededError; evicting aggressively')
        const targetSize = this.budgetBytes / 2
        while (this.totalBytes > targetSize && this.index.size > 0) {
          const oldest = this.findOldest()
          if (!oldest) break
          await this.evict(oldest)
        }
        try {
          await idbSet(CHUNK_KEY_PREFIX + key, value)
          this.index.set(key, { cachedAt: Date.now(), byteSize })
          this.totalBytes += byteSize
          this.schedulePersist()
        } catch (err2) {
          console.warn(`[lazstream] cache set retry failed for ${key}:`, err2)
        }
      } else {
        console.warn(`[lazstream] cache set failed for ${key}:`, err)
      }
    }
  }

  private findOldest(): string | null {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, meta] of this.index) {
      if (meta.cachedAt < oldestTime) {
        oldestTime = meta.cachedAt
        oldestKey = key
      }
    }
    return oldestKey
  }

  private async evict(key: string): Promise<void> {
    const meta = this.index.get(key)
    if (!meta) return
    try {
      await idbDel(CHUNK_KEY_PREFIX + key)
    } catch (err) {
      console.warn(`[lazstream] cache evict failed for ${key}:`, err)
      // Continue anyway — remove from index so we don't keep retrying
    }
    this.index.delete(key)
    this.totalBytes -= meta.byteSize
    this.evictions++
  }

  /**
   * Throttle index persistence — flush 500 ms after the last update.
   * Avoids writing the entire index on every chunk.
   */
  private schedulePersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer)
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null
      void this.persistIndex()
    }, 500)
  }

  private async persistIndex(): Promise<void> {
    try {
      await idbSet(INDEX_KEY, Array.from(this.index.entries()))
    } catch (err) {
      console.warn('[lazstream] cache index persist failed:', err)
    }
  }

  metrics(): CacheMetrics {
    return {
      entries: this.index.size,
      totalBytes: this.totalBytes,
      budgetBytes: this.budgetBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    }
  }
}

/**
 * Build a cache key from (url, chunkIndex, byteOffset).
 *
 * Three-part key:
 *   - FNV-1a hash of URL — distinguishes files; short string output
 *   - chunkIndex — distinguishes chunks within a file
 *   - byteOffset — invalidates on file rewrite (re-uploaded LAZ has
 *     different offsets, so old cache entries become unreachable
 *     rather than serving stale data)
 */
export function makeCacheKey(url: string, chunkIndex: number, byteOffset: number): string {
  return `${fnv1a(url)}:${chunkIndex}:${byteOffset}`
}

/** Non-crypto hash. Fast, collision-resistant for URL strings. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}