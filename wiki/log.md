# log — lazstream

Append-only. See [[WIKI_SCHEMA]] for entry format. Never edit existing entries.

---

## 2026-05-23 — SDK plan revised for manifest-aware API

- Updated: [[SDK]]
- Key decisions:
  - **`ManifestSession` is now the primary `@lazstream/core` entry point**, not `StreamingEngine` directly. Single-file loads go through `urlToManifest()` + `ManifestSession` — one code path for both cases.
  - **`LazstreamViewer.load()` accepts `string | Manifest`**: bare `.laz` URL, `.lazm.json` URL (auto-detected by extension), or a pre-parsed `Manifest` object for consumers that manage their own fetch/validation.
  - **`ManifestSessionOptions` will gain the clean `Omit<StreamingEngineOptions, 'events'>` form** once Step 5 (options object constructor for `StreamingEngine`) ships. The intermediate hand-listed fields in the current implementation are a temporary stand-in.
  - **Manifest types fully exported**: `Manifest`, `TileEntry`, `fetchManifest`, `parseManifest`, `urlToManifest`, `ManifestParseError`, `validateManifestUrl`, `EntryParam` all added to the public API surface in `index.ts`. `validateManifestUrl` exported because consumers building custom pipelines need the same security checks lazstream uses.
  - **Back-pressure guide updated for multi-tile**: eviction callback passes the global (offset-applied) `chunkIndex` back to `session.onChunkEvictedFromGPU` — routing to the correct tile engine is internal; consumers never see tile offsets.
  - **Step 9 `.engine` getter renamed to `.session`**: returns `ManifestSession` not `StreamingEngine`.

---

## 2026-05-23 — Multi-tile manifest format implemented

- Created: [[Manifest Session]], `wiki/concepts/manifest-format.md`
- Updated: [[Manifest Loader]] (new companion files section), [[Streaming Engine]] (`chunkCount` getter), [[index.md]]
- Key findings:
  - **`ManifestSession` is the new top-level coordinator.** `main.ts` no longer creates `StreamingEngine` directly; all load paths go through `ManifestSession`, which wraps bare `.laz` URLs in a synthetic one-tile manifest via `urlToManifest()`. Single-file behaviour is identical to before.
  - **Chunk index namespacing solves ring-buffer collisions across tiles.** Offsets are computed in `checkAllSettled()` after ALL tiles seed (using `engine.chunkCount`) and are stable before any `onChunkDecoded` can fire — the decode loop only starts after the combined `onSeedsReady` fires.
  - **`StreamingEngine` constructor takes positional args, not an options object.** The initial `manifest-session.ts` was written with a non-existent `StreamingEngineOptions` interface. Fixed to define `ManifestSessionOptions` explicitly and call `new StreamingEngine(events, workers, undefined, sseThreshold, maxFetches)`.
  - **GPU eviction routing belongs on the renderer, not the session.** `main.ts` now calls `renderer.setChunkEvictedCallback(idx => session.onChunkEvictedFromGPU(idx))`. The dead `setChunkEvictedCallback` / `chunkEvictedCallback` field was removed from `ManifestSession`.
  - **`validateManifestUrl` and `getEntryFromParams` added to url-validator.** Both use the same private `validateUrl(raw, endsWith, label)` helper to avoid duplication. `getUrlFromParams` kept as a deprecated alias.
  - **Tile failure is graceful.** `makeTileEvents().onError` converts engine errors into `onWarning` and continues; only if all tiles fail does `onError` fire.

---

## 2026-05-22 — COPC seed extraction: second correction (remove fetchLayeredSeeds routing)

The `compressor === 3 && chunkSize === 0` guard introduced in the previous fix was still too broad. The `chunkSize` field in the LAZ VLR can legitimately be 0 for non-COPC files written by tools that use 0 to mean "default chunk size" rather than the COPC sentinel `0xFFFFFFFF`. When such a file (e.g. `hilltop-2023-06-18-1-4.laz`) matched the condition, `fetchLayeredSeeds` generated 454 identical synthetic seeds at the file bounding-box centre. All seeds collapsed to a 1m³ box, visually invisible at scene-overview scale → "outlines don't appear" despite 454 chunks loading correctly.

Fix: `fetchLayeredSeeds` routing removed entirely from `fetchSeedPoints`. The original byte-read path now handles all compressor-3 files. COPC files (chunkSize=0) use `seedByteOffset = 4` (already handled by the existing `(chunkSize === 0) ? 4 : 0` expression) and most seeds fail the bounds check — 0 valid seeds, no overview. Acceptable: COPC overview is not a priority and was never working for real positions anyway. The `fetchLayeredSeeds` function is deleted (unused, TypeScript noUnusedLocals).

Also fixed: `worker.onerror` in `worker-pool.ts` now clears `inFlight` for the crashed chunk (prevents the pool stalling when laz-perf throws an uncatchable WASM exception on unsupported layered formats). Does NOT call `dispatchNext` — sending another job to a WASM-aborted worker creates a crash loop.

---

## 2026-05-22 — COPC / layered LAZ seed extraction fix

Root cause: for LAZ 1.4 layered-chunked format (compressor 3 — used by COPC and standard LAZ 1.4 PDRF 6-10), the first point is embedded inside compressed layer streams. There is no raw uncompressed XYZ at a fixed byte offset. The existing `fetchSeedPoints` code read raw bytes at `chunkOffset + 4`, got garbage, and the bounds check silently discarded all seeds → 0 seeds → 0 chunks dispatched → "0 chunks — 0 pts" in the UI despite the file loading.

A secondary issue: some writers set only the LAZ compression flag (0x80) in the PDRF byte at header byte 104, leaving the PDRF bits as zero. After the `& 0x7F` mask the result is 0, causing `isLayered = compressor === 3 && pdrf >= 6` to be `false` even for compressor 3 files.

**Changes — `src/engine/header-parser.ts`**:
- `parseLazVlrData` now accepts `recordLength` (from `lasHeader.pointDataRecordLength`)
- If `compressor === 3 && pdrf === 0`: derive effective PDRF from `recordLength` (30→6, 36→7, 38→8)
- `isLayered` changed from `compressor === 3 && pdrf >= 6` to `compressor === 3` (compressor field is authoritative; pdrf >= 6 was redundant since compressor 3 is only defined for PDRF 6-10)
- `fetchAndParseLasHeader`: syncs `header.pointDataRecordFormat` from `lazVlr` if they differ after VLR parse

**Changes — `src/engine/chunk-table.ts`**:
- `fetchSeedPoints`: adds `signal?: AbortSignal` parameter; short-circuits to `fetchLayeredSeeds` for `lazVlr.compressor === 3`
- `fetchLayeredSeeds` (new): for variable-chunk layered files (COPC, `chunkSize === 0`), reads the 4-byte point-count prefix from each chunk start and updates `ChunkTableEntry.pointCount` in place (fixes the 50 K default that would cause laz-perf to overrun compressed data); generates synthetic seeds at the file bounding-box centre so every chunk is visible from any camera. For fixed-chunk layered files, generates synthetic seeds only (point counts already correct from chunk table).

**Changes — `src/network/range-fetcher.ts`**:
- `fetchRange`: adds `signal?: AbortSignal` parameter
- `probeUrl`: adds `signal?: AbortSignal` parameter (both calls internally pass it through)

**Changes — `src/engine/streaming-engine.ts`**:
- Removed unused private `lazVlr` field (written but never read; local variable was used directly)
- Removed unused `LazVlr` type import

**Behaviour after fix**:
- COPC/layered files generate synthetic seeds at the bounding-box centre → all chunks loaded in dispatch order, no frustum-based priority
- Standard LAZ 1.2/1.3 files (compressor 2): unchanged path; seed extraction still works

**Open**: proper COPC support would parse the COPC hierarchy EVLR to get per-node bounding boxes (enabling frustum culling and spatial priority). Deferred — COPC is not a primary target.

---

## 2026-05-22 — Track B v2: variable-size free-list ring buffer allocator

- Updated: [[Ring Buffer GPU Memory]] (free-list design, defrag-by-eviction, GPU compaction decision, getAvailableCount denominator)
- Changed: `src/render/ring-buffer.ts` — complete rewrite from fixed-slot (700 KB/slot) to variable-size free-list allocator. Key changes:
  - Removed `slotsByIndex`, `freeStack`, `slotBytes`, `slotCount`, `DEFAULT_SLOT_BYTES`
  - Added `freeList: FreeRegion[]` (sorted, coalesced), `slots: Map<number, Slot>`, `allocCount`/`allocBytesTotal` for self-tuning denominator
  - `allocate()` now returns `AllocateResult | null` where `AllocateResult.slot` is nullable; `null` return reserved for permanent capacity overflow
  - `AllocateResult.evicted` populated even when `slot === null` (defrag ran partway before all slots became visible)
  - Added `avgChunkBytes()`, updated `getAvailableCount()`, updated `metrics()` (removed `slotBytes`/`slotCount`/`bytesWasted`, added `bytesFree`/`largestFreeGap`/`fragmentationRatio`/`avgChunkBytes`)
- Changed: `src/render/webgpu-renderer.ts` — minor updates:
  - `getRingBufferStatus()`: removed `metrics()` call; `slotsTotal` uses `this.slots.avgChunkBytes()`
  - `addPackedData()`: processes `result.evicted` in all cases (success + failure), calls `chunkEvictedCallback` for evictions with `everRendered === true` (fixes latent invariant-7 violation in allocate-time eviction path), adds defrag debug log
  - Removed unused `type Slot` import
  - Updated `flushDeferredChunks()` comment (break-on-first-failure now explained by exhausted-evictable-slots, not identical byteLength)
- Key findings:
  - **Memory waste eliminated**: 120 KB chunk now uses 120 KB (was 700 KB with fixed slots; 83% waste for 10K-point files)
  - **COPC unblocked**: 786 KB nodes fit without rejection (previous 700 KB slot limit rejected them)
  - **Latent bug fixed**: allocate-time LRU evictions previously didn't call `chunkEvictedCallback` → evicted chunks stayed in `prioritiser.decoded` + `workerPool.completed` and could never be re-fetched. Now all three sets are cleared for ALL eviction paths.
  - **Raw LAZ fragmentation = 0**: uniform chunk sizes mean every freed gap is exactly the size of the next incoming chunk; `firstFit` succeeds on the first try; defrag loop never fires.
  - **GPU compaction deferred**: same-buffer `copyBufferToBuffer` with overlapping ranges is a WebGPU validation error; the common compaction case (chunk moves by < its own length) is exactly the overlap scenario. Double-buffer compaction would cost 2× GPU memory. IDB cache makes defrag-by-eviction acceptable.
  - **Self-tuning denominator**: `getAvailableCount()` uses `avgChunkBytes()` (running average of actual allocations). Converges to exact chunk size within 2–3 allocations for uniform-chunk files.

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

## 2026-05-20 — 2D mega-dispatch: O(1) CPU encoder

- Updated: [[Renderer]] (2D mega-dispatch replaces per-slot loop), [[WebGPU Compute]] (bindings updated, dispatch model), [[index.md]]
- Key findings:
  - **Per-slot `setBindGroup + dispatchWorkgroups` is O(N) CPU encode cost.** At 374 visible slots this was barely perceptible; at 3000+ slots the wiki flagged ~15 ms/frame. Replacing with a single 2D dispatch collapses it to O(1): one `writeBuffer` (visible slot list, ~1.5 KB) + one `setBindGroup` + one `dispatchWorkgroups(maxWG, visibleCount, 1)`.
  - **Binding 1 changed from `uniform/hasDynamicOffset` to `storage, read` array.** Storage arrays don't need the 256-byte device alignment stride — chunk uniform write stride drops from 256 B to 32 B, saving 87.5% of `chunkUniform` buffer size (1 MB → 128 KB).
  - **`gid.y` is the slot index in the visible list; `gid.x` is the point index within the slot.** The shader reads `chunks[visibleSlots[gid.y]]` to find its per-chunk data. New binding 5 holds the visible slot list (`array<u32>`, MAX_SLOTS × 4 bytes = 16 KB).
  - **`maxWG` is tightened per-frame.** `Math.ceil(maxPointCount / 128)` where `maxPointCount` is the actual max across visible slots this frame — dispatch stays tight, no padding.
  - **Point density experiment explored and reverted.** Added `densityFraction` in camera uniform (`_pad1` repurposed) to render a fraction of each chunk's points. Conclusion: "mid-decode" vs "full-decode" appearance is a consequence of camera distance vs projected point density, not a separate render mode. At any distance, 100% of a chunk's points looks "solid" when points outnumber projected pixels. True LOD requires pre-tiled data (COPC); raw LAZ has binary LOD only (seed or full chunk).

---

## 2026-05-20 — Proactive eviction + phantom chunk oscillation fix

- Updated: [[Renderer]] (evictInvisibleSlots, EVICT_GRACE_FRAMES, everRendered), [[Ring Buffer GPU Memory]] (Slot interface, lastRenderedFrame init), [[Back-Pressure Invariants]] (proactive eviction invariant), [[Decoder Workers]] (markEvicted), [[index.md]]
- Key findings:
  - **Proactive eviction frees slots regardless of buffer pressure.** `evictInvisibleSlots()` called every frame after the cull+touch loop — any slot invisible for > EVICT_GRACE_FRAMES (5 frames ≈ 83 ms at 60 fps) is freed and the engine is notified via `chunkEvictedCallback`. This keeps the ring buffer populated with only what the camera can see.
  - **Three sets must be cleared on GPU eviction.** When a slot is proactively evicted: `RingBufferAllocator.remove()` clears the CPU slot, `ChunkPrioritiser.removeDecoded()` re-enables the chunk for re-queuing, and `WorkerPool.markEvicted()` clears it from `completed` so `isKnown()` doesn't block the next fetch. Missing any one of these permanently orphans the chunk.
  - **Deferred queue drops must also notify the engine.** A chunk dropped from `deferredChunks` (overflow beyond `MAX_DEFERRED_CHUNKS`) stays in `prioritiser.decoded` and `workerPool.completed` — never in a GPU slot — so GPU eviction never reaches it. Fix: dropped deferred chunks call `chunkEvictedCallback` directly.
  - **`lastRenderedFrame` must initialise to `currentFrame - 1`, not `-1`.** A slot initialised at -1 placed by `flushDeferredChunks` (after the render pass) has `lastRenderedFrame = -1`, which is always below the eviction threshold — the slot evicts on the very next frame, triggering an infinite decode/evict loop. Initialising to `currentFrame - 1` gives the slot the full `EVICT_GRACE_FRAMES` window.
  - **Phantom chunk oscillation fixed with `everRendered: boolean`.** "Phantom chunks" pass the engine's conservative AABB frustum dispatch but fail the renderer's exact 6-plane cull — `touch()` is never called. Without the guard, they evict after grace period → re-queue → re-decode → same failure → infinite oscillation (observed as slot count toggling 35↔36). Fix: `evictInvisibleSlots` only calls `chunkEvictedCallback` when `slot.everRendered === true`; phantoms are released silently.

---

## 2026-05-20 — pipeline timing instrumentation + COPC concept

- Created: [[COPC vs Raw LAZ]] (new concept page)
- Updated: [[Decoder Workers]] (decodeMs field, timing section), [[Renderer]] (Track C frustum culling closed, splat attenuation status clarified)
- Key findings:
  - **GPU upload path is not the bottleneck.** Measured: decode avg 56.4 ms/chunk (Melbourne PDRF 6, 75K pts), pack avg 0.54 ms/chunk. With 15 workers: 134 chunks (10M pts) decodes in ~500ms. Pack: 72ms total.
  - **10–11 s load is network-bound.** 40MB compressed at ~3–5 MB/s to R2. No code change can fix this for raw LAZ. IDB cache (compressed bytes) makes repeat loads instant.
  - **COPC would cut the 40 MB to ~8–15 MB** by loading only the octree nodes at the needed resolution for the current view. Requires one-time preprocessing — outside lazstream's scope.
  - **`maxQueuedChunks = 16` removed** — declared but never read; dead code from an earlier design.

---

## 2026-05-20 — pipelineDry effectiveCapacity fix

- Updated: [[Streaming Engine]] (pipelineDry threshold), [[Back-Pressure Invariants]]
- Key finding:
  - **`pipelineDry` with raw `workerCount=100` bypassed back-pressure for the entire load.** On a 16-core machine, `hardwareConcurrency - 1 = 15`. Actual concurrent decode saturates at ~15 chunks; `queueLength + activeCount ≈ 15 < 100` was almost always true, so `ringSlots` was ignored on every frame — the Step-6 cascade returned. Fix: use `effectiveCapacity = min(workerCount, hardwareConcurrency - 1)` as the threshold. Now `15 < 15` is false during steady load; burst only fires when the pipeline is genuinely dry relative to real CPU throughput.

---

## 2026-05-20 — maxFetches decoupling + tail-end burst dispatch

- Updated: [[Streaming Engine]] (Step 7 maxFetches decoupling; tail-end burst; constructor signature), [[Back-Pressure Invariants]] (pipelineDry invariant), [[index.md]]
- Key findings:
  - **Worker pool "Cap at 4" comment was stale.** Worker count was already `hardwareConcurrency - 1` (max 32) since Option B shipped. Comment updated to reflect reality.
  - **`maxFetches` decoupled from `workerCount` (Step 7 complete).** Previously `workerCount × 2` (hardcoded). Now a 5th constructor param defaulting to `min(workerCount × 4, 128)`. With Option B, workers are pure WASM consumers — the network can sustain more concurrent requests than 2× worker count, keeping workers fed during burst streaming. URL param `?maxFetches=N` added (mirrors `?sseMin`, `?bufferMB`).
  - **`ringSlots` is over-conservative when the pipeline is running dry.** At tail-end load, the ring buffer looks "committed" (`ringFree - inFlight ≈ 0`) because many chunks are in-flight decode, but workers are about to go idle (`queueLength + activeCount < workerCount`). The existing check `slots = min(ringSlots, fetchSlots)` returns 0, stalling the engine for one or more ticks. Fix: when `pipelineDry`, use `fetchSlots` directly (ignore `ringSlots`). Ring buffer LRU eviction and the 256-slot deferred queue absorb any overflow safely.
  - **`pipelineDry` condition is conservative.** `(queueLength + activeCount) < workerCount` means workers will be idle this tick — pipeline genuinely running out of work, not temporary backpressure. Bypassing `ringSlots` only fires when this is true.

---

## 2026-05-19 — SSE threshold: zoom-to-reveal tuning

- Updated: [[Spatial Index]] (MIN_SSE_THRESHOLD TODO closed), [[Streaming Engine]] (constructor signature updated)
- Key findings:
  - **`MIN_SSE_THRESHOLD = 1.0` was not gating anything at Melbourne overview.** The formula `SSE = (extent × canvasHeight) / (distance × 2 × tan(fovY/2))` gives ~7.8 px at overview on a 900 px canvas, scaling linearly with canvas height. On a 1312 px canvas it reaches ~11.4 px — above 1.0 and even above the initially chosen 10.0 default, so no gating occurred.
  - **Threshold is canvas-size-dependent.** A canvas-size-independent gate (e.g. expressed as a fraction of initial camera distance) would be more robust but is deferred. For now, `DEFAULT_MIN_SSE = 50.0` comfortably exceeds overview SSE across 1080p–4K displays for km-scale files.
  - **Small files unaffected.** Texas.laz (overview SSE ≈ 45 px at 1312 px canvas) falls just below 50.0 and would also benefit from zoom-to-reveal. Tune with `?sseMin=N` if needed.
  - **Wire-through is SDK-ready.** `ChunkPrioritiser(spatial, sseThreshold?)` → `StreamingEngine(events, workerCount?, cache?, sseThreshold?)` → `?sseMin=N` URL param in `main.ts`. Phase 4 SDK extraction can expose this directly on the `LazStreamViewer` options object.

---

## 2026-05-20 — Per-point RGB color reading for PDRF 2/3/5/7/8/10

- Updated: [[Decoder Workers]] (RGB byte offsets table, open-questions todo closed)
- Key findings:
  - **laz-perf already decodes all bytes including RGB** — the decode worker was simply discarding them and recomputing elevation color for every PDRF.
  - **RGB byte offsets:** PDRF 2 → 20; PDRF 3/5 → 28; PDRF 7/8/10 → 30. `Module.HEAPU16[(pointPtr + offset) >> 1] >> 8` reads uint16 and scales to uint8. No C++ or laz-perf changes needed.
  - **Implementation:** RGB collected during the existing first decode pass (alongside XYZ bbox). Stored in `rawR/rawG/rawB` (Uint8Array). Applied in second pass in place of elevation coloring when `hasRgb` is true. PDRFs 0/1/4/6/9 fall back to elevation coloring.
  - **No additional decode pass required.** `decoder.getPoint()` puts the full record in WASM heap; RGB is read while XYZ is also being read, so no extra work per point.

---

## 2026-05-09 — Initial wiki scaffold

- Created: [[WIKI_SCHEMA]], [[index.md]]
- Created projects: [[Manifest Loader]], [[Streaming Engine]], [[Decoder Workers]], [[Renderer]], [[Chunk Caching]], [[Spatial Index]]
- Created concepts: [[LAZ Format]], [[WebGPU Compute]], [[HTTP/2 Range Requests]], [[LidarScout Chunk-Seed]], [[Ring Buffer GPU Memory]]
- Key finding: Wiki bootstrapped from CLAUDE.md project context; all pages are `status: draft` pending source ingestion.
