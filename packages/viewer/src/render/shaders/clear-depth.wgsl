// clear-depth.wgsl
// Resets the depth buffer to 0xFFFFFFFF — the "no point" sentinel — each frame.
//
// We can't use commandEncoder.clearBuffer() because that fills with zeros,
// and we need a sentinel that is greater than any valid depth bit-cast (which
// for floats in [0,1] is at most 0x3F800000). 0xFFFFFFFF works perfectly as
// the initial atomicMin value.
//
// The pick-ID / visibility buffer (binding 1) is reset to the same sentinel
// each frame. Since Stage 2 it is always viewport-sized — the resolve pass
// reads it per pixel to fetch the winning point's color.

@group(0) @binding(0) var<storage, read_write> depthBuffer: array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> pickBuffer:  array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&depthBuffer)) { return; }
    atomicStore(&depthBuffer[idx], 0xFFFFFFFFu);
    if (idx < arrayLength(&pickBuffer)) {
        pickBuffer[idx] = 0xFFFFFFFFu;
    }
}
