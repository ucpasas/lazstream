/**
 * Engine-level test harness: the real StreamingEngine + WorkerPool + decode
 * worker, with
 *   - fetchRange/probeUrl served from an in-memory fixture (every range recorded)
 *   - one in-process fake Worker running the real decode-worker module
 *     (structuredClone with a transfer list → real ArrayBuffer detachment)
 *
 * Test files must call vi.mock('../src/network/range-fetcher.js', rangeFetcherMock)
 * themselves (vi.mock is hoisted per file) and use workerCount: 1 — the
 * decode-worker module is a singleton bound to one fake `self`.
 */
import type { DecodedChunk } from '../src/decode/worker-pool.js'
import type { StreamingEngineOptions } from '../src/engine/streaming-engine.js'

export const requests: Array<{ start: number; end: number }> = []
let served: ArrayBuffer = new ArrayBuffer(0)

export function serve(buf: ArrayBuffer): void {
  served = buf
  requests.length = 0
}

export async function fakeFetchRange(_url: string, start: number, endInclusive: number): Promise<ArrayBuffer> {
  requests.push({ start, end: endInclusive + 1 })
  await Promise.resolve()
  return served.slice(start, Math.min(endInclusive + 1, served.byteLength))
}

export async function fakeProbeUrl(): Promise<{ fileSize: number; supportsRange: boolean }> {
  return { fileSize: served.byteLength, supportsRange: true }
}

export async function rangeFetcherMock(orig: () => Promise<unknown>) {
  return {
    ...(await orig() as object),
    fetchRange: fakeFetchRange,
    probeUrl: fakeProbeUrl,
  }
}

// ── Fake worker ─────────────────────────────────────────────────────────────

type Handler = ((e: { data: unknown }) => unknown) | null
let currentWorker: FakeWorker | null = null

const scope = {
  onmessage: null as Handler,
  postMessage(msg: unknown, transfer: Transferable[] = []) {
    const data = structuredClone(msg, { transfer })
    const target = currentWorker
    setTimeout(() => target?.onmessage?.({ data }))
  },
}

class FakeWorker {
  onmessage: Handler = null
  onerror: Handler = null
  constructor() { currentWorker = this }
  postMessage(msg: unknown, transfer: Transferable[] = []) {
    const data = structuredClone(msg, { transfer })
    setTimeout(() => { void scope.onmessage?.({ data }) })
  }
  terminate() { if (currentWorker === this) currentWorker = null }
}

let installed = false
export async function installFakeWorker(): Promise<void> {
  if (installed) return
  installed = true
  ;(globalThis as Record<string, unknown>).self = scope
  ;(globalThis as Record<string, unknown>).Worker = FakeWorker
  await import('../src/workers/decode-worker.js')
}

export const assetUrls = {
  workerUrl: 'fake:decode-worker',
  lazPerfJsUrl: new URL('./lazperf-shim.mjs', import.meta.url).href,
  lazPerfWasmUrl: 'fake:wasm',
}

export async function waitFor(cond: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out')
    await new Promise(r => setTimeout(r, 5))
  }
}

export async function settle(ms = 100): Promise<void> {
  await new Promise(r => setTimeout(r, ms))
}

export type EngineCtor = new (o: StreamingEngineOptions) => {
  load(url: string): Promise<void>
  decodeAll(): void
  updateCamera(): void
  upgradeChunks(i: number[]): void
  dispose(): void
}

export function collect(): { decoded: DecodedChunk[]; errors: Error[] } {
  return { decoded: [], errors: [] }
}

/** In-memory stand-in for ChunkCache (get/set/has only). */
export function memoryCache() {
  const map = new Map<string, ArrayBuffer>()
  return {
    map,
    async get(k: string) { return map.get(k)?.slice(0) ?? null },
    async set(k: string, v: ArrayBuffer) { map.set(k, v.slice(0)) },
    async has(k: string) { return map.has(k) },
  }
}
