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

## Configurable capacity + adapter-limit negotiation (2026-05-19)

The ring buffer capacity is no longer hardcoded at 256 MB. `webgpu-context.ts` negotiates with the adapter's actual limits and exposes a `targetCapacityBytes` option.

### Constants

```typescript
const DEFAULT_TARGET_RING_BUFFER_BYTES = 2 * 1024 * 1024 * 1024  // 2 GB
const MIN_RING_BUFFER_BYTES             = 128 * 1024 * 1024      // 128 MB floor
const MAX_RING_BUFFER_BYTES             = 4096 * 700_000          // ~2.87 GB ceiling
```

- **2 GB target** — comfortable on most discrete GPUs (NVIDIA RTX, AMD Radeon Pro typically advertise 2 GB+ in `adapter.limits.maxStorageBufferBindingSize`)
- **128 MB floor** — below this, depth+color buffers at 4K resolution (~64 MB) leave too little room for point data
- **~2.87 GB ceiling** — `MAX_SLOTS × slotBytes = 4096 × 700_000`. Beyond this the uniform pool runs out before the ring buffer. `webgpu-context.ts` clamps with a warning. To exceed, bump `MAX_SLOTS` in `webgpu-renderer.ts` first.

### Negotiation pattern

```typescript
const adapterMaxStorage = adapter.limits.maxStorageBufferBindingSize
const adapterMaxBuffer  = adapter.limits.maxBufferSize

// Both must be raised — buffer is bound as storage AND is a buffer object.
const requestedStorage = Math.min(adapterMaxStorage, target)
const requestedBuffer  = Math.min(adapterMaxBuffer,  target)

try {
  device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: requestedStorage,
      maxBufferSize:               requestedBuffer,
    },
  })
} catch (err) {
  console.warn('[webgpu] adapter rejected expanded storage limits — falling back to defaults:', err)
  device = await adapter.requestDevice()
}

const ringBufferCapacity = Math.min(
  device.limits.maxStorageBufferBindingSize,
  device.limits.maxBufferSize,
  target,
)
```

### Override mechanisms

**Via `WebGPURenderer.create()` options:**

```typescript
await WebGPURenderer.create(canvas, {
  ringBufferCapacity: 1024 * 1024 * 1024,  // 1 GB explicit
})
```

Flows through to `createWebGPUContext(canvas, { targetCapacityBytes: options.ringBufferCapacity })`.

**Via URL parameter (no code change):**

```
?bufferMB=2048    → 2 GB
?bufferMB=512     → 512 MB
?bufferMB=2937    → ~2.87 GB (near ceiling)
?bufferMB=4096    → clamped to ceiling with warning
?bufferMB=64      → clamped up to 128 MB with warning
```

`main.ts` parses `URLSearchParams(location.search).get('bufferMB')`, converts to bytes, forwards to renderer.

### Observed values

| Setup | Adapter max | Granted | Slots | Points |
|---|---|---|---|---|
| RTX-class discrete GPU | 2048 MB | 2048 MB | ~2995 | ~150M |
| Typical integrated | 256 MB | 256 MB | 374 | ~18.7M |
| Default fallback | n/a | 128 MB | 187 | ~9.4M |

### Diagnostic log

`createWebGPUContext` always emits at startup:

```
[webgpu] negotiated context: {
  adapterMaxStorageMB:        2048,
  adapterMaxBufferMB:         2048,
  deviceMaxStorageMB:         2048,
  deviceMaxBufferMB:          2048,
  ringBufferCapacityMB:       2048,
  requestedTargetMB:          2048,
}
```

`requestedTargetMB` vs `ringBufferCapacityMB` divergence indicates whether the adapter capped the request.

### Caveats at high slot counts

- **Per-frame CPU encoding cost** scales linearly with slot count. At ~3000 slots, the per-slot `setBindGroup + dispatchWorkgroups` loop takes ~15 ms — close to the 16.7 ms frame budget. Symptoms: `requestAnimationFrame handler took 72ms` violation warnings during slot churn.
- **Deferred queue overflow** is more frequent. Default `MAX_DEFERRED_CHUNKS=64` was calibrated for 374-slot operation; at 3000 slots, fast camera movement can drop 250+ chunks. Bump to 256 for large buffers.
- **Memory pressure**: 2 GB ring buffer + 512 MB IDB cache + ~150 MB workers + JS heap ≈ 3 GB+ total. Integrated GPUs or memory-constrained tabs may struggle.

For higher buffer sizes without hitting these caveats, see Phase 5 indirect dispatch in [[Back-Pressure Invariants]].

---

## See also

- [[Renderer]] — owns the ring buffer; updates `lastRenderedFrame`
- [[Decoder Workers]] — produces decoded buffers written into the ring
- [[WebGPU Compute]] — binds the ring buffer as a compute shader input
- [[Spatial Index]] — provides visible chunk set for eviction guard
- [[Back-Pressure Invariants]] — invariants that keep the ring buffer from overflowing
