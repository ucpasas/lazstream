/**
 * StreamingEngine — single-tile streaming coordinator.
 *
 * Pipeline:
 *   URL → probe → header → chunk table → seed points → seed render
 *   seeds → SpatialIndex → ChunkPrioritiser (frustum + SSE)
 *        → IDB cache check → coalesced HTTP Range fetches
 *        → WorkerPool (WASM decode) → decoded chunks → renderer
 *
 * The engine is renderer-agnostic: camera position, frustum AABB, and
 * ring-buffer free-slot count are injected via provider callbacks.
 * ManifestSession is the preferred entry point — StreamingEngine is
 * the per-tile worker inside it.
 */

import type { LasHeader, ChunkTableEntry, SeedPoint } from '../types/las.js'
import type { BBox3D } from '../types/spatial.js'
import { classifyLazVersion, getLazVersionWarning } from '../types/las.js'
import { validateSourceUrl } from '../network/url-validator.js'
import { probeUrl, fetchRange } from '../network/range-fetcher.js'
import { coalesce, type FetchBatch } from '../network/batch-fetcher.js'
import { fetchAndParseLasHeader, ParseError } from './header-parser.js'
import { fetchChunkTable, fetchSeedPoints } from './chunk-table.js'
import { WorkerPool } from '../decode/worker-pool.js'
import type { DecodedChunk, LazstreamAssetUrls } from '../decode/worker-pool.js'
import { ChunkPrioritiser, type CameraInfo } from '../decode/chunk-priority.js'
import { SpatialIndex } from './spatial-index.js'
import { ChunkCache, makeCacheKey } from '../cache/idb-cache.js'

// ─── Module-local helpers ────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type LoadState =
  | 'idle'
  | 'probing'
  | 'header'
  | 'chunk-table'
  | 'seeds'
  | 'workers-init'
  | 'streaming'
  | 'ready'
  | 'error'

export interface EngineEvents {
  onStateChange?: (state: LoadState, message: string) => void
  onWarning?: (message: string) => void
  onSeedsReady?: (seeds: SeedPoint[], header: LasHeader) => void
  onChunkDecoded?: (chunk: DecodedChunk) => void
  onProgress?: (loaded: number, total: number, phase: string) => void
  onError?: (error: Error) => void
  onStats?: (stats: {
    fileSize: number
    pointCount: number
    chunkCount: number
    version: string
    format: number
    decodedChunks?: number
    decodedPoints?: number
    activeWorkers?: number
    queuedChunks?: number
  }) => void
}

/** Provider returning current ring buffer state. Used to gate dispatch when the buffer is nearly full. */
export type RingBufferProvider = () => { slotsFree: number; slotsTotal: number }

export interface StreamingEngineOptions {
  /** Callbacks for all engine events. At minimum: onSeedsReady + onChunkDecoded. */
  events?: EngineEvents
  /** Decode worker count. Default: hardwareConcurrency - 1 (max 100). */
  workerCount?: number
  /** IndexedDB cache for compressed chunks. Default: disabled. */
  cache?: ChunkCache | null
  /** Minimum screen-space error to trigger chunk decode. Default: 10.0. */
  sseThreshold?: number
  /** Max concurrent HTTP range requests. Default: min(workerCount × 4, 128). */
  maxFetches?: number
  /** Asset URL overrides — only needed for non-standard hosting or CDN prefixes. */
  assetUrls?: LazstreamAssetUrls
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class StreamingEngine {
  private events: EngineEvents
  private workerPool: WorkerPool | null = null
  private prioritiser: ChunkPrioritiser | null = null
  private spatial = new SpatialIndex()
  private chunks: ChunkTableEntry[] = []
  private header: LasHeader | null = null
  private url = ''
  private decodedPointCount = 0
  private decodedChunkCount = 0
  private fileSize = 0

  // Providers — renderer registers these so engine stays renderer-agnostic.
  private cameraInfoProvider:  (() => CameraInfo)        | null = null
  private frustumProvider:     (() => BBox3D)            | null = null
  private ringBufferProvider:  RingBufferProvider        | null = null

  private cache: ChunkCache | null = null

  private workerCount: number
  private readonly sseThreshold: number | undefined
  private readonly assetUrls: LazstreamAssetUrls | undefined
  /** True once workerPool.init() AND workerPool.configure() have both returned. Guards updateCamera(). */
  private workersConfigured = false

  private abortController: AbortController | null = null

  /** Chunk indices currently being fetched. Replaced (not cleared) on each load. */
  private fetching = new Set<number>()

  /** Max concurrent main-thread fetches. Caps dispatch alongside the ring-buffer free-slot check. */
  private maxFetches: number

  constructor(options: StreamingEngineOptions = {}) {
    const { events = {}, workerCount, cache, sseThreshold, maxFetches, assetUrls } = options
    this.events = events
    this.workerCount = workerCount ?? Math.min(100, Math.max(1, navigator.hardwareConcurrency - 1))
    this.maxFetches  = maxFetches  ?? Math.min(this.workerCount * 4, 128)
    this.cache = cache ?? null
    this.sseThreshold = sseThreshold
    this.assetUrls = assetUrls
    console.debug('[lazstream] StreamingEngine:', {
      workerCount: this.workerCount,
      maxFetches: this.maxFetches,
      cacheEnabled: this.cache !== null,
      sseThreshold: this.sseThreshold ?? '(default)',
    })
  }

  // ─── Provider registration ─────────────────────────────────────────────

  setCameraProvider(provider: () => CameraInfo): void {
    this.cameraInfoProvider = provider
  }

  setFrustumProvider(provider: () => BBox3D): void {
    this.frustumProvider = provider
  }

  /** Register ring-buffer free-slot provider. Engine gates dispatch on this
   *  to avoid filling the buffer with chunks that can't land (all slots visible). */
  setRingBufferProvider(provider: RingBufferProvider): void {
    this.ringBufferProvider = provider
  }

  /** Called by the renderer when a chunk is proactively evicted from the GPU
   *  ring buffer (invisible for more than EVICT_GRACE_FRAMES). Removes it from
   *  the decoded set so the engine will re-fetch it when it re-enters view. */
  onChunkEvictedFromGPU(chunkIndex: number): void {
    this.prioritiser?.removeDecoded(chunkIndex)
    this.workerPool?.markEvicted(chunkIndex)
  }

  // ─── Main pipeline ─────────────────────────────────────────────────────

  async load(rawUrl: string): Promise<void> {
    this.abortController?.abort()
    this.workerPool?.dispose()
    this.workerPool = null
    this.workersConfigured = false

    // Per-load state reset
    this.spatial.clear()
    this.prioritiser = null
    this.chunks = []
    this.header = null
    this.url = ''
    this.decodedPointCount = 0
    this.decodedChunkCount = 0
    this.fileSize = 0
    this.fetching = new Set()

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    try {
      this.emit('probing', 'Validating URL...')
      const url = validateSourceUrl(rawUrl)
      this.url = url.toString()

      this.emit('probing', 'Checking file accessibility...')
      const { fileSize, supportsRange } = await probeUrl(this.url, signal)
      this.fileSize = fileSize

      if (!supportsRange) {
        throw new Error(
          'This server does not support HTTP Range requests. ' +
          'lazstream requires Range support to stream point clouds.'
        )
      }

      if (fileSize === 0) {
        throw new Error('Could not determine file size.')
      }

      this.emit('header', 'Reading file header...')
      const { header, lazVlr } = await fetchAndParseLasHeader(this.url, signal)
      this.header = header

      const lazVersion = classifyLazVersion(header, lazVlr)
      const warning = getLazVersionWarning(lazVersion)
      if (warning) this.events.onWarning?.(warning)
      if (lazVersion === 'unsupported') {
        throw new ParseError('This file cannot be displayed.')
      }

      this.emitStats()

      this.emit('chunk-table', 'Reading chunk index...')
      this.chunks = await fetchChunkTable(this.url, header, lazVlr, fileSize, signal)
      this.emitStats()

      this.emit('seeds', `Fetching ${this.chunks.length} chunk seed points...`)
      const seeds = await fetchSeedPoints(
        this.url, this.chunks, header, lazVlr,
        (loaded, total) => this.events.onProgress?.(loaded, total, 'seeds'),
        signal,
      )

      this.events.onSeedsReady?.(seeds, header)

      this.buildSpatialIndex(seeds, header)

      this.emit('workers-init', `Starting ${this.workerCount} decode workers...`)

      this.workerPool = new WorkerPool({
        onChunkDecoded: (chunk) => this.handleChunkDecoded(chunk),
        onWorkerError: (chunkIndex, message) => {
          console.warn(`[lazstream] chunk ${chunkIndex} decode failed: ${message}`)
        },
        onReady: () => {
          console.debug('[lazstream] worker pool ready')
        },
      }, this.workerCount, this.assetUrls)

      await this.workerPool.init()

      if (signal.aborted) {
        throw new DOMException('Load aborted during worker init', 'AbortError')
      }

      this.workerPool.configure(header, lazVlr)
      this.workersConfigured = true

      this.emit('streaming', `Streaming — ${this.workerCount} workers active`)

    } catch (err) {
      if (isAbortError(err)) {
        console.debug('[lazstream] load cancelled')
        return
      }

      const error = err instanceof Error ? err : new Error(String(err))
      this.events.onStateChange?.('error', error.message)
      this.events.onError?.(error)
    }
  }

  /** Update the decode queue based on current camera position. Call every frame from the render loop. */
  updateCamera(): void {
    if (!this.prioritiser || !this.workerPool || !this.workersConfigured) return
    if (!this.cameraInfoProvider || !this.frustumProvider) return

    // Ring-buffer back-pressure: subtract in-flight chunks (fetching + pool queue + active)
    // so we don't dispatch into a buffer already committed to receive them.
    let ringSlots = Number.MAX_SAFE_INTEGER
    let ringFreeRaw = Number.MAX_SAFE_INTEGER
    if (this.ringBufferProvider) {
      ringFreeRaw = this.ringBufferProvider().slotsFree
      const inFlight = this.fetching.size + this.workerPool.queueLength + this.workerPool.activeCount
      ringSlots = Math.max(0, ringFreeRaw - inFlight)
    }

    const fetchSlots = this.maxFetches - this.fetching.size

    // Tail-end burst: when the pipeline runs dry, bypass the ring-buffer cap so
    // workers don't idle waiting for slots. Uses effective CPU capacity
    // (min(workerCount, hardwareConcurrency-1)) not raw workerCount — with
    // workerCount=100 on 16 cores, the raw value would bypass back-pressure constantly.
    //
    // Guard: only bypass when the ring buffer actually has room (slotsFree > 0).
    // If slotsFree = 0, incoming chunks will be dropped immediately in addDecodedChunk,
    // triggering chunkEvictedCallback → re-queue → dispatch → infinite churn even
    // with a stationary camera and a full ring buffer.
    const effectiveCapacity = Math.min(this.workerCount, Math.max(1, navigator.hardwareConcurrency - 1))
    const pipelineDry =
      (this.workerPool.queueLength + this.workerPool.activeCount) < effectiveCapacity
    const slots = (pipelineDry && ringFreeRaw > 0) ? fetchSlots : Math.min(ringSlots, fetchSlots)
    if (slots <= 0) return

    const camera = this.cameraInfoProvider()
    const frustumBBox = this.frustumProvider()
    const ranked = this.prioritiser.prioritise(frustumBBox, camera, slots)
    if (ranked.length === 0) return

    // Sync filter + claim. We add to `fetching` before any await so subsequent
    // frames see these chunks as taken and don't re-dispatch them.
    const candidates: Array<{ chunkIndex: number; chunk: ChunkTableEntry }> = []
    for (const item of ranked) {
      if (this.fetching.has(item.chunkIndex)) continue
      if (this.workerPool.isKnown(item.chunkIndex)) continue
      const chunk = this.chunks[item.chunkIndex]
      if (!chunk) continue
      candidates.push({ chunkIndex: item.chunkIndex, chunk })
      this.fetching.add(item.chunkIndex)
    }
    if (candidates.length === 0) return

    void this.dispatchCandidates(candidates)
  }

  /**
   * Decode ALL chunks regardless of camera position. Stress-test only.
   * Bypasses Step 6 back-pressure — will queue every undecoded chunk.
   */
  decodeAll(): void {
    if (!this.workerPool || !this.prioritiser || !this.workersConfigured) return
    const undecoded = this.prioritiser.allUndecoded()
    if (undecoded.length > 200) {
      console.warn(
        `[lazstream] decodeAll: ${undecoded.length} chunks — bypasses fetch cap ` +
        `and ring-buffer back-pressure. Use only for stress testing.`
      )
    }

    const candidates: Array<{ chunkIndex: number; chunk: ChunkTableEntry }> = []
    for (const i of undecoded) {
      if (this.fetching.has(i)) continue
      if (this.workerPool.isKnown(i)) continue
      const chunk = this.chunks[i]
      if (!chunk) continue
      candidates.push({ chunkIndex: i, chunk })
      this.fetching.add(i)
    }
    if (candidates.length === 0) return
    void this.dispatchCandidates(candidates)
  }

  /** Number of chunks in this file's chunk table. Available after load() passes the chunk-table stage. */
  get chunkCount(): number { return this.chunks.length }

  dispose(): void {
    this.abortController?.abort()
    this.abortController = null

    this.workerPool?.dispose()
    this.workerPool = null
    this.spatial.clear()
    this.prioritiser = null
    this.cameraInfoProvider = null
    this.frustumProvider = null
    this.ringBufferProvider = null
    this.workersConfigured = false
  }

  // ─── Internal: dispatch path ───────────────────────────────────────────

  /**
   * Async dispatch for a batch of candidates already claimed in `fetching`.
   * 1. Parallel IDB cache lookups — hits go directly to the pool.
   * 2. Misses are coalesced into Range batches, fetched, cached, then pooled.
   *
   * Captures url/signal/pool/cache as locals at entry so a concurrent load()
   * that replaces engine state doesn't corrupt this in-flight dispatch.
   */
  private async dispatchCandidates(
    candidates: Array<{ chunkIndex: number; chunk: ChunkTableEntry }>,
  ): Promise<void> {
    const url = this.url
    const signal = this.abortController?.signal
    const pool = this.workerPool
    const fetchingSet = this.fetching
    const cache = this.cache

    if (!signal || !pool) {
      for (const c of candidates) fetchingSet.delete(c.chunkIndex)
      return
    }

    try {
      // Parallel cache lookups
      let lookups: Array<{ chunkIndex: number; chunk: ChunkTableEntry; cached: ArrayBuffer | null }>

      if (cache) {
        lookups = await Promise.all(candidates.map(async (c) => ({
          chunkIndex: c.chunkIndex,
          chunk: c.chunk,
          cached: await cache.get(makeCacheKey(url, c.chunkIndex, c.chunk.offset)),
        })))
      } else {
        lookups = candidates.map((c) => ({ chunkIndex: c.chunkIndex, chunk: c.chunk, cached: null }))
      }

      if (signal.aborted) return

      // Cache hits → pool directly. Cache stores compressed bytes; worker still decodes.
      const misses: Array<{ chunkIndex: number; chunk: ChunkTableEntry }> = []
      for (const r of lookups) {
        if (r.cached) {
          pool.requestDecode(r.chunkIndex, r.chunk, r.cached)
          fetchingSet.delete(r.chunkIndex)
        } else {
          misses.push({ chunkIndex: r.chunkIndex, chunk: r.chunk })
        }
      }

      if (misses.length === 0) return

      const batches = coalesce(misses)
      await Promise.all(batches.map((batch) =>
        this.fetchAndDispatchBatch(batch, url, signal, pool, cache, fetchingSet)
      ))
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn('[lazstream] dispatch error:', err)
      }
    } finally {
      for (const c of candidates) fetchingSet.delete(c.chunkIndex)
    }
  }

  /**
   * Fetch one coalesced batch via a single Range request, slice the
   * response into per-chunk bytes, write each to cache (fire-and-forget),
   * and dispatch each to the worker pool.
   */
  private async fetchAndDispatchBatch(
    batch: FetchBatch,
    url: string,
    signal: AbortSignal,
    pool: WorkerPool,
    cache: ChunkCache | null,
    fetchingSet: Set<number>,
  ): Promise<void> {
    if (batch.chunks.length === 0) return

    try {
      // batch.end is exclusive; Range header wants inclusive.
      const fetchT0 = performance.now()
      const buffer = await fetchRange(url, batch.start, batch.end - 1, signal)
      const fetchMs = performance.now() - fetchT0
      if (signal.aborted) return

      const batchMB = (batch.end - batch.start) / 1048576
      console.debug(
        `[lazstream/timing] fetch ${batch.chunks.length} chunks ` +
        `${batchMB.toFixed(2)} MB in ${fetchMs.toFixed(0)} ms ` +
        `(${(batchMB * 1000 / fetchMs).toFixed(1)} MB/s)`
      )

      for (const c of batch.chunks) {
        const localOffset = c.chunk.offset - batch.start
        const bytes = buffer.slice(localOffset, localOffset + c.chunk.compressedSize)

        // Clone for cache before transferring to worker. Async, not awaited.
        if (cache) {
          const cacheBytes = bytes.slice(0)
          void cache.set(makeCacheKey(url, c.chunkIndex, c.chunk.offset), cacheBytes)
        }

        pool.requestDecode(c.chunkIndex, c.chunk, bytes)
        fetchingSet.delete(c.chunkIndex)
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn(
          `[lazstream] batch fetch failed (bytes ${batch.start}-${batch.end - 1}, ` +
          `${batch.chunks.length} chunks):`, err
        )
      }
      for (const c of batch.chunks) fetchingSet.delete(c.chunkIndex)
    }
  }

  // ─── Internal: spatial + decoded chunk handling ────────────────────────

  private buildSpatialIndex(seeds: SeedPoint[], header: LasHeader): void {
    const fileBBox: BBox3D = {
      minX: header.minX, maxX: header.maxX,
      minY: header.minY, maxY: header.maxY,
      minZ: header.minZ, maxZ: header.maxZ,
    }

    const seedXYZ = seeds.map(s => ({
      chunkIndex: s.chunkIndex,
      x: s.x,
      y: s.y,
      z: s.z,
    }))

    this.spatial.buildFromSeeds(seedXYZ, fileBBox)
    this.prioritiser = new ChunkPrioritiser(this.spatial, this.sseThreshold)
  }

  private handleChunkDecoded(chunk: DecodedChunk): void {
    this.spatial.updateFromDecoded({
      chunkIndex: chunk.chunkIndex,
      minX: chunk.minX, minY: chunk.minY, minZ: chunk.minZ,
      maxX: chunk.maxX, maxY: chunk.maxY, maxZ: chunk.maxZ,
    })
    this.prioritiser?.setDecoded(chunk.chunkIndex)

    this.decodedChunkCount++
    this.decodedPointCount += chunk.pointCount

    this.events.onChunkDecoded?.(chunk)
    this.emitStats()

    this.events.onProgress?.(
      this.decodedChunkCount,
      this.chunks.length,
      'decode'
    )

    if (this.decodedChunkCount >= this.chunks.length) {
      this.emit('ready',
        `All ${this.chunks.length} chunks decoded — ` +
        `${this.decodedPointCount.toLocaleString()} points`
      )
    }
  }

  private emit(state: LoadState, message: string): void {
    this.events.onStateChange?.(state, message)
  }

  private emitStats(): void {
    if (!this.header) return
    this.events.onStats?.({
      fileSize: this.fileSize,
      pointCount: this.header.pointCount,
      chunkCount: this.chunks.length,
      version: `LAS ${this.header.versionMajor}.${this.header.versionMinor}`,
      format: this.header.pointDataRecordFormat,
      decodedChunks: this.decodedChunkCount,
      decodedPoints: this.decodedPointCount,
      activeWorkers: this.workerPool?.activeCount ?? 0,
      queuedChunks: this.workerPool?.queueLength ?? 0,
    })
  }
}