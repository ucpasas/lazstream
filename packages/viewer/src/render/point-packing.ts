/**
 * Pack source point data into the GPU storage layout.
 *
 * Source format (from Track A decoder workers — see [[Decoder Workers]] wiki):
 *   positions:      Int16Array, length = pointCount * 3   (x, y, z per-chunk quantized)
 *   colors:         Uint8Array, length = pointCount * 4   (RGBA, A typically unused)
 *   classification: Uint8Array, length = pointCount       (ASPRS class byte)
 *   intensity8:     Uint8Array, length = pointCount       (seed-range-stretched intensity)
 *
 * GPU layout (12 bytes per point, 3 × u32, split hot/cold within the slot):
 *
 *   Position region (hot — the only region the depth pass reads, 8 B/point):
 *     word 0:  x in low 16 bits | y in high 16 bits
 *     word 1:  z in low 16 bits | intensity8 in bits 16–23 | classification in bits 24–31
 *   Attribute region (cold — read per-pixel by the resolve pass, 4 B/point,
 *   starts at u32 offset 2×pointCount within the slot):
 *     word:    RGBA8 little-endian: R | (G<<8) | (B<<16) | (A<<24)
 *
 * Stage 2 of the Renderer Performance Roadmap: splitting position from
 * attributes keeps the depth pass's DRAM traffic to 8 B/point (contiguous),
 * and color resolution becomes O(pixels) via the pick-ID visibility buffer.
 *
 * The compute shader reinterprets the int16 halves to signed via bit-twiddling
 * (see points-depth.wgsl unpackI16).
 *
 * Types are imported from the worker pool to stay in sync with the decoder output.
 */

import type { DecodedChunk } from '@lazstream/core'

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
  const { positions, colors, classification, intensity8, pointCount } = chunk
  const packed = new Uint32Array(pointCount * 3)
  const attrBase = pointCount * 2   // cold region starts after all positions

  for (let i = 0; i < pointCount; i++) {
    // `& 0xFFFF` masks the int16 bit pattern into the low 16 bits of a u32.
    // Negative ints (e.g. -1) become 0xFFFF, which is what the shader expects
    // to sign-extend back to -1.
    const xi  = positions[i * 3 + 0] & 0xFFFF
    const yi  = positions[i * 3 + 1] & 0xFFFF
    const zi  = positions[i * 3 + 2] & 0xFFFF
    const cls = classification ? classification[i] : 0
    const i8  = intensity8    ? intensity8[i]     : 0

    const r = colors[i * 4 + 0]
    const g = colors[i * 4 + 1]
    const b = colors[i * 4 + 2]
    const a = colors[i * 4 + 3]

    packed[i * 2 + 0] = (yi << 16) | xi
    // word 1: z in low 16 bits, intensity8 in bits 16–23, classification in bits 24–31
    packed[i * 2 + 1] = ((cls << 24) | (i8 << 16) | zi) >>> 0
    packed[attrBase + i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  return packed
}

// ─── Runtime voxel LOD (sediment layer) — Stage 5 spike ─────────────────────
// See wiki [[Spike — Runtime Voxel LOD (Sediment Layer)]]. Derives a coarse
// per-chunk voxel list from the already-packed point data: quantise each point
// to a grid³ lattice over the chunk AABB, keep the first point that lands in
// each occupied cell as its representative. Output rides the exact same packed
// 12 B hot/cold layout, so voxel slots render through the unchanged shaders —
// a voxel IS a point (full 16-bit position precision, representative's color).
// v1 keeps first-hit color; averaging is a follow-up if it proves visible.

/** Scratch lattice for voxelizePackedChunk — lazily (re)grown, reused across
 *  calls. Entries hold (pointIndex+1) during a call and are zeroed through the
 *  occupied-cell list afterwards, so per-call reset is O(voxels), not O(grid³). */
let voxelScratch: Uint32Array | null = null
let voxelScratchGrid = 0

export interface VoxelizedChunk {
  packed: Uint32Array
  pointCount: number
}

/**
 * Voxelize an already-packed chunk. `packed` is the packChunk() output
 * (hot region 2 u32/pt, then cold region 1 u32/pt); positions are int16 bit
 * patterns, so cell indices come from integer ops only — no dequantization.
 */
export function voxelizePackedChunk(
  packed: Uint32Array,
  pointCount: number,
  grid: number,
): VoxelizedChunk {
  if (voxelScratch === null || voxelScratchGrid !== grid) {
    voxelScratch = new Uint32Array(grid * grid * grid)
    voxelScratchGrid = grid
  }
  const scratch = voxelScratch
  const occupied: number[] = []

  for (let i = 0; i < pointCount; i++) {
    const w0 = packed[i * 2 + 0]
    const w1 = packed[i * 2 + 1]
    // int16 bit pattern → unsigned [0,65535] (the shader's +32768 shift, as XOR).
    const ux = (w0 & 0xFFFF) ^ 0x8000
    const uy = ((w0 >>> 16) & 0xFFFF) ^ 0x8000
    const uz = (w1 & 0xFFFF) ^ 0x8000
    const cx = (ux * grid) >>> 16
    const cy = (uy * grid) >>> 16
    const cz = (uz * grid) >>> 16
    const cell = (cx * grid + cy) * grid + cz
    if (scratch[cell] === 0) {
      scratch[cell] = i + 1
      occupied.push(cell)
    }
  }

  const voxelCount = occupied.length
  const out = new Uint32Array(voxelCount * 3)
  const srcAttrBase = pointCount * 2
  const dstAttrBase = voxelCount * 2
  for (let k = 0; k < voxelCount; k++) {
    const cell = occupied[k]
    const i = scratch[cell] - 1
    scratch[cell] = 0
    out[k * 2 + 0]      = packed[i * 2 + 0]
    out[k * 2 + 1]      = packed[i * 2 + 1]
    out[dstAttrBase + k] = packed[srcAttrBase + i]
  }
  return { packed: out, pointCount: voxelCount }
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
  const attrBase = seeds.length * 2
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]
    const qx = Math.round(((s.x - minX) / rangeX) * 65535 - 32768) & 0xFFFF
    const qy = Math.round(((s.y - minY) / rangeY) * 65535 - 32768) & 0xFFFF
    const qz = Math.round(((s.z - minZ) / rangeZ) * 65535 - 32768) & 0xFFFF

    const t = (s.z - minZ) / rangeZ
    const r = Math.max(0, Math.min(255, Math.round(40  + t * 215)))
    const g = Math.max(0, Math.min(255, Math.round(60  + (1 - Math.abs(t - 0.5) * 2) * 120)))
    const b = Math.max(0, Math.min(255, Math.round(220 - t * 200)))

    packed[i * 2 + 0] = (qy << 16) | qx
    packed[i * 2 + 1] = qz
    packed[attrBase + i] = ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0
  }

  return {
    packed,
    pointCount: seeds.length,
    min: [minX, minY, minZ],
    range: [rangeX, rangeY, rangeZ],
  }
}