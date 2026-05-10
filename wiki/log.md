# log — lazstream

Append-only. See [[WIKI_SCHEMA]] for entry format. Never edit existing entries.

---

## 2026-05-10 — Phase 1 ingestion

- Ingested: lazstream-phase1-wiki.md (Phase 1 session summary)
- Created: [[Phase 1 — Core Streaming and Seed Overview]], [[Arithmetic Decoder]]
- Updated: [[LAZ Format]], [[LidarScout Chunk-Seed]], [[HTTP/2 Range Requests]], [[Manifest Loader]], [[Streaming Engine]], [[Renderer]], [[index.md]]
- Key finding: Chunk table is arithmetically coded (not raw uint64); seed point prefix is controlled by `chunkSize === 0`, not PDRF version; R2 r2.dev omits Accept-Ranges on HEAD — must probe with an actual range request.

---

## 2026-05-09 — Initial wiki scaffold

- Created: [[WIKI_SCHEMA]], [[index.md]]
- Created projects: [[Manifest Loader]], [[Streaming Engine]], [[Decoder Workers]], [[Renderer]], [[Chunk Caching]], [[Spatial Index]]
- Created concepts: [[LAZ Format]], [[WebGPU Compute]], [[HTTP/2 Range Requests]], [[LidarScout Chunk-Seed]], [[Ring Buffer GPU Memory]]
- Key finding: Wiki bootstrapped from CLAUDE.md project context; all pages are `status: draft` pending source ingestion.
