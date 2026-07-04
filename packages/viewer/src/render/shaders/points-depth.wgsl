// points-depth.wgsl
// Single 2D dispatch covers all visible chunks in one GPU call.
//
// gid.y = index into visibleSlots[], which maps to a uniformIdx into
// the chunks[] storage array. gid.x = point index within that chunk.
// The host builds visibleSlots on CPU (frustum cull), writes it via
// writeBuffer, then calls dispatchWorkgroups(maxWG, visibleCount, 1).
//
// Stage 2 (visibility buffer — see [[Renderer Performance Roadmap]]):
// this pass is position-only. It reads the 8-byte hot region of each point
// (words 0–1: quantized xyz; intensity/class ride along unused) and writes
// ONLY depth + pick-ID. Color is resolved per-pixel in resolve-edl.wgsl
// from the pick-ID — O(pixels), not O(points) — which also removed the old
// color benign-race (the pick-ID race remains, same benignity).
//
// For each point:
//  1. Unpack Int16 quantized x,y,z (sign-extended from u32 halves)
//  2. Dequantize: worldPos = ((q + 32768) / 65535) * range + min
//  3. Subtract sceneCenter (Float32 stability)
//  4. Project via viewProj matrix
//  5. Discard if outside clip volume (per-point frustum cull)
//  6. Early-depth test: atomicLoad current depth, skip the RMW if the
//     point already loses (bit-identical output, cheaper under contention)
//  7. atomicMin on depth buffer with bit-cast(ndc.z) — order-preserving
//     for positive floats in [0,1]
//  8. If we won the race, write the encoded pick-ID. Race tolerated.

struct CameraUniform {
    viewProj:      mat4x4<f32>,
    viewportSize:  vec2<f32>,
    adaptiveSplat: f32,   // 0 = fixed splatRadius; 1 = shrink to 1×1 where points are denser than pixels
    projScale:     f32,   // viewportH/2 · cot(fovY/2) — world-to-pixel scale at distance clip.w
    sceneCenter:   vec3<f32>,
    splatRadius:   f32,
};

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,   // offset (in u32s) into `points` where this chunk starts
};

@group(0) @binding(0) var<uniform>             camera:       CameraUniform;
@group(0) @binding(1) var<storage, read>       chunks:       array<ChunkUniform>;
@group(0) @binding(2) var<storage, read>       points:       array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer:  array<atomic<u32>>;
@group(0) @binding(5) var<storage, read>       visibleSlots: array<u32>;
// Pick-ID / visibility buffer. Always viewport-sized (Stage 2 promoted it to
// the primary G-buffer — the resolve pass derives color from it per pixel).
// Encoding: bits 31..19 = uniformIdx (slot in chunks[]), bits 18..0 = local point index.
// Sentinel 0xFFFFFFFF = no point (matches depth sentinel).
@group(0) @binding(6) var<storage, read_write> pickBuffer:   array<u32>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let uniformIdx = visibleSlots[gid.y];
    let chunk      = chunks[uniformIdx];
    let pointIdx   = gid.x;
    if (pointIdx >= chunk.pointCount) { return; }

    // Hot region: 2 u32 per point (position + packed attrs riding in w1).
    let base = chunk.pointStrideOffset + pointIdx * 2u;
    let w0   = points[base + 0u];
    let w1   = points[base + 1u];

    let qx = unpackI16(w0, 0u);
    let qy = unpackI16(w0, 1u);
    let qz = unpackI16(w1, 0u);

    let normalized = (vec3<f32>(f32(qx), f32(qy), f32(qz)) + vec3<f32>(32768.0)) / 65535.0;
    let worldPos = normalized * chunk.rangeXYZ + chunk.minXYZ;
    let localPos = worldPos - camera.sceneCenter;

    let clip = camera.viewProj * vec4<f32>(localPos, 1.0);
    if (clip.w <= 0.0) { return; }

    let ndc = clip.xyz / clip.w;
    if (ndc.x < -1.0 || ndc.x > 1.0) { return; }
    if (ndc.y < -1.0 || ndc.y > 1.0) { return; }
    if (ndc.z <  0.0 || ndc.z > 1.0) { return; }

    let viewportW = camera.viewportSize.x;
    let viewportH = camera.viewportSize.y;
    let fx = (ndc.x * 0.5 + 0.5) * viewportW;
    let fy = (1.0 - (ndc.y * 0.5 + 0.5)) * viewportH;
    let px = u32(fx);
    let py = u32(fy);
    if (px >= u32(viewportW)) { return; }
    if (py >= u32(viewportH)) { return; }

    let depthBits = bitcast<u32>(ndc.z);
    // Encode (uniformIdx, pointIdx) — the resolve pass fetches color through this.
    let encodedId = (uniformIdx << 19u) | pointIdx;

    // ?sgdedup=1 selects the points-depth-sgdedup.wgsl fork of this shader
    // (subgroup same-pixel dedup — needs uniform control flow, so it cannot
    // be injected here). Keep that file's math in lockstep with this one.

    // Adaptive splat (roadmap re-prioritisation 2026-07-04): the dominant
    // depth-pass cost is scattered framebuffer accesses — 3×3 splats issue
    // ~9 per point. The splat's job is hole-filling where points are sparser
    // than pixels; when this chunk's points are ≥2× denser than the pixel
    // grid at this distance, a 1×1 splat is visually equivalent and ~9×
    // cheaper exactly where over-coverage contention is worst.
    // spacing estimate: aerial data is 2.5D, so XY footprint / pointCount.
    var radius = i32(camera.splatRadius) - 1;
    if (camera.adaptiveSplat > 0.5) {
        let spacingWorld = sqrt(chunk.rangeXYZ.x * chunk.rangeXYZ.y / f32(chunk.pointCount));
        let pixSpacing = spacingWorld * camera.projScale / clip.w;
        if (pixSpacing < 0.5) { radius = 0; }
    }
    let vpW = i32(viewportW);
    let vpH = i32(viewportH);

    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let sx = i32(px) + dx;
            let sy = i32(py) + dy;
            if (sx < 0 || sy < 0 || sx >= vpW || sy >= vpH) { continue; }
            let idx = u32(sy) * u32(vpW) + u32(sx);
            // Early-depth test: skip the contested atomic RMW when this point
            // already loses. atomicLoad (relaxed) is far cheaper than atomicMin
            // under contention, and skipping only losing writes keeps the
            // resolved image bit-identical. Conservative filter only — the
            // win branch must still key off atomicMin's return value, not prev.
            let prev = atomicLoad(&depthBuffer[idx]);
            if (depthBits >= prev) { continue; }
            let old = atomicMin(&depthBuffer[idx], depthBits);
            if (depthBits < old) {
                pickBuffer[idx] = encodedId;
            }
        }
    }
}
