/**
 * Equivalence: decoding a compact chunk (skipped layers zeroed) with the
 * unpatched laz-perf 0.0.7 ChunkDecoder yields bit-identical values for every
 * kept field. Reference for the "zero-size layer = unchanged" ground truth.
 */
import { describe, expect, it } from 'vitest'
import {
  layerNames, parseLayerTable, layersForFields, plannedRanges, compactChunk,
} from '../src/decode/layer-select.js'
import { FIELDS_RENDER, toBits, fieldsInFormat, type LasField } from '../src/decode/fields.js'
import { LAYERED_FIXTURES, decodeChunkRecords, fixtureInfo, loadFixture } from './helpers.js'

/** Byte span of each field in a PDRF 6–10 record. */
const SPAN: Partial<Record<LasField, [number, number]>> = {
  xyz: [0, 12], intensity: [12, 14], returns: [14, 15], flags: [15, 16], classification: [16, 17],
  userData: [17, 18], scanAngle: [18, 20], pointSourceId: [20, 22], gpsTime: [22, 30],
  rgb: [30, 36], nir: [36, 38],
}

function mismatches(a: Uint8Array, b: Uint8Array, reclen: number, n: number, field: LasField): number {
  const [s, e] = SPAN[field]!
  let bad = 0
  for (let i = 0; i < n; i++) {
    for (let k = s; k < e; k++) if (a[i * reclen + k] !== b[i * reclen + k]) { bad++; break }
  }
  return bad
}

describe('selective decode equivalence', () => {
  for (const name of LAYERED_FIXTURES) {
    const buf = loadFixture(name)
    const info = fixtureInfo(buf)
    const names = layerNames(info.pdrf, info.recordLength)
    const chunk = buf.slice(info.chunkStart, info.chunkEnd)
    const table = parseLayerTable(chunk, info.recordLength, names.length)
    const inFormat = fieldsInFormat(info.pdrf, info.recordLength)

    const compactFor = (fields: Iterable<LasField>) => {
      const keep = layersForFields(toBits(fields), names)
      const ranges = plannedRanges(table.sizes, names, info.recordLength, keep)
      return compactChunk(ranges.map(r => chunk.slice(r.start, r.end)), ranges, table.sizes, names,
        info.recordLength, keep)
    }

    it(`${name}: FIELDS_RENDER fields are byte-identical for every point`, async () => {
      const full = await decodeChunkRecords(chunk, info.pdrf, info.recordLength, info.pointCount)
      const compact = compactFor(FIELDS_RENDER)
      expect(compact.byteLength).toBeLessThan(chunk.byteLength)
      const got = await decodeChunkRecords(compact, info.pdrf, info.recordLength, info.pointCount)
      for (const f of FIELDS_RENDER) {
        if (!inFormat.has(f) || !SPAN[f]) continue
        expect(mismatches(full, got, info.recordLength, info.pointCount, f), f).toBe(0)
      }
    })

    it(`${name}: every single-field mask decodes its field exactly`, async () => {
      const full = await decodeChunkRecords(chunk, info.pdrf, info.recordLength, info.pointCount)
      for (const f of Object.keys(SPAN) as LasField[]) {
        if (!inFormat.has(f)) continue
        const got = await decodeChunkRecords(compactFor(['xyz', f]), info.pdrf, info.recordLength, info.pointCount)
        expect(mismatches(full, got, info.recordLength, info.pointCount, 'xyz'), `${f}/xyz`).toBe(0)
        expect(mismatches(full, got, info.recordLength, info.pointCount, f), f).toBe(0)
      }
    })
  }
})
