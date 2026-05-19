/**
 * Range-request coalescing — Phase 3 Track A Step 4.
 *
 * Pure function. Takes a list of (chunkIndex, ChunkTableEntry) and
 * groups adjacent chunks into batches that share a single HTTP Range
 * request, dramatically reducing request count on HTTP/2 origins.
 *
 * For Melbourne at overview zoom, the engine's prioritiser hands ~8
 * chunks per tick. Without coalescing, that's 8 separate range
 * requests per tick. With coalescing (typical batch span ~2–4 MB),
 * adjacent chunks fold into a single request — usually 1–3 batches
 * for the same 8 chunks.
 */

import type { ChunkTableEntry } from '../types/las.js'

export interface FetchBatch {
  /** Inclusive start byte (lowest chunk.offset in this batch). */
  start: number
  /** EXCLUSIVE end byte (one past last). Subtract 1 for HTTP Range header. */
  end: number
  /** Chunks contained, in byte-offset order. */
  chunks: Array<{ chunkIndex: number; chunk: ChunkTableEntry }>
}

/** Default batch size cap: 4 MB. Amortises TLS record overhead while
 *  staying within typical HTTP/2 window sizes. */
export const DEFAULT_MAX_BATCH_BYTES = 4 * 1024 * 1024

/** Default max gap: 64 KB. Chunks separated by more than this stay as
 *  separate batches; the wasted bytes from bridging the gap would
 *  outweigh the saved request overhead. */
export const DEFAULT_MAX_GAP_BYTES = 64 * 1024

/**
 * Coalesce adjacent chunks into Range request batches.
 *
 * Sorts by byte offset, then walks left-to-right merging chunks where:
 *   - Gap between current batch end and chunk start ≤ maxGapBytes
 *   - Resulting batch span ≤ maxBatchBytes
 *
 * Returns batches in byte-offset order. Caller fetches each batch with
 * one Range request, then slices per-chunk bytes from the response.
 *
 * Wasted bytes: any gap that gets bridged (< maxGapBytes) is fetched
 * but not used. This is intentional — the request-overhead saving
 * outweighs the bandwidth cost. The 64 KB cap keeps the worst-case
 * waste bounded.
 */
export function coalesce(
  chunks: Array<{ chunkIndex: number; chunk: ChunkTableEntry }>,
  options: {
    maxBatchBytes?: number
    maxGapBytes?: number
  } = {},
): FetchBatch[] {
  const maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES
  const maxGapBytes = options.maxGapBytes ?? DEFAULT_MAX_GAP_BYTES

  if (chunks.length === 0) return []

  const sorted = [...chunks].sort((a, b) => a.chunk.offset - b.chunk.offset)
  const batches: FetchBatch[] = []
  let current: FetchBatch | null = null

  for (const item of sorted) {
    const itemEnd = item.chunk.offset + item.chunk.compressedSize

    if (
      current !== null &&
      item.chunk.offset - current.end <= maxGapBytes &&
      itemEnd - current.start <= maxBatchBytes
    ) {
      current.chunks.push(item)
      current.end = itemEnd
    } else {
      if (current !== null) batches.push(current)
      current = {
        start: item.chunk.offset,
        end: itemEnd,
        chunks: [item],
      }
    }
  }
  if (current !== null) batches.push(current)

  return batches
}