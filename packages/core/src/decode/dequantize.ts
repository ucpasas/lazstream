/**
 * Dequantize a decoded chunk's per-chunk-local Int16 positions back to world Float32.
 *
 * Encoding (in decode-worker):
 *   q = round(((world - min) / range) * 65535 - 32768)
 *
 * Inverse:
 *   world = (q + 32768) / 65535 * range + min
 *
 * Returns a Float32Array of length pointCount * 3 (interleaved X Y Z).
 */

import type { DecodedChunk } from './worker-pool.js'

export function dequantizeChunk(chunk: DecodedChunk): Float32Array {
  const { positions, pointCount, minX, minY, minZ, maxX, maxY, maxZ } = chunk
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const rangeZ = maxZ - minZ || 1

  const out = new Float32Array(pointCount * 3)
  for (let i = 0; i < pointCount; i++) {
    out[i * 3]     = (positions[i * 3]     + 32768) / 65535 * rangeX + minX
    out[i * 3 + 1] = (positions[i * 3 + 1] + 32768) / 65535 * rangeY + minY
    out[i * 3 + 2] = (positions[i * 3 + 2] + 32768) / 65535 * rangeZ + minZ
  }
  return out
}
