// points-depth.wgsl
// Single 2D dispatch covers all visible chunks in one GPU call.
//
// gid.y = index into visibleSlots[], which maps to a uniformIdx into
// the chunks[] storage array. gid.x = point index within that chunk.
// The host builds visibleSlots on CPU (frustum cull), writes it via
// writeBuffer, then calls dispatchWorkgroups(maxWG, visibleCount, 1).
//
// For each point:
//  1. Unpack Int16 quantized x,y,z (sign-extended from u32 halves)
//  2. Dequantize: worldPos = ((q + 32768) / 65535) * range + min
//  3. Subtract sceneCenter (Float32 stability)
//  4. Project via viewProj matrix
//  5. Discard if outside clip volume (per-point frustum cull)
//  6. atomicMin on depth buffer with bit-cast(ndc.z) — order-preserving
//     for positive floats in [0,1]
//  7. If we won the race, write color non-atomically. Race tolerated.

struct CameraUniform {
    viewProj:     mat4x4<f32>,
    viewportSize: vec2<f32>,
    _pad0:        vec2<f32>,
    sceneCenter:  vec3<f32>,
    splatRadius:  f32,
};

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,   // offset (in u32s) into `points` where this chunk starts
};

@group(0) @binding(0) var<uniform>            camera:       CameraUniform;
@group(0) @binding(1) var<storage, read>      chunks:       array<ChunkUniform>;
@group(0) @binding(2) var<storage, read>      points:       array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> colorBuffer: array<u32>;
@group(0) @binding(5) var<storage, read>      visibleSlots: array<u32>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk    = chunks[visibleSlots[gid.y]];
    let pointIdx = gid.x;
    if (pointIdx >= chunk.pointCount) { return; }

    let base = chunk.pointStrideOffset + pointIdx * 3u;
    let w0   = points[base + 0u];
    let w1   = points[base + 1u];
    let rgba = points[base + 2u];

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
    let radius = i32(camera.splatRadius) - 1;
    let vpW = i32(viewportW);
    let vpH = i32(viewportH);
    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let sx = i32(px) + dx;
            let sy = i32(py) + dy;
            if (sx < 0 || sy < 0 || sx >= vpW || sy >= vpH) { continue; }
            let idx = u32(sy) * u32(vpW) + u32(sx);
            let prev = atomicMin(&depthBuffer[idx], depthBits);
            if (depthBits < prev) {
                colorBuffer[idx] = rgba;
            }
        }
    }
}
