# @lazstream/core

[![npm](https://img.shields.io/npm/v/@lazstream/core)](https://www.npmjs.com/package/@lazstream/core)
[![license](https://img.shields.io/npm/l/@lazstream/core)](../../LICENSE)

Browser-native LAZ point cloud streaming engine. Load any LAZ 1.2–1.4 file directly from S3, R2, or Azure Blob — no preprocessing, no tile server, no conversion required.

## Why lazstream?

**No preprocessing.** Most point cloud tools require converting your LAZ files to COPC, Potree tiles, or EPT before you can stream them. lazstream reads the original file. Upload it once, stream it anywhere.

**No server.** All network access is standard HTTP/2 range requests. Point your viewer at a public or pre-signed URL — no backend, no WebSocket, no proxy.

**Renderer-agnostic.** `@lazstream/core` has no Three.js or WebGPU dependency. It handles streaming, decoding, caching, and prioritisation. You bring your own renderer and wire three provider callbacks to connect them.

---

## Installation

```bash
pnpm add @lazstream/core
# or: npm install @lazstream/core
```

---

## Quick start — single LAZ file

```typescript
import { urlToManifest, ManifestSession } from '@lazstream/core'

const manifest = await urlToManifest('https://your-bucket.s3.amazonaws.com/scan.laz')

const session = new ManifestSession(manifest, {
  events: {
    onSeedsReady(seeds, header) {
      // seeds: one representative point per chunk — render immediately for instant overview
      console.log(`${seeds.length} chunks, ${header.pointCount.toLocaleString()} points`)
    },
    onChunkDecoded(chunk) {
      // chunk.points: Int16Array of quantised XYZ + RGBA per point
      // chunk.header: per-chunk bounding box and quantisation scale
      myRenderer.addChunk(chunk)
    },
    onStateChange(state, message) {
      console.log(state, message)
    },
    onError(err) {
      console.error(err)
    },
  },
})

// Wire your renderer's camera and frustum each frame
session.setCameraProvider(() => myRenderer.getCameraState())
session.setFrustumProvider(() => myRenderer.getFrustumBBox())
session.setRingBufferProvider(() => myRenderer.getRingBufferStatus())

await session.load('https://your-bucket.s3.amazonaws.com/scan.laz')
```

## Quick start — multi-tile manifest

```typescript
import { fetchManifest, ManifestSession } from '@lazstream/core'

const manifest = await fetchManifest('https://your-bucket.s3.amazonaws.com/city.lazm.json')

const session = new ManifestSession(manifest, { events: { ... } })
// Same provider wiring and session.load() as above
```

---

## Providers

Three provider callbacks connect the engine to your renderer. Call each before `session.load()`.

### `setCameraProvider`

```typescript
session.setCameraProvider(() => ({
  worldX: number,  // camera world position
  worldY: number,
  worldZ: number,
  fovY:   number,  // vertical field of view in radians
  canvasHeight: number,  // canvas height in CSS pixels
}))
```

Used to compute per-chunk screen-space error (SSE) — how large each chunk projects on screen — which determines decode priority.

### `setFrustumProvider`

```typescript
session.setFrustumProvider(() => ({
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
}))
```

World-space axis-aligned bounding box of the camera frustum. Only chunks overlapping this box are considered for decode. Use `getFrustumWorldBBox3D()` from `@lazstream/viewer`, or compute it from your camera's inverse view-projection matrix.

### `setRingBufferProvider`

```typescript
session.setRingBufferProvider(() => ({
  slotsFree:  number,  // free GPU slots right now
  slotsTotal: number,  // total GPU slots
}))
```

Back-pressure signal: the engine won't dispatch more chunks than there is GPU room to receive. If you don't have a GPU ring buffer, return `{ slotsFree: 64, slotsTotal: 64 }` as a fixed stub.

### `onChunkEvictedFromGPU`

Call this when your renderer evicts a chunk from GPU memory so the engine can re-fetch it when the camera returns:

```typescript
renderer.onEvict(chunkIndex => session.onChunkEvictedFromGPU(chunkIndex))
```

---

## Configuration

All options are passed to `ManifestSession` as the second argument.

| Option | Default | Description |
|--------|---------|-------------|
| `sseThreshold` | `10.0` | Minimum screen-space error (px) before a chunk decodes. Lower = decodes from farther away; higher = zoom-to-reveal. |
| `workerCount` | `hardwareConcurrency - 1` | Decode worker threads. Each runs a laz-perf WASM instance. Capped at 100. |
| `maxFetches` | `workerCount × 4` | Max concurrent HTTP range requests. |
| `cache` | `null` | Pass a `ChunkCache` instance to enable IndexedDB caching of compressed chunk bytes across sessions. |
| `assetUrls` | auto | Override laz-perf WASM and worker URLs for CDN or custom hosting. |

### `sseThreshold` — when chunks decode

The engine only decodes chunks that project to at least `sseThreshold` pixels of canvas height. At the default of `10.0`, a chunk must be clearly visible before decoding starts. Lower values decode from farther away; higher values enforce a zoom-to-reveal behaviour.

```typescript
// Eager — decode almost everything visible
new ManifestSession(manifest, { events, sseThreshold: 1.0 })

// Zoom-to-reveal — only decode when close
new ManifestSession(manifest, { events, sseThreshold: 50.0 })
```

### `workerCount` — decode threads

Each worker runs laz-perf (WASM) in a dedicated `Worker` thread. The default uses all but one CPU core. For pages that share CPU with other heavy JavaScript, reduce this:

```typescript
new ManifestSession(manifest, { events, workerCount: 4 })
```

For multi-tile manifests the budget is split evenly: `workerCount: 8` with 4 tiles → 2 workers per tile.

### `ringBufferCapacity` — max simultaneous points

Passed through to the renderer (not a session option itself). Controls how many decoded chunks the GPU can hold at once:

| Buffer size | Approx chunks | Approx max simultaneous points |
|-------------|--------------|-------------------------------|
| 256 MB | ~366 | ~18 M |
| 512 MB | ~731 | ~37 M |
| 1 GB | ~1 462 | ~73 M |
| 2 GB | ~2 924 | ~146 M |

---

## Events

| Event | Signature | When |
|-------|-----------|------|
| `onSeedsReady` | `(seeds: SeedPoint[], header: LasHeader) => void` | After seed fetch; render these immediately for instant overview |
| `onChunkDecoded` | `(chunk: DecodedChunk) => void` | Each decoded chunk — add to your GPU buffer |
| `onStateChange` | `(state: string, message?: string) => void` | Pipeline state transitions |
| `onProgress` | `(loaded: number, total: number, phase: string) => void` | Loading progress |
| `onWarning` | `(msg: string) => void` | Non-fatal warnings |
| `onError` | `(err: Error) => void` | Fatal errors |
| `onStats` | `(stats: EngineStats) => void` | Per-tick performance metrics |

---

## Data utilities

```typescript
import { dequantizeChunk, elevationToRgb } from '@lazstream/core'

// Convert Int16 quantised XYZ back to float32 world coordinates
const float32 = dequantizeChunk(chunk)

// Map a Z value to an RGB elevation colour (green→yellow→red)
const [r, g, b] = elevationToRgb(z, minZ, maxZ)
```

---

## IDB chunk cache

Compressed chunk bytes are cached in IndexedDB to make repeat visits instant:

```typescript
import { ChunkCache } from '@lazstream/core'

const cache = new ChunkCache({ maxBytes: 512 * 1024 * 1024 })  // 512 MB budget

const session = new ManifestSession(manifest, { events, cache })
```

The cache is shared across `ManifestSession` instances in the same origin — loading the same file in two tabs benefits from each other's cached chunks.

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
// webpack.config.js
module.exports = {
  experiments: { asyncWebAssembly: true },
  module: {
    rules: [
      { test: /\.wasm$/, type: 'asset/resource' },
    ],
  },
}
```

### Rollup / esbuild

Mark `laz-perf` as external so it isn't bundled — its WASM must be served as a static file. Copy `node_modules/@lazstream/core/dist/laz-perf-worker.js` and `laz-perf-worker.wasm` to your public directory, then point lazstream at them via `assetUrls`:

```typescript
// rollup.config.js
export default {
  external: ['laz-perf'],
}
```

```typescript
// In your app
import { ManifestSession } from '@lazstream/core'

const session = new ManifestSession(manifest, {
  events,
  assetUrls: {
    lazPerfJsUrl:   '/assets/laz-perf-worker.js',
    lazPerfWasmUrl: '/assets/laz-perf-worker.wasm',
    workerUrl:      '/assets/decode-worker.js',
  },
})
```

### Next.js (App Router)

lazstream uses browser APIs (`Worker`, `indexedDB`, `GPUDevice`). Wrap in a Client Component:

```typescript
'use client'
import { useEffect } from 'react'
import { urlToManifest, ManifestSession } from '@lazstream/core'

export function PointCloud({ url }: { url: string }) {
  useEffect(() => {
    let session: ManifestSession | null = null
    urlToManifest(url).then(manifest => {
      session = new ManifestSession(manifest, { events: { ... } })
      session.load(url)
    })
    return () => { session?.dispose() }
  }, [url])
  // ...
}
```

---

## API reference

### Entry points

| Export | Description |
|--------|-------------|
| `urlToManifest(url)` | Fetch a single `.laz` file and return a `Manifest`. Use this for the common single-file case. |
| `fetchManifest(url)` | Fetch a `.lazm.json` multi-tile manifest and return a `Manifest`. |
| `parseManifest(json)` | Parse a manifest from a raw JSON object (if you fetched it yourself). |
| `ManifestSession` | Main session class. Accepts a `Manifest` and drives the full streaming pipeline. |
| `StreamingEngine` | Lower-level single-tile engine. Use `ManifestSession` unless you need direct per-tile control. |

### `DecodedChunk`

What arrives in `onChunkDecoded`. All coordinates are in world space.

```typescript
interface DecodedChunk {
  chunkIndex: number      // zero-based chunk index within the file
  positions:  Int16Array  // quantised XYZ — 3 values per point; use dequantizeChunk() for floats
  colors:     Uint8Array  // RGBA — 4 bytes per point (R, G, B, A)
  pointCount: number
  minX: number; minY: number; minZ: number  // tight world-space bounding box
  maxX: number; maxY: number; maxZ: number
  decodeMs:   number      // decode wall-clock time in milliseconds
}
```

Use `dequantizeChunk(chunk)` to convert `positions` to a `Float32Array` of world-space XYZ values.

### `SeedPoint`

What arrives in `onSeedsReady`. One per chunk — representative world-space sample.

```typescript
interface SeedPoint {
  x: number; y: number; z: number  // world coordinates
  classification: number            // LAS classification byte
  intensity:      number            // uint16
  chunkIndex:     number
}
```

### `LasHeader`

Passed alongside seeds in `onSeedsReady`. Contains the file-level bounding box and coordinate scaling needed to position your scene.

```typescript
interface LasHeader {
  pointCount:              number
  pointDataRecordFormat:   PointDataRecordFormat  // 0–10
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
  scaleX: number; scaleY: number; scaleZ: number    // int-to-world scale
  offsetX: number; offsetY: number; offsetZ: number  // int-to-world offset
  versionMajor: number; versionMinor: number
}
```

### `CameraInfo`

The shape your `setCameraProvider` callback must return.

```typescript
interface CameraInfo {
  worldX: number; worldY: number; worldZ: number  // camera world position
  fovY:         number  // vertical FOV in radians
  canvasHeight: number  // canvas height in pixels
}
```

### `BBox3D`

The shape your `setFrustumProvider` callback must return — axis-aligned bounding box of the camera frustum in world space.

```typescript
interface BBox3D {
  minX: number; minY: number; minZ: number
  maxX: number; maxY: number; maxZ: number
}
```

### `LazstreamAssetUrls`

Override the default `import.meta.url`-relative asset resolution. Required for Rollup/esbuild or any non-standard hosting.

```typescript
interface LazstreamAssetUrls {
  workerUrl?:     URL | string  // decode-worker.js
  lazPerfJsUrl?:  URL | string  // laz-perf-worker.js
  lazPerfWasmUrl: URL | string  // laz-perf-worker.wasm
}
```

### View state sharing

Encode and decode a camera position + source URL as a compact base64url token — suitable for `#v=<token>` URL fragments.

```typescript
encodeViewState(state: ViewState): string
decodeViewState(token: string): ViewState   // throws ViewStateDecodeError on invalid input

interface ViewState {
  source: string       // .laz or .lazm.json URL
  cam: CameraState
  colorMode?: string   // active colour mode — omitted in old tokens; consumers default to file-derived mode
}

interface CameraState {
  x: number; y: number; z: number    // camera world position
  tx: number; ty: number; tz: number // look-at target
  fovY: number                       // vertical FOV in radians
}
```

### `ChunkCache`

```typescript
new ChunkCache({ maxBytes?: number })  // default 512 MB

cache.metrics(): CacheMetrics  // { entryCount, totalBytes, hitCount, missCount }
makeCacheKey(url, chunkIndex)  // build a cache key manually if needed
```

---

## Error types

| Type | Cause |
|------|-------|
| `NetworkError` | Fetch failed or non-2xx response |
| `SecurityError` | URL scheme not allowed (only `https:` or localhost `http:`) |
| `ParseError` | LAS/LAZ header could not be read |
| `ChunkTableError` | Chunk table VLR missing or corrupt |
| `ManifestParseError` | `.lazm.json` format invalid |

---

## Browser support

| Browser | Support |
|---------|---------|
| Chrome 113+ | Full |
| Edge 113+ | Full |
| Safari 18+ (macOS/iOS) | Full |
| Firefox | Requires `dom.workers.modules.enabled` flag |

---

## Credits

- **[laz-perf](https://github.com/connormanning/laz-perf)** — Connor Manning / hobu Inc. The WASM LAZ decoder that runs inside each decode worker.
- **[rbush](https://github.com/mourner/rbush) / [rbush-3d](https://github.com/nicktindall/rbush-3d)** — Vladimir Agafonkin's R-tree, adapted to 3D. Powers the spatial index and frustum culling in `@lazstream/core`.
- **Chunk-seed overview** — Erler, Schütz, Wimmer. *LidarScout: Direct Out-of-Core Rendering of Massive Point Clouds.* HPG 2025. [doi:10.2312/hpg.20251170](https://doi.org/10.2312/hpg.20251170)

---

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
