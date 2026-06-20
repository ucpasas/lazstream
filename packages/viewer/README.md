# @lazstream/viewer

[![npm](https://img.shields.io/npm/v/@lazstream/viewer)](https://www.npmjs.com/package/@lazstream/viewer)
[![license](https://img.shields.io/npm/l/@lazstream/viewer)](../../LICENSE)

One-liner WebGPU point cloud viewer for LAZ files. Drop a canvas into your page, call two methods, get a fully interactive point cloud.

```typescript
const viewer = await LazstreamViewer.create(canvas)
await viewer.load('https://your-bucket.s3.amazonaws.com/scan.laz')
```

## Why lazstream?

**No preprocessing.** Stream any LAZ 1.2–1.4 file directly from S3, R2, or Azure Blob. No conversion to COPC or Potree tiles required.

**Handles massive files.** WebGPU compute shaders render 150M+ simultaneous points at 60 fps on desktop hardware. The ring buffer streams chunks in and out as you navigate — you're never loading the whole file into memory.

**Instant overview.** A seed-point overview (one point per chunk) appears in under a second. Full-resolution chunks stream in as you zoom.

**Depth shading out of the box.** Eye-Dome Lighting gives point clouds visible structure without normals or preprocessing.

---

## Installation

```bash
pnpm add @lazstream/viewer three
# or: npm install @lazstream/viewer three
```

`three` is a peer dependency — it must be installed separately.

---

## Quick start

```typescript
import { LazstreamViewer } from '@lazstream/viewer'

const canvas = document.getElementById('viewer') as HTMLCanvasElement
const viewer = await LazstreamViewer.create(canvas)
await viewer.load('https://your-bucket.s3.amazonaws.com/scan.laz')
```

That's it. The viewer auto-fits the camera to the file's bounding box, streams seed points for an instant overview, then progressively decodes chunks as you navigate.

---

## ViewerOptions

Pass options to `LazstreamViewer.create(canvas, options)`.

| Option | Default | Description |
|--------|---------|-------------|
| `sseThreshold` | `10.0` | Minimum screen-space error (px) before a chunk decodes. Lower = decodes from farther away; higher = zoom-to-reveal. |
| `workerCount` | `hardwareConcurrency - 1` | Decode worker threads. Reduce for pages sharing CPU with other heavy JS. |
| `maxFetches` | `workerCount × 4` | Max concurrent HTTP range requests. |
| `ringBufferCapacity` | adapter-negotiated (~2 GB) | GPU memory for decoded points. More = more simultaneous chunks visible. |
| `splatRadius` | `2` | Point size: `1`=1 px, `2`=3×3 px, `3`=5×5 px. |
| `assetUrls` | auto | Override laz-perf WASM/worker URLs for CDN or custom hosting. |
| `colorMode` | file-derived | Initial colour mode: `'rgb'` \| `'height'` \| `'intensity'` \| `'classification'`. Defaults to `'rgb'` if the file has native colour, else `'height'`. |
| `onStateChange` | — | `(state: string, message?: string) => void` |
| `onProgress` | — | `(loaded: number, total: number, phase: string) => void` |
| `onWarning` | — | `(msg: string) => void` |
| `onError` | — | `(err: Error) => void` |
| `onStats` | — | `(stats: EngineStats) => void` |

### `sseThreshold` — when chunks decode

Controls the zoom level at which full-resolution chunks replace the seed overview. Lower values load more aggressively; higher values enforce a zoom-to-reveal interaction where detail only appears when you're close.

```typescript
// Decode nearly everything visible at any distance
await LazstreamViewer.create(canvas, { sseThreshold: 1.0 })

// Only decode when zoomed in close
await LazstreamViewer.create(canvas, { sseThreshold: 50.0 })
```

### `ringBufferCapacity` — how many points fit at once

The GPU ring buffer holds decoded chunks. Larger = more simultaneous points visible without re-fetching. The default negotiates the maximum the GPU adapter will grant (up to 2 GB).

```typescript
// Explicit 512 MB budget (integrated GPU or memory-constrained device)
await LazstreamViewer.create(canvas, {
  ringBufferCapacity: 512 * 1024 * 1024
})
```

| Capacity | Approx max simultaneous points |
|----------|-----------------------------|
| 256 MB | ~18 M |
| 512 MB | ~37 M |
| 1 GB | ~73 M |
| 2 GB (default) | ~146 M |

### `splatRadius` — point size

Each point is rendered as a square splat. Larger splats fill gaps in sparse clouds; smaller splats preserve fine edge detail.

```typescript
await LazstreamViewer.create(canvas, { splatRadius: 3 })  // 5×5 px
```

---

## Loading large files — aggressive culling

lazstream applies four culling stages that make files of any size tractable on consumer hardware. At each stage, chunks that don't need to be in GPU memory are excluded before they consume bandwidth or slots.

**1. SSE threshold** — before fetching, each chunk's projected height on screen is estimated. Chunks smaller than `sseThreshold` pixels stay as seed points. They only decode when you zoom in close enough.

**2. Frustum filter** — only chunks overlapping the camera's bounding box are considered for fetch. A large survey file viewed from one end has a small fraction of its chunks in the frustum at any zoom level.

**3. Exact frustum cull** — the renderer culls each GPU slot against the precise camera frustum before the compute pass. Only visible slots are rendered and kept alive in LRU.

**4. LRU eviction** — slots not rendered for ~83 ms are evicted from the ring buffer, immediately freeing space for newly visible chunks. Evicted chunks are re-fetched if the camera returns.

The two levers you control:

```typescript
await LazstreamViewer.create(canvas, {
  // Higher = chunks only decode when zoomed in close (less simultaneous bandwidth)
  sseThreshold: 25.0,

  // Larger = more chunks in GPU memory at once (more points visible)
  ringBufferCapacity: 1 * 1024 * 1024 * 1024,  // 1 GB
})
```

For very large files or slower connections, raising `sseThreshold` to `25`–`50` is the most effective single change — it dramatically reduces the number of chunks fetching at any moment without changing the visual quality at your current zoom level.

---

## Visual tuning (EDL)

lazstream uses **Eye-Dome Lighting** — a depth-based shading technique that gives point clouds visible structure without surface normals. It darkens points at depth discontinuities, producing shading that looks like ambient occlusion at zero preprocessing cost.

`edlStrength` and `edlRadius` are currently `WebGPURenderer` construction options, not forwarded through `ViewerOptions`. To tune them, construct the renderer directly:

```typescript
import { WebGPURenderer, LazstreamViewer } from '@lazstream/viewer'

// Use WebGPURenderer directly when you need EDL control
const renderer = await WebGPURenderer.create(canvas, {
  edlStrength: 400,   // default 600 — lower for subtler shading
  edlRadius:   2,     // default 1  — higher for softer edges on sparse clouds
  splatRadius: 2,
})
```

| Parameter | Default | Effect |
|-----------|---------|--------|
| `edlStrength` | `600` | Shading intensity. `0` disables EDL. `1000+` may posterise flat surfaces. |
| `edlRadius` | `1` | Depth-sampling radius in pixels. `1`–`2` is the practical range. |
| `splatRadius` | `2` | Point splat size (see above). |

---

## Colour modes

lazstream renders point clouds in four colour modes. Switching is instant — no re-decode, no re-stream, just a GPU uniform flip.

| Mode | Description |
|------|-------------|
| `'rgb'` | Native colour from the LAZ file. Only available for PDRFs with colour (2, 3, 5, 7, 8, 10). |
| `'height'` | Elevation ramp (green → yellow → red). Always available. Default when the file has no native colour. |
| `'intensity'` | Greyscale intensity, normalised to the p1–p99 range of the seed point scan. Always available. |
| `'classification'` | ASPRS classification palette (ground, vegetation, buildings, water, …). Always available. |

```typescript
import { LazstreamViewer } from '@lazstream/viewer'
import type { ColorMode } from '@lazstream/viewer'

const viewer = await LazstreamViewer.create(canvas)

// React to mode changes (fires with the RESOLVED mode — 'rgb' may resolve
// to 'height' if the file has no native colour)
viewer.onColorModeChanged = (resolved: ColorMode) => {
  console.log('active mode:', resolved)
}

await viewer.load(url)

// Switch mode at runtime — no reload
viewer.setColorMode('intensity')

// Returns the resolved (active) mode
console.log(viewer.colorMode)         // 'intensity'

// Modes available for the loaded file ('rgb' absent for non-colour PDRFs)
console.log(viewer.getAvailableColorModes())  // ['height', 'intensity', 'classification']
```

`setColorMode()` returns the resolved `ColorMode` and fires `onColorModeChanged` with the same value. If you request `'rgb'` on a file that has no native colour it silently resolves to `'height'`.

### URL / view-state contract

The **SDK** (`LazstreamViewer`) is URL-agnostic:

- `setColorMode()` has no URL side effect.
- `options.colorMode` is read once at `onSeedsReady` — the SDK never reads `window.location` or `history`.

If you want the active mode to survive a page share, write it into the URL yourself after `onColorModeChanged` fires:

```typescript
viewer.onColorModeChanged = (resolved) => {
  const token = encodeViewState({ source: url, cam: ..., colorMode: resolved })
  history.replaceState(null, '', '#v=' + token)
}
```

The built-in viewer app (`@lazstream/viewer` demo) already does this — the `#v=` hash includes `colorMode` and the `1`–`4` keyboard shortcuts switch modes without a page reload.

---

## Accessing the underlying session

```typescript
const viewer = await LazstreamViewer.create(canvas)
await viewer.load(url)

// Access the ManifestSession for advanced event wiring
const session = viewer.session
```

---

## Loading a multi-tile manifest

```typescript
// .lazm.json manifest covering multiple LAZ tiles
await viewer.load('https://your-bucket.s3.amazonaws.com/city.lazm.json')
```

The viewer detects manifests by file extension and routes to `ManifestSession` automatically.

---

## Error handling

```typescript
import { LazstreamViewer, WebGPUUnsupportedError } from '@lazstream/viewer'

try {
  const viewer = await LazstreamViewer.create(canvas, {
    onError: (err) => console.error('stream error:', err),
  })
  await viewer.load(url)
} catch (err) {
  if (err instanceof WebGPUUnsupportedError) {
    // WebGPU not available — show fallback
  }
}
```

---

## Bundler configuration

### Vite

```typescript
// vite.config.ts
export default defineConfig({
  optimizeDeps: { exclude: ['laz-perf'] },
  worker: { format: 'es' },
})
```

### webpack 5

```javascript
module.exports = {
  experiments: { asyncWebAssembly: true },
  module: {
    rules: [
      { test: /\.wasm$/, type: 'asset/resource' },
      { test: /\.wgsl$/, type: 'asset/source' },
    ],
  },
}
```

### Rollup / esbuild

Mark `laz-perf` as external and serve its assets statically. Copy `node_modules/@lazstream/core/dist/laz-perf-worker.js` and `laz-perf-worker.wasm` to your public directory, then pass `assetUrls` so lazstream can find them:

```typescript
// rollup.config.js
export default {
  external: ['laz-perf'],
}
```

```typescript
import { LazstreamViewer } from '@lazstream/viewer'

const viewer = await LazstreamViewer.create(canvas, {
  assetUrls: {
    lazPerfJsUrl:   '/assets/laz-perf-worker.js',
    lazPerfWasmUrl: '/assets/laz-perf-worker.wasm',
    workerUrl:      '/assets/decode-worker.js',
  },
})
```

### Next.js (App Router)

lazstream requires browser APIs. Wrap in a Client Component and clean up on unmount:

```typescript
'use client'
import { useEffect, useRef } from 'react'
import { LazstreamViewer } from '@lazstream/viewer'

export function PointCloudViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let viewer: LazstreamViewer | null = null
    LazstreamViewer.create(canvasRef.current!).then(v => {
      viewer = v
      return v.load(url)
    })
    return () => { viewer?.dispose() }
  }, [url])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
```

---

## Browser support

| Browser | Support |
|---------|---------|
| Chrome 113+ | Full |
| Edge 113+ | Full |
| Safari 18+ (macOS/iOS) | Full |
| Firefox | Requires `dom.workers.modules.enabled` flag |

WebGPU is required. If unavailable, `LazstreamViewer.create()` throws `WebGPUUnsupportedError`.

---

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
