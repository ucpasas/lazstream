---
title: WebGPU Compute
type: concept
status: draft
updated: 2026-05-09
tags: [webgpu, compute-shader, wgsl, depth, atomicmin, schutz]
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

## WGSL sketch

```wgsl
@group(0) @binding(0) var<storage, read> points: array<vec4f>;
@group(0) @binding(1) var depthImage: texture_storage_2d<r32uint, read_write>;
@group(0) @binding(2) var<uniform> mvp: mat4x4f;

@compute @workgroup_size(64)
fn depthPrepass(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= arrayLength(&points)) { return; }

  let pos = mvp * vec4f(points[idx].xyz, 1.0);
  if (pos.w <= 0.0) { return; }

  let ndc = pos.xyz / pos.w;
  if (any(abs(ndc.xy) > vec2f(1.0)) || ndc.z < 0.0 || ndc.z > 1.0) { return; }

  let dims = textureDimensions(depthImage);
  let px = u32((ndc.x * 0.5 + 0.5) * f32(dims.x));
  let py = u32((1.0 - (ndc.y * 0.5 + 0.5)) * f32(dims.y));

  let depthBits = bitcast<u32>(ndc.z);
  textureAtomicMin(depthImage, vec2u(px, py), depthBits);
}
```

Note: `textureAtomicMin` requires WebGPU with the `texture-atomic` extension. Check device feature support at init time.

---

## Three.js integration

Three.js r168+ exposes `WebGPURenderer` and TSL (Three Shading Language). The compute pass is a `ComputeNode` that runs before the scene render:

```ts
const depthPass = tsl.Fn(() => { /* ... */ })().toComputeNode(pointCount / 64);
renderer.computeAsync(depthPass);
```

---

## Device support

- WebGPU with `texture-atomic` is required.
- Fallback: if WebGPU is unavailable, surface a clear error (no WebGL fallback planned).
- Feature detection: `adapter.features.has('texture-atomic')`.

---

## See also

- [[Renderer]] — hosts the compute pass and raster pass
- [[Ring Buffer GPU Memory]] — provides the point buffer bound to the compute shader
