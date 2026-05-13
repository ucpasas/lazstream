/**
 * Ring buffer allocator with frame-coherent LRU eviction.
 *
 * Pure CPU-side bookkeeping for a single contiguous GPU storage buffer.
 * No WebGPU types touched here — fully unit-testable in isolation.
 *
 * Strategy: first-fit free-range allocation. When no fit is found, evict the
 * LRU slot whose lastRenderedFrame is strictly less than the current frame.
 * Repeat until a fit is found or no more slots can be evicted (in which case
 * the allocation is refused — caller drops the chunk for this frame).
 *
 * Frame-coherence invariant: a slot rendered in the current frame is NEVER
 * evicted. Visible-set is defined as lastRenderedFrame >= currentFrame.
 *
 * Known v1 limitation: this allocator can fragment. If visible slots are
 * scattered through the buffer, a large new chunk may be refused even when
 * total free bytes exceed its size. Track B v2 adds GPU-side compaction.
 */

export interface Slot {
  chunkIndex: number
  /** Byte offset into the GPU buffer where this slot starts. */
  byteOffset: number
  /** Length in bytes occupied by this slot. */
  byteLength: number
  pointCount: number
  /** Per-chunk dequantization origin (world coords). */
  min: [number, number, number]
  /** Per-chunk dequantization range (world coords, max - min). */
  range: [number, number, number]
  /** Last frame this slot was rendered. -1 if never. */
  lastRenderedFrame: number
}

export interface AllocateResult {
  slot: Slot
  /** Slots that had to be evicted to make room. Caller may want to log/observe. */
  evicted: Slot[]
}

export class RingBufferAllocator {
  private slots: Slot[] = []

  constructor(public readonly capacity: number) {}

  /**
   * Try to place a new chunk of `byteLength` bytes.
   *
   * @param chunkIndex caller's identifier — typically the LAZ chunk index;
   *                   use a negative number for non-chunk data (e.g. -1 for seeds)
   * @param byteLength must be a multiple of 4 (WGSL u32 alignment)
   * @param min/range per-chunk dequantization parameters
   * @param currentFrame the frame number of the in-progress render
   *
   * Returns null if the chunk cannot fit even after evicting all non-visible
   * slots. Caller should drop the chunk silently and try again next frame
   * (the worker pool will not re-decode — but the chunk data is still in CPU
   * memory if the caller buffers it; for v1 we accept the drop).
   */
  allocate(
    chunkIndex: number,
    byteLength: number,
    pointCount: number,
    min: [number, number, number],
    range: [number, number, number],
    currentFrame: number,
  ): AllocateResult | null {
    if (byteLength > this.capacity) return null
    if (byteLength % 4 !== 0) {
      throw new Error(`RingBufferAllocator: byteLength ${byteLength} not multiple of 4`)
    }

    // If a slot with this chunkIndex already exists, return it as-is.
    // (Duplicate adds shouldn't happen because WorkerPool dedupes, but defend.)
    const existing = this.slots.find((s) => s.chunkIndex === chunkIndex)
    if (existing) {
      existing.lastRenderedFrame = Math.max(existing.lastRenderedFrame, currentFrame - 1)
      return { slot: existing, evicted: [] }
    }

    const evicted: Slot[] = []

    while (true) {
      const offset = this.findFirstFreeRange(byteLength)
      if (offset !== null) {
        const slot: Slot = {
          chunkIndex,
          byteOffset: offset,
          byteLength,
          pointCount,
          min,
          range,
          lastRenderedFrame: -1,
        }
        this.slots.push(slot)
        this.slots.sort((a, b) => a.byteOffset - b.byteOffset)
        return { slot, evicted }
      }

      // No fit. Evict the LRU non-visible slot.
      const victim = this.findLRUEvictable(currentFrame)
      if (!victim) return null // all visible — refuse

      evicted.push(victim)
      this.slots = this.slots.filter((s) => s !== victim)
    }
  }

  /**
   * Find the lowest offset where a free range of `byteLength` fits.
   * Returns null if no such gap (or tail space) exists.
   */
  private findFirstFreeRange(byteLength: number): number | null {
    // Slots are kept sorted by byteOffset (we sort after every insert).
    let cursor = 0
    for (const slot of this.slots) {
      const gap = slot.byteOffset - cursor
      if (gap >= byteLength) return cursor
      cursor = slot.byteOffset + slot.byteLength
    }
    if (this.capacity - cursor >= byteLength) return cursor
    return null
  }

  /** Find the slot with the lowest lastRenderedFrame that is not "visible". */
  private findLRUEvictable(currentFrame: number): Slot | null {
    let victim: Slot | null = null
    let oldestFrame = Infinity
    for (const slot of this.slots) {
      if (slot.lastRenderedFrame >= currentFrame) continue // visible this frame
      if (slot.lastRenderedFrame < oldestFrame) {
        oldestFrame = slot.lastRenderedFrame
        victim = slot
      }
    }
    return victim
  }

  /** Mark a slot as rendered in the given frame. */
  touch(chunkIndex: number, frame: number): void {
    const slot = this.slots.find((s) => s.chunkIndex === chunkIndex)
    if (slot) slot.lastRenderedFrame = frame
  }

  /** Get a slot by chunk index. */
  getSlot(chunkIndex: number): Slot | undefined {
    return this.slots.find((s) => s.chunkIndex === chunkIndex)
  }

  /** Drop a specific slot. Used to remove the seed pseudo-chunk once real chunks land. */
  remove(chunkIndex: number): boolean {
    const before = this.slots.length
    this.slots = this.slots.filter((s) => s.chunkIndex !== chunkIndex)
    return this.slots.length !== before
  }

  /** Current slots, in offset order. Caller must not mutate. */
  getSlots(): readonly Slot[] {
    return this.slots
  }

  /** Total bytes occupied by current slots. */
  bytesUsed(): number {
    return this.slots.reduce((sum, s) => sum + s.byteLength, 0)
  }

  /** Total points across all current slots. */
  pointsLoaded(): number {
    return this.slots.reduce((sum, s) => sum + s.pointCount, 0)
  }
}