/**
 * Browser socket harness — T3 of wiki [[Extension Sockets — Remaining Work]].
 *
 * Runs the shipped sockets (C1 decoded tap, C4 LAS directory, C6 session
 * surface, C7 exact xyz) for real: laz-perf WASM in Web Workers loaded from
 * the built `@lazstream/core` dist, Range fetches, no fake worker. Headless —
 * a bare ManifestSession, no viewer, no GPU — so it runs on CI runners.
 *
 * Imports only published entry points (scripts/ci/check-boundaries.mjs).
 *
 * Modes:
 *   (default)          same-origin fixtures from packages/core/test/fixtures
 *   ?url=<https LAZ>   one cloud file; decodes capped at ?chunks=N (default 24)
 *
 * Result: window.__lazstreamHarness = { done, ok, checks[] } (read by
 * smoke.spec.ts) and a text report in #out.
 */
import { ManifestSession, dequantizeChunk, readLasDirectory, urlToManifest } from '@lazstream/core'
import type { BBox3D, DecodedChunk, LasDirectory, Manifest, ManifestSessionOptions } from '@lazstream/core'
import type { HarnessResult } from './result'

// ─── Report ──────────────────────────────────────────────────────────────────

const result: HarnessResult = { done: false, ok: false, mode: 'fixtures', checks: [] }
window.__lazstreamHarness = result
const out = document.getElementById('out')!

function render(): void {
  out.innerHTML = result.checks.map(c =>
    `<span class="${c.ok ? 'pass' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'}</span> ` +
    `${escapeHtml(c.name)} (${c.ms.toFixed(0)} ms)${c.detail ? ' — ' + escapeHtml(c.detail) : ''}`,
  ).join('\n') + (result.done ? `\n\n${result.ok ? 'ALL PASSED' : 'FAILED'}` : '\n\nrunning…')
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

class CheckFailure extends Error {}

function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new CheckFailure(message)
}

/** Run one named check; a failure is recorded, never thrown. Returns the value or null. */
async function check<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = performance.now()
  try {
    const value = await fn()
    const detail = typeof value === 'string' ? value : ''
    result.checks.push({ name, ok: true, ms: performance.now() - t0, detail })
    return value
  } catch (err) {
    const detail = err instanceof Error ? (err instanceof CheckFailure ? err.message : `${err.name}: ${err.message}`) : String(err)
    result.checks.push({ name, ok: false, ms: performance.now() - t0, detail })
    return null
  } finally {
    render()
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Drive updateCamera() (what a renderer's frame loop does) until `done()` or timeout. */
async function tick(session: ManifestSession, done: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    session.updateCamera()
    if (done()) return true
    await sleep(16)
  }
  return done()
}

function union(boxes: BBox3D[]): BBox3D {
  return {
    minX: Math.min(...boxes.map(b => b.minX)), minY: Math.min(...boxes.map(b => b.minY)),
    minZ: Math.min(...boxes.map(b => b.minZ)), maxX: Math.max(...boxes.map(b => b.maxX)),
    maxY: Math.max(...boxes.map(b => b.maxY)), maxZ: Math.max(...boxes.map(b => b.maxZ)),
  }
}

/**
 * Providers a renderer would supply. sseThreshold 0 (set on the session) plus
 * a frustum covering every tile makes every seeded chunk eligible, whatever
 * the camera position — the harness tests delivery, not prioritisation.
 */
function attachProviders(session: ManifestSession): void {
  session.setFrustumProvider(() => {
    const boxes = session.tiles.flatMap(t => (t.header ? [t.header] : []))
    if (boxes.length === 0) return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const b = union(boxes)
    const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 1)
    return { minX: b.minX - pad, minY: b.minY - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxY: b.maxY + pad, maxZ: b.maxZ + pad }
  })
  session.setCameraProvider(() => {
    const h = session.tiles[0]?.header
    return {
      worldX: h ? (h.minX + h.maxX) / 2 : 0,
      worldY: h ? (h.minY + h.maxY) / 2 : 0,
      worldZ: h ? h.maxZ + 100 : 0,
      fovY: Math.PI / 3,
      canvasHeight: 1080,
    }
  })
}

/** Requests the page has made to `url` (Resource Timing; buffer enlarged in main()). */
function requestsTo(url: string): number {
  return performance.getEntriesByType('resource').filter(e => e.name === url).length
}

const LASZIP_VLR = (d: LasDirectory) => d.vlrs.some(v => v.kind === 'vlr' && v.userId === 'laszip encoded' && v.recordId === 22204)

/** C4 standalone directory read: structure only, no point data. */
async function checkDirectory(url: string, expectEvlrs: boolean): Promise<string> {
  const dir = await readLasDirectory(url, { includeEvlrs: true, includeData: true })
  expect(dir.compression === 'laz', `compression=${dir.compression}`)
  expect(dir.streamable, `not streamable: ${dir.warnings.join('; ')}`)
  expect(LASZIP_VLR(dir), 'no LASzip VLR (laszip encoded / 22204)')
  const vlrs = dir.vlrs.filter(v => v.kind === 'vlr')
  const evlrs = dir.vlrs.filter(v => v.kind === 'evlr')
  expect(vlrs.length === dir.header.numberOfVLRs, `VLRs ${vlrs.length} ≠ header ${dir.header.numberOfVLRs}`)
  if (expectEvlrs) {
    expect((dir.header.numberOfEVLRs ?? 0) > 0, 'expected EVLRs in header')
    expect(evlrs.length === dir.header.numberOfEVLRs, `EVLRs ${evlrs.length} ≠ header ${dir.header.numberOfEVLRs}`)
    expect(evlrs[0].fileOffset === dir.header.startOfFirstEvlr, 'first EVLR offset ≠ startOfFirstEvlr')
  }
  return `LAS ${dir.header.versionMajor}.${dir.header.versionMinor} PDRF ${dir.header.pointDataRecordFormat}, ` +
    `${vlrs.length} VLR / ${evlrs.length} EVLR`
}

/**
 * C7: exact LAS integers agree with the quantised render positions to within
 * one quantisation step (+ float32 rounding of dequantizeChunk's output).
 */
function checkExactXyz(chunk: DecodedChunk, scale: [number, number, number], offset: [number, number, number]): void {
  const raw = chunk.attributes?.xyzRaw
  expect(raw instanceof Int32Array, `chunk ${chunk.chunkIndex}: attributes.xyzRaw missing (decode-worker.js out of date?)`)
  expect(raw.length === chunk.pointCount * 3, `chunk ${chunk.chunkIndex}: xyzRaw length ${raw.length} ≠ 3×${chunk.pointCount}`)
  const deq = dequantizeChunk(chunk)
  const min = [chunk.minX, chunk.minY, chunk.minZ]
  const range = [chunk.maxX - chunk.minX, chunk.maxY - chunk.minY, chunk.maxZ - chunk.minZ]
  for (let i = 0; i < chunk.pointCount; i++) {
    for (let a = 0; a < 3; a++) {
      const world = raw[i * 3 + a] * scale[a] + offset[a]
      const tol = (range[a] || 1) / 65535 + Math.abs(world) * 2 ** -22 + scale[a]
      const err = Math.abs(world - deq[i * 3 + a])
      expect(err <= tol, `chunk ${chunk.chunkIndex} point ${i} axis ${'xyz'[a]}: exact ${world} vs render ${deq[i * 3 + a]} (|Δ| ${err.toExponential(2)} > ${tol.toExponential(2)})`)
      expect(world >= min[a] - tol && world <= min[a] + range[a] + tol, `chunk ${chunk.chunkIndex} point ${i}: outside chunk bbox`)
    }
  }
}

// ─── Session scenario (C6 → C1 + C7 → C4 per tile) ──────────────────────────

interface Scenario {
  label: string
  manifest: Manifest
  /** Stop after this many decoded chunks (remote mode); undefined = all seeded chunks. */
  maxChunks?: number
  timeoutMs: number
}

async function runSession(s: Scenario): Promise<void> {
  const ctorChunks: number[] = []
  const tapChunks: DecodedChunk[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const opts: ManifestSessionOptions = {
    workerCount: 2,
    sseThreshold: 0,
    maxFetches: s.maxChunks !== undefined ? 4 : undefined,
    events: {
      onChunkDecoded: c => { if (!c.isUpgrade) ctorChunks.push(c.chunkIndex) },
      onError: e => errors.push(e.message),
      // Warnings are informational (e.g. LAZ 1.2 "older compression format");
      // a failed tile is a hard error — it also shows in tiles[].status.
      onWarning: m => (/failed to load/i.test(m) ? errors : warnings).push(m),
    },
  }
  const session = new ManifestSession(s.manifest, opts)
  attachProviders(session)
  const hold = session.holdDispatch()
  const sub = session.subscribeDecoded(c => { if (!c.isUpgrade) tapChunks.push(c) }, { fields: ['xyz'] })
  const loaded = session.load()

  try {
    const ok = await check(`${s.label} · C6 seedsReady, chunkCount, tiles, getSeeds, resolveChunk`, async () => {
      await session.seedsReady
      await loaded
      expect(errors.length === 0, errors.join('; '))
      const tiles = session.tiles
      expect(tiles.length === s.manifest.tiles.length, `tiles ${tiles.length} ≠ manifest ${s.manifest.tiles.length}`)
      let offset = 0
      for (const [i, t] of tiles.entries()) {
        expect(t.status === 'ok', `tile ${i} ${t.status}: ${t.error ?? ''}`)
        expect(t.chunkOffset === offset, `tile ${i} chunkOffset ${t.chunkOffset} ≠ ${offset}`)
        expect(t.chunkCount > 0 && t.seedCount > 0 && t.seedCount <= t.chunkCount, `tile ${i} chunks ${t.chunkCount} seeds ${t.seedCount}`)
        expect(t.header !== null, `tile ${i} has no header`)
        const first = session.resolveChunk(t.chunkOffset)
        const last = session.resolveChunk(t.chunkOffset + t.chunkCount - 1)
        expect(first?.tileIndex === i && first.localIndex === 0, `resolveChunk(${t.chunkOffset}) → ${JSON.stringify(first)}`)
        expect(last?.tileIndex === i && last.localIndex === t.chunkCount - 1, `resolveChunk(last of tile ${i}) → ${JSON.stringify(last)}`)
        offset += t.chunkCount
      }
      expect(session.chunkCount === offset, `chunkCount ${session.chunkCount} ≠ Σ tiles ${offset}`)
      expect(session.resolveChunk(offset) === null && session.resolveChunk(-1) === null, 'resolveChunk out of range not null')
      const seeds = session.getSeeds()
      const seedTotal = tiles.reduce((n, t) => n + t.seedCount, 0)
      expect(seeds.length === seedTotal, `getSeeds ${seeds.length} ≠ Σ seedCount ${seedTotal}`)
      expect(seeds.every(p => p.chunkIndex >= 0 && p.chunkIndex < offset), 'seed chunkIndex outside global range')
      expect(new Set(seeds.map(p => p.chunkIndex)).size === seeds.length, 'duplicate seed chunkIndex')
      const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : ''
      return `${tiles.length} tile(s), ${offset} chunks, ${seeds.length} seeds${note}`
    })
    if (ok === null) return

    await check(`${s.label} · C6 holdDispatch blocks camera dispatch`, async () => {
      await tick(session, () => false, 600)
      expect(ctorChunks.length === 0 && tapChunks.length === 0, `decoded ${ctorChunks.length} chunk(s) while held`)
      return 'no decodes in 600 ms of updateCamera() while held'
    })

    hold.release()
    const target = Math.min(s.maxChunks ?? Infinity, session.getSeeds().length)

    await check(`${s.label} · C1 subscribeDecoded multicast after release`, async () => {
      // Wait for the constructor callback (the reference path), then give the
      // tap a short grace period — a broken tap fails in seconds, not at timeout.
      const ctorDone = await tick(session, () => ctorChunks.length >= target, s.timeoutMs)
      const done = ctorDone && await tick(session, () => tapChunks.length >= target, 2_000)
      expect(errors.length === 0, errors.join('; '))
      expect(done, `timed out: tap ${tapChunks.length}, constructor ${ctorChunks.length} of ${target}`)
      const tapIdx = tapChunks.map(c => c.chunkIndex)
      expect(new Set(tapIdx).size === tapIdx.length, 'a chunk was delivered twice')
      if (s.maxChunks === undefined) {
        const seeded = new Set(session.getSeeds().map(p => p.chunkIndex))
        expect(tapIdx.length === seeded.size && tapIdx.every(i => seeded.has(i)), 'tap chunk set ≠ seeded chunk set')
        expect([...tapIdx].sort((a, b) => a - b).join() === [...ctorChunks].sort((a, b) => a - b).join(),
          'subscriber and constructor callback saw different chunks')
      }
      const points = tapChunks.reduce((n, c) => n + c.pointCount, 0)
      return `${tapChunks.length} chunks, ${points.toLocaleString()} points, global indices`
    })

    await check(`${s.label} · C7 xyzRaw exact coordinates`, async () => {
      expect(tapChunks.length > 0, 'no chunks to check')
      // Independent ground truth: each seed is the chunk's first raw point,
      // read from the file at load time, so point 0 must match it exactly —
      // this catches errors far below the render quantisation step.
      const seedByChunk = new Map(session.getSeeds().map(p => [p.chunkIndex, p]))
      let exact = 0
      for (const c of tapChunks) {
        const where = session.resolveChunk(c.chunkIndex)
        expect(where !== null, `chunk ${c.chunkIndex} does not resolve`)
        const h = session.tiles[where.tileIndex].header!
        checkExactXyz(c, [h.scaleX, h.scaleY, h.scaleZ], [h.offsetX, h.offsetY, h.offsetZ])
        const seed = seedByChunk.get(c.chunkIndex)
        if (!seed) continue
        // Compare LAS integers, not world coordinates: exact, and independent
        // of the file's scale (1 unit can be ~1e-6 m).
        const raw = c.attributes!.xyzRaw!
        const seedRaw = [
          Math.round((seed.x - h.offsetX) / h.scaleX),
          Math.round((seed.y - h.offsetY) / h.scaleY),
          Math.round((seed.z - h.offsetZ) / h.scaleZ),
        ]
        for (let a = 0; a < 3; a++) {
          expect(raw[a] === seedRaw[a], `chunk ${c.chunkIndex} point 0 axis ${'xyz'[a]}: xyzRaw ${raw[a]} ≠ seed ${seedRaw[a]} (LAS integer units)`)
        }
        exact++
      }
      expect(exact > 0, 'no decoded chunk had a seed to compare against')
      if (s.maxChunks === undefined) {
        for (const [i, t] of session.tiles.entries()) {
          const pts = tapChunks.filter(c => session.resolveChunk(c.chunkIndex)?.tileIndex === i).reduce((n, c) => n + c.pointCount, 0)
          if (t.seedCount === t.chunkCount) expect(pts === t.header!.pointCount, `tile ${i}: decoded ${pts} points ≠ header ${t.header!.pointCount}`)
        }
      }
      return `${tapChunks.length} chunks within one quantisation step of render positions; ` +
        `point 0 of ${exact} chunks matches its seed exactly` + (s.maxChunks === undefined ? '; point totals match headers' : '')
    })

    await check(`${s.label} · C4 getDirectory per tile reuses header bytes`, async () => {
      const notes: string[] = []
      for (const [i, t] of session.tiles.entries()) {
        const before = requestsTo(t.url)
        // Non-vacuous: the tile's own load must be visible in the log.
        expect(before > 0, `tile ${i}: no resource-timing entries for ${t.url} — request counting is blind`)
        const dir = await session.getDirectory(i)
        await sleep(50)  // resource entries land asynchronously
        const after = requestsTo(t.url)
        expect(dir.streamable && LASZIP_VLR(dir), `tile ${i}: streamable=${dir.streamable}, LASzip VLR=${LASZIP_VLR(dir)}`)
        expect(after === before, `tile ${i}: getDirectory issued ${after - before} request(s)`)
        notes.push(`tile ${i}: ${dir.vlrs.length} records`)
      }
      return notes.join(', ')
    })

    // Release the demand; a re-subscribe-free session must keep working.
    sub.unsubscribe()
  } finally {
    session.dispose()
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Default buffer is 250 entries; once full, new requests go unrecorded and
  // the C4 "no extra request" check would pass vacuously on large files.
  performance.setResourceTimingBufferSize(100_000)
  const params = new URLSearchParams(location.search)
  const remote = params.get('url')
  const fixture = (name: string) => new URL(`/${name}`, location.origin).href

  await check('environment · Web Workers + WebAssembly available', async () => {
    expect(typeof Worker === 'function', 'no Worker')
    expect(typeof WebAssembly === 'object', 'no WebAssembly')
    return navigator.userAgent
  })

  if (remote) {
    result.mode = 'remote'
    const maxChunks = Math.max(1, Number(params.get('chunks') ?? 24) || 24)
    await check(`remote · C4 readLasDirectory ${remote}`, () => checkDirectory(remote, false))
    await runSession({ label: 'remote', manifest: urlToManifest(remote), maxChunks, timeoutMs: 180_000 })
  } else {
    const autzen = fixture('autzen_trim.laz')
    const evlr = fixture('1_4_w_evlr.laz')
    await check('fixtures · C4 readLasDirectory autzen_trim.laz (LAS 1.2)', () => checkDirectory(autzen, false))
    await check('fixtures · C4 readLasDirectory 1_4_w_evlr.laz (LAS 1.4 + EVLRs)', () => checkDirectory(evlr, true))
    await runSession({ label: 'single tile', manifest: urlToManifest(autzen), timeoutMs: 60_000 })
    await runSession({
      label: 'two tiles',
      manifest: { version: '1.0', tiles: [{ url: autzen }, { url: evlr }] },
      timeoutMs: 60_000,
    })
  }

  result.ok = result.checks.length > 0 && result.checks.every(c => c.ok)
  result.done = true
  render()
}

main().catch(err => {
  result.checks.push({ name: 'harness crashed', ok: false, ms: 0, detail: String(err?.stack ?? err) })
  result.ok = false
  result.done = true
  render()
})
