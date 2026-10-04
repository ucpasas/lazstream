/**
 * Worker Pool Manager
 *
 * Spawns N module workers. Vite dev mode always produces module workers
 * regardless of worker.format config — this is correct and intentional.
 *
 * laz-perf is loaded inside the worker via dynamic import() of the
 * patched laz-perf-worker.js (patched to be a valid ES module).
 *
 * Both the JS URL and WASM URL are passed to the worker via the init
 * message so it can load laz-perf and tell it where to find the WASM.
 *
 * Phase 3 Track A — Step 3 (Option B fetch model):
 *   The pool no longer fetches. The engine fetches compressed bytes on
 *   the main thread and hands them to requestDecode(chunkIndex, chunk,
 *   compressedBytes). The pool transfers the bytes to a worker (or
 *   queues if all workers are busy). configure() no longer takes a URL —
 *   the pool has no use for it.
 *
 *   isKnown(chunkIndex) is new: returns true if a chunk is in any of
 *   completed / inFlight / queue. The engine uses this to avoid both
 *   re-fetching and re-queuing chunks already known to the pool —
 *   isInFlight() alone misses the queue.
 */

import type { LasHeader, LazVlr, ChunkTableEntry, PointAttributes } from '../types/las.js'
import { fromBits, type LasField } from './fields.js'

/**
 * Override URLs for lazstream's bundled worker and WASM assets.
 * Leave unset for standard setups — defaults resolve relative to this module
 * via import.meta.url, which works correctly when all dist files are co-located.
 * Provide overrides when hosting assets at a CDN prefix or non-standard path
 * (e.g. the viewer dev server where laz-perf lives in /lib/ not next to the worker).
 */
export interface LazstreamAssetUrls {
  /** URL of decode-worker.js. Defaults to './decode-worker.js' relative to this module. */
  workerUrl?: URL | string
  /** URL of laz-perf-worker.js. Defaults to './laz-perf-worker.js' relative to this module. */
  lazPerfJsUrl?: URL | string
  /** URL of laz-perf-worker.wasm. Defaults to './laz-perf-worker.wasm' relative to this module. */
  lazPerfWasmUrl?: URL | string
}

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Raw LAS attributes surfaced on demand (see StreamingEngine.demandFields with
 * `surface: true`). Each array has one entry per point, in decode order.
 * Only fields that were both demanded for surfacing AND present in the bytes
 * the chunk was decoded from appear here.
 */
export interface ChunkAttributes {
  /** Raw uint16 intensity (intensity8 stays the seed-stretched copy). */
  intensityRaw?: Uint16Array
  returnNumber?: Uint8Array
  numberOfReturns?: Uint8Array
  /**
   * Raw flag bits; layout per flagsLayout. Bits 0–2 and 6–7 mean the same in
   * both layouts: b0 synthetic, b1 key-point, b2 withheld, b6 scan direction,
   * b7 edge of flight line. 'extended' (PDRF 6–10) adds b3 overlap and
   * b4–5 scanner channel; in 'legacy' (PDRF 0–5) those bits are 0.
   */
  flags?: Uint8Array
  flagsLayout?: 'legacy' | 'extended'
  /** Degrees, normalised across families (PDRF 6–10 int16 × 0.006; PDRF 0–5 int8 rank). */
  scanAngle?: Float32Array
  userData?: Uint8Array
  pointSourceId?: Uint16Array
  gpsTime?: Float64Array
  nir?: Uint16Array
  /** Per-point extra bytes, `stride` bytes each, packed. */
  extraBytes?: { stride: number; data: Uint8Array }
}

export interface DecodedChunk {
  chunkIndex: number
  positions: Int16Array
  colors: Uint8Array
  /** Per-point classification byte. Present for all PDRFs. */
  classification?: Uint8Array
  /** Per-point intensity, seed-range-stretched to [0,255]. Present for all PDRFs. */
  intensity8?: Uint8Array
  pointCount: number
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
  decodeMs: number
  /**
   * Fields with VALID data in this chunk. A field outside this set decoded
   * as a plausible constant (its compressed layer was not fetched) — never
   * read it. Chunks decoded under different masks coexist in one session.
   * Absent only for chunks from a pool driven without an engine.
   */
  fieldsPresent?: ReadonlySet<LasField>
  /** Raw attributes demanded with `surface: true` (subset of fieldsPresent). */
  attributes?: ChunkAttributes
  /** True for an upgradeChunks() re-emission of a chunk already emitted.
   *  Renderers should ignore these; attribute consumers should take them. */
  isUpgrade?: boolean
}

/** Per-request decode options. */
export interface DecodeRequestOptions {
  /** Field bits to surface into DecodedChunk.attributes. Default 0 (none). */
  surfaceBits?: number
  /** Field bits actually valid in these bytes → DecodedChunk.fieldsPresent. */
  presentBits?: number
  /** Re-decode of an already-decoded chunk (P3 upgrade). Bypasses the
   *  completed-set dedup and queues behind all normal decodes. */
  upgrade?: boolean
}

export interface WorkerPoolEvents {
  onChunkDecoded?: (chunk: DecodedChunk) => void
  onWorkerError?: (chunkIndex: number, message: string) => void
  onReady?: () => void
}

interface PendingRequest {
  chunkIndex: number
  chunk: ChunkTableEntry
  compressedBytes: ArrayBuffer    // Held until a worker is free; transferred on dispatch
  opts: DecodeRequestOptions
}

interface PendingAttrRequest {
  seqId: number
  compressedBytes: ArrayBuffer
  pointIndex: number
  resolve: (attrs: PointAttributes) => void
  reject: (err: Error) => void
}

interface WorkerState {
  worker: Worker
  busy: boolean
  currentChunkIndex: number | null
  currentAttrSeqId: number | null  // non-null when busy with a decode-attrs request
  currentOpts: DecodeRequestOptions | null  // options of the in-flight chunk decode
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

export class WorkerPool {
  private workers: WorkerState[] = []
  private queue: PendingRequest[] = []
  private events: WorkerPoolEvents
  private header: LasHeader | null = null
  private lazVlr: LazVlr | null = null
  private intensitySeedRange: { lo: number; hi: number } | null = null
  private readyCount = 0
  private targetCount: number
  private disposed = false
  private assetUrls: LazstreamAssetUrls | undefined

  private inFlight = new Set<number>()
  private completed = new Set<number>()

  /** P3 upgrade re-decodes: separate from queue/inFlight so they never count
   *  as ring-buffer-bound work and always run after normal decodes. */
  private upgradeQueue: PendingRequest[] = []
  private upgradeInFlight = new Set<number>()

  private pendingAttrs = new Map<number, { resolve: (v: PointAttributes) => void; reject: (e: Error) => void }>()
  private attrQueue: PendingAttrRequest[] = []
  private attrSeq = 0

  constructor(events: WorkerPoolEvents = {}, workerCount?: number, assetUrls?: LazstreamAssetUrls) {
    this.events = events
    this.assetUrls = assetUrls
    // Workers are pure CPU/WASM consumers (Option B fetch model — main thread fetches).
    // Defaults to hardwareConcurrency - 1, capped at 100.
    // Fetch concurrency is controlled independently by StreamingEngine.maxFetches.
    this.targetCount = workerCount ?? Math.min(100, Math.max(1, navigator.hardwareConcurrency - 1))
    console.debug('[lazstream] WorkerPool: targeting', this.targetCount, 'workers', {
      hardwareConcurrency: navigator.hardwareConcurrency,
      explicitCount: workerCount,
    })
  }

  async init(): Promise<void> {
    // Portable worker URL — works in both npm package (co-located dist/) and
    // Vite dev (when assetUrls.workerUrl is provided by the viewer).
    const workerUrl = this.assetUrls?.workerUrl
      // @vite-ignore: runtime URL — both files land in dist/ when installed from npm.
      // Viewer always overrides via assetUrls.workerUrl (see main.ts).
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      ?? new URL(/* @vite-ignore */ './decode-worker.js', import.meta.url)

    const lazPerfUrl = (this.assetUrls?.lazPerfJsUrl
      ?? new URL('./laz-perf-worker.js', import.meta.url)).toString()
    const lazPerfWasmUrl = (this.assetUrls?.lazPerfWasmUrl
      ?? new URL('./laz-perf-worker.wasm', import.meta.url)).toString()

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(
          `Worker pool init timed out — only ${this.readyCount}/${this.targetCount} workers ready`
        ))
      }, 15_000)

      for (let i = 0; i < this.targetCount; i++) {
        const worker = new Worker(workerUrl, { type: 'module' })

        const state: WorkerState = {
          worker,
          busy: false,
          currentChunkIndex: null,
          currentAttrSeqId: null,
          currentOpts: null,
        }

        // Set up handler BEFORE posting init message
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data

          if (msg.type === 'ready') {
            this.readyCount++
            console.debug(`[lazstream] worker ${i} ready (${this.readyCount}/${this.targetCount})`)
            if (this.readyCount === this.targetCount) {
              clearTimeout(timeout)
              console.debug(`[lazstream] all ${this.targetCount} workers ready`)
              this.events.onReady?.()
              resolve()
            }
            return
          }

          if (msg.type === 'decoded') {
            this.handleDecoded(state, msg)
            return
          }

          if (msg.type === 'error') {
            this.handleError(state, msg)
            return
          }

          if (msg.type === 'point-attrs') {
            this.handlePointAttrs(state, msg)
            return
          }

          if (msg.type === 'point-attrs-error') {
            this.handlePointAttrsError(state, msg)
            return
          }
        }

        worker.onerror = (err: ErrorEvent) => {
          console.error(`[lazstream] worker ${i} uncaught error:`, {
            message: err.message,
            filename: err.filename,
            lineno: err.lineno,
          })
          // Clean up in-flight tracking. Do NOT call dispatchNext — if this
          // fired from a WASM abort (e.g. unsupported layered LAZ format), the
          // WASM module is in an indeterminate state and sending another decode
          // request would trigger a crash loop. The worker sits idle; the engine
          // back-pressure and deferred queue drain work around the lost capacity.
          if (state.currentAttrSeqId !== null) {
            const pending = this.pendingAttrs.get(state.currentAttrSeqId)
            if (pending) {
              this.pendingAttrs.delete(state.currentAttrSeqId)
              pending.reject(new Error(err.message ?? 'uncaught worker error during attr decode'))
            }
            state.currentAttrSeqId = null
          } else if (state.currentChunkIndex !== null) {
            if (state.currentOpts?.upgrade) this.upgradeInFlight.delete(state.currentChunkIndex)
            else this.inFlight.delete(state.currentChunkIndex)
            this.events.onWorkerError?.(state.currentChunkIndex, err.message ?? 'uncaught worker error')
          }
          state.busy = false
          state.currentChunkIndex = null
          state.currentOpts = null
        }

        this.workers.push(state)

        // Send init after handler is set up
        worker.postMessage({
          type: 'init',
          lazPerfUrl,
          lazPerfWasmUrl,
        })
      }
    })
  }

  /**
   * Configure the pool with per-file metadata.
   *
   * Track A Step 3: URL no longer required — the pool doesn't fetch.
   * Header gives PDRF, scale, offset, global Z range. LAZ VLR is held
   * for parity with future selective-decode paths (PDRF 6+ layered).
   * intensitySeedRange is the p1/p99 uint16 range from seed-point intensities,
   * used to stretch decoded intensity values into [0,255] before packing.
   */
  configure(header: LasHeader, lazVlr: LazVlr, intensitySeedRange?: { lo: number; hi: number }): void {
    this.header = header
    this.lazVlr = lazVlr
    this.intensitySeedRange = intensitySeedRange ?? null
    console.debug('[lazstream] WorkerPool configured:', {
      pdrf: header.pointDataRecordFormat,
      intensitySeedRange: intensitySeedRange ?? '(none)',
    })
  }

  /**
   * Hand compressed bytes for one chunk to the pool. The bytes are
   * transferred (not copied) to a worker — after this call, the
   * compressedBytes ArrayBuffer is detached on the caller's side.
   *
   * Dedup: silently no-ops if the chunk is already completed or in
   * flight (we don't re-queue). The engine's startFetch should already
   * have filtered these via isKnown() before fetching, so this is a
   * defensive net.
   *
   * `opts.upgrade` re-decodes an already-completed chunk (P3): it skips the
   * completed check, but still no-ops if the chunk is pending anywhere.
   *
   * Returns false when the request was dropped by dedup (bytes discarded).
   */
  requestDecode(
    chunkIndex: number,
    chunk: ChunkTableEntry,
    compressedBytes: ArrayBuffer,
    opts: DecodeRequestOptions = {},
  ): boolean {
    if (this.disposed) return false

    if (opts.upgrade) {
      if (this.isPending(chunkIndex)) return false
      const idle = this.queue.length === 0 ? this.workers.find(w => !w.busy) : undefined
      if (idle) this.dispatch(idle, chunkIndex, chunk, compressedBytes, opts)
      else this.upgradeQueue.push({ chunkIndex, chunk, compressedBytes, opts })
      return true
    }

    if (this.completed.has(chunkIndex) || this.inFlight.has(chunkIndex)) return false

    const idle = this.workers.find(w => !w.busy)
    if (idle) {
      this.dispatch(idle, chunkIndex, chunk, compressedBytes, opts)
    } else {
      if (this.queue.some(q => q.chunkIndex === chunkIndex)) return false
      this.queue.push({ chunkIndex, chunk, compressedBytes, opts })
    }
    return true
  }

  /**
   * True if the pool already has this chunk anywhere in its pipeline —
   * completed, in flight, or queued. The engine checks this before
   * fetching to avoid wasted network I/O. (Phase 3 Track A — Step 3.)
   */
  isKnown(chunkIndex: number): boolean {
    if (this.completed.has(chunkIndex)) return true
    return this.isPending(chunkIndex)
  }

  /** True if a decode (normal or upgrade) for this chunk is queued or running. */
  isPending(chunkIndex: number): boolean {
    if (this.inFlight.has(chunkIndex) || this.upgradeInFlight.has(chunkIndex)) return true
    return this.queue.some(q => q.chunkIndex === chunkIndex)
      || this.upgradeQueue.some(q => q.chunkIndex === chunkIndex)
  }

  /** Remove a chunk from the completed set so it can be re-decoded after
   *  proactive GPU eviction. Paired with ChunkPrioritiser.removeDecoded(). */
  markEvicted(chunkIndex: number): void { this.completed.delete(chunkIndex) }
  get activeCount(): number { return this.inFlight.size }
  get queueLength(): number { return this.queue.length }

  /**
   * Dispatch a decode-attrs request to an idle worker, or queue it if all are busy.
   * Returns a Promise that resolves with the decoded PointAttributes.
   * The compressedBytes buffer is transferred to the worker (detached on return).
   */
  requestPointAttributes(
    compressedBytes: ArrayBuffer,
    pointIndex: number,
  ): Promise<PointAttributes> {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new Error('WorkerPool disposed')); return }
      if (!this.header)  { reject(new Error('WorkerPool not configured')); return }

      const seqId = ++this.attrSeq
      this.pendingAttrs.set(seqId, { resolve, reject })

      const idle = this.workers.find(w => !w.busy)
      if (idle) {
        this.dispatchAttr(idle, seqId, compressedBytes, pointIndex)
      } else {
        this.attrQueue.push({ seqId, compressedBytes, pointIndex, resolve, reject })
      }
    })
  }

  dispose(): void {
    this.disposed = true
    this.queue = []
    this.attrQueue = []
    this.upgradeQueue = []
    this.inFlight.clear()
    this.upgradeInFlight.clear()
    for (const { reject } of this.pendingAttrs.values()) {
      reject(new Error('WorkerPool disposed'))
    }
    this.pendingAttrs.clear()
    for (const state of this.workers) state.worker.terminate()
    this.workers = []
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private dispatch(
    workerState: WorkerState,
    chunkIndex: number,
    chunk: ChunkTableEntry,
    compressedBytes: ArrayBuffer,
    opts: DecodeRequestOptions,
  ): void {
    if (!this.header || !this.lazVlr) {
      console.error('[lazstream] dispatch called before configure() — skipping')
      return
    }

    workerState.busy = true
    workerState.currentChunkIndex = chunkIndex
    workerState.currentOpts = opts
    if (opts.upgrade) this.upgradeInFlight.add(chunkIndex)
    else this.inFlight.add(chunkIndex)

    // Transfer the compressed bytes (not copy) — after postMessage the
    // ArrayBuffer is detached on this side. Track A Step 3 fetch model.
    workerState.worker.postMessage({
      type: 'decode',
      chunkIndex,
      compressedBytes,
      pointCount: chunk.pointCount,
      pointDataRecordFormat: this.header.pointDataRecordFormat,
      pointDataRecordLength: this.header.pointDataRecordLength,
      scaleX: this.header.scaleX,
      scaleY: this.header.scaleY,
      scaleZ: this.header.scaleZ,
      offsetX: this.header.offsetX,
      offsetY: this.header.offsetY,
      offsetZ: this.header.offsetZ,
      globalMinZ: this.header.minZ,
      globalMaxZ: this.header.maxZ,
      seedLo: this.intensitySeedRange?.lo ?? 0,
      seedHi: this.intensitySeedRange?.hi ?? 65535,
      surfaceBits: opts.surfaceBits ?? 0,
    }, [compressedBytes])
  }

  private handleDecoded(workerState: WorkerState, msg: any): void {
    const chunkIndex = msg.chunkIndex as number
    const opts = workerState.currentOpts ?? {}
    workerState.busy = false
    workerState.currentChunkIndex = null
    workerState.currentOpts = null
    if (opts.upgrade) this.upgradeInFlight.delete(chunkIndex)
    else this.inFlight.delete(chunkIndex)
    this.completed.add(chunkIndex)

    const decoded: DecodedChunk = {
      chunkIndex,
      positions: msg.positions,
      colors: msg.colors,
      classification: msg.classification,
      intensity8: msg.intensity8,
      pointCount: msg.pointCount,
      minX: msg.minX, minY: msg.minY, minZ: msg.minZ,
      maxX: msg.maxX, maxY: msg.maxY, maxZ: msg.maxZ,
      decodeMs: msg.decodeMs ?? 0,
    }
    if (opts.presentBits !== undefined) decoded.fieldsPresent = fromBits(opts.presentBits)
    if (msg.attributes) decoded.attributes = msg.attributes as ChunkAttributes
    if (opts.upgrade) decoded.isUpgrade = true
    this.events.onChunkDecoded?.(decoded)

    this.dispatchNext(workerState)
  }

  private handleError(workerState: WorkerState, msg: any): void {
    const chunkIndex = msg.chunkIndex as number
    if (workerState.currentOpts?.upgrade) this.upgradeInFlight.delete(chunkIndex)
    else this.inFlight.delete(chunkIndex)
    workerState.busy = false
    workerState.currentChunkIndex = null
    workerState.currentOpts = null

    console.warn(`[lazstream] decode error chunk ${chunkIndex}: ${msg.message}`)
    this.events.onWorkerError?.(chunkIndex, msg.message)

    this.dispatchNext(workerState)
  }

  private dispatchNext(workerState: WorkerState): void {
    if (this.disposed) return
    // Drain attr requests first — they're rare, user-facing, and should not wait behind a full decode queue
    if (this.attrQueue.length > 0) {
      const next = this.attrQueue.shift()!
      this.dispatchAttr(workerState, next.seqId, next.compressedBytes, next.pointIndex)
      return
    }
    if (!this.header || !this.lazVlr) return
    // Normal decodes before upgrades — upgrades never delay visible chunks.
    const next = this.queue.shift() ?? this.upgradeQueue.shift()
    if (!next) return
    this.dispatch(workerState, next.chunkIndex, next.chunk, next.compressedBytes, next.opts)
  }

  private dispatchAttr(
    workerState: WorkerState,
    seqId: number,
    compressedBytes: ArrayBuffer,
    pointIndex: number,
  ): void {
    if (!this.header) return
    workerState.busy = true
    workerState.currentChunkIndex = null
    workerState.currentOpts = null
    workerState.currentAttrSeqId = seqId

    workerState.worker.postMessage({
      type: 'decode-attrs',
      seqId,
      compressedBytes,
      pointIndex,
      pointDataRecordFormat: this.header.pointDataRecordFormat,
      pointDataRecordLength: this.header.pointDataRecordLength,
      scaleX: this.header.scaleX,
      scaleY: this.header.scaleY,
      scaleZ: this.header.scaleZ,
      offsetX: this.header.offsetX,
      offsetY: this.header.offsetY,
      offsetZ: this.header.offsetZ,
    }, [compressedBytes])
  }

  private handlePointAttrs(workerState: WorkerState, msg: any): void {
    const seqId = msg.seqId as number
    workerState.busy = false
    workerState.currentAttrSeqId = null

    const pending = this.pendingAttrs.get(seqId)
    if (pending) {
      this.pendingAttrs.delete(seqId)
      pending.resolve({
        x: msg.x, y: msg.y, z: msg.z,
        intensity: msg.intensity,
        classification: msg.classification,
        returnNumber: msg.returnNumber,
        numberOfReturns: msg.numberOfReturns,
        gpsTime: msg.gpsTime,
        r: msg.r, g: msg.g, b: msg.b,
      })
    }

    this.dispatchNext(workerState)
  }

  private handlePointAttrsError(workerState: WorkerState, msg: any): void {
    const seqId = msg.seqId as number
    workerState.busy = false
    workerState.currentAttrSeqId = null

    const pending = this.pendingAttrs.get(seqId)
    if (pending) {
      this.pendingAttrs.delete(seqId)
      pending.reject(new Error(msg.message))
    }

    this.dispatchNext(workerState)
  }
}