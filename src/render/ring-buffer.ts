/**
 * Ring buffer allocator — Phase 3 Track B (v1: fixed-slot).
 *
 * Pure CPU-side bookkeeping for a single contiguous GPU storage buffer.
 * No WebGPU types touched here — fully unit-testable in isolation.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THIS REPLACES the previous first-fit variable-size allocator.
 *
 * The old allocator suffered fragmentation: gaps from evicted slots could
 * not be reused if a new chunk was even one byte larger than the largest
 * gap. At Melbourne scale (7073 chunks of ~600 KB each), this dropped
 * chunks past ~447 resident — total free bytes were ample, but no single
 * gap fit. See [[Renderer]] "Ring buffer fragmentation at Melbourne scale".
 *
 * B-2 strategy: every slot has a fixed byte size, established at
 * construction. Any free slot fits any chunk ≤ slotBytes. Fragmentation
 * is impossible by construction.
 *
 *   ┌─────────┬─────────┬─────────┬───── ... ─┬─────────┐
 *   │ slot 0  │ slot 1  │ slot 2  │           │ slot N-1│
 *   │ slotByt │ slotByt │ slotByt │   ...     │ slotByt │
 *   └─────────┴─────────┴─────────┴───── ... ─┴─────────┘
 *     ▲ byteOffset for slot i is always i × slotBytes
 *     ▲ actual data may use less than slotBytes (tail unused)
 *
 * ─────────────────────────────────────────────────────────────────────
 * PRIORITY FOLLOW-UP: B-1 GPU compaction.
 *
 * B-2 accepts ~16% per-slot waste. At 700 KB slots × ~374 slots resident,
 * that's ~43 MB of dead space on a 256 MB ring — not negligible on
 * memory-constrained browsers (mobile, low-end laptops, busy tabs).
 *
 * B-1 is the planned next iteration: variable-size slots + periodic
 * GPU-side compaction (copyBufferToBuffer to close gaps between frames).
 * Achieves zero waste at the cost of ~0.5 ms compaction frames and
 * meaningful implementation complexity (GPU sync, uniform fix-ups,
 * frame coordination). Design and trade-offs in planning doc §4.2.
 *
 * Promote B-1 to the active iteration as soon as:
 *   (a) we have telemetry showing the 43 MB waste is biting users, OR
 *   (b) we need to support files with chunks larger than slotBytes
 *       (variable-chunk COPC files at 65,535 pts × 12 B = 786 KB).
 *
 * Until then, B-2 is shipped because fragmentation is currently
 * dropping chunks in production and B-2 fixes that immediately.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Other compromises in B-2 (vs B-1):
 *   - Slot count drops to ~374 (vs ~430 pre-fragmentation in the
 *     variable allocator). Capacity penalty for fragmentation immunity.
 *   - slotBytes is fixed at construction. Pathological files with
 *     chunks > slotBytes are rejected (logged + dropped). Per-file
 *     sizing (slotBytes derived from chunk table max) is a follow-up
 *     bundled with B-1.
 *   - The per-slot tail bytes are addressable but unused. The GPU
 *     buffer is fully allocated; we just don't write to those bytes.
 *
 * Frame-coherence invariant: a slot rendered in the current frame is
 * NEVER evicted. Visible-set = lastRenderedFrame >= currentFrame.
 */

export interface Slot {
  chunkIndex: number
  /** Byte offset into the GPU buffer. In B-2 always slotIndex × slotBytes. */
  byteOffset: number
  /** Length in bytes of the ACTUAL chunk data uploaded into this slot.
   *  May be less than slotBytes; the tail of the slot is unused (this is
   *  the B-2 memory cost). */
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

export interface RingBufferMetrics {
  capacity: number
  slotBytes: number
  slotCount: number
  slotsUsed: number
  slotsFree: number
  /** Actual chunk data bytes (sum of slot.byteLength over used slots). */
  bytesActualData: number
  /** Bytes reserved for used slots (slotsUsed × slotBytes). */
  bytesAllocated: number
  /** Dead space inside used-slot tails (bytesAllocated − bytesActualData). */
  bytesWasted: number
}

/**
 * Default slot size: 700 KB. Sized for PDAL default 50,000-point chunks
 * at PDRF 6 packed (12 B/pt) = 600,000 bytes + ~16% headroom.
 *
 * Override via the constructor when sizing for a specific file is
 * possible. COPC files with up to 65,535-point chunks need ~800 KB.
 * Per-file auto-sizing is a planned follow-up alongside B-1.
 */
export const DEFAULT_SLOT_BYTES = 700 * 1024

export class RingBufferAllocator {
  readonly slotBytes: number
  readonly slotCount: number

  /** slotsByIndex[i] is the Slot occupying slot i, or null if free. */
  private slotsByIndex: (Slot | null)[]
  private chunkToSlotIdx = new Map<number, number>()
  /** Free slot indices, stack — pop returns one in O(1). */
  private freeStack: number[]

  constructor(
    public readonly capacity: number,
    slotBytes: number = DEFAULT_SLOT_BYTES,
  ) {
    if (slotBytes <= 0) {
      throw new Error(`RingBufferAllocator: slotBytes must be positive, got ${slotBytes}`)
    }
    if (slotBytes % 4 !== 0) {
      throw new Error(`RingBufferAllocator: slotBytes ${slotBytes} not multiple of 4 (WGSL u32 alignment)`)
    }
    this.slotBytes = slotBytes
    this.slotCount = Math.floor(capacity / slotBytes)
    if (this.slotCount === 0) {
      throw new Error(
        `RingBufferAllocator: capacity ${capacity} < slotBytes ${slotBytes} — no slots can fit`
      )
    }
    this.slotsByIndex = new Array(this.slotCount).fill(null)
    // Free stack initialised in reverse so pop() returns slot 0 first.
    this.freeStack = new Array(this.slotCount)
    for (let i = 0; i < this.slotCount; i++) {
      this.freeStack[i] = this.slotCount - 1 - i
    }
  }

  /**
   * Try to place a new chunk of `byteLength` bytes.
   *
   * @param chunkIndex caller's identifier — typically the LAZ chunk index;
   *                   use a negative number for non-chunk data (e.g. -1 for seeds)
   * @param byteLength actual data size in bytes; must be ≤ slotBytes and
   *                   a multiple of 4 (WGSL u32 alignment)
   * @param min/range per-chunk dequantization parameters
   * @param currentFrame the frame number of the in-progress render
   *
   * Returns null if the chunk cannot fit — either it's too large for a
   * slot (logged warning), or all slots are visible this frame (silent).
   */
  allocate(
    chunkIndex: number,
    byteLength: number,
    pointCount: number,
    min: [number, number, number],
    range: [number, number, number],
    currentFrame: number,
  ): AllocateResult | null {
    if (byteLength % 4 !== 0) {
      throw new Error(`RingBufferAllocator: byteLength ${byteLength} not multiple of 4`)
    }
    if (byteLength > this.slotBytes) {
      console.warn(
        `[ring-buffer] chunk ${chunkIndex} byteLength ${byteLength} > slotBytes ${this.slotBytes} — rejected. ` +
        `This file has chunks larger than the allocator can hold. Increase slotBytes via constructor, ` +
        `or wait for B-1 compaction + per-file sizing.`
      )
      return null
    }

    // Existing slot for this chunk? Refresh its visibility window and return.
    // (Duplicate adds shouldn't happen because WorkerPool dedupes, but defend.)
    const existingIdx = this.chunkToSlotIdx.get(chunkIndex)
    if (existingIdx !== undefined) {
      const slot = this.slotsByIndex[existingIdx]!
      slot.lastRenderedFrame = Math.max(slot.lastRenderedFrame, currentFrame - 1)
      return { slot, evicted: [] }
    }

    const evicted: Slot[] = []
    let slotIdx: number

    if (this.freeStack.length > 0) {
      // Fast path: a free slot is available.
      slotIdx = this.freeStack.pop()!
    } else {
      // No free slots — evict the LRU non-visible slot.
      const victimIdx = this.findLRUEvictableIndex(currentFrame)
      if (victimIdx === -1) return null  // every slot is visible — refuse

      const victim = this.slotsByIndex[victimIdx]!
      evicted.push(victim)
      this.chunkToSlotIdx.delete(victim.chunkIndex)
      this.slotsByIndex[victimIdx] = null
      slotIdx = victimIdx
    }

    const slot: Slot = {
      chunkIndex,
      byteOffset: slotIdx * this.slotBytes,
      byteLength,
      pointCount,
      min,
      range,
      lastRenderedFrame: -1,
    }
    this.slotsByIndex[slotIdx] = slot
    this.chunkToSlotIdx.set(chunkIndex, slotIdx)
    return { slot, evicted }
  }

  /** Find the slot index with the lowest lastRenderedFrame that is not visible. */
  private findLRUEvictableIndex(currentFrame: number): number {
    let victim = -1
    let oldestFrame = Infinity
    for (let i = 0; i < this.slotCount; i++) {
      const slot = this.slotsByIndex[i]
      if (!slot) continue
      if (slot.lastRenderedFrame >= currentFrame) continue  // visible this frame
      if (slot.lastRenderedFrame < oldestFrame) {
        oldestFrame = slot.lastRenderedFrame
        victim = i
      }
    }
    return victim
  }

  /** Mark a slot as rendered in the given frame. */
  touch(chunkIndex: number, frame: number): void {
    const idx = this.chunkToSlotIdx.get(chunkIndex)
    if (idx === undefined) return
    const slot = this.slotsByIndex[idx]
    if (slot) slot.lastRenderedFrame = frame
  }

  /** Get a slot by chunk index. */
  getSlot(chunkIndex: number): Slot | undefined {
    const idx = this.chunkToSlotIdx.get(chunkIndex)
    return idx !== undefined ? (this.slotsByIndex[idx] ?? undefined) : undefined
  }

  /** Drop a specific slot. Used to remove the seed pseudo-chunk once real chunks land. */
  remove(chunkIndex: number): boolean {
    const idx = this.chunkToSlotIdx.get(chunkIndex)
    if (idx === undefined) return false
    this.slotsByIndex[idx] = null
    this.chunkToSlotIdx.delete(chunkIndex)
    this.freeStack.push(idx)
    return true
  }

  /**
   * Drop ALL slots. Used by the renderer's reset() on new file load —
   * empties bookkeeping so the next chunk allocations start from a
   * fresh empty ring. The underlying GPU buffer contents are orphaned
   * but become irrelevant once the depth buffer is cleared on the
   * next frame (slots = 0 means no compute pass runs, so the resolve
   * shader sees only the depth sentinel and outputs the background
   * clearValue).
   */
  clear(): void {
    this.slotsByIndex = new Array(this.slotCount).fill(null)
    this.chunkToSlotIdx.clear()
    this.freeStack = new Array(this.slotCount)
    for (let i = 0; i < this.slotCount; i++) {
      this.freeStack[i] = this.slotCount - 1 - i
    }
  }

  /**
   * Current slots, populated only (skips empty slot indices).
   * Caller must not mutate. Allocates a new array per call (~once/frame
   * from the render loop's iteration); optimise if perf shows it.
   */
  getSlots(): readonly Slot[] {
    const result: Slot[] = []
    for (const slot of this.slotsByIndex) {
      if (slot !== null) result.push(slot)
    }
    return result
  }

  /** Sum of actual data bytes across used slots (not the dead-space tails). */
  bytesUsed(): number {
    let sum = 0
    for (const slot of this.slotsByIndex) {
      if (slot !== null) sum += slot.byteLength
    }
    return sum
  }

  /** Total points across all current slots. */
  pointsLoaded(): number {
    let sum = 0
    for (const slot of this.slotsByIndex) {
      if (slot !== null) sum += slot.pointCount
    }
    return sum
  }

  /**
   * Count of slots `allocate()` could fulfill RIGHT NOW without refusal:
   *   free slots (never used)  +  slots not touched in the current frame
   *                               (LRU-evictable per findLRUEvictableIndex).
   *
   * This is what the engine's ring-buffer back-pressure provider must
   * report — not `metrics().slotsFree`, which only counts the freeStack
   * and stays at 0 forever once every slot has been used once. After the
   * first 374 chunks fill the buffer, freeStack is permanently empty
   * even when most slots are stale and could be evicted; that's why the
   * engine stopped dispatching new chunks despite the CPU-side frustum
   * cull correctly marking them non-visible.
   *
   * O(slotCount). Called once per engine tick (per frame), so cheap.
   */
  getAvailableCount(currentFrame: number): number {
    let count = this.freeStack.length
    for (let i = 0; i < this.slotCount; i++) {
      const slot = this.slotsByIndex[i]
      if (slot !== null && slot.lastRenderedFrame < currentFrame) count++
    }
    return count
  }

  /**
   * Diagnostics. Surface these in the telemetry overlay so we can see
   * (a) whether B-2's waste is biting in practice and
   * (b) how much capacity headroom we have before LRU eviction kicks in.
   * If bytesWasted grows large or slotsFree hits 0 often, that's the
   * signal to promote B-1.
   */
  metrics(): RingBufferMetrics {
    const slotsUsed = this.slotCount - this.freeStack.length
    const bytesActualData = this.bytesUsed()
    const bytesAllocated = slotsUsed * this.slotBytes
    return {
      capacity: this.capacity,
      slotBytes: this.slotBytes,
      slotCount: this.slotCount,
      slotsUsed,
      slotsFree: this.freeStack.length,
      bytesActualData,
      bytesAllocated,
      bytesWasted: bytesAllocated - bytesActualData,
    }
  }
}