---
title: Ring Buffer GPU Memory
type: concept
status: draft
updated: 2026-05-09
tags: [webgpu, gpu-memory, ring-buffer, lru, eviction]
---

# Ring Buffer GPU Memory

lazstream manages GPU point cloud memory as a 256 MB ring buffer with LRU eviction, avoiding the overhead of repeated GPU buffer allocation and deallocation as chunks are streamed in and out.

---

## Motivation

GPU memory allocation is expensive. Allocating a new `GPUBuffer` per decoded chunk and releasing it when the chunk leaves the frustum creates constant pressure on the WebGPU driver and the garbage collector.

A single pre-allocated ring buffer amortises this cost: all chunks share one large `GPUBuffer`, and the CPU maintains a slot table tracking which chunk occupies which byte range.

---

## Layout

```
GPUBuffer (256 MB, usage: STORAGE | COPY_DST)
┌──────────┬──────────┬──────────┬───────────────────────┐
│ chunk 0  │ chunk 1  │ chunk 2  │  ...free/evicted...   │
│ 0 MB     │ 0.5 MB   │ 1.1 MB   │                       │
└──────────┴──────────┴──────────┴───────────────────────┘
```

- Chunks are variable-size (point count × bytes per point).
- The ring pointer advances monotonically; wraps when it reaches 256 MB.
- On wrap, the oldest slots (lowest pointer values) are evicted.

---

## Slot table (CPU-side)

```ts
interface Slot {
  chunkIndex: number;
  byteOffset: number;
  byteLength: number;
  pointCount: number;
  lastRenderedFrame: number;  // for LRU
}
```

The slot table is a simple array sorted by `byteOffset`. The [[Renderer]] updates `lastRenderedFrame` for each chunk it draws.

---

## Eviction algorithm

1. When a new chunk arrives and the ring pointer would overflow:
   a. Find the slot with the lowest `lastRenderedFrame` (LRU).
   b. Assert the chunk is not visible this frame (evicting a visible chunk is a bug).
   c. Remove the slot from the table.
   d. Reuse its `byteOffset` for the new chunk (or compact if fragmentation is high).
2. Write new chunk data with `GPUQueue.writeBuffer(buffer, slot.byteOffset, data)`.
3. Add new slot to the table.

Frame coherence invariant: a chunk visible in the current frame's frustum (queried from [[Spatial Index]]) must never be evicted during that frame. Check `lastRenderedFrame === currentFrame` before eviction.

---

## Fragmentation

Variable-size chunks cause external fragmentation over time. Mitigation:

- Prefer allocating at the ring pointer position (sequential) rather than filling holes.
- Periodic compaction (GPU-side buffer copy) if fragmentation > 20% of total capacity.
- Alternative: fixed-size slots (max chunk size padded). Simpler, wastes memory for small chunks.

Current decision: sequential ring with no compaction (revisit if fragmentation is observed in practice).

---

## GPU buffer binding

The ring buffer is bound as a `storage` buffer in the [[WebGPU Compute]] depth pre-pass and as a vertex buffer in the raster pass:

```ts
// Compute: bound as read-only storage
{ binding: 0, resource: { buffer: ringBuffer } }

// Raster: bound as vertex buffer with per-slot offset
passEncoder.setVertexBuffer(0, ringBuffer, slot.byteOffset, slot.byteLength);
```

---

## Constraints

- 256 MB is a fixed budget — do not grow dynamically (avoids driver re-allocation).
- `COPY_DST` usage flag required for `writeBuffer` uploads.
- Never evict a chunk visible in the current frame.

---

## Open questions

- [ ] Should budget be user-configurable (e.g., 128 MB for low-end GPUs)?
- [ ] How to detect GPU OOM before allocating 256 MB? Use `adapter.requestDevice({ requiredLimits: { maxBufferSize: 256MB } })`.

---

## See also

- [[Renderer]] — owns the ring buffer; updates `lastRenderedFrame`
- [[Decoder Workers]] — produces decoded buffers written into the ring
- [[WebGPU Compute]] — binds the ring buffer as a compute shader input
- [[Spatial Index]] — provides visible chunk set for eviction guard
