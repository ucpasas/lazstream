---
title: Phase 1 — Core Streaming and Seed Overview
type: project
status: archived
updated: 2026-05-10
tags: [phase1, complete, seed-points, chunk-table, webgl, streaming]
---

# Phase 1 — Core Streaming and Seed Overview

**Status:** Complete  
**Outcome:** Raw LAZ file streams from R2, chunk table decoded, seed points rendered at 144 fps

---

## Objective

Prove the [[LidarScout Chunk-Seed]] technique works in a browser over HTTP with no preprocessing, no COPC conversion, and no laz-perf involvement. A single raw LAZ URL in the address bar produces a rendered point cloud.

---

## Files created

```
src/
  types/
    las.ts                  LAS/LAZ format types + version classifier
  network/
    url-validator.ts        URL security layer (scheme whitelist, private IP block)
    range-fetcher.ts        HTTP range request abstraction
  engine/
    header-parser.ts        LAS public header + LAZ VLR parser
    chunk-table.ts          Compressed chunk table decoder + seed point extractor
    streaming-engine.ts     Pipeline orchestrator (events-based)
  decode/
    arithmetic-decoder.ts   ArithmeticDecoder + ArithmeticBitModel + ArithmeticModel
    integer-decompressor.ts IntegerDecompressor (LAZ chunk table codec)
  render/
    renderer.ts             Three.js WebGL seed point renderer
  main.ts                   UI wiring
index.html                  Viewer shell
```

---

## Pipeline (execution order)

```
URL → validateSourceUrl()
    → probeUrl()               HEAD + bytes=0-0 range verify
    → fetchAndParseLasHeader() 8 KB range read → LAS header + LAZ VLR
    → classifyLazVersion()     laz-1.2 | laz-1.3 | laz-1.4 | unsupported
    → fetchChunkTable()        compressed chunk table → ChunkTableEntry[]
    → fetchSeedPoints()        one raw point per chunk → SeedPoint[]
    → renderer.loadSeedPoints() Three.js Points with elevation colour
```

---

## Key discoveries

Three findings that contradict public documentation, all discovered empirically:

### Discovery 1: Chunk table is arithmetically compressed

The chunk table is not raw uint64 data. It is encoded using `IntegerCompressor(32, 2, bits_high=8)` on top of `ArithmeticDecoder`. No existing JavaScript browser viewer implements this independently.

See [[Arithmetic Decoder]] for the full algorithm and constants. See [[LAZ Format]] for the decode procedure.

### Discovery 2: 4-byte point count prefix only for variable-size chunks

The seed point starts at `chunkOffset + 0` for fixed-size chunks (PDAL default), and `chunkOffset + 4` for variable-size chunks (COPC). The correct discriminant is `lazVlr.chunkSize === 0`, not PDRF version.

See [[LAZ Format]] Discovery 2 for byte-level verification.

### Discovery 3: R2 r2.dev omits Accept-Ranges on HEAD responses

`probeUrl()` must verify Range support by issuing an actual `bytes=0-0` range request — a HEAD check is not sufficient for R2.

Also: all fetch calls must include `cache: 'no-store'` when COOP/COEP headers are active, or Chrome throws `ERR_CACHE_OPERATION_NOT_SUPPORTED` for range requests.

See [[HTTP/2 Range Requests]] for the probe-with-range implementation.

---

## Performance

Test file: USGS 3DEP Central Texas, LAS 1.4 PDRF 6, 19,052,510 points, 380 chunks, ~61 MB, served from Cloudflare R2 r2.dev (HTTP/1.1).

| Stage | Time |
|-------|------|
| probeUrl (HEAD + range verify) | ~200 ms |
| fetchAndParseLasHeader | ~150 ms |
| fetchChunkTable pointer | ~100 ms |
| fetchChunkTable compressed | ~200 ms |
| ArithmeticDecoder + IntegerDecompressor | < 1 ms |
| fetchSeedPoints (380 × ~30 B, batched 6) | 3–4 s |
| renderer.loadSeedPoints | < 5 ms |
| **Total TTFF** | **~4–5 s** |

FPS: 144 fps (seed points only). Memory: < 10 MB.

The dominant cost is 380 HTTP/1.1 requests batched 6 at a time (~64 round trips). Phase 2 range coalescing targets < 500 ms TTFF.

---

## Test file

```
URL:    https://pub-729a4f32b70f473abbf23bf25daf2899.r2.dev/laz/
        USGS_LPC_TX_Central_B1_2017_stratmap17_50cm_2996011a1_LAS_2019.laz
Format: LAS 1.4, PDRF 6
Points: 19,052,510
Chunks: 380 (50,000 pts each, except last)
Size:   64,637,077 bytes (~61 MB)
CRS:    NAD83(2011) / UTM Zone 14N + NAVD88 height (EPSG:6349)
Scale:  0.01 (X, Y, Z)
Bbox X: 692,915.15 – 694,453.02
Bbox Y: 3,318,737.40 – 3,320,495.66
Bbox Z: 40.40 – 183.83
Source: USGS 3DEP, hosted on Cloudflare R2
```

---

## Known limitations entering Phase 2

1. **HTTP/1.1 on R2 r2.dev** — 6-connection limit; seed TTFF dominated by round trips.
2. **Seed points only** — 1 point per 50,000; no full chunk decode.
3. **No spatial index** — seed points not indexed; no frustum prioritisation.
4. **No cancellation** — loading a new URL while seeds are fetching leaves the old engine running.
5. **LAZ 1.2/1.3 seed offset untested** — assumed correct but not verified against a real file.

---

## Phase 2 scope

1. Web Worker pool — `navigator.hardwareConcurrency - 1` workers with pinned laz-perf WASM
2. Range-request coalescing — 2–4 MB batched fetches
3. rbush spatial index — built from seed positions for frustum culling
4. Screen-space error priority queue
5. Int16 quantization — per-chunk-local coordinates to halve GPU memory
6. Transferable ArrayBuffers — zero-copy worker → main thread transfer
7. WebGPU compute shader renderer — atomicMin depth + colour (Schütz technique)
8. GPU ring buffer — 256 MB LRU append-only
9. Eye-dome lighting — post-process to mask density variation
10. Frame-amortised decode budget — never block the render loop

Target: 30 fps at 5–20 M GPU-resident points from a 100 M point LAZ file.

---

## See also

- [[Manifest Loader]] — Phase 1 pipeline implementation
- [[Streaming Engine]] — events-based coordinator
- [[Renderer]] — Phase 1 WebGL seed renderer
- [[LAZ Format]] — format discoveries
- [[Arithmetic Decoder]] — chunk table codec
- [[LidarScout Chunk-Seed]] — technique proven in Phase 1
- [[HTTP/2 Range Requests]] — R2 probe fix; COOP/COEP note
