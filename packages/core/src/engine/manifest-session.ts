/**
 * ManifestSession — multi-tile streaming coordinator.
 *
 * Creates one StreamingEngine per tile in the manifest. Coordinates parallel
 * loading, aggregates seed points from all tiles into a single onSeedsReady
 * call, and globally namespaces chunk indices so the ring buffer never sees
 * collisions between tiles.
 *
 * Chunk index namespacing:
 *   tile 0: offset = 0,        range [0,     N0)
 *   tile 1: offset = N0,       range [N0,    N0+N1)
 *   tile 2: offset = N0+N1,    range [N0+N1, N0+N1+N2)
 *
 * Offsets are computed after all tile headers have been parsed (chunk counts
 * are known). The decode loop does not start until onSeedsReady fires from
 * the session, which only fires after all tiles have seeded — guaranteeing
 * offsets are stable before any chunk dispatch.
 *
 * Tile failure:
 *   A tile that fails to load fires onWarning and is skipped. The remaining
 *   tiles continue. If ALL tiles fail, onError fires.
 */

import { StreamingEngine } from './streaming-engine.js'
import type { EngineEvents, RingBufferProvider, StreamingEngineOptions } from './streaming-engine.js'
import type { Manifest } from './manifest-types.js'
import type { LasHeader, SeedPoint } from '../types/las.js'
import type { BBox3D } from '../types/spatial.js'
import type { CameraInfo } from '../decode/chunk-priority.js'
import type { DecodedChunk } from '../decode/worker-pool.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManifestSessionOptions extends Omit<StreamingEngineOptions, 'events'> {
  events: EngineEvents
}

// ─── Session ─────────────────────────────────────────────────────────────────

export class ManifestSession {
  private engines: StreamingEngine[] = []
  private offsets: number[] = []

  // Providers set before load() — forwarded to each engine after creation
  private cameraProvider: (() => CameraInfo) | null = null
  private frustumProvider: (() => BBox3D) | null = null
  private ringBufferProvider: RingBufferProvider | null = null

  constructor(
    private readonly manifest: Manifest,
    private readonly options: ManifestSessionOptions,
  ) {}

  /** Register camera position provider — forwarded to all tile engines. */
  setCameraProvider(provider: () => CameraInfo): void {
    this.cameraProvider = provider
    for (const e of this.engines) e.setCameraProvider(provider)
  }

  /** Register frustum provider — forwarded to all tile engines. */
  setFrustumProvider(provider: () => BBox3D): void {
    this.frustumProvider = provider
    for (const e of this.engines) e.setFrustumProvider(provider)
  }

  /** Register ring buffer stats provider — forwarded to all tile engines. */
  setRingBufferProvider(provider: RingBufferProvider): void {
    this.ringBufferProvider = provider
    for (const e of this.engines) e.setRingBufferProvider(provider)
  }

  /**
   * Called by the renderer when a chunk is evicted from the GPU ring buffer.
   * Routes to the correct tile engine after stripping the tile offset.
   */
  onChunkEvictedFromGPU(globalChunkIndex: number): void {
    const { engine, localIndex } = this.resolveGlobalIndex(globalChunkIndex)
    engine?.onChunkEvictedFromGPU(localIndex)
  }

  /** Tick all active tile engines — call every frame from the render loop. */
  updateCamera(): void {
    for (const e of this.engines) e.updateCamera()
  }

  /** Stop all engines and release all resources. */
  dispose(): void {
    for (const e of this.engines) e.dispose()
    this.engines = []
    this.offsets = []
  }

  /**
   * Begin loading all tiles in the manifest in parallel.
   *
   * Flow:
   *   1. All tile engines load concurrently (header → chunk table → seeds).
   *   2. As each tile seeds, its results are collected.
   *   3. Once ALL successful tiles have seeded, chunk index offsets are
   *      computed and the combined onSeedsReady fires to main.ts.
   *   4. Failed tiles emit onWarning and are skipped.
   *   5. If every tile fails, onError fires.
   */
  async load(): Promise<void> {
    const { tiles } = this.manifest
    const { events, workerCount, sseThreshold, maxFetches, cache, assetUrls } = this.options
    const tileCount = tiles.length

    // Distribute the total worker budget evenly across tiles.
    // A shared pool (Phase 3) would be more efficient; per-tile pools are simpler.
    const defaultWorkers = Math.min(100, Math.max(1, navigator.hardwareConcurrency - 1))
    const totalWorkers = workerCount ?? defaultWorkers
    const perTileWorkers = Math.max(1, Math.floor(totalWorkers / tileCount))

    // Per-tile seed + header collection
    const collectedSeeds   = new Array<SeedPoint[] | null>(tileCount).fill(null)
    const collectedHeaders = new Array<LasHeader | null>(tileCount).fill(null)
    let tilesSettled = 0
    let tilesSucceeded = 0

    // Shared aggregation state for multi-tile status/stats
    const agg: TileAgg = {
      streamingTiles: new Set(),
      readyTiles: new Set(),
      perTileStats: new Array(tileCount).fill(null),
    }

    const checkAllSettled = () => {
      if (tilesSettled < tileCount) return

      if (tilesSucceeded === 0) {
        events.onError?.(new Error('All manifest tiles failed to load.'))
        return
      }

      // Compute offsets now that all chunk counts are known.
      // (engines[i].chunkCount is available after header+chunk-table parse,
      //  which always completes before onSeedsReady fires.)
      let runningOffset = 0
      for (let i = 0; i < tileCount; i++) {
        this.offsets[i] = runningOffset
        runningOffset += this.engines[i]?.chunkCount ?? 0
      }

      // Combine seeds with global indices applied
      const allSeeds: SeedPoint[] = []
      const validHeaders: LasHeader[] = []
      for (let i = 0; i < tileCount; i++) {
        const seeds  = collectedSeeds[i]
        const header = collectedHeaders[i]
        if (!seeds || !header) continue
        const offset = this.offsets[i]
        for (const s of seeds) {
          allSeeds.push({ ...s, chunkIndex: s.chunkIndex + offset })
        }
        validHeaders.push(header)
      }

      const combinedHeader = mergeHeaders(validHeaders)
      events.onSeedsReady?.(allSeeds, combinedHeader)
    }

    // Create and start one engine per tile
    for (let i = 0; i < tileCount; i++) {
      const tileUrl = tiles[i].url
      const tileIndex = i

      const tileEvents = this.makeTileEvents(
        tileIndex, tileUrl, tileCount, events, agg,
        () => { tilesSucceeded++; tilesSettled++; checkAllSettled() },
        () => {                   tilesSettled++; checkAllSettled() },
        collectedSeeds, collectedHeaders,
      )

      const engine = new StreamingEngine({
        events: tileEvents,
        workerCount: perTileWorkers,
        cache,        // shared across tiles — keys include url, no collision
        sseThreshold,
        maxFetches,
        assetUrls,
      })

      // Register providers that were set before load()
      if (this.cameraProvider)   engine.setCameraProvider(this.cameraProvider)
      if (this.frustumProvider)  engine.setFrustumProvider(this.frustumProvider)
      if (this.ringBufferProvider) engine.setRingBufferProvider(this.ringBufferProvider)

      // Wire the eviction callback: renderer calls session.onChunkEvictedFromGPU
      // which routes here. We DON'T use setChunkEvictedCallback on each engine
      // because the renderer only knows the global chunk index.

      this.engines.push(engine)
      this.offsets.push(0)   // placeholder until checkAllSettled() computes real offsets
    }

    // Fire all tile loads concurrently — each returns after seeds
    await Promise.all(
      tiles.map((tile, i) => this.engines[i].load(tile.url))
    )
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /**
   * Build the EngineEvents for one tile. Intercepts onSeedsReady and
   * onChunkDecoded to apply the tile's offset.
   *
   * For single-tile manifests every event is forwarded unchanged.
   * For multi-tile manifests onStateChange and onStats are aggregated so the
   * consumer sees combined progress rather than per-tile noise:
   *   - 'streaming' fires once ("Streaming N tiles") when the first tile starts
   *   - 'ready'     fires once per tile with "X/N tiles done", then final 'ready'
   *   - onStats     merges all tiles' stats before forwarding
   */
  private makeTileEvents(
    tileIndex: number,
    tileUrl: string,
    tileCount: number,
    outer: EngineEvents,
    agg: TileAgg,
    onSeeded: () => void,
    onFailed: () => void,
    collectedSeeds: Array<SeedPoint[] | null>,
    collectedHeaders: Array<LasHeader | null>,
  ): EngineEvents {
    const multi = tileCount > 1

    return {
      onStateChange: (state, message) => {
        if (!multi) { outer.onStateChange?.(state, message); return }

        if (state === 'streaming') {
          const before = agg.streamingTiles.size
          agg.streamingTiles.add(tileIndex)
          if (agg.streamingTiles.size !== before) {
            outer.onStateChange?.('streaming', `Streaming ${agg.streamingTiles.size}/${tileCount} tiles`)
          }
          return
        }

        if (state === 'ready') {
          agg.readyTiles.add(tileIndex)
          const n = agg.readyTiles.size
          if (n === tileCount) {
            outer.onStateChange?.('ready', tileCount > 1 ? `${tileCount} tiles loaded` : 'Ready')
          } else {
            outer.onStateChange?.('streaming', `${n}/${tileCount} tiles ready`)
          }
          return
        }

        // Loading/seed/worker-init: only forward from the first tile to avoid noise
        if (tileIndex === 0) outer.onStateChange?.(state, message)
      },

      onWarning: outer.onWarning,

      onProgress: outer.onProgress,

      onStats: (stats) => {
        if (!multi) { outer.onStats?.(stats); return }

        // Store latest stats for this tile and forward the aggregate
        agg.perTileStats[tileIndex] = stats
        const combined = aggregateTileStats(agg.perTileStats)
        if (combined) outer.onStats?.(combined)
      },

      onSeedsReady: (seeds, header) => {
        collectedSeeds[tileIndex]   = seeds
        collectedHeaders[tileIndex] = header
        onSeeded()
        // Do NOT forward to outer.onSeedsReady here —
        // that fires once from checkAllSettled() with combined data.
      },

      onChunkDecoded: (chunk: DecodedChunk) => {
        // Offset is set by checkAllSettled() before any decode dispatches.
        const offset = this.offsets[tileIndex] ?? 0
        outer.onChunkDecoded?.({
          ...chunk,
          chunkIndex: chunk.chunkIndex + offset,
        })
      },

      onError: (err) => {
        // Tile failed — warn and skip rather than aborting the whole session
        outer.onWarning?.(
          `Tile ${tileIndex + 1} failed to load (${tileUrl}): ${err.message}`
        )
        onFailed()
      },
    }
  }

  /**
   * Given a global chunk index, find the engine and local index.
   * Iterates offsets in reverse to find the largest offset ≤ globalIndex.
   */
  private resolveGlobalIndex(globalIndex: number): { engine: StreamingEngine; localIndex: number } | { engine: null; localIndex: number } {
    for (let i = this.offsets.length - 1; i >= 0; i--) {
      if (globalIndex >= this.offsets[i]) {
        return { engine: this.engines[i], localIndex: globalIndex - this.offsets[i] }
      }
    }
    return { engine: null, localIndex: globalIndex }
  }
}

// ─── Multi-tile aggregation ───────────────────────────────────────────────────

type TileStats = NonNullable<Parameters<NonNullable<EngineEvents['onStats']>>[0]>

interface TileAgg {
  streamingTiles: Set<number>
  readyTiles: Set<number>
  perTileStats: Array<TileStats | null>
}

function aggregateTileStats(perTile: Array<TileStats | null>): TileStats | null {
  const filled = perTile.filter((s): s is TileStats => s !== null)
  if (filled.length === 0) return null
  const first = filled[0]
  return {
    fileSize:      filled.reduce((s, t) => s + t.fileSize, 0),
    pointCount:    filled.reduce((s, t) => s + t.pointCount, 0),
    chunkCount:    filled.reduce((s, t) => s + t.chunkCount, 0),
    version:       first.version,
    format:        first.format,
    decodedChunks: filled.reduce((s, t) => s + (t.decodedChunks ?? 0), 0),
    decodedPoints: filled.reduce((s, t) => s + (t.decodedPoints ?? 0), 0),
    activeWorkers: filled.reduce((s, t) => s + (t.activeWorkers ?? 0), 0),
    queuedChunks:  filled.reduce((s, t) => s + (t.queuedChunks ?? 0), 0),
  }
}

// ─── Header merge ─────────────────────────────────────────────────────────────

/**
 * Merge multiple LAS headers into a combined bounding-box header.
 * Used to tell the renderer the full spatial extent of all tiles.
 * Non-spatial fields (PDRF, scale, offset) are taken from the first header —
 * all tiles are assumed to share the same CRS and coordinate system.
 */
function mergeHeaders(headers: LasHeader[]): LasHeader {
  if (headers.length === 0) {
    throw new Error('ManifestSession: no valid headers to merge')
  }
  const base = { ...headers[0] }
  base.minX = Math.min(...headers.map(h => h.minX))
  base.minY = Math.min(...headers.map(h => h.minY))
  base.minZ = Math.min(...headers.map(h => h.minZ))
  base.maxX = Math.max(...headers.map(h => h.maxX))
  base.maxY = Math.max(...headers.map(h => h.maxY))
  base.maxZ = Math.max(...headers.map(h => h.maxZ))
  base.pointCount = headers.reduce((sum, h) => sum + h.pointCount, 0)
  return base
}
