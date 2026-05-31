# lazstream

Browser-native LAZ point cloud streaming. Load any LAZ 1.2–1.4 file directly from S3, R2, or Azure Blob — no preprocessing, no tile server, no conversion required.

[Live demo](https://lazstream.stream) · [npm: @lazstream/core](https://www.npmjs.com/package/@lazstream/core) · [npm: @lazstream/viewer](https://www.npmjs.com/package/@lazstream/viewer)

---

## What it does

lazstream streams compressed LAZ point clouds from cloud storage and renders them in the browser using WebGPU compute shaders. It handles files of any size — a 2.93 GB aerial survey with 353 million points renders at 60 fps by keeping only what the camera can see in GPU memory at any given moment.

The pipeline:

```
HTTP range request  →  laz-perf WASM decoder  →  GPU ring buffer  →  WebGPU atomicMin render  →  EDL resolve
```

**Instant overview.** One seed point per chunk is fetched upfront — a representative sample of the entire file. This appears in under a second. Full-resolution chunks stream in as you navigate.

**Scales to any file size.** The ring buffer is fixed (default ~2 GB). Chunks stream in and out as the camera moves; only what is currently visible occupies GPU memory.

---

## Packages

| Package | Description |
|---------|-------------|
| [`@lazstream/core`](packages/core) | Renderer-agnostic streaming engine. Handles URL validation, chunk table decoding, seed fetching, worker pool, spatial index, SSE prioritisation, and IDB caching. No Three.js dependency. |
| [`@lazstream/viewer`](packages/viewer) | One-liner WebGPU viewer. Wraps `@lazstream/core` with a WebGPU compute renderer, OrbitControls, Eye-Dome Lighting, and auto camera fit. |

---

## Quick start

```bash
pnpm add @lazstream/viewer three
```

```typescript
import { LazstreamViewer } from '@lazstream/viewer'

const viewer = await LazstreamViewer.create(canvas)
await viewer.load('https://your-bucket.s3.amazonaws.com/scan.laz')
```

See the [viewer README](packages/viewer/README.md) for the full options reference, and the [core README](packages/core/README.md) for bringing your own renderer.

---

## Design

### No preprocessing required

Most point cloud tools require converting LAZ files to a specialised format (COPC, Potree, EPT) before streaming. lazstream reads the original LAZ file directly. The chunk table — a compressed index built into every LAZ file — tells lazstream where each chunk of 50 000 points lives, without downloading the rest of the file.

### No server required

Every network call is a standard HTTP/2 range request. There is no backend, no WebSocket, and no custom protocol. Point lazstream at any public or pre-signed URL on S3, R2, or Azure Blob.

### Aggressive culling — how large files stay fast

lazstream applies four culling stages in sequence. Each stage eliminates chunks before they consume bandwidth or GPU memory:

1. **SSE threshold** — before fetching anything, each chunk's projected screen height is estimated. Chunks that appear smaller than `sseThreshold` pixels (default 10) are excluded entirely. A chunk at the horizon stays as a seed point; it only decodes when you zoom in.

2. **Frustum filter** — only chunks overlapping the camera's bounding box are even considered. A 7 000-chunk file seen from one end has fewer than 500 chunks in the frustum at any zoom level.

3. **Exact 6-plane cull** — the renderer culls each ring buffer slot against the precise camera frustum before dispatching the GPU compute pass. Only visible slots are rendered and marked as recently-used.

4. **LRU eviction** — slots not rendered for 5 consecutive frames (~83 ms) are evicted from the GPU ring buffer, immediately freeing space for newly visible chunks. The streaming engine re-fetches evicted chunks if the camera returns to them.

The result: a 353 M-point file on a 2 GB ring buffer (~2 900 slots) renders at 60 fps by keeping only the highest-priority visible chunks in GPU memory at any time.

`sseThreshold` and `ringBufferCapacity` are the two primary controls. See the [configuration reference](packages/core/README.md#configuration) for details.

### WebGPU compute for point scale

Point clouds have no triangles. Traditional vertex pipelines require one draw call per point (too slow) or complex instancing (limited). lazstream uses a WebGPU compute shader with `atomicMin` per screen pixel (the Schütz technique): all visible points across all loaded chunks compete for depth in parallel. This scales linearly with GPU throughput — 150M simultaneous points at 60 fps on discrete hardware.

### Eye-Dome Lighting — depth without normals

Point clouds have no surface normals. lazstream uses Eye-Dome Lighting (Boucheny, 2009): a fullscreen pass that reads the depth buffer, samples 4 cardinal neighbours per pixel, and attenuates brightness by the log-depth difference. This gives visible shading at zero preprocessing cost. The shading is scale-invariant — the same settings work on a room-scale scan and a continent-scale survey.

### Renderer-agnostic core

`@lazstream/core` has no Three.js or WebGPU dependency. The streaming engine connects to any renderer through three provider callbacks — camera state, frustum bounding box, and ring buffer pressure. This makes the engine usable with Three.js, Babylon.js, deck.gl, or a custom WebGPU pipeline, without pulling in any rendering library.

---

## Browser support

| Browser | Status |
|---------|--------|
| Chrome 113+ | Full support |
| Edge 113+ | Full support |
| Safari 18+ (macOS/iOS) | Full support |
| Firefox | Requires `dom.workers.modules.enabled` flag |

WebGPU is required for `@lazstream/viewer`. `@lazstream/core` works in any browser that supports `Worker` modules.

---

## Repository structure

```
lazstream/
├── packages/
│   ├── core/      @lazstream/core — streaming engine
│   └── viewer/    @lazstream/viewer — WebGPU renderer
├── LICENSE        Apache-2.0
└── README.md
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE).
