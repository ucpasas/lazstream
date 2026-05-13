/**
 * Chunk Prioritiser
 *
 * Ranks chunks by visual importance based on camera position.
 * Used by the streaming engine to decide which chunks to submit
 * to the worker pool first.
 *
 * Phase 2 uses a simple distance-based priority:
 *   priority = 1 / distance_to_camera
 *
 * Phase 3+ will upgrade to full screen-space error (SSE):
 *   SSE = (geometricError × canvasHeight) / (distance × 2 × tan(fov/2))
 *
 * The prioritiser operates on seed points (one per chunk) from Phase 1.
 * It does NOT modify the seed points — it produces a sorted index.
 */

import type { SeedPoint } from '../types/las.js'
import type { ChunkTableEntry } from '../engine/chunk-table.js'

export interface PrioritisedChunk {
  chunkIndex: number
  chunk: ChunkTableEntry
  priority: number        // higher = more important
  distanceToCamera: number
}

export class ChunkPrioritiser {
  private seeds: SeedPoint[]
  private chunks: ChunkTableEntry[]
  private sceneCenterX: number
  private sceneCenterY: number
  private sceneCenterZ: number

  constructor(
    seeds: SeedPoint[],
    chunks: ChunkTableEntry[],
    sceneCenterX: number,
    sceneCenterY: number,
    sceneCenterZ: number,
  ) {
    this.seeds = seeds
    this.chunks = chunks
    this.sceneCenterX = sceneCenterX
    this.sceneCenterY = sceneCenterY
    this.sceneCenterZ = sceneCenterZ
  }

  /**
   * Return chunks sorted by priority (highest first) given a camera position.
   *
   * Camera position is in WORLD coordinates (not scene-relative).
   * The prioritiser converts to scene-relative internally using the
   * scene center established during seed point loading.
   *
   * @param cameraWorldX - Camera X in world coordinates
   * @param cameraWorldY - Camera Y in world coordinates
   * @param cameraWorldZ - Camera Z in world coordinates
   * @param maxResults - Maximum number of chunks to return (default: all)
   * @param excludeDecoded - Set of chunk indices already decoded (skip these)
   */
  prioritise(
    cameraWorldX: number,
    cameraWorldY: number,
    cameraWorldZ: number,
    maxResults?: number,
    excludeDecoded?: Set<number>,
  ): PrioritisedChunk[] {
    const results: PrioritisedChunk[] = []

    for (let i = 0; i < this.seeds.length; i++) {
      const seed = this.seeds[i]
      const chunkIndex = seed.chunkIndex

      // Skip already decoded chunks
      if (excludeDecoded?.has(chunkIndex)) continue

      // Skip chunks whose index exceeds the chunk table
      if (chunkIndex >= this.chunks.length) continue

      // Distance from camera to seed point (world coordinates)
      const dx = seed.x - cameraWorldX
      const dy = seed.y - cameraWorldY
      const dz = seed.z - cameraWorldZ
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

      // Priority = inverse distance (closer = higher priority)
      // Add small epsilon to prevent division by zero if camera is on a seed
      const priority = 1 / (dist + 0.001)

      results.push({
        chunkIndex,
        chunk: this.chunks[chunkIndex],
        priority,
        distanceToCamera: dist,
      })
    }

    // Sort by priority descending (highest first = closest chunks)
    results.sort((a, b) => b.priority - a.priority)

    // Return top N if requested
    if (maxResults !== undefined && maxResults < results.length) {
      return results.slice(0, maxResults)
    }

    return results
  }

  /**
   * Get the world-space position of the scene center.
   * Used by the renderer to convert between world and scene-relative coords.
   */
  getSceneCenter(): { x: number; y: number; z: number } {
    return {
      x: this.sceneCenterX,
      y: this.sceneCenterY,
      z: this.sceneCenterZ,
    }
  }
}