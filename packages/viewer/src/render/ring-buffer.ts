/**
 * Ring buffer allocator — Phase 3 Track B (v2: variable-size free-list).
 *
 * Pure CPU-side bookkeeping for a single contiguous GPU storage buffer.
 * No WebGPU types touched here — fully unit-testable in isolation.
 *
 * ─────────────────────────────────────────────────────────────────────
 * v1 (fixed-slot) allocated every chunk a fixed 700 KB slot. Simple and
 * fragmentation-free, but wasteful: a 120 KB chunk still occupied 700 KB,
 * and a 786 KB COPC node was outright rejected (too large for the slot).
 *
 * v2 strategy: variable-size allocations via a free-list. Each chunk
 * receives exactly the bytes it needs (4-byte aligned), with zero tail
 * waste. Fragmentation is handled by defrag-by-eviction: when no single
 * free gap is large enough, the allocator evicts LRU non-visible slots
 * one at a time — coalescing after each — until a contiguous gap of the
 * needed size forms or no more slots are evictable.
 *
 * Memory layout (illustrative — offsets are variable):
 *
 *   ┌──────────┬────────┬───────────┬──────────┬────── ... ─┐
 *   │ chunk A  │  free  │  chunk B  │  chunk C │            │
 *   │ 600 KB   │ 200 KB │  120 KB   │  600 KB  │    free    │
 *   └──────────┴────────┴───────────┴──────────┴────── ... ─┘
 *     ▲ byteOffset tracked per slot, not derived from index
 *
 * ─────────────────────────────────────────────────────────────────────
 * GPU compaction deferred decision:
 *
 * Full compaction (copyBufferToBuffer defrag) would require a second
 * ring buffer of equal size (2× GPU memory) to avoid same-buffer copy
 * overlap — since a chunk typically moves by less than its own length
 * during compaction. Given that the IDB cache makes re-decoding from
 * eviction cheap (~56 ms, zero network), defrag-by-eviction is the
 * correct tradeoff: simpler, no memory penalty, corrected by the cache.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Frame-coherence invariant: a slot rendered in the current frame is
 * NEVER evicted. Visible-set = lastRenderedFrame >= currentFrame.
 *
 * Invariant 10 — Defrag-by-eviction ordering: When allocate() cannot
 * find a contiguous gap, it evicts LRU slots one at a time, coalescing
 * after each eviction, and retries firstFit after each step. Evictions
 * stop when (a) a gap is found, or (b) all remaining slots are visible
 * this frame. All evictions are returned in AllocateResult.evicted
 * regardless of whether the allocation ultimately succeeded.
 */

export interface Slot {
  chunkIndex: number
  /** Byte offset into the GPU buffer — variable; NOT derivable from an index. */
  byteOffset: number
  /** Actual data bytes uploaded into this range. No wasted tail bytes. */
  byteLength: number
  pointCount: number
  min: [number, number, number]
  range: [number, number, number]
  /** Last frame this slot was rendered. Initialised to currentFrame-1. */
  lastRenderedFrame: number
  /** True once touch() has been called at least once. Distinguishes phantom
   *  chunks (pass AABB dispatch, fail exact 6-plane test) from chunks that
   *  were genuinely visible and then moved off-screen. Used by proactive
   *  eviction to decide whether to re-queue via chunkEvictedCallback. */
  everRendered: boolean
}

export interface AllocateResult {
  /** The newly allocated slot, or null if all slots were visible this frame
   *  and no evictable slot could be found after defrag attempts. Caller
   *  should push to the deferred queue when null. */
  slot: Slot | null
  /** Slots that were evicted during defrag-by-eviction to make room.
   *  Non-empty even when slot===null (if defrag ran partway before exhausting
   *  evictable slots). Caller MUST process these — return uniform indices,
   *  call chunkEvictedCallback — regardless of slot success. */
  evicted: Slot[]
}

export interface RingBufferMetrics {
  capacity: number
  /** Number of live chunks in the buffer. */
  chunkCount: number
  /** Sum of actual data bytes across all live slots. */
  bytesUsed: number
  /** Total bytes across all free gaps. */
  bytesFree: number
  /** Largest single contiguous free region. */
  largestFreeGap: number
  /** (bytesFree - largestFreeGap) / bytesFree. 0 when bytesFree===0. */
  fragmentationRatio: number
  /** Running average of chunk sizes seen so far (or DEFAULT_MAX_CHUNK_BYTES
   *  before the first allocation). Used by getAvailableCount(). */
  avgChunkBytes: number
}

interface FreeRegion {
  offset: number
  length: number
}

/**
 * Cold-start fallback for getAvailableCount() and slotsTotal before the
 * first allocation provides a real average. 800 KB covers COPC max
 * (65535 pts × 12 B = 786 KB) with a small safety margin.
 */
export const DEFAULT_MAX_CHUNK_BYTES = 800 * 1024

export class RingBufferAllocator {
  /** All live slots, keyed by chunkIndex. */
  private readonly slots = new Map<number, Slot>()
  /** Free contiguous regions. Kept sorted by offset and coalesced on dealloc. */
  private freeList: FreeRegion[]

  // Self-tuning denominator for getAvailableCount().
  private allocCount = 0
  private allocBytesTotal = 0

  constructor(public readonly capacity: number) {
    this.freeList = [{ offset: 0, length: capacity }]
  }

  /**
   * Allocate byteLength bytes for a new chunk.
   *
   * @param byteLength  must be a multiple of 4 (WGSL u32 alignment)
   *
   * Returns an AllocateResult in all non-fatal cases. `result.slot` is
   * non-null on success; null when allocation failed (all slots visible).
   * `result.evicted` is always populated with any evictions that occurred
   * during defrag — caller must process them even when slot is null.
   *
   * Returns null (not AllocateResult) only for the permanent rejection
   * case: byteLength > capacity. Caller should log and discard the chunk.
   */
  allocate(
    chunkIndex: number,
    byteLength: number,
    pointCount: number,
    min: [number, number, number],
    range: [number, number, number],
    currentFrame: number,
    /** Optional eviction filter for defrag-by-eviction: keys for which it
     *  returns false are never chosen as LRU victims in this call. Used by
     *  the voxel sediment pool to spend fine-tier cache entries before
     *  touching permanent tier-0 sediment. */
    canEvict?: (chunkIndex: number) => boolean,
  ): AllocateResult | null {
    if (byteLength % 4 !== 0) {
      throw new Error(`RingBufferAllocator: byteLength ${byteLength} not multiple of 4`)
    }
    if (byteLength > this.capacity) {
      console.warn(
        `[ring-buffer] chunk ${chunkIndex} byteLength ${byteLength} B ` +
        `exceeds total capacity ${this.capacity} B — rejected permanently`,
      )
      return null
    }

    // Duplicate add — refresh visibility window and return (WorkerPool
    // deduplicates upstream, but defend against races).
    const existing = this.slots.get(chunkIndex)
    if (existing) {
      existing.lastRenderedFrame = Math.max(existing.lastRenderedFrame, currentFrame - 1)
      return { slot: existing, evicted: [] }
    }

    const evicted: Slot[] = []

    while (true) {
      const regionIdx = this.findFirstFit(byteLength)
      if (regionIdx !== -1) {
        const region = this.freeList[regionIdx]
        const byteOffset = region.offset
        if (region.length === byteLength) {
          this.freeList.splice(regionIdx, 1)
        } else {
          region.offset += byteLength
          region.length -= byteLength
        }
        const slot: Slot = {
          chunkIndex,
          byteOffset,
          byteLength,
          pointCount,
          min,
          range,
          // Start at currentFrame-1 so the slot has the full EVICT_GRACE_FRAMES
          // window before proactive eviction can touch it.
          lastRenderedFrame: currentFrame - 1,
          everRendered: false,
        }
        this.slots.set(chunkIndex, slot)
        this.allocCount++
        this.allocBytesTotal += byteLength
        return { slot, evicted }
      }

      // No contiguous gap large enough — evict the LRU non-visible slot to
      // create (and potentially coalesce) a larger free region.
      const victimKey = this.findLRUEvictableKey(currentFrame, canEvict)
      if (victimKey === null) {
        // All remaining slots are visible this frame — can't evict.
        // Return the partial result so the caller can process the evictions
        // that already happened and defer the new chunk for next frame.
        return { slot: null, evicted }
      }
      evicted.push(this.slots.get(victimKey)!)
      this.doRemove(victimKey)
    }
  }

  private findFirstFit(byteLength: number): number {
    for (let i = 0; i < this.freeList.length; i++) {
      if (this.freeList[i].length >= byteLength) return i
    }
    return -1
  }

  private findLRUEvictableKey(
    currentFrame: number,
    canEvict?: (chunkIndex: number) => boolean,
  ): number | null {
    let victim: number | null = null
    let oldestFrame = Infinity
    for (const [key, slot] of this.slots) {
      if (slot.lastRenderedFrame >= currentFrame) continue
      if (canEvict && !canEvict(key)) continue
      if (slot.lastRenderedFrame < oldestFrame) {
        oldestFrame = slot.lastRenderedFrame
        victim = key
      }
    }
    return victim
  }

  /** Internal remove: frees the slot's bytes back into freeList and coalesces. */
  private doRemove(chunkIndex: number): void {
    const slot = this.slots.get(chunkIndex)!
    this.slots.delete(chunkIndex)
    this.freeList.push({ offset: slot.byteOffset, length: slot.byteLength })
    this.coalesceFreeList()
  }

  private coalesceFreeList(): void {
    if (this.freeList.length <= 1) return
    this.freeList.sort((a, b) => a.offset - b.offset)
    const out: FreeRegion[] = []
    for (const r of this.freeList) {
      const last = out.at(-1)
      if (last && last.offset + last.length >= r.offset) {
        last.length = Math.max(last.length, r.offset + r.length - last.offset)
      } else {
        out.push({ offset: r.offset, length: r.length })
      }
    }
    this.freeList = out
  }

  /** Mark a slot as rendered in the given frame. */
  touch(chunkIndex: number, frame: number): void {
    const slot = this.slots.get(chunkIndex)
    if (slot) {
      slot.lastRenderedFrame = frame
      slot.everRendered = true
    }
  }

  /** Get a slot by chunk index. */
  getSlot(chunkIndex: number): Slot | undefined {
    return this.slots.get(chunkIndex)
  }

  /**
   * Public eviction interface — called by proactive eviction and releaseSlot.
   * Returns false if the chunk was not in the buffer.
   */
  remove(chunkIndex: number): boolean {
    if (!this.slots.has(chunkIndex)) return false
    this.doRemove(chunkIndex)
    return true
  }

  /**
   * Drop ALL slots. Used by the renderer's reset() on new file load.
   * The underlying GPU buffer contents become irrelevant once the depth
   * buffer is cleared on the next frame (empty slot table → no compute
   * pass writes new depth/color).
   */
  clear(): void {
    this.slots.clear()
    this.freeList = [{ offset: 0, length: this.capacity }]
    this.allocCount = 0
    this.allocBytesTotal = 0
  }

  /** Current slots (populated only). Allocates a new array per call. */
  getSlots(): readonly Slot[] {
    return [...this.slots.values()]
  }

  /** Sum of actual data bytes across all live slots. */
  bytesUsed(): number {
    let sum = 0
    for (const slot of this.slots.values()) sum += slot.byteLength
    return sum
  }

  /** Total point count across all live slots. */
  pointsLoaded(): number {
    let sum = 0
    for (const slot of this.slots.values()) sum += slot.pointCount
    return sum
  }

  /**
   * Running average of actual chunk sizes. Used as the denominator for
   * getAvailableCount() and slotsTotal. Falls back to DEFAULT_MAX_CHUNK_BYTES
   * before the first allocation (conservative cold-start).
   *
   * For uniform-chunk files (raw LAZ), this converges to the exact chunk
   * size within the first 2-3 allocations. For variable-chunk files (COPC),
   * it reflects the mix of node sizes seen so far — the estimate may be
   * slightly off at the start, but the deferred queue and back-pressure
   * system absorb any resulting over- or under-dispatch.
   */
  avgChunkBytes(): number {
    return this.allocCount > 0
      ? this.allocBytesTotal / this.allocCount
      : DEFAULT_MAX_CHUNK_BYTES
  }

  /**
   * Estimated count of chunks that allocate() could accommodate RIGHT NOW —
   * including free gaps AND bytes that would be freed by evicting LRU slots.
   *
   * The engine's ring-buffer back-pressure provider calls this each frame.
   * It subtracts in-flight work from this count before dispatching new
   * fetches — see Back-Pressure Invariants §2.
   *
   * O(slots). Called once per engine tick (cheap).
   */
  getAvailableCount(currentFrame: number): number {
    const avg = this.avgChunkBytes()
    let evictableBytes = 0
    for (const slot of this.slots.values()) {
      if (slot.lastRenderedFrame < currentFrame) evictableBytes += slot.byteLength
    }
    let totalFreeBytes = 0
    for (const r of this.freeList) totalFreeBytes += r.length
    return Math.floor((evictableBytes + totalFreeBytes) / avg)
  }

  /**
   * Diagnostic metrics. Expose in the telemetry overlay to monitor:
   *   (a) bytesWasted: should be near 0 in v2 (only 4-byte alignment rounding)
   *   (b) fragmentationRatio: high value + failed allocations → defrag-evictions
   *       firing; if frequent, consider a buddy allocator or compaction.
   *   (c) avgChunkBytes: shows self-tuning convergence.
   */
  metrics(): RingBufferMetrics {
    let bytesUsed = 0
    for (const slot of this.slots.values()) bytesUsed += slot.byteLength

    let bytesFree = 0
    let largestFreeGap = 0
    for (const r of this.freeList) {
      bytesFree += r.length
      if (r.length > largestFreeGap) largestFreeGap = r.length
    }

    const fragmentationRatio = bytesFree > 0
      ? (bytesFree - largestFreeGap) / bytesFree
      : 0

    return {
      capacity: this.capacity,
      chunkCount: this.slots.size,
      bytesUsed,
      bytesFree,
      largestFreeGap,
      fragmentationRatio,
      avgChunkBytes: this.avgChunkBytes(),
    }
  }
}
