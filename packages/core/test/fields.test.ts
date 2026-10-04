import { describe, expect, it } from 'vitest'
import {
  LAS_FIELDS, FIELDS_ALL, FIELDS_RENDER, FIELD_BITS_ALL, FieldDemandSet,
  toBits, fromBits, hasField, fieldsInFormat, resolveFetchFields, type LasField,
} from '../src/decode/fields.js'

describe('field bitsets', () => {
  it('round-trips every subset through bits', () => {
    for (let bits = 0; bits <= FIELD_BITS_ALL; bits += 37) {
      expect(toBits(fromBits(bits))).toBe(bits)
    }
    expect(toBits(FIELDS_ALL)).toBe(FIELD_BITS_ALL)
    expect(LAS_FIELDS).toHaveLength(13)
  })

  it('hasField matches set membership', () => {
    const bits = toBits(FIELDS_RENDER)
    for (const f of LAS_FIELDS) expect(hasField(bits, f)).toBe(FIELDS_RENDER.has(f))
  })

  it('forces xyz into every resolved mask', () => {
    expect(fromBits(resolveFetchFields(['gpsTime'])).has('xyz')).toBe(true)
    expect(fromBits(resolveFetchFields([])).has('xyz')).toBe(true)
    expect(fromBits(resolveFetchFields('render')).has('xyz')).toBe(true)
    expect(resolveFetchFields('all')).toBe(FIELD_BITS_ALL)
    expect(resolveFetchFields(undefined)).toBe(FIELD_BITS_ALL)
  })
})

describe('fieldsInFormat', () => {
  const base: Record<number, number> = { 0: 20, 1: 28, 2: 26, 3: 34, 4: 57, 5: 63, 6: 30, 7: 36, 8: 38, 9: 59, 10: 67 }
  const expectOptional: Record<number, LasField[]> = {
    0: [], 1: ['gpsTime'], 2: ['rgb'], 3: ['gpsTime', 'rgb'],
    4: ['gpsTime', 'wavepacket'], 5: ['gpsTime', 'rgb', 'wavepacket'],
    6: ['gpsTime'], 7: ['gpsTime', 'rgb'], 8: ['gpsTime', 'rgb', 'nir'],
    9: ['gpsTime', 'wavepacket'], 10: ['gpsTime', 'rgb', 'nir', 'wavepacket'],
  }
  const always: LasField[] = ['xyz', 'intensity', 'returns', 'flags', 'classification',
    'scanAngle', 'userData', 'pointSourceId']

  for (let pdrf = 0; pdrf <= 10; pdrf++) {
    it(`PDRF ${pdrf}`, () => {
      const got = fieldsInFormat(pdrf, base[pdrf])
      expect([...got].sort()).toEqual([...always, ...expectOptional[pdrf]].sort())
      expect(fieldsInFormat(pdrf, base[pdrf] + 3).has('extraBytes')).toBe(true)
    })
  }
})

describe('FieldDemandSet', () => {
  it('unions demands, fires onChange only on bit changes, release is idempotent', () => {
    const changes: Array<[number, number]> = []
    const set = new FieldDemandSet(toBits(FIELDS_RENDER), (f, s) => changes.push([f, s]))
    const gps = set.add(['gpsTime'], true)
    expect(changes).toHaveLength(1)
    expect(hasField(set.fetchBits(), 'gpsTime')).toBe(true)
    expect(hasField(set.surfaceBits(), 'gpsTime')).toBe(true)

    const gps2 = set.add(['gpsTime'], true)   // same bits → no event
    expect(changes).toHaveLength(1)
    const rgb = set.add(['rgb'], false)        // already in base → no event
    expect(changes).toHaveLength(1)

    gps.release()
    expect(changes).toHaveLength(1)            // gps2 still holds it
    gps2.release()
    gps2.release()
    expect(changes).toHaveLength(2)
    expect(hasField(set.fetchBits(), 'gpsTime')).toBe(false)
    expect(set.surfaceBits()).toBe(0)
    rgb.release()
    expect(changes).toHaveLength(2)
  })

  it('surface bits never exceed fetch bits', () => {
    const set = new FieldDemandSet(toBits(['xyz']))
    set.add(['nir'], true)
    expect(set.surfaceBits() & ~set.fetchBits()).toBe(0)
  })
})
