---
title: Ring Buffer GPU Memory
type: concept
status: active
updated: 2026-05-22
tags: [webgpu, gpu-memory, ring-buffer, lru, eviction, free-list, fragmentation]
---

# Ring Buffer GPU Memory

lazstream manages GPU point cloud memory as a single pre-allocated `GPUBuffer` with a CPU-side free-list allocator and LRU eviction, avoiding the overhead of repeated GPU buffer allocation and deallocation as chunks are streamed in and out.

---

## Motivation

GPU memory allocation is expensive. Allocating a new `GPUBuffer` per decoded chunk and releasing it when the chunk leaves the frustum creates constant pressure on the WebGPU driver and the garbage collector.

A single pre-allocated ring buffer amortises this cost: all chunks share one large `GPUBuffer`, and the CPU maintains a slot table tracking which chunk occupies which byte range.

---

## Layout

```
GPUBuffer (up to 2 GB, usage: STORAGE | COPY_DST)
┌──────────┬────────┬───────────┬──────────┬────── ... ─┐
│ chunk A  │  free  │  chunk B  │  chunk C │    free    │
│ 600 KB   │ 200 KB │  120 KB   │  600 KB  │            │
└──────────┴────────┴───────────┴──────────┴────── ... ─┘
  ▲ byteOffset tracked per slot (variable); not derived from an index
```

Chunks are variable-size (pointCount × 12 B/pt, 4-byte aligned). Each chunk
receives exactly the bytes it needs — no tail waste.

---

## Slot table (CPU-side) — `src/render/ring-buffer.ts`

Pure TypeScript, no WebGPU types. Fully unit-testable in isolation.

```typescript
interface Slot {
  chunkIndex: number       // LAZ chunk index; -1 for seed pseudo-chunk
  byteOffset: number       // byte offset into the GPU buffer (variable per slot)
  byteLength: number       // actual data bytes — no padding, no tail waste
  pointCount: number
  min: [number, number, number]    // world-space dequantization origin
  range: [number, number, number]  // world-space dequantization range
  lastRenderedFrame: number        // initialised to currentFrame-1 (not -1; see below)
  everRendered: boolean            // set to true on first touch(); guards phantom chunk re-queue
}
```

**`lastRenderedFrame` initialised to `currentFrame - 1`**: a slot placed by `flushDeferredChunks` after the render pass would have `lastRenderedFrame = -1`, which is always below the eviction threshold — it would evict immediately on the next frame, causing an infinite decode/evict loop. Starting at `currentFrame - 1` grants the slot the full `EVICT_GRACE_FRAMES` window before it can be proactively evicted.

**`everRendered`**: distinguishes phantom chunks (pass AABB dispatch, fail exact 6-plane renderer test — `touch()` never called) from legitimately-visible chunks that moved off-screen. Used by `evictInvisibleSlots()` to decide whether to re-queue via `chunkEvictedCallback` — phantoms are released silently.

`RingBufferAllocator` methods: `allocate()`, `touch()`, `getSlot()`, `remove()`, `getSlots()`, `bytesUsed()`, `pointsLoaded()`, `avgChunkBytes()`, `getAvailableCount()`, `metrics()`.

---

## Allocation algorithm (free-list + defrag-by-eviction)

`allocate()` runs a loop:
1. **First-fit scan** — walks `freeList` (sorted by offset, coalesced) for the first gap ≥ `byteLength`.
2. If found: carve `byteLength` bytes from the gap's start, create slot, return success.
3. If not found: **defrag-by-eviction** — find slot with lowest `lastRenderedFrame` that is **not** visible this frame.
4. If no evictable slot (all visible): return `{ slot: null, evicted }` — caller pushes to deferred queue.
5. Evict the LRU slot: remove it from `slots`, add its bytes to `freeList`, coalesce adjacent regions.
6. Loop back to step 1 — the coalesced gap may now be large enough.

`AllocateResult.evicted` is populated with all evictions that occurred, even if `slot` is ultimately null (defrag ran out of evictable slots before forming a large enough gap). Callers **must** process `evicted` in both the success and failure cases — this clears the three sets required by Invariant 7 ([[Back-Pressure Invariants]] §7).

Frame-coherence invariant: `lastRenderedFrame >= currentFrame` → protected from eviction. The renderer calls `touch(chunkIndex, currentFrame)` for every slot it dispatches each frame.

---

## Fragmentation

Variable-size chunks cause external fragmentation over time. In practice:

- **Raw LAZ**: all chunks in a file have the same declared point count (`lazVlr.chunkSize`). Eviction always frees a gap matching the size of the next incoming chunk → `firstFit` succeeds immediately → zero defrag evictions in normal operation.
- **COPC / variable-chunk files**: nodes vary in size. Adjacent small-node gaps coalesce into one large gap that fits a large node. Defrag evictions may occur but are rare.

`metrics().fragmentationRatio = (bytesFree - largestFreeGap) / bytesFree`. Monitor for high values combined with frequent defrag evictions. If persistent, consider a buddy allocator or (see below) GPU compaction.

---

## GPU compaction — decision: deferred

Full compaction via `copyBufferToBuffer` would require **two ring buffers of equal size** (2× GPU memory) because same-buffer copies with overlapping ranges are a WebGPU validation error, and chunks typically move by less than their own size during compaction (= overlapping ranges in the common case).

At the current 2 GB ring buffer target, a second 2 GB staging buffer would push total GPU storage to 4+ GB — refused by most adapters. Additionally, after compaction, every moved slot's `pointStrideOffset` in the `chunkUniform` array must be updated, and the depth bind group must be rebuilt.

The IDB cache neutralises the cost of defrag eviction: re-decoding an evicted chunk is ~56 ms WASM (zero network bytes). Compaction can be revisited if telemetry shows unacceptable eviction churn.

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

## `getAvailableCount()` — back-pressure denominator

The engine's `setRingBufferProvider()` reads `slotsFree` to throttle dispatch. With variable-size slots, "slot count" is meaningless; `getAvailableCount()` instead returns an estimate:

```
(evictableBytes + totalFreeBytes) / avgChunkBytes()
```

**Self-tuning average**: `avgChunkBytes()` is a running average of actual allocation sizes. Cold-start fallback: `DEFAULT_MAX_CHUNK_BYTES = 800 KB`. For raw LAZ (all chunks same size), this converges to the exact chunk size within 2–3 allocations.

The estimate is conservative (underestimates for small-chunk files) which is safe — the deferred queue and proactive eviction absorb any estimation error.

## Open questions

- [ ] Monitor `metrics().fragmentationRatio` and defrag eviction count in production. If high for real-world COPC workloads, evaluate buddy allocator (bounded internal fragmentation, no compaction needed).

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

- **Per-frame CPU encoding cost** — resolved by 2D mega-dispatch (2026-05-20). One `setBindGroup + dispatchWorkgroups` per frame regardless of slot count.
- **Deferred queue overflow** is more frequent at high slot counts. `MAX_DEFERRED_CHUNKS` raised to 256 (was 64 at 374-slot calibration); absorbs most fast-pan drop cascades at 3000+ slots.
- **Memory pressure**: 2 GB ring buffer + 512 MB IDB cache + ~150 MB workers + JS heap ≈ 3 GB+ total. Integrated GPUs or memory-constrained tabs may struggle.

For higher buffer sizes without hitting these caveats, see Phase 5 indirect dispatch in [[Back-Pressure Invariants]].

---

## See also

- [[Renderer]] — owns the ring buffer; updates `lastRenderedFrame`
- [[Decoder Workers]] — produces decoded buffers written into the ring
- [[WebGPU Compute]] — binds the ring buffer as a compute shader input
- [[Spatial Index]] — provides visible chunk set for eviction guard
- [[Back-Pressure Invariants]] — invariants that keep the ring buffer from overflowing
