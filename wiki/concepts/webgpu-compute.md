---
title: WebGPU Compute
type: concept
status: active
updated: 2026-05-13
tags: [webgpu, compute-shader, wgsl, depth, atomicmin, schutz, storage-buffer, dynamic-offset]
---

# WebGPU Compute

lazstream uses a WebGPU compute shader for the depth pre-pass, implementing the Schütz atomicMin technique to avoid overdraw in dense point clouds.

---

## Why a compute-based depth pass?

Traditional rasterisation of point clouds suffers severe overdraw: many points project to the same pixel, but only the front-most contributes to the final image. The fixed-function depth buffer handles this, but requires a two-pass approach (depth-only first, then colour) or alpha-to-coverage hacks.

The Schütz technique runs the depth pass entirely in a compute shader using atomic operations, producing a depth image that the subsequent raster pass reads to early-discard hidden points in a single geometry pass.

---

## Algorithm (Schütz atomicMin)

1. **Depth image**: a `texture_storage_2d<r32uint, read_write>` (one uint32 per pixel, representing depth as a bit-cast float).
2. **Compute shader** (one invocation per point):
   a. Project the point to clip space using the camera MVP matrix.
   b. Discard if outside clip bounds (frustum cull per point).
   c. Compute pixel coordinates `(px, py)`.
   d. Bit-cast the clip-space depth `z` to `u32`.
   e. `atomicMin(&depthImage[px, py], depthAsU32)` — only the front-most point wins.
3. **Raster pass**: sample `depthImage[gl_FragCoord.xy]`; discard if fragment depth > stored minimum.

Because IEEE 754 floats in `[0, 1]` preserve order under bit-cast to uint32, `atomicMin` on the uint representation is equivalent to `min` on the float.

---

## Implementation (points-depth.wgsl)

The actual implementation uses a **storage buffer** (`array<atomic<u32>>`) rather than `texture_storage_2d` + `textureAtomicMin`. The `texture-atomic` WebGPU extension has inconsistent vendor support; the storage buffer approach works on all WebGPU-capable hardware.

### Bindings

| Binding | Type | Contents |
|---------|------|----------|
| 0 | `uniform` | `CameraUniform` — viewProj mat4, viewportSize vec2, sceneCenter vec3 |
| 1 | `uniform` (dynamic offset) | `ChunkUniform` — minXYZ, pointCount, rangeXYZ, pointStrideOffset |
| 2 | `storage, read` | Ring buffer — packed point data (`array<u32>`) |
| 3 | `storage, read_write` | Depth buffer — `array<atomic<u32>>`, one u32 per pixel |
| 4 | `storage, read_write` | Color buffer — `array<u32>`, one u32 per pixel |

### Per-point pipeline

1. Unpack Int16 XYZ from packed u32 halves (sign-extend via bit-twiddling)
2. Dequantize: `worldPos = ((q + 32768) / 65535) * rangeXYZ + minXYZ`
3. Subtract `sceneCenter` — scene-local Float32 (avoids precision loss on large UTM coords)
4. Multiply by `viewProj` — clip space
5. Per-point frustum cull (clip.w ≤ 0, NDC outside ±1, depth outside 0–1)
6. Map NDC → pixel coordinates (Y-flip: NDC Y up, screen Y down)
7. `atomicMin(&depthBuffer[pixelIdx], bitcast<u32>(ndc.z))`
8. If we won (`depthBits < prev`): write color non-atomically. Race is benign.

### Dynamic offset dispatch

One `setBindGroup(..., [uniformIdx * chunkUniformStride])` + `dispatchWorkgroups(ceil(pointCount / 128))` per slot per frame. Avoids recreating bind groups between chunks.

### Why IEEE 754 bitcast works for depth comparison

Floats in `[0, 1]` with the same sign preserve sort order when reinterpreted as `u32`. `atomicMin` on the bit-cast uint is therefore equivalent to `min` on the original float. Only valid for positive depths — which NDC z ∈ [0, 1] guarantees.

---

## Three.js integration

Three.js is used **only** for `PerspectiveCamera` and `OrbitControls`. The WebGPU device, pipelines, and passes are created directly via the WebGPU API — not via `THREE.WebGPURenderer` or TSL. This avoids Three.js abstraction overhead and gives direct control over bind group layouts and dynamic offsets.

The `viewProj` matrix is extracted each frame via:
```typescript
this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
```

---

## Device support

- Requires WebGPU (Chrome 120+, Edge 120+). Confirmed working on Windows with discrete GPU.
- `WebGPUUnsupportedError` thrown if `navigator.gpu` absent, no adapter, or canvas context fails.
- 128 MB minimum `maxStorageBufferBindingSize` enforced — below this, depth + color buffers at 4K would exceed limits.
- 256 MB ring buffer negotiated at device creation; falls back to 128 MB for integrated GPUs.
- The `powerPreference: 'high-performance'` hint is passed to `requestAdapter()` but ignored on some platforms (logged as a Vite warning — benign).

---

## See also

- [[Renderer]] — hosts the compute pass and raster pass
- [[Ring Buffer GPU Memory]] — provides the point buffer bound to the compute shader
