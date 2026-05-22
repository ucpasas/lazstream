---
title: Manifest Loader
type: project
status: active
updated: 2026-05-16
tags: [laz, header, chunk-table, parsing, url-validation]
---

# Manifest Loader

First stage in the pipeline: `Manifest Loader → [[Streaming Engine]] → [[Decoder Workers]] → [[Renderer]]`.

Responsible for fetching only the LAZ file header and chunk table, then emitting structured chunk descriptors that the streaming engine can schedule.

---

## Phase 1 implementation

In Phase 1 the manifest loader responsibilities are spread across three files:

| File | Responsibility |
|------|---------------|
| `src/network/url-validator.ts` | URL scheme whitelist (`https:` only; `http:` localhost only); private IP block |
| `src/network/range-fetcher.ts` | HTTP range request abstraction; probe-with-range for R2 compatibility |
| `src/engine/header-parser.ts` | LAS public header + LAZ VLR parsing (8 KB initial range read) |
| `src/engine/chunk-table.ts` | Compressed chunk table decode + seed point byte offset extraction |
| `src/types/las.ts` | LAS/LAZ format types + version classifier |

---

## Responsibilities

1. Validate URL scheme before any fetch (https: only; http: localhost only).
2. Probe the URL with a `bytes=0-0` range request to confirm Range support (not a HEAD check — see [[HTTP/2 Range Requests]] Discovery).
3. Fetch the first ~8 KB of the LAZ file (LAS public header block) via a single range request.
4. Parse version (bytes 24–25) to determine LAZ 1.2/1.3 vs 1.4 path.
5. For LAZ 1.4: fetch and decode the compressed chunk table (see [[LAZ Format]] and [[Arithmetic Decoder]]) to get per-chunk byte offsets.
6. For LAZ 1.2/1.3: chunk table may be absent; fall back to sequential scan mode.
7. Emit `ChunkDescriptor[]`: `{ byteOffset, byteLength, pointCount, chunkIndex }`.

---

## Pipeline (Phase 1 execution order)

```
validateSourceUrl()           URL scheme + private IP check
  ↓
probeUrl()                    bytes=0-0 range → confirms 206; extracts file size
  ↓
fetchAndParseLasHeader()       8 KB range read → LAS public header + LAZ VLR
  ↓
classifyLazVersion()           laz-1.2 | laz-1.3 | laz-1.4 | unsupported
  ↓
fetchChunkTable()              compressed chunk table → ChunkTableEntry[]
  ↓ (uses ArithmeticDecoder + IntegerDecompressor)
fetchSeedPoints()              one raw point per chunk → SeedPoint[]
```

---

## LAZ version detection

| Bytes 24–25 | Version | Chunk table | Decode path |
|-------------|---------|-------------|-------------|
| `1.4` | LAZ 1.4 | Present, arithmetically compressed | Layered, PDRF 6–10 full perf |
| `1.2` or `1.3` | LAZ 1.2/1.3 | May be absent | Sequential, PDRF 0–5 |

---

## URL validation

`src/network/url-validator.ts` enforces:
- Scheme whitelist: `https:` always allowed; `http:` only for `localhost` / `127.0.0.1` / `::1`
- Private IP block: rejects RFC-1918 addresses on non-localhost origins
- Rejects `file:` and `data:` schemes

---

## Error handling

- Missing chunk table: emit a warning, fall back to sequential scan — do not throw.
- Uncompressed LAS: detect via point data format byte, reject with user-facing error.
- Network errors: propagate as `ManifestLoadError` with original URL and HTTP status.

---

## Constraints

- NEVER load the entire file into memory.
- Only 2–3 range requests permitted during manifest phase (probe + header + chunk table).
- All fetch calls must include `cache: 'no-store'` (COOP/COEP requirement — see [[HTTP/2 Range Requests]]).
- No worker threads — manifest loading runs on the main thread (fast, no decode work).

---

## Phase 3 — chunk-table decoder production-correct

The hand-port of `ArithmeticDecoder` + `ArithmeticModel` + `IntegerCompressor` was aligned with canonical LASzip C++ across four rounds of debugging against Melbourne 2018 (7073 entries). See [[Chunk-Table Decoder Saga]]. Phase 3 validation confirms 7073-entry chunk tables decode in ~3 ms with all chunk offsets matching ground truth (all 7073 seed points fall within the LAS header bbox).

---

## Open questions

- [ ] How to handle LAZ 1.4 files where the chunk table VLR is missing (malformed files)?
- [ ] Should the manifest loader expose a streaming API so the streaming engine can start before the full chunk table is available?
- [x] LAZ 1.2/1.3 seed offset: `seedByteOffset = 0` **verified 2026-05-22** against `cloud-garden.laz` (terrestrial PDRF 2 RGB, 1952 chunks, 97M pts). Seeds load correctly; RGB decode working.

---

## `.lazm.json` multi-tile manifest (2026-05-23)

`src/engine/manifest-loader.ts` and `src/engine/manifest-types.ts` were added to support `.lazm.json` multi-tile manifests. See [[Manifest Session]] for the coordinator that consumes them.

- `urlToManifest(lazUrl)` — wraps a bare `.laz` URL in a synthetic one-tile manifest so there is exactly one load path for both single-file and multi-tile use
- `fetchManifest(url, signal?)` — fetches and parses a `.lazm.json` file; uses `cache: 'no-store'`
- `parseManifest(raw)` — validates the JSON structure; throws `ManifestParseError` on any violation
- `validateManifestUrl(raw)` — added to `url-validator.ts`; same scheme/IP rules as `validateSourceUrl` but expects `.lazm.json` extension

---

## See also

- [[LAZ Format]] — byte-level header, chunk table structure, discovery notes
- [[Arithmetic Decoder]] — decodes the arithmetically compressed chunk table
- [[HTTP/2 Range Requests]] — probe-with-range fix for R2 compatibility
- [[Streaming Engine]] — consumes `ChunkDescriptor[]`
- [[LidarScout Chunk-Seed]] — seed points emitted as part of manifest loading
- [[Manifest Session]] — multi-tile coordinator built on top of manifest loading
- [[Manifest Format]] — `.lazm.json` spec
