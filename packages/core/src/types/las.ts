/**
 * LAS/LAZ format types
 * Based on LAS 1.4 specification and LASzip specification 1.4 R1
 */

// LAS point data record formats
export type PointDataRecordFormat = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

// LAZ compression types
export const LAZ_COMPRESSOR_NONE = 0
export const LAZ_COMPRESSOR_POINTWISE = 1
export const LAZ_COMPRESSOR_POINTWISE_CHUNKED = 2
export const LAZ_COMPRESSOR_LAYERED_CHUNKED = 3  // LAZ 1.4 PDRF 6-10 only

export interface LasHeader {
  // File signature — must be "LASF"
  fileSignature: string

  // LAS version
  versionMajor: number  // byte 24
  versionMinor: number  // byte 25 — 2 = LAS 1.2, 3 = LAS 1.3, 4 = LAS 1.4

  // Point data
  pointDataRecordFormat: PointDataRecordFormat
  pointDataRecordLength: number
  pointCount: number

  // Bounding box (from header)
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number

  // Coordinate scaling (LAS stores ints; world = int * scale + offset)
  scaleX: number
  scaleY: number
  scaleZ: number
  offsetX: number
  offsetY: number
  offsetZ: number

  // Byte offsets
  headerSize: number
  pointDataOffset: number  // Start of LAZ point data block
  numberOfVLRs: number
}

export interface LazVlr {
  // Compressor type
  compressor: number

  // Chunk size in points (default 50000).
  // 0 = variable chunk size (raw VLR value is 0xFFFFFFFF, normalized to 0 by parser).
  chunkSize: number

  // Point data record format (mirrors LAS header)
  pointDataRecordFormat: PointDataRecordFormat

  // Scan item count (number of LAZ item types in the stream)
  numItems: number

  // Whether this is the layered LAZ 1.4 codec (PDRF 6-10)
  // Layered = selective decompression possible (XYZ-only fast path)
  isLayered: boolean
}

export interface ChunkTableEntry {
  // Byte offset of this chunk's compressed data in the file
  offset: number

  // Compressed byte size of this chunk
  // For fixed-size chunks: all except last are identical
  compressedSize: number

  // Point count in this chunk
  // For fixed chunks: chunkSize (50000) except possibly last
  pointCount: number
}

/**
 * Full attribute record for a single LAZ point, resolved on demand via T3 picking.
 * Fields present depend on the PDRF of the file.
 */
export interface PointAttributes {
  x: number
  y: number
  z: number
  intensity: number
  classification: number
  returnNumber: number
  numberOfReturns: number
  /** GPS time (seconds of GPS week). Present in PDRFs 1, 3, 5, 6–10. */
  gpsTime?: number
  /** Red channel 0–255. Present in PDRFs 2, 3, 5, 7, 8, 10. */
  r?: number
  g?: number
  b?: number
}

export interface SeedPoint {
  // World coordinates (after applying scale + offset from LAS header)
  x: number
  y: number
  z: number

  // Classification (byte 15 in PDRF 0-5, byte 16 in PDRF 6-10)
  classification: number

  // Intensity (uint16, bytes 12-13 in most PDRFs)
  intensity: number

  // Which chunk this seed came from
  chunkIndex: number
}

// LAZ version classification — determines decode strategy
export type LazVersion =
  | 'laz-1.2'    // PDRF 0-5, monolithic arithmetic coding — degraded path
  | 'laz-1.3'    // PDRF 0-5, same as 1.2 for our purposes — degraded path
  | 'laz-1.4'    // PDRF 6-10, layered — fast path with selective decode
  | 'unsupported' // Uncompressed LAS or unknown

export function classifyLazVersion(header: LasHeader, lazVlr: LazVlr): LazVersion {
  if (header.versionMajor === 1) {
    if (header.versionMinor <= 1) return 'unsupported'
    if (header.versionMinor === 2) return 'laz-1.2'
    if (header.versionMinor === 3) return 'laz-1.3'
    if (header.versionMinor === 4) {
      // PDRF 6-10 with layered compressor = true LAZ 1.4
      if (lazVlr.isLayered) return 'laz-1.4'
      // PDRF 6-10 but legacy compressor (compatibility mode)
      return 'laz-1.3'
    }
  }
  return 'unsupported'
}

// User-facing message for degraded mode
export function getLazVersionWarning(version: LazVersion): string | null {
  if (version === 'laz-1.2' || version === 'laz-1.3') {
    return 'This file uses an older compression format — loading will be slower. ' +
           'Convert to LAZ 1.4 (PDRF 6+) for better performance.'
  }
  if (version === 'unsupported') {
    return 'Unsupported format. lazstream requires compressed LAZ files (LAZ 1.2–1.4). ' +
           'Uncompressed LAS files are too large to stream.'
  }
  return null
}