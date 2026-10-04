/**
 * LazstreamViewer — high-level one-liner wrapper.
 *
 * Wires ManifestSession + WebGPURenderer + all providers internally.
 * Accepts a bare .laz URL, a .lazm.json manifest URL, or a pre-parsed
 * Manifest object.
 */

import {
  ManifestSession,
  fetchManifest,
  urlToManifest,
  validateManifestUrl,
} from '@lazstream/core'
import type {
  Manifest,
  ManifestSessionOptions,
  EngineEvents,
  LazstreamAssetUrls,
  PointAttributes,
  CameraState,
  DecodedChunk,
  LasField,
  FieldDemand,
} from '@lazstream/core'
import { WebGPURenderer, WebGPUUnsupportedError, GpuOutOfMemoryError } from './render/webgpu-renderer.js'
import type { ColorMode, GpuMemoryBudget, GpuFault } from './render/webgpu-renderer.js'
import type { RawPick } from './render/picking.js'

export { WebGPUUnsupportedError, GpuOutOfMemoryError }
export type { PointAttributes, ColorMode, CameraState, GpuMemoryBudget, GpuFault }

/**
 * Resolved pick result exposed to application code.
 * T1 (worldPos) is always present on a hit. T2 fields are present only when
 * picking is enabled via setPickingEnabled(true). T3 (attributes) is present
 * only when resolveAttributes: true in ViewerOptions and T3 resolves non-null.
 */
export interface PickResult {
  worldPos:   { x: number; y: number; z: number }
  screenPos:  { x: number; y: number }
  chunkIndex?: number
  pointIndex?: number
  attributes?: PointAttributes
}

export interface ViewerOptions {
  /**
   * GPU ring buffer capacity in bytes. Default: adapter-negotiated (~2 GB).
   * If the GPU cannot allocate it, the size is halved and retried down to
   * `minRingBufferCapacity` — see `onGpuMemoryReduced`.
   */
  ringBufferCapacity?: number
  /**
   * Smallest ring buffer the out-of-memory backoff will try. If even this
   * fails, `create()` rejects with GpuOutOfMemoryError. Default: 128 MB.
   */
  minRingBufferCapacity?: number
  /**
   * Fires once during `create()` when the GPU could not allocate the requested
   * ring buffer and the viewer started with a smaller one. Fewer chunks stay
   * resident; show e.g. "Running with reduced GPU memory". The same data is
   * available afterwards via `viewer.gpuMemoryBudget`.
   */
  onGpuMemoryReduced?: (budget: GpuMemoryBudget) => void
  /**
   * Fires once if the GPU fails after start-up — a runtime out-of-memory
   * (e.g. resizing to a very large canvas) or device loss (driver reset,
   * integrated-GPU memory exhaustion). Rendering and streaming stop; the
   * canvas keeps its last frame. Recreate the viewer (or reload) to recover.
   */
  onGpuFault?: (fault: GpuFault) => void
  /** Min screen-space error to trigger chunk decode. Default: 10.0. */
  sseThreshold?: number
  /** Decode worker count. Default: hardwareConcurrency - 1. */
  workerCount?: number
  /** Max concurrent HTTP range requests. Default: min(workers × 4, 128). */
  maxFetches?: number
  /** Point splat radius in pixels. Default: 2 (3 × 3 px). */
  splatRadius?: number
  /**
   * Runtime voxel LOD "sediment layer". Default: true. Over-covered chunks
   * render a distance-derived prefix of a coarse-to-fine voxel tier list
   * instead of every point, and the coarse tier persists across GPU eviction
   * so previously visited regions keep a recognisable ghost silhouette.
   * Pass false to disable (e.g. for benchmarking the raw path).
   */
  voxelLod?: boolean
  /**
   * Asset URL overrides for laz-perf worker assets.
   * Passed through to ManifestSession → WorkerPool.
   * Defaults: WorkerPool resolves assets relative to its own module via import.meta.url,
   * which works correctly when @lazstream/core is installed from npm and not pre-bundled
   * by Vite. Add `lazstreamVitePlugin()` to your vite.config.ts to ensure this.
   * For non-Vite bundlers, pass explicit URLs pointing at the assets from
   * node_modules/@lazstream/core/dist/.
   */
  assetUrls?: LazstreamAssetUrls
  /**
   * When true and a pick resolves to a point identity (T2), automatically call
   * resolvePointAttributes() and include the result in PickResult.attributes.
   * Adds a few ms per click for the chunk re-decode. Default: false.
   */
  resolveAttributes?: boolean
  /** Initial colour mode. Default: 'rgb' if the file has native colour, else 'height'. */
  colorMode?: ColorMode
  /**
   * Base field mask for chunk fetches. 'all' (default) fetches whole chunks.
   * 'render' fetches only what the stock renderer reads (LAZ 1.4 layered
   * files with fixed-size chunks; others are always fetched whole). Grow it
   * at runtime with demandFields().
   */
  fetchFields?: ManifestSessionOptions['fetchFields']
  onFieldsChanged?: EngineEvents['onFieldsChanged']
  onStateChange?: EngineEvents['onStateChange']
  onProgress?: EngineEvents['onProgress']
  onWarning?: EngineEvents['onWarning']
  onStats?: EngineEvents['onStats']
  onError?: EngineEvents['onError']
}

export class LazstreamViewer {
  private renderer: WebGPURenderer
  private activeSession: ManifestSession | null = null
  private readonly options: ViewerOptions

  /**
   * Fires when the user clicks the canvas and a pick completes.
   * Null = click hit no point (empty space).
   * Set onPointPicked before calling setPickingEnabled(true).
   */
  onPointPicked: ((result: PickResult | null) => void) | null = null

  /**
   * Fires after every setColorMode() call with the RESOLVED mode.
   * The resolved mode may differ from the requested mode (e.g. 'rgb' resolves
   * to 'height' when the file has no native colour). Always reflects the mode
   * that is actually active on the GPU.
   */
  onColorModeChanged: ((resolved: ColorMode) => void) | null = null

  /**
   * Fires for every decoded chunk, after the renderer has taken it — including
   * upgrade re-emissions (`chunk.isUpgrade`), which the renderer ignores.
   * Read only fields listed in `chunk.fieldsPresent`; copy what you keep (the
   * renderer does not retain DecodedChunks).
   */
  onChunkDecoded: ((chunk: DecodedChunk) => void) | null = null

  /** Live demands; re-applied to each new session so handles survive load(). */
  private demands = new Set<{ fields: LasField[]; surface: boolean; handle: FieldDemand | null }>()

  private constructor(renderer: WebGPURenderer, options: ViewerOptions) {
    this.renderer = renderer
    this.options = options
  }

  /**
   * Create a viewer attached to a canvas element.
   * Throws WebGPUUnsupportedError if WebGPU is unavailable, or
   * GpuOutOfMemoryError if not even `minRingBufferCapacity` can be allocated.
   */
  static async create(canvas: HTMLCanvasElement, options: ViewerOptions = {}): Promise<LazstreamViewer> {
    // The renderer arms its fault watchers before returning, so a fault can in
    // principle land before `viewer` exists — hold it and replay below.
    let viewer: LazstreamViewer | null = null
    let earlyFault: GpuFault | null = null
    const renderer = await WebGPURenderer.create(canvas, {
      ringBufferCapacity:    options.ringBufferCapacity,
      minRingBufferCapacity: options.minRingBufferCapacity,
      voxelLod: options.voxelLod,
      onGpuFault: (fault) => {
        if (viewer) viewer.handleGpuFault(fault)
        else earlyFault = fault
      },
    })
    if (options.splatRadius !== undefined) renderer.setSplatRadius(options.splatRadius)
    viewer = new LazstreamViewer(renderer, options)
    const budget = renderer.gpuMemoryBudget
    if (budget.reduced) options.onGpuMemoryReduced?.(budget)
    if (earlyFault) viewer.handleGpuFault(earlyFault)
    return viewer
  }

  /** Ring buffer budget in effect, and whether OOM backoff reduced it. */
  get gpuMemoryBudget(): GpuMemoryBudget {
    return this.renderer.gpuMemoryBudget
  }

  /**
   * Load a point cloud. Accepts:
   *   - A bare .laz URL string   → wrapped in a synthetic one-tile manifest
   *   - A .lazm.json URL string  → fetched and parsed as a multi-tile manifest
   *   - A pre-parsed Manifest    → used directly (you control fetch + validation)
   *
   * Tile URLs are always validated by StreamingEngine before any fetch —
   * this path only skips calling validateManifestUrl (no manifest URL exists).
   *
   * Cancels any in-progress load before starting.
   */
  async load(source: string | Manifest): Promise<void> {
    this.renderer.reset()

    let manifest: Manifest
    if (typeof source === 'string') {
      const trimmed = source.trim()
      if (trimmed.toLowerCase().endsWith('.lazm.json')) {
        validateManifestUrl(trimmed)
        manifest = await fetchManifest(trimmed)
      } else {
        manifest = urlToManifest(trimmed)
      }
    } else {
      manifest = source
    }

    if (this.activeSession) {
      this.activeSession.dispose()
      this.activeSession = null
    }

    const { workerCount, sseThreshold, maxFetches, assetUrls, fetchFields } = this.options

    const sessionOptions: ManifestSessionOptions = {
      events: {
        onStateChange: this.options.onStateChange,
        onWarning:     this.options.onWarning,
        onProgress:    this.options.onProgress,
        onStats:       this.options.onStats,
        onError:       this.options.onError,
        onFieldsChanged: this.options.onFieldsChanged,
        onSeedsReady: (seeds, header) => {
          this.renderer.loadSeedPoints(seeds, header)
          // Apply initial colour mode from ViewerOptions if provided (consumer owns URL sync).
          if (this.options.colorMode) {
            const resolved = this.renderer.setColorMode(this.options.colorMode)
            this.onColorModeChanged?.(resolved)
          }
          this.startDecodeLoop(session)
        },
        onChunkDecoded: (chunk) => {
          // Upgrades carry new attributes only — geometry is already resident.
          if (!chunk.isUpgrade) this.renderer.addDecodedChunk(chunk)
          this.onChunkDecoded?.(chunk)
        },
      },
      workerCount,
      sseThreshold,
      maxFetches,
      assetUrls,
      fetchFields,
    }

    const session = new ManifestSession(manifest, sessionOptions)
    this.activeSession = session
    for (const d of this.demands) {
      d.handle = session.demandFields(d.fields, { surface: d.surface })
    }

    session.setCameraProvider(() => {
      const pos = this.renderer.getCameraWorldPosition()
      return {
        worldX: pos.x,
        worldY: pos.y,
        worldZ: pos.z,
        fovY: this.renderer.getFovY(),
        canvasHeight: this.renderer.getCanvasHeight(),
      }
    })
    session.setFrustumProvider(() => this.renderer.getFrustumWorldBBox3D())
    session.setRingBufferProvider(() => this.renderer.getRingBufferStatus())
    // Exact-plane visibility gate: without it, ground-level views churn
    // (decode → exact-cull evict → re-queue) on chunks only the loose
    // frustum AABB admits. Measured on Melbourne 2018: post-settle wasted
    // fetch drops from ~81-100% to ~8-19%. See wiki spike page.
    session.setVisibilityProvider(bbox => this.renderer.isWorldBBoxVisible(bbox))
    this.renderer.setChunkEvictedCallback(idx => session.onChunkEvictedFromGPU(idx))

    await session.load()
  }

  /**
   * Activate or deactivate the pick-ID G-buffer (T2).
   *
   * When enabled, every canvas click triggers a depth + ID readback and fires
   * `onPointPicked`. The GPU pick buffer (~33 MB at 4K) is allocated only while
   * active. T1 (world position) fires regardless; T2 (chunkIndex/pointIndex)
   * requires this to be true.
   *
   * Call this after setting `onPointPicked` so the first click is handled.
   */
  setPickingEnabled(enabled: boolean): void {
    this.renderer.setPickingEnabled(enabled)

    if (enabled) {
      this.renderer.onPointPicked = async (raw: RawPick | null) => {
        if (!this.onPointPicked) return

        if (!raw) {
          this.onPointPicked(null)
          return
        }

        const result: PickResult = {
          worldPos:  raw.worldPos,
          screenPos: raw.screenPos,
          chunkIndex:  raw.chunkIndex  >= 0 ? raw.chunkIndex  : undefined,
          pointIndex:  raw.localPointIndex >= 0 ? raw.localPointIndex : undefined,
        }

        if (
          this.options.resolveAttributes &&
          raw.chunkIndex >= 0 &&
          raw.localPointIndex >= 0 &&
          this.activeSession
        ) {
          const attrs = await this.activeSession.resolvePointAttributes(
            raw.chunkIndex, raw.localPointIndex,
          )
          if (attrs) result.attributes = attrs
        }

        this.onPointPicked(result)
      }
    } else {
      this.renderer.onPointPicked = null
    }
  }

  /**
   * Switch the colour mode. No re-decode — just a uniform flip, takes effect next frame.
   * Modes: 'rgb' (native), 'height' (elevation ramp), 'intensity' (grayscale),
   * 'classification' (ASPRS palette).
   *
   * Returns the RESOLVED mode. If 'rgb' is requested on a file without native colour,
   * it silently resolves to 'height'. The onColorModeChanged callback always fires with
   * the resolved mode.
   */
  setColorMode(mode: ColorMode): ColorMode {
    const resolved = this.renderer.setColorMode(mode)
    this.onColorModeChanged?.(resolved)
    return resolved
  }

  /** Returns which colour modes are available for the loaded file. 'rgb' is absent for PDRFs without colour. */
  getAvailableColorModes(): ColorMode[] {
    return this.renderer.getAvailableColorModes()
  }

  /** Current colour mode. */
  get colorMode(): ColorMode {
    return this.renderer.currentColorMode
  }

  /**
   * Return the current camera position and look-at target in world coordinates.
   * Returns null if no point cloud is loaded (renderer has no sceneCenter yet).
   *
   * Use this to read the current view for external camera sync (e.g. driving a
   * MapLibre map to match the point cloud camera).
   */
  getCameraState(): CameraState | null {
    if (!this.renderer) return null
    return this.renderer.getCameraState()
  }

  /**
   * Restore the camera to a saved CameraState.
   *
   * TIMING CONSTRAINT: must be called after the first seed points have loaded
   * (i.e. after `onProgress` fires with phase === 'seeds' or after `onStateChange`
   * fires with state === 'streaming'). Calling before seeds are loaded means
   * `sceneCenter` is still zero and the world→scene-local conversion will be wrong,
   * placing the camera at an incorrect position.
   *
   * Use this to drive the point cloud camera from an external source (e.g. a
   * MapLibre map move event converted to a CameraState).
   */
  applyCameraState(state: CameraState): void {
    if (!this.renderer) return
    this.renderer.applyCameraState(state)
  }

  /**
   * Ask the engine to fetch these LAS fields (and, with `surface: true`,
   * decode them into `DecodedChunk.attributes`) for chunks fetched from now
   * on. The handle stays valid across load(); call `release()` when done.
   * Already-resident chunks are unchanged — see upgradeResidentChunks().
   */
  demandFields(fields: Iterable<LasField>, opts: { surface?: boolean } = {}): FieldDemand {
    const record = {
      fields: [...fields],
      surface: opts.surface ?? false,
      handle: null as FieldDemand | null,
    }
    record.handle = this.activeSession?.demandFields(record.fields, { surface: record.surface }) ?? null
    this.demands.add(record)
    let released = false
    return {
      fields: new Set(record.fields),
      release: () => {
        if (released) return
        released = true
        this.demands.delete(record)
        record.handle?.release()
      },
    }
  }

  /**
   * Bring every chunk currently resident on the GPU up to the current field
   * demands. Only missing compressed layers are fetched where possible;
   * upgraded chunks arrive via onChunkDecoded with `isUpgrade: true`.
   */
  upgradeResidentChunks(): void {
    this.activeSession?.upgradeChunks(this.renderer.getResidentChunkIndices())
  }

  /** Stop all streaming and release all GPU + worker resources. */
  dispose(): void {
    this.activeSession?.dispose()
    this.activeSession = null
  }

  /** The underlying ManifestSession. Use for advanced provider registration. */
  get session(): ManifestSession | null { return this.activeSession }

  // ─── Internal ──────────────────────────────────────────────────────────────

  /** Stop streaming (nothing can be drawn any more) and notify the host. */
  private handleGpuFault(fault: GpuFault): void {
    this.activeSession?.dispose()
    this.activeSession = null
    this.options.onGpuFault?.(fault)
  }

  private startDecodeLoop(session: ManifestSession): void {
    let running = true
    const origDispose = session.dispose.bind(session)
    session.dispose = () => { running = false; origDispose() }

    const tick = () => {
      if (!running) return
      session.updateCamera()
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
}
