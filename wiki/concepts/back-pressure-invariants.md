---
title: Back-Pressure Invariants
type: concept
status: active
updated: 2026-05-18
tags: [back-pressure, ring-buffer, lru, eviction, frame-coherence, visibility, scheduling]
---

# Back-Pressure Invariants

lazstream's streaming pipeline is bounded by a fixed-size GPU ring buffer. The back-pressure system keeps the pipeline from overflowing that buffer, and the invariants below ensure all components that touch buffer occupancy share consistent semantics.

---

## The cascade without back-pressure

At Melbourne scale (7073 chunks, 353M points), without back-pressure:

1. Camera moves to overview position.
2. `updateCamera()` asks prioritiser for top-N chunks → N is uncapped.
3. Engine dispatches N fetches → N worker decodes → N `addDecodedChunk()` calls.
4. Ring buffer fills; all slots are `lastRenderedFrame == currentFrame` (all visible).
5. `allocate()` calls `findLRUEvictable()` → no evictable slot (all visible) → returns `null`.
6. `addDecodedChunk()` silently drops the chunk.
7. Meanwhile, N more fetches are already in-flight — they will all drop too.

Result: dozens of wasted network requests and decode cycles, with 0 additional points on screen. Observed as `[webgpu] ring buffer can't fit chunk N — dropped` cascades.

---

## The fix: ring-buffer-aware back-pressure (Step 6)

`StreamingEngine.updateCamera()` computes an available-slot budget before dispatching:

```typescript
const ringFree = this.ringBufferProvider().slotsFree
const inFlight = this.fetching.size           // chunks being fetched
               + this.workerPool.queueLength  // chunks waiting for a worker
               + this.workerPool.activeCount  // chunks being decoded
const ringSlots = Math.max(0, ringFree - inFlight)
const slots = Math.min(ringSlots, fetchSlots)
if (slots <= 0) return
```

`inFlight` subtraction is critical: without it, the engine dispatches 8 chunks into a buffer that's about to receive 5 already mid-flight — the cascade reappears.

---

## `lastRenderedFrame` — the shared invariant

All visibility-related decisions use one field: `Slot.lastRenderedFrame`.

| Component | Role |
|-----------|------|
| `WebGPURenderer.renderFrame()` | Calls `allocator.touch(chunkIndex, currentFrame)` for every dispatched slot |
| `RingBufferAllocator.findLRUEvictable()` | Refuses to evict slots where `lastRenderedFrame >= currentFrame` |
| `WebGPURenderer.addDecodedChunk()` | Calls `allocator.getFreeSlotCount()` which counts slots with `lastRenderedFrame < currentFrame` |
| `StreamingEngine.setRingBufferProvider()` | Reads `slotsFree` via the provider — same `getFreeSlotCount()` |

**One frame = one consistent snapshot.** A slot touched in frame N is protected until frame N+1. The engine's budget calculation in the same frame sees the slot as occupied — no double-booking.

---

## Eviction coherence

```
Frame N:
  renderFrame():
    for each slot s:
      dispatchWorkgroups(s)
      allocator.touch(s.chunkIndex, N)   // lastRenderedFrame = N

  engine.updateCamera() [called same frame]:
    ringFree = allocator.getFreeSlotCount()
    //   getFreeSlotCount() = slots where lastRenderedFrame < N
    //   ↑ excludes all slots rendered this frame
    //   Safe: engine won't dispatch into slots about to be evicted

Frame N+1:
  If camera moved away from some chunk → it won't be dispatched → lastRenderedFrame stays N
  allocator.findLRUEvictable() → that slot is now evictable (N < N+1)
  allocator.allocate() can reuse it for a new chunk
```

---

## Deferred queue

When `allocate()` returns `null` (truly no evictable slot — all currently visible), `addDecodedChunk()` pushes to a `deferredQueue: DecodedChunk[]` capped at `MAX_DEFERRED_CHUNKS` (current value: 256).

On the next frame, if any slot becomes evictable, the oldest deferred chunk is retried. This absorbs momentary full-buffer conditions during fast camera movement without dropping chunks.

At 3000+ slots (2 GB buffer), fast camera movement can generate 250+ dropped chunks in one observation. 256 absorbs most cases; was raised from 64 (the 374-slot calibration) once large-buffer operation was confirmed.

---

## Seed pseudo-chunk invariant

The seed pseudo-chunk (`chunkIndex = -1`, `SEED_HIDE_THRESHOLD = Infinity`) is always allocated and always touched every frame (`lastRenderedFrame = currentFrame` always). It is therefore **never LRU-evictable** by normal eviction. Its AABB spans the full file bbox — it always passes cull — so it is always dispatched.

This is the intended behaviour: the seed overview is always-resident. To make seeds evictable, explicitly skip `chunkIndex === -1` in `findLRUEvictableIndex()`.

---

## Proactive eviction (2026-05-20)

Slots are freed eagerly rather than only under allocation pressure.

```typescript
// After cull+touch, before flushDeferredChunks — every frame:
private evictInvisibleSlots(): void {
  const threshold = this.currentFrame - EVICT_GRACE_FRAMES  // 5 frames
  for (const slot of this.slots.getSlots()) {
    if (slot.chunkIndex === SEED_PSEUDO_CHUNK_INDEX) continue  // seeds never evicted
    if (slot.lastRenderedFrame < threshold) {
      this.releaseSlot(slot.chunkIndex)
      if (slot.everRendered) this.chunkEvictedCallback?.(slot.chunkIndex)
    }
  }
}
```

**Invariant 5 — Proactive eviction grace:** A slot touched `EVICT_GRACE_FRAMES` or fewer frames ago is not proactively evicted. This absorbs fast pans without churning chunks that briefly leave and re-enter the frustum.

**Invariant 6 — Phantom chunk silence:** `chunkEvictedCallback` is only called when `slot.everRendered === true`. Phantom chunks (pass AABB cull, fail exact 6-plane renderer test) are silently released without re-queueing. Calling the callback for phantoms causes an infinite oscillation: evict → engine re-queues → decode → same frustum failure → repeat.

**Invariant 7 — Three-set clearance on eviction:** GPU eviction must remove the chunk from three independent sets: `RingBufferAllocator` (slot freed), `ChunkPrioritiser.decoded` (re-enables for re-queuing), and `WorkerPool.completed` (clears `isKnown()` check). Missing any one permanently orphans the chunk — it can never be re-fetched in the current session.

**Invariant 8 — Deferred drop parity:** A chunk dropped from `deferredChunks` due to capacity overflow must also call `chunkEvictedCallback` (when `everRendered` applies). Deferred chunks are in `prioritiser.decoded` and `workerPool.completed` but never in a GPU slot — GPU eviction never reaches them, so the drop path is the only opportunity to clear them.

---

## Summary of invariants

1. **Touch before eviction check**: `renderFrame()` calls `touch()` for every slot it dispatches, in the same frame as the budget check. No slot rendered this frame can be evicted this frame.
2. **In-flight subtraction**: The engine subtracts `fetching + queue + active` from `slotsFree` before dispatching. A "free" slot isn't truly available if a chunk is mid-flight to fill it.
3. **`isKnown()` before fetch**: `WorkerPool.isKnown(chunkIndex)` covers completed + inFlight + queued. The engine checks this before adding to `fetching`, preventing both re-fetches and re-queues.
4. **Synchronous claim**: Engine claims chunks in `this.fetching` synchronously before the first `await` in `dispatchCandidates()`. Concurrent `updateCamera()` calls in subsequent frames see these chunks as taken.
9. **Pipeline-dry override**: When `(queueLength + activeCount) < effectiveCapacity` (workers about to go idle), the engine ignores `ringSlots` and uses `fetchSlots` directly. `ringSlots` is over-conservative at tail-end — in-flight work makes the buffer appear committed when it isn't yet. Ring buffer LRU eviction and the deferred queue absorb any landing-time overflow safely. `effectiveCapacity = min(workerCount, hardwareConcurrency - 1)` — using raw `workerCount` (e.g. 100) on a 16-core machine caused this to fire on every tick, defeating the Step-6 cascade fix for the entire load.

---

## See also

- [[Ring Buffer GPU Memory]] — slot allocator, `lastRenderedFrame`, eviction algorithm
- [[Renderer]] — `touch()` call in `renderFrame()`; deferred queue
- [[Streaming Engine]] — Step 6 ring-buffer provider; `fetching` set; budget calculation
