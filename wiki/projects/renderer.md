---
title: Renderer
type: project
status: active
updated: 2026-05-16
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

### Frustum extraction (Phase 3 Track C)

`getFrustumWorldBBox3D()` projects the 8 NDC frustum corners through the cached `invViewProj` matrix to get world-space corner positions, then computes the AABB. Cached `Float32Array(8 * 3)` buffer reused each frame. `getFovY()` and `getCanvasHeight()` exposed for SSE calculations in [[Spatial Index]].

### Ring buffer fragmentation at Melbourne scale

At the 256 MB ring buffer's ~430-chunk capacity (50,000 points × 12 bytes = 600 KB per chunk), first-fit allocation begins refusing new chunks even when total free bytes are sufficient. Observed as `[webgpu] ring buffer can't fit chunk N (600000 B) — dropped` warnings cascading once the buffer hits ~430-chunk capacity with fragmented free space.

GPU-side compaction was deferred to "Track B v2" in [[Ring Buffer GPU Memory]]; confirmed as needed for files of Melbourne scale. Workaround: reduce point budget or wait for Track A back-pressure to limit how many chunks reach the buffer simultaneously.

### Known limitations entering Phase 3 Track A

- Ring buffer fragmentation caps Melbourne rendering at ~447 decoded chunks (~22.35M points). Requires Track A back-pressure + Track B v2 compaction.
- `data.lazstream.stream` now live with HTTP/2 — r2.dev no longer the bottleneck.
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
- [ ] Point splat size **attenuation** (distance-based auto-scaling) — Phase 5. Fixed configurable splat radius (`splatRadius`, default 2 = 3×3 px) is shipped via `?splatRadius=N`; true attenuation (zoom-dependent) is deferred.
- [x] Frustum culling connected to [[Spatial Index]] in Phase 3 Track C via provider pattern — **done**: `setFrustumProvider()` registered in `main.ts`; engine pulls frustum AABB each frame without importing Three.js.

---

## Header-driven initial framing (2026-05-19)

`loadSeedPoints` accepts an optional `LasHeader` parameter and uses its bbox as the authoritative source for camera framing, rather than deriving the bbox from the (sampled, possibly incomplete) seed point cloud.

### Signature

```typescript
loadSeedPoints(seeds: SeedPoint[], header?: LasHeader): void
```

When `header` is provided, the renderer uses `header.minX/maxX/minY/maxY/minZ/maxZ` for scene centre, camera distance, and frustum AABB conversion. When omitted, falls back to seed-derived `packed.min` / `packed.range`.

### Camera position constants

```typescript
const CAMERA_INITIAL_ELEVATION_DEG = 30   // above horizontal at load
const CAMERA_INITIAL_DISTANCE_MULT = 1.2  // bbox diagonal × this = camera distance
```

Elevation guide:
- 90° = straight-down map view
- 60° = top-down, sees ground footprints clearly
- 45° = 3/4 oblique aerial (balanced)
- 30° = more horizontal, sees building façades and vertical structure (current default)
- 0° = horizon view

Camera placement (looking south at scene-local origin):

```typescript
const elevationRad = (CAMERA_INITIAL_ELEVATION_DEG * Math.PI) / 180
const cosE = Math.cos(elevationRad)
const sinE = Math.sin(elevationRad)
this.camera.position.set(0, -dist * cosE, dist * sinE)
this.controls.target.set(0, 0, 0)
```

This is a proper unit vector × distance, landing the camera at exactly `dist` along the configured elevation line. The previous code used the literal vector `(0, -0.6, 0.7)`, which works out to 49.4° elevation with a non-unit vector length (0.922 × requested distance).

### Why header bbox over seed bbox

The seed pseudo-chunk covers ~7000 points sampled from the file's chunks (one per chunk). For most files this approximates the full bbox, but:
- Chunks at the file's spatial edge may extend further than their seed point suggests
- The LAS header bbox is computed by the writer over every point — ground truth
- All subsequent decode operations reference the world bbox from the header; using a different bbox for initial framing creates a slight discrepancy

The seed pseudo-chunk's own AABB stays at `packed.min` / `packed.range` (seed-derived), since that's what the slot table sees. Framing and culling are independent concerns.

---

## Persistent seed overview (2026-05-19)

`SEED_HIDE_THRESHOLD = Infinity`. The seed pseudo-chunk stays in the buffer permanently.

### Why

At small buffer sizes (374 slots for the original 256 MB), loaded chunks cover only a small fraction of the file's visible area. Without seeds: "patches of detail in a black void." With seeds: "patches of detail with an outline of where the rest of the file is." At large buffer sizes (3000+ slots) the value is smaller but the cost is also trivial.

### Cost

- One ring buffer slot occupied permanently (~700 KB)
- One compute dispatch per frame for ~7000 points (~10 µs)
- One additional cull test (negligible)

### Cull interaction

The seed slot's AABB spans the full file bbox. At any camera position looking at the file, the frustum intersects this AABB — seeds always pass the cull and are always touched each frame. This makes seeds permanently non-evictable by the LRU algorithm. See [[Back-Pressure Invariants]] for the deliberate design of this behaviour.

### Reverting

To hide seeds once N real chunks have landed, change `SEED_HIDE_THRESHOLD` to a finite number (e.g. `10`).

---

## WebGPUContext interface contract — bug retrospective (2026-05-19)

A reference `webgpu-context.ts` written without consulting the renderer's actual field accesses used wrong names:
- Wrote `format` → renderer reads `canvasFormat`
- Omitted `canvas` field → renderer reads `ctx.canvas` for OrbitControls + resize observer

Both presented as `undefined` at render-pipeline creation:

```
Uncaught TypeError: Failed to execute 'createRenderPipeline' on 'GPUDevice':
Failed to read the 'format' property from 'GPUColorTargetState': Required member is undefined.
```

Mitigation: grep `ctx.` in the renderer before writing the producer, or ship the interface definition first and confirm against the consumer before implementing.

The current `WebGPUContext` interface (correct):

```typescript
export interface WebGPUContext {
  device:  GPUDevice
  context: GPUCanvasContext
  canvas:  HTMLCanvasElement
  canvasFormat: GPUTextureFormat
  ringBufferCapacity: number
  limits: {
    adapterMaxStorageBufferBindingSize: number
    adapterMaxBufferSize:               number
    deviceMaxStorageBufferBindingSize:  number
    deviceMaxBufferSize:                number
  }
}
```

---

## Proactive eviction (2026-05-20)

Slots are evicted eagerly when invisible, not only on demand.

### Motivation

Before proactive eviction, invisible slots sat in the ring buffer indefinitely. The only time a slot was freed was when `allocate()` needed space and called `findLRUEvictable()`. A camera orbit that revealed new chunks while keeping old ones technically "loaded" would hit a full buffer with no evictable slots — all stale slots were still occupied.

### Implementation

`evictInvisibleSlots()` is called **every frame** after the cull+touch loop, before `flushDeferredChunks()`:

```typescript
private evictInvisibleSlots(): void {
  const threshold = this.currentFrame - EVICT_GRACE_FRAMES
  const toEvict: Array<{ chunkIndex: number; wasRendered: boolean }> = []
  for (const slot of this.slots.getSlots()) {
    if (slot.chunkIndex === SEED_PSEUDO_CHUNK_INDEX) continue
    if (slot.lastRenderedFrame < threshold) {
      toEvict.push({ chunkIndex: slot.chunkIndex, wasRendered: slot.everRendered })
    }
  }
  for (const { chunkIndex, wasRendered } of toEvict) {
    this.releaseSlot(chunkIndex)
    if (wasRendered) this.chunkEvictedCallback?.(chunkIndex)
  }
}
```

### EVICT_GRACE_FRAMES

```typescript
const EVICT_GRACE_FRAMES = 5  // ~83 ms at 60 fps
```

Grace period prevents churn during fast pans: a slot that briefly leaves the frustum during a pan but re-enters within 83 ms is not evicted.

### `everRendered` guard — phantom chunk fix

"Phantom chunks" pass the engine's conservative AABB frustum dispatch but fail the renderer's exact 6-plane cull — `touch()` is never called for them, so `everRendered` stays `false`. Without the guard, they would: evict after grace period → `chunkEvictedCallback` re-queues → re-decode → same failure → infinite oscillation (observed as slot count toggling 35↔36).

Fix: only call `chunkEvictedCallback` when `slot.everRendered === true`. Phantom chunks are released silently — no re-queue.

### Callback wiring

```
renderer.setChunkEvictedCallback(chunkIndex => engine.onChunkEvictedFromGPU(chunkIndex))

engine.onChunkEvictedFromGPU(chunkIndex):
  prioritiser.removeDecoded(chunkIndex)   // re-enables for ChunkPrioritiser
  workerPool.markEvicted(chunkIndex)      // clears workerPool.completed
```

All three removals are required — missing any one permanently orphans the chunk.

### Deferred queue overflow also notifies engine

A chunk dropped from `deferredChunks` (capacity overflow) stays in `prioritiser.decoded` and `workerPool.completed` — never in a GPU slot — so GPU eviction never reaches it. `flushDeferredChunks()` calls `chunkEvictedCallback` on any chunk it drops from the queue, same as GPU eviction.

---

## 2D mega-dispatch (2026-05-20)

Replaced the O(N) per-slot CPU encoder loop with a single 2D GPU dispatch.

### Before: O(N) encoder calls

```typescript
for (const slot of this.slots.getSlots()) {
  ... frustum cull ...
  pass.setBindGroup(0, depthBindGroup, [uniformIdx * 256])
  pass.dispatchWorkgroups(ceil(pointCount / 128))
  slots.touch(slot.chunkIndex, frame)
}
// → N × 2 CPU encoder calls per frame
```

### After: O(1) encoder calls

```typescript
// CPU cull loop — same AABB test, builds a list instead of dispatching
let visibleCount = 0, maxPointCount = 0
for (const slot of this.slots.getSlots()) {
  ... frustum cull ...
  visibleSlotListScratch[visibleCount++] = uniformIdx
  maxPointCount = Math.max(maxPointCount, slot.pointCount)
  slots.touch(slot.chunkIndex, frame)
}
if (visibleCount > 0) {
  device.queue.writeBuffer(visibleSlotListBuf, 0, visibleSlotListScratch, 0, visibleCount * 4)
  const maxWG = Math.ceil(maxPointCount / COMPUTE_WORKGROUP_SIZE)
  pass.setBindGroup(0, depthBindGroup)              // 1 call
  pass.dispatchWorkgroups(maxWG, visibleCount, 1)   // 1 call
}
// → 2 CPU encoder calls regardless of slot count
```

### Shader changes

`gid.y` = slot index in the visible list; `gid.x` = point index within the slot:

```wgsl
@group(0) @binding(1) var<storage, read> chunks:       array<ChunkUniform>;
@group(0) @binding(5) var<storage, read> visibleSlots: array<u32>;

fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk    = chunks[visibleSlots[gid.y]];
    let pointIdx = gid.x;
    if (pointIdx >= chunk.pointCount) { return; }
    // ... rest unchanged
}
```

### Binding changes

| Binding | Before | After |
|---------|--------|-------|
| 1 | `uniform, hasDynamicOffset` (256 B stride) | `storage, read` array (32 B stride) |
| 5 | — | `storage, read` — visible slot list (`array<u32>`) |

`chunkUniform` buffer size drops from `MAX_SLOTS × 256 = 1 MB` to `MAX_SLOTS × 32 = 128 KB`.

### New buffers

```typescript
visibleSlotListBuf     = createBuffer(MAX_SLOTS * 4, STORAGE | COPY_DST)
visibleSlotListScratch = new Uint32Array(MAX_SLOTS)   // CPU scratch, reused each frame
```

---

## Visual rendering tiers (2026-05-20)

Three distinct visual states exist at any camera position:

| Tier | Source | Appearance |
|------|--------|------------|
| **Background** | No GPU data | Black |
| **Seed layer** | Seed pseudo-chunk (chunkIndex = -1), always resident | Sparse scattered dots across full file extent |
| **Decoded chunks** | Fully decoded LAZ chunks in ring buffer | Dense or solid, depending on camera distance |

The "solid" vs "dotty" appearance of decoded chunks is **not a separate mode** — it is a consequence of the ratio of points to projected pixels at the current camera distance. At a medium distance (points < pixels in the projected chunk area), individual points are visible with gaps. At close range (points ≥ pixels), every pixel gets a point and the chunk appears solid. True per-distance LOD would require pre-tiled data (COPC octree); raw LAZ has binary LOD only (seed or full chunk).

The seed layer is always composited underneath decoded chunks via the `atomicMin` depth buffer — seed points show through any gap not covered by a decoded chunk's points.

---

## See also

- [[Decoder Workers]] — Phase 2 source of point buffers
- [[WebGPU Compute]] — atomicMin depth shader design
- [[Ring Buffer GPU Memory]] — GPU memory management, configurable capacity
- [[Spatial Index]] — frustum culling input
- [[LidarScout Chunk-Seed]] — Phase 1 fast overview; Phase 2 seed layer replaced per chunk
- [[Back-Pressure Invariants]] — deferred queue, seed-slot eviction invariant
