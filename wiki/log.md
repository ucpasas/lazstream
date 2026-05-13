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

## 2026-05-09 — Initial wiki scaffold

- Created: [[WIKI_SCHEMA]], [[index.md]]
- Created projects: [[Manifest Loader]], [[Streaming Engine]], [[Decoder Workers]], [[Renderer]], [[Chunk Caching]], [[Spatial Index]]
- Created concepts: [[LAZ Format]], [[WebGPU Compute]], [[HTTP/2 Range Requests]], [[LidarScout Chunk-Seed]], [[Ring Buffer GPU Memory]]
- Key finding: Wiki bootstrapped from CLAUDE.md project context; all pages are `status: draft` pending source ingestion.
