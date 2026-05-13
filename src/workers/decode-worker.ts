/**
 * Decode Worker — laz-perf WASM chunk decoder
 *
 * Module worker (Vite dev always produces module workers).
 * No importScripts() — uses dynamic import() instead.
 *
 * laz-perf-worker.js must be patched before this works:
 *   1. Environment check must accept WorkerGlobalScope (module workers)
 *   2. UMD tail replaced with: export default createLazPerf
 * See patch-lazperf.sh for the exact commands.
 *
 * Lifecycle:
 *   1. Worker spawns → waits for { type: 'init', lazPerfUrl, lazPerfWasmUrl }
 *   2. Receives init → dynamic import(lazPerfUrl) → await createLazPerf()
 *   3. Sends { type: 'ready' }
 *   4. Receives { type: 'decode' } → fetch + WASM decode + quantize
 *   5. Sends { type: 'decoded' } with Transferable buffers
 */

// ─── WASM Module State ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Module: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let decoder: any = null
let compressedPtr = 0
let compressedAllocSize = 0
let pointPtr = 0

// ─── Message Handler ─────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  // ── Init: load laz-perf via dynamic import ───────────────────────────────
  if (msg.type === 'init') {
    try {
      const { lazPerfUrl, lazPerfWasmUrl } = msg as {
        lazPerfUrl: string
        lazPerfWasmUrl: string
      }

      // Dynamic import of the patched laz-perf-worker.js (ESM).
      // @vite-ignore tells Vite not to analyse/bundle this import —
      // it stays as a runtime fetch of the static file from public/.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — dynamic URL import not in TS lib
      const mod = await import(/* @vite-ignore */ 'http://localhost:5173/lib/laz-perf-worker.js')
      console.debug('[worker] import result:', {
        keys: Object.keys(mod),
        default: typeof mod.default,
        createLazPerf: typeof (mod as any).createLazPerf,
      })
      const createLazPerf = mod.default

      if (typeof createLazPerf !== 'function') {
        throw new Error(
          `createLazPerf is not a function — got ${typeof createLazPerf}. ` +
          `Ensure laz-perf-worker.js has been patched with ESM export.`
        )
      }

      // Pass locateFile so laz-perf finds the WASM at the correct URL.
      // Without this it resolves relative to self.location.href (the worker
      // bundle URL), not the location of laz-perf-worker.js.
      Module = await createLazPerf({
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) return lazPerfWasmUrl
          return path
        },
      })

      // One ChunkDecoder instance, reused for all chunks in this worker
      decoder = new Module.ChunkDecoder()

      // Pre-allocate 128 bytes for one point record (max PDRF is ~67 bytes)
      pointPtr = Module._malloc(128)
      if (pointPtr === 0) throw new Error('Failed to allocate WASM point buffer')

      self.postMessage({ type: 'ready' })

    } catch (err) {
      self.postMessage({
        type: 'error',
        chunkIndex: -1,
        message: `Worker init failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
    return
  }

  // ── Decode: fetch + decode + quantize ────────────────────────────────────
  if (msg.type === 'decode') {
    await decodeChunk(msg)
    return
  }
}

// ─── Chunk Decode ────────────────────────────────────────────────────────────

async function decodeChunk(req: {
  chunkIndex: number
  url: string
  offset: number
  compressedSize: number
  pointCount: number
  pointDataRecordFormat: number
  pointDataRecordLength: number
  scaleX: number; scaleY: number; scaleZ: number
  offsetX: number; offsetY: number; offsetZ: number
  globalMinZ: number
  globalMaxZ: number
}): Promise<void> {
  try {
    if (!Module || !decoder) {
      throw new Error('Worker not initialised — decode called before init completed')
    }

    // Step 1: Fetch compressed chunk bytes via HTTP Range request
    const response = await fetch(req.url, {
      headers: { Range: `bytes=${req.offset}-${req.offset + req.compressedSize - 1}` },
      cache: 'no-store',
      mode: 'cors',
    })

    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`Range request failed: HTTP ${response.status}`)
    }

    const compressedBytes = new Uint8Array(await response.arrayBuffer())

    // Step 2: Copy compressed bytes into WASM heap
    if (compressedBytes.length > compressedAllocSize) {
      if (compressedPtr !== 0) Module._free(compressedPtr)
      compressedAllocSize = compressedBytes.length * 2
      compressedPtr = Module._malloc(compressedAllocSize)
      if (compressedPtr === 0) {
        throw new Error(`Failed to allocate ${compressedAllocSize} bytes on WASM heap`)
      }
    }
    Module.HEAPU8.set(compressedBytes, compressedPtr)

    // Step 3: Open chunk decoder
    // ChunkDecoder.open(pdrf, recordLength, compressedDataPointer)
    decoder.open(req.pointDataRecordFormat, req.pointDataRecordLength, compressedPtr)

    // Step 4: Decode all points — first pass collects raw coords for bbox
    const rawX = new Float64Array(req.pointCount)
    const rawY = new Float64Array(req.pointCount)
    const rawZ = new Float64Array(req.pointCount)

    let minX = Infinity,  minY = Infinity,  minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (let i = 0; i < req.pointCount; i++) {
      // getPoint writes one decoded point record to pointPtr in WASM heap
      decoder.getPoint(pointPtr)

      // LAS point record layout (all PDRFs): bytes 0–11 are int32 X, Y, Z
      const ix = Module.HEAP32[(pointPtr >> 2)]
      const iy = Module.HEAP32[(pointPtr >> 2) + 1]
      const iz = Module.HEAP32[(pointPtr >> 2) + 2]

      // Apply LAS scale + offset to get world coordinates
      const wx = ix * req.scaleX + req.offsetX
      const wy = iy * req.scaleY + req.offsetY
      const wz = iz * req.scaleZ + req.offsetZ

      rawX[i] = wx; rawY[i] = wy; rawZ[i] = wz

      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx
      if (wy < minY) minY = wy; if (wy > maxY) maxY = wy
      if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz
    }

    // Step 5: Quantize to Int16 per-chunk-local coords
    // Int16 range [-32768, 32767] maps to [min, max] per axis
    // Dequantization: world = (q + 32768) / 65535 * range + min
    const rangeX = maxX - minX || 1  // guard against flat/degenerate chunks
    const rangeY = maxY - minY || 1
    const rangeZ = maxZ - minZ || 1
    

    const positions = new Int16Array(req.pointCount * 3)
    const colors    = new Uint8Array(req.pointCount * 4)
    const globalRangeZ = req.globalMaxZ - req.globalMinZ || 1

    for (let i = 0; i < req.pointCount; i++) {
      positions[i * 3]     = Math.round(((rawX[i] - minX) / rangeX) * 65535 - 32768)
      positions[i * 3 + 1] = Math.round(((rawY[i] - minY) / rangeY) * 65535 - 32768)
      positions[i * 3 + 2] = Math.round(((rawZ[i] - minZ) / rangeZ) * 65535 - 32768)

      const t = (rawZ[i] - req.globalMinZ) / globalRangeZ
      const rgb = elevationToRgb(t)
      colors[i * 4]     = rgb[0]
      colors[i * 4 + 1] = rgb[1]
      colors[i * 4 + 2] = rgb[2]
      colors[i * 4 + 3] = 255
    }

    // Step 6: Transfer decoded buffers to main thread — zero-copy
    self.postMessage(
      {
        type: 'decoded',
        chunkIndex: req.chunkIndex,
        positions, colors,
        pointCount: req.pointCount,
        minX, minY, minZ,
        maxX, maxY, maxZ,
      },
      [positions.buffer, colors.buffer]
    )

  } catch (err) {
    self.postMessage({
      type: 'error',
      chunkIndex: req.chunkIndex,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Elevation Colour ────────────────────────────────────────────────────────
// Duplicated from renderer — workers cannot import from main-thread modules

function elevationToRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0, 51, 204],
    [0, 204, 153],
    [51, 230, 26],
    [255, 204, 0],
    [255, 26, 0],
  ]
  const clamped = Math.min(Math.max(t, 0), 0.9999)
  const idx = clamped * (stops.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, stops.length - 1)
  const f = idx - lo
  return [
    Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
    Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
    Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
  ]
}