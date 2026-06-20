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
//  7. If we won the race, compute final color from colorParams.mode and
//     write to color buffer. Race tolerated.

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

// colorParams.mode values:
//   0 = rgb          (native color from word 2)
//   1 = height       (shader-computed elevation ramp)
//   2 = intensity    (grayscale from seed-stretched intensity8)
//   3 = classification (ASPRS LUT)
struct ColorParams {
    mode        : u32,
    _pad0       : u32,
    globalMinZ  : f32,
    globalMaxZ  : f32,
    intensityLo : f32,  // identity 0.0 for v1; hook for in-flight histogram refinement
    intensityHi : f32,  // identity 1.0 for v1
    _pad1       : vec2<f32>,
};

@group(0) @binding(0) var<uniform>             camera:       CameraUniform;
@group(0) @binding(1) var<storage, read>       chunks:       array<ChunkUniform>;
@group(0) @binding(2) var<storage, read>       points:       array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer:  array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> colorBuffer:  array<u32>;
@group(0) @binding(5) var<storage, read>       visibleSlots: array<u32>;
// Pick-ID buffer (T2 picking). Inactive = 4-byte stub; OOB writes are silently dropped by WebGPU.
// Encoding: bits 31..19 = uniformIdx (slot in chunks[]), bits 18..0 = local point index.
// Sentinel 0xFFFFFFFF = no point (matches depth sentinel).
@group(0) @binding(6) var<storage, read_write> pickBuffer:   array<u32>;
@group(0) @binding(7) var<uniform>             colorParams:  ColorParams;
@group(0) @binding(8) var<storage, read>       classLUT:     array<u32, 256>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

// WGSL port of the TS elevationToRgb ramp in decode-worker.ts.
// Must stay in sync with the worker's copy — both implement the same 5-stop gradient.
fn heightRamp(t: f32) -> vec3<f32> {
    let c0 = vec3<f32>(  0.0,  51.0, 204.0) / 255.0;
    let c1 = vec3<f32>(  0.0, 204.0, 153.0) / 255.0;
    let c2 = vec3<f32>( 51.0, 230.0,  26.0) / 255.0;
    let c3 = vec3<f32>(255.0, 204.0,   0.0) / 255.0;
    let c4 = vec3<f32>(255.0,  26.0,   0.0) / 255.0;

    let clamped = clamp(t, 0.0, 0.9999);
    let idx = clamped * 4.0;
    let lo  = i32(floor(idx));
    let hi  = min(lo + 1, 4);
    let f   = idx - floor(idx);

    var stops = array<vec3<f32>, 5>(c0, c1, c2, c3, c4);
    return mix(stops[lo], stops[hi], f);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let uniformIdx = visibleSlots[gid.y];
    let chunk      = chunks[uniformIdx];
    let pointIdx   = gid.x;
    if (pointIdx >= chunk.pointCount) { return; }

    let base = chunk.pointStrideOffset + pointIdx * 3u;
    let w0   = points[base + 0u];
    let w1   = points[base + 1u];
    let w2   = points[base + 2u];

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
    // Encode (uniformIdx, pointIdx) for T2 picking. Same race profile as colorBuffer:
    // written only in the atomicMin win-branch, benign sub-pixel margin error accepted.
    let encodedId = (uniformIdx << 19u) | pointIdx;
    let radius = i32(camera.splatRadius) - 1;
    let vpW = i32(viewportW);
    let vpH = i32(viewportH);

    // ── Compute final color from colorParams.mode ──────────────────────────────
    let intensity8 = (w1 >> 16u) & 0xFFu;
    let classv     = (w1 >> 24u) & 0xFFu;
    let nr = f32( w2        & 0xFFu) / 255.0;
    let ng = f32((w2 >>  8u) & 0xFFu) / 255.0;
    let nb = f32((w2 >> 16u) & 0xFFu) / 255.0;

    var rgb: vec3<f32>;
    switch colorParams.mode {
        case 1u: {
            let globalRangeZ = max(colorParams.globalMaxZ - colorParams.globalMinZ, 1e-6);
            let t = clamp((worldPos.z - colorParams.globalMinZ) / globalRangeZ, 0.0, 1.0);
            rgb = heightRamp(t);
        }
        case 2u: {
            var iv = f32(intensity8) / 255.0;
            let iRange = max(colorParams.intensityHi - colorParams.intensityLo, 1e-6);
            iv = clamp((iv - colorParams.intensityLo) / iRange, 0.0, 1.0);
            rgb = vec3<f32>(iv, iv, iv);
        }
        case 3u: {
            let p = classLUT[classv];
            rgb = vec3<f32>(f32(p & 0xFFu), f32((p >> 8u) & 0xFFu), f32((p >> 16u) & 0xFFu)) / 255.0;
        }
        default: {
            rgb = vec3<f32>(nr, ng, nb);
        }
    }

    let r255 = u32(clamp(rgb.x * 255.0, 0.0, 255.0));
    let g255 = u32(clamp(rgb.y * 255.0, 0.0, 255.0));
    let b255 = u32(clamp(rgb.z * 255.0, 0.0, 255.0));
    let finalColor = (0xFFu << 24u) | (b255 << 16u) | (g255 << 8u) | r255;

    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let sx = i32(px) + dx;
            let sy = i32(py) + dy;
            if (sx < 0 || sy < 0 || sx >= vpW || sy >= vpH) { continue; }
            let idx = u32(sy) * u32(vpW) + u32(sx);
            let prev = atomicMin(&depthBuffer[idx], depthBits);
            if (depthBits < prev) {
                colorBuffer[idx] = finalColor;
                pickBuffer[idx]  = encodedId;
            }
        }
    }
}
