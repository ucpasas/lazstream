/**
 * lazstream — Phase 2 Track B + Phase 3 Track C entry point
 *
 * Track C changes from Track B:
 *   - Engine now pulls camera + frustum from renderer-registered providers
 *     instead of taking positional args in updateCamera()
 *   - Two new provider registrations after renderer + engine construction
 *
 * Everything else (WebGPU bootstrap, error handling, UI wiring, auto-load)
 * is unchanged.
 */

import { StreamingEngine } from './engine/streaming-engine.js'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'
import { getUrlFromParams } from './network/url-validator.js'

const DEFAULT_URL =
  ''

// ─── UI Elements ─────────────────────────────────────────────────────────────

const canvas    = document.getElementById('canvas')    as HTMLCanvasElement
const urlInput  = document.getElementById('url-input') as HTMLInputElement
const loadBtn   = document.getElementById('load-btn')  as HTMLButtonElement
const statusEl  = document.getElementById('status')    as HTMLElement
const statsEl   = document.getElementById('stats')     as HTMLElement
const progressEl = document.getElementById('progress') as HTMLElement
const warningEl = document.getElementById('warning')   as HTMLElement

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {

  // Acquire the WebGPU renderer. Fails fast if WebGPU is unavailable.
  let renderer: WebGPURenderer
  try {
    // Optional URL override: ?bufferMB=N to test a specific ring buffer size.
    // Defaults to the context's negotiated target (2 GB) when not set.
    // Clamped by webgpu-context.ts to [128 MB, ~2.87 GB].
    const bufferMBParam = new URLSearchParams(location.search).get('bufferMB')
    const ringBufferCapacity =
      bufferMBParam !== null && Number.isFinite(parseFloat(bufferMBParam))
        ? Math.floor(parseFloat(bufferMBParam) * 1024 * 1024)
        : undefined

    renderer = await WebGPURenderer.create(canvas, {
      ringBufferCapacity,
      onFrame({ slots, pointsLoaded }) {
        // Lightweight per-frame stats — engine stats overlay handles the rest.
        statsEl.textContent =
          `${slots} chunks · ${pointsLoaded.toLocaleString()} pts`
      },
    })
  } catch (err) {
    if (err instanceof WebGPUUnsupportedError) {
      statusEl.textContent = 'WebGPU is not supported in this browser. Try Chrome 120+ or Edge 120+.'
      statusEl.className = 'status status--error'
      loadBtn.disabled = true
      return
    }
    throw err // unexpected — let it surface
  }

  // ─── Active engine (one at a time) ─────────────────────────────────────────

  let activeEngine: StreamingEngine | null = null

  // ─── Decode loop ───────────────────────────────────────────────────────────

  // Called every animation frame — keeps the chunk priority queue current
  // as the camera moves. The engine submits the highest-priority undecoded
  // chunks to the worker pool each call.
  //
  // Track C: updateCamera() is now argless — engine pulls camera + frustum
  // from the providers we registered at engine construction.
  function startDecodeLoop(engine: StreamingEngine): void {
    let running = true

    function tick() {
      if (!running) return
      engine.updateCamera()
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  }

  // ─── Engine factory ────────────────────────────────────────────────────────

  function createEngine(): StreamingEngine {
    if (activeEngine) {
      activeEngine.dispose()
      activeEngine = null
    }

    const engine = new StreamingEngine({

      onStateChange(state, message) {
        statusEl.textContent = message
        statusEl.className = `status status--${state}`
        loadBtn.disabled = state !== 'idle' && state !== 'ready' && state !== 'error'

        if (state === 'ready' || state === 'error') {
          progressEl.style.display = 'none'
        }
      },

      onWarning(message) {
        warningEl.textContent = `⚠ ${message}`
        warningEl.style.display = 'block'
      },

      onProgress(loaded, total, phase) {
        const pct = Math.round((loaded / total) * 100)
        progressEl.style.display = 'block'
        progressEl.style.setProperty('--progress', `${pct}%`)
        progressEl.title = `${phase}: ${loaded} / ${total}`
      },

      onStats(stats) {
        const mb = (stats.fileSize / 1024 / 1024).toFixed(1)
        const pts = stats.pointCount.toLocaleString()
        const decoded = stats.decodedChunks ?? 0
        const total = stats.chunkCount

        let text = `${stats.version} · PDRF ${stats.format} · ${pts} pts · ${mb} MB`
        if (decoded > 0) {
          const decodedPts = (stats.decodedPoints ?? 0).toLocaleString()
          text += ` · ${decoded}/${total} chunks · ${decodedPts} decoded`
        }
        if ((stats.activeWorkers ?? 0) > 0) {
          text += ` · ${stats.activeWorkers} workers active`
        }
        statsEl.textContent = text
      },

      onSeedsReady(seeds, header) {
        renderer.loadSeedPoints(seeds, header)
        // Track C: prefer camera-driven streaming over decodeAll().
        // The decode loop (started below) will populate the queue based on
        // what the camera can actually see, gated by MIN_SSE_THRESHOLD.
        // decodeAll() remains available for stress-testing — uncomment to
        // exercise the worker pool against the full file.
        // engine.decodeAll()
        startDecodeLoop(engine)
      },

      onChunkDecoded(chunk) {
        renderer.addDecodedChunk(chunk)
      },

      onError(error) {
        statusEl.textContent = `Error: ${error.message}`
        console.error('[lazstream]', error)
      },

    })

    // ─── Track C: register camera + frustum providers ──────────────────────
    //
    // The renderer owns camera + viewport state. These callbacks let the
    // engine pull what it needs each frame without importing Three.js.

    engine.setCameraProvider(() => {
      const pos = renderer.getCameraWorldPosition()
      return {
        worldX: pos.x,
        worldY: pos.y,
        worldZ: pos.z,
        fovY: renderer.getFovY(),
        canvasHeight: renderer.getCanvasHeight(),
      }
    })

    engine.setFrustumProvider(() => renderer.getFrustumWorldBBox3D())

    activeEngine = engine
    return engine
  }

  // ─── Load ──────────────────────────────────────────────────────────────────

  async function loadUrl(url: string): Promise<void> {
    warningEl.style.display = 'none'
    progressEl.style.display = 'none'
    const engine = createEngine()
    await engine.load(url)
  }

  // ─── UI Handlers ───────────────────────────────────────────────────────────

  loadBtn.addEventListener('click', () => {
    const url = urlInput.value.trim() || DEFAULT_URL
    loadUrl(url)
  })

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadBtn.click()
  })

  // ─── Auto-load ─────────────────────────────────────────────────────────────

  const paramUrl = getUrlFromParams()
  const initialUrl = paramUrl ?? DEFAULT_URL
  urlInput.value = initialUrl
  loadUrl(initialUrl)
}

main()