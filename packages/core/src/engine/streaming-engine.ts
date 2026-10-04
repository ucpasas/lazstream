/**
 * StreamingEngine — single-tile streaming coordinator.
 *
 * Pipeline:
 *   URL → probe → header → chunk table → seed points → seed render
 *   seeds → SpatialIndex → ChunkPrioritiser (frustum + SSE)
 *        → IDB cache check → coalesced HTTP Range fetches
 *        → WorkerPool (WASM decode) → decoded chunks → renderer
 *
 * Field masks (selective layer fetch): the effective mask is
 * fetchFields ∪ live demandFields() ∪ {xyz}. For LAZ 1.4 layered files with
 * fixed-size chunks, only the compressed layers that mask needs are
 * range-read; the result is rewritten into a "compact" chunk (skipped layers'
 * sizes zeroed) that laz-perf decodes unmodified. Every DecodedChunk carries
 * fieldsPresent — fields outside it are plausible constants, not data.
 * upgradeChunks() tops already-decoded chunks up to a grown mask by fetching
 * only the missing layers. Binary LOD is unchanged: masks pick which FIELDS,
 * never which points.
 *
 * The engine is renderer-agnostic: camera position, frustum AABB, and
 * ring-buffer free-slot count are injected via provider callbacks.
 * ManifestSession is the preferred entry point — StreamingEngine is
 * the per-tile worker inside it.
 */

import type { LasHeader, ChunkTableEntry, SeedPoint, PointAttributes } from '../types/las.js'
import type { BBox3D } from '../types/spatial.js'
import { classifyLazVersion, getLazVersionWarning } from '../types/las.js'
import { validateSourceUrl } from '../network/url-validator.js'
import { probeUrl, fetchRange } from '../network/range-fetcher.js'
import { coalesceRanges, DEFAULT_MAX_GAP_BYTES, type RangeItem } from '../network/batch-fetcher.js'
import { fetchAndParseLasHeader, ParseError } from './header-parser.js'
import { fetchChunkTable, fetchSeedPoints } from './chunk-table.js'
import { WorkerPool } from '../decode/worker-pool.js'
import type { DecodedChunk, LazstreamAssetUrls } from '../decode/worker-pool.js'
import { ChunkPrioritiser, type CameraInfo, type ChunkOrdering, type VisibilityTest } from '../decode/chunk-priority.js'
import { SpatialIndex } from './spatial-index.js'
import { ChunkCache, makeCacheKey } from '../cache/idb-cache.js'
import { CompactStore } from '../cache/compact-store.js'
import {
  FieldDemandSet, FIELD_BITS_ALL, XYZ_BIT, SURFACEABLE_BITS,
  fieldBitsInFormat, fromBits, isSubsetBits, popcount, resolveFetchFields,
  type FieldDemand, type LasField,
} from '../decode/fields.js'
import {
  LAYERED_BASE_LEN, MIN_SKIP_BYTES,
  layerNames, layersForFields, fieldBitsForLayers, plannedRanges, skippableBytes,
  compactChunk, mergeCompact,
  type ByteRange, type LayerName, type LayerTable,
} from '../decode/layer-select.js'

// ─── Module-local helpers ────────────────────────────────────────────────────

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/** Request layer tables with the seed fetch even when the base mask is 'all'
 *  (+4 + 4L bytes per seed request), so a later demand can go selective and
 *  P3 can top up. Flip to false to keep default-path seed requests byte-identical. */
const ALWAYS_FETCH_LAYER_TABLES = true

/** Default max gap bridged when coalescing layer-selective ranges. */
const DEFAULT_SELECTIVE_MAX_GAP_BYTES = 8192

/** Default in-memory compact-chunk budget for P3 top-up bases. */
const DEFAULT_TOPUP_MEMORY_BYTES = 64 * 1024 * 1024

/** IDB key variant for compact chunks: prefix + present field bits (hex).
 *  Bump the prefix if LAS_FIELDS order ever changes. */
const COMPACT_CACHE_VARIANT_PREFIX = 'm'

function compactVariant(presentBits: number): string {
  return COMPACT_CACHE_VARIANT_PREFIX + presentBits.toString(16)
}

/** How one chunk's bytes will be acquired. Ranges are absolute file offsets. */
type ChunkPlan =
  | { kind: 'full'; ranges: ByteRange[]; presentBits: number }
  | { kind: 'selective'; ranges: ByteRange[]; relRanges: ByteRange[]; keep: boolean[];
      table: LayerTable; presentBits: number }

/** One unit of network work: fetch `ranges`, then hand the pieces to onBytes. */
interface FetchJob {
  chunkIndex: number
  chunk: ChunkTableEntry
  ranges: ByteRange[]
  selective: boolean
  /** Bytes of the chunk this job deliberately does not fetch (stats). */
  skippedBytes: number
  onBytes: (pieces: ArrayBuffer[]) => void
  onFail: () => void
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
    /** Chunk bytes fetched over the network this load (all paths). */
    bytesFetched?: number
    /** Chunk bytes deliberately not fetched by layer-selective plans this load. */
    bytesSkipped?: number
  }) => void
  /** Effective fetch / surface field sets changed (demand added or released). */
  onFieldsChanged?: (fetch: ReadonlySet<LasField>, surface: ReadonlySet<LasField>) => void
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
  /** Decode queue ordering strategy (priority-ordering spike). Default: 'sse'. */
  chunkOrdering?: ChunkOrdering
  /** Asset URL overrides — only needed for non-standard hosting or CDN prefixes. */
  assetUrls?: LazstreamAssetUrls
  /**
   * Base field mask. 'all' (default) = today's behaviour: whole chunks.
   * 'render' = FIELDS_RENDER. Or an explicit field list. Effective mask =
   * base ∪ active demands ∪ {xyz}. Only LAZ 1.4 layered files (compressor 3)
   * with fixed-size chunks can skip layers; everything else is fetched whole.
   */
  fetchFields?: 'all' | 'render' | Iterable<LasField>
  /** Max gap bridged when coalescing selective ranges. Default 8192. */
  selectiveMaxGapBytes?: number
  /**
   * In-memory budget for compact (layer-selective) chunk bytes, used as the
   * base for upgradeChunks() top-ups when no IDB cache holds one. Only filled
   * in selective mode. Default 64 MB; 0 disables.
   */
  topUpMemoryBytes?: number
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
  private visibilityProvider:  VisibilityTest            | null = null

  private cache: ChunkCache | null = null

  private workerCount: number
  private readonly sseThreshold: number | undefined
  private readonly chunkOrdering: ChunkOrdering
  private readonly assetUrls: LazstreamAssetUrls | undefined
  /** True once workerPool.init() AND workerPool.configure() have both returned. Guards updateCamera(). */
  private workersConfigured = false

  private abortController: AbortController | null = null

  /** Chunk indices currently being fetched. Replaced (not cleared) on each load. */
  private fetching = new Set<number>()

  /** Max concurrent main-thread fetches. Caps dispatch alongside the ring-buffer free-slot check. */
  private maxFetches: number

  // ── Field masks / selective fetch ──
  private readonly demands: FieldDemandSet
  private readonly selectiveMaxGapBytes: number
  private readonly compactStore: CompactStore
  /** Per load: true when layer-selective fetch is possible for this file. */
  private layered = false
  private layerNameList: LayerName[] = []
  /** Per load: bits of the fields the file's PDRF carries. */
  private formatBits = FIELD_BITS_ALL
  /** Per load: layer table per chunk index (null = unknown → fetch whole). */
  private layerTables: Array<LayerTable | null> = []
  /** Chunk index → {present, surface} bits of the last emitted decode. Deleted on GPU eviction. */
  private decodedMask = new Map<number, { present: number; surface: number }>()
  /** Chunk index → bits of the decode currently queued/running in the pool. */
  private dispatchedMask = new Map<number, { present: number; surface: number }>()
  /** Present-bits of compact variants written/read this load (IDB lookup candidates). */
  private masksUsed = new Set<number>()
  private bytesFetched = 0
  private bytesSkipped = 0

  // ── P3 upgrades ──
  private upgradeQueue: number[] = []
  private upgradeQueued = new Set<number>()
  /** Upgrades between claim and emission (fetch + decode). */
  private upgradesInFlight = new Set<number>()
  /** Chunks busy when upgradeChunks() saw them — re-checked when their decode lands. */
  private upgradeRecheck = new Set<number>()

  constructor(options: StreamingEngineOptions = {}) {
    const {
      events = {}, workerCount, cache, sseThreshold, maxFetches, assetUrls, chunkOrdering,
      fetchFields, selectiveMaxGapBytes, topUpMemoryBytes,
    } = options
    this.events = events
    this.demands = new FieldDemandSet(
      resolveFetchFields(fetchFields),
      (fetchBits, surfaceBits) => this.events.onFieldsChanged?.(fromBits(fetchBits), fromBits(surfaceBits)),
    )
    this.selectiveMaxGapBytes = selectiveMaxGapBytes ?? DEFAULT_SELECTIVE_MAX_GAP_BYTES
    this.compactStore = new CompactStore(topUpMemoryBytes ?? DEFAULT_TOPUP_MEMORY_BYTES)
    this.workerCount = workerCount ?? Math.min(100, Math.max(1, navigator.hardwareConcurrency - 1))
    this.maxFetches  = maxFetches  ?? Math.min(this.workerCount * 4, 128)
    this.cache = cache ?? null
    this.sseThreshold = sseThreshold
    this.chunkOrdering = chunkOrdering ?? 'sse'
    this.assetUrls = assetUrls
    console.debug('[lazstream] StreamingEngine:', {
      workerCount: this.workerCount,
      maxFetches: this.maxFetches,
      cacheEnabled: this.cache !== null,
      sseThreshold: this.sseThreshold ?? '(default)',
      chunkOrdering: this.chunkOrdering,
      fetchFields: [...fromBits(this.demands.fetchBits())].join(','),
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

  /** Register an exact-visibility test (renderer's 6-plane frustum vs world
   *  AABB). Optional: without it the engine falls back to the loose frustum
   *  AABB alone, which at ground-level views admits chunks the renderer
   *  immediately culls — decode → evict → re-queue churn. */
  setVisibilityProvider(provider: VisibilityTest): void {
    this.visibilityProvider = provider
  }

  /** Called by the renderer when a chunk is proactively evicted from the GPU
   *  ring buffer (invisible for more than EVICT_GRACE_FRAMES). Removes it from
   *  the decoded set so the engine will re-fetch it when it re-enters view. */
  onChunkEvictedFromGPU(chunkIndex: number): void {
    this.prioritiser?.removeDecoded(chunkIndex)
    this.workerPool?.markEvicted(chunkIndex)
    // Evicted chunks need no upgrade: their next fetch uses the current mask.
    this.decodedMask.delete(chunkIndex)
    this.upgradeRecheck.delete(chunkIndex)
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
    this.layered = false
    this.layerNameList = []
    this.formatBits = FIELD_BITS_ALL
    this.layerTables = []
    this.decodedMask = new Map()
    this.dispatchedMask = new Map()
    this.masksUsed = new Set()
    this.compactStore.clear()
    this.bytesFetched = 0
    this.bytesSkipped = 0
    this.resetUpgrades()

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

      // Layer-selective fetch needs the layered codec (compressor 3 — PDRF 6–10
      // files written in compatibility mode use compressor 2) and fixed-size
      // chunks (variable chunks carry a different prefix).
      const pdrf = header.pointDataRecordFormat
      this.formatBits = fieldBitsInFormat(pdrf, header.pointDataRecordLength)
      const layeredFile = lazVlr.isLayered && lazVlr.chunkSize !== 0 && LAYERED_BASE_LEN[pdrf] !== undefined
      const wantTables = layeredFile &&
        (ALWAYS_FETCH_LAYER_TABLES || !isSubsetBits(this.formatBits, this.demands.fetchBits()))
      if (wantTables) this.layerNameList = layerNames(pdrf, header.pointDataRecordLength)

      this.emit('seeds', `Fetching ${this.chunks.length} chunk seed points...`)
      const { seeds, layerTables } = await fetchSeedPoints(
        this.url, this.chunks, header, lazVlr,
        (loaded, total) => this.events.onProgress?.(loaded, total, 'seeds'),
        signal,
        wantTables ? { layerTables: { layerCount: this.layerNameList.length } } : {},
      )
      this.layerTables = layerTables
      this.layered = wantTables

      this.events.onSeedsReady?.(seeds, header)

      this.buildSpatialIndex(seeds, header)

      // Compute p1/p99 intensity range from seed points for shader-side stretch.
      // Seeds are sorted (≤7073 values) so exact percentiles are trivial.
      const intensitySeedRange = computeIntensitySeedRange(seeds)
      console.debug('[lazstream] intensity seed range:', intensitySeedRange)

      this.emit('workers-init', `Starting ${this.workerCount} decode workers...`)

      this.workerPool = new WorkerPool({
        onChunkDecoded: (chunk) => this.handleChunkDecoded(chunk),
        onWorkerError: (chunkIndex, message) => {
          console.warn(`[lazstream] chunk ${chunkIndex} decode failed: ${message}`)
          this.dispatchedMask.delete(chunkIndex)
          this.upgradesInFlight.delete(chunkIndex)
        },
        onReady: () => {
          console.debug('[lazstream] worker pool ready')
        },
      }, this.workerCount, this.assetUrls)

      await this.workerPool.init()

      if (signal.aborted) {
        throw new DOMException('Load aborted during worker init', 'AbortError')
      }

      this.workerPool.configure(header, lazVlr, intensitySeedRange)
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
    this.dispatchVisible()
    // Upgrades go after visible dispatch so they never delay new chunks.
    this.pumpUpgrades()
  }

  private dispatchVisible(): void {
    if (!this.prioritiser || !this.workerPool) return
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
    const ranked = this.prioritiser.prioritise(
      frustumBBox, camera, slots, this.visibilityProvider ?? undefined,
    )
    if (ranked.length === 0) return

    // Sync filter + claim. We add to `fetching` before any await so subsequent
    // frames see these chunks as taken and don't re-dispatch them.
    const candidates: Array<{ chunkIndex: number; chunk: ChunkTableEntry }> = []
    for (const item of ranked) {
      if (this.fetching.has(item.chunkIndex)) continue
      if (this.workerPool.isKnown(item.chunkIndex)) continue
      // An upgrade in flight for an evicted chunk re-emits it as a normal decode.
      if (this.upgradesInFlight.has(item.chunkIndex)) continue
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
      if (this.upgradesInFlight.has(i)) continue
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

  /**
   * T3 picking: resolve full attributes for a single point.
   *
   * Fetches compressed bytes for the chunk (IDB cache → network fallback),
   * then dispatches a decode-attrs request to an idle worker which decodes
   * up to pointIndex and extracts all raw LAS attribute fields.
   *
   * Uses the NO-VARIANT (full-chunk) cache key only, never compact variants
   * or the in-memory CompactStore: in a compact chunk the skipped fields
   * decode as plausible constants, and T3 reports every field. In selective
   * mode this misses and fetches the full chunk, then caches it as full.
   */
  async resolvePointAttributes(localChunkIndex: number, pointIndex: number): Promise<PointAttributes | null> {
    const chunk = this.chunks[localChunkIndex]
    if (!chunk || !this.workerPool || !this.header) return null

    let compressedBytes: ArrayBuffer | null = null
    let cacheHit = false

    if (this.cache) {
      compressedBytes = await this.cache.get(makeCacheKey(this.url, localChunkIndex, chunk.offset))
      cacheHit = compressedBytes !== null
    }

    if (!compressedBytes) {
      try {
        compressedBytes = await fetchRange(
          this.url,
          chunk.offset,
          chunk.offset + chunk.compressedSize - 1,
          this.abortController?.signal,
        )
      } catch (err) {
        if (!isAbortError(err)) console.warn('[lazstream] T3 fetch failed:', err)
        return null
      }
    }

    // Write to cache before transferring (buffer is detached after postMessage)
    if (!cacheHit && this.cache) {
      void this.cache.set(makeCacheKey(this.url, localChunkIndex, chunk.offset), compressedBytes.slice(0))
    }

    try {
      return await this.workerPool.requestPointAttributes(compressedBytes, pointIndex)
    } catch (err) {
      console.warn('[lazstream] T3 decode failed:', err)
      return null
    }
  }

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
    this.visibilityProvider = null
    this.workersConfigured = false
    this.compactStore.clear()
    this.resetUpgrades()
  }

  // ─── Field masks (P1/P2) ───────────────────────────────────────────────

  /**
   * Ask core to fetch these fields (and, with `surface: true`, decode them
   * into DecodedChunk.attributes) for every chunk dispatched from now on.
   * Ref-counted and anonymous; survives load(). Already-decoded chunks are
   * NOT changed — call upgradeChunks() for those. Releasing only affects
   * future fetches; it never downgrades decoded chunks.
   */
  demandFields(fields: Iterable<LasField>, opts: { surface?: boolean } = {}): FieldDemand {
    return this.demands.add(fields, opts.surface ?? false)
  }

  /** Effective fetch mask: base ∪ live demands ∪ {xyz}. */
  getFieldMask(): ReadonlySet<LasField> {
    return fromBits(this.demands.fetchBits())
  }

  // ─── Layer top-up (P3) ─────────────────────────────────────────────────

  /**
   * Bring already-decoded chunks (local indices) up to the current effective
   * mask and surface set. Fetches only the missing layers when a compact base
   * is held (IDB variant or in-memory CompactStore); re-decodes from cached
   * full bytes with no network; otherwise fetches the current plan fresh.
   * Each upgraded chunk is re-emitted via onChunkDecoded with isUpgrade: true.
   * No-op for chunks never decoded, evicted, or already satisfied.
   * Upgrades run behind visible-chunk dispatch, ≤ workerCount at a time.
   */
  upgradeChunks(chunkIndices: number[]): void {
    for (const idx of chunkIndices) this.queueUpgrade(idx)
  }

  // ─── Internal: dispatch path ───────────────────────────────────────────

  /**
   * Async dispatch for a batch of candidates already claimed in `fetching`.
   * 1. Parallel cache lookups (IDB full → compact variants → CompactStore) —
   *    hits go directly to the pool.
   * 2. Misses are planned (whole chunk or selective layer ranges), coalesced
   *    into Range batches, fetched, reassembled, cached, then pooled.
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
      const target = this.demands.fetchBits()
      const planned = candidates.map(c => ({ ...c, plan: this.planChunk(c.chunkIndex, c.chunk, target) }))

      // Parallel cache lookups
      const lookups = await Promise.all(planned.map(async (c) => ({
        ...c,
        cached: await this.findCached(cache, url, c.chunkIndex, c.chunk, c.plan),
      })))

      if (signal.aborted) return

      // Cache hits → pool directly. Cache stores compressed bytes; worker still decodes.
      const jobs: FetchJob[] = []
      for (const r of lookups) {
        if (r.cached) {
          this.decode(pool, r.chunkIndex, r.chunk, r.cached.bytes, r.cached.presentBits, false)
          fetchingSet.delete(r.chunkIndex)
          continue
        }
        const { chunkIndex, chunk, plan } = r
        jobs.push({
          chunkIndex, chunk,
          ranges: plan.ranges,
          selective: plan.kind === 'selective',
          skippedBytes: plan.kind === 'selective' ? chunk.compressedSize - rangeBytes(plan.ranges) : 0,
          onBytes: (pieces) => {
            const bytes = this.assemble(url, cache, chunkIndex, chunk, plan, pieces)
            this.decode(pool, chunkIndex, chunk, bytes, plan.presentBits, false)
            fetchingSet.delete(chunkIndex)
          },
          onFail: () => fetchingSet.delete(chunkIndex),
        })
      }

      if (jobs.length === 0) return
      await this.fetchJobs(jobs, url, signal)
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn('[lazstream] dispatch error:', err)
      }
    } finally {
      for (const c of candidates) fetchingSet.delete(c.chunkIndex)
    }
  }

  /**
   * Decide how to acquire one chunk for target field bits.
   * Whole chunk when: the target covers every field in the format, the file
   * isn't layered with fixed chunks, the layer table is missing/invalid, or
   * fewer than MIN_SKIP_BYTES would be skipped. Otherwise selective ranges.
   */
  private planChunk(chunkIndex: number, chunk: ChunkTableEntry, targetBits: number): ChunkPlan {
    const full: ChunkPlan = {
      kind: 'full',
      ranges: [{ start: chunk.offset, end: chunk.offset + chunk.compressedSize }],
      presentBits: this.formatBits,
    }
    if (!this.layered || !this.header) return full
    const table = this.layerTables[chunkIndex]
    if (!table) return full
    const target = (targetBits & this.formatBits) | XYZ_BIT
    if (isSubsetBits(this.formatBits, target)) return full

    const keep = this.keepFor(target, table)
    if (skippableBytes(table.sizes, keep) < MIN_SKIP_BYTES) return full

    const recordLength = this.header.pointDataRecordLength
    const relRanges = plannedRanges(table.sizes, this.layerNameList, recordLength, keep)
    return {
      kind: 'selective',
      relRanges,
      ranges: relRanges.map(r => ({ start: chunk.offset + r.start, end: chunk.offset + r.end })),
      keep,
      table,
      presentBits: fieldBitsForLayers(keep, this.layerNameList) & this.formatBits,
    }
  }

  /** Kept layers for target bits. Zero-size layers are always "kept": they
   *  cost nothing and their field is genuinely constant, so it is valid. */
  private keepFor(targetBits: number, table: LayerTable): boolean[] {
    const keep = layersForFields(targetBits, this.layerNameList)
    for (let i = 0; i < keep.length; i++) if (table.sizes[i] === 0) keep[i] = true
    return keep
  }

  /**
   * Cached bytes that satisfy `plan` (present ⊇ plan.presentBits), or null.
   * Order: IDB full key (superset of every mask) → IDB exact variant →
   * IDB variants of masks used this load (smallest superset first) →
   * in-memory CompactStore. No IDB key enumeration.
   */
  private async findCached(
    cache: ChunkCache | null, url: string, chunkIndex: number, chunk: ChunkTableEntry, plan: ChunkPlan,
  ): Promise<{ bytes: ArrayBuffer; presentBits: number } | null> {
    if (cache) {
      const full = await cache.get(makeCacheKey(url, chunkIndex, chunk.offset))
      if (full) return { bytes: full, presentBits: this.formatBits }
    }
    if (plan.kind === 'full') return null

    const want = plan.presentBits
    if (cache) {
      const candidates = [want, ...[...this.masksUsed]
        .filter(m => m !== want && isSubsetBits(want, m))
        .sort((a, b) => popcount(a) - popcount(b))]
      for (const m of candidates) {
        const key = makeCacheKey(url, chunkIndex, chunk.offset, compactVariant(m))
        if (!(await cache.has(key))) continue
        const bytes = await cache.get(key)
        if (bytes) {
          this.masksUsed.add(m)
          return { bytes, presentBits: m }
        }
      }
    }
    const mem = this.compactStore.get(chunkIndex)
    if (mem && isSubsetBits(want, mem.presentBits)) {
      return { bytes: mem.bytes.slice(0), presentBits: mem.presentBits }
    }
    return null
  }

  /** Build decodable bytes from fetched pieces and cache them. Full bytes go
   *  under the no-variant key; compact bytes ONLY under their variant key. */
  private assemble(
    url: string, cache: ChunkCache | null, chunkIndex: number, chunk: ChunkTableEntry,
    plan: ChunkPlan, pieces: ArrayBuffer[],
  ): ArrayBuffer {
    if (plan.kind === 'full') {
      const bytes = pieces[0]
      // Clone for cache before transferring to worker. Async, not awaited.
      if (cache) void cache.set(makeCacheKey(url, chunkIndex, chunk.offset), bytes.slice(0))
      return bytes
    }
    const bytes = compactChunk(
      pieces, plan.relRanges, plan.table.sizes, this.layerNameList,
      this.header!.pointDataRecordLength, plan.keep,
    )
    this.storeCompact(url, cache, chunkIndex, chunk, bytes, plan.presentBits)
    return bytes
  }

  private storeCompact(
    url: string, cache: ChunkCache | null, chunkIndex: number, chunk: ChunkTableEntry,
    bytes: ArrayBuffer, presentBits: number,
  ): void {
    // One clone shared by IDB and the in-memory store; neither mutates it.
    const copy = bytes.slice(0)
    this.masksUsed.add(presentBits)
    this.compactStore.put(chunkIndex, copy, presentBits)
    if (cache) void cache.set(makeCacheKey(url, chunkIndex, chunk.offset, compactVariant(presentBits)), copy)
  }

  /** Surface bits for a decode of bytes holding `presentBits`. A field that
   *  wasn't fetched is never surfaced — it would be a plausible constant. */
  private surfaceFor(presentBits: number): number {
    return this.demands.surfaceBits() & presentBits & this.formatBits & SURFACEABLE_BITS
  }

  private decode(
    pool: WorkerPool, chunkIndex: number, chunk: ChunkTableEntry, bytes: ArrayBuffer,
    presentBits: number, upgrade: boolean,
  ): boolean {
    const surfaceBits = this.surfaceFor(presentBits)
    const accepted = pool.requestDecode(chunkIndex, chunk, bytes, { presentBits, surfaceBits, upgrade })
    if (accepted && pool === this.workerPool) {
      this.dispatchedMask.set(chunkIndex, { present: presentBits, surface: surfaceBits })
    }
    return accepted
  }

  /**
   * Fetch every job's ranges with as few Range requests as possible, then
   * reassemble per chunk. Whole-chunk ranges coalesce with the 64 KB gap;
   * selective ranges with selectiveMaxGapBytes so skipped layers aren't
   * bridged. A chunk completes when all its pieces land; if any batch
   * carrying one of its pieces fails, the chunk fails (onFail) and the
   * prioritiser re-requests it later.
   */
  private async fetchJobs(jobs: FetchJob[], url: string, signal: AbortSignal): Promise<void> {
    const pending = new Map<number, { job: FetchJob; pieces: ArrayBuffer[]; remaining: number }>()
    const fullItems: RangeItem[] = []
    const selectiveItems: RangeItem[] = []
    for (const job of jobs) {
      pending.set(job.chunkIndex, { job, pieces: new Array(job.ranges.length), remaining: job.ranges.length })
      const target = job.selective ? selectiveItems : fullItems
      job.ranges.forEach((r, part) => target.push({ key: job.chunkIndex, part, start: r.start, end: r.end }))
    }
    const batches = [
      ...coalesceRanges(fullItems, { maxGapBytes: DEFAULT_MAX_GAP_BYTES }),
      ...coalesceRanges(selectiveItems, { maxGapBytes: this.selectiveMaxGapBytes }),
    ]

    let fetched = 0
    let skipped = 0
    await Promise.all(batches.map(async (batch) => {
      const chunkCount = new Set(batch.items.map(i => i.key)).size
      try {
        // batch.end is exclusive; Range header wants inclusive.
        const fetchT0 = performance.now()
        const buffer = await fetchRange(url, batch.start, batch.end - 1, signal)
        const fetchMs = performance.now() - fetchT0
        if (signal.aborted) return

        const batchBytes = batch.end - batch.start
        fetched += batchBytes
        this.bytesFetched += batchBytes
        const batchMB = batchBytes / 1048576
        console.debug(
          `[lazstream/timing] fetch ${chunkCount} chunks ` +
          `${batchMB.toFixed(2)} MB in ${fetchMs.toFixed(0)} ms ` +
          `(${(batchMB * 1000 / fetchMs).toFixed(1)} MB/s)`
        )

        for (const item of batch.items) {
          const entry = pending.get(item.key)
          if (!entry) continue   // a sibling piece already failed
          entry.pieces[item.part] = buffer.slice(item.start - batch.start, item.end - batch.start)
          if (--entry.remaining > 0) continue
          pending.delete(item.key)
          if (entry.job.skippedBytes > 0) {
            skipped += entry.job.skippedBytes
            this.bytesSkipped += entry.job.skippedBytes
          }
          entry.job.onBytes(entry.pieces)
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.warn(
            `[lazstream] batch fetch failed (bytes ${batch.start}-${batch.end - 1}, ` +
            `${chunkCount} chunks):`, err
          )
        }
        for (const item of batch.items) {
          const entry = pending.get(item.key)
          if (!entry) continue
          pending.delete(item.key)
          entry.job.onFail()
        }
      }
    }))

    if (selectiveItems.length > 0 && !signal.aborted) {
      const total = fetched + skipped
      console.debug(
        `[lazstream/timing] selective: ${(fetched / 1048576).toFixed(2)} MB fetched, ` +
        `${(skipped / 1048576).toFixed(2)} MB skipped ` +
        `(${total > 0 ? (skipped / total * 100).toFixed(1) : '0.0'}%)`
      )
    }
    this.emitStats()
  }

  // ─── Internal: P3 upgrades ─────────────────────────────────────────────

  private resetUpgrades(): void {
    this.upgradeQueue = []
    this.upgradeQueued = new Set()
    this.upgradesInFlight = new Set()
    this.upgradeRecheck = new Set()
  }

  /** True if the chunk's last emitted decode already covers the current
   *  fetch mask and surface set. */
  private isUpgradeSatisfied(chunkIndex: number): boolean {
    const m = this.decodedMask.get(chunkIndex)
    if (!m) return true
    const target = (this.demands.fetchBits() & this.formatBits) | XYZ_BIT
    const surface = this.demands.surfaceBits() & this.formatBits & SURFACEABLE_BITS
    return isSubsetBits(target, m.present) && isSubsetBits(surface, m.surface)
  }

  private queueUpgrade(chunkIndex: number): void {
    if (!this.chunks[chunkIndex] || !this.decodedMask.has(chunkIndex)) return
    if (this.isUpgradeSatisfied(chunkIndex)) return
    if (this.isChunkBusy(chunkIndex)) {
      // Its in-flight decode carries the old mask — re-check when it lands.
      this.upgradeRecheck.add(chunkIndex)
      return
    }
    if (this.upgradeQueued.has(chunkIndex)) return
    this.upgradeQueued.add(chunkIndex)
    this.upgradeQueue.push(chunkIndex)
  }

  private isChunkBusy(chunkIndex: number): boolean {
    return this.fetching.has(chunkIndex)
      || this.upgradesInFlight.has(chunkIndex)
      || (this.workerPool?.isPending(chunkIndex) ?? false)
  }

  private pumpUpgrades(): void {
    if (this.upgradeQueue.length === 0) return
    const batch: number[] = []
    while (this.upgradeQueue.length > 0 && this.upgradesInFlight.size < this.workerCount) {
      const idx = this.upgradeQueue.shift()!
      this.upgradeQueued.delete(idx)
      if (!this.decodedMask.has(idx) || this.isUpgradeSatisfied(idx)) continue
      if (this.isChunkBusy(idx)) { this.upgradeRecheck.add(idx); continue }
      this.upgradesInFlight.add(idx)
      batch.push(idx)
    }
    if (batch.length > 0) void this.runUpgrades(batch)
  }

  /**
   * Per chunk, with target T = current plan:
   *   1. cached bytes covering T (IDB full / variant / CompactStore) → re-decode, no network
   *   2. a compact base held (CompactStore or IDB variant of a mask used this
   *      load) → fetch ONLY the missing layers, splice (mergeCompact), cache, decode
   *   3. nothing held → fetch T's plan fresh (whole chunk if not layered)
   */
  private async runUpgrades(indices: number[]): Promise<void> {
    const url = this.url
    const signal = this.abortController?.signal
    const pool = this.workerPool
    const cache = this.cache
    const header = this.header
    const inFlight = this.upgradesInFlight
    if (!signal || !pool || !header) {
      for (const i of indices) inFlight.delete(i)
      return
    }

    const done = (idx: number) => { inFlight.delete(idx); this.upgradeRecheck.add(idx) }
    const submit = (idx: number, chunk: ChunkTableEntry, bytes: ArrayBuffer, presentBits: number) => {
      if (!this.decode(pool, idx, chunk, bytes, presentBits, true)) done(idx)
    }

    try {
      const target = this.demands.fetchBits()
      const recordLength = header.pointDataRecordLength
      const jobs: FetchJob[] = []

      for (const idx of indices) {
        const chunk = this.chunks[idx]
        if (!chunk) { inFlight.delete(idx); continue }
        const plan = this.planChunk(idx, chunk, target)

        const cached = await this.findCached(cache, url, idx, chunk, plan)
        if (signal.aborted) return
        if (cached) { submit(idx, chunk, cached.bytes, cached.presentBits); continue }

        const base = plan.kind === 'selective' ? await this.findTopUpBase(cache, url, idx, chunk) : null
        if (signal.aborted) return
        if (base && plan.kind === 'selective') {
          const haveKeep = this.keepFor(base.presentBits, plan.table)
          const wantKeep = plan.keep.map((k, i) => k || haveKeep[i])
          const missingKeep = wantKeep.map((k, i) => k && !haveKeep[i])
          const relMissing = plannedRanges(plan.table.sizes, this.layerNameList, recordLength, missingKeep,
            { includePrefix: false })
          const presentBits = fieldBitsForLayers(wantKeep, this.layerNameList) & this.formatBits
          // Base already covers the plan (zero-size layers) — decode a copy; the
          // CompactStore entry must not be detached by the transfer.
          if (relMissing.length === 0) { submit(idx, chunk, base.bytes.slice(0), base.presentBits); continue }
          jobs.push({
            chunkIndex: idx, chunk,
            ranges: relMissing.map(r => ({ start: chunk.offset + r.start, end: chunk.offset + r.end })),
            selective: true,
            skippedBytes: chunk.compressedSize - rangeBytes(relMissing),
            onBytes: (pieces) => {
              const bytes = mergeCompact(base.bytes, haveKeep, pieces, relMissing,
                plan.table.sizes, this.layerNameList, recordLength, wantKeep)
              this.storeCompact(url, cache, idx, chunk, bytes, presentBits)
              submit(idx, chunk, bytes, presentBits)
            },
            onFail: () => inFlight.delete(idx),
          })
          continue
        }

        jobs.push({
          chunkIndex: idx, chunk,
          ranges: plan.ranges,
          selective: plan.kind === 'selective',
          skippedBytes: plan.kind === 'selective' ? chunk.compressedSize - rangeBytes(plan.ranges) : 0,
          onBytes: (pieces) => {
            submit(idx, chunk, this.assemble(url, cache, idx, chunk, plan, pieces), plan.presentBits)
          },
          onFail: () => inFlight.delete(idx),
        })
      }

      if (jobs.length > 0) await this.fetchJobs(jobs, url, signal)
    } catch (err) {
      if (!isAbortError(err)) console.warn('[lazstream] upgrade error:', err)
      for (const i of indices) {
        if (!(this.workerPool?.isPending(i) ?? false)) inFlight.delete(i)
      }
    }
  }

  /** Any compact chunk held for this index, to splice missing layers into.
   *  CompactStore first, then IDB variants of masks used this load
   *  (largest first — fewest layers left to fetch). */
  private async findTopUpBase(
    cache: ChunkCache | null, url: string, chunkIndex: number, chunk: ChunkTableEntry,
  ): Promise<{ bytes: ArrayBuffer; presentBits: number } | null> {
    const mem = this.compactStore.get(chunkIndex)
    if (mem) return { bytes: mem.bytes, presentBits: mem.presentBits }
    if (!cache) return null
    const masks = [...this.masksUsed].sort((a, b) => popcount(b) - popcount(a))
    for (const m of masks) {
      const key = makeCacheKey(url, chunkIndex, chunk.offset, compactVariant(m))
      if (!(await cache.has(key))) continue
      const bytes = await cache.get(key)
      if (bytes) return { bytes, presentBits: m }
    }
    return null
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
    this.prioritiser = new ChunkPrioritiser(
      this.spatial,
      this.sseThreshold,
      this.chunkOrdering,
      { seeds: seedXYZ, fileBBox },
    )
  }

  private handleChunkDecoded(chunk: DecodedChunk): void {
    const idx = chunk.chunkIndex
    const bits = this.dispatchedMask.get(idx)
      ?? { present: this.formatBits, surface: 0 }
    this.dispatchedMask.delete(idx)

    if (chunk.isUpgrade) {
      this.upgradesInFlight.delete(idx)
      if (this.decodedMask.has(idx)) {
        // Re-emission of a chunk consumers already have: no counters, no
        // spatial/prioritiser changes, no 'ready' — only the new fields.
        this.decodedMask.set(idx, bits)
        this.events.onChunkDecoded?.(chunk)
        this.recheckUpgrade(idx)
        return
      }
      // Evicted while upgrading — the renderer needs it again: emit as a
      // normal decode (the dispatch filter skipped it while in flight).
      chunk.isUpgrade = undefined
    }
    this.decodedMask.set(idx, bits)

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
    this.recheckUpgrade(idx)

    this.events.onProgress?.(
      this.decodedChunkCount,
      this.chunks.length,
      'decode'
    )

    if (this.decodedChunkCount >= this.chunks.length) {
      this.emit('ready', 'Ready')
    }
  }

  private recheckUpgrade(chunkIndex: number): void {
    if (!this.upgradeRecheck.delete(chunkIndex)) return
    this.queueUpgrade(chunkIndex)
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
      bytesFetched: this.bytesFetched,
      bytesSkipped: this.bytesSkipped,
    })
  }
}

function rangeBytes(ranges: ByteRange[]): number {
  let n = 0
  for (const r of ranges) n += r.end - r.start
  return n
}

// ─── Module-local utility ────────────────────────────────────────────────────

function computeIntensitySeedRange(seeds: SeedPoint[]): { lo: number; hi: number } {
  if (seeds.length === 0) return { lo: 0, hi: 65535 }
  const sorted = seeds.map(s => s.intensity).sort((a, b) => a - b)
  const N  = sorted.length
  const lo = sorted[Math.floor(0.01 * N)] ?? 0
  const hi = sorted[Math.floor(0.99 * N)] ?? 65535
  return { lo, hi: hi <= lo ? lo + 1 : hi }
}