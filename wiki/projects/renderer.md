---
title: Renderer
type: project
status: active
updated: 2026-05-13
tags: [three.js, webgpu, webgl, compute-shader, point-cloud, ring-buffer, seed-points, dequantization, webgpu-renderer, point-packing, dynamic-offset]
---

# Renderer

Final stage: `[[Manifest Loader]] → [[Streaming Engine]] → [[Decoder Workers]] → Renderer`.

Receives point data, uploads it to the GPU, and renders the point cloud. Phase 1 uses a WebGL seed renderer. Phase 2 will replace it with the full WebGPU pipeline.

---

## Phase 1: WebGL seed renderer (`src/render/renderer.ts`)

Phase 1 deliberately uses `THREE.WebGLRenderer` + `THREE.Points` — not WebGPU. The goal of Phase 1 was to validate the data pipeline (header → chunk table → seed points), not the render pipeline.

### What it does

1. Receives a `SeedPoint[]` from `StreamingEngine.onSeedsReady`.
2. Applies LAS scale + offset to convert raw int32 XYZ to world-space Float32.
3. Maps elevation to a colour gradient (cool → warm).
4. Uploads as `THREE.BufferGeometry` → `THREE.Points` with `VertexColors`.
5. Auto-centres the camera on the point cloud bounding box.

### Performance (Phase 1)

| Metric | Value |
|--------|-------|
| Seed points | ~300 valid seeds (from 380 chunks) |
| Load time | < 5 ms after seeds arrive |
| FPS | 144 fps |
| GPU memory | < 10 MB |

### Why WebGL in Phase 1?

The Phase 1 renderer is intentionally minimal — it proves the upstream pipeline produces correct geographic data. The WebGPU renderer in Phase 2 will keep everything upstream (URL → header → chunk table → seeds) unchanged.

---

## Phase 2 Track A: WebGL validation renderer (implemented)

### Purpose

Rather than building the WebGPU compute shader renderer blind, Phase 2 Track A was validated using the existing Phase 1 WebGL renderer with one new method: `addDecodedChunk(chunk)`. This confirmed the full decode pipeline (fetch → WASM → quantize → transfer) is correct before touching the GPU pipeline.

### `addDecodedChunk(chunk: DecodedChunk)`

Dequantizes `Int16Array` positions back to world coordinates, converts `Uint8Array` RGBA colours to `Float32Array` RGB, then adds the chunk as a new `THREE.Points` object to the scene.

```typescript
// Dequantize Int16 → world coordinate
const wx = ((chunk.positions[i * 3] + 32768) / 65535) * rangeX + chunk.minX
// Subtract scene centre for GPU-safe Float32
positions[i * 3] = wx - this.cx
```

See [[Decoder Workers]] for the forward quantization transform.

### Seed point hiding

Once 10 or more decoded chunks have arrived, the seed point `THREE.Points` object is hidden (`visible = false`). The 4 px seed splats look coarse next to the 1.5 px decoded points.

### `getCameraWorldPosition()`

Returns the camera position in world coordinates (scene-relative position + scene centre). Used by `StreamingEngine.updateCamera()` to drive chunk prioritisation.

### Phase 2 Track A performance

| Metric | Value |
|--------|-------|
| Chunks decoded | 380 |
| Points rendered | 18,991,962 |
| FPS | 76 |
| Elevation colourmap | correct |
| Spatial layout | correct |

---

## Phase 2 Track B: WebGPU compute shader renderer (complete)

**Status:** Running. Confirmed on Chrome 120+ (WebGPU). 19M point Texas tile at ~76 fps.

### Files

| File | Purpose |
|------|---------|
| `src/render/webgpu-renderer.ts` | Main class — pipeline, frame loop, slot management |
| `src/render/webgpu-context.ts` | Device + canvas acquisition, ring buffer capacity negotiation |
| `src/render/ring-buffer.ts` | CPU-side slot allocator (pure TS, no WebGPU types) |
| `src/render/point-packing.ts` | DecodedChunk → packed Uint32Array (12 bytes/point) |
| `src/render/shaders/points-depth.wgsl` | Compute: project + atomicMin depth per point |
| `src/render/shaders/clear-depth.wgsl` | Compute: reset depth buffer to 0xFFFFFFFF each frame |
| `src/render/shaders/resolve-edl.wgsl` | Render: fullscreen triangle, resolve depth+color, EDL |

### Architecture decisions (vs. pre-implementation plan)

| Decision | Planned | Actual |
|----------|---------|--------|
| Three.js integration | WebGPURenderer + TSL | Three.js for camera/controls only; raw WebGPU for all passes |
| Depth buffer type | `texture_storage_2d<r32uint>` + `textureAtomicMin` | `array<atomic<u32>>` storage buffer — better cross-vendor support |
| Dispatch model | One dispatch for all points | One compute dispatch per chunk slot, dynamic uniform offset |
| Color/depth write race | N/A | Benign race accepted — color written non-atomically when atomicMin wins |

### Frame loop (per frame)

1. `controls.update()` + `writeCameraUniform()` — viewProj matrix + sceneCenter + viewport to GPU
2. **Clear depth compute pass** — `ceil(pixelCount / 256)` workgroups, resets depth to `0xFFFFFFFF`
3. **Points depth compute pass** — for each slot: `setBindGroup` with dynamic offset → `dispatchWorkgroups(ceil(pointCount / 128))` → `touch(slot, frame)`
4. **Resolve render pass** — fullscreen triangle (3 vertices, no mesh), fragment shader reads depth+color buffers, applies 4-neighbour log-depth EDL, outputs to canvas
5. `queue.submit([encoder.finish()])`

### GPU memory layout

- Ring buffer: single `GPUBuffer`, `STORAGE | COPY_DST`, 256 MB (128 MB fallback for integrated GPUs)
- Depth buffer: `array<atomic<u32>>`, one u32 per pixel, viewport-sized, recreated on resize
- Color buffer: `array<u32>`, one u32 per pixel (RGBA8 packed), viewport-sized, recreated on resize
- Point format: 12 bytes/point — `u32(y<<16|x)` | `u32(z)` | `u32(rgba)`
- Chunk uniform: 32 bytes — `vec3<f32> minXYZ` | `u32 pointCount` | `vec3<f32> rangeXYZ` | `u32 pointStrideOffset` — bound with dynamic offset (stride = device alignment, typically 256 bytes)

### Public interface (unchanged from Track A)

```typescript
static async create(canvas, options?): Promise<WebGPURenderer>  // async factory
loadSeedPoints(seeds: SeedPoint[]): void
addDecodedChunk(chunk: DecodedChunk): void
getCameraWorldPosition(): { x, y, z }
getSceneCenter(): { x, y, z }
dispose(): void
```

`WebGPUUnsupportedError` is re-exported from `webgpu-renderer.ts` so callers need only one import.

### main.ts changes

- `WebGPURenderer.create()` is async — entire setup wrapped in `async function main()`
- `WebGPUUnsupportedError` caught at startup — shows user-facing error, disables load button, returns early. No WebGL fallback (deferred to Phase 5).
- All engine callbacks unchanged — same `onSeedsReady` / `onChunkDecoded` wiring

### Seed point handling

Seeds are packed via `packSeedsAsChunk()` and added as a pseudo-chunk (`chunkIndex = -1`). Auto-evicted once 10 real chunks have landed (`SEED_HIDE_THRESHOLD = 10`).

### Performance (Texas tile, HTTP/1.1 R2)

| Metric | Value |
|--------|-------|
| Points rendered | 18,991,962 |
| Chunks | 380 |
| FPS | ~76 |
| WebGPU confirmed | `canvas.getContext('webgpu')` → `GPUCanvasContext` |

### Known limitations entering Phase 3

- Melbourne 2018 (353M pts, 7000+ chunks): page unresponsive — `decodeAll()` / `updateCamera()` queues too many chunks before the main thread gets a tick. Requires Phase 3 frame-amortised decode budget + back-pressure.
- R2 r2.dev is HTTP/1.1 only — seed TTFF dominated by round trips. HTTP/2 requires a custom Cloudflare domain.
- No frustum culling at chunk level — all loaded chunks dispatched every frame regardless of visibility (Phase 3: rbush integration)
- No WebGL fallback (Phase 5)
- Device lost: logs only, no recovery (Phase 5)
- Splat size fixed at 1×1 pixel (Phase 5)

---

## Constraints

- Phase 1: NEVER block the main thread during geometry construction.
- Phase 2: NEVER block the main thread during buffer upload — use `GPUQueue.writeBuffer`.
- Ring buffer eviction must be frame-coherent: do not evict a chunk visible this frame.

---

## Open questions

- [ ] WebGL fallback factory `createRenderer(canvas)` — Phase 5
- [ ] Device lost / context restored recovery — Phase 5
- [ ] Point splat size attenuation — Phase 5
- [ ] Frustum culling: connect to [[Spatial Index]] for whole-chunk rejection — Phase 3

---

## See also

- [[Decoder Workers]] — Phase 2 source of point buffers
- [[WebGPU Compute]] — atomicMin depth shader design
- [[Ring Buffer GPU Memory]] — GPU memory management
- [[Spatial Index]] — frustum culling input
- [[LidarScout Chunk-Seed]] — Phase 1 fast overview; Phase 2 seed layer replaced per chunk
