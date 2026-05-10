# lazstream — Claude Code Session Context

## What this project is
Browser-based raw LAZ point cloud viewer. Streams arbitrary LAZ 1.2-1.4
files from cloud storage (S3, R2, Blob) without preprocessing.
No COPC conversion required. No tile server.

## Stack (locked — do not suggest alternatives)
- Three.js r168+ with WebGPURenderer (compute shaders)
- laz-perf 0.0.7 (WASM) — LAZ decoder, runs in Web Workers
- rbush — chunk-level spatial index
- idb-keyval — IndexedDB caching
- Vite 6 + TypeScript 5.5
- Currently: single package at root (`src/`). Planned: monorepo packages/core (SDK) + packages/viewer (app)

## LAZ version handling
- LAZ 1.4 PDRF 6-10: full performance path (layered decode)
- LAZ 1.2/1.3 PDRF 0-5: supported, no selective layer decode
- Uncompressed LAS: reject with error message
- Detection: byte 24 (major) + byte 25 (minor) in LAS header

## Architecture — read wiki/ before implementing any module
- Manifest Loader → Streaming Engine → Decoder Workers → Renderer
- LidarScout chunk-seed technique for instant overview (see wiki)
- HTTP/2 range-request coalescing (2-4 MB per batch)
- WebGPU atomicMin compute shader (Schütz technique)
- Ring buffer GPU memory (256 MB, LRU eviction)

## Current phase

**Phase 1 — Complete.** URL → header → chunk table → seed points → WebGL render. TTFF ~4–5 s (HTTP/1.1 R2).

**Phase 2 — Next.** Web Worker decode pool, range-request coalescing, rbush spatial index, WebGPU renderer, GPU ring buffer. Target: 30 fps at 5–20 M GPU-resident points.

> Consolidated reference for all active subprojects. Read this before touching any code.

---

## Wiki Protocol (llm-wiki — Karpathy)

This project follows the [llm-wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The wiki at `wiki/` is a **persistent, compounding artifact** — not a scratchpad. The LLM writes and maintains it; the human curates sources and asks questions.

### Three operations — always follow these

**Ingest** — when a new context document, completed phase, or design decision arrives:
1. Read the source and discuss key takeaways
2. Write or update the relevant `wiki/projects/*.md` page
3. Update any touched `wiki/concepts/*.md` pages
4. Append a dated entry to `wiki/log.md`
5. Update the status row in `wiki/index.md`
A single ingest may touch 5–15 wiki pages. That is expected and correct.

**Query** — when answering a question about the project:
1. Read `wiki/index.md` first to orient
2. Read the relevant project/concept pages
3. Synthesise an answer with citations to wiki pages
4. **File good answers back into the wiki** — a comparison, analysis, or discovered connection that took real reasoning belongs as a wiki page, not lost in chat history

**Lint** — periodically check the wiki for:
- Contradictions between pages
- Stale `status` fields or superseded claims
- Orphaned pages (no inbound links)
- Concepts mentioned but lacking their own page
- Missing cross-references

### Wiki location
`wiki/` lives in this repo. See `wiki/WIKI_SCHEMA.md` for directory structure, frontmatter conventions, and wikilink format.
## Critical rules
- NEVER convert the source LAZ file (read-only)
- NEVER load entire file into memory (streaming only)
- NEVER block the main thread with decode work (workers only)
- ALWAYS validate URL scheme before fetching (https: only, http: localhost only)
- ALWAYS handle missing chunk table gracefully (fallback to sequential scan)
- ALWAYS include `cache: 'no-store'` on every fetch call (COOP/COEP headers are active; omitting it causes ERR_CACHE_OPERATION_NOT_SUPPORTED on range requests in Chrome)
- Chunk table is arithmetically coded (ArithmeticDecoder + IntegerDecompressor) — NOT raw uint64 entries
- Seed point prefix: use `lazVlr.chunkSize === 0` (variable chunks) to decide the 4-byte skip, NOT PDRF version