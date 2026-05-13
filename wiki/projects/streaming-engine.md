---
title: Streaming Engine
type: project
status: active
updated: 2026-05-12
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
this.workerCount = workerCount ?? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1))
```

Capped at 4 to match HTTP/1.1 connection limits for R2 (see [[Decoder Workers]]). The same cap is applied independently in `WorkerPool` so both agree.

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

## Phase 3 responsibilities (planned)

1. HTTP/2 fetch coalescing: merge adjacent chunk byte ranges into 2–4 MB batches.
2. Batch size adapts dynamically to measured network throughput.
3. Back-pressure: pause scheduling when worker queue is saturated.
4. Check [[Chunk Caching]] before issuing a network request.
5. Move fetch to main thread (Option B model) so ranges can be coalesced across chunks.
6. AbortController threading through all fetch calls (loading a new URL while streaming must cancel the previous engine).

---

## Constraints

- NEVER load entire file into memory — stream response bodies chunk-by-chunk.
- NEVER block the main thread — all fetch scheduling is async/event-driven.
- ALWAYS validate URL scheme before fetching.
- ALWAYS include `cache: 'no-store'` on all fetch calls (COOP/COEP — see [[HTTP/2 Range Requests]]).

---

## Open questions

- [ ] How to handle HTTP 206 vs 200 responses from origins that ignore range headers?
- [ ] AbortController: Phase 1/2 have no cancellation — loading a new URL while streaming lets the old engine run. Phase 3 must thread AbortController through all fetch calls.
- [ ] Frustum culling integration: currently `updateCamera()` uses inverse distance only; connect to [[Spatial Index]] for true frustum culling in Phase 3.

---

## See also

- [[Manifest Loader]] — drives manifest loading; emits seed points and chunk descriptors
- [[HTTP/2 Range Requests]] — coalescing details; R2 probe fix
- [[Decoder Workers]] — downstream consumer (Phase 2)
- [[Chunk Caching]] — cache-check before fetch (Phase 2)
- [[Spatial Index]] — drives chunk priority (Phase 2)
- [[LidarScout Chunk-Seed]] — first-pass seeding priority
