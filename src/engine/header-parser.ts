/**
 * LAS Header Parser
 *
 * Reads the LAS 1.x public header block and the LAZ VLR.
 * Reference: LAS 1.4 spec table 4, LASzip spec section 2.
 *
 * LAS header layout (LAS 1.4, 375 bytes):
 *   0–3    File signature ("LASF")
 *   4–5    File source ID
 *   6–7    Global encoding
 *   8–11   Project ID GUID data 1
 *   12–13  Project ID GUID data 2
 *   14–15  Project ID GUID data 3
 *   16–23  Project ID GUID data 4
 *   24     Version major
 *   25     Version minor
 *   26–57  System identifier
 *   58–89  Generating software
 *   90–91  File creation day of year
 *   92–93  File creation year
 *   94–95  Header size
 *   96–99  Offset to point data
 *   100–103 Number of VLRs
 *   104    Point data format ID
 *   105–106 Point data record length
 *   107–110 Legacy point count (LAS 1.2/1.3)
 *   ...
 *   179–218 Scale factors (X, Y, Z as float64)
 *   219–258 Offsets (X, Y, Z as float64)
 *   259–298 Max/min X, Y, Z (6 × float64)
 *   ...
 *
 * Phase 3 Track A — Step 2 (cancellation):
 *   fetchAndParseLasHeader accepts an optional AbortSignal that is
 *   passed straight to its internal fetchRange calls. When the signal
 *   fires, fetches throw AbortError; the engine treats this as a
 *   silent end to the cancelled load.
 */

import type { LasHeader, LazVlr } from '../types/las.js'
import { fetchRange } from '../network/range-fetcher.js'

// LAS magic bytes — all valid LAS files start with this
const LAS_MAGIC = 'LASF'

// LAZ VLR identifiers
const LAZ_USER_ID = 'laszip encoded'
const LAZ_RECORD_ID = 22204

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

/**
 * Parse the LAS public header block from a DataView.
 * The buffer must contain at least `headerSize` bytes starting at offset 0.
 */
export function parseLasHeader(view: DataView): LasHeader {
  // Validate magic bytes
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1),
    view.getUint8(2), view.getUint8(3)
  )
  if (magic !== LAS_MAGIC) {
    throw new ParseError(
      `Invalid LAS file — expected "LASF" signature, got "${magic}". ` +
      `This may not be a LAS/LAZ file.`
    )
  }

  const versionMajor = view.getUint8(24)
  const versionMinor = view.getUint8(25)

  // Reject uncompressed LAS
  // (We check for LAZ VLR later; this is just a version sanity check)
  if (versionMajor !== 1 || versionMinor < 2) {
    throw new ParseError(
      `Unsupported LAS version ${versionMajor}.${versionMinor}. ` +
      `lazstream supports LAS 1.2, 1.3, and 1.4 compressed as LAZ.`
    )
  }

  const headerSize = view.getUint16(94, true)
  const pointDataOffset = view.getUint32(96, true)
  const numberOfVLRs = view.getUint32(100, true)
  const pointDataRecordFormat = view.getUint8(104) & 0x7F  // Mask bit 7 (compression flag)
  const pointDataRecordLength = view.getUint16(105, true)

  // Point count — LAS 1.4 uses uint64 at offset 247; older versions use uint32 at 107
  // We read both and prefer the LAS 1.4 field when present
  let pointCount: number
  if (versionMinor >= 4) {
    // LAS 1.4: legacy count at 107 may be 0; real count at 247 (uint64)
    // JS can't handle full uint64, but LAZ files we care about are < 2^53 points
    const lo = view.getUint32(247, true)
    const hi = view.getUint32(251, true)
    pointCount = hi * 0x100000000 + lo
  } else {
    pointCount = view.getUint32(107, true)
  }

  // Scale factors (3 × float64 at offset 131)
  const scaleX = view.getFloat64(131, true)
  const scaleY = view.getFloat64(139, true)
  const scaleZ = view.getFloat64(147, true)

  // Offsets (3 × float64 at offset 155)
  const offsetX = view.getFloat64(155, true)
  const offsetY = view.getFloat64(163, true)
  const offsetZ = view.getFloat64(171, true)

  // Bounding box — layout differs between LAS versions
  // LAS 1.4 (375 byte header): max/min at 179 (6 × 2 × float64)
  // Older: same layout, different header size but same offsets
  const maxX = view.getFloat64(179, true)
  const minX = view.getFloat64(187, true)
  const maxY = view.getFloat64(195, true)
  const minY = view.getFloat64(203, true)
  const maxZ = view.getFloat64(211, true)
  const minZ = view.getFloat64(219, true)

  return {
    fileSignature: magic,
    versionMajor,
    versionMinor,
    pointDataRecordFormat: pointDataRecordFormat as LasHeader['pointDataRecordFormat'],
    pointDataRecordLength,
    pointCount,
    minX, maxX,
    minY, maxY,
    minZ, maxZ,
    scaleX, scaleY, scaleZ,
    offsetX, offsetY, offsetZ,
    headerSize,
    pointDataOffset,
    numberOfVLRs,
  }
}

/**
 * Parse VLRs to find the LAZ VLR.
 * VLRs start immediately after the public header.
 *
 * VLR structure (54 bytes header):
 *   0–1    Reserved
 *   2–17   User ID (ASCII, null-padded)
 *   18–19  Record ID (uint16)
 *   20–21  Record length after header (uint16)
 *   22–53  Description (ASCII, null-padded)
 *   54+    Record data (variable)
 */
export function parseLazVlr(buffer: ArrayBuffer, lasHeader: LasHeader): LazVlr {
  const view = new DataView(buffer)

  let offset = lasHeader.headerSize

  for (let i = 0; i < lasHeader.numberOfVLRs; i++) {
    if (offset + 54 > buffer.byteLength) break

    // Read user ID (null-terminated ASCII string, 16 bytes)
    let userId = ''
    for (let j = 0; j < 16; j++) {
      const c = view.getUint8(offset + 2 + j)
      if (c === 0) break
      userId += String.fromCharCode(c)
    }

    const recordId = view.getUint16(offset + 18, true)
    const recordLength = view.getUint16(offset + 20, true)
    const dataOffset = offset + 54

    if (userId === LAZ_USER_ID && recordId === LAZ_RECORD_ID) {
      return parseLazVlrData(view, dataOffset, lasHeader.pointDataRecordFormat, lasHeader.pointDataRecordLength)
    }

    offset = dataOffset + recordLength
  }

  throw new ParseError(
    'No LAZ VLR found in this file. ' +
    'This may be an uncompressed LAS file. ' +
    'lazstream only supports LAZ-compressed files.'
  )
}

/**
 * Parse the LAZ VLR data payload.
 *
 * LAZ VLR data layout:
 *   0–1    Compressor (uint16)
 *   2–3    Coder (uint16)
 *   4      Version major
 *   5      Version minor
 *   6–7    Version revision
 *   8–11   Options (uint32)
 *   12–15  Chunk size (uint32) — 0xFFFFFFFF = variable
 *   16–23  Number of special evlrs (int64, usually -1)
 *   24–31  Offset to special evlrs (int64, usually -1)
 *   32–33  Number of items (uint16)
 *   34+    Item records (6 bytes each: type uint16, size uint16, version uint16)
 */
function parseLazVlrData(
  view: DataView,
  dataOffset: number,
  pdrf: LasHeader['pointDataRecordFormat'],
  recordLength: number,
): LazVlr {
  const compressor = view.getUint16(dataOffset + 0, true)
  const chunkSize = view.getUint32(dataOffset + 12, true)

  // Compressor 3 (LAYERED_CHUNKED) is only defined for PDRF 6-10.
  // Some writers store only the LAZ compression flag (0x80) in byte 104,
  // leaving the PDRF bits as 0. Detect this and derive the real PDRF from
  // the record length (30 = PDRF 6, 36 = PDRF 7, 38 = PDRF 8, etc.).
  let effectivePdrf = pdrf
  if (compressor === 3 && pdrf === 0) {
    const derived: Record<number, LasHeader['pointDataRecordFormat']> = {
      30: 6, 36: 7, 38: 8, 59: 9, 67: 10,
    }
    effectivePdrf = derived[recordLength] ?? 6
    console.warn(
      `[header] PDRF byte reads as 0 for layered compressor — ` +
      `derived PDRF ${effectivePdrf} from record length ${recordLength}`
    )
  }

  // isLayered: compressor 3 = LAYERED_CHUNKED, which by definition requires
  // PDRF 6-10. Do not gate on effectivePdrf here — the compressor field is
  // the authoritative signal.
  const isLayered = compressor === 3

  return {
    compressor,
    chunkSize: chunkSize === 0xFFFFFFFF ? 0 : chunkSize, // 0 = variable
    pointDataRecordFormat: effectivePdrf,
    numItems: view.getUint16(dataOffset + 32, true),
    isLayered,
  }
}

/**
 * Top-level: fetch the LAS header and LAZ VLR from a URL.
 * Issues a single range request for the first 8KB (covers header + typical VLRs).
 * If VLRs extend beyond 8KB, falls back to a larger fetch.
 *
 * @param signal Optional AbortSignal — passed to both internal fetchRange calls.
 */
export async function fetchAndParseLasHeader(
  url: string,
  signal?: AbortSignal,
): Promise<{
  header: LasHeader
  lazVlr: LazVlr
  buffer: ArrayBuffer
}> {
  // First fetch: 8KB covers the public header (375 bytes) + most VLR sets
  const INITIAL_FETCH = 8192
  let buffer = await fetchRange(url, 0, INITIAL_FETCH - 1, signal)
  let view = new DataView(buffer)

  const header = parseLasHeader(view)

  // Check if VLRs fit in our initial fetch
  // VLRs end at pointDataOffset; if that exceeds our buffer, fetch more
  if (header.pointDataOffset > INITIAL_FETCH) {
    buffer = await fetchRange(url, 0, header.pointDataOffset - 1, signal)
    view = new DataView(buffer)
  }

  const lazVlr = parseLazVlr(buffer, header)

  // If parseLazVlrData corrected the PDRF (e.g., writer stored only the
  // compression flag at byte 104), keep the header consistent.
  if (lazVlr.pointDataRecordFormat !== header.pointDataRecordFormat) {
    header.pointDataRecordFormat = lazVlr.pointDataRecordFormat
  }

  return { header, lazVlr, buffer }
}