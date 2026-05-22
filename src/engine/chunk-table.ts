/**
 * Chunk Table Parser + Seed Point Extractor
 *
 * LAZ chunk tables are ARITHMETICALLY COMPRESSED (version 0).
 * The chunk table at EOF contains:
 *   [+0] uint32: version (0 = compressed)
 *   [+4] uint32: number_of_chunks
 *   [+8] compressed stream: IntegerCompressor(32, 2) encoded chunk sizes
 *
 * We decode the compressed chunk table using our own ArithmeticDecoder
 * and IntegerDecompressor — a direct TypeScript port of the LASzip C++ code.
 *
 * Procedure (from LASzip lasreadpoint.cpp read_chunk_table):
 *   1. chunk_starts[0] = pointDataOffset + 8  (right after the pointer)
 *   2. For i = 1..N: chunk_starts[i] = ic.decompress(prev, context=1)
 *   3. For i = 1..N: chunk_starts[i] += chunk_starts[i-1]  (U32 wrap-around)
 *   After step 3, chunk_starts[i] is the absolute byte offset of chunk i.
 *
 * MELBOURNE FIX (Phase 3, second pass): all arithmetic in the decode and
 * accumulation loop is uint32. The previous version used Int32Array for
 * deltas, which produced negative signed-interpretation values once delta
 * magnitudes crossed 2^31. The subsequent accumulation
 * `chunkStarts[i - 1] + deltas[i]` then went backwards in JS Number space,
 * producing negative chunk sizes when stored back through Uint32Array →
 * Number coercion. The decoder itself was correct — bug was in the
 * accumulation path. For Texas (2.1 GB file or smaller) it never showed
 * because U32 values fit in I32 range; for Melbourne (2.93 GB) the
 * cumulative offset crosses 2^31 around chunk 287 and the bug manifests.
 *
 * The fix: use Uint32Array for deltas as well, and explicitly coerce the
 * accumulation through `(a + b) >>> 0` to match C++ U32 wrap semantics.
 */

import type { LasHeader, LazVlr, ChunkTableEntry, SeedPoint } from '../types/las.js'
import { fetchRange } from '../network/range-fetcher.js'
import { ArithmeticDecoder } from '../decode/arithmetic-decoder.js'
import { IntegerDecompressor } from '../decode/integer-decompressor.js'

export class ChunkTableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChunkTableError'
  }
}

export async function fetchChunkTable(
  url: string,
  header: LasHeader,
  lazVlr: LazVlr,
  fileSize: number,
  signal?: AbortSignal,
): Promise<ChunkTableEntry[]> {
  const pointerOffset = header.pointDataOffset
  const CHUNK_DATA_START = pointerOffset + 8

  console.debug('[lazstream] fetchChunkTable called:', {
    pointDataOffset: pointerOffset,
    fileSize,
    lazVlrChunkSize: lazVlr.chunkSize,
  })

  // ── Step 1: Read the 8-byte chunk table pointer ──────────────────────────

  const ptrBuffer = await fetchRange(url, pointerOffset, pointerOffset + 7, signal)
  const ptrView = new DataView(ptrBuffer)
  const ptrLo = ptrView.getUint32(0, true)
  const ptrHi = ptrView.getUint32(4, true)
  let chunkTableAbsoluteOffset = ptrHi * 0x100000000 + ptrLo

  console.debug('[lazstream] pointer buffer:', {
    byteLength: ptrBuffer.byteLength,
    bytes: Array.from(new Uint8Array(ptrBuffer))
      .map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
    ptrLo,
    ptrHi,
    chunkTableAbsoluteOffset,
  })

  // Handle zero pointer
  if (chunkTableAbsoluteOffset === 0) {
    chunkTableAbsoluteOffset = CHUNK_DATA_START
    console.debug('[lazstream] chunk table pointer is 0 — table at pointDataOffset + 8')
  }

  // Validate pointer is within file
  if (chunkTableAbsoluteOffset >= fileSize) {
    throw new ChunkTableError(
      `Chunk table pointer (${chunkTableAbsoluteOffset}) is beyond ` +
      `the end of file (${fileSize} bytes). ` +
      `The file may be truncated. Re-download or re-upload the source LAZ file.`
    )
  }

  console.debug('[lazstream] chunk table at:', {
    chunkTableAbsoluteOffset,
    bytesFromEOF: fileSize - chunkTableAbsoluteOffset,
  })

  // ── Step 2: Fetch from chunk table offset to EOF ──────────────────────────

  const chunkTableBuffer = await fetchRange(url, chunkTableAbsoluteOffset, fileSize - 1, signal)
  const chunkTableView = new DataView(chunkTableBuffer)

  // ── Step 3: Read chunk table header ──────────────────────────────────────

  const tableVersion = chunkTableView.getUint32(0, true)
  const chunkCount = chunkTableView.getUint32(4, true)

  console.debug('[lazstream] chunk table header:', {
    version: tableVersion,
    chunkCount,
    compressedDataBytes: chunkTableBuffer.byteLength - 8,
  })

  if (tableVersion !== 0) {
    throw new ChunkTableError(
      `Unknown chunk table version ${tableVersion}. Expected 0.`
    )
  }

  if (chunkCount === 0) {
    throw new ChunkTableError('Chunk table reports 0 chunks.')
  }

  // Sanity check count
  const defaultChunkSize = lazVlr.chunkSize > 0 ? lazVlr.chunkSize : 50000
  const estimatedChunkCount = Math.ceil(header.pointCount / defaultChunkSize)
  const countRatio = chunkCount / estimatedChunkCount

  if (countRatio < 0.5 || countRatio > 2.0) {
    console.warn(
      `[lazstream] chunk count mismatch: table says ${chunkCount}, ` +
      `estimated ${estimatedChunkCount} from header.`
    )
  }

  // ── Step 4: Decompress chunk table entries ────────────────────────────────
  //
  // All arithmetic is uint32. The decoder returns numbers in [-2^31, 2^32) —
  // signed-interpretation when high bit set. Uint32Array storage normalises
  // these to unsigned [0, 2^32). The accumulation `a + b >>> 0` mirrors C++
  // U32 wrap-around addition.

  const compressedData = new Uint8Array(
    chunkTableBuffer,
    8,
    chunkTableBuffer.byteLength - 8
  )

  const dec = new ArithmeticDecoder(compressedData)
  dec.init()

  const ic = new IntegerDecompressor(dec, 32, 2, 8)
  ic.initDecompressor()

  // Uint32Array: deltas are 32-bit unsigned values that wrap mod 2^32.
  // The decoder may return negative-signed-interpretation numbers; storing
  // through Uint32Array normalises them to their unsigned bit pattern.
  const deltas = new Uint32Array(chunkCount + 1)

  const t0 = performance.now()
  for (let i = 1; i <= chunkCount; i++) {
    const pred = i > 1 ? deltas[i - 1] : 0   // Uint32Array reads are always unsigned
    deltas[i] = ic.decompress(pred, 1)
  }
  const decodeMs = performance.now() - t0
  console.log(
    `[lazstream] arithmetic decode: ${chunkCount} entries in ${decodeMs.toFixed(1)}ms ` +
    `(${(decodeMs / chunkCount * 1000).toFixed(2)}µs/entry)`
  )

  // Accumulate deltas to get absolute byte offsets.
  // `(a + b) >>> 0` keeps the addition in uint32 space, matching C++ U32 wrap.
  // For Melbourne (2.93 GB), cumulative offsets cross 2^31 around chunk 287 —
  // without the explicit `>>> 0`, JS would produce negative Number values.
  const chunkStarts = new Uint32Array(chunkCount + 1)
  chunkStarts[0] = CHUNK_DATA_START
  for (let i = 1; i <= chunkCount; i++) {
    chunkStarts[i] = (chunkStarts[i - 1] + deltas[i]) >>> 0
  }

  console.debug('[lazstream] first 5 chunk offsets:', {
    offsets: Array.from(chunkStarts.slice(0, 5)),
    sizes: Array.from(chunkStarts.slice(1, 5)).map((s, i) => s - chunkStarts[i]),
  })

  // ── Step 5: Build chunk entries ───────────────────────────────────────────
  //
  // Sizes computed as `(next - this) >>> 0` for uint32 wrap safety. A
  // genuinely-wrong offset would still appear as a huge positive value
  // here — the `compressedSize > fileSize` guard below catches that.

  const entries: ChunkTableEntry[] = []

  for (let i = 0; i < chunkCount; i++) {
    const offset = chunkStarts[i]
    const compressedSize = (chunkStarts[i + 1] - chunkStarts[i]) >>> 0

    if (compressedSize === 0) {
      console.warn(`[lazstream] chunk ${i}: zero size — stopping`)
      break
    }

    if (compressedSize > fileSize) {
      console.warn(
        `[lazstream] chunk ${i}: size ${compressedSize} exceeds file size ${fileSize} — stopping`
      )
      break
    }

    if (offset >= fileSize) {
      console.warn(
        `[lazstream] chunk ${i}: offset ${offset} beyond file size ${fileSize} — stopping`
      )
      break
    }

    const remainingPoints = header.pointCount - i * defaultChunkSize
    const pointCount = Math.min(defaultChunkSize, remainingPoints)

    entries.push({ offset, compressedSize, pointCount })
  }

  if (entries.length === 0) {
    throw new ChunkTableError('No valid chunk entries after decompression.')
  }

  if (entries.length < chunkCount) {
    console.warn(
      `[lazstream] only ${entries.length} of ${chunkCount} chunks produced ` +
      `valid offsets — proceeding with partial set`
    )
  }

  // Validate: last chunk should end near the chunk table
  const lastChunk = entries[entries.length - 1]
  const lastChunkEnd = lastChunk.offset + lastChunk.compressedSize
  const gapToTable = chunkTableAbsoluteOffset - lastChunkEnd

  console.debug('[lazstream] chunk table parsed:', {
    chunkCount: entries.length,
    firstChunkOffset: entries[0].offset,
    lastChunkEnd,
    chunkTableStart: chunkTableAbsoluteOffset,
    gapToTable,
    avgChunkSize: Math.round(
      entries.reduce((s, e) => s + e.compressedSize, 0) / entries.length
    ),
  })

  // The gap between last chunk and chunk table should be small
  // (0 for most files, but some have EVLRs or padding between)
  if (Math.abs(gapToTable) > 1024) {
    console.warn(
      `[lazstream] chunk offsets overshoot/undershoot chunk table by ${gapToTable} bytes — ` +
      `decompression may have errors`
    )
  }

  const sampleIndices = [1, 2, 3, 100, 200, 286, 287, 288, 293, 294, 295]
  for (const i of sampleIndices) {
    if (i <= chunkCount) {
      console.log(`[lazstream] delta[${i}] = ${deltas[i]} (0x${deltas[i].toString(16)})`)
    }
  }
  return entries
}

/**
 * Extract the uncompressed seed point (first point) from each chunk.
 *
 * PDRF 0–5 (chunked compressor 2):  seed starts at chunkOffset + 0
 * PDRF 6–10 variable chunk (chunkSize === 0):  starts at chunkOffset + 4 (4-byte count prefix)
 * PDRF 6–10 fixed chunk (layered compressor 3): reads arithmetic-coder init bytes at offset 0.
 *   These bytes happen to produce world-X ≈ offsetX for most chunks (range-coder initialises
 *   with 0xFFFFFFFF → rawX = -1 → world_X ≈ offsetX). Seeds are sparse but give a visible
 *   overview outline. Invalid seeds are discarded by the bounds check.
 */
export async function fetchSeedPoints(
  url: string,
  chunks: ChunkTableEntry[],
  header: LasHeader,
  lazVlr: LazVlr,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<SeedPoint[]> {
  const seeds: SeedPoint[] = []
  const isPdrf6Plus = header.pointDataRecordFormat >= 6

  // Fixed-size chunks: seed point starts at chunk offset + 0
  // Variable-size chunks: seed point starts at chunk offset + 4 (preceded by point count)
  const seedByteOffset = (lazVlr.chunkSize === 0) ? 4 : 0
  const seedByteLength = header.pointDataRecordLength
  const BATCH_SIZE = 100

  console.debug('[lazstream] fetching seed points:', {
    chunkCount: chunks.length,
    isPdrf6Plus,
    seedByteOffset,
    seedByteLength,
  })

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    if (signal?.aborted) return seeds

    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length)
    const batchChunks = chunks.slice(batchStart, batchEnd)

    const batchBuffers = await Promise.all(
      batchChunks.map(chunk => {
        const seedStart = chunk.offset + seedByteOffset
        const seedEnd = seedStart + seedByteLength - 1
        return fetchRange(url, seedStart, seedEnd, signal)
      })
    )

    for (let i = 0; i < batchBuffers.length; i++) {
      const buf = batchBuffers[i]
      const view = new DataView(buf)
      const chunkIndex = batchStart + i

      if (buf.byteLength < 12) {
        console.warn(
          `[lazstream] seed for chunk ${chunkIndex} too short (${buf.byteLength}b) — skipping`
        )
        continue
      }

      const rawX = view.getInt32(0, true)
      const rawY = view.getInt32(4, true)
      const rawZ = view.getInt32(8, true)

      const x = rawX * header.scaleX + header.offsetX
      const y = rawY * header.scaleY + header.offsetY
      const z = rawZ * header.scaleZ + header.offsetZ

      // Bounds check — 10m tolerance for edge cases
      if (
        x < header.minX - 10 || x > header.maxX + 10 ||
        y < header.minY - 10 || y > header.maxY + 10
      ) {
        console.warn(
          `[lazstream] seed ${chunkIndex} out of bounds: ` +
          `(${x.toFixed(2)}, ${y.toFixed(2)}) vs bbox ` +
          `(${header.minX.toFixed(2)}–${header.maxX.toFixed(2)}, ` +
          `${header.minY.toFixed(2)}–${header.maxY.toFixed(2)})`
        )
        continue
      }

      const intensity = view.getUint16(12, true)
      const classification = isPdrf6Plus
        ? view.getUint8(16)
        : view.getUint8(15)

      seeds.push({ x, y, z, intensity, classification, chunkIndex })
    }

    onProgress?.(batchEnd, chunks.length)
  }

  if (seeds.length > 0) {
    console.debug('[lazstream] first seed point:', {
      x: seeds[0].x.toFixed(4),
      y: seeds[0].y.toFixed(4),
      z: seeds[0].z.toFixed(4),
      classification: seeds[0].classification,
    })
    console.debug(`[lazstream] ${seeds.length} / ${chunks.length} seed points extracted`)
  }

  return seeds
}