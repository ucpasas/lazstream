/**
 * CompactStore — bounded in-memory LRU of layer-selective ("compact") chunk
 * bytes, one entry per chunk index.
 *
 * Why it exists: a P3 layer top-up splices the missing layers into a compact
 * chunk already held. With an IDB ChunkCache that base comes from IDB; but
 * neither the stock viewer nor the demo enables ChunkCache, and without a
 * base every upgrade would re-fetch all kept layers. This store keeps the
 * most recent compact bytes per chunk under a byte budget (compressed bytes,
 * ~100 KB per 50k-point chunk), so top-ups fetch only what is missing.
 *
 * Only populated in selective mode — with the default 'all' mask it stays empty.
 * Entries are read-only: callers must slice() before transferring to a worker.
 */
export class CompactStore {
  private entries = new Map<number, { bytes: ArrayBuffer; presentBits: number }>()
  private totalBytes = 0

  constructor(private readonly budgetBytes: number) {}

  get(chunkIndex: number): { bytes: ArrayBuffer; presentBits: number } | undefined {
    const entry = this.entries.get(chunkIndex)
    if (entry) {
      // Re-insert to mark as most recently used (Map preserves insertion order).
      this.entries.delete(chunkIndex)
      this.entries.set(chunkIndex, entry)
    }
    return entry
  }

  put(chunkIndex: number, bytes: ArrayBuffer, presentBits: number): void {
    if (this.budgetBytes <= 0 || bytes.byteLength > this.budgetBytes) return
    const existing = this.entries.get(chunkIndex)
    if (existing) {
      this.totalBytes -= existing.bytes.byteLength
      this.entries.delete(chunkIndex)
    }
    while (this.totalBytes + bytes.byteLength > this.budgetBytes && this.entries.size > 0) {
      const [oldestKey, oldest] = this.entries.entries().next().value!
      this.entries.delete(oldestKey)
      this.totalBytes -= oldest.bytes.byteLength
    }
    this.entries.set(chunkIndex, { bytes, presentBits })
    this.totalBytes += bytes.byteLength
  }

  clear(): void {
    this.entries.clear()
    this.totalBytes = 0
  }

  get byteSize(): number { return this.totalBytes }
}
