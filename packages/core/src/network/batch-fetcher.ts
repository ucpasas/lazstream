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

/** One byte range to fetch, tagged with the chunk (key) and piece (part) it belongs to. */
export interface RangeItem {
  key: number
  part: number
  /** Inclusive absolute start byte. */
  start: number
  /** EXCLUSIVE absolute end byte. */
  end: number
}

export interface RangeBatch {
  /** Inclusive start byte. */
  start: number
  /** EXCLUSIVE end byte. Subtract 1 for HTTP Range header. */
  end: number
  /** Items contained, in byte-offset order. */
  items: RangeItem[]
}

/**
 * Coalesce arbitrary byte ranges into Range request batches.
 *
 * Sorts by start byte, then walks left-to-right merging ranges where:
 *   - Gap between current batch end and range start ≤ maxGapBytes
 *   - Resulting batch span ≤ maxBatchBytes
 *
 * Returns batches in byte-offset order. Caller fetches each batch with
 * one Range request, then slices each item's bytes from the response.
 *
 * Wasted bytes: any gap that gets bridged (≤ maxGapBytes) is fetched
 * but not used. For whole chunks the 64 KB default is the right trade;
 * layer-selective ranges pass a much smaller gap, otherwise the skipped
 * layers between two kept ranges get bridged and fetched anyway.
 */
export function coalesceRanges(
  items: RangeItem[],
  options: {
    maxBatchBytes?: number
    maxGapBytes?: number
  } = {},
): RangeBatch[] {
  const maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES
  const maxGapBytes = options.maxGapBytes ?? DEFAULT_MAX_GAP_BYTES

  if (items.length === 0) return []

  const sorted = [...items].sort((a, b) => a.start - b.start)
  const batches: RangeBatch[] = []
  let current: RangeBatch | null = null

  for (const item of sorted) {
    if (
      current !== null &&
      item.start - current.end <= maxGapBytes &&
      item.end - current.start <= maxBatchBytes
    ) {
      current.items.push(item)
      current.end = item.end
    } else {
      if (current !== null) batches.push(current)
      current = { start: item.start, end: item.end, items: [item] }
    }
  }
  if (current !== null) batches.push(current)

  return batches
}

/**
 * Coalesce adjacent whole chunks into Range request batches.
 * Thin wrapper over coalesceRanges — one item per chunk.
 */
export function coalesce(
  chunks: Array<{ chunkIndex: number; chunk: ChunkTableEntry }>,
  options: {
    maxBatchBytes?: number
    maxGapBytes?: number
  } = {},
): FetchBatch[] {
  // key = position in `chunks`, so duplicate chunk indices survive exactly as before.
  const items: RangeItem[] = chunks.map((c, i) => ({
    key: i,
    part: 0,
    start: c.chunk.offset,
    end: c.chunk.offset + c.chunk.compressedSize,
  }))
  return coalesceRanges(items, options).map(b => ({
    start: b.start,
    end: b.end,
    chunks: b.items.map(i => chunks[i.key]),
  }))
}
