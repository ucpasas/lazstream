/**
 * Pure helpers for LAZ 1.4 layered chunks (compressor 3, PDRF 6–10).
 *
 * Fixed-size layered chunk layout (LASzip 1.4 R1):
 *   [raw first point: reclen B][u32 pointCount][u32 layerSize × L][layer bytes, same order]
 *
 * laz-perf's ChunkDecoder treats a zero layer size as "field unchanged from
 * the first point" and never runs that field's decoder. So a chunk rewritten
 * with skipped layers' sizes zeroed and their bytes removed (a "compact"
 * chunk) decodes the kept fields bit-identically — and the skipped fields as
 * PLAUSIBLE CONSTANTS. Nothing downstream may read a field outside the
 * chunk's fieldsPresent.
 *
 * All byte ranges here are relative to the chunk start. No DOM/WebGPU.
 */

import type { ChunkTableEntry } from '../types/las.js'
import { fieldBit, type LasField } from './fields.js'

export const LAYERED_BASE_LEN: Record<number, number> = { 6: 30, 7: 36, 8: 38, 9: 59, 10: 67 }

/** Skip the selective plan (fetch whole chunk) when fewer bytes than this are skippable. */
export const MIN_SKIP_BYTES = 2048

export type LayerName = 'xy' | 'z' | 'classification' | 'flags' | 'intensity' | 'scan_angle'
  | 'user_data' | 'point_source_id' | 'gps_time' | 'rgb' | 'nir' | 'wavepacket' | `extra_${number}`

export interface LayerTable {
  pointCount: number
  sizes: Uint32Array
}

export interface ByteRange {
  /** Inclusive. */
  start: number
  /** Exclusive. */
  end: number
}

/** Layer order for a layered PDRF. Throws for PDRF < 6. */
export function layerNames(pdrf: number, recordLength: number): LayerName[] {
  const base = LAYERED_BASE_LEN[pdrf]
  if (base === undefined) throw new Error(`PDRF ${pdrf} has no layered encoding`)
  const names: LayerName[] = [
    'xy', 'z', 'classification', 'flags', 'intensity',
    'scan_angle', 'user_data', 'point_source_id', 'gps_time',
  ]
  if (pdrf === 7 || pdrf === 8 || pdrf === 10) names.push('rgb')
  if (pdrf === 8 || pdrf === 10) names.push('nir')
  if (pdrf === 9 || pdrf === 10) names.push('wavepacket')
  const extra = recordLength - base
  for (let i = 0; i < extra; i++) names.push(`extra_${i}`)
  return names
}

/** Bytes before the first layer: raw first point + point count + layer sizes. */
export function layerPrefixLength(recordLength: number, layerCount: number): number {
  return recordLength + 4 + 4 * layerCount
}

/** Parse the layer table from (at least) the first layerPrefixLength bytes of a chunk. */
export function parseLayerTable(prefix: ArrayBuffer, recordLength: number, layerCount: number): LayerTable {
  const need = layerPrefixLength(recordLength, layerCount)
  if (prefix.byteLength < need) {
    throw new Error(`layer table needs ${need} bytes, got ${prefix.byteLength}`)
  }
  const view = new DataView(prefix)
  const pointCount = view.getUint32(recordLength, true)
  const sizes = new Uint32Array(layerCount)
  for (let i = 0; i < layerCount; i++) sizes[i] = view.getUint32(recordLength + 4 + 4 * i, true)
  return { pointCount, sizes }
}

/** A layer table is trusted only if it reproduces the chunk table entry exactly. */
export function validateLayerTable(t: LayerTable, entry: ChunkTableEntry, recordLength: number): boolean {
  if (t.pointCount !== entry.pointCount) return false
  let sum = layerPrefixLength(recordLength, t.sizes.length)
  for (let i = 0; i < t.sizes.length; i++) sum += t.sizes[i]
  return sum === entry.compressedSize
}

/** Layers each field needs. Fields with no layer in this PDRF map to nothing. */
const FIELD_LAYERS: Record<LasField, (name: LayerName) => boolean> = {
  xyz:            n => n === 'xy' || n === 'z',
  returns:        n => n === 'xy',            // channel + returns live in layer 0
  flags:          n => n === 'xy' || n === 'flags',
  classification: n => n === 'classification',
  intensity:      n => n === 'intensity',
  scanAngle:      n => n === 'scan_angle',
  userData:       n => n === 'user_data',
  pointSourceId:  n => n === 'point_source_id',
  gpsTime:        n => n === 'gps_time',
  rgb:            n => n === 'rgb',
  nir:            n => n === 'nir',
  wavepacket:     n => n === 'wavepacket',
  extraBytes:     n => n.startsWith('extra_'),
}

/** Field mask → kept-layer flags. xy and z are always kept (xyz is forced). */
export function layersForFields(fieldBits: number, names: LayerName[]): boolean[] {
  const keep = names.map(n => n === 'xy' || n === 'z')
  for (const field of Object.keys(FIELD_LAYERS) as LasField[]) {
    if (!(fieldBits & fieldBit(field))) continue
    const uses = FIELD_LAYERS[field]
    for (let i = 0; i < names.length; i++) if (uses(names[i])) keep[i] = true
  }
  return keep
}

/**
 * Kept-layer flags → bits of the fields whose data is fully present. A field
 * with no layer in this PDRF (e.g. rgb in PDRF 6) is never reported. This is
 * the canonical mask of a compact chunk: two field masks that keep the same
 * layers yield the same bits (and so share one cache entry).
 */
export function fieldBitsForLayers(keep: boolean[], names: LayerName[]): number {
  let bits = 0
  for (const field of Object.keys(FIELD_LAYERS) as LasField[]) {
    const uses = FIELD_LAYERS[field]
    let any = false
    let all = true
    for (let i = 0; i < names.length; i++) {
      if (!uses(names[i])) continue
      any = true
      if (!keep[i]) { all = false; break }
    }
    if (any && all) bits |= fieldBit(field)
  }
  return bits
}

/** Bytes a keep-plan would not fetch. */
export function skippableBytes(sizes: Uint32Array, keep: boolean[]): number {
  let n = 0
  for (let i = 0; i < sizes.length; i++) if (!keep[i]) n += sizes[i]
  return n
}

/**
 * Chunk-relative byte ranges covering the kept layers. Adjacent kept layers
 * merge. With includePrefix (default), range 0 starts at 0 and covers the
 * layer table; without it (P3 top-up), only the kept layers are covered.
 */
export function plannedRanges(
  sizes: Uint32Array,
  names: LayerName[],
  recordLength: number,
  keep: boolean[],
  opts: { includePrefix?: boolean } = {},
): ByteRange[] {
  const includePrefix = opts.includePrefix ?? true
  const prefixLen = layerPrefixLength(recordLength, names.length)
  const ranges: ByteRange[] = includePrefix ? [{ start: 0, end: prefixLen }] : []
  let rel = prefixLen
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    if (keep[i] && size > 0) {
      const last = ranges[ranges.length - 1]
      if (last && last.end === rel) last.end = rel + size
      else ranges.push({ start: rel, end: rel + size })
    }
    rel += size
  }
  return ranges
}

/** Copy [relStart, relStart+len) out of fetched pieces into dst. */
function copyFromPieces(
  pieces: ArrayBuffer[], ranges: ByteRange[], relStart: number, len: number,
  dst: Uint8Array, dstOffset: number,
): void {
  for (let r = 0; r < ranges.length; r++) {
    const range = ranges[r]
    if (relStart >= range.start && relStart + len <= range.end) {
      dst.set(new Uint8Array(pieces[r], relStart - range.start, len), dstOffset)
      return
    }
  }
  throw new Error(`bytes [${relStart}, ${relStart + len}) not covered by fetched ranges`)
}

/**
 * Build the compact chunk laz-perf decodes: the prefix with non-kept layers'
 * sizes set to 0, then the kept layers' bytes in storage order.
 * `pieces[i]` holds the bytes of `ranges[i]` (from plannedRanges with prefix).
 */
export function compactChunk(
  pieces: ArrayBuffer[],
  ranges: ByteRange[],
  sizes: Uint32Array,
  names: LayerName[],
  recordLength: number,
  keep: boolean[],
): ArrayBuffer {
  const prefixLen = layerPrefixLength(recordLength, names.length)
  let total = prefixLen
  for (let i = 0; i < sizes.length; i++) if (keep[i]) total += sizes[i]

  const out = new Uint8Array(total)
  copyFromPieces(pieces, ranges, 0, prefixLen, out, 0)
  const view = new DataView(out.buffer)
  for (let i = 0; i < sizes.length; i++) {
    view.setUint32(recordLength + 4 + 4 * i, keep[i] ? sizes[i] : 0, true)
  }

  let rel = prefixLen
  let w = prefixLen
  for (let i = 0; i < sizes.length; i++) {
    if (keep[i] && sizes[i] > 0) {
      copyFromPieces(pieces, ranges, rel, sizes[i], out, w)
      w += sizes[i]
    }
    rel += sizes[i]
  }
  return out.buffer
}

/**
 * P3: grow a compact chunk from keep `haveKeep` to keep `wantKeep`
 * (have ⊆ want) by splicing in the missing layers' bytes. `missingPieces[i]`
 * holds `missingRanges[i]` (from plannedRanges(..., want∖have, {includePrefix:false})).
 * Output equals compactChunk(...) built from scratch for `wantKeep`, byte for byte.
 */
export function mergeCompact(
  compact: ArrayBuffer,
  haveKeep: boolean[],
  missingPieces: ArrayBuffer[],
  missingRanges: ByteRange[],
  sizes: Uint32Array,
  names: LayerName[],
  recordLength: number,
  wantKeep: boolean[],
): ArrayBuffer {
  for (let i = 0; i < sizes.length; i++) {
    if (haveKeep[i] && !wantKeep[i]) throw new Error('mergeCompact: have must be a subset of want')
  }
  const prefixLen = layerPrefixLength(recordLength, names.length)
  let total = prefixLen
  for (let i = 0; i < sizes.length; i++) if (wantKeep[i]) total += sizes[i]

  const src = new Uint8Array(compact)
  const out = new Uint8Array(total)
  out.set(src.subarray(0, prefixLen), 0)
  const view = new DataView(out.buffer)
  for (let i = 0; i < sizes.length; i++) {
    view.setUint32(recordLength + 4 + 4 * i, wantKeep[i] ? sizes[i] : 0, true)
  }

  let rel = prefixLen       // offset in the original chunk
  let haveOff = prefixLen   // offset in the existing compact chunk
  let w = prefixLen
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]
    if (haveKeep[i]) {
      out.set(src.subarray(haveOff, haveOff + size), w)
      haveOff += size
      w += size
    } else if (wantKeep[i]) {
      if (size > 0) copyFromPieces(missingPieces, missingRanges, rel, size, out, w)
      w += size
    }
    rel += size
  }
  return out.buffer
}
