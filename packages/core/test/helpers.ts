import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createLazPerf } from 'laz-perf'

export const FIXTURES = ['1_4_w_evlr.laz', 'append-bug.laz', 'autzen_trim.laz'] as const
export const LAYERED_FIXTURES = ['1_4_w_evlr.laz', 'append-bug.laz'] as const

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

export function loadFixture(name: string): ArrayBuffer {
  const b = readFileSync(fixturePath(name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

export interface FixtureInfo {
  pdrf: number
  recordLength: number
  pointDataOffset: number
  pointCount: number
  chunkTableOffset: number
  /** First chunk: starts at pointDataOffset + 8. The layered fixtures are
   *  single-chunk (ends at the chunk table); autzen_trim has 3 chunks, so for
   *  it chunkEnd is only an upper bound — decode chunkPoints points from it. */
  chunkStart: number
  chunkEnd: number
  /** Points in the first chunk (fixtures use the default 50000-point chunks). */
  chunkPoints: number
}

export function fixtureInfo(buf: ArrayBuffer): FixtureInfo {
  const dv = new DataView(buf)
  const pdrf = dv.getUint8(104) & 0x3f
  const pointDataOffset = dv.getUint32(96, true)
  const pointCount = pdrf >= 6 ? Number(dv.getBigUint64(247, true)) : dv.getUint32(107, true)
  const chunkTableOffset = Number(dv.getBigUint64(pointDataOffset, true))
  return {
    pdrf,
    recordLength: dv.getUint16(105, true),
    pointDataOffset,
    pointCount,
    chunkTableOffset,
    chunkStart: pointDataOffset + 8,
    chunkEnd: chunkTableOffset,
    chunkPoints: Math.min(pointCount, 50000),
  }
}

type LazPerfModule = Awaited<ReturnType<typeof createLazPerf>>
let modPromise: Promise<LazPerfModule> | null = null
export function lazPerf(): Promise<LazPerfModule> {
  modPromise ??= createLazPerf()
  return modPromise
}

/** Decode a chunk with laz-perf's ChunkDecoder → packed point records. */
export async function decodeChunkRecords(
  bytes: ArrayBuffer | Uint8Array, pdrf: number, recordLength: number, pointCount: number,
): Promise<Uint8Array> {
  const M = await lazPerf()
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const ptr = M._malloc(src.length)
  const pt = M._malloc(128)
  M.HEAPU8.set(src, ptr)
  const d = new M.ChunkDecoder()
  d.open(pdrf, recordLength, ptr)
  const out = new Uint8Array(pointCount * recordLength)
  for (let i = 0; i < pointCount; i++) {
    d.getPoint(pt)
    out.set(M.HEAPU8.subarray(pt, pt + recordLength), i * recordLength)
  }
  d.delete()
  M._free(ptr)
  M._free(pt)
  return out
}
