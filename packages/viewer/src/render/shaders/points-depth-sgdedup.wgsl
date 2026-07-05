// points-depth-sgdedup.wgsl — subgroup same-pixel dedup variant (spike).
//
// Fork of points-depth.wgsl selected at pipeline creation when ?sgdedup=1 and
// the device has the 'subgroups' feature. Kept as a separate file because the
// dedup requires *subgroup-uniform control flow*: Tint rejects subgroup
// builtins placed after per-point early returns, so every guard in the main
// shader becomes a `valid` flag here and the single return happens after the
// subgroup block. Keep the math in lockstep with points-depth.wgsl.
//
// Dedup: when every thread of a subgroup lands on the same pixel (the
// over-coverage pathology — scan-line-neighbour points from a chunk covering
// few pixels), only the nearest thread(s) proceed to the atomic. Skipped
// threads' writes would have lost their atomicMin anyway — output is
// bit-identical; ties all proceed (same benign race as the main shader).

enable subgroups;

struct CameraUniform {
    viewProj:      mat4x4<f32>,
    viewportSize:  vec2<f32>,
    adaptiveSplat: f32,
    projScale:     f32,
    sceneCenter:   vec3<f32>,
    splatRadius:   f32,
};

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,
};

@group(0) @binding(0) var<uniform>             camera:       CameraUniform;
@group(0) @binding(1) var<storage, read>       chunks:       array<ChunkUniform>;
@group(0) @binding(2) var<storage, read>       points:       array<u32>;
@group(0) @binding(3) var<storage, read_write> depthBuffer:  array<atomic<u32>>;
@group(0) @binding(5) var<storage, read>       visibleSlots: array<u32>;
@group(0) @binding(6) var<storage, read_write> pickBuffer:   array<u32>;

fn unpackI16(packed: u32, half: u32) -> i32 {
    let raw = (packed >> (half * 16u)) & 0xFFFFu;
    if ((raw & 0x8000u) != 0u) {
        return i32(raw | 0xFFFF0000u);
    }
    return i32(raw);
}

const INVALID_PIXEL: u32 = 0xFFFFFFFFu;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let uniformIdx = visibleSlots[gid.y];
    let chunk      = chunks[uniformIdx];
    let pointIdx   = gid.x;

    var valid = pointIdx < chunk.pointCount;
    var depthBits: u32 = 0xFFFFFFFFu;
    var sgPixel:   u32 = INVALID_PIXEL;
    var px: u32 = 0u;
    var py: u32 = 0u;
    var clipW: f32 = 1.0;

    if (valid) {
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
        clipW = clip.w;
        if (clip.w <= 0.0) {
            valid = false;
        } else {
            let ndc = clip.xyz / clip.w;
            if (ndc.x < -1.0 || ndc.x > 1.0 ||
                ndc.y < -1.0 || ndc.y > 1.0 ||
                ndc.z <  0.0 || ndc.z > 1.0) {
                valid = false;
            } else {
                let fx = (ndc.x * 0.5 + 0.5) * camera.viewportSize.x;
                let fy = (1.0 - (ndc.y * 0.5 + 0.5)) * camera.viewportSize.y;
                px = u32(fx);
                py = u32(fy);
                if (px >= u32(camera.viewportSize.x) || py >= u32(camera.viewportSize.y)) {
                    valid = false;
                } else {
                    depthBits = bitcast<u32>(ndc.z);
                    sgPixel = py * u32(camera.viewportSize.x) + px;
                }
            }
        }
    }

    // ── Subgroup dedup — must sit in uniform control flow (no returns above).
    // Invalid threads carry sgPixel = INVALID_PIXEL, so a mixed subgroup fails
    // the allSame test and dedup simply doesn't fire — never a wrong skip.
    let firstPixel = subgroupBroadcastFirst(sgPixel);
    let allSame    = subgroupAll(sgPixel == firstPixel);
    let sgMin      = subgroupMin(depthBits);
    if (allSame && sgPixel != INVALID_PIXEL && depthBits > sgMin) {
        valid = false;
    }

    if (!valid) { return; }

    let encodedId = (uniformIdx << 18u) | pointIdx;

    var radius = i32(camera.splatRadius) - 1;
    if (camera.adaptiveSplat > 0.5) {
        let spacingWorld = sqrt(chunk.rangeXYZ.x * chunk.rangeXYZ.y / f32(chunk.pointCount));
        let pixSpacing = spacingWorld * camera.projScale / clipW;
        if (pixSpacing < 0.5) { radius = 0; }
    }
    let vpW = i32(camera.viewportSize.x);
    let vpH = i32(camera.viewportSize.y);

    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let sx = i32(px) + dx;
            let sy = i32(py) + dy;
            if (sx < 0 || sy < 0 || sx >= vpW || sy >= vpH) { continue; }
            let idx = u32(sy) * u32(vpW) + u32(sx);
            let prev = atomicLoad(&depthBuffer[idx]);
            if (depthBits >= prev) { continue; }
            let old = atomicMin(&depthBuffer[idx], depthBits);
            if (depthBits < old) {
                pickBuffer[idx] = encodedId;
            }
        }
    }
}
