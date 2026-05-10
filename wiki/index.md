# lazstream — Wiki Index

Navigation hub. One row per page. Keep this in sync with the actual files.
See [[WIKI_SCHEMA]] for conventions.

---

## Projects

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[Phase 1 — Core Streaming and Seed Overview]] | archived | 2026-05-10 | Phase 1 complete: chunk table decoded, 380 seed points rendered at 144 fps |
| [[Manifest Loader]] | active | 2026-05-10 | URL validation, header parsing, arithmetic chunk table decode, seed point emission |
| [[Streaming Engine]] | active | 2026-05-10 | Events-based pipeline orchestrator; Phase 2 adds HTTP/2 batching + back-pressure |
| [[Decoder Workers]] | draft | 2026-05-09 | laz-perf WASM pool, layered decode for PDRF 6-10, fallback for 0-5 |
| [[Renderer]] | active | 2026-05-10 | Phase 1: WebGL seed renderer; Phase 2: Three.js WebGPURenderer + atomicMin compute |
| [[Chunk Caching]] | draft | 2026-05-09 | idb-keyval IndexedDB cache; LRU eviction; cache-key strategy |
| [[Spatial Index]] | draft | 2026-05-09 | rbush chunk-level spatial index; frustum culling; LOD gating |

## Concepts

| Page | Status | Updated | Summary |
|------|--------|---------|---------|
| [[LAZ Format]] | active | 2026-05-10 | Header layout, PDRF types, chunk table compression (arithmetic coded), seed prefix rule |
| [[Arithmetic Decoder]] | active | 2026-05-10 | ArithmeticDecoder + IntegerDecompressor for chunk table decode; constants and algorithm |
| [[LidarScout Chunk-Seed]] | active | 2026-05-10 | Proven in Phase 1: 380 seeds from 19M-point file; seed offset rule for fixed vs variable chunks |
| [[HTTP/2 Range Requests]] | active | 2026-05-10 | R2 probe-with-range fix; COOP/COEP cache:'no-store'; coalescing strategy for Phase 2 |
| [[WebGPU Compute]] | draft | 2026-05-09 | Schütz atomicMin depth technique; compute shader pipeline |
| [[Ring Buffer GPU Memory]] | draft | 2026-05-09 | 256 MB GPU ring buffer; LRU chunk eviction; frame-coherent access |

---

## Current Phase

**Phase 1 — Complete.** Core streaming pipeline proven: raw LAZ URL → header parse → chunk table decode (arithmetic coded) → seed points → WebGL render. TTFF ~4–5 s on HTTP/1.1 R2.

**Phase 2 — Upcoming.** Web Worker decode pool, range-request coalescing, rbush spatial index, WebGPU compute shader renderer, GPU ring buffer. Target: 30 fps at 5–20 M GPU-resident points.
