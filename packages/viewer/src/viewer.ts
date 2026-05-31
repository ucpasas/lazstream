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
} from '@lazstream/core'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'

export { WebGPUUnsupportedError }

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
   * Asset URL overrides for non-standard hosting (CDN prefix, custom hashes).
   * The viewer passes these through to ManifestSession → WorkerPool.
   * In dev mode the viewer automatically points to /lib/ so this is rarely needed.
   */
  assetUrls?: LazstreamAssetUrls
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

    // In dev mode (Vite serves laz-perf from /lib/), default assetUrls to the
    // public/lib/ paths so WorkerPool's import.meta.url fallback isn't used.
    const resolvedAssetUrls: LazstreamAssetUrls = assetUrls ?? {
      lazPerfJsUrl:   new URL('/lib/laz-perf-worker.js',   location.href).href,
      lazPerfWasmUrl: new URL('/lib/laz-perf-worker.wasm', location.href).href,
    }

    const sessionOptions: ManifestSessionOptions = {
      events: {
        onStateChange: this.options.onStateChange,
        onWarning:     this.options.onWarning,
        onProgress:    this.options.onProgress,
        onStats:       this.options.onStats,
        onError:       this.options.onError,
        onSeedsReady: (seeds, header) => {
          this.renderer.loadSeedPoints(seeds, header)
          this.startDecodeLoop(session)
        },
        onChunkDecoded: (chunk) => {
          this.renderer.addDecodedChunk(chunk)
        },
      },
      workerCount,
      sseThreshold,
      maxFetches,
      assetUrls: resolvedAssetUrls,
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
