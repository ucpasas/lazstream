/**
 * lazstream — Phase 1 entry point
 *
 * Wires the streaming engine to the renderer and UI.
 * Phase 1 goal: seed points visible within 3 seconds of page load.
 */

import { StreamingEngine } from './engine/streaming-engine.js'
import { PointCloudRenderer } from './render/renderer.js'
import { getUrlFromParams } from './network/url-validator.js'

// Default test URL — your USGS Central Texas file on R2
const DEFAULT_URL =
  'https://pub-729a4f32b70f473abbf23bf25daf2899.r2.dev/laz/USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_2996011a1_LAS_2019.laz'

// ─── UI Elements ─────────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement
const urlInput = document.getElementById('url-input') as HTMLInputElement
const loadBtn = document.getElementById('load-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement
const statsEl = document.getElementById('stats') as HTMLElement
const progressEl = document.getElementById('progress') as HTMLElement
const warningEl = document.getElementById('warning') as HTMLElement

// ─── Renderer ────────────────────────────────────────────────────────────────

const renderer = new PointCloudRenderer(canvas, (stats) => {
  statsEl.textContent =
    `${stats.fps} fps · ${stats.pointCount.toLocaleString()} seed pts`
})

// ─── Engine ──────────────────────────────────────────────────────────────────

function createEngine(): StreamingEngine {
  return new StreamingEngine({
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

    onProgress(loaded, total, _phase) {
      const pct = Math.round((loaded / total) * 100)
      progressEl.style.display = 'block'
      progressEl.style.setProperty('--progress', `${pct}%`)
      progressEl.title = `${loaded} / ${total}`
    },

    onStats(stats) {
      const mb = (stats.fileSize / 1024 / 1024).toFixed(1)
      const pts = stats.pointCount.toLocaleString()
      statsEl.textContent =
        `${stats.version} · PDRF ${stats.format} · ` +
        `${pts} pts · ${mb} MB · ${stats.chunkCount} chunks`
    },

    onSeedsReady(seeds, _header) {
      renderer.loadSeedPoints(seeds)
    },

    onError(error) {
      statusEl.textContent = `Error: ${error.message}`
      console.error('[lazstream]', error)
    },
  })
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadUrl(url: string): Promise<void> {
  warningEl.style.display = 'none'
  progressEl.style.display = 'none'
  const engine = createEngine()
  await engine.load(url)
}

// ─── UI Handlers ─────────────────────────────────────────────────────────────

loadBtn.addEventListener('click', () => {
  const url = urlInput.value.trim() || DEFAULT_URL
  loadUrl(url)
})

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click()
})

// ─── Auto-load from ?url= param or default ───────────────────────────────────

const paramUrl = getUrlFromParams()
const initialUrl = paramUrl ?? DEFAULT_URL
urlInput.value = initialUrl
loadUrl(initialUrl)