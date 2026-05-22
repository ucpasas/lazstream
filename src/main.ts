/**
 * lazstream — entry point
 *
 * Loads a single .laz file or a .lazm.json multi-tile manifest.
 * All loading goes through ManifestSession — single files are wrapped in a
 * synthetic one-tile manifest so there is one code path for both cases.
 *
 * URL params:
 *   ?url=<laz>         direct LAZ file (existing behaviour, unchanged)
 *   ?manifest=<lazm>   .lazm.json manifest (new)
 *   ?bufferMB=N        ring buffer size override
 *   ?sseMin=N          SSE decode threshold
 *   ?workerCount=N     decode worker count
 *   ?maxFetches=N      max concurrent HTTP range requests
 *   ?splatRadius=N     point splat size in pixels
 */

import { ManifestSession } from './engine/manifest-session.js'
import type { ManifestSessionOptions } from './engine/manifest-session.js'
import { fetchManifest, urlToManifest } from './engine/manifest-loader.js'
import { validateManifestUrl, getEntryFromParams } from './network/url-validator.js'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'

const DEFAULT_URL = ''

// ─── UI Elements ─────────────────────────────────────────────────────────────

const canvas        = document.getElementById('canvas')       as HTMLCanvasElement
const urlInput      = document.getElementById('url-input')    as HTMLInputElement
const loadBtn       = document.getElementById('load-btn')     as HTMLButtonElement
const statusEl      = document.getElementById('status')       as HTMLElement
const statsEl       = document.getElementById('stats')        as HTMLElement
const progressEl    = document.getElementById('progress')     as HTMLElement
const warningEl     = document.getElementById('warning')      as HTMLElement
const attributionEl = document.getElementById('attribution')  as HTMLElement

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {

  const urlParams = new URLSearchParams(location.search)

  const bufferMBParam = urlParams.get('bufferMB')
  const ringBufferCapacity =
    bufferMBParam !== null && Number.isFinite(parseFloat(bufferMBParam))
      ? Math.floor(parseFloat(bufferMBParam) * 1024 * 1024)
      : undefined

  const sseMinParam = urlParams.get('sseMin')
  const sseThreshold =
    sseMinParam !== null && Number.isFinite(parseFloat(sseMinParam))
      ? parseFloat(sseMinParam)
      : undefined

  const workerCountParam = urlParams.get('workerCount')
  const workerCount =
    workerCountParam !== null && Number.isFinite(parseInt(workerCountParam, 10))
      ? Math.max(1, parseInt(workerCountParam, 10))
      : undefined

  const maxFetchesParam = urlParams.get('maxFetches')
  const maxFetches =
    maxFetchesParam !== null && Number.isFinite(parseInt(maxFetchesParam, 10))
      ? Math.max(1, parseInt(maxFetchesParam, 10))
      : undefined

  const splatRadiusParam = urlParams.get('splatRadius')
  const splatRadius =
    splatRadiusParam !== null && Number.isFinite(parseInt(splatRadiusParam, 10))
      ? Math.max(1, parseInt(splatRadiusParam, 10))
      : undefined

  // Acquire the WebGPU renderer — fails fast if WebGPU is unavailable
  let renderer: WebGPURenderer
  try {
    renderer = await WebGPURenderer.create(canvas, {
      ringBufferCapacity,
      onFrame({ slots, pointsLoaded }) {
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
    throw err
  }

  if (splatRadius !== undefined) renderer.setSplatRadius(splatRadius)

  // ─── Active session (one at a time) ──────────────────────────────────────

  let activeSession: ManifestSession | null = null

  // ─── Decode loop ──────────────────────────────────────────────────────────

  function startDecodeLoop(session: ManifestSession): void {
    let running = true

    function tick() {
      if (!running) return
      session.updateCamera()
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)

    // Attach a disposer so the loop stops when the session is replaced.
    // We shadow running=false in the next createSession() call via closure.
    const origDispose = session.dispose.bind(session)
    session.dispose = () => {
      running = false
      origDispose()
    }
  }

  // ─── Session factory ──────────────────────────────────────────────────────

  function createSession(manifest: import('./engine/manifest-types.js').Manifest): ManifestSession {
    if (activeSession) {
      activeSession.dispose()
      activeSession = null
    }

    const sessionOptions: ManifestSessionOptions = {
      events: {
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
          startDecodeLoop(session)
        },

        onChunkDecoded(chunk) {
          renderer.addDecodedChunk(chunk)
        },

        onError(error) {
          statusEl.textContent = `Error: ${error.message}`
          console.error('[lazstream]', error)
        },
      },
      workerCount,
      sseThreshold,
      maxFetches,
    }

    const session = new ManifestSession(manifest, sessionOptions)

    session.setCameraProvider(() => {
      const pos = renderer.getCameraWorldPosition()
      return {
        worldX: pos.x,
        worldY: pos.y,
        worldZ: pos.z,
        fovY: renderer.getFovY(),
        canvasHeight: renderer.getCanvasHeight(),
      }
    })

    session.setFrustumProvider(() => renderer.getFrustumWorldBBox3D())
    session.setRingBufferProvider(() => renderer.getRingBufferStatus())
    renderer.setChunkEvictedCallback(chunkIndex => session.onChunkEvictedFromGPU(chunkIndex))

    activeSession = session
    return session
  }

  // ─── Load ─────────────────────────────────────────────────────────────────

  async function loadUrl(rawInput: string): Promise<void> {
    warningEl.style.display = 'none'
    progressEl.style.display = 'none'
    attributionEl.style.display = 'none'
    renderer.reset()

    const isManifest = rawInput.trim().toLowerCase().endsWith('.lazm.json')

    let manifest: import('./engine/manifest-types.js').Manifest
    try {
      if (isManifest) {
        validateManifestUrl(rawInput)
        manifest = await fetchManifest(rawInput)
      } else {
        manifest = urlToManifest(rawInput)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      statusEl.textContent = `Error: ${message}`
      statusEl.className = 'status status--error'
      console.error('[lazstream]', err)
      return
    }

    // Show manifest-level metadata
    if (manifest.attribution) {
      attributionEl.textContent = manifest.attribution
      attributionEl.style.display = 'block'
    }

    const session = createSession(manifest)
    await session.load()
  }

  // ─── UI Handlers ──────────────────────────────────────────────────────────

  loadBtn.addEventListener('click', () => {
    const url = urlInput.value.trim() || DEFAULT_URL
    loadUrl(url)
  })

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadBtn.click()
  })

  // ─── Auto-load ────────────────────────────────────────────────────────────

  const entry = getEntryFromParams()
  const initialUrl = entry?.url ?? DEFAULT_URL
  urlInput.value = initialUrl
  loadUrl(initialUrl)
}

main()
