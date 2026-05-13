/**
 * Pack source point data into the GPU storage layout.
 *
 * Source format (from Track A decoder workers — see [[Decoder Workers]] wiki):
 *   positions: Int16Array, length = pointCount * 3   (x, y, z per-chunk quantized)
 *   colors:    Uint8Array, length = pointCount * 4   (RGBA, A typically unused)
 *
 * GPU layout (12 bytes per point, 3 × u32):
 *   word 0:  x in low 16 bits | y in high 16 bits
 *   word 1:  z in low 16 bits | reserved/flags in high 16 bits (zero for now)
 *   word 2:  RGBA8 little-endian: R | (G<<8) | (B<<16) | (A<<24)
 *
 * The compute shader reinterprets the int16 halves to signed via bit-twiddling
 * (see points-depth.wgsl unpackI16).
 *
 * Types are imported from the worker pool to stay in sync with the decoder output.
 */

import type { DecodedChunk } from '../decode/worker-pool.js'

export const BYTES_PER_POINT = 12

// Re-export so callers can import from one place.
export type { DecodedChunk }

export interface SeedPoint {
  x: number
  y: number
  z: number
}

/**
 * Pack a chunk into a Uint32Array of length `pointCount * 3`.
 * The returned buffer is ready to upload via queue.writeBuffer().
 */
export function packChunk(chunk: DecodedChunk): Uint32Array {
  const { positions, colors, pointCount } = chunk
  const packed = new Uint32Array(pointCount * 3)

  for (let i = 0; i < pointCount; i++) {
    // `& 0xFFFF` masks the int16 bit pattern into the low 16 bits of a u32.
    // Negative ints (e.g. -1) become 0xFFFF, which is what the shader expects
    // to sign-extend back to -1.
    const xi = positions[i * 3 + 0] & 0xFFFF
    const yi = positions[i * 3 + 1] & 0xFFFF
    const zi = positions[i * 3 + 2] & 0xFFFF

    const r = colors[i * 4 + 0]
    const g = colors[i * 4 + 1]
    const b = colors[i * 4 + 2]
    const a = colors[i * 4 + 3]

    packed[i * 3 + 0] = (yi << 16) | xi
    packed[i * 3 + 1] = zi
    packed[i * 3 + 2] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  return packed
}

export interface PackedSeeds {
  packed: Uint32Array
  pointCount: number
  min: [number, number, number]
  range: [number, number, number]
}

/**
 * Pack a list of seed points into the chunk layout.
 * Seeds are world-space Float32 — we re-quantize per the pseudo-chunk's bbox.
 * Color is elevation-ramped (cool→warm) to match Track A WebGL seed visual.
 */
export function packSeedsAsChunk(seeds: SeedPoint[]): PackedSeeds {
  if (seeds.length === 0) {
    return {
      packed: new Uint32Array(0),
      pointCount: 0,
      min: [0, 0, 0],
      range: [1, 1, 1],
    }
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const s of seeds) {
    if (s.x < minX) minX = s.x
    if (s.y < minY) minY = s.y
    if (s.z < minZ) minZ = s.z
    if (s.x > maxX) maxX = s.x
    if (s.y > maxY) maxY = s.y
    if (s.z > maxZ) maxZ = s.z
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const rangeZ = maxZ - minZ || 1

  const packed = new Uint32Array(seeds.length * 3)
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]
    const qx = Math.round(((s.x - minX) / rangeX) * 65535 - 32768) & 0xFFFF
    const qy = Math.round(((s.y - minY) / rangeY) * 65535 - 32768) & 0xFFFF
    const qz = Math.round(((s.z - minZ) / rangeZ) * 65535 - 32768) & 0xFFFF

    const t = (s.z - minZ) / rangeZ
    const r = Math.max(0, Math.min(255, Math.round(40  + t * 215)))
    const g = Math.max(0, Math.min(255, Math.round(60  + (1 - Math.abs(t - 0.5) * 2) * 120)))
    const b = Math.max(0, Math.min(255, Math.round(220 - t * 200)))

    packed[i * 3 + 0] = (qy << 16) | qx
    packed[i * 3 + 1] = qz
    packed[i * 3 + 2] = ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  return {
    packed,
    pointCount: seeds.length,
    min: [minX, minY, minZ],
    range: [rangeX, rangeY, rangeZ],
  }
}