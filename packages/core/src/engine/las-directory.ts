/**
 * LAS directory reader — raw header fields + VLR / EVLR records.
 *
 * Delivery, not interpretation (wiki [[Core Extension Contract]]): records
 * come back as raw bytes with their identifiers. CRS resolution, registry
 * labels, Extra Bytes semantics and vendor heuristics belong to add-ons.
 *
 * Tolerant by design: unlike the streaming path (fetchAndParseLasHeader),
 * this reader REPORTS rather than throws on files lazstream cannot stream —
 * LAS 1.0/1.1, uncompressed LAS, odd header sizes, truncated records. It
 * throws only when the bytes are not a LAS file at all, on URL validation
 * and on network errors. `streamable` runs the strict streaming parse on the
 * same bytes, so it agrees with what StreamingEngine.load() would do.
 *
 * Layouts (LAS 1.4 R15):
 *   public header — see fields below; 227 B (1.0–1.2), 235 B (1.3), 375 B (1.4)
 *   VLR header    — 54 B: reserved u16, user ID char[16], record ID u16,
 *                   length after header u16, description char[32]
 *   EVLR header   — 60 B: as VLR but length after header is u64
 */

import { validateSourceUrl } from '../network/url-validator.js'
import { fetchRange, probeUrl } from '../network/range-fetcher.js'
import { ParseError, parseLasHeader, parseLazVlr } from './header-parser.js'
import { classifyLazVersion } from '../types/las.js'

const INITIAL_FETCH = 8192
/** Same cap as the streaming header fetch. */
const MAX_HEADER_BYTES = 1024 * 1024
const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024
const EVLR_WINDOW = 64 * 1024
/** Bound on records walked, against malformed counts. */
const MAX_RECORDS = 4096
const MIN_HEADER = 227
const VLR_HEADER = 54
const EVLR_HEADER = 60

/** Every public-header field, as stored. Fields a version lacks are undefined. */
export interface LasHeaderRaw {
  fileSignature: string
  /** Bytes 4–5. LAS 1.0: reserved (part of a u32). */
  fileSourceId: number
  /** Bytes 6–7. LAS 1.0/1.1: reserved. */
  globalEncoding: number
  /** Project ID GUID, formatted xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx. */
  projectGuid: string
  versionMajor: number
  versionMinor: number
  systemIdentifier: string
  generatingSoftware: string
  creationDayOfYear: number
  creationYear: number
  headerSize: number
  pointDataOffset: number
  numberOfVLRs: number
  /** Byte 104 as stored — bits 6–7 are LASzip compression flags. */
  pointDataFormatByte: number
  /** Byte 104 & 0x3F. */
  pointDataRecordFormat: number
  pointDataRecordLength: number
  legacyPointCount: number
  legacyPointsByReturn: number[]
  scaleX: number; scaleY: number; scaleZ: number
  offsetX: number; offsetY: number; offsetZ: number
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
  /** LAS 1.3+. */
  startOfWaveformData?: number
  /** LAS 1.4. */
  startOfFirstEvlr?: number
  /** LAS 1.4. */
  numberOfEVLRs?: number
  /** LAS 1.4 64-bit count when present, else the legacy count. */
  pointCount: number
  /** LAS 1.4: 15 return counts. */
  pointsByReturn?: number[]
}

export interface RawVlr {
  kind: 'vlr' | 'evlr'
  userId: string
  recordId: number
  description: string
  /** File offset of the record header. */
  fileOffset: number
  /** File offset of the record data. */
  dataOffset: number
  /** Record data length in bytes (length after header). */
  length: number
  /** Present only with includeData and length ≤ maxRecordBytes. */
  data?: ArrayBuffer
  /** Data was requested but not returned (over maxRecordBytes, or the record runs past the bytes available). */
  truncated?: boolean
}

export type LasCompression = 'laz' | 'none' | 'unknown'

export interface LasDirectory {
  url: string
  header: LasHeaderRaw
  /** 'laz' = LASzip VLR present; 'unknown' = compression bit set without one. */
  compression: LasCompression
  /** True when the streaming path would accept this file. */
  streamable: boolean
  vlrs: RawVlr[]
  /** Everything odd about the file, including why it is not streamable. */
  warnings: string[]
}

export interface LasDirectoryOptions {
  /** Return record bytes (VLRs and, with includeEvlrs, EVLRs). Default false. */
  includeData?: boolean
  /** Walk LAS 1.4 EVLRs after the point data (extra range requests). Default false. */
  includeEvlrs?: boolean
  /** Per-record data cap; larger records come back truncated. Default 1 MB. */
  maxRecordBytes?: number
  signal?: AbortSignal
}

/**
 * Read a LAS/LAZ file's raw header and VLR directory from a cloud URL,
 * fetching only the header block (plus EVLR headers when asked).
 * @experimental
 */
export async function readLasDirectory(url: string, opts: LasDirectoryOptions = {}): Promise<LasDirectory> {
  const valid = validateSourceUrl(url).toString()
  let buffer = await fetchRange(valid, 0, INITIAL_FETCH - 1, opts.signal)
  const header = parseRawHeader(new DataView(buffer))
  if (header.pointDataOffset > buffer.byteLength && buffer.byteLength >= INITIAL_FETCH) {
    const end = Math.min(header.pointDataOffset, MAX_HEADER_BYTES)
    buffer = await fetchRange(valid, 0, end - 1, opts.signal)
  }
  return directoryFromHeaderBytes(valid, buffer, undefined, opts)
}

/**
 * Directory from header bytes already fetched (starting at file offset 0).
 * Used by StreamingEngine.getDirectory() to avoid a second header fetch.
 * `fileSize` bounds the EVLR walk; probed when unknown and EVLRs are wanted.
 */
export async function directoryFromHeaderBytes(
  url: string, buffer: ArrayBuffer, fileSize: number | undefined, opts: LasDirectoryOptions = {},
): Promise<LasDirectory> {
  const view = new DataView(buffer)
  const header = parseRawHeader(view)
  const warnings: string[] = []
  const maxRecord = opts.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES

  checkHeaderShape(header, buffer.byteLength, warnings)
  const vlrs = readVlrs(view, header, opts.includeData ?? false, maxRecord, warnings)

  const hasLazVlr = vlrs.some(v => v.userId === 'laszip encoded' && v.recordId === 22204)
  const compressionBits = header.pointDataFormatByte & 0xC0
  const compression: LasCompression = hasLazVlr ? 'laz' : compressionBits ? 'unknown' : 'none'
  if (compression === 'unknown') warnings.push('Point format byte has a compression bit set but there is no LASzip VLR.')

  let streamable = false
  try {
    const strict = parseLasHeader(view)
    const lazVlr = parseLazVlr(buffer, strict)
    if (classifyLazVersion(strict, lazVlr) === 'unsupported') {
      throw new ParseError(`LAS ${strict.versionMajor}.${strict.versionMinor} is not supported for streaming.`)
    }
    streamable = true
  } catch (err) {
    warnings.push(`Not streamable: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (opts.includeEvlrs) {
    const n = header.numberOfEVLRs ?? 0
    const start = header.startOfFirstEvlr ?? 0
    if (n > 0 && start > 0) {
      const size = fileSize ?? (await probeUrl(url, opts.signal)).fileSize
      vlrs.push(...await readEvlrs(url, start, n, size, opts.includeData ?? false, maxRecord, warnings, opts.signal))
    }
  }

  return { url, header, compression, streamable, vlrs, warnings }
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function readString(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trimEnd()
}

function readU64(view: DataView, offset: number): number {
  return view.getUint32(offset + 4, true) * 0x100000000 + view.getUint32(offset, true)
}

function hex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0')
}

function readGuid(view: DataView): string {
  const d4: string[] = []
  for (let i = 16; i < 24; i++) d4.push(hex(view.getUint8(i), 2))
  return `${hex(view.getUint32(8, true), 8)}-${hex(view.getUint16(12, true), 4)}-` +
    `${hex(view.getUint16(14, true), 4)}-${d4.slice(0, 2).join('')}-${d4.slice(2).join('')}`
}

/** Throws ParseError only when the bytes are not a LAS header at all. */
function parseRawHeader(view: DataView): LasHeaderRaw {
  if (view.byteLength < MIN_HEADER) {
    throw new ParseError(`Not a LAS file: ${view.byteLength} bytes is smaller than the ${MIN_HEADER}-byte LAS header.`)
  }
  const fileSignature = readString(view, 0, 4)
  if (fileSignature !== 'LASF') {
    throw new ParseError(`Not a LAS file: signature is "${fileSignature}", expected "LASF".`)
  }
  const versionMinor = view.getUint8(25)
  const headerSize = view.getUint16(94, true)
  const has = (end: number) => headerSize >= end && view.byteLength >= end
  const formatByte = view.getUint8(104)
  const legacyPointCount = view.getUint32(107, true)

  const header: LasHeaderRaw = {
    fileSignature,
    fileSourceId: view.getUint16(4, true),
    globalEncoding: view.getUint16(6, true),
    projectGuid: readGuid(view),
    versionMajor: view.getUint8(24),
    versionMinor,
    systemIdentifier: readString(view, 26, 32),
    generatingSoftware: readString(view, 58, 32),
    creationDayOfYear: view.getUint16(90, true),
    creationYear: view.getUint16(92, true),
    headerSize,
    pointDataOffset: view.getUint32(96, true),
    numberOfVLRs: view.getUint32(100, true),
    pointDataFormatByte: formatByte,
    pointDataRecordFormat: formatByte & 0x3F,
    pointDataRecordLength: view.getUint16(105, true),
    legacyPointCount,
    legacyPointsByReturn: [0, 1, 2, 3, 4].map(i => view.getUint32(111 + i * 4, true)),
    scaleX: view.getFloat64(131, true), scaleY: view.getFloat64(139, true), scaleZ: view.getFloat64(147, true),
    offsetX: view.getFloat64(155, true), offsetY: view.getFloat64(163, true), offsetZ: view.getFloat64(171, true),
    maxX: view.getFloat64(179, true), minX: view.getFloat64(187, true),
    maxY: view.getFloat64(195, true), minY: view.getFloat64(203, true),
    maxZ: view.getFloat64(211, true), minZ: view.getFloat64(219, true),
    pointCount: legacyPointCount,
  }
  if (versionMinor >= 3 && has(235)) header.startOfWaveformData = readU64(view, 227)
  if (versionMinor >= 4 && has(375)) {
    header.startOfFirstEvlr = readU64(view, 235)
    header.numberOfEVLRs = view.getUint32(243, true)
    header.pointCount = readU64(view, 247)
    header.pointsByReturn = Array.from({ length: 15 }, (_, i) => readU64(view, 255 + i * 8))
  }
  return header
}

function checkHeaderShape(h: LasHeaderRaw, available: number, warnings: string[]): void {
  if (h.versionMajor !== 1 || h.versionMinor > 4) {
    warnings.push(`Unknown LAS version ${h.versionMajor}.${h.versionMinor}; fields read with the 1.4 layout.`)
  }
  const expected = h.versionMinor >= 4 ? 375 : h.versionMinor === 3 ? 235 : 227
  if (h.versionMajor === 1 && h.headerSize < expected) {
    warnings.push(`Header size ${h.headerSize} B is smaller than the ${expected} B LAS 1.${h.versionMinor} header.`)
  }
  if (h.pointDataOffset < h.headerSize) {
    warnings.push(`Offset to point data (${h.pointDataOffset}) is inside the header (${h.headerSize} B).`)
  }
  if (h.pointDataOffset > available) {
    warnings.push(`VLR block (${h.pointDataOffset} B) exceeds the ${available} B read; later VLRs may be missing.`)
  }
  if (h.pointDataRecordFormat > 10) warnings.push(`Unknown point data record format ${h.pointDataRecordFormat}.`)
}

function readVlrs(
  view: DataView, h: LasHeaderRaw, includeData: boolean, maxRecord: number, warnings: string[],
): RawVlr[] {
  const out: RawVlr[] = []
  const limit = Math.min(view.byteLength, h.pointDataOffset)
  let offset = h.headerSize
  const count = Math.min(h.numberOfVLRs, MAX_RECORDS)
  for (let i = 0; i < count; i++) {
    if (offset + VLR_HEADER > limit) {
      warnings.push(`Header declares ${h.numberOfVLRs} VLRs but only ${i} fit before offset ${limit}.`)
      break
    }
    const length = view.getUint16(offset + 20, true)
    const dataOffset = offset + VLR_HEADER
    const vlr: RawVlr = {
      kind: 'vlr',
      userId: readString(view, offset + 2, 16),
      recordId: view.getUint16(offset + 18, true),
      description: readString(view, offset + 22, 32),
      fileOffset: offset,
      dataOffset,
      length,
    }
    const fits = dataOffset + length <= limit
    if (!fits) warnings.push(`VLR ${i} (${vlr.userId}/${vlr.recordId}) runs past offset ${limit}.`)
    if (includeData) {
      if (fits && length <= maxRecord) vlr.data = (view.buffer as ArrayBuffer).slice(view.byteOffset + dataOffset, view.byteOffset + dataOffset + length)
      else vlr.truncated = true
    }
    out.push(vlr)
    offset = dataOffset + length
  }
  if (h.numberOfVLRs > MAX_RECORDS) warnings.push(`Only the first ${MAX_RECORDS} of ${h.numberOfVLRs} VLRs were read.`)
  return out
}

async function readEvlrs(
  url: string, start: number, count: number, fileSize: number,
  includeData: boolean, maxRecord: number, warnings: string[], signal?: AbortSignal,
): Promise<RawVlr[]> {
  const out: RawVlr[] = []
  let win: DataView | null = null
  let winStart = 0
  let offset = start
  const n = Math.min(count, MAX_RECORDS)
  for (let i = 0; i < n; i++) {
    if (offset + EVLR_HEADER > fileSize) {
      warnings.push(`Header declares ${count} EVLRs but only ${i} fit before end of file (${fileSize} B).`)
      break
    }
    if (!win || offset < winStart || offset + EVLR_HEADER > winStart + win.byteLength) {
      const end = Math.min(fileSize, offset + EVLR_WINDOW)
      win = new DataView(await fetchRange(url, offset, end - 1, signal))
      winStart = offset
    }
    const at = offset - winStart
    const length = readU64(win, at + 20)
    const dataOffset = offset + EVLR_HEADER
    const evlr: RawVlr = {
      kind: 'evlr',
      userId: readString(win, at + 2, 16),
      recordId: win.getUint16(at + 18, true),
      description: readString(win, at + 28, 32),
      fileOffset: offset,
      dataOffset,
      length,
    }
    const fits = dataOffset + length <= fileSize
    if (!fits) warnings.push(`EVLR ${i} (${evlr.userId}/${evlr.recordId}) runs past end of file.`)
    if (includeData) {
      if (!fits || length > maxRecord) {
        evlr.truncated = true
      } else if (length === 0) {
        evlr.data = new ArrayBuffer(0)
      } else if (dataOffset + length <= winStart + win.byteLength) {
        const rel = dataOffset - winStart
        evlr.data = (win.buffer as ArrayBuffer).slice(win.byteOffset + rel, win.byteOffset + rel + length)
      } else {
        evlr.data = await fetchRange(url, dataOffset, dataOffset + length - 1, signal)
      }
    }
    out.push(evlr)
    offset = dataOffset + length
  }
  if (count > MAX_RECORDS) warnings.push(`Only the first ${MAX_RECORDS} of ${count} EVLRs were read.`)
  return out
}
