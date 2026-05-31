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
 *
 * URL fragment:
 *   #v=<base64url>     encoded ViewState (source + camera) — takes priority
 *                      over ?url= / ?manifest= for auto-load
 */

import { ManifestSession, fetchManifest, urlToManifest, validateManifestUrl, getEntryFromParams, encodeViewState, decodeViewState } from '@lazstream/core'
import type { ManifestSessionOptions, Manifest, CameraState } from '@lazstream/core'
import { WebGPURenderer, WebGPUUnsupportedError } from './render/webgpu-renderer.js'
// ?worker&url: Vite compiles decode-worker.ts as a module worker and returns its
// URL — hashed JS in prod, dev-server URL in dev. Bypasses the @vite-ignore default
// in WorkerPool so the viewer never relies on the fallback path.
import decodeWorkerUrl from '../../core/src/workers/decode-worker.ts?worker&url'

const DEFAULT_URL = ''

// ─── UI Elements ─────────────────────────────────────────────────────────────

const canvas        = document.getElementById('canvas')       as HTMLCanvasElement
const urlInput      = document.getElementById('url-input')    as HTMLInputElement
const loadBtn       = document.getElementById('load-btn')     as HTMLButtonElement
const shareBtn      = document.getElementById('share-btn')    as HTMLButtonElement
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

  // ─── Hash-based view state ────────────────────────────────────────────────
  // #v=<base64url> encodes both the source URL and the camera state.
  // Takes priority over ?url= / ?manifest= for auto-load.

  let pendingCamState: CameraState | null = null
  let hashSource: string | null = null

  const hashMatch = window.location.hash.slice(1).match(/(?:^|&)v=([^&]+)/)
  if (hashMatch) {
    try {
      const vs = decodeViewState(hashMatch[1])
      hashSource = vs.source
      pendingCamState = vs.cam
    } catch {
      console.warn('[lazstream] Invalid #v= token — ignoring')
    }
  }

  // ─── Current source URL (for share button) ────────────────────────────────

  let currentSourceUrl: string | null = null

  // Acquire the WebGPU renderer — fails fast if WebGPU is unavailable
  let renderer: WebGPURenderer
  try {
    renderer = await WebGPURenderer.create(canvas, {
      ringBufferCapacity,
      onFrame({ slots, pointsLoaded }) {
        statsEl.textContent =
          `${slots} chunks · ${pointsLoaded.toLocaleString()} pts`
        activeSession?.updateCamera()
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

  // ─── Share button ─────────────────────────────────────────────────────────

  shareBtn.addEventListener('click', () => {
    if (!currentSourceUrl) return
    const token = encodeViewState({ source: currentSourceUrl, cam: renderer.getCameraState() })
    history.replaceState(null, '', '#v=' + token)
    navigator.clipboard.writeText(window.location.href).then(() => {
      shareBtn.textContent = 'Copied!'
      setTimeout(() => { shareBtn.textContent = 'Share' }, 2000)
    }).catch(() => {
      // Clipboard permission denied — hash is still updated so user can copy manually
    })
  })

  // ─── Active session (one at a time) ──────────────────────────────────────

  let activeSession: ManifestSession | null = null

  // ─── Session factory ──────────────────────────────────────────────────────

  function createSession(manifest: Manifest): ManifestSession {
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

          // Workers are now configured — ensure onFrame fires so updateCamera()
          // runs with workersConfigured=true. The render triggered by loadSeedPoints
          // may have landed before workers were ready and returned early.
          if (state === 'streaming') {
            renderer.requestRender()
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
          // Restore camera from shared URL, or auto-fit to the file's bbox.
          // Both must be called after loadSeedPoints() which sets sceneCenter.
          if (pendingCamState) {
            renderer.applyCameraState(pendingCamState)
            pendingCamState = null
          } else {
            renderer.fitCameraToHeader(header)
          }
          shareBtn.disabled = false
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
      assetUrls: {
        workerUrl:      decodeWorkerUrl,
        lazPerfJsUrl:   new URL('/lib/laz-perf-worker.js',   location.href).href,
        lazPerfWasmUrl: new URL('/lib/laz-perf-worker.wasm', location.href).href,
      },
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

  async function loadUrl(rawInput: string, forceType?: 'laz' | 'manifest'): Promise<void> {
    currentSourceUrl = rawInput
    shareBtn.disabled = true
    warningEl.style.display = 'none'
    progressEl.style.display = 'none'
    attributionEl.style.display = 'none'
    renderer.reset()

    // forceType comes from ?manifest= / ?url= query params (explicit intent).
    // Without it, fall back to extension detection (.lazm.json → manifest).
    const isManifest = forceType === 'manifest' || rawInput.trim().toLowerCase().endsWith('.lazm.json')

    let manifest: Manifest
    try {
      if (isManifest) {
        // Only enforce the .lazm.json extension when auto-detecting from the
        // input box. When ?manifest= is explicit, any .json URL is accepted.
        if (forceType !== 'manifest') validateManifestUrl(rawInput)
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
  // Priority: #v= hash (with camera state) > ?manifest= > ?url=

  if (hashSource) {
    urlInput.value = hashSource
    const type = hashSource.toLowerCase().endsWith('.lazm.json') ? 'manifest' : 'laz'
    loadUrl(hashSource, type as 'laz' | 'manifest')
  } else {
    const entry = getEntryFromParams()
    urlInput.value = entry?.url ?? DEFAULT_URL
    if (entry) loadUrl(entry.url, entry.type)
  }
}

main()
