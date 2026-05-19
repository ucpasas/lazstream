/**
 * Shared spatial types — Phase 3 Track C
 *
 * 3D throughout. The SDK supports both aerial and terrestrial LiDAR data
 * shapes; 2D would silently fail on terrestrial cases (building scans with
 * XY-overlapping chunks at different elevations). See wiki [[Spatial Index]]
 * for the full rationale.
 */

/** Axis-aligned 2D bounding box. Used for renderer↔engine 2D operations
 *  that don't involve the spatial index. */
export interface BBox2D {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Axis-aligned 3D bounding box. The spatial index uses this exclusively. */
export interface BBox3D {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

/** Single chunk entry stored in the spatial index. Extends BBox3D so it can
 *  be passed straight to rbush-3d's insert/load/remove/search APIs. */
export interface ChunkSpatialEntry extends BBox3D {
  chunkIndex: number
  /** True once tightened from a decoded chunk; false while still a seed estimate. */
  tight: boolean
}

// ---- 3D bbox helpers --------------------------------------------------------

export function unionBBox3D(a: BBox3D, b: BBox3D): BBox3D {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

export function bboxCentroid3D(b: BBox3D): { x: number; y: number; z: number } {
  return {
    x: (b.minX + b.maxX) * 0.5,
    y: (b.minY + b.maxY) * 0.5,
    z: (b.minZ + b.maxZ) * 0.5,
  }
}

/** Max extent (longest side) of a 3D bbox. Used as chunkExtent in SSE. */
export function bboxExtent3D(b: BBox3D): number {
  return Math.max(
    b.maxX - b.minX,
    b.maxY - b.minY,
    b.maxZ - b.minZ,
  )
}

export function bboxVolume3D(b: BBox3D): number {
  return (
    Math.max(0, b.maxX - b.minX) *
    Math.max(0, b.maxY - b.minY) *
    Math.max(0, b.maxZ - b.minZ)
  )
}

export function intersectsBBox3D(a: BBox3D, b: BBox3D): boolean {
  return (
    a.minX <= b.maxX && a.maxX >= b.minX &&
    a.minY <= b.maxY && a.maxY >= b.minY &&
    a.minZ <= b.maxZ && a.maxZ >= b.minZ
  )
}