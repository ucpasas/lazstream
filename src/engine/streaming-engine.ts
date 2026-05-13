/**
 * Streaming Engine — Phase 2
 *
 * Extends the Phase 1 pipeline with:
 *   - Worker pool for parallel chunk decode
 *   - Camera-driven chunk prioritisation
 *   - Progressive detail as chunks decode
 *
 * Pipeline flow:
 *   Phase 1 (unchanged):
 *     URL → probe → header → chunk table → seed points → seed render
 *   Phase 2 (new):
 *     seed points → prioritiser → worker pool → decoded chunks → renderer
 */

import type { LasHeader, LazVlr, ChunkTableEntry, SeedPoint } from '../types/las.js'
import { classifyLazVersion, getLazVersionWarning } from '../types/las.js'
import { validateSourceUrl } from '../network/url-validator.js'
import { probeUrl } from '../network/range-fetcher.js'
import { fetchAndParseLasHeader, ParseError } from './header-parser.js'
import { fetchChunkTable, fetchSeedPoints } from './chunk-table.js'
import { WorkerPool } from '../decode/worker-pool.js'
import type { DecodedChunk } from '../decode/worker-pool.js'
import { ChunkPrioritiser } from '../decode/chunk-priority.js'

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

// ─── Engine ──────────────────────────────────────────────────────────────────

export class StreamingEngine {
  private events: EngineEvents
  private workerPool: WorkerPool | null = null
  private prioritiser: ChunkPrioritiser | null = null
  private chunks: ChunkTableEntry[] = []
  private header: LasHeader | null = null
  private lazVlr: LazVlr | null = null
  private url = ''
  private decodedPointCount = 0
  private decodedChunkCount = 0
  private fileSize = 0

  // Cap at 4 workers — matches the WorkerPool cap
  // More than 4 gives diminishing returns on HTTP/1.1 (R2 connection limit)
  private workerCount: number

  private maxQueuedChunks = 16

  constructor(events: EngineEvents = {}, workerCount?: number) {
    this.events = events
    // Cap explicitly here so the value passed to WorkerPool is already capped
    this.workerCount = workerCount ?? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
    console.debug('[lazstream] StreamingEngine: workerCount =', this.workerCount)
  }

  async load(rawUrl: string): Promise<void> {
    try {
      // ── Phase 1 pipeline ─────────────────────────────────────────────────

      this.emit('probing', 'Validating URL...')
      const url = validateSourceUrl(rawUrl)
      this.url = url.toString()

      this.emit('probing', 'Checking file accessibility...')
      const { fileSize, supportsRange } = await probeUrl(this.url)
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
      const { header, lazVlr } = await fetchAndParseLasHeader(this.url)
      this.header = header
      this.lazVlr = lazVlr

      const lazVersion = classifyLazVersion(header, lazVlr)
      const warning = getLazVersionWarning(lazVersion)
      if (warning) this.events.onWarning?.(warning)
      if (lazVersion === 'unsupported') {
        throw new ParseError('This file cannot be displayed.')
      }

      this.emitStats()

      this.emit('chunk-table', 'Reading chunk index...')
      this.chunks = await fetchChunkTable(this.url, header, lazVlr, fileSize)
      this.emitStats()

      this.emit('seeds', `Fetching ${this.chunks.length} chunk seed points...`)
      const seeds = await fetchSeedPoints(
        this.url, this.chunks, header, lazVlr,
        (loaded, total) => this.events.onProgress?.(loaded, total, 'seeds')
      )

      // Compute scene centre for coordinate system
      let sumX = 0, sumY = 0, sumZ = 0
      for (const s of seeds) { sumX += s.x; sumY += s.y; sumZ += s.z }
      const cx = sumX / seeds.length
      const cy = sumY / seeds.length
      const cz = sumZ / seeds.length

      this.events.onSeedsReady?.(seeds, header)

      // ── Phase 2: Worker pool + prioritised decode ─────────────────────────

      this.emit('workers-init', `Starting ${this.workerCount} decode workers...`)

      this.prioritiser = new ChunkPrioritiser(seeds, this.chunks, cx, cy, cz)

      this.workerPool = new WorkerPool({
        onChunkDecoded: (chunk) => this.handleChunkDecoded(chunk),
        onWorkerError: (chunkIndex, message) => {
          console.warn(`[lazstream] chunk ${chunkIndex} decode failed: ${message}`)
        },
        onReady: () => {
          console.debug('[lazstream] worker pool ready')
        },
      }, this.workerCount)  // ← already capped — passes through to WorkerPool

      await this.workerPool.init()
      this.workerPool.configure(this.url, header, lazVlr)

      this.emit('streaming', `Streaming — ${this.workerCount} workers active`)

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.events.onStateChange?.('error', error.message)
      this.events.onError?.(error)
    }
  }

  /**
   * Update the decode queue based on current camera position.
   * Call every frame from the render loop.
   */
  updateCamera(cameraWorldX: number, cameraWorldY: number, cameraWorldZ: number): void {
    if (!this.prioritiser || !this.workerPool) return

    const completed = new Set<number>()
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.workerPool.isDecoded(i)) completed.add(i)
    }

    const ranked = this.prioritiser.prioritise(
      cameraWorldX,
      cameraWorldY,
      cameraWorldZ,
      this.maxQueuedChunks,
      completed
    )

    for (const item of ranked) {
      this.workerPool.requestDecode(item.chunkIndex, item.chunk)
    }
  }

  /**
   * Decode ALL chunks regardless of camera position.
   */
  decodeAll(): void {
    if (!this.workerPool || !this.header) return
    for (let i = 0; i < this.chunks.length; i++) {
      this.workerPool.requestDecode(i, this.chunks[i])
    }
  }

  getSceneCenter(): { x: number; y: number; z: number } | null {
    return this.prioritiser?.getSceneCenter() ?? null
  }

  dispose(): void {
    this.workerPool?.dispose()
    this.workerPool = null
    this.prioritiser = null
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private handleChunkDecoded(chunk: DecodedChunk): void {
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