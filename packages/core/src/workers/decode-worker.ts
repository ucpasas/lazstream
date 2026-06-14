/**
 * Decode Worker — laz-perf WASM chunk decoder
 *
 * Module worker. Receives compressed chunk bytes via postMessage Transferable
 * (fetched on the main thread), decodes via laz-perf WASM, quantizes to Int16,
 * and returns Transferable buffers.
 *
 * laz-perf-worker.js must be patched before use:
 *   1. Environment check must accept WorkerGlobalScope (module workers)
 *   2. UMD tail replaced with: export default createLazPerf
 * See patch-lazperf.sh for the exact commands.
 *
 * Lifecycle:
 *   init  { lazPerfUrl, lazPerfWasmUrl } → load WASM → send { type: 'ready' }
 *   decode { compressedBytes, ... }       → WASM decode → send { type: 'decoded' }
 */

// Inlined from ../decode/color.ts — keeps decode-worker.js self-contained in
// the npm dist (no sibling chunk import that breaks module worker loading).
function elevationToRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0,   51,  204],
    [0,   204, 153],
    [51,  230, 26 ],
    [255, 204, 0  ],
    [255, 26,  0  ],
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

      // @vite-ignore: runtime import of the static laz-perf-worker.js from public/.
      // URL is passed via init so it resolves correctly in all hosting environments.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — dynamic URL import not in TS lib
      const mod = await import(/* @vite-ignore */ lazPerfUrl)
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

  // ── Decode: copy bytes into heap + decode + quantize ──────────────────────
  if (msg.type === 'decode') {
    decodeChunk(msg)
    return
  }

  // ── Decode-attrs: decode a single point and return its raw attributes ─────
  if (msg.type === 'decode-attrs') {
    decodePointAttrs(msg)
    return
  }
}

// ─── Single-Point Attribute Decode ───────────────────────────────────────────

function decodePointAttrs(req: {
  seqId: number
  compressedBytes: ArrayBuffer
  pointIndex: number
  pointDataRecordFormat: number
  pointDataRecordLength: number
  scaleX: number; scaleY: number; scaleZ: number
  offsetX: number; offsetY: number; offsetZ: number
}): void {
  try {
    if (!Module || !decoder) {
      throw new Error('Worker not initialised — decode-attrs called before init completed')
    }

    const compressedBytes = new Uint8Array(req.compressedBytes)

    if (compressedBytes.length > compressedAllocSize) {
      if (compressedPtr !== 0) Module._free(compressedPtr)
      compressedAllocSize = compressedBytes.length * 2
      compressedPtr = Module._malloc(compressedAllocSize)
      if (compressedPtr === 0) throw new Error(`Failed to allocate ${compressedAllocSize} bytes on WASM heap`)
    }
    Module.HEAPU8.set(compressedBytes, compressedPtr)

    decoder.open(req.pointDataRecordFormat, req.pointDataRecordLength, compressedPtr)

    // Advance decoder to the target point (inclusive)
    for (let i = 0; i <= req.pointIndex; i++) {
      decoder.getPoint(pointPtr)
    }

    const pdrf = req.pointDataRecordFormat
    const heap8: Uint8Array = Module.HEAPU8

    // XYZ (int32, bytes 0–11) → world coords
    const x = Module.HEAP32[(pointPtr >> 2)]     * req.scaleX + req.offsetX
    const y = Module.HEAP32[(pointPtr >> 2) + 1] * req.scaleY + req.offsetY
    const z = Module.HEAP32[(pointPtr >> 2) + 2] * req.scaleZ + req.offsetZ

    // Intensity — uint16 at bytes 12–13, all PDRFs
    const intensity = Module.HEAPU16[(pointPtr + 12) >> 1]

    // Return number + number of returns — byte 14, bit layout differs by PDRF family
    const byte14 = heap8[pointPtr + 14]
    const returnNumber    = pdrf <= 5 ? (byte14 & 0x07)        : (byte14 & 0x0F)
    const numberOfReturns = pdrf <= 5 ? ((byte14 >> 3) & 0x07) : ((byte14 >> 4) & 0x0F)

    // Classification — byte 15 bits 0–4 (PDRF 0–5) or byte 16 full byte (PDRF 6–10)
    const classification = pdrf <= 5
      ? (heap8[pointPtr + 15] & 0x1F)
      : heap8[pointPtr + 16]

    // GPS time — float64, present in PDRFs 1, 3, 5 (offset 20) and 6–10 (offset 22).
    // Both offsets are misaligned for HEAPF64 (requires 8-byte alignment) so we use DataView.
    let gpsTime: number | undefined
    if (pdrf === 1 || pdrf === 3 || pdrf === 5) {
      gpsTime = new DataView(Module.HEAPU8.buffer).getFloat64(pointPtr + 20, true)
    } else if (pdrf >= 6) {
      gpsTime = new DataView(Module.HEAPU8.buffer).getFloat64(pointPtr + 22, true)
    }

    // RGB — uint16 per channel, >> 8 to uint8. Same offsets as the bulk decode path.
    const hasRgb = pdrf === 2 || pdrf === 3 || pdrf === 5 || pdrf === 7 || pdrf === 8 || pdrf === 10
    const rgbByteOffset = pdrf === 2 ? 20 : (pdrf === 3 || pdrf === 5) ? 28 : 30
    const r = hasRgb ? Module.HEAPU16[(pointPtr + rgbByteOffset    ) >> 1] >> 8 : undefined
    const g = hasRgb ? Module.HEAPU16[(pointPtr + rgbByteOffset + 2) >> 1] >> 8 : undefined
    const b = hasRgb ? Module.HEAPU16[(pointPtr + rgbByteOffset + 4) >> 1] >> 8 : undefined

    self.postMessage({
      type: 'point-attrs',
      seqId: req.seqId,
      x, y, z,
      intensity,
      classification,
      returnNumber,
      numberOfReturns,
      gpsTime,
      r, g, b,
    })

  } catch (err) {
    self.postMessage({
      type: 'point-attrs-error',
      seqId: req.seqId,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Chunk Decode ────────────────────────────────────────────────────────────

function decodeChunk(req: {
  chunkIndex: number
  compressedBytes: ArrayBuffer    // Transferable — detached on main thread
  pointCount: number
  pointDataRecordFormat: number
  pointDataRecordLength: number
  scaleX: number; scaleY: number; scaleZ: number
  offsetX: number; offsetY: number; offsetZ: number
  globalMinZ: number
  globalMaxZ: number
}): void {
  try {
    if (!Module || !decoder) {
      throw new Error('Worker not initialised — decode called before init completed')
    }

    const t0 = performance.now()

    // Copy compressed bytes (Transferable) into WASM heap
    const compressedBytes = new Uint8Array(req.compressedBytes)

    if (compressedBytes.length > compressedAllocSize) {
      if (compressedPtr !== 0) Module._free(compressedPtr)
      compressedAllocSize = compressedBytes.length * 2
      compressedPtr = Module._malloc(compressedAllocSize)
      if (compressedPtr === 0) {
        throw new Error(`Failed to allocate ${compressedAllocSize} bytes on WASM heap`)
      }
    }
    Module.HEAPU8.set(compressedBytes, compressedPtr)

    decoder.open(req.pointDataRecordFormat, req.pointDataRecordLength, compressedPtr)

    // PDRFs with per-point RGB (uint16 per channel, >> 8 to uint8):
    //   PDRF 2        → RGB at byte offset 20
    //   PDRF 3, 5     → RGB at byte offset 28
    //   PDRF 7, 8, 10 → RGB at byte offset 30
    // All other PDRFs fall back to elevation coloring.
    const pdrf = req.pointDataRecordFormat
    const hasRgb = pdrf === 2 || pdrf === 3 || pdrf === 5
      || pdrf === 7 || pdrf === 8 || pdrf === 10
    const rgbByteOffset = pdrf === 2 ? 20 : (pdrf === 3 || pdrf === 5) ? 28 : 30

    const rawX = new Float64Array(req.pointCount)
    const rawY = new Float64Array(req.pointCount)
    const rawZ = new Float64Array(req.pointCount)
    const rawR = hasRgb ? new Uint8Array(req.pointCount) : null
    const rawG = hasRgb ? new Uint8Array(req.pointCount) : null
    const rawB = hasRgb ? new Uint8Array(req.pointCount) : null

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

      if (hasRgb) {
        // HEAPU16 reads uint16 (2 bytes); >> 1 converts byte offset to uint16 index.
        // LAS RGB is uint16 full-scale; >> 8 converts to uint8.
        rawR![i] = Module.HEAPU16[(pointPtr + rgbByteOffset    ) >> 1] >> 8
        rawG![i] = Module.HEAPU16[(pointPtr + rgbByteOffset + 2) >> 1] >> 8
        rawB![i] = Module.HEAPU16[(pointPtr + rgbByteOffset + 4) >> 1] >> 8
      }
    }

    // Quantize to Int16 per-chunk-local coords. Dequantize: world = (q + 32768) / 65535 * range + min
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

      if (hasRgb) {
        colors[i * 4]     = rawR![i]
        colors[i * 4 + 1] = rawG![i]
        colors[i * 4 + 2] = rawB![i]
        colors[i * 4 + 3] = 255
      } else {
        const t = (rawZ[i] - req.globalMinZ) / globalRangeZ
        const rgb = elevationToRgb(t)
        colors[i * 4]     = rgb[0]
        colors[i * 4 + 1] = rgb[1]
        colors[i * 4 + 2] = rgb[2]
        colors[i * 4 + 3] = 255
      }
    }

    const decodeMs = performance.now() - t0

    // Transfer decoded buffers to main thread — zero-copy
    ;(self as unknown as Worker).postMessage(
      {
        type: 'decoded',
        chunkIndex: req.chunkIndex,
        positions, colors,
        pointCount: req.pointCount,
        minX, minY, minZ,
        maxX, maxY, maxZ,
        decodeMs,
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

