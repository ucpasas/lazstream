# lazstream — Wiki Index

Navigation hub. One row per page. Keep this in sync with the actual files.
See [[WIKI_SCHEMA]] for conventions.

---

## Projects

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[Phase 1 — Core Streaming and Seed Overview]] | archived | 2026-05-10 | Phase 1 complete: chunk table decoded, 380 seed points rendered at 144 fps |
| [[Manifest Loader]] | active | 2026-05-10 | URL validation, header parsing, arithmetic chunk table decode, seed point emission |
| [[Streaming Engine]] | active | 2026-05-12 | Phase 2 Track A: worker pool + camera-driven prioritiser wired; Phase 3 adds HTTP/2 coalescing |
| [[Decoder Workers]] | active | 2026-05-13 | Phase 2 Track A complete: 4-worker pool, self-fetch, Int16 quantization, Transferable transfer, 19M pts at 76fps; global Z colour fix |
| [[Renderer]] | active | 2026-05-13 | Phase 2 Track B complete: WebGPU compute renderer running at ~76 fps on 19M pt tile |
| [[Chunk Caching]] | draft | 2026-05-09 | idb-keyval IndexedDB cache; LRU eviction; cache-key strategy |
| [[Spatial Index]] | draft | 2026-05-09 | rbush chunk-level spatial index; frustum culling; LOD gating |

## Concepts

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[LAZ Format]] | active | 2026-05-10 | Header layout, PDRF types, chunk table compression (arithmetic coded), seed prefix rule |
| [[Arithmetic Decoder]] | active | 2026-05-10 | ArithmeticDecoder + IntegerDecompressor for chunk table decode; constants and algorithm |
| [[LidarScout Chunk-Seed]] | active | 2026-05-10 | Proven in Phase 1: 380 seeds from 19M-point file; seed offset rule for fixed vs variable chunks |
| [[HTTP/2 Range Requests]] | active | 2026-05-10 | R2 probe-with-range fix; COOP/COEP cache:'no-store'; coalescing strategy for Phase 2 |
| [[WebGPU Compute]] | active | 2026-05-13 | Storage buffer atomics (not texture_atomic); dynamic-offset dispatch; per-point pipeline |
| [[Ring Buffer GPU Memory]] | active | 2026-05-13 | First-fit + LRU allocator implemented; 256 MB negotiated at device creation |
| [[laz-perf Worker Porting]] | active | 2026-05-12 | Full discovery log: npm package fails in workers, two ESM patches, Vite dev limitations, WASM locateFile |

---

## Current Phase

**Phase 1 — Complete.** Core streaming pipeline proven: raw LAZ URL → header parse → chunk table decode (arithmetic coded) → seed points → WebGL render. TTFF ~4–5 s on HTTP/1.1 R2.

**Phase 2 Track A — Complete.** Web Worker decode pool (4 workers), camera-driven chunk prioritiser, Int16 quantization + zero-copy Transferable transfer, WebGL validation renderer. Result: 380 chunks, 18,991,962 points at 76 fps.

**Phase 2 Track B — Complete.** WebGPU compute shader renderer: atomicMin depth buffer (storage buffer, not texture_atomic), GPU ring buffer (256 MB, LRU eviction, first-fit allocation), eye-dome lighting post-process, dynamic-offset chunk dispatch. Confirmed running on Chrome 120+ at ~76 fps on 19M pt tile. Global Z colour fix applied to decoder workers.

**Phase 3 — Next.** HTTP/2 range-request coalescing, rbush spatial index + frustum culling, frame-amortised decode budget + back-pressure (required for Melbourne 2018 scale), AbortController threading. Target: 30 fps at 5–20 M GPU-resident points from a 100 M+ point LAZ file.
