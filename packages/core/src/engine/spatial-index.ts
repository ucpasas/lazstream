/**
 * SpatialIndex — Phase 3 Track C
 *
 * Chunk-level 3D spatial index over rbush-3d. Used by ChunkPrioritiser to
 * gate decode requests on frustum visibility and (via SSE) projected pixel
 * size. The per-point compute shader still does final 3D frustum culling
 * inside chunks — this is a CPU-side coarse filter that prevents decoding
 * chunks the camera can't see.
 *
 * Lifecycle:
 *   1. buildFromSeeds(seeds, fileBBox) — once, after seeds arrive.
 *   2. updateFromDecoded(chunk) — per chunk as workers finish.
 *      Replaces the seed-estimate bbox with the chunk's true min/max XYZ
 *      from the worker's quantisation pass.
 *   3. queryFrustum(frustumBBox3D) — every frame from engine.updateCamera().
 *   4. getEntry(chunkIndex) — used by ChunkPrioritiser for SSE.
 *
 * 3D (not 2D) because terrestrial LiDAR shapes (TLS, façade scans) have
 * non-trivial Z extent — a 2D index would admit building chunks at
 * different elevations as visible regardless of camera direction. See wiki
 * [[Spatial Index]] for the full rationale.
 */

import { RBush3D } from 'rbush-3d'
import type { BBox3D, ChunkSpatialEntry } from '../types/spatial.js'

// rbush-3d entries must extend the 3D bbox shape. We add chunkIndex + tight
// as user fields; rbush-3d preserves arbitrary properties on stored items.
interface RBush3DEntry {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  chunkIndex: number
  tight: boolean
}

/** Seed point with chunk index and world XYZ. */
export interface SeedXYZ {
  chunkIndex: number
  x: number
  y: number
  z: number
}

/**
 * Conservative per-chunk half-extents for seed-estimate bboxes.
 * Shared by buildFromSeeds() and the octree ordering path in
 * ChunkPrioritiser (which inflates its frustum query by these values) so
 * the two estimates can never diverge.
 *
 * XY: square side from total-area / chunk-count, padded 1.5×.
 * Z:  half the file's full Z range (generous for aerial tiled data,
 *     roughly tight for terrestrial scans).
 */
export function seedEstimateHalfExtents(
  seedCount: number,
  fileBBox: BBox3D,
): { xyHalf: number; zHalf: number } {
  const xyArea = Math.max(
    1,
    (fileBBox.maxX - fileBBox.minX) * (fileBBox.maxY - fileBBox.minY),
  )
  return {
    xyHalf: Math.sqrt(xyArea / Math.max(1, seedCount)) * 1.5 * 0.5,
    zHalf: (fileBBox.maxZ - fileBBox.minZ) * 0.5,
  }
}

/** What updateFromDecoded() needs from a decoded chunk. Subset of DecodedChunk. */
export interface DecodedBBox3D {
  chunkIndex: number
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

export class SpatialIndex {
  private tree: RBush3D
  private readonly byIndex = new Map<number, RBush3DEntry>()

  constructor() {
    // Node size 16 — rbush-3d default. Tuned for bulk-load + many-query.
    this.tree = new RBush3D(16)
  }

  /**
   * Build the index from seed points. Each chunk gets an over-conservative
   * cuboid centred on its seed. Call once after seed extraction completes.
   *
   * Conservative direction matters: false positives cost one wasted decode
   * (cheap); false negatives leave visible holes (bad). Bias toward
   * over-estimation.
   *
   * @param seeds     one entry per chunk with the seed point's world XYZ
   * @param fileBBox  full file XYZ bbox from the LAS header (world doubles)
   */
  buildFromSeeds(seeds: SeedXYZ[], fileBBox: BBox3D): void {
    this.tree.clear()
    this.byIndex.clear()

    if (seeds.length === 0) return

    const { xyHalf, zHalf } = seedEstimateHalfExtents(seeds.length, fileBBox)

    const entries: RBush3DEntry[] = seeds.map(s => ({
      minX: s.x - xyHalf,
      minY: s.y - xyHalf,
      minZ: s.z - zHalf,
      maxX: s.x + xyHalf,
      maxY: s.y + xyHalf,
      maxZ: s.z + zHalf,
      chunkIndex: s.chunkIndex,
      tight: false,
    }))

    for (const e of entries) this.byIndex.set(e.chunkIndex, e)

    // Bulk-load via load() — uses OMT packing. ~2-3× faster than per-item
    // insert() and produces a better-balanced tree.
    this.tree.load(entries)
  }

  /**
   * Replace a chunk's seed-estimate bbox with the tight bbox from its
   * decoded data. Fires once per chunk as workers complete.
   */
  updateFromDecoded(chunk: DecodedBBox3D): void {
    const existing = this.byIndex.get(chunk.chunkIndex)
    if (!existing) return        // chunk not in seed set; defensive
    if (existing.tight) return   // already tightened

    // rbush-3d has no in-place "update bbox" — remove + re-insert. The
    // remove() compares all bbox fields by default, so passing the live
    // entry object works without a custom equals fn.
    this.tree.remove(existing)

    const replacement: RBush3DEntry = {
      minX: chunk.minX, minY: chunk.minY, minZ: chunk.minZ,
      maxX: chunk.maxX, maxY: chunk.maxY, maxZ: chunk.maxZ,
      chunkIndex: chunk.chunkIndex,
      tight: true,
    }
    this.tree.insert(replacement)
    this.byIndex.set(chunk.chunkIndex, replacement)
  }

  /**
   * Query for chunks whose 3D bbox intersects the given frustum AABB.
   * Returns chunkIndex[] in tree iteration order; prioritiser sorts.
   */
  queryFrustum(frustumBBox: BBox3D): number[] {
    const hits = this.tree.search(frustumBBox) as RBush3DEntry[]
    const out = new Array<number>(hits.length)
    for (let i = 0; i < hits.length; i++) out[i] = hits[i].chunkIndex
    return out
  }

  /** All chunk indices — used by engine's decodeAll() flow. */
  getAllChunkIndices(): number[] {
    return Array.from(this.byIndex.keys())
  }

  /** Look up an entry's bbox + tightness. Returns a copy; mutations don't
   *  propagate back to the tree. */
  getEntry(chunkIndex: number): ChunkSpatialEntry | undefined {
    const e = this.byIndex.get(chunkIndex)
    if (!e) return undefined
    return {
      minX: e.minX, minY: e.minY, minZ: e.minZ,
      maxX: e.maxX, maxY: e.maxY, maxZ: e.maxZ,
      chunkIndex: e.chunkIndex,
      tight: e.tight,
    }
  }

  /** Number of entries in the index. */
  size(): number {
    return this.byIndex.size
  }

  /** Wipe everything. Called on engine load() / dispose(). */
  clear(): void {
    this.tree.clear()
    this.byIndex.clear()
  }
}