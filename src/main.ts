/**
 * lazstream — Phase 2 Track B entry point (WebGPU renderer)
 *
 * Changes from Track A:
 *   - WebGPURenderer replaces PointCloudRenderer (async factory)
 *   - WebGPUUnsupportedError caught at startup → user-facing error, no crash
 *   - onFrame replaces the renderer's internal stats callback
 *   - All engine callbacks unchanged (same public interface)
 */

import { StreamingEngine } from './engine/streaming-engine.js'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'
import { getUrlFromParams } from './network/url-validator.js'

const DEFAULT_URL =
  'https://pub-729a4f32b70f473abbf23bf25daf2899.r2.dev/laz/USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_2996011a1_LAS_2019.laz'

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
    renderer = await WebGPURenderer.create(canvas, {
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
  function startDecodeLoop(engine: StreamingEngine): void {
    let running = true

    function tick() {
      if (!running) return
      const cam = renderer.getCameraWorldPosition()
      engine.updateCamera(cam.x, cam.y, cam.z)
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
        renderer.loadSeedPoints(seeds)
        engine.decodeAll()
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