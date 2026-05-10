---
title: Chunk Caching
type: project
status: draft
updated: 2026-05-09
tags: [indexeddb, idb-keyval, caching, lru, offline]
---

# Chunk Caching

Cross-cutting concern. Sits between [[Streaming Engine]] (fetch) and [[Decoder Workers]] (write-back).

Provides a persistent, browser-local cache of decoded point chunks using IndexedDB via `idb-keyval`, so repeat visits avoid redundant network fetches and decoding.

---

## Responsibilities

1. **Read path** (streaming engine): before issuing a range request, check if the chunk is cached. If so, return the decoded `Float32Array` directly — skip network and decoder.
2. **Write path** (decoder workers): after decoding, asynchronously write the decoded buffer to IndexedDB under the chunk's cache key.
3. **Eviction**: enforce a configurable size limit (default: 512 MB on disk). Evict LRU chunks when the limit is exceeded.
4. **Cache key**: deterministic, derived from `{ fileURL, chunkIndex, byteOffset }` to survive file renames but invalidate on file content changes (byte offset acts as a content proxy).

---

## Cache key design

```
cacheKey = sha1(`${fileURL}:${chunkIndex}:${byteOffset}`)
```

- `fileURL`: the full URL of the LAZ file (origin + path).
- `chunkIndex`: chunk ordinal from the chunk table.
- `byteOffset`: byte offset in the file — changes if the file is re-uploaded or re-compressed.

This means: same URL + same byte offset → cache hit. File re-uploaded to same URL → cache miss (byte offsets change). Intended behaviour.

---

## idb-keyval usage

- Store: one `idb-keyval` store named `lazstream-chunks`.
- Key: cache key string (see above).
- Value: `{ buffer: ArrayBuffer, pointCount: number, pdrf: number, cachedAt: number }`.
- All reads/writes are `await`-able; do not block the main thread.

---

## Eviction

- On write: check total stored size (maintained as a separate `metadata` key).
- If over limit: retrieve LRU list (stored as a `lastAccessed` timestamp per entry), delete oldest entries until under limit.
- LRU list is updated on every cache read (touch timestamp).

---

## Constraints

- NEVER block the main thread — all IndexedDB operations are async.
- Cache reads must complete before the streaming engine issues a network request (fast path).
- Cache writes happen after decode and GPU upload — they are fire-and-forget.

---

## Open questions

- [ ] Should cache size limit be user-configurable via UI?
- [ ] How to handle IndexedDB quota exceeded errors gracefully?
- [ ] Is sha1 fast enough for cache key generation, or use a non-crypto hash?

---

## See also

- [[Streaming Engine]] — checks cache before fetching
- [[Decoder Workers]] — writes decoded chunks to cache
- [[LAZ Format]] — chunk index and byte offset come from the chunk table
