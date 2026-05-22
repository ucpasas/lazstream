/**
 * Manifest format types — .lazm.json schema v1.0
 *
 * A manifest describes a set of LAZ tiles to load as a unified point cloud.
 * Single .laz URLs are wrapped in a synthetic one-tile manifest by the loader.
 */

/** A single LAZ tile entry in a .lazm.json manifest. */
export interface TileEntry {
  /** LAZ file URL. Must be https: (or http: on localhost). */
  url: string

  /**
   * Optional pre-known bounding box in the file's native CRS coordinates.
   * Currently parsed and stored but not yet used to skip header fetches.
   * Phase 3: when present, header fetch for bounds is skipped.
   */
  bounds?: {
    min: [number, number, number]
    max: [number, number, number]
  }

  /**
   * Approximate total point count for progress estimation.
   * Not validated against actual file contents.
   */
  points?: number

  /**
   * CRS of this tile as an EPSG code or PROJ string (e.g. "EPSG:28355").
   * Currently stored but not used for reprojection — all tiles assumed same CRS.
   * Reprojection across tiles is planned for Phase 3.
   */
  srs?: string
}

/** A parsed and validated .lazm.json manifest. */
export interface Manifest {
  /** Schema version. Must be "1.0". */
  version: '1.0'

  /** Tile list. At least one entry required. */
  tiles: TileEntry[]

  /**
   * Human-readable dataset name (e.g. "Melbourne 2018 LiDAR").
   * Shown in the viewer stats overlay.
   */
  name?: string

  /**
   * Attribution text (e.g. "City of Melbourne (CC BY 4.0)").
   * Shown in the viewer footer. Required by some dataset licences.
   */
  attribution?: string

  /**
   * Default CRS for tiles with no per-tile srs.
   * Stored but not used for reprojection until Phase 3.
   */
  srs?: string
}
