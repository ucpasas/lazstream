/**
 * Per-point attribute surfacing for the decode worker.
 *
 * Imported ONLY by decode-worker.ts (and tests). It must stay import-free so
 * Rollup inlines it into the decode-worker entry — a shared chunk would make
 * the npm dist's module worker load a sibling file (see the elevationToRgb
 * comment in decode-worker.ts). That is also why the field bits below are
 * duplicated from decode/fields.ts rather than imported; a unit test pins
 * them to LAS_FIELDS order.
 */

/** Bit per LasField, in decode/fields.ts LAS_FIELDS order. */
export const FIELD_BIT = {
  xyz:            1 << 0,
  intensity:      1 << 1,
  returns:        1 << 2,
  flags:          1 << 3,
  classification: 1 << 4,
  scanAngle:      1 << 5,
  userData:       1 << 6,
  pointSourceId:  1 << 7,
  gpsTime:        1 << 8,
  rgb:            1 << 9,
  nir:            1 << 10,
  wavepacket:     1 << 11,
  extraBytes:     1 << 12,
} as const

/**
 * Byte offsets within one decoded LAS point record. -1 = absent in that format.
 *
 * Extended family (PDRF 6–10):
 *   14 returns (lo nibble = return number, hi nibble = number of returns)
 *   15 flags: classification flags b0–3, scanner channel b4–5, scan dir b6, edge b7
 *   17 user data · 18 int16 scan angle ×0.006° · 20 u16 point source ID
 *   22 f64 GPS time · 36 u16 NIR (PDRF 8/10)
 * Legacy family (PDRF 0–5):
 *   14 returns (b0–2 return number, b3–5 number of returns, b6 scan dir, b7 edge)
 *   15 classification (b0–4) + flags synthetic/key-point/withheld (b5–7)
 *   16 int8 scan angle rank (degrees) · 17 user data · 18 u16 point source ID
 *   20 f64 GPS time (PDRF 1/3/4/5)
 */
interface FormatLayout {
  extended: boolean
  scanAngle: number
  userData: number
  pointSourceId: number
  gpsTime: number
  nir: number
  baseLength: number
}

const LAYOUTS: Record<number, FormatLayout> = {
  0:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: -1, nir: -1, baseLength: 20 },
  1:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: 20, nir: -1, baseLength: 28 },
  2:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: -1, nir: -1, baseLength: 26 },
  3:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: 20, nir: -1, baseLength: 34 },
  4:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: 20, nir: -1, baseLength: 57 },
  5:  { extended: false, scanAngle: 16, userData: 17, pointSourceId: 18, gpsTime: 20, nir: -1, baseLength: 63 },
  6:  { extended: true,  scanAngle: 18, userData: 17, pointSourceId: 20, gpsTime: 22, nir: -1, baseLength: 30 },
  7:  { extended: true,  scanAngle: 18, userData: 17, pointSourceId: 20, gpsTime: 22, nir: -1, baseLength: 36 },
  8:  { extended: true,  scanAngle: 18, userData: 17, pointSourceId: 20, gpsTime: 22, nir: 36, baseLength: 38 },
  9:  { extended: true,  scanAngle: 18, userData: 17, pointSourceId: 20, gpsTime: 22, nir: -1, baseLength: 59 },
  10: { extended: true,  scanAngle: 18, userData: 17, pointSourceId: 20, gpsTime: 22, nir: 36, baseLength: 67 },
}

/** Mirrors the public ChunkAttributes type (decode/worker-pool.ts). */
export interface SurfacedAttributes {
  intensityRaw?: Uint16Array
  returnNumber?: Uint8Array
  numberOfReturns?: Uint8Array
  flags?: Uint8Array
  flagsLayout?: 'legacy' | 'extended'
  scanAngle?: Float32Array
  userData?: Uint8Array
  pointSourceId?: Uint16Array
  gpsTime?: Float64Array
  nir?: Uint16Array
  extraBytes?: { stride: number; data: Uint8Array }
}

/**
 * Allocate output arrays for the requested fields that exist in this format.
 * Returns null when nothing is to be surfaced (the default path stays
 * byte-identical: no `attributes` key in the worker message at all).
 * xyz / classification / rgb have native DecodedChunk slots and wavepacket is
 * never surfaced, so those bits are ignored.
 */
export function allocSurfacedAttributes(
  surfaceBits: number, pdrf: number, recordLength: number, pointCount: number,
): SurfacedAttributes | null {
  const layout = LAYOUTS[pdrf]
  if (!layout || surfaceBits === 0) return null
  const out: SurfacedAttributes = {}
  let any = false
  if (surfaceBits & FIELD_BIT.intensity) { out.intensityRaw = new Uint16Array(pointCount); any = true }
  if (surfaceBits & FIELD_BIT.returns) {
    out.returnNumber = new Uint8Array(pointCount)
    out.numberOfReturns = new Uint8Array(pointCount)
    any = true
  }
  if (surfaceBits & FIELD_BIT.flags) {
    out.flags = new Uint8Array(pointCount)
    out.flagsLayout = layout.extended ? 'extended' : 'legacy'
    any = true
  }
  if (surfaceBits & FIELD_BIT.scanAngle) { out.scanAngle = new Float32Array(pointCount); any = true }
  if (surfaceBits & FIELD_BIT.userData) { out.userData = new Uint8Array(pointCount); any = true }
  if (surfaceBits & FIELD_BIT.pointSourceId) { out.pointSourceId = new Uint16Array(pointCount); any = true }
  if ((surfaceBits & FIELD_BIT.gpsTime) && layout.gpsTime >= 0) { out.gpsTime = new Float64Array(pointCount); any = true }
  if ((surfaceBits & FIELD_BIT.nir) && layout.nir >= 0) { out.nir = new Uint16Array(pointCount); any = true }
  const extra = recordLength - layout.baseLength
  if ((surfaceBits & FIELD_BIT.extraBytes) && extra > 0) {
    out.extraBytes = { stride: extra, data: new Uint8Array(pointCount * extra) }
    any = true
  }
  return any ? out : null
}

/**
 * Copy point i's surfaced fields out of a decoded record at `ptr` in `view`
 * (the WASM heap in the worker). DataView handles the misaligned u16/f64 reads.
 */
export function readSurfacedPoint(
  view: DataView, ptr: number, i: number, pdrf: number, out: SurfacedAttributes,
): void {
  const layout = LAYOUTS[pdrf]
  if (out.intensityRaw) out.intensityRaw[i] = view.getUint16(ptr + 12, true)
  if (out.returnNumber) {
    const b = view.getUint8(ptr + 14)
    if (layout.extended) {
      out.returnNumber[i] = b & 0x0F
      out.numberOfReturns![i] = (b >> 4) & 0x0F
    } else {
      out.returnNumber[i] = b & 0x07
      out.numberOfReturns![i] = (b >> 3) & 0x07
    }
  }
  if (out.flags) {
    // Legacy flags are repacked so bits 0–2 and 6–7 mean the same as in the
    // extended byte: synthetic/key-point/withheld → b0–2, scan dir → b6, edge → b7.
    out.flags[i] = layout.extended
      ? view.getUint8(ptr + 15)
      : ((view.getUint8(ptr + 15) >> 5) & 0x07) | (view.getUint8(ptr + 14) & 0xC0)
  }
  if (out.scanAngle) {
    out.scanAngle[i] = layout.extended
      ? view.getInt16(ptr + layout.scanAngle, true) * 0.006
      : view.getInt8(ptr + layout.scanAngle)
  }
  if (out.userData) out.userData[i] = view.getUint8(ptr + layout.userData)
  if (out.pointSourceId) out.pointSourceId[i] = view.getUint16(ptr + layout.pointSourceId, true)
  if (out.gpsTime) out.gpsTime[i] = view.getFloat64(ptr + layout.gpsTime, true)
  if (out.nir) out.nir[i] = view.getUint16(ptr + layout.nir, true)
  if (out.extraBytes) {
    const { stride, data } = out.extraBytes
    const base = ptr + layout.baseLength
    for (let k = 0; k < stride; k++) data[i * stride + k] = view.getUint8(base + k)
  }
}

/** ArrayBuffers to add to the postMessage transfer list. */
export function surfacedTransferList(out: SurfacedAttributes): ArrayBuffer[] {
  const list: ArrayBuffer[] = []
  for (const v of [out.intensityRaw, out.returnNumber, out.numberOfReturns, out.flags,
    out.scanAngle, out.userData, out.pointSourceId, out.gpsTime, out.nir, out.extraBytes?.data]) {
    if (v) list.push(v.buffer as ArrayBuffer)
  }
  return list
}
