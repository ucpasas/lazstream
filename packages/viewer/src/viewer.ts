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
} from '@lazstream/core'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'
import type { ColorMode } from './render/webgpu-renderer.js'
import type { RawPick } from './render/picking.js'

export { WebGPUUnsupportedError }
export type { PointAttributes, ColorMode }

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
  /** GPU ring buffer capacity in bytes. Default: adapter-negotiated (~2 GB). */
  ringBufferCapacity?: number
  /** Min screen-space error to trigger chunk decode. Default: 10.0. */
  sseThreshold?: number
  /** Decode worker count. Default: hardwareConcurrency - 1. */
  workerCount?: number
  /** Max concurrent HTTP range requests. Default: min(workers × 4, 128). */
  maxFetches?: number
  /** Point splat radius in pixels. Default: 2 (3 × 3 px). */
  splatRadius?: number
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

  private constructor(renderer: WebGPURenderer, options: ViewerOptions) {
    this.renderer = renderer
    this.options = options
  }

  /**
   * Create a viewer attached to a canvas element.
   * Throws WebGPUUnsupportedError if WebGPU is unavailable.
   */
  static async create(canvas: HTMLCanvasElement, options: ViewerOptions = {}): Promise<LazstreamViewer> {
    const renderer = await WebGPURenderer.create(canvas, {
      ringBufferCapacity: options.ringBufferCapacity,
    })
    if (options.splatRadius !== undefined) renderer.setSplatRadius(options.splatRadius)
    return new LazstreamViewer(renderer, options)
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

    const { workerCount, sseThreshold, maxFetches, assetUrls } = this.options

    const sessionOptions: ManifestSessionOptions = {
      events: {
        onStateChange: this.options.onStateChange,
        onWarning:     this.options.onWarning,
        onProgress:    this.options.onProgress,
        onStats:       this.options.onStats,
        onError:       this.options.onError,
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
          this.renderer.addDecodedChunk(chunk)
        },
      },
      workerCount,
      sseThreshold,
      maxFetches,
      assetUrls,
    }

    const session = new ManifestSession(manifest, sessionOptions)
    this.activeSession = session

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

  /** Stop all streaming and release all GPU + worker resources. */
  dispose(): void {
    this.activeSession?.dispose()
    this.activeSession = null
  }

  /** The underlying ManifestSession. Use for advanced provider registration. */
  get session(): ManifestSession | null { return this.activeSession }

  // ─── Internal ──────────────────────────────────────────────────────────────

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
