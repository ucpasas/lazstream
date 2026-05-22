---
title: COPC vs Raw LAZ
type: concept
status: active
updated: 2026-05-22
tags: [copc, laz, network, octree, streaming, architecture]
---

# COPC vs Raw LAZ

Design note on why lazstream serves raw LAZ and what COPC would change.

---

## What COPC is

Cloud Optimized Point Cloud (COPC) is a LAZ 1.4 file with its point data reorganised into a **spatial octree**. Each octree node contains a uniform spatial sample of its volume's points. Child nodes refine the parent at 2× density. The file is still a single `.copc.laz`, readable by any LAZ tool, but point order is octree-traversal rather than scan order.

---

## How the octree changes network behaviour

**Raw LAZ (lazstream today):**

- Chunks are scan-order. A chunk near byte offset 0 might cover any spatial region.
- The [[Spatial Index]] (rbush) maps chunks to bounding boxes, so the engine knows *which* chunks overlap the view frustum — but it must download the **entire compressed chunk** (~300 KB) to get any points from it.
- At overview distance the seed trick (see [[LidarScout Chunk-Seed]]) provides a coarse representation; real chunks only load when zoomed in past `sseThreshold`.
- Binary choice per chunk: all 75K points or none.

**COPC:**

- Level 0 (root node): a uniform spatial sample of the **entire dataset** — typically 500K–1M points. Download ~3 MB, see the full city instantly.
- Level 1: 8 children, each covering 1/8 of the volume at 2× density.
- For a given camera: only request nodes that (a) intersect the view frustum and (b) have SSE ≥ threshold. The rest of the file is never touched.
- Zooming into a sub-region downloads only that branch of the octree. Points elsewhere are never fetched.

---

## Concrete comparison — Melbourne 2018, "10M points at close zoom"

| | Raw LAZ (lazstream) | COPC |
|---|---|---|
| Overview | Seed trick ~50K pts, ~4 MB | Level 0 ~500K pts, ~3 MB |
| 10M pts close zoom | ~134 chunks × 300 KB = **40 MB** | 3–4 octree levels for sub-volume = **8–15 MB** |
| Points outside viewport | Over-fetched (chunk straddles boundary) | Not fetched (node boundary aligned to octree) |
| Progressive quality | Binary (seed OR full chunk) | Continuous (each additional level adds detail) |

---

## Why lazstream uses raw LAZ

lazstream's core value proposition: **stream any raw LAZ file from cloud storage without preprocessing**. COPC requires a one-time conversion (PDAL, Entwine, Potree Converter). For files the user already has in LAZ format on R2/S3/Blob, COPC conversion is an upload-time burden they want to avoid.

The tradeoff is accepted: raw LAZ loads are network-bound (40 MB for 10M points at ~3–5 MB/s ≈ 10–11 s). IDB caching (see [[Chunk Caching]]) makes subsequent views instant.

---

## Current COPC support (partial, 2026-05-22)

lazstream can load COPC files without a code change to the URL input. The loading pipeline degrades gracefully:

- **Header + chunk table**: parsed identically to raw LAZ. The LAZ VLR is present in COPC files at the standard location.
- **Seed extraction**: the original byte-read path is used (same as all other files). For COPC, `chunkSize === 0` → `seedByteOffset = 4`, so bytes are read starting 4 bytes into each chunk. These bytes are arithmetic-coder data (not raw XYZ), so most seeds fail the bounds check → 0 valid seeds → no seed overview. The scene still loads; it just starts blank until chunks decode.
- **Spatial culling**: disabled. With 0 valid seeds, all chunks are dispatched in FIFO order based on file position.
- **Chunk decode**: laz-perf 0.0.7 does not support LAZ 1.4 layered format (compressor 3). All chunks fail with an uncatchable WASM exception. `worker.onerror` clears `inFlight` for each failed chunk; the worker sits idle. No rendering occurs.
- **PDRF correction**: if the file's PDRF byte was corrupted (header byte 104 = 0x80 instead of 0x86 for PDRF 6), `parseLazVlrData` now derives the PDRF from `pointDataRecordLength`. This is correct but doesn't help until laz-perf is upgraded.

**Known limitation**: without a laz-perf upgrade to support layered decode (compressor 3), COPC files cannot be rendered. Without COPC hierarchy EVLR parsing, spatial priority is also unavailable.

## What proper COPC support would require

1. **Hierarchy EVLR parsing**: the COPC hierarchy EVLR (user ID "copc", record ID 1000) contains a flat table of octree node entries (VoxelKey + byte offset + byte size + point count, 32 bytes each). Reading this replaces the chunk table + seed fetching with exact spatial metadata per node.
2. **SSE-gated octree traversal**: instead of `ChunkPrioritiser` ranking flat chunks, traverse the octree BFS and stop descending when `node.SSE < threshold`. The prioritiser becomes an octree walker.
3. **No seed trick needed**: the root node IS the overview. `loadSeedPoints` replaced by "load level 0."

This is deferred — COPC support is a side effect of the variable-size ring buffer work, not a primary goal.

---

## See also

- [[Ring Buffer GPU Memory]] — slot sizing; B-2 fixed-slot allocator; B-1 compaction (deferred)
- [[Streaming Engine]] — SSE threshold; pipelineDry override; back-pressure
- [[Spatial Index]] — rbush chunk index; frustum + SSE prioritisation
- [[Decoder Workers]] — pipeline timing; 10–11 s load analysis
