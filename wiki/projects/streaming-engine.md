---
title: Streaming Engine
type: project
status: active
updated: 2026-05-10
tags: [streaming, http2, range-request, back-pressure, scheduling, events]
---

# Streaming Engine

Pipeline orchestrator: `[[Manifest Loader]] → Streaming Engine → [[Decoder Workers]] → [[Renderer]]`.

In Phase 1, `StreamingEngine` (`src/engine/streaming-engine.ts`) is the top-level pipeline coordinator. It drives the manifest loading sequence and delivers seed points to the renderer via callbacks. In Phase 2 it will add chunk scheduling, batching, and worker dispatch.

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

## Phase 2 responsibilities (planned)

1. Accept a prioritised queue of chunk descriptors (priority driven by [[Spatial Index]] frustum culling).
2. Coalesce adjacent or nearby chunk byte ranges into 2–4 MB batches to amortise HTTP/2 overhead.
3. Issue range requests and stream response bodies without buffering the entire batch.
4. Apply back-pressure: pause fetching when the decoder worker queue is full.
5. Check [[Chunk Caching]] before issuing a network request — serve from IndexedDB if present.
6. Report byte-level progress for UI bandwidth indicators.

---

## Batching strategy (Phase 2)

- Target batch size: 2–4 MB.
- Merge chunks if gap between them < 64 KB.
- Maximum chunks per batch: configurable, default 32.
- Priority order: frustum-visible chunks first (from [[Spatial Index]]), then LidarScout seed chunks.

---

## Back-pressure (Phase 2)

- Decoder worker pool exposes a `capacity` signal (available worker slots).
- Streaming engine pauses scheduling when `capacity === 0`.
- Resume on `workerAvailable` event.
- Never drop chunks — pause, do not discard.

---

## Constraints

- NEVER load entire file into memory — stream response bodies chunk-by-chunk.
- NEVER block the main thread — all fetch scheduling is async/event-driven.
- ALWAYS validate URL scheme before fetching.
- ALWAYS include `cache: 'no-store'` on all fetch calls (COOP/COEP — see [[HTTP/2 Range Requests]]).

---

## Open questions

- [ ] How to handle HTTP 206 vs 200 responses from origins that ignore range headers?
- [ ] Should batch size adapt dynamically to measured network throughput?
- [ ] AbortController: Phase 1 has no cancellation — loading a new URL while seeds fetch lets the old engine run. Phase 2 must thread AbortController through all fetch calls.

---

## See also

- [[Manifest Loader]] — drives manifest loading; emits seed points and chunk descriptors
- [[HTTP/2 Range Requests]] — coalescing details; R2 probe fix
- [[Decoder Workers]] — downstream consumer (Phase 2)
- [[Chunk Caching]] — cache-check before fetch (Phase 2)
- [[Spatial Index]] — drives chunk priority (Phase 2)
- [[LidarScout Chunk-Seed]] — first-pass seeding priority
