/**
 * Engine-level tests (P1–P3) — real engine, pool and decode worker; fetch
 * served from fixtures. See engine-harness.ts.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { requests, serve, installFakeWorker, assetUrls, waitFor, settle, memoryCache } from './engine-harness.js'
import { decodeChunkRecords, fixtureInfo, loadFixture } from './helpers.js'
import { layerNames, layerPrefixLength, parseLayerTable } from '../src/decode/layer-select.js'
import { FIELD_BITS_ALL, fieldsInFormat, type LasField } from '../src/decode/fields.js'
import type { DecodedChunk } from '../src/decode/worker-pool.js'
import type { StreamingEngineOptions } from '../src/engine/streaming-engine.js'

vi.mock('../src/network/range-fetcher.js', async (orig) =>
  (await import('./engine-harness.js')).rangeFetcherMock(orig))

const { StreamingEngine } = await import('../src/engine/streaming-engine.js')

const URL_ = 'https://test.invalid/fixture.laz'
const APPEND_BUG = loadFixture('append-bug.laz')   // PDRF 8, 3 extra bytes, one chunk
const info = fixtureInfo(APPEND_BUG)
const names = layerNames(info.pdrf, info.recordLength)
const chunkBytes = APPEND_BUG.slice(info.chunkStart, info.chunkEnd)
const table = parseLayerTable(chunkBytes, info.recordLength, names.length)
const prefix = layerPrefixLength(info.recordLength, names.length)

/** Absolute [start, end) of one layer in the fixture file. */
function layerRange(layer: string): { start: number; end: number } {
  let rel = prefix
  for (let i = 0; i < names.length; i++) {
    if (names[i] === layer) return { start: info.chunkStart + rel, end: info.chunkStart + rel + table.sizes[i] }
    rel += table.sizes[i]
  }
  throw new Error(layer)
}

async function startEngine(opts: Omit<StreamingEngineOptions, 'events'> = {}, buf = APPEND_BUG) {
  serve(buf)
  const decoded: DecodedChunk[] = []
  const fieldEvents: Array<ReadonlySet<LasField>> = []
  const engine = new StreamingEngine({
    ...opts,
    workerCount: 1,
    assetUrls,
    events: {
      onChunkDecoded: c => decoded.push(c),
      onError: e => { throw e },
      onFieldsChanged: f => fieldEvents.push(f),
    },
  })
  await engine.load(URL_)
  return { engine, decoded, fieldEvents }
}

async function decodeFirst(engine: InstanceType<typeof StreamingEngine>, decoded: DecodedChunk[]) {
  requests.length = 0
  engine.decodeAll()
  await waitFor(() => decoded.length === 1)
  return decoded[0]
}

let fullRecords: Uint8Array
beforeAll(async () => {
  await installFakeWorker()
  fullRecords = await decodeChunkRecords(chunkBytes, info.pdrf, info.recordLength, info.pointCount)
})

function fullGps(i: number): number {
  return new DataView(fullRecords.buffer).getFloat64(i * info.recordLength + 22, true)
}

describe('defaults (fetchFields = all)', () => {
  it('fetches the whole chunk in one range; worker output has no attributes', async () => {
    const { engine, decoded } = await startEngine()
    const c = await decodeFirst(engine, decoded)
    expect(requests).toEqual([{ start: info.chunkStart, end: info.chunkEnd }])
    expect(c.attributes).toBeUndefined()
    expect(c.isUpgrade).toBeUndefined()
    expect([...c.fieldsPresent!].sort()).toEqual([...fieldsInFormat(info.pdrf, info.recordLength)].sort())
    expect(c.pointCount).toBe(info.pointCount)
    engine.dispose()
  })

  it('seed request widens by exactly 4 + 4L bytes', async () => {
    serve(APPEND_BUG)
    const engine = new StreamingEngine({ workerCount: 1, assetUrls, events: {} })
    await engine.load(URL_)
    const seed = requests.find(r => r.start === info.chunkStart)!
    expect(seed.end - seed.start).toBe(info.recordLength + 4 + 4 * names.length)
    engine.dispose()
  })
})

describe('P1 selective fetch (fetchFields = render)', () => {
  it('fetches only render layers, decodes identical geometry, omits skipped fields from fieldsPresent', async () => {
    const { engine, decoded } = await startEngine({ fetchFields: 'render' })
    const c = await decodeFirst(engine, decoded)
    const rgb = layerRange('rgb')
    expect(requests).toEqual([
      { start: info.chunkStart, end: layerRange('intensity').end },
      rgb,
    ])
    expect(c.fieldsPresent!.has('gpsTime')).toBe(false)
    expect(c.fieldsPresent!.has('nir')).toBe(false)
    expect(c.fieldsPresent!.has('rgb')).toBe(true)
    expect(c.attributes).toBeUndefined()

    const ref = await startEngine()
    const r = await decodeFirst(ref.engine, ref.decoded)
    expect(Buffer.compare(Buffer.from(c.positions.buffer), Buffer.from(r.positions.buffer))).toBe(0)
    expect(Buffer.compare(Buffer.from(c.colors.buffer), Buffer.from(r.colors.buffer))).toBe(0)
    expect(Buffer.compare(Buffer.from(c.classification!.buffer), Buffer.from(r.classification!.buffer))).toBe(0)
    expect(Buffer.compare(Buffer.from(c.intensity8!.buffer), Buffer.from(r.intensity8!.buffer))).toBe(0)
    engine.dispose(); ref.engine.dispose()
  })
})

describe('P2 demands + surfacing', () => {
  it('surface demand for gpsTime → attributes.gpsTime and fieldsPresent ∋ gpsTime', async () => {
    const { engine, decoded } = await startEngine({ fetchFields: 'render' })
    engine.demandFields(['gpsTime'], { surface: true })
    const c = await decodeFirst(engine, decoded)
    expect(c.fieldsPresent!.has('gpsTime')).toBe(true)
    expect(c.attributes!.gpsTime).toBeInstanceOf(Float64Array)
    for (let i = 0; i < info.pointCount; i += 97) expect(c.attributes!.gpsTime![i]).toBe(fullGps(i))
    engine.dispose()
  })

  it('enforcement: a forged surface mask never surfaces unfetched fields', async () => {
    const { engine, decoded } = await startEngine({ fetchFields: 'render' })
    ;(engine as unknown as { demands: { surfaceBits: () => number } }).demands.surfaceBits = () => FIELD_BITS_ALL
    const c = await decodeFirst(engine, decoded)
    expect(c.fieldsPresent!.has('gpsTime')).toBe(false)
    expect(c.attributes?.gpsTime).toBeUndefined()
    expect(c.attributes?.nir).toBeUndefined()
    expect(c.attributes?.scanAngle).toBeUndefined()
    // fetched fields may surface
    expect(c.attributes?.intensityRaw).toBeInstanceOf(Uint16Array)
    engine.dispose()
  })

  it('release shrinks the mask; onFieldsChanged fires exactly on bit changes', async () => {
    const { engine, fieldEvents } = await startEngine({ fetchFields: 'render' })
    expect(engine.getFieldMask().has('gpsTime')).toBe(false)
    const a = engine.demandFields(['gpsTime'])
    const b = engine.demandFields(['gpsTime'])
    expect(fieldEvents).toHaveLength(1)
    expect(engine.getFieldMask().has('gpsTime')).toBe(true)
    a.release(); a.release()
    expect(fieldEvents).toHaveLength(1)
    b.release()
    expect(fieldEvents).toHaveLength(2)
    expect(engine.getFieldMask().has('gpsTime')).toBe(false)
    engine.dispose()
  })
})

describe('P3 layer top-up', () => {
  it('after a render decode, upgrading for gpsTime fetches only the gps_time layer', async () => {
    const { engine, decoded } = await startEngine({ fetchFields: 'render' })
    await decodeFirst(engine, decoded)
    engine.demandFields(['gpsTime'], { surface: true })
    requests.length = 0
    engine.upgradeChunks([0])
    engine.updateCamera()
    await waitFor(() => decoded.length === 2)
    const up = decoded[1]
    expect(requests).toEqual([layerRange('gps_time')])
    expect(up.isUpgrade).toBe(true)
    expect(up.fieldsPresent!.has('gpsTime')).toBe(true)
    for (let i = 0; i < info.pointCount; i += 97) expect(up.attributes!.gpsTime![i]).toBe(fullGps(i))
    engine.dispose()
  })

  it('full bytes cached → upgrade re-decodes with zero fetches', async () => {
    const cache = memoryCache()
    const { engine, decoded } = await startEngine({ cache: cache as never })
    await decodeFirst(engine, decoded)
    await settle(20)
    engine.demandFields(['gpsTime'], { surface: true })
    requests.length = 0
    engine.upgradeChunks([0])
    engine.updateCamera()
    await waitFor(() => decoded.length === 2)
    expect(requests).toEqual([])
    expect(decoded[1].isUpgrade).toBe(true)
    expect(decoded[1].attributes!.gpsTime![5]).toBe(fullGps(5))
    engine.dispose()
  })

  it('a chunk already covering the mask is skipped', async () => {
    const { engine, decoded } = await startEngine()
    await decodeFirst(engine, decoded)
    engine.demandFields(['gpsTime'])   // fetch-only; 'all' bytes already hold it
    requests.length = 0
    engine.upgradeChunks([0])
    engine.updateCamera()
    await settle(100)
    expect(requests).toEqual([])
    expect(decoded).toHaveLength(1)
    engine.dispose()
  })

  it('an evicted chunk is not upgraded (its next fetch uses the new mask)', async () => {
    const { engine, decoded } = await startEngine({ fetchFields: 'render' })
    await decodeFirst(engine, decoded)
    engine.onChunkEvictedFromGPU(0)
    engine.demandFields(['gpsTime'], { surface: true })
    requests.length = 0
    engine.upgradeChunks([0])
    engine.updateCamera()
    await settle(100)
    expect(requests).toEqual([])
    expect(decoded).toHaveLength(1)
    engine.dispose()
  })
})
