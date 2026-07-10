/**
 * ChunkOctree — chunk priority ordering spike (Candidate B).
 *
 * Coarse client-side octree over seed centroids, built once per load after
 * the seed fetch completes. ChunkPrioritiser traverses it near-first with
 * whole-branch frustum pruning to derive chunk priority, instead of sorting
 * the flat rbush query result.
 *
 * The tree stores centroids, not chunk bboxes — callers must inflate the
 * query AABB by the conservative seed half-extents (see
 * seedEstimateHalfExtents in spatial-index.ts) so a chunk whose centroid
 * sits just outside the frustum still qualifies. Centroids never move, so
 * the tree needs no maintenance as decoded chunks tighten their bboxes in
 * the spatial index (decoded chunks are excluded from prioritisation
 * anyway; see wiki spike page for the eviction-edge-case caveat).
 */

/** One chunk centroid. x/y/z are world coordinates of the seed point. */
export interface OctreeItem {
  chunkIndex: number
  x: number
  y: number
  z: number
}

interface QueryBBox {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
}

interface OctreeNode {
  // Tight bounds of contained centroids.
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
  children: OctreeNode[] | null
  /** Leaf payload; null on internal nodes. */
  items: OctreeItem[] | null
}

/** Leaf capacity. 32 → ~220 leaves for Melbourne's 7073 chunks. */
const DEFAULT_LEAF_SIZE = 32
/** Depth cap guards against pathological co-located centroids. */
const DEFAULT_MAX_DEPTH = 12

export class ChunkOctree {
  private readonly root: OctreeNode | null
  private nodes = 0
  readonly buildMs: number

  constructor(
    items: OctreeItem[],
    options: { leafSize?: number; maxDepth?: number } = {},
  ) {
    const leafSize = options.leafSize ?? DEFAULT_LEAF_SIZE
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
    const t0 = performance.now()
    this.root = items.length > 0 ? this.build(items, 0, leafSize, maxDepth) : null
    this.buildMs = performance.now() - t0
  }

  get nodeCount(): number {
    return this.nodes
  }

  /**
   * Near-first DFS over centroids intersecting queryBBox (which must
   * already include conservative padding). Children are visited in order
   * of camera distance to their bounds; leaf items in order of camera
   * distance to their centroid — an approximate front-to-back walk in the
   * spirit of COPC's octree traversal.
   *
   * visit() returns false to stop the whole traversal (early exit once the
   * caller has enough candidates — this is where the octree beats sorting
   * the full flat list every tick).
   */
  traverse(
    queryBBox: QueryBBox,
    camX: number,
    camY: number,
    camZ: number,
    visit: (item: OctreeItem) => boolean,
  ): void {
    if (this.root) this.walk(this.root, queryBBox, camX, camY, camZ, visit)
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private build(
    items: OctreeItem[],
    depth: number,
    leafSize: number,
    maxDepth: number,
  ): OctreeNode {
    this.nodes++

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const it of items) {
      if (it.x < minX) minX = it.x
      if (it.y < minY) minY = it.y
      if (it.z < minZ) minZ = it.z
      if (it.x > maxX) maxX = it.x
      if (it.y > maxY) maxY = it.y
      if (it.z > maxZ) maxZ = it.z
    }

    if (items.length <= leafSize || depth >= maxDepth) {
      return { minX, minY, minZ, maxX, maxY, maxZ, children: null, items }
    }

    const midX = (minX + maxX) * 0.5
    const midY = (minY + maxY) * 0.5
    const midZ = (minZ + maxZ) * 0.5

    const octants: OctreeItem[][] = [[], [], [], [], [], [], [], []]
    for (const it of items) {
      const oct =
        (it.x >= midX ? 1 : 0) | (it.y >= midY ? 2 : 0) | (it.z >= midZ ? 4 : 0)
      octants[oct].push(it)
    }

    // Degenerate split (all centroids co-located on the split planes) —
    // fall back to a leaf rather than recursing forever.
    let nonEmpty = 0
    for (const o of octants) if (o.length > 0) nonEmpty++
    if (nonEmpty <= 1) {
      return { minX, minY, minZ, maxX, maxY, maxZ, children: null, items }
    }

    const children: OctreeNode[] = []
    for (const o of octants) {
      if (o.length > 0) children.push(this.build(o, depth + 1, leafSize, maxDepth))
    }
    return { minX, minY, minZ, maxX, maxY, maxZ, children, items: null }
  }

  /** Squared distance from a point to an AABB (0 when inside). */
  private static distSqToNode(n: OctreeNode, x: number, y: number, z: number): number {
    const dx = x < n.minX ? n.minX - x : x > n.maxX ? x - n.maxX : 0
    const dy = y < n.minY ? n.minY - y : y > n.maxY ? y - n.maxY : 0
    const dz = z < n.minZ ? n.minZ - z : z > n.maxZ ? z - n.maxZ : 0
    return dx * dx + dy * dy + dz * dz
  }

  private static intersects(n: OctreeNode, q: QueryBBox): boolean {
    return (
      n.minX <= q.maxX && n.maxX >= q.minX &&
      n.minY <= q.maxY && n.maxY >= q.minY &&
      n.minZ <= q.maxZ && n.maxZ >= q.minZ
    )
  }

  /** Returns false when the visitor requested a stop. */
  private walk(
    node: OctreeNode,
    q: QueryBBox,
    camX: number,
    camY: number,
    camZ: number,
    visit: (item: OctreeItem) => boolean,
  ): boolean {
    if (!ChunkOctree.intersects(node, q)) return true // prune branch, keep going

    if (node.items) {
      // Leaf: near-first within the leaf (≤ leafSize items, cheap sort).
      const ordered = [...node.items].sort((a, b) => {
        const da = (a.x - camX) ** 2 + (a.y - camY) ** 2 + (a.z - camZ) ** 2
        const db = (b.x - camX) ** 2 + (b.y - camY) ** 2 + (b.z - camZ) ** 2
        return da - db
      })
      for (const it of ordered) {
        if (!visit(it)) return false
      }
      return true
    }

    const children = node.children!
    const ordered = [...children].sort(
      (a, b) =>
        ChunkOctree.distSqToNode(a, camX, camY, camZ) -
        ChunkOctree.distSqToNode(b, camX, camY, camZ),
    )
    for (const child of ordered) {
      if (!this.walk(child, q, camX, camY, camZ, visit)) return false
    }
    return true
  }
}
