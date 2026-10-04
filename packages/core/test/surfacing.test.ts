/**
 * Worker attribute surfacing: the per-point reader (workers/point-fields.ts,
 * inlined into the decode worker) against spec offsets read directly from
 * laz-perf full-decode records — extended family via the PDRF 6/8 fixtures,
 * legacy family via autzen_trim (PDRF 3).
 */
import { describe, expect, it } from 'vitest'
import {
  FIELD_BIT, allocSurfacedAttributes, readSurfacedPoint, surfacedTransferList,
} from '../src/workers/point-fields.js'
import { LAS_FIELDS, SURFACEABLE_BITS, fieldBit, fieldsInFormat } from '../src/decode/fields.js'
import { FIXTURES, decodeChunkRecords, fixtureInfo, loadFixture } from './helpers.js'

describe('point-fields constants', () => {
  it('FIELD_BIT mirrors LAS_FIELDS bit order', () => {
    for (const f of LAS_FIELDS) expect(FIELD_BIT[f], f).toBe(fieldBit(f))
  })
  it('surfaceBits 0 → nothing allocated (default path unchanged)', () => {
    expect(allocSurfacedAttributes(0, 8, 41, 10)).toBeNull()
    expect(allocSurfacedAttributes(FIELD_BIT.classification | FIELD_BIT.rgb, 8, 41, 10)).toBeNull()
  })
  it('fields absent from the format are not allocated', () => {
    const a = allocSurfacedAttributes(SURFACEABLE_BITS, 0, 20, 4)!
    expect(a.gpsTime).toBeUndefined()
    expect(a.nir).toBeUndefined()
    expect(a.extraBytes).toBeUndefined()
    expect(a.flagsLayout).toBe('legacy')
  })
})

describe('surfaced values match spec offsets', () => {
  for (const name of FIXTURES) {
    it(name, async () => {
      const buf = loadFixture(name)
      const info = fixtureInfo(buf)
      const { pdrf, recordLength: rl, chunkPoints: n } = info
      // First chunk only (autzen_trim has three).
      const records = await decodeChunkRecords(buf.slice(info.chunkStart, info.chunkEnd), pdrf, rl, n)
      const view = new DataView(records.buffer)
      const out = allocSurfacedAttributes(SURFACEABLE_BITS, pdrf, rl, n)!
      for (let i = 0; i < n; i++) readSurfacedPoint(view, i * rl, i, pdrf, out)

      const ext = pdrf >= 6
      const inFormat = fieldsInFormat(pdrf, rl)
      for (let i = 0; i < n; i += 7) {
        const p = i * rl
        const b14 = records[p + 14]
        const b15 = records[p + 15]
        expect(out.intensityRaw![i]).toBe(view.getUint16(p + 12, true))
        expect(out.returnNumber![i]).toBe(ext ? b14 & 15 : b14 & 7)
        expect(out.numberOfReturns![i]).toBe(ext ? b14 >> 4 : (b14 >> 3) & 7)
        expect(out.flags![i]).toBe(ext ? b15 : ((b15 >> 5) & 7) | (b14 & 0xC0))
        expect(out.userData![i]).toBe(records[p + 17])
        expect(out.scanAngle![i]).toBeCloseTo(ext ? view.getInt16(p + 18, true) * 0.006 : view.getInt8(p + 16), 4)
        expect(out.pointSourceId![i]).toBe(view.getUint16(p + (ext ? 20 : 18), true))
        if (inFormat.has('gpsTime')) expect(out.gpsTime![i]).toBe(view.getFloat64(p + (ext ? 22 : 20), true))
        if (inFormat.has('nir')) expect(out.nir![i]).toBe(view.getUint16(p + 36, true))
        if (out.extraBytes) {
          const { stride, data } = out.extraBytes
          for (let k = 0; k < stride; k++) expect(data[i * stride + k]).toBe(records[p + rl - stride + k])
        }
      }

      // Plausibility, independent of offsets: real data, not constants.
      expect(out.flagsLayout).toBe(ext ? 'extended' : 'legacy')
      for (let i = 0; i < n; i++) {
        expect(out.returnNumber![i]).toBeLessThanOrEqual(Math.max(out.numberOfReturns![i], 1))
        expect(Math.abs(out.scanAngle![i])).toBeLessThanOrEqual(180)
      }
      if (out.gpsTime) expect(new Set(out.gpsTime).size).toBeGreaterThan(1)
      expect(surfacedTransferList(out).length).toBeGreaterThan(5)
    })
  }
})
