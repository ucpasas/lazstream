---
title: Spatial Index
type: project
status: active
updated: 2026-05-19
tags: [rbush, spatial, frustum-culling, lod, priority-queue, sse, rbush-3d]
---

# Spatial Index

Cross-cutting concern. Informs [[Streaming Engine]] chunk priority and [[Renderer]] draw culling.

Maintains a chunk-level 3D spatial index over the bounding boxes of all chunks in the LAZ file, enabling frustum culling and screen-space-error (SSE) gating without loading point data.

**Phase 3 Track C — Complete.** `rbush-3d@0.0.4` chosen over 2D rbush or custom subclass. `SpatialIndex` class implemented in `src/engine/spatial-index.ts`. Melbourne 2018 (7073 chunks): index built in <50 ms, per-frame queries <1 ms.

---

## Library decision: rbush-3d

`rbush-3d@0.0.4` (MIT licensed, TypeScript types bundled) is a proper algorithmic 3D fork of rbush.

**2D rbush rejected** because terrestrial LiDAR shapes (TLS scans, façade scans) break 2D culling when the camera looks horizontally — chunks at multiple Z heights project to overlapping XY footprints, causing 2D culling to pass all of them as visible regardless of camera direction.

**Custom rbush v4 subclass rejected** because the override surface (`toBBox`, `compareMinX/Y/Z`) doesn't change rbush's underlying algorithmic dimensionality. Achieving real 3D culling would require vendoring ~600 lines.

---

## Implementation: SpatialIndex class

`src/engine/spatial-index.ts` wraps `rbush-3d`. Key API:

```typescript
// Called once after manifest stage completes:
buildFromSeeds(seeds: SeedXYZ[], fileBBox: BBox3D): void

// Called per decoded chunk — tightens the seed-estimate bbox:
updateFromDecoded(chunk: DecodedBBox3D): void

// Called every frame from engine.updateCamera():
queryFrustum(frustumBBox: BBox3D): number[]   // returns chunkIndex[]

// Used by ChunkPrioritiser for SSE calculation:
getEntry(chunkIndex: number): ChunkSpatialEntry | undefined

// Other utilities:
getAllChunkIndices(): number[]
size(): number
tightenedCount(): number
clear(): void
```

Bulk-load via `tree.load(entries)` (OMT packing) — ~2-3× faster than per-item `insert()` and produces a better-balanced tree.

---

## Bbox initialisation

**Important correction from pre-Track C draft:** The draft claimed "LAZ 1.4 stores per-chunk min/max XYZ in the chunk table VLR." This is wrong. LAZ 1.4 chunk tables contain only compressed byte sizes per chunk — no spatial metadata. Per-chunk bboxes are seed-derived initially and refined post-decode.

Initial bbox per chunk (conservative over-estimate):

```typescript
// XY footprint: square side from total-area / chunk-count, padded 1.5×
xyHalf = sqrt(xyArea / seeds.length) * 1.5 * 0.5

// Z extent: half the file's full Z range, centred on seed Z
// (generous for aerial tiled data; roughly tight for terrestrial)
zHalf = (fileBBox.maxZ - fileBBox.minZ) * 0.5
```

On decode completion, the engine calls `updateFromDecoded()` with the true min/max XYZ computed from the chunk's actual points. The index does a remove + re-insert (rbush-3d has no in-place bbox update).

Conservative direction: false positives cost one wasted decode; false negatives leave visible holes. Bias toward over-estimation.

---

## ChunkPrioritiser and SSE threshold

`src/decode/chunk-priority.ts` wraps `SpatialIndex` with frustum-gated, SSE-ranked prioritisation:

1. `queryFrustum(frustumBBox)` → visible chunk indices
2. For each visible undecoded chunk, compute SSE:
   ```
   SSE = (chunkExtent × canvasHeight) / (distance × 2 × tan(fovY/2))
   ```
3. Exclude chunks below `MIN_SSE_THRESHOLD = 1.0`
4. Sort remaining by SSE descending

`MIN_SSE_THRESHOLD = 1.0` is a deliberate constraint for the no-preprocessing architecture. Plain LAZ has binary LOD only — a chunk is either a single seed point or 50,000 decoded points; there is no middle ground. At SSE < 1.0 the chunk occupies less than one pixel vertically; the seed point already represents it adequately at that distance.

**Tuning note:** At Melbourne overview zoom, essentially all 7073 chunks pass `SSE > 1.0`, so the threshold is not currently gating anything. Proper tuning requires Track A back-pressure to be in place first (otherwise the unbounded queue makes the threshold's effect hard to observe).

---

## Renderer-agnostic provider pattern

`StreamingEngine.setCameraProvider(() => {x, y, z})` and `setFrustumProvider(() => BBox3D)` keep the engine free of any Three.js dependency. The renderer registers these callbacks at startup. `updateCamera()` is argless — it calls the providers internally each tick.

Frustum extraction (`getFrustumWorldBBox3D()` in `WebGPURenderer`) projects the 8 NDC frustum corners through the cached `invViewProj` matrix to get world-space corner positions, then computes the AABB. Cached `Float32Array(8 * 3)` buffer reused each frame.

---

## Performance (Melbourne 2018)

| Metric | Value |
|--------|-------|
| Chunks indexed | 7073 |
| Build time | < 50 ms |
| Per-frame query time | < 1 ms |
| Chunks decoded before ring buffer fragmentation | ~447 (~22.35M points) |

---

## Constraints

- Index must be built before any chunks are streamed.
- Per-frame frustum query must complete within 1 ms.
- Do not re-sort the entire queue every frame — only update on camera movement above a threshold.
- All bboxes start as seed-derived estimates; do not assume tight bboxes until `updateFromDecoded()` has been called.

---

## Open questions

- [x] `MIN_SSE_THRESHOLD` value: **resolved** — default raised to 50.0 (aggressive zoom-to-reveal; decode only when meaningfully close). Configurable at runtime via `?sseMin=N`. Wire-through: `StreamingEngine` constructor 4th param → `ChunkPrioritiser` constructor. Note: SSE scales with `canvasHeight`, so a canvas-size-independent threshold (e.g. expressed as a distance ratio) would be more robust but is deferred.
- [ ] Should distance threshold for LOD gating be adaptive to point density?

---

## See also

- [[Manifest Loader]] — provides chunk descriptors with byte offsets
- [[LidarScout Chunk-Seed]] — provides seed XYZ for initial bbox estimates
- [[Streaming Engine]] — consumes priority-sorted chunk list; owns provider callbacks
- [[Renderer]] — provides frustum each frame via `getFrustumWorldBBox3D()`
- [[Ring Buffer GPU Memory]] — ring buffer fragmentation observed at Melbourne scale
