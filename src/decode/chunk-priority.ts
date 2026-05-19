/**
 * ChunkPrioritiser — Phase 3 Track C
 *
 * Frustum-gated, SSE-ranked chunk prioritisation. Replaces the Phase 2
 * inverse-distance prioritiser.
 *
 * Flow:
 *   1. SpatialIndex.queryFrustum(frustumBBox) → visible chunk indices
 *   2. For each visible undecoded chunk, compute screen-space error:
 *        SSE = (chunkExtent × canvasHeight) / (distance × 2 × tan(fovY/2))
 *   3. Drop chunks below MIN_SSE_THRESHOLD — seed point is adequate at
 *      that zoom level (plain LAZ has binary LOD only; see wiki [[Spatial Index]]).
 *   4. Sort by SSE descending.
 *
 * Off-frustum chunks aren't returned at all (not zero-scored, excluded).
 * When the camera moves, they may re-enter visibility and join the queue
 * on the next updateCamera() tick.
 */

import type { SpatialIndex } from '../engine/spatial-index.js'
import type { BBox3D } from '../types/spatial.js'
import { bboxCentroid3D, bboxExtent3D } from '../types/spatial.js'

/**
 * Minimum screen-space error to trigger a full chunk decode.
 *
 * A chunk's SSE is roughly "how many canvas pixels tall the chunk's
 * largest dimension projects to." At SSE < 1.0 the chunk occupies less
 * than one pixel of vertical canvas space — decoding 50k points to
 * contribute sub-pixel geometry is wasted work; the seed point already
 * represents the chunk adequately at that distance.
 *
 * Tuning guide:
 *   1.0  — conservative; seeds visible until quite close. Default.
 *   2.0  — earlier decode, smoother seed→full transition.
 *   0.5  — later decode, more frame budget for nearby chunks.
 *
 * Exposed as a named constant so the engine can make it configurable via
 * LazStreamViewer options in a future SDK pass.
 */
export const MIN_SSE_THRESHOLD = 1.0

/** Per-chunk priority result returned to the engine. */
export interface PrioritisedChunk {
  chunkIndex: number
  sse: number
}

/** Camera + viewport info needed to compute SSE. Provided by the renderer
 *  via setCameraProvider() on the engine. */
export interface CameraInfo {
  /** Camera position in WORLD coordinates (not scene-local). */
  worldX: number
  worldY: number
  worldZ: number
  /** Vertical field of view in radians. */
  fovY: number
  /** Canvas height in pixels — calibrates the SSE pixel scale. */
  canvasHeight: number
}

export class ChunkPrioritiser {
  private readonly spatial: SpatialIndex
  /** Chunk indices already completed or in-flight. */
  private readonly decoded = new Set<number>()

  constructor(spatial: SpatialIndex) {
    this.spatial = spatial
  }

  /** Mark a chunk as decoded (or in-flight) to exclude it from future queues. */
  setDecoded(chunkIndex: number): void {
    this.decoded.add(chunkIndex)
  }

  /** Bulk-mark — used by engine when restoring from IndexedDB cache (Phase 3 Track D). */
  setManyDecoded(indices: Iterable<number>): void {
    for (const i of indices) this.decoded.add(i)
  }

  /** Reset decoded set. Called on engine.load(). */
  reset(): void {
    this.decoded.clear()
  }

  /**
   * Rank visible, undecoded chunks by SSE, highest first.
   * Chunks below MIN_SSE_THRESHOLD are excluded entirely — seed point
   * is adequate at that zoom level.
   *
   * @param frustumBBox  world-space 3D AABB of the camera frustum
   * @param camera       world-space camera position + fovY + canvasHeight
   * @param maxResults   cap on results (Infinity for no cap)
   */
  prioritise(
    frustumBBox: BBox3D,
    camera: CameraInfo,
    maxResults: number = Infinity,
  ): PrioritisedChunk[] {
    const visibleIndices = this.spatial.queryFrustum(frustumBBox)
    if (visibleIndices.length === 0) return []

    // Standard perspective camera pixel-projection scale.
    const pixelScale = camera.canvasHeight / (2 * Math.tan(camera.fovY * 0.5))

    const ranked: PrioritisedChunk[] = []
    for (let i = 0; i < visibleIndices.length; i++) {
      const idx = visibleIndices[i]
      if (this.decoded.has(idx)) continue

      const entry = this.spatial.getEntry(idx)
      if (!entry) continue

      const c = bboxCentroid3D(entry)
      const dx = c.x - camera.worldX
      const dy = c.y - camera.worldY
      const dz = c.z - camera.worldZ
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const safeDist = Math.max(distance, 1)  // avoid div-by-zero when camera inside chunk

      const extent = bboxExtent3D(entry)
      const sse = (extent * pixelScale) / safeDist

      // Key gate: below threshold the seed point is the right representation.
      // Not zero-scored, not deferred — excluded entirely.
      if (sse < MIN_SSE_THRESHOLD) continue

      ranked.push({ chunkIndex: idx, sse })
    }

    ranked.sort((a, b) => b.sse - a.sse)

    if (maxResults !== Infinity && ranked.length > maxResults) {
      ranked.length = maxResults
    }
    return ranked
  }

  /**
   * All undecoded chunk indices.
   *
   * Note: this bypasses MIN_SSE_THRESHOLD intentionally. Used by
   * decodeAll() which is a "load everything" stress-test / future
   * cache-warmup tool, not a user-facing control.
   */
  allUndecoded(): number[] {
    const all = this.spatial.getAllChunkIndices()
    return all.filter(i => !this.decoded.has(i))
  }

  /** Debug stat. */
  decodedCount(): number {
    return this.decoded.size
  }
}