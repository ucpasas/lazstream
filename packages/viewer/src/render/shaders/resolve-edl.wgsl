// resolve-edl.wgsl
// Fullscreen triangle that reads the per-pixel depth and pick-ID buffers,
// fetches/computes the winning point's color (Stage 2 visibility buffer —
// color work is O(pixels), not O(points)), and writes to the swapchain
// texture, applying eye-dome lighting (EDL) inline.
//
// Color resolution: the pick-ID encodes (uniformIdx << 19 | localPointIndex).
// chunks[uniformIdx].pointStrideOffset locates the chunk in the ring buffer;
// the point's hot word 1 (z + intensity8 + classification) sits at
// strideOffset + local*2 + 1, and its cold RGBA word at
// strideOffset + pointCount*2 + local (split-region layout — point-packing.ts).
//
// colorParams.mode values:
//   0 = rgb          (native color from the cold attribute word)
//   1 = height       (shader-computed elevation ramp from dequantized z)
//   2 = intensity    (grayscale from seed-stretched intensity8)
//   3 = classification (ASPRS LUT)
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

struct ChunkUniform {
    minXYZ: vec3<f32>,
    pointCount: u32,
    rangeXYZ: vec3<f32>,
    pointStrideOffset: u32,
};

struct ColorParams {
    mode        : u32,
    _pad0       : u32,
    globalMinZ  : f32,
    globalMaxZ  : f32,
    intensityLo : f32,  // identity 0.0 for v1; hook for in-flight histogram refinement
    intensityHi : f32,  // identity 1.0 for v1
    _pad1       : vec2<f32>,
};

@group(0) @binding(0) var<uniform>       viewport:    ViewportUniform;
@group(0) @binding(1) var<storage, read> depthBuffer: array<u32>;
@group(0) @binding(2) var<storage, read> pickBuffer:  array<u32>;
@group(0) @binding(3) var<storage, read> points:      array<u32>;
@group(0) @binding(4) var<storage, read> chunks:      array<ChunkUniform>;
@group(0) @binding(5) var<uniform>       colorParams: ColorParams;
@group(0) @binding(6) var<storage, read> classLUT:    array<u32, 256>;

const EMPTY: u32 = 0xFFFFFFFFu;
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
    if (bits == EMPTY) { return -1.0; }
    return bitcast<f32>(bits);
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

fn resolveColor(pickId: u32) -> vec3<f32> {
    if (pickId == EMPTY) {
        // Depth hit but no pick-ID (transient benign-race window) — neutral gray.
        return vec3<f32>(0.5, 0.5, 0.5);
    }
    let uniformIdx = pickId >> 19u;
    let localIdx   = pickId & 0x7FFFFu;
    let chunk      = chunks[uniformIdx];

    let w1 = points[chunk.pointStrideOffset + localIdx * 2u + 1u];
    let intensity8 = (w1 >> 16u) & 0xFFu;
    let classv     = (w1 >> 24u) & 0xFFu;

    switch colorParams.mode {
        case 1u: {
            // Dequantize z the same way the depth pass does, for the ramp.
            let rawZ = w1 & 0xFFFFu;
            var qz: i32;
            if ((rawZ & 0x8000u) != 0u) { qz = i32(rawZ | 0xFFFF0000u); } else { qz = i32(rawZ); }
            let worldZ = ((f32(qz) + 32768.0) / 65535.0) * chunk.rangeXYZ.z + chunk.minXYZ.z;
            let globalRangeZ = max(colorParams.globalMaxZ - colorParams.globalMinZ, 1e-6);
            let t = clamp((worldZ - colorParams.globalMinZ) / globalRangeZ, 0.0, 1.0);
            return heightRamp(t);
        }
        case 2u: {
            var iv = f32(intensity8) / 255.0;
            let iRange = max(colorParams.intensityHi - colorParams.intensityLo, 1e-6);
            iv = clamp((iv - colorParams.intensityLo) / iRange, 0.0, 1.0);
            return vec3<f32>(iv, iv, iv);
        }
        case 3u: {
            let p = classLUT[classv];
            return vec3<f32>(f32(p & 0xFFu), f32((p >> 8u) & 0xFFu), f32((p >> 16u) & 0xFFu)) / 255.0;
        }
        default: {
            // Native RGB from the cold attribute region.
            let w2 = points[chunk.pointStrideOffset + chunk.pointCount * 2u + localIdx];
            return vec3<f32>(
                f32( w2        & 0xFFu),
                f32((w2 >>  8u) & 0xFFu),
                f32((w2 >> 16u) & 0xFFu),
            ) / 255.0;
        }
    }
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

    let rgb = resolveColor(pickBuffer[py * w + px]);
    return vec4<f32>(rgb * factor, 1.0);
}
