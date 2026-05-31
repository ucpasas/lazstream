/**
 * Elevation colour ramp — cool (blue) at low Z, warm (red) at high Z.
 * Shared between the decode worker (for non-RGB PDRFs) and the renderer
 * (for seed point fallback coloring).
 *
 * t: normalised elevation in [0, 1]
 * Returns [R, G, B] each in [0, 255].
 */
export function elevationToRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0,   51,  204],
    [0,   204, 153],
    [51,  230, 26 ],
    [255, 204, 0  ],
    [255, 26,  0  ],
  ]
  const clamped = Math.min(Math.max(t, 0), 0.9999)
  const idx = clamped * (stops.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, stops.length - 1)
  const f = idx - lo
  return [
    Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f),
    Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f),
    Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f),
  ]
}
