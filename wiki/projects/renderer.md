---
title: Renderer
type: project
status: active
updated: 2026-05-10
tags: [three.js, webgpu, webgl, compute-shader, point-cloud, ring-buffer, seed-points]
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

## Phase 2: WebGPU compute shader renderer (planned)

### Responsibilities

1. Accept `Float32Array` point buffers from [[Decoder Workers]] and upload to the [[Ring Buffer GPU Memory]].
2. Manage the ring buffer: allocate slots, evict LRU chunks when capacity is exceeded.
3. Run WebGPU atomicMin depth compute shader (Schütz technique) before the raster pass.
4. Issue draw calls via Three.js `Points` or custom `BufferGeometry`.
5. Expose camera frustum state to [[Spatial Index]] so chunk priority is updated per frame.
6. Handle device lost / context restored events.

### WebGPU compute shader — Schütz atomicMin depth

The depth pre-pass runs as a WebGPU compute shader rather than the fixed-function depth buffer:

1. Each point is projected to screen space in the compute shader.
2. `atomicMin` writes the minimum depth value per pixel into a depth texture (packed uint32).
3. The raster pass reads the depth texture to discard occluded points early.

This avoids overdraw for dense point clouds without requiring a geometry shader. See [[WebGPU Compute]] for full shader design.

### Ring buffer

- Total GPU budget: 256 MB.
- Chunks stored as contiguous `Float32Array` slices in a single large `GPUBuffer`.
- Eviction: LRU — least recently rendered chunk is overwritten when the buffer is full.
- Ring buffer slot table maintained on CPU; GPU-side layout is purely linear.

See [[Ring Buffer GPU Memory]] for eviction algorithm details.

### Three.js integration (Phase 2)

- Renderer: `WebGPURenderer` (Three.js r168+).
- Point cloud: `Points` mesh with custom `ShaderNodeMaterial` (TSL) for colour mapping.
- Camera: `PerspectiveCamera` with orbit controls.
- Per-frame: frustum extracted from `camera.projectionMatrix × camera.matrixWorldInverse`.

---

## Constraints

- Phase 1: NEVER block the main thread during geometry construction.
- Phase 2: NEVER block the main thread during buffer upload — use `GPUQueue.writeBuffer`.
- Ring buffer eviction must be frame-coherent: do not evict a chunk visible this frame.

---

## Open questions

- [ ] TSL (Three.js Shading Language) vs raw WGSL for the depth compute shader?
- [ ] How to handle WebGPU unavailability — WebGL fallback or hard error?
- [ ] Point size attenuation: distance-based or fixed?
- [ ] Eye-dome lighting (Phase 2 target): post-process pass to mask density variation.

---

## See also

- [[Decoder Workers]] — Phase 2 source of point buffers
- [[WebGPU Compute]] — atomicMin depth shader design
- [[Ring Buffer GPU Memory]] — GPU memory management
- [[Spatial Index]] — frustum culling input
- [[LidarScout Chunk-Seed]] — Phase 1 fast overview; Phase 2 seed layer replaced per chunk
