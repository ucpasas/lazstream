/**
 * Hilbert curve index — chunk priority ordering spike (Candidate A).
 *
 * 2D (XY) only. Aerial LiDAR has shallow Z relative to XY extent, and the
 * spike spec treats Z variance as secondary to horizontal locality for
 * prioritisation. A 3D variant is an open question tracked in the wiki
 * spike page — do not add it here without a measurement that justifies it.
 */

/** Bits per axis. 16 → 32-bit curve index, plenty at chunk granularity
 *  (7073 chunks over a 2^16 grid ≈ 1 chunk per 600 cells). */
export const HILBERT_ORDER = 16

const HILBERT_SIDE = 1 << HILBERT_ORDER

/**
 * Map integer grid coordinates (x, y in [0, 2^order)) to their distance
 * along the Hilbert curve. Classic iterative xy→d with quadrant rotation.
 */
export function hilbertIndex2D(x: number, y: number, order: number = HILBERT_ORDER): number {
  let d = 0
  for (let s = 1 << (order - 1); s > 0; s >>>= 1) {
    const rx = (x & s) > 0 ? 1 : 0
    const ry = (y & s) > 0 ? 1 : 0
    d += s * s * ((3 * rx) ^ ry)

    // Rotate the quadrant so the sub-curve orientation is consistent.
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      const t = x
      x = y
      y = t
    }
  }
  return d
}

/**
 * Quantise a world coordinate into the Hilbert grid given the axis range.
 * Degenerate ranges (min === max) collapse to cell 0.
 */
export function quantizeToHilbertGrid(v: number, min: number, max: number): number {
  const range = max - min
  if (range <= 0) return 0
  const q = Math.floor(((v - min) / range) * (HILBERT_SIDE - 1))
  return Math.min(HILBERT_SIDE - 1, Math.max(0, q))
}
