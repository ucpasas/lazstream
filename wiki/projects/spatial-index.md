---
title: Spatial Index
type: project
status: draft
updated: 2026-05-09
tags: [rbush, spatial, frustum-culling, lod, priority-queue]
---

# Spatial Index

Cross-cutting concern. Informs [[Streaming Engine]] chunk priority and [[Renderer]] draw culling.

Maintains a chunk-level spatial index (rbush R-tree) over the bounding boxes of all chunks in the LAZ file, enabling frustum culling and distance-based LOD without loading point data.

---

## Responsibilities

1. On manifest load: build an rbush index over all `ChunkDescriptor` bounding boxes.
   - Bounding box per chunk: derived from the chunk table (LAZ 1.4 stores min/max XYZ per chunk) or estimated from the first point of each chunk (LidarScout seed, see [[LidarScout Chunk-Seed]]).
2. Per frame: receive the camera frustum from [[Renderer]], query rbush for visible chunks.
3. Emit a sorted `ChunkDescriptor[]` priority list to [[Streaming Engine]] (visible + nearest first).
4. Support LOD gating: at low zoom levels, skip chunks beyond a distance threshold.

---

## rbush integration

- Library: `rbush` (2D or 3D, project-configurable).
- Insert: one entry per chunk with `{ minX, minY, minZ, maxX, maxY, maxZ, chunkIndex }`.
- Query: `rbush.search(frustumBBox)` returns candidate chunks; refine with per-plane frustum test.
- Rebuild: not needed mid-session (chunk table is static for a given file).

---

## Bounding box source

| LAZ version | Chunk bbox source |
|-------------|-------------------|
| 1.4 | Chunk table VLR stores per-chunk min/max XYZ |
| 1.2/1.3 | No chunk table; estimate from LidarScout seed point (point 0 of each chunk) |

For 1.2/1.3 files, bounding boxes are approximate until the chunk is decoded. After decode, update the rbush entry with the true bbox.

---

## Priority ordering

For the streaming engine queue, chunks are scored as:

```
score = inFrustum ? (1 / distance_to_camera) : 0
```

Chunks with `score === 0` are not streamed until they enter the frustum.

---

## Constraints

- rbush index must be built before any chunks are streamed.
- Per-frame frustum query must complete within 1 ms (rbush is fast; budget is generous).
- Do not re-sort the entire queue every frame — only update on camera movement above a threshold.

---

## Open questions

- [ ] 2D rbush (XY only, ignore Z) vs 3D rbush — relevant for dense urban datasets with tall buildings?
- [ ] Should distance threshold for LOD gating be adaptive to point density?

---

## See also

- [[Manifest Loader]] — provides `ChunkDescriptor[]` with byte offsets
- [[LidarScout Chunk-Seed]] — provides estimated bboxes for 1.2/1.3 files
- [[Streaming Engine]] — consumes priority-sorted chunk list
- [[Renderer]] — provides frustum each frame
