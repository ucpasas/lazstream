import { describe, expect, it } from 'vitest'
import {
  layerNames, layerPrefixLength, parseLayerTable, validateLayerTable,
  layersForFields, fieldBitsForLayers, plannedRanges, compactChunk, mergeCompact,
  type LayerName,
} from '../src/decode/layer-select.js'
import { FIELDS_RENDER, toBits, fromBits, type LasField } from '../src/decode/fields.js'
import { LAYERED_FIXTURES, fixtureInfo, loadFixture } from './helpers.js'

function tableBytes(reclen: number, count: number, sizes: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(layerPrefixLength(reclen, sizes.length))
  const v = new DataView(buf)
  v.setUint32(reclen, count, true)
  sizes.forEach((s, i) => v.setUint32(reclen + 4 + 4 * i, s, true))
  return buf
}

describe('layerNames', () => {
  it('PDRF 8 with 3 extra bytes → 14 layers (9 base + rgb + nir + 3)', () => {
    const names = layerNames(8, 41)
    expect(names).toHaveLength(14)
    expect(names.slice(9)).toEqual(['rgb', 'nir', 'extra_0', 'extra_1', 'extra_2'])
  })
  it('PDRF 6/7/9/10', () => {
    expect(layerNames(6, 30)).toHaveLength(9)
    expect(layerNames(7, 36).at(-1)).toBe('rgb')
    expect(layerNames(9, 59).at(-1)).toBe('wavepacket')
    expect(layerNames(10, 67).slice(9)).toEqual(['rgb', 'nir', 'wavepacket'])
  })
  it('throws for legacy PDRFs', () => {
    expect(() => layerNames(3, 34)).toThrow()
  })
})

describe('parseLayerTable / validateLayerTable', () => {
  const reclen = 30
  const sizes = [100, 50, 0, 10, 20, 5, 0, 0, 40]
  const prefix = layerPrefixLength(reclen, sizes.length)
  const total = prefix + sizes.reduce((a, b) => a + b, 0)

  it('parses and accepts a consistent table', () => {
    const t = parseLayerTable(tableBytes(reclen, 1000, sizes), reclen, sizes.length)
    expect(t.pointCount).toBe(1000)
    expect([...t.sizes]).toEqual(sizes)
    expect(validateLayerTable(t, { offset: 0, compressedSize: total, pointCount: 1000 }, reclen)).toBe(true)
  })
  it('rejects a wrong point count', () => {
    const t = parseLayerTable(tableBytes(reclen, 999, sizes), reclen, sizes.length)
    expect(validateLayerTable(t, { offset: 0, compressedSize: total, pointCount: 1000 }, reclen)).toBe(false)
  })
  it('rejects a size-sum mismatch', () => {
    const t = parseLayerTable(tableBytes(reclen, 1000, sizes), reclen, sizes.length)
    expect(validateLayerTable(t, { offset: 0, compressedSize: total + 1, pointCount: 1000 }, reclen)).toBe(false)
  })
  it('throws on a short prefix', () => {
    expect(() => parseLayerTable(new ArrayBuffer(10), reclen, sizes.length)).toThrow()
  })
})

describe('field → layer mapping', () => {
  const names = layerNames(10, 69)   // every layer kind + 2 extra bytes
  const kept = (fields: LasField[]) =>
    names.filter((_, i) => layersForFields(toBits(fields), names)[i])

  it.each<[LasField, LayerName[]]>([
    ['xyz', ['xy', 'z']],
    ['returns', ['xy', 'z']],
    ['flags', ['xy', 'z', 'flags']],
    ['classification', ['xy', 'z', 'classification']],
    ['intensity', ['xy', 'z', 'intensity']],
    ['scanAngle', ['xy', 'z', 'scan_angle']],
    ['userData', ['xy', 'z', 'user_data']],
    ['pointSourceId', ['xy', 'z', 'point_source_id']],
    ['gpsTime', ['xy', 'z', 'gps_time']],
    ['rgb', ['xy', 'z', 'rgb']],
    ['nir', ['xy', 'z', 'nir']],
    ['wavepacket', ['xy', 'z', 'wavepacket']],
    ['extraBytes', ['xy', 'z', 'extra_0', 'extra_1']],
  ])('%s', (field, layers) => {
    expect(kept([field])).toEqual(layers)
  })

  it('fieldBitsForLayers reports only fully-covered fields', () => {
    const keep = layersForFields(toBits(FIELDS_RENDER), names)
    const present = fromBits(fieldBitsForLayers(keep, names))
    expect([...present].sort()).toEqual([...FIELDS_RENDER].sort())
    // rgb has no layer in PDRF 6 → never reported present
    const n6 = layerNames(6, 30)
    expect(fromBits(fieldBitsForLayers(n6.map(() => true), n6)).has('rgb')).toBe(false)
  })
})

describe('plannedRanges', () => {
  const render = toBits(FIELDS_RENDER)
  it('PDRF 6 render → 1 range', () => {
    const names = layerNames(6, 30)
    const sizes = new Uint32Array([100, 50, 10, 10, 20, 5, 5, 5, 40])
    expect(plannedRanges(sizes, names, 30, layersForFields(render, names))).toEqual([
      { start: 0, end: layerPrefixLength(30, 9) + 190 },
    ])
  })
  it('PDRF 7/8 render → 2 ranges', () => {
    for (const [pdrf, reclen] of [[7, 36], [8, 38]]) {
      const names = layerNames(pdrf, reclen)
      const sizes = new Uint32Array(names.map(() => 100))
      const r = plannedRanges(sizes, names, reclen, layersForFields(render, names))
      expect(r).toHaveLength(2)
      const prefix = layerPrefixLength(reclen, names.length)
      expect(r[0]).toEqual({ start: 0, end: prefix + 500 })
      expect(r[1]).toEqual({ start: prefix + 900, end: prefix + 1000 })
    }
  })
  it('zero-size rgb → 1 range', () => {
    const names = layerNames(7, 36)
    const sizes = new Uint32Array(names.map(n => (n === 'rgb' ? 0 : 100)))
    expect(plannedRanges(sizes, names, 36, layersForFields(render, names))).toHaveLength(1)
  })
  it('without prefix covers only kept layers', () => {
    const names = layerNames(6, 30)
    const sizes = new Uint32Array(names.map(() => 10))
    const keep = names.map(n => n === 'gps_time')
    const prefix = layerPrefixLength(30, 9)
    expect(plannedRanges(sizes, names, 30, keep, { includePrefix: false }))
      .toEqual([{ start: prefix + 80, end: prefix + 90 }])
  })
})

describe('compactChunk / mergeCompact on fixtures', () => {
  for (const name of LAYERED_FIXTURES) {
    const buf = loadFixture(name)
    const info = fixtureInfo(buf)
    const names = layerNames(info.pdrf, info.recordLength)
    const chunk = buf.slice(info.chunkStart, info.chunkEnd)
    const table = parseLayerTable(chunk, info.recordLength, names.length)
    const prefix = layerPrefixLength(info.recordLength, names.length)
    const slice = (ranges: Array<{ start: number; end: number }>) => ranges.map(r => chunk.slice(r.start, r.end))
    const build = (keep: boolean[]) => {
      const ranges = plannedRanges(table.sizes, names, info.recordLength, keep)
      return new Uint8Array(compactChunk(slice(ranges), ranges, table.sizes, names, info.recordLength, keep))
    }

    it(`${name}: keep-all compact equals the original chunk`, () => {
      expect(Buffer.compare(build(names.map(() => true)), new Uint8Array(chunk))).toBe(0)
    })

    it(`${name}: compact layout — zeroed sizes, kept bytes in order`, () => {
      const keep = layersForFields(toBits(FIELDS_RENDER), names)
      const out = build(keep)
      const v = new DataView(out.buffer)
      let expectedLen = prefix
      for (let i = 0; i < names.length; i++) {
        expect(v.getUint32(info.recordLength + 4 + 4 * i, true)).toBe(keep[i] ? table.sizes[i] : 0)
        if (keep[i]) expectedLen += table.sizes[i]
      }
      expect(out.length).toBe(expectedLen)
    })

    it(`${name}: mergeCompact(have→want) equals compactChunk(want) byte-for-byte`, () => {
      // Distinct keep-sets over the optional layers, then (have ⊂ want) pairs.
      const optional = names.map((_, i) => i).filter(i => i >= 2)
      const keepSets: boolean[][] = []
      const seen = new Set<string>()
      for (let m = 0; m < 1 << optional.length && keepSets.length < 4096; m++) {
        const keep = names.map((_, i) => i < 2)
        optional.forEach((li, b) => { if (m & (1 << b)) keep[li] = true })
        const key = keep.map(k => (k ? 1 : 0)).join('')
        if (!seen.has(key)) { seen.add(key); keepSets.push(keep) }
      }
      let pairs = 0
      let rng = 12345
      const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
      for (const have of keepSets) {
        for (const want of keepSets) {
          if (!have.every((h, i) => !h || want[i])) continue
          // full coverage on small fixtures; sampled on large ones
          if (keepSets.length > 64 && rand() > 0.01) continue
          const missing = want.map((w, i) => w && !have[i])
          const rel = plannedRanges(table.sizes, names, info.recordLength, missing, { includePrefix: false })
          const merged = new Uint8Array(mergeCompact(build(have).buffer as ArrayBuffer, have, slice(rel), rel,
            table.sizes, names, info.recordLength, want))
          expect(Buffer.compare(merged, build(want))).toBe(0)
          pairs++
        }
      }
      expect(pairs).toBeGreaterThan(20)
    })
  }
})
