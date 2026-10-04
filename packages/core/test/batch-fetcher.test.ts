import { describe, expect, it } from 'vitest'
import { coalesce, coalesceRanges, DEFAULT_MAX_GAP_BYTES } from '../src/network/batch-fetcher.js'

function chunks(n: number, size: number, gapEvery = 0, gap = 0) {
  const out = []
  let off = 1000
  for (let i = 0; i < n; i++) {
    out.push({ chunkIndex: i, chunk: { offset: off, compressedSize: size, pointCount: 50000 } })
    off += size + (gapEvery && i % gapEvery === gapEvery - 1 ? gap : 0)
  }
  return out
}

describe('coalesceRanges', () => {
  it('matches coalesce on chunk-shaped input', () => {
    const input = chunks(40, 150_000, 7, 100_000).reverse()
    const a = coalesce(input)
    const b = coalesceRanges(input.map(c => ({
      key: c.chunkIndex, part: 0, start: c.chunk.offset, end: c.chunk.offset + c.chunk.compressedSize,
    })))
    expect(b.map(x => [x.start, x.end, x.items.map(i => i.key)]))
      .toEqual(a.map(x => [x.start, x.end, x.chunks.map(c => c.chunkIndex)]))
  })

  it('splits on gaps larger than maxGapBytes', () => {
    const items = [
      { key: 0, part: 0, start: 0, end: 100 },
      { key: 0, part: 1, start: 100 + 8192, end: 9000 },        // gap = 8192 → bridged
      { key: 1, part: 0, start: 9000 + 8193, end: 20000 },      // gap = 8193 → split
    ]
    const batches = coalesceRanges(items, { maxGapBytes: 8192 })
    expect(batches.map(b => b.items.length)).toEqual([2, 1])
    expect(coalesceRanges(items, { maxGapBytes: DEFAULT_MAX_GAP_BYTES })).toHaveLength(1)
  })

  it('respects the batch size cap', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ key: i, part: 0, start: i * 1000, end: (i + 1) * 1000 }))
    expect(coalesceRanges(items, { maxBatchBytes: 3000 }).map(b => b.items.length)).toEqual([3, 3, 3, 1])
  })

  it('handles empty input', () => {
    expect(coalesceRanges([])).toEqual([])
    expect(coalesce([])).toEqual([])
  })
})
