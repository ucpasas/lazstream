# log — lazstream

Append-only. See [[WIKI_SCHEMA]] for entry format. Never edit existing entries.

---

## 2026-05-10 — Phase 1 ingestion

- Ingested: lazstream-phase1-wiki.md (Phase 1 session summary)
- Created: [[Phase 1 — Core Streaming and Seed Overview]], [[Arithmetic Decoder]]
- Updated: [[LAZ Format]], [[LidarScout Chunk-Seed]], [[HTTP/2 Range Requests]], [[Manifest Loader]], [[Streaming Engine]], [[Renderer]], [[index.md]]
- Key finding: Chunk table is arithmetically coded (not raw uint64); seed point prefix is controlled by `chunkSize === 0`, not PDRF version; R2 r2.dev omits Accept-Ranges on HEAD — must probe with an actual range request.

---

## 2026-05-12 — Phase 2 Track A ingestion

- Ingested: phase2-track-a-session-notes.md (Track A complete session summary)
- Created: [[laz-perf Worker Porting]]
- Updated: [[Decoder Workers]] (draft → active, full Track A implementation), [[Streaming Engine]] (Phase 2 role documented), [[Renderer]] (validation renderer + Track A result), [[index.md]] (phase status, new concept row)
- Key finding: npm `laz-perf@0.0.7` cannot be used in any worker (hardcoded `ENVIRONMENT_IS_WORKER=false`); Vite dev always produces module workers regardless of `worker.format`; `?url` imports are stripped when used inside workers via dynamic import — use `window.location.origin` instead; named re-export `export { createLazPerf as default }` required (value export `export default` returns undefined); `locateFile` override mandatory for WASM path resolution.

---

## 2026-05-13 — Phase 2 Track B ingestion

- Ingested: Track B session (WebGPU compute renderer implementation + integration)
- Updated: [[Renderer]] (Track B complete), [[WebGPU Compute]] (draft → active, implementation details), [[Ring Buffer GPU Memory]] (draft → active, implementation details), [[Decoder Workers]] (global Z colour fix)
- Key findings: Three.js WebGPURenderer/TSL not used — raw WebGPU device + canvas context only; storage buffer atomics used instead of texture_atomic (better cross-vendor support); per-chunk colour normalisation caused block artifacts at chunk boundaries — fixed by passing global minZ/maxZ from LAS header to workers; Melbourne 2018 (353M pts, 2.93 GB) crashes main thread at decodeAll() scale — Phase 3 back-pressure required; R2 r2.dev is HTTP/1.1 only — HTTP/2 requires custom domain.

---

## 2026-05-16 — Phase 3 Track C + chunk-table decoder canonical alignment

- Ingested: track-c-and-decoder-saga.md (Track C implementation + four-round decoder debugging saga)
- Created: [[Chunk-Table Decoder Saga]]
- Updated: [[Spatial Index]] (draft → active, full Track C implementation), [[Streaming Engine]] (Track C wiring: argless updateCamera, provider callbacks, Phase 3 Track A responsibilities), [[Renderer]] (frustum extraction API, ring buffer fragmentation note), [[Decoder Workers]] (worker count cap retention note), [[Manifest Loader]] (decoder production-correct note), [[Arithmetic Decoder]] (major rewrite — canonical C++ alignment, correct table sizing, pre-increment fill, lastSymbol guard, k=0 bit consumption), [[LAZ Format]] (Discovery 1 postscript), [[LidarScout Chunk-Seed]] (Melbourne 2018 validation table), [[HTTP/2 Range Requests]] (data.lazstream.stream confirmed HTTP/2 live, r2.dev to legacy), [[index.md]] (phase status, Chunk-Table Decoder Saga row, updated dates)
- Key findings:
  - 3D rbush via `rbush-3d@0.0.4` chosen over 2D or custom subclass — TLS/façade data breaks 2D culling; custom subclass doesn't change algorithmic dimensionality
  - SSE threshold = 1.0 documented as deliberate constraint: plain LAZ has binary LOD only; no middle ground between seed and full decode
  - Provider pattern (setCameraProvider / setFrustumProvider) keeps StreamingEngine renderer-agnostic; renderer registers callbacks at startup
  - Custom Cloudflare domain `data.lazstream.stream` confirmed HTTP/2 live; r2.dev relegated to legacy Phase 1 reference
  - Chunk-table decoder required four rounds of bug-fixing to match canonical LASzip C++: (1) decodeSymbol two-entry table lookup + lastSymbol guard, (2) ArithmeticModel table sizing formula + pre-increment fill semantics, (3) Uint32 accumulation for >2^31 cumulative offsets, (4) readCorrector k=0 bit consumption — all four required reading canonical C++ source directly; Texas's 380 entries masked all four bugs
  - Ring buffer first-fit fragmentation caps Melbourne at ~447 decoded chunks (~22.35M points); resolution requires Track A back-pressure + Track B v2 compaction

---

## 2026-05-18 — Phase 3 Track A complete + Option B fetch model + IDB cache

- Ingested: Phase 3 Track A completion session (Steps 1–6)
- Created: [[Back-Pressure Invariants]]
- Updated: [[Streaming Engine]] (Track A complete: workersConfigured race fix, AbortController, Option B fetch, coalescing, IDB cache, ring-buffer back-pressure), [[Decoder Workers]] (Option B: workers decode only, main thread fetches; isKnown(); configure() no longer takes URL; worker count cap 4→32), [[Chunk Caching]] (draft → active: FNV-1a cache keys, compressed-bytes storage, 512 MB budget, LRU eviction, QuotaExceededError retry), [[index.md]]
- Key findings:
  - **Option B decouples fetch and decode concurrency**. Workers are now pure WASM consumers; main-thread fetch concurrency is `workerCount × 2` via the `fetching: Set<number>` claim-before-await pattern.
  - **`isKnown()` covers all three pool states**. `isInFlight()` alone missed queued chunks — re-fetches were occurring for chunks already waiting for a worker slot.
  - **Synchronous claim before first `await`** prevents duplicate dispatches on concurrent frame ticks. The engine adds to `this.fetching` before any async boundary in `dispatchCandidates()`.
  - **Cache stores compressed bytes (not decoded)**: 3× more entries in the same budget; structured-clone cost 3× lower; worker decode code path identical for cached and fetched bytes.
  - **`bytes.slice(0)` required before Transferable transfer**: `pool.requestDecode` detaches the original buffer; cache must receive a separate copy.
  - **Ring-buffer back-pressure (Step 6)**: the cascade observed at Melbourne overview zoom is caused by dispatching into a full buffer while N chunks are already mid-flight. Subtracting `fetching.size + queueLength + activeCount` from `slotsFree` before dispatching eliminates the cascade.

---

## 2026-05-19 — buffer expansion + camera-framing refinements

- Ingested: post-Track-A polish session covering seed fetch parallelism, ring buffer scale-up, persistent seed overview, and header-driven camera framing
- Updated: [[HTTP/2 Range Requests]] (seed BATCH_SIZE 6→100), [[Ring Buffer GPU Memory]] (2 GB default, configurable target, MAX_RING_BUFFER_BYTES ceiling, ?bufferMB URL param), [[Renderer]] (loadSeedPoints accepts LAS header, persistent seed overview, 30° initial elevation, CAMERA_INITIAL_ELEVATION_DEG/CAMERA_INITIAL_DISTANCE_MULT constants), [[index.md]]
- Key findings:
  - **Seed fetch was bottlenecked by HTTP/1.1-era BATCH_SIZE=6**. On HTTP/2 (`data.lazstream.stream`), the browser multiplexes ~100 streams over a single connection. Melbourne's 7073 seeds at batch 6 = ~5 s; at batch 100 = <1 s. One-line change.
  - **Ring buffer is configurable via `requiredLimits` negotiation**. Default `maxStorageBufferBindingSize` in WebGPU is 128 MB; discrete GPUs advertise up to 2+ GB in `adapter.limits`. Negotiation: read `adapter.limits.maxStorageBufferBindingSize`, request that as a `requiredLimit` on `requestDevice`, catch and fall back to default device on rejection. On RTX-class GPU, 2 GB granted cleanly → ~2995 slots → ~150M points simultaneously.
  - **Hard ceiling is MAX_SLOTS × slotBytes = 4096 × 700 KB = ~2.87 GB**. Beyond this, the uniform pool runs out before the ring buffer. `webgpu-context.ts` clamps with a warning. To exceed, bump MAX_SLOTS in `webgpu-renderer.ts` first.
  - **At 3000 slots, per-frame CPU encoding becomes the new bottleneck** — `setBindGroup + dispatchWorkgroups` per slot × 3000 = ~15 ms encoding cost alone. Observed: `requestAnimationFrame handler took 72ms` warnings during heavy slot churn. Indirect dispatch is the proper future fix; scoped as Phase 5 deferred work.
  - **Deferred queue overflow proportional to buffer size**. At 374 slots, MAX_DEFERRED_CHUNKS=64 was generous; at 2995 slots, the same value gets overwhelmed during fast camera movement (250+ chunks lost in one observation). Bump candidate: 256.
  - **LAS header bbox vs seed bbox for camera framing**: seeds are sampled (~7000 of millions of points); the header bbox is authoritative for every point. New code uses header bbox with proper trig at the configured elevation angle. The previous code used the literal vector `(0, -0.6, 0.7)`, which is 49.4° elevation and a non-unit vector.
  - **Persistent seed overview**: `SEED_HIDE_THRESHOLD = Infinity` keeps the seed pseudo-chunk always visible. Cost is one extra slot + ~7000 points per frame (trivial).
  - **WebGPUContext interface contract**: reference `webgpu-context.ts` initially used wrong field names (`format` instead of `canvasFormat`, missing `canvas`). Renderer threw `Required member is undefined` during render pipeline creation. Mitigation: grep consumer field accesses (`ctx.`) before writing the producer.

---

## 2026-05-09 — Initial wiki scaffold

- Created: [[WIKI_SCHEMA]], [[index.md]]
- Created projects: [[Manifest Loader]], [[Streaming Engine]], [[Decoder Workers]], [[Renderer]], [[Chunk Caching]], [[Spatial Index]]
- Created concepts: [[LAZ Format]], [[WebGPU Compute]], [[HTTP/2 Range Requests]], [[LidarScout Chunk-Seed]], [[Ring Buffer GPU Memory]]
- Key finding: Wiki bootstrapped from CLAUDE.md project context; all pages are `status: draft` pending source ingestion.
