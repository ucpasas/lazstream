// points-depth.wgsl
// One compute dispatch per chunk. Each invocation processes one point.
//
// Per-chunk uniform (`ChunkUniform`) is bound with a dynamic offset, so the
// host updates a single uniform buffer once and selects the slot per dispatch
// via setBindGroup(..., [offset]).
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
    viewProj: mat4x4<f32>,
    viewportSize: vec2<f32>,
    _pad0: vec2<f32>,
    sceneCenter: vec3<f32>,
    _pad1: f32,
};

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,   // offset (in u32s) into `points` where this chunk starts
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<uniform> chunk:  ChunkUniform;
@group(0) @binding(2) var<storage, read> points: array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> colorBuffer: array<u32>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
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

    let pixelIdx = py * u32(viewportW) + px;
    let depthBits = bitcast<u32>(ndc.z);
    let prev = atomicMin(&depthBuffer[pixelIdx], depthBits);
    if (depthBits < prev) {
        colorBuffer[pixelIdx] = rgba;
    }
}
