# lazstream — Wiki Index

Navigation hub. One row per page. Keep this in sync with the actual files.
See [[WIKI_SCHEMA]] for conventions.

---

## Projects

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[Phase 1 — Core Streaming and Seed Overview]] | archived | 2026-05-10 | Phase 1 complete: chunk table decoded, 380 seed points rendered at 144 fps |
| [[Manifest Loader]] | active | 2026-05-16 | URL validation, header parsing, arithmetic chunk table decode (production-correct), seed point emission |
| [[Streaming Engine]] | active | 2026-05-20 | Steps 1–7 + tail-end burst: pipelineDry uses effectiveCapacity=min(workerCount,hardwareConcurrency−1); maxFetches 5th param; fetch timing logged per batch |
| [[Decoder Workers]] | active | 2026-05-20 | Option B fetch model; decodeMs in DecodedChunk; per-point RGB for PDRF 2/3/5/7/8/10 (elevation fallback for others); decode avg 56 ms/chunk (Melbourne, 15 workers) — network-bound not GPU-bound |
| [[Renderer]] | active | 2026-05-20 | 2D mega-dispatch (O(1) CPU encode); proactive eviction with phantom-chunk guard; splatRadius default 2 (3×3 px, ?splatRadius=N); pack timing accumulator |
| [[Chunk Caching]] | active | 2026-05-18 | Compressed-bytes IDB cache, FNV-1a keys, LRU eviction, 512 MB default budget |
| [[Spatial Index]] | active | 2026-05-19 | rbush-3d 3D spatial index; frustum culling + SSE threshold (default 50.0, configurable via ?sseMin=N); Track C complete |
| [[Manifest Session]] | active | 2026-05-23 | Multi-tile coordinator: one StreamingEngine per tile, global chunk index namespacing, combined onSeedsReady, tile-failure graceful skip |
| [[SDK]] | planned | 2026-05-23 | Monorepo extraction plan: ManifestSession as primary core entry point; LazstreamViewer.load(string\|Manifest); worker portability fix, options-object constructor, dequantizeChunk utility |

## Concepts

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[LAZ Format]] | active | 2026-05-16 | Header layout, PDRF types, chunk table compression (arithmetic coded), seed prefix rule |
| [[Arithmetic Decoder]] | active | 2026-05-16 | ArithmeticDecoder + IntegerDecompressor; canonical C++ alignment; Melbourne validated |
| [[LidarScout Chunk-Seed]] | active | 2026-05-16 | Proven in Phase 1 + Melbourne 2018: 7073/7073 seeds in bounds after chunk-table fix |
| [[HTTP/2 Range Requests]] | active | 2026-05-19 | Coalescing algorithm; seed fetch parallelism (BATCH_SIZE 100 for HTTP/2 multiplexing) |
| [[WebGPU Compute]] | active | 2026-05-20 | Storage buffer atomics; 2D mega-dispatch (gid.y=slot, gid.x=point); binding 1→storage array, binding 5=visible slot list |
| [[Ring Buffer GPU Memory]] | active | 2026-05-20 | Fixed-slot allocator; everRendered flag; lastRenderedFrame init fix; configurable capacity; ?bufferMB |
| [[laz-perf Worker Porting]] | active | 2026-05-12 | Full discovery log: npm package fails in workers, two ESM patches, Vite dev limitations, WASM locateFile |
| [[Chunk-Table Decoder Saga]] | active | 2026-05-16 | Four-round debugging: decodeSymbol misalignment, table sizing/fill, uint32 accumulation, k=0 bit — port now canonical |
| [[Back-Pressure Invariants]] | active | 2026-05-20 | 9 invariants; pipeline-dry override uses effectiveCapacity (not raw workerCount) |
| [[COPC vs Raw LAZ]] | active | 2026-05-20 | Octree hierarchy, progressive loading, 40MB→8–15MB bandwidth saving; why lazstream uses raw LAZ |
| [[Manifest Format]] | active | 2026-05-23 | `.lazm.json` v1.0 spec: TileEntry fields, validation rules, chunk index namespacing, tile failure behaviour |

---

## Current Phase

**Phase 3 — Effectively complete.** All Track A steps shipped; Track B v1 (fixed-slot allocator) running with adapter-negotiated capacity up to ~2.87 GB. Melbourne 2018 (353M pts, 2.93 GB, 7073 chunks) renders ~150M simultaneous points with header-framed initial view, persistent seed overview, and camera-driven streaming.

**Known scaling caveats**:
- Deferred queue (default 256) may still overwhelm at very high buffer sizes during fast camera movement.
- WebGPU `MAX_SLOTS = 4096` constant in renderer caps practical buffer at ~2.87 GB. Beyond requires bumping.

**Phase 4 — Next.** SDK extraction: monorepo, `@lazstream/core` library mode, hosted viewer at `@lazstream/viewer`, npm publication.

**Phase 5 deferred work**:
- Track B v2 (variable-size slots + GPU compaction) for COPC support and per-file slot sizing
- WebGL fallback
- Device-lost recovery
