---
title: Streaming Engine
type: project
status: active
updated: 2026-05-18
tags: [streaming, http2, range-request, back-pressure, scheduling, events, workers, priority]
---

# Streaming Engine

Pipeline orchestrator: `[[Manifest Loader]] → Streaming Engine → [[Decoder Workers]] → [[Renderer]]`.

In Phase 1, `StreamingEngine` (`src/engine/streaming-engine.ts`) is the top-level pipeline coordinator. It drives the manifest loading sequence and delivers seed points to the renderer via callbacks. Phase 2 adds worker pool initialisation, camera-driven chunk prioritisation, and a progressive decode loop.

---

## Phase 1 role

`StreamingEngine` in Phase 1 owns the entire pipeline from URL input to rendered seed points:

1. Accepts a URL string.
2. Calls `validateSourceUrl()` → `probeUrl()` → `fetchAndParseLasHeader()` → `fetchChunkTable()` → `fetchSeedPoints()`.
3. Communicates state and results exclusively via registered callbacks — it knows nothing about the renderer or the DOM.

### Events-based API (SDK boundary)

```typescript
engine.onStateChange = (state) => { /* 'idle' | 'loading' | 'ready' | 'error' */ }
engine.onSeedsReady  = (seeds) => { renderer.loadSeedPoints(seeds) }
engine.onProgress    = (pct)   => { updateProgressBar(pct) }
engine.onStats       = (stats) => { showStats(stats) }
engine.onError       = (err)   => { showError(err.message) }
```

This is the `@lazstream/core` SDK boundary — the UI layer registers callbacks; the engine emits events; neither knows about the other.

---

## Phase 2 role (implemented — Track A)

Phase 2 extends the `load()` method with a second pipeline stage after seeds are delivered:

```typescript
// Phase 1 pipeline (unchanged):
URL → probe → header → chunk table → seed points → onSeedsReady

// Phase 2 additions:
seed points → ChunkPrioritiser → WorkerPool.init() → onChunkDecoded (per chunk)
```

### New load states

```typescript
type LoadState = 'idle' | 'probing' | 'header' | 'chunk-table' | 'seeds'
               | 'workers-init'   // ← Phase 2: initialising worker pool
               | 'streaming'      // ← Phase 2: workers decoding
               | 'ready' | 'error'
```

### Worker count

```typescript
this.workerCount = workerCount ?? Math.min(32, Math.max(1, navigator.hardwareConcurrency - 1))
```

Capped at 32. With Option B fetch model (Phase 3 Track A Step 3), workers are pure WASM decoders — no longer limited by HTTP/1.1 connection count. The main-thread fetch loop is now the load-bearing concurrency control. See [[Decoder Workers]].

### Camera-driven decode: `updateCamera()`

```typescript
engine.updateCamera(cameraWorldX, cameraWorldY, cameraWorldZ)
```

Call every frame from the render loop. The engine asks `ChunkPrioritiser` to rank undecoded chunks by inverse distance to camera, then submits the top `maxQueuedChunks` (default 16) to the worker pool. The pool deduplicates — safe to call every frame.

### Decode-all shortcut: `decodeAll()`

```typescript
engine.decodeAll()
```

Submits every chunk regardless of camera position. Used in Phase 2 validation to trigger full decode after seeds are ready, before the camera-driven loop is connected.

### Scene centre

The engine computes the centroid of all seed points and passes it to `ChunkPrioritiser`. The renderer's `getSceneCenter()` exposes it so the renderer can use the same coordinate origin.

---

## Phase 3 Track C — Complete

Camera and frustum providers wired. Spatial index built from seed points after manifest stage. `updateCamera()` is now argless — it queries providers internally each tick. `prioritise()` uses 3D frustum culling + SSE threshold to gate which chunks are submitted to the worker pool.

Provider pattern keeps the engine renderer-agnostic — no Three.js or WebGPU types imported:

```typescript
engine.setCameraProvider(() => renderer.getCameraWorldPosition())
engine.setFrustumProvider(() => renderer.getFrustumWorldBBox3D())
```

---

## Phase 3 Track A — Complete (2026-05-18)

Six steps shipped. The streaming engine is now fully production-capable for Melbourne-scale files (7073 chunks, 353M points).

### Step 1 — `workersConfigured` race fix

Added `private workersConfigured = false` flag. `updateCamera()` guards on it:

```typescript
if (!this.prioritiser || !this.workerPool || !this.workersConfigured) return
```

Eliminates the ~300+ `dispatch called before configure() — skipping` warnings observed in Track C when seeds arrive and the frame loop starts before worker init completes.

### Step 2 — AbortController cancellation

Every `load()` call:
1. Aborts the previous `AbortController` (cancels all in-flight fetches from prior load).
2. Calls `workerPool.dispose()` to terminate prior workers.
3. Creates a fresh `AbortController` for this load.

The `signal` flows through every `fetch()` call in the engine and in `WorkerPool`. Loading a new URL while streaming now cleanly cancels the previous load.

### Step 3 — Option B fetch model

Fetch moves from workers to the main thread. Workers now receive pre-fetched compressed bytes via `requestDecode(chunkIndex, chunk, compressedBytes)`. See [[Decoder Workers]] for the Option B architecture.

This decouples worker count (CPU/WASM parallelism) from fetch concurrency — enabling independent tuning. `maxFetches = workerCount × 2` is the main-thread concurrent fetch cap.

New engine field: `fetching: Set<number>` tracks chunks currently being fetched on the main thread. Replaced (not cleared) on each load to avoid cross-load leaks.

### Step 4 — HTTP/2 range coalescing

`dispatchCandidates` coalesces the cache miss list using `coalesce()` from `src/network/batch-fetcher.ts`:

```typescript
const batches = coalesce(misses)
await Promise.all(batches.map((batch) => this.fetchAndDispatchBatch(...)))
```

`coalesce()` sorts candidates by byte offset and merges adjacent or near-adjacent chunks (gap < 64 KB) into batches targeting 2–4 MB. On HTTP/2 (`data.lazstream.stream`), this drops request count from N chunks to ~N/3 batches with no latency penalty. See [[HTTP/2 Range Requests]].

### Step 5 — IndexedDB cache

Before fetching, `dispatchCandidates` runs parallel cache lookups:

```typescript
const lookups = await Promise.all(candidates.map(async (c) => ({
  ...c,
  cached: await cache.get(makeCacheKey(url, c.chunkIndex, c.chunk.offset)),
})))
```

Cache hits go straight to `pool.requestDecode()` with cached bytes — worker still decodes (cache stores compressed). Misses enter the coalesce + fetch path. After fetch, bytes are written to cache fire-and-forget before transfer to the worker. See [[Chunk Caching]].

Cache is optional: `new StreamingEngine(events, workerCount, cache?)`. Omitting cache disables it cleanly.

### Step 6 — Ring-buffer-aware back-pressure

`setRingBufferProvider(provider)` lets the renderer register a live slot-count callback:

```typescript
engine.setRingBufferProvider(() => renderer.getRingBufferStats())
// → { slotsFree: number; slotsTotal: number }
```

`updateCamera()` subtracts in-flight work from free slots before asking the prioritiser for candidates:

```typescript
const ringFree = this.ringBufferProvider().slotsFree
const inFlight = this.fetching.size + this.workerPool.queueLength + this.workerPool.activeCount
const ringSlots = Math.max(0, ringFree - inFlight)
const slots = Math.min(ringSlots, fetchSlots)
if (slots <= 0) return
```

This prevents the "all slots visible → can't evict → cascade of dropped chunks" observed at Melbourne overview zoom in Track B. See [[Back-Pressure Invariants]].

### `dispatchCandidates` — the full pipeline

Snapshot of all closure dependencies at entry (url, signal, pool, fetchingSet, cache) so a concurrent `load()` replacing engine state doesn't corrupt in-flight dispatches. All claims to `fetching` set are made synchronously before the first `await`, preventing double-dispatch on concurrent frame ticks.

```
updateCamera()
  → ringSlot + fetchSlot budget
  → prioritise() → ranked candidates
  → sync filter (skip fetching + known to pool)
  → claim candidates in this.fetching
  → void dispatchCandidates(candidates)
      → parallel cache lookups
      → cache hits → pool.requestDecode()
      → misses → coalesce() → parallel batch fetches
          → fetchAndDispatchBatch()
              → fetchRange() → buffer
              → slice per-chunk
              → cache.set() (fire-and-forget)
              → pool.requestDecode(bytes)
              → fetching.delete()
```

---

## Constraints

- NEVER load entire file into memory — stream response bodies chunk-by-chunk.
- NEVER block the main thread — all fetch scheduling is async/event-driven.
- ALWAYS validate URL scheme before fetching.
- ALWAYS include `cache: 'no-store'` on all fetch calls (COOP/COEP — see [[HTTP/2 Range Requests]]).

---

## Open questions

- [ ] How to handle HTTP 206 vs 200 responses from origins that ignore range headers?
- [ ] Step 7 (future): retune worker count independently of fetch concurrency now that the two are decoupled.

---

## See also

- [[Manifest Loader]] — drives manifest loading; emits seed points and chunk descriptors
- [[HTTP/2 Range Requests]] — coalescing details; R2 probe fix
- [[Decoder Workers]] — downstream consumer (Phase 2)
- [[Chunk Caching]] — cache-check before fetch (Phase 2)
- [[Spatial Index]] — drives chunk priority (Phase 2)
- [[LidarScout Chunk-Seed]] — first-pass seeding priority
