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
 */

import type { LasHeader, LazVlr, ChunkTableEntry } from '../types/las.js'

// Vite ?worker — module worker, bundled as ESM (correct for Vite dev)
import DecodeWorkerFactory from '../workers/decode-worker.ts?worker'

// Vite ?url — resolves to served path of the static files in public/
const lazPerfWorkerUrl = `${window.location.origin}/lib/laz-perf-worker.js`
const lazPerfWasmUrl = `${window.location.origin}/lib/laz-perf-worker.wasm`
// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecodedChunk {
  chunkIndex: number
  positions: Int16Array
  colors: Uint8Array
  pointCount: number
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}

export interface WorkerPoolEvents {
  onChunkDecoded?: (chunk: DecodedChunk) => void
  onWorkerError?: (chunkIndex: number, message: string) => void
  onReady?: () => void
}

interface PendingRequest {
  chunkIndex: number
  chunk: ChunkTableEntry
}

interface WorkerState {
  worker: Worker
  busy: boolean
  currentChunkIndex: number | null
}

// ─── Worker Pool ─────────────────────────────────────────────────────────────

export class WorkerPool {
  private workers: WorkerState[] = []
  private queue: PendingRequest[] = []
  private events: WorkerPoolEvents
  private url = ''
  private header: LasHeader | null = null
  private lazVlr: LazVlr | null = null
  private readyCount = 0
  private targetCount: number
  private disposed = false

  private inFlight = new Set<number>()
  private completed = new Set<number>()

  constructor(events: WorkerPoolEvents = {}, workerCount?: number) {
    this.events = events
    // Cap at 4 — HTTP/1.1 to R2 saturates at ~6 connections per origin
    this.targetCount = workerCount ?? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    console.debug('[lazstream] WorkerPool: targeting', this.targetCount, 'workers', {
      hardwareConcurrency: navigator.hardwareConcurrency,
      explicitCount: workerCount,
    })
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(
          `Worker pool init timed out — only ${this.readyCount}/${this.targetCount} workers ready`
        ))
      }, 15_000)

      for (let i = 0; i < this.targetCount; i++) {
        // Module worker — correct for Vite dev mode
        const worker = new DecodeWorkerFactory()

        const state: WorkerState = {
          worker,
          busy: false,
          currentChunkIndex: null,
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
        }

        worker.onerror = (err) => {
          console.error(`[lazstream] worker ${i} uncaught error:`, {
            message: err.message,
            filename: err.filename,
            lineno: err.lineno,
          })
          state.busy = false
          state.currentChunkIndex = null
        }

        this.workers.push(state)

        // Send init after handler is set up
        worker.postMessage({
          type: 'init',
          lazPerfUrl: lazPerfWorkerUrl,   // JS — imported via dynamic import()
          lazPerfWasmUrl,                 // WASM — passed to locateFile()
        })
      }
    })
  }

  configure(url: string, header: LasHeader, lazVlr: LazVlr): void {
    this.url = url
    this.header = header
    this.lazVlr = lazVlr
    console.debug('[lazstream] WorkerPool configured:', {
      pdrf: header.pointDataRecordFormat,
    })
  }

  requestDecode(chunkIndex: number, chunk: ChunkTableEntry): void {
    if (this.disposed) return
    if (this.completed.has(chunkIndex) || this.inFlight.has(chunkIndex)) return

    const idle = this.workers.find(w => !w.busy)
    if (idle) {
      this.dispatch(idle, chunkIndex, chunk)
    } else {
      if (!this.queue.some(q => q.chunkIndex === chunkIndex)) {
        this.queue.push({ chunkIndex, chunk })
      }
    }
  }

  clearQueue(): void { this.queue = [] }
  isDecoded(chunkIndex: number): boolean { return this.completed.has(chunkIndex) }
  get activeCount(): number { return this.inFlight.size }
  get queueLength(): number { return this.queue.length }

  dispose(): void {
    this.disposed = true
    this.queue = []
    this.inFlight.clear()
    for (const state of this.workers) state.worker.terminate()
    this.workers = []
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private dispatch(workerState: WorkerState, chunkIndex: number, chunk: ChunkTableEntry): void {
    if (!this.header || !this.lazVlr) {
      console.error('[lazstream] dispatch called before configure() — skipping')
      return
    }

    workerState.busy = true
    workerState.currentChunkIndex = chunkIndex
    this.inFlight.add(chunkIndex)

    workerState.worker.postMessage({
      type: 'decode',
      chunkIndex,
      url: this.url,
      offset: chunk.offset,
      compressedSize: chunk.compressedSize,
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
    })
  }

  private handleDecoded(workerState: WorkerState, msg: any): void {
    const chunkIndex = msg.chunkIndex as number
    workerState.busy = false
    workerState.currentChunkIndex = null
    this.inFlight.delete(chunkIndex)
    this.completed.add(chunkIndex)

    this.events.onChunkDecoded?.({
      chunkIndex,
      positions: msg.positions,
      colors: msg.colors,
      pointCount: msg.pointCount,
      minX: msg.minX, minY: msg.minY, minZ: msg.minZ,
      maxX: msg.maxX, maxY: msg.maxY, maxZ: msg.maxZ,
    })

    this.dispatchNext(workerState)
  }

  private handleError(workerState: WorkerState, msg: any): void {
    const chunkIndex = msg.chunkIndex as number
    workerState.busy = false
    workerState.currentChunkIndex = null
    this.inFlight.delete(chunkIndex)

    console.warn(`[lazstream] decode error chunk ${chunkIndex}: ${msg.message}`)
    this.events.onWorkerError?.(chunkIndex, msg.message)

    this.dispatchNext(workerState)
  }

  private dispatchNext(workerState: WorkerState): void {
    if (this.disposed || this.queue.length === 0) return
    if (!this.url || !this.header || !this.lazVlr) return
    const next = this.queue.shift()!
    this.dispatch(workerState, next.chunkIndex, next.chunk)
  }
}