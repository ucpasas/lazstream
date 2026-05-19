# lazstream — Wiki Index

Navigation hub. One row per page. Keep this in sync with the actual files.
See [[WIKI_SCHEMA]] for conventions.

---

## Projects

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[Phase 1 — Core Streaming and Seed Overview]] | archived | 2026-05-10 | Phase 1 complete: chunk table decoded, 380 seed points rendered at 144 fps |
| [[Manifest Loader]] | active | 2026-05-16 | URL validation, header parsing, arithmetic chunk table decode (production-correct), seed point emission |
| [[Streaming Engine]] | active | 2026-05-18 | Phase 3 Track A complete (Steps 1–6): race fix, cancellation, Option B fetch, coalescing, cache, ring-buffer back-pressure |
| [[Decoder Workers]] | active | 2026-05-18 | Option B fetch model: workers only decode, main thread fetches bytes via coalesced ranges |
| [[Renderer]] | active | 2026-05-19 | CPU frustum cull, deferred queue, persistent seed overview, header-driven initial framing, configurable buffer capacity |
| [[Chunk Caching]] | active | 2026-05-18 | Compressed-bytes IDB cache, FNV-1a keys, LRU eviction, 512 MB default budget |
| [[Spatial Index]] | active | 2026-05-16 | rbush-3d 3D spatial index; frustum culling + SSE threshold; Track C complete |

## Concepts

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[LAZ Format]] | active | 2026-05-16 | Header layout, PDRF types, chunk table compression (arithmetic coded), seed prefix rule |
| [[Arithmetic Decoder]] | active | 2026-05-16 | ArithmeticDecoder + IntegerDecompressor; canonical C++ alignment; Melbourne validated |
| [[LidarScout Chunk-Seed]] | active | 2026-05-16 | Proven in Phase 1 + Melbourne 2018: 7073/7073 seeds in bounds after chunk-table fix |
| [[HTTP/2 Range Requests]] | active | 2026-05-19 | Coalescing algorithm; seed fetch parallelism (BATCH_SIZE 100 for HTTP/2 multiplexing) |
| [[WebGPU Compute]] | active | 2026-05-13 | Storage buffer atomics (not texture_atomic); dynamic-offset dispatch; per-point pipeline |
| [[Ring Buffer GPU Memory]] | active | 2026-05-19 | Track B v1 fixed-slot allocator; configurable target capacity (2 GB default); adapter-limit negotiation; ?bufferMB URL override |
| [[laz-perf Worker Porting]] | active | 2026-05-12 | Full discovery log: npm package fails in workers, two ESM patches, Vite dev limitations, WASM locateFile |
| [[Chunk-Table Decoder Saga]] | active | 2026-05-16 | Four-round debugging: decodeSymbol misalignment, table sizing/fill, uint32 accumulation, k=0 bit — port now canonical |
| [[Back-Pressure Invariants]] | active | 2026-05-18 | Visibility-driven allocation invariants: cull, LRU, back-pressure, deferred queue all share the same `lastRenderedFrame` semantics |

---

## Current Phase

**Phase 3 — Effectively complete.** All Track A steps shipped; Track B v1 (fixed-slot allocator) running with adapter-negotiated capacity up to ~2.87 GB. Melbourne 2018 (353M pts, 2.93 GB, 7073 chunks) renders ~150M simultaneous points with header-framed initial view, persistent seed overview, and camera-driven streaming.

**Known scaling caveats**:
- At ~3000 slots, per-frame CPU encoding (`setBindGroup + dispatchWorkgroups` × N) starts costing ~15 ms — frame budget pressure at 60 fps. Indirect dispatch is the proper future fix.
- Deferred queue (default 64) overwhelms at high buffer sizes during fast camera movement — bump to 256 if running large buffers.
- WebGPU `MAX_SLOTS = 4096` constant in renderer caps practical buffer at ~2.87 GB. Beyond requires bumping.

**Phase 4 — Next.** SDK extraction: monorepo, `@lazstream/core` library mode, hosted viewer at `@lazstream/viewer`, npm publication.

**Phase 5 deferred work**:
- Indirect dispatch (GPU-driven cull list + single `dispatchWorkgroupsIndirect`)
- Track B v2 (variable-size slots + GPU compaction) for COPC support and per-file slot sizing
- WebGL fallback
- Device-lost recovery
