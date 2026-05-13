// resolve-edl.wgsl
// Fullscreen triangle that reads the per-pixel depth and color buffers and
// writes to the swapchain texture, applying eye-dome lighting (EDL) inline.
//
// EDL (Christian Boucheny, 2009) attenuates pixel brightness by the sum of
// positive log-depth differences against 4 neighbors. Pixels at the "front"
// of a discontinuity get darkened, giving point clouds visible structure
// without explicit shading.
//
// Sentinel: 0xFFFFFFFF in the depth buffer means "no point hit this pixel"
// (atomicMin against the initial 0xFFFFFFFF is replaced by any valid depth
// since IEEE-754 positive floats in [0,1] all bit-cast to values < 0xFFFFFFFF).

struct ViewportUniform {
    size: vec2<f32>,
    edlStrength: f32,
    edlRadius: f32,
};

@group(0) @binding(0) var<uniform> viewport: ViewportUniform;
@group(0) @binding(1) var<storage, read> depthBuffer: array<u32>;
@group(0) @binding(2) var<storage, read> colorBuffer: array<u32>;

const EMPTY_DEPTH: u32 = 0xFFFFFFFFu;
const BACKGROUND: vec3<f32> = vec3<f32>(0.04, 0.04, 0.06);

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> @builtin(position) vec4<f32> {
    // Fullscreen triangle: covers NDC [-1, 3] x [-1, 3] which clips to [-1, 1].
    let x = f32((idx << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(idx & 2u) * 2.0 - 1.0;
    return vec4<f32>(x, y, 0.0, 1.0);
}

fn readDepth(px: i32, py: i32, w: i32, h: i32) -> f32 {
    if (px < 0 || py < 0 || px >= w || py >= h) { return -1.0; }
    let bits = depthBuffer[py * w + px];
    if (bits == EMPTY_DEPTH) { return -1.0; }
    return bitcast<f32>(bits);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    let w = i32(viewport.size.x);
    let h = i32(viewport.size.y);
    let px = i32(fragCoord.x);
    let py = i32(fragCoord.y);
    if (px < 0 || py < 0 || px >= w || py >= h) {
        return vec4<f32>(BACKGROUND, 1.0);
    }

    let centerDepth = readDepth(px, py, w, h);
    if (centerDepth < 0.0) {
        return vec4<f32>(BACKGROUND, 1.0);
    }

    // log(z + epsilon) to make EDL sensitive to relative depth differences
    // regardless of overall scene distance.
    let logCenter = log2(centerDepth + 1e-6);

    let r = i32(max(1.0, viewport.edlRadius));
    var shade = 0.0;
    // 4 cardinal neighbors at radius r — Potree's standard EDL kernel.
    let offsets = array<vec2<i32>, 4>(
        vec2<i32>(-r, 0),
        vec2<i32>( r, 0),
        vec2<i32>(0, -r),
        vec2<i32>(0,  r),
    );
    for (var i = 0; i < 4; i = i + 1) {
        let nx = px + offsets[i].x;
        let ny = py + offsets[i].y;
        let nd = readDepth(nx, ny, w, h);
        if (nd < 0.0) { continue; }
        let dz = logCenter - log2(nd + 1e-6);
        shade = shade + max(0.0, dz);
    }
    let factor = exp(-shade * viewport.edlStrength);

    let rgba = colorBuffer[py * w + px];
    let cr = f32(rgba & 0xFFu)         / 255.0;
    let cg = f32((rgba >>  8u) & 0xFFu) / 255.0;
    let cb = f32((rgba >> 16u) & 0xFFu) / 255.0;
    return vec4<f32>(cr * factor, cg * factor, cb * factor, 1.0);
}
