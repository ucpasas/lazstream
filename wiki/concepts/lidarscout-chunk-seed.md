---
title: LidarScout Chunk-Seed
type: concept
status: active
updated: 2026-05-10
tags: [lidarscout, overview, seeding, sparse-sampling, instant-preview]
---

# LidarScout Chunk-Seed

A technique for generating an instant sparse overview of a LAZ point cloud before any full chunks are decoded, by fetching one raw point from each chunk.

**Phase 1 status:** Proven. 380 seed points from a 19M-point file render the full survey area with correct geographic positioning and elevation colour.

---

## Problem

Large LAZ files (10–100 GB) take minutes to fully stream and decode. Users need visual feedback immediately to confirm correct data and orient the camera.

---

## Technique

1. From the chunk table, read the byte offset of each chunk's first point.
2. Issue small range requests to fetch one raw (uncompressed) point per chunk.
3. Apply scale + offset from the LAS header to get world-space XYZ.
4. Render as a sparse `Points` object — no laz-perf decoding needed.

For fixed-size chunks (`lazVlr.chunkSize > 0`, the PDAL default), the seed point starts at exactly `chunkOffset + 0`. For variable-size chunks (`chunkSize === 0`, COPC), there is a 4-byte point count prefix so the seed starts at `chunkOffset + 4`. See [[LAZ Format]] Discovery 2.

---

## Phase 1 performance (USGS Central Texas, 380 chunks, HTTP/1.1)

| Metric | Value |
|--------|-------|
| Seed points fetched | 380 |
| Valid seeds rendered | ~300 (some chunks at file edge are smaller) |
| Fetch time | 3–4 s (380 × ~30 byte requests, batched 6, HTTP/1.1) |
| Render time | < 5 ms |
| GPU memory | < 10 MB |
| FPS | 144 fps |

The dominant cost in Phase 1 is HTTP/1.1's 6-connection limit forcing ~64 sequential round trips. Phase 2's range coalescing will collapse this to O(1) round trips.

---

## Why "chunk-seed"?

Each seed point is the first stored point of a chunk. For randomly distributed point clouds, seeds are approximately uniformly distributed. For tiled/sorted data (e.g., ground-classified), seeds may cluster — acceptable for an overview.

---

## Bandwidth cost

For a file with N chunks at default PDAL chunk size (50,000 points × ~20 bytes/point ≈ 1 MB/chunk):

- Seed cost per chunk: ~30 bytes (one raw PDRF 6 point record)
- For 380 chunks: ~11 KB total (vs. ~61 MB for the full file)

---

## Phase 2 improvement: range coalescing

In Phase 2 the seed requests will be coalesced: since chunk offsets are known from the chunk table, a single range request can span the full file and return strided bytes at each chunk boundary. This reduces seed TTFF from 3–4 s to < 500 ms regardless of HTTP/1.1 vs HTTP/2.

---

## Integration points

- **[[Manifest Loader]]**: after decoding the chunk table, immediately compute `seedByteOffset` per chunk and emit seed requests.
- **[[Streaming Engine]]**: seed requests get highest priority — scheduled before any full-chunk requests.
- **[[Decoder Workers]]**: seed points bypass the normal worker pool — decoded inline (single raw point, no laz-perf needed).
- **[[Spatial Index]]**: seed positions provide approximate chunk centroids for LOD prioritisation.
- **[[Renderer]]**: Phase 1 renders seeds as a standalone `THREE.Points` object with elevation colour mapping; Phase 2 replaces per chunk as full data arrives.

---

## Open questions

- [ ] Should seed points be cached in [[Chunk Caching]]? (Very cheap to re-fetch; probably not worth the write overhead.)
- [ ] LAZ 1.2/1.3 seed offset: `seedByteOffset = 0` is correct in theory (they predate variable chunks) but has not been tested against a real LAZ 1.2/1.3 file.

---

## See also

- [[LAZ Format]] — Discovery 2: fixed vs. variable chunk prefix rule
- [[Manifest Loader]] — chunk table provides first-point byte offsets
- [[Streaming Engine]] — prioritises seed requests
- [[Arithmetic Decoder]] — decodes the chunk table to get seed offsets
- [[Spatial Index]] — uses seed points for approximate chunk bboxes (1.2/1.3)
- [[Renderer]] — renders seed point cloud as instant overview
