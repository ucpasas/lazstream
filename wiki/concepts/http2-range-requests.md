---
title: HTTP/2 Range Requests
type: concept
status: active
updated: 2026-05-16
tags: [http2, range-request, streaming, coalescing, back-pressure, cors, coop-coep]
---

# HTTP/2 Range Requests

lazstream fetches LAZ chunk data using HTTP `Range` headers, enabling random access to large cloud-hosted files without downloading them in full.

---

## Why HTTP/2?

HTTP/1.1 limits connections to ~6 per origin (browser constraint). HTTP/2 multiplexes all requests over a single TCP connection, enabling 100+ concurrent range requests without connection overhead.

Cloud storage origins (S3, R2, Azure Blob, GCS) all support HTTP/2 and `Range` headers.

**As of 2026-05-16: HTTP/2 confirmed live on `data.lazstream.stream`** (custom Cloudflare domain over Cloudflare R2). Verified via `curl --http2 -I https://data.lazstream.stream/laz/Melbourne_2018.laz`. r2.dev remains HTTP/1.1-only and is retained only for legacy Phase 1 references.

---

## Range request basics

```
GET /pointcloud.laz HTTP/2
Range: bytes=1048576-3145727
```

Server responds with `206 Partial Content` and the requested byte range. If the server returns `200 OK` with the full file, [[Streaming Engine]] must detect and error.

---

## Discovery: R2 r2.dev omits Accept-Ranges on HEAD responses

**Expected:** A HEAD request to any cloud storage URL includes `Accept-Ranges: bytes` if Range requests are supported.

**Actual (Cloudflare R2 r2.dev domain):** The HEAD response omits `Accept-Ranges` entirely. R2 *does* honour Range requests (returns 206) — the header is just absent from HEAD.

**Wrong approach:**
```typescript
// This always returned false for R2:
const supportsRange = headResponse.headers.get('Accept-Ranges') === 'bytes'
```

**Correct approach — probe with an actual range request:**
```typescript
const rangeResponse = await fetch(url, {
  headers: { Range: 'bytes=0-0' },
  cache: 'no-store',
})
supportsRange = rangeResponse.status === 206
```

The `cache: 'no-store'` is required (see COOP/COEP section below).

---

## COOP/COEP and cache: 'no-store'

lazstream sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` in `vite.config.ts` to enable `SharedArrayBuffer` for Phase 2 workers.

Under COEP, Chrome throws `ERR_CACHE_OPERATION_NOT_SUPPORTED` for Range requests unless `cache: 'no-store'` is set on every fetch call. This applies to all range fetches — not just the probe.

---

## Coalescing strategy (Phase 2)

Phase 1 issues one range request per chunk. Phase 2 coalesces adjacent chunks into 2–4 MB batches:

1. Sort pending chunks by byte offset.
2. Merge contiguous chunks, or chunks with a gap < 64 KB.
3. Issue one range request per merged batch.
4. On response: split the byte stream into individual chunk slices using per-chunk offsets from the chunk table.

Target batch size: 2–4 MB. Amortises TLS record overhead while staying within typical stream window sizes.

---

## Streaming response bodies

```ts
const response = await fetch(url, {
  headers: { Range: `bytes=${start}-${end}` },
  cache: 'no-store',
})
const reader = response.body!.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // append value (Uint8Array) to accumulation buffer
}
```

Back-pressure: if the decoder worker pool is full, pausing `reader.read()` lets the browser back-pressure the TCP stream automatically.

---

## Cloud storage compatibility

| Origin | HTTP/2 | Range | Accept-Ranges on HEAD | Notes |
|--------|--------|-------|-----------------------|-------|
| `data.lazstream.stream` (R2 + custom domain) | ✓ | ✓ | ✓ | Production hosting; confirmed 2026-05-16 |
| AWS S3 | ✓ | ✓ | ✓ | Standard |
| Cloudflare R2 (r2.dev) | ✗ | ✓ | ✗ | HTTP/1.1 on public domain; legacy Phase 1 only |
| Cloudflare R2 (custom domain) | ✓ | ✓ | ✓ | Standard; same as above |
| Azure Blob | ✓ | ✓ | ✓ | Standard |
| GCS | ✓ | ✓ | ✓ | Standard |
| Local dev (Vite) | ✗ | ✓ | ✓ | HTTP/1.1; acceptable for development |

---

## CORS requirements

```
Access-Control-Allow-Origin: https://your-viewer.example.com
Access-Control-Allow-Headers: Range
Access-Control-Expose-Headers: Content-Range, Content-Length
```

Without `Access-Control-Expose-Headers: Content-Range`, the browser hides the `Content-Range` response header and file size cannot be read from range responses.

---

## Seed-fetch parallelism (2026-05-19)

`fetchSeedPoints` in `src/engine/chunk-table.ts` issues one tiny range request (~30 bytes) per chunk to read the seed point. With 7073 chunks for Melbourne, this is 7073 individual range requests.

### The bottleneck — BATCH_SIZE 6

Pre-fix code batched 6 requests at a time (an HTTP/1.1-era holdover for the 6-connections-per-origin limit):

```typescript
const BATCH_SIZE = 6
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const buffers = await Promise.all(batch.map(fetchRange))
  // process...
}
```

On HTTP/2 (`data.lazstream.stream`), the browser multiplexes ~100 streams over a single connection, so batching at 6 leaves enormous parallelism on the table:

- 7073 chunks / 6 = 1179 sequential rounds × ~30 ms RTT → **~5 seconds**

### The fix — BATCH_SIZE 100

```typescript
const BATCH_SIZE = 100
```

- 7073 chunks / 100 = ~71 rounds × ~50 ms RTT → **700 ms – 1.5 s**

Going above ~100 hits diminishing returns: most browsers cap concurrent `fetch()` promises around 100–200 per origin even on HTTP/2.

### Why range coalescing doesn't help here

Seeds are 30 bytes each but separated by ~400 KB gaps (chunk data between them). Coalescing seed N and seed N+1 into a single range request would fetch ~400 KB to get 60 useful bytes — ratio is too poor to justify. This is unlike chunk fetching (where adjacent chunks are physically adjacent), which is why [[Streaming Engine]]'s `coalesce()` is useful for chunks but not seeds.

### Cache interaction

The IDB cache is not consulted during seed fetch — seeds are small enough that the cache lookup overhead would exceed the network cost. Seeds are re-fetched on every file load. (At 7073 × 30 B = 210 KB total, this is acceptable.)

---

## See also

- [[Streaming Engine]] — implements coalescing and request scheduling
- [[Manifest Loader]] — issues the initial header range requests; implements the probe-with-range fix
- [[Chunk Caching]] — avoids network requests for cached chunks
