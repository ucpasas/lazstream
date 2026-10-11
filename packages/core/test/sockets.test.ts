/**
 * Extension sockets, Phase 1 (core 1.6.0) — wiki [[Extension Sockets —
 * Implementation Plan]]: C6 session surface, C7 exact xyz, C1 multicast tap
 * (+ the throwing-onChunkDecoded fix), C4 LAS directory reader. Each socket
 * also gets a no-registration parity check. Real engine + decode worker;
 * fetches served from fixtures (engine-harness.ts).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { requests, serve, installFakeWorker, assetUrls, waitFor, settle } from './engine-harness.js'
import { loadFixture } from './helpers.js'
import type { DecodedChunk } from '../src/decode/worker-pool.js'
import type { EngineEvents } from '../src/engine/streaming-engine.js'
import type { Manifest } from '../src/engine/manifest-types.js'

vi.mock('../src/network/range-fetcher.js', async (orig) =>
  (await import('./engine-harness.js')).rangeFetcherMock(orig))

const { StreamingEngine } = await import('../src/engine/streaming-engine.js')
const { ManifestSession } = await import('../src/engine/manifest-session.js')
const { readLasDirectory } = await import('../src/engine/las-directory.js')
const { WorkerPool } = await import('../src/decode/worker-pool.js')
const { ParseError } = await import('../src/engine/header-parser.js')
const { SecurityError } = await import('../src/network/url-validator.js')

const URL_ = 'https://test.invalid/a.laz'
const AUTZEN = loadFixture('autzen_trim.laz')       // PDRF 3, three chunks
const APPEND_BUG = loadFixture('append-bug.laz')    // PDRF 8, one chunk
const EVLR = loadFixture('1_4_w_evlr.laz')

beforeAll(installFakeWorker)

interface Capture { decoded: DecodedChunk[]; warnings: string[]; seeds: number[]; events: EngineEvents }
function capture(onDecoded?: (c: DecodedChunk) => void): Capture {
  const c: Capture = { decoded: [], warnings: [], seeds: [], events: {} }
  c.events = {
    onChunkDecoded: ch => { c.decoded.push(ch); onDecoded?.(ch) },
    onWarning: w => c.warnings.push(w),
    onSeedsReady: s => c.seeds.push(s.length),
  }
  return c
}

/** A session wired with providers that admit every chunk at any SSE. */
function openSession(manifest: Manifest, events: EngineEvents) {
  const session = new ManifestSession(manifest, { events, workerCount: 1, assetUrls })
  session.setCameraProvider(() => ({ worldX: 0, worldY: 0, worldZ: 0, fovY: 1, canvasHeight: 1e12 }))
  session.setFrustumProvider(() => ({ minX: -1e15, minY: -1e15, minZ: -1e15, maxX: 1e15, maxY: 1e15, maxZ: 1e15 }))
  return session
}

async function pump(session: InstanceType<typeof ManifestSession>, until: () => boolean) {
  const t0 = Date.now()
  while (!until()) {
    if (Date.now() - t0 > 10_000) throw new Error('pump timed out')
    session.updateCamera()
    await settle(10)
  }
}

const one = (url = URL_): Manifest => ({ version: '1.0', tiles: [{ url }] })

// ── C6 — session surface ────────────────────────────────────────────────────

describe('C6 session surface', () => {
  it('state is final inside onSeedsReady; seedsReady resolves with it', async () => {
    serve(AUTZEN)
    const inCallback: Array<{ seeds: number; got: number; chunks: number }> = []
    const session: InstanceType<typeof ManifestSession> = new ManifestSession(one(), {
      workerCount: 1, assetUrls,
      events: { onSeedsReady: s => inCallback.push({ seeds: s.length, got: session.getSeeds().length, chunks: session.chunkCount }) },
    })
    expect(session.chunkCount).toBe(0)
    expect(session.getSeeds()).toHaveLength(0)
    expect(session.resolveChunk(0)).toBeNull()
    await session.load()
    await session.seedsReady
    expect(inCallback).toHaveLength(1)
    const [{ seeds, got, chunks }] = inCallback
    expect(got).toBe(seeds)
    expect(chunks).toBe(3)
    expect(session.tiles).toEqual([expect.objectContaining({
      url: URL_, chunkOffset: 0, chunkCount: 3, seedCount: seeds, status: 'ok',
    })])
    expect(session.tiles[0].header?.pointDataRecordFormat).toBe(3)
    session.dispose()
  })

  it('resolveChunk maps global indices across tiles and rejects out-of-range', async () => {
    serve(AUTZEN)
    const session = new ManifestSession(
      { version: '1.0', tiles: [{ url: URL_ }, { url: 'https://test.invalid/b.laz' }] },
      { workerCount: 2, assetUrls, events: {} },
    )
    void session.load()
    await session.seedsReady
    expect(session.chunkCount).toBe(6)
    expect(session.tiles.map(t => t.chunkOffset)).toEqual([0, 3])
    expect(session.resolveChunk(2)).toEqual({ tileIndex: 0, localIndex: 2 })
    expect(session.resolveChunk(3)).toEqual({ tileIndex: 1, localIndex: 0 })
    expect(session.resolveChunk(6)).toBeNull()
    expect(session.resolveChunk(-1)).toBeNull()
    expect(session.resolveChunk(1.5)).toBeNull()
    expect(session.getSeeds().filter(s => s.chunkIndex >= 3)).toHaveLength(session.tiles[1].seedCount)
    session.dispose()
  })

  it('a failed tile is reported in tiles with its error; the rest settle', async () => {
    serve(AUTZEN)
    const c = capture()
    const session = new ManifestSession(
      { version: '1.0', tiles: [{ url: URL_ }, { url: 'http://insecure.invalid/x.laz' }] },
      { workerCount: 2, assetUrls, events: c.events },
    )
    void session.load()
    await session.seedsReady
    expect(session.tiles[1]).toEqual(expect.objectContaining({ status: 'failed', seedCount: 0, chunkCount: 0 }))
    expect(session.tiles[1].error).toMatch(/http/i)
    expect(c.seeds).toHaveLength(1)
    session.dispose()
  })

  it('a tile failing after it seeded settles once: onSeedsReady fires once, status → failed (fix)', async () => {
    serve(AUTZEN)
    const c = capture()
    const init = vi.spyOn(WorkerPool.prototype, 'init').mockRejectedValueOnce(new Error('worker init failed'))
    const session = new ManifestSession(one(), { workerCount: 1, assetUrls, events: c.events })
    await session.load()
    await settle(20)
    expect(c.seeds).toHaveLength(1)
    expect(session.tiles[0]).toEqual(expect.objectContaining({ status: 'failed', error: 'worker init failed' }))
    expect(session.chunkCount).toBe(3)
    init.mockRestore()
    session.dispose()
  })

  it('seedsReady rejects when every tile fails, and on dispose before seeds', async () => {
    const failing = new ManifestSession(one('http://insecure.invalid/x.laz'), { workerCount: 1, assetUrls, events: {} })
    void failing.load()
    await expect(failing.seedsReady).rejects.toThrow(/All manifest tiles failed/)

    const early = new ManifestSession(one(), { workerCount: 1, assetUrls, events: {} })
    early.dispose()
    await expect(early.seedsReady).rejects.toThrow(/disposed/)
  })

  it('holdDispatch taken before load blocks dispatch until released', async () => {
    serve(AUTZEN)
    const c = capture()
    const session = openSession(one(), c.events)
    const hold = session.holdDispatch()
    await session.load()
    const seedRequests = requests.length
    for (let i = 0; i < 20; i++) { session.updateCamera(); await settle(5) }
    expect(c.decoded).toHaveLength(0)
    expect(requests.length).toBe(seedRequests)
    hold.release()
    hold.release()   // idempotent
    await pump(session, () => c.decoded.length === 3)
    session.dispose()
  })
})

// ── C7 — exact coordinates ──────────────────────────────────────────────────

describe('C7 exact xyz', () => {
  it("demandFields(['xyz'], {surface}) → attributes.xyzRaw, consistent with positions", async () => {
    serve(APPEND_BUG)
    const decoded: DecodedChunk[] = []
    const engine = new StreamingEngine({
      workerCount: 1, assetUrls, events: { onChunkDecoded: ch => decoded.push(ch) },
    })
    engine.demandFields(['xyz'], { surface: true })
    await engine.load(URL_)
    engine.decodeAll()
    await waitFor(() => decoded.length === 1)
    const ch = decoded[0]
    const raw = ch.attributes?.xyzRaw
    expect(raw).toBeInstanceOf(Int32Array)
    expect(raw).toHaveLength(ch.pointCount * 3)
    expect(ch.fieldsPresent?.has('xyz')).toBe(true)

    const dv = new DataView(APPEND_BUG)
    const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)]
    const offset = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)]
    const min = [ch.minX, ch.minY, ch.minZ]
    const range = [ch.maxX - ch.minX || 1, ch.maxY - ch.minY || 1, ch.maxZ - ch.minZ || 1]
    for (let i = 0; i < ch.pointCount; i++) {
      for (let a = 0; a < 3; a++) {
        const exact = raw![i * 3 + a] * scale[a] + offset[a]
        const approx = (ch.positions[i * 3 + a] + 32768) / 65535 * range[a] + min[a]
        expect(Math.abs(exact - approx)).toBeLessThanOrEqual(range[a] / 65535)
      }
    }
    engine.dispose()
  })
})

// ── C1 — multicast tap + throwing-consumer fix ──────────────────────────────

describe('C1 decoded tap', () => {
  it('a throwing constructor onChunkDecoded no longer stalls decoding (fix)', async () => {
    serve(AUTZEN)
    let calls = 0
    const warnings: string[] = []
    const engine = new StreamingEngine({
      workerCount: 1, assetUrls,
      events: { onChunkDecoded: () => { calls++; throw new Error('consumer bug') }, onWarning: w => warnings.push(w) },
    })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await engine.load(URL_)
    engine.decodeAll()
    await waitFor(() => calls === 3)
    expect(warnings.filter(w => w.includes('consumer bug'))).toHaveLength(3)
    err.mockRestore()
    engine.dispose()
  })

  it('subscribers get every chunk with global indices; a throwing one is isolated', async () => {
    serve(AUTZEN)
    const c = capture()
    const session = openSession(one(), c.events)
    const got: number[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    session.subscribeDecoded(() => { throw new Error('bad add-on') })
    const sub = session.subscribeDecoded(ch => got.push(ch.chunkIndex))
    await session.load()
    await pump(session, () => c.decoded.length === 3)
    expect(got.sort()).toEqual(c.decoded.map(d => d.chunkIndex).sort())
    expect(c.warnings.filter(w => w.includes('bad add-on'))).toHaveLength(3)
    sub.unsubscribe()
    sub.unsubscribe()   // idempotent
    err.mockRestore()
    session.dispose()
  })

  it('fields option demands + surfaces, and unsubscribe releases the demand', async () => {
    serve(APPEND_BUG)
    const c = capture()
    const session = openSession(one(), c.events)
    const sub = session.subscribeDecoded(() => {}, { fields: ['gpsTime'] })
    expect(session.getFieldMask().has('gpsTime')).toBe(true)
    await session.load()
    await pump(session, () => c.decoded.length === 1)
    expect(c.decoded[0].attributes?.gpsTime).toBeInstanceOf(Float64Array)
    sub.unsubscribe()
    session.dispose()
  })

  it('parity: no subscriber → the constructor callback sees the same chunks as before', async () => {
    serve(AUTZEN)
    const c = capture()
    const session = openSession(one(), c.events)
    await session.load()
    await pump(session, () => c.decoded.length === 3)
    await settle(50)
    expect(c.decoded).toHaveLength(3)
    expect(c.decoded.every(d => d.attributes === undefined)).toBe(true)
    expect(c.warnings.filter(w => w.includes('listener threw'))).toHaveLength(0)
    session.dispose()
  })
})

// ── C4 — LAS directory ──────────────────────────────────────────────────────

/** Minimal uncompressed LAS 1.1 file: 227-byte header + one 8-byte VLR. */
function syntheticLas11(): ArrayBuffer {
  const vlrLen = 8
  const size = 227 + 54 + vlrLen
  const buf = new ArrayBuffer(size)
  const dv = new DataView(buf)
  const put = (at: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)) }
  put(0, 'LASF')
  dv.setUint8(24, 1); dv.setUint8(25, 1)
  put(26, 'SYNTHETIC'); put(58, 'lazstream test')
  dv.setUint16(90, 42, true); dv.setUint16(92, 2004, true)
  dv.setUint16(94, 227, true)
  dv.setUint32(96, size, true)
  dv.setUint32(100, 1, true)
  dv.setUint8(104, 1)
  dv.setUint16(105, 28, true)
  for (const at of [131, 139, 147]) dv.setFloat64(at, 0.01, true)
  put(227 + 2, 'LASF_Projection')
  dv.setUint16(227 + 18, 34735, true)
  dv.setUint16(227 + 20, vlrLen, true)
  put(227 + 22, 'GeoKeyDirectoryTag')
  for (let i = 0; i < vlrLen; i++) dv.setUint8(227 + 54 + i, i + 1)
  return buf
}

describe('C4 LAS directory', () => {
  it('LAZ 1.4 with EVLRs: raw header, LASzip VLR, EVLR walk, streamable', async () => {
    serve(EVLR)
    const dir = await readLasDirectory(URL_, { includeEvlrs: true, includeData: true })
    expect(dir.compression).toBe('laz')
    expect(dir.streamable).toBe(true)
    expect(dir.header.versionMinor).toBe(4)
    expect(dir.header.projectGuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    const vlrs = dir.vlrs.filter(v => v.kind === 'vlr')
    const evlrs = dir.vlrs.filter(v => v.kind === 'evlr')
    expect(vlrs).toHaveLength(dir.header.numberOfVLRs)
    expect(vlrs.some(v => v.userId === 'laszip encoded' && v.recordId === 22204)).toBe(true)
    expect(dir.header.numberOfEVLRs).toBeGreaterThan(0)
    expect(evlrs).toHaveLength(dir.header.numberOfEVLRs!)
    for (const v of dir.vlrs) {
      if (!v.truncated) expect(v.data?.byteLength).toBe(v.length)
    }
    expect(evlrs[0].fileOffset).toBe(dir.header.startOfFirstEvlr)
  })

  it('reports — does not throw — on an uncompressed LAS 1.1 file', async () => {
    serve(syntheticLas11())
    const dir = await readLasDirectory(URL_, { includeData: true })
    expect(dir.compression).toBe('none')
    expect(dir.streamable).toBe(false)
    expect(dir.warnings.some(w => w.startsWith('Not streamable'))).toBe(true)
    expect(dir.header).toEqual(expect.objectContaining({
      versionMinor: 1, systemIdentifier: 'SYNTHETIC', generatingSoftware: 'lazstream test',
      creationDayOfYear: 42, creationYear: 2004, pointDataRecordFormat: 1,
    }))
    expect(dir.vlrs).toEqual([expect.objectContaining({
      kind: 'vlr', userId: 'LASF_Projection', recordId: 34735, description: 'GeoKeyDirectoryTag', length: 8,
    })])
    expect([...new Uint8Array(dir.vlrs[0].data!)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('maxRecordBytes truncates record data; data is omitted unless asked', async () => {
    serve(syntheticLas11())
    const small = await readLasDirectory(URL_, { includeData: true, maxRecordBytes: 4 })
    expect(small.vlrs[0]).toEqual(expect.objectContaining({ truncated: true }))
    expect(small.vlrs[0].data).toBeUndefined()
    const bare = await readLasDirectory(URL_)
    expect(bare.vlrs[0].data).toBeUndefined()
    expect(bare.vlrs[0].truncated).toBeUndefined()
  })

  it('throws only for non-LAS bytes and invalid URLs', async () => {
    serve(new TextEncoder().encode('not a las file'.repeat(40)).buffer)
    await expect(readLasDirectory(URL_)).rejects.toBeInstanceOf(ParseError)
    await expect(readLasDirectory('http://insecure.invalid/x.laz')).rejects.toBeInstanceOf(SecurityError)
  })

  it('session.getDirectory reuses the fetched header bytes', async () => {
    serve(EVLR)
    const session = new ManifestSession(one(), { workerCount: 1, assetUrls, events: {} })
    await session.load()
    const before = requests.length
    const dir = await session.getDirectory(0)
    expect(requests.length).toBe(before)
    expect(dir.streamable).toBe(true)
    await expect(session.getDirectory(5)).rejects.toBeInstanceOf(RangeError)
    session.dispose()
  })

  it('session.getDirectory reads a tile that failed before its header', async () => {
    serve(syntheticLas11())
    const c = capture()
    const session = new ManifestSession(one(), { workerCount: 1, assetUrls, events: c.events })
    await session.load()
    const dir = await session.getDirectory(0)
    expect(dir.streamable).toBe(false)
    expect(dir.header.versionMinor).toBe(1)
    session.dispose()
  })
})
