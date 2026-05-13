---
title: Ring Buffer GPU Memory
type: concept
status: active
updated: 2026-05-13
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

## Slot table (CPU-side) — `src/render/ring-buffer.ts`

Pure TypeScript, no WebGPU types. Fully unit-testable in isolation.

```typescript
interface Slot {
  chunkIndex: number       // LAZ chunk index; -1 for seed pseudo-chunk
  byteOffset: number       // byte offset into the GPU buffer
  byteLength: number       // bytes occupied
  pointCount: number
  min: [number, number, number]    // world-space dequantization origin
  range: [number, number, number]  // world-space dequantization range
  lastRenderedFrame: number        // -1 if never rendered
}
```

`RingBufferAllocator` methods: `allocate()`, `touch()`, `getSlot()`, `remove()`, `getSlots()`, `bytesUsed()`, `pointsLoaded()`.

---

## Eviction algorithm (first-fit + LRU)

`allocate()` runs a loop:
1. `findFirstFreeRange(byteLength)` — walks slots sorted by `byteOffset`, finds first gap ≥ requested size.
2. If found: insert new slot, sort by offset, return.
3. If not found: `findLRUEvictable(currentFrame)` — find slot with lowest `lastRenderedFrame` that is **not** visible this frame (`lastRenderedFrame < currentFrame`).
4. Remove victim, loop back to step 1.
5. If no evictable slots (all visible): return `null` — caller drops the chunk silently.

Frame-coherence invariant: `lastRenderedFrame >= currentFrame` → protected from eviction. The renderer calls `touch(chunkIndex, currentFrame)` for every slot it dispatches each frame.

**Known v1 limitation:** first-fit allocation fragments over time. If visible slots are scattered, a large new chunk may be refused even when total free bytes exceed its size. GPU-side compaction deferred to Track B v2.

---

## Fragmentation

Variable-size chunks cause external fragmentation over time. Mitigation:

- Prefer allocating at the ring pointer position (sequential) rather than filling holes.
- Periodic compaction (GPU-side buffer copy) if fragmentation > 20% of total capacity.
- Alternative: fixed-size slots (max chunk size padded). Simpler, wastes memory for small chunks.

Current decision: sequential ring with no compaction (revisit if fragmentation is observed in practice).

---

## GPU buffer binding

The ring buffer is bound as a read-only storage buffer in the depth compute pass:

```typescript
{ binding: 2, resource: { buffer: ringBuffer } }
```

The shader indexes into it via `chunk.pointStrideOffset` (byte offset / 4, stored as u32 in the chunk uniform). There is no vertex buffer binding — points are read directly in the compute shader.

---

## Constraints

- 256 MB is a fixed budget — do not grow dynamically (avoids driver re-allocation).
- `COPY_DST` usage flag required for `writeBuffer` uploads.
- Never evict a chunk visible in the current frame.

---

## Open questions

- [ ] Fragmentation: monitor in practice with large files (Melbourne 2018, 7000 chunks). Add compaction if refusals observed.

---

## See also

- [[Renderer]] — owns the ring buffer; updates `lastRenderedFrame`
- [[Decoder Workers]] — produces decoded buffers written into the ring
- [[WebGPU Compute]] — binds the ring buffer as a compute shader input
- [[Spatial Index]] — provides visible chunk set for eviction guard
