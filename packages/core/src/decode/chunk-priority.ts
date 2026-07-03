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

import type { SpatialIndex, SeedXYZ } from '../engine/spatial-index.js'
import { seedEstimateHalfExtents } from '../engine/spatial-index.js'
import type { BBox3D } from '../types/spatial.js'
import { bboxCentroid3D, bboxExtent3D } from '../types/spatial.js'
import { hilbertIndex2D, quantizeToHilbertGrid } from './hilbert.js'
import { ChunkOctree } from '../engine/chunk-octree.js'

/**
 * Default minimum screen-space error to trigger a full chunk decode.
 *
 * A chunk's SSE is "how many canvas pixels tall the chunk's largest
 * dimension projects to." At the default 50.0 a chunk must project to
 * at least 50 pixels before its seed point is replaced by 50k decoded
 * points — this produces aggressive zoom-to-reveal behaviour; decoding
 * only triggers when you are meaningfully close to the data.
 *
 * Tuning guide:
 *   1.0  — sub-pixel only gate; nearly everything loads at any zoom.
 *   10.0 — eager loading; decode at ~5× the distance of the old 50.0 default.
 *   20.0 — zoom-to-reveal for km-scale files across 1080p–4K displays.
 *   50.0 — aggressive zoom-to-reveal; decode only when close.
 *   100.0 — very aggressive; require very close approach before any decode.
 *
 * Configurable at runtime via ?sseMin=N URL param (see main.ts) and
 * via StreamingEngine constructor for the SDK path.
 */
const DEFAULT_MIN_SSE = 10.0

/**
 * Queue ordering strategy — chunk priority ordering spike.
 *
 * 'sse'     — baseline: sort visible undecoded chunks by SSE descending.
 * 'hilbert' — Candidate A: SSE octave-bucket descending, Hilbert-curve
 *             index (2D XY) ascending within a bucket, so spatially
 *             adjacent chunks cluster in the queue (and therefore in
 *             coalesced fetch batches) regardless of scan order.
 * 'octree'  — Candidate B: near-first octree traversal over seed
 *             centroids with whole-branch frustum pruning and early exit
 *             at maxResults; traversal order IS the priority.
 *
 * All three derive exclusively from seed-phase data + camera/frustum
 * state, keeping the core-extension-contract membership test satisfied.
 */
export type ChunkOrdering = 'sse' | 'hilbert' | 'octree'

/** Seed-phase data needed by the 'hilbert' and 'octree' orderings. */
export interface PrioritiserSeedData {
  seeds: SeedXYZ[]
  fileBBox: BBox3D
}

/**
 * Optional exact-visibility test injected by the renderer (6-plane frustum
 * vs world AABB). The engine-side frustum AABB is deliberately loose
 * (conservative), but at ground-level views it admits chunks the renderer's
 * exact cull immediately rejects — those decode, evict, re-queue, and churn
 * forever. Filtering candidates through the exact test at dispatch breaks
 * that loop. Domain-blind, renderer-agnostic — same provider pattern as
 * camera/frustum/ring-buffer.
 */
export type VisibilityTest = (bbox: BBox3D) => boolean

/** Per-chunk priority result returned to the engine. */
export interface PrioritisedChunk {
  chunkIndex: number
  sse: number
}

/** Internal ranking entry — bucket is only populated for 'hilbert'. */
interface RankedChunk extends PrioritisedChunk {
  bucket: number
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
  private readonly sseThreshold: number
  private readonly ordering: ChunkOrdering
  /** Chunk indices already completed or in-flight. */
  private readonly decoded = new Set<number>()

  /** Candidate A: chunkIndex → Hilbert curve index. Built once from seeds. */
  private hilbert: Map<number, number> | null = null
  /** File bbox for quantising the camera into the Hilbert grid per tick. */
  private hilbertBBox: BBox3D | null = null
  /** Candidate B: octree over seed centroids. Built once from seeds. */
  private octree: ChunkOctree | null = null
  /** Conservative padding for the octree's centroid-vs-frustum test. */
  private octreePad: { xyHalf: number; zHalf: number } = { xyHalf: 0, zHalf: 0 }

  constructor(
    spatial: SpatialIndex,
    sseThreshold?: number,
    ordering: ChunkOrdering = 'sse',
    seedData?: PrioritiserSeedData,
  ) {
    this.spatial = spatial
    this.sseThreshold = sseThreshold ?? DEFAULT_MIN_SSE

    if (ordering !== 'sse' && !seedData) {
      console.warn(`[lazstream] ordering '${ordering}' needs seed data — falling back to 'sse'`)
      ordering = 'sse'
    }
    this.ordering = ordering

    if (ordering === 'hilbert' && seedData) {
      const t0 = performance.now()
      const { seeds, fileBBox } = seedData
      this.hilbertBBox = fileBBox
      this.hilbert = new Map()
      for (const s of seeds) {
        const qx = quantizeToHilbertGrid(s.x, fileBBox.minX, fileBBox.maxX)
        const qy = quantizeToHilbertGrid(s.y, fileBBox.minY, fileBBox.maxY)
        this.hilbert.set(s.chunkIndex, hilbertIndex2D(qx, qy))
      }
      console.debug(
        `[lazstream] hilbert order: indexed ${seeds.length} chunks ` +
        `in ${(performance.now() - t0).toFixed(1)} ms`
      )
    } else if (ordering === 'octree' && seedData) {
      const { seeds, fileBBox } = seedData
      this.octreePad = seedEstimateHalfExtents(seeds.length, fileBBox)
      this.octree = new ChunkOctree(
        seeds.map(s => ({ chunkIndex: s.chunkIndex, x: s.x, y: s.y, z: s.z })),
      )
      console.debug(
        `[lazstream] octree order: ${this.octree.nodeCount} nodes over ` +
        `${seeds.length} chunks built in ${this.octree.buildMs.toFixed(1)} ms`
      )
    }
  }

  /** Mark a chunk as decoded (or in-flight) to exclude it from future queues. */
  setDecoded(chunkIndex: number): void {
    this.decoded.add(chunkIndex)
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
    visibility?: VisibilityTest,
  ): PrioritisedChunk[] {
    // Standard perspective camera pixel-projection scale.
    const pixelScale = camera.canvasHeight / (2 * Math.tan(camera.fovY * 0.5))

    if (this.ordering === 'octree' && this.octree) {
      return this.prioritiseOctree(frustumBBox, camera, pixelScale, maxResults, visibility)
    }

    const visibleIndices = this.spatial.queryFrustum(frustumBBox)
    if (visibleIndices.length === 0) return []

    const ranked: RankedChunk[] = []
    for (let i = 0; i < visibleIndices.length; i++) {
      const idx = visibleIndices[i]
      if (this.decoded.has(idx)) continue

      const entry = this.spatial.getEntry(idx)
      if (!entry) continue

      const sse = this.sseFromEntry(entry, camera, pixelScale)

      // Key gate: below threshold the seed point is the right representation.
      // Not zero-scored, not deferred — excluded entirely.
      if (sse < this.sseThreshold) continue

      // Exact-cull gate (when the renderer provides one): don't dispatch
      // chunks the renderer would immediately cull and evict.
      if (visibility && !visibility(entry)) continue

      ranked.push({ chunkIndex: idx, sse, bucket: 0 })
    }

    if (this.ordering === 'hilbert' && this.hilbert && this.hilbertBBox) {
      // SSE octave buckets keep "much more important" chunks first while
      // the Hilbert index dominates among peers, so each dispatch batch is
      // spatially (and, for flight-line scan order, byte-) coherent.
      //
      // Within a bucket, order by |curve distance from the CAMERA's grid
      // cell|, not by absolute index — absolute order always walks the
      // queue from the curve's origin corner of the file, which starves
      // the region actually under the camera (measured: 99% wasted-fetch
      // on the Melbourne pan path; see wiki spike page).
      const h = this.hilbert
      const bb = this.hilbertBBox
      const camH = hilbertIndex2D(
        quantizeToHilbertGrid(camera.worldX, bb.minX, bb.maxX),
        quantizeToHilbertGrid(camera.worldY, bb.minY, bb.maxY),
      )
      for (const r of ranked) r.bucket = Math.floor(Math.log2(r.sse))
      ranked.sort((a, b) =>
        a.bucket !== b.bucket
          ? b.bucket - a.bucket
          : Math.abs((h.get(a.chunkIndex) ?? 0) - camH) -
            Math.abs((h.get(b.chunkIndex) ?? 0) - camH),
      )
    } else {
      ranked.sort((a, b) => b.sse - a.sse)
    }

    if (maxResults !== Infinity && ranked.length > maxResults) {
      ranked.length = maxResults
    }
    return ranked
  }

  /**
   * Candidate B: derive priority from a near-first octree walk instead of
   * sorting the flat visible list. Whole off-frustum branches are pruned
   * in one AABB test, and traversal stops as soon as maxResults candidates
   * have passed the SSE gate — no full-file scan per tick.
   */
  private prioritiseOctree(
    frustumBBox: BBox3D,
    camera: CameraInfo,
    pixelScale: number,
    maxResults: number,
    visibility?: VisibilityTest,
  ): PrioritisedChunk[] {
    // The tree holds centroids; inflate the query so a chunk whose
    // conservative bbox straddles the frustum edge still qualifies.
    const q = {
      minX: frustumBBox.minX - this.octreePad.xyHalf,
      minY: frustumBBox.minY - this.octreePad.xyHalf,
      minZ: frustumBBox.minZ - this.octreePad.zHalf,
      maxX: frustumBBox.maxX + this.octreePad.xyHalf,
      maxY: frustumBBox.maxY + this.octreePad.xyHalf,
      maxZ: frustumBBox.maxZ + this.octreePad.zHalf,
    }

    const out: PrioritisedChunk[] = []
    this.octree!.traverse(q, camera.worldX, camera.worldY, camera.worldZ, (item) => {
      if (this.decoded.has(item.chunkIndex)) return true

      const entry = this.spatial.getEntry(item.chunkIndex)
      if (!entry) return true

      const sse = this.sseFromEntry(entry, camera, pixelScale)
      if (sse < this.sseThreshold) return true

      if (visibility && !visibility(entry)) return true

      out.push({ chunkIndex: item.chunkIndex, sse })
      return out.length < maxResults
    })
    return out
  }

  /** SSE for one chunk from its (possibly tightened) spatial-index bbox. */
  private sseFromEntry(entry: BBox3D, camera: CameraInfo, pixelScale: number): number {
    const c = bboxCentroid3D(entry)
    const dx = c.x - camera.worldX
    const dy = c.y - camera.worldY
    const dz = c.z - camera.worldZ
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const safeDist = Math.max(distance, 1)  // avoid div-by-zero when camera inside chunk

    return (bboxExtent3D(entry) * pixelScale) / safeDist
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

  /** Remove a chunk from the decoded set so the engine will re-fetch it.
   *  Called when the GPU ring buffer proactively evicts an invisible chunk. */
  removeDecoded(chunkIndex: number): void {
    this.decoded.delete(chunkIndex)
  }
}