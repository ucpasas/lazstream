---
title: Chunk Caching
type: project
status: active
updated: 2026-05-18
tags: [indexeddb, idb-keyval, caching, lru, offline, compressed-bytes, fnv1a]
---

# Chunk Caching

Cross-cutting concern. Sits between [[Streaming Engine]] (cache-check before fetch) and [[Decoder Workers]] (bytes written to cache after fetch, before worker decode).

Provides a persistent, browser-local cache of **compressed** chunk bytes using IndexedDB via `idb-keyval`. Cache hits skip the network round-trip; workers still decode — cache stores compressed bytes, not decoded point arrays.

**Phase 3 Track A Step 5 — Complete.**

---

## Files

| File | Purpose |
|------|---------|
| `src/cache/idb-cache.ts` | `ChunkCache` class + `makeCacheKey()` helper |

---

## Why compressed, not decoded

- Per-entry size: ~150 KB compressed vs ~500 KB decoded → 3× more entries fit within the 512 MB budget
- Structured-clone cost on write is 3× lower
- Cache hit still eliminates the network round-trip (the dominant latency cost)
- Worker decode is the same code path for a cached or fetched chunk

---

## Cache key design

```typescript
export function makeCacheKey(url: string, chunkIndex: number, byteOffset: number): string
```

Uses FNV-1a hashing (non-crypto, fast) of `url + chunkIndex + byteOffset`. Collision-resistant for the key space: chunks within one file have distinct `byteOffset` values; chunks across files have distinct URL components.

**Semantics:** same URL + same byte offset → cache hit. File re-uploaded to same URL → cache miss (byte offsets shift). This is the intended behaviour — byte offset acts as a content proxy without needing to hash the chunk data itself.

IDB key format:
```
'lazstream:cache:chunk:' + fnv1aHex(url + ':' + chunkIndex + ':' + byteOffset)
```

Index stored separately at key `'lazstream:cache:index:v1'`.

---

## In-memory index

`ChunkCache` maintains a `Map<string, { cachedAt: number; byteSize: number }>` in memory for O(1) LRU decisions without hitting IDB on every eviction check. The index is persisted to IDB asynchronously (debounced 2 s) after every write.

On `init()`, the index is loaded from IDB. `init()` is lazy — the first `get()` or `set()` call triggers it if not yet called.

---

## LRU eviction

On every `set()`:
1. Add entry to in-memory index; update `totalBytes`.
2. If `totalBytes > budgetBytes`: call `evict()`.
3. `evict()` sorts the index by `cachedAt` ascending, deletes oldest entries via `idbDel()` until under budget.

`QuotaExceededError` handling: if IDB throws `QuotaExceededError` during a write, `ChunkCache` aggressively evicts 20% of its budget and retries once. On second failure, the write is silently skipped (cache miss on next visit — not fatal).

Default budget: **512 MB**.

---

## Integration with StreamingEngine

Constructor: `new StreamingEngine(events, workerCount, cache?)` — cache is optional.

```typescript
// cache check before fetch (Step 5):
const cached = await cache.get(makeCacheKey(url, chunkIndex, chunk.offset))
if (cached) {
  pool.requestDecode(chunkIndex, chunk, cached)  // cache hit — skip network
} else {
  misses.push(...)  // goes to coalesce + fetchRange path
}

// cache write after fetch (fire-and-forget):
const cacheBytes = bytes.slice(0)         // clone before Transferable transfer
void cache.set(makeCacheKey(...), cacheBytes)
pool.requestDecode(chunkIndex, chunk, bytes)  // transfer original
```

The `bytes.slice(0)` clone is required: `pool.requestDecode` transfers the buffer (detaches it), so the cache must receive a separate copy.

---

## Metrics

```typescript
interface CacheMetrics {
  entries: number
  totalBytes: number
  budgetBytes: number
  hits: number
  misses: number
  evictions: number
}
cache.getMetrics(): CacheMetrics
```

Exposed for the stats overlay / debug console.

---

## Constraints

- NEVER block the main thread — all IndexedDB operations are async.
- Cache reads complete before the streaming engine issues a network request (fast path in `dispatchCandidates`).
- Cache writes are fire-and-forget after successful fetch — not awaited.
- Cache stores compressed bytes; workers always decode regardless of source.
- `bytes.slice(0)` required before transferring to worker — original buffer is detached.

---

## Open questions

- [ ] Should cache budget be user-configurable via URL param (like `?cacheMB=N`)?

---

## See also

- [[Streaming Engine]] — Step 5 wiring: cache-check before fetch, write-after-fetch
- [[HTTP/2 Range Requests]] — coalescing happens on cache misses only
- [[Decoder Workers]] — receives bytes from cache or network identically
- [[LAZ Format]] — chunk index and byte offset come from the chunk table
