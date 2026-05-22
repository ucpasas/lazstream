---
title: Manifest Session
type: project
status: active
updated: 2026-05-23
tags: [manifest, multi-tile, streaming, session, chunk-index]
---

# Manifest Session

`ManifestSession` is the top-level pipeline coordinator created by `main.ts`. It replaces the previous direct `StreamingEngine` instantiation and adds multi-tile support via `.lazm.json` manifests.

Pipeline position: `ManifestLoader → ManifestSession → StreamingEngine[] → [[Decoder Workers]] → [[Renderer]]`

---

## Purpose

A single `.lazm.json` manifest can reference dozens or hundreds of LAZ tiles. `ManifestSession` creates one `StreamingEngine` per tile, runs all tile loads in parallel, aggregates their seed points into a single `onSeedsReady` event, and namespaces chunk indices globally so the ring buffer never sees collisions between tiles.

Single `.laz` URLs also go through this path — `urlToManifest()` wraps them in a synthetic one-tile manifest. There is exactly one code path for both cases.

---

## New files (2026-05-23)

| File | Role |
|------|------|
| `src/engine/manifest-types.ts` | `Manifest` and `TileEntry` interface definitions |
| `src/engine/manifest-loader.ts` | `fetchManifest`, `parseManifest`, `urlToManifest`, `ManifestParseError` |
| `src/engine/manifest-session.ts` | `ManifestSession` multi-tile coordinator |

---

## Manifest format

`.lazm.json` schema (version "1.0"):

```json
{
  "version": "1.0",
  "tiles": [
    {
      "url": "https://storage.example.com/tile_001.laz",
      "bounds": { "min": [364000, 5800000, 0], "max": [366000, 5802000, 120] },
      "points": 18500000
    }
  ],
  "name": "Melbourne 2018 Survey",
  "attribution": "© Geoscience Australia CC BY 4.0",
  "srs": "EPSG:28355"
}
```

`parseManifest()` validates: `version === "1.0"`, non-empty `tiles`, every tile has a `url` string, `bounds.min/max` are 3-element numeric arrays, `points` is a positive finite number if present.

URL scheme validation is NOT done in the parser — it is handled by `validateManifestUrl()` (security layer) and by `StreamingEngine` which calls `validateSourceUrl` on each tile URL.

---

## Chunk index namespacing

Each tile's chunk indices are globally offset to prevent ring-buffer collisions:

```
tile 0: offset = 0,          range [0,     N0)
tile 1: offset = N0,         range [N0,    N0+N1)
tile 2: offset = N0+N1,      range [N0+N1, N0+N1+N2)
```

Offsets are computed in `checkAllSettled()` after ALL tiles have called `onSeedsReady` (guaranteeing all `engine.chunkCount` values are available). The decode loop only starts after `checkAllSettled()` fires the combined `onSeedsReady`, so no `onChunkDecoded` event can arrive with an un-initialised offset.

`engine.chunkCount` getter (added to `StreamingEngine`) returns `this.chunks.length` — set after the chunk-table parse stage, which always completes before `onSeedsReady` fires.

---

## Load flow

```
ManifestSession.load()
  → for each tile: new StreamingEngine(tileEvents, perTileWorkers, ...)
  → Promise.all(engines.map(e => e.load(tile.url)))
       ↓  (each engine: header → chunk table → seed points)
  → per-tile onSeedsReady intercepted: collect seeds + header
  → checkAllSettled() once tilesSettled === tiles.length
       ↓
  compute offsets from engine.chunkCount[]
  apply offset to each seed's chunkIndex
  mergeHeaders(validHeaders)  →  combined bbox + pointCount
  events.onSeedsReady(allSeeds, combinedHeader)  →  main.ts triggers render + startDecodeLoop
```

---

## Tile failure handling

`makeTileEvents().onError` converts per-tile engine errors into `onWarning` calls so a single tile failure doesn't abort the whole session:

- Failed tile → `onWarning("Tile N failed to load (url): message")` + `onFailed()` callback
- `onFailed()` increments `tilesSettled` → `checkAllSettled()` still fires when all tiles settle
- If ALL tiles fail → `onError(new Error('All manifest tiles failed to load.'))`
- Remaining tiles continue loading and rendering normally

---

## Worker budget distribution

```typescript
const perTileWorkers = Math.max(1, Math.floor(totalWorkers / tiles.length))
// Each tile gets an equal share of the total worker budget.
```

A shared worker pool (Phase 4 SDK) would be more efficient — per-tile pools are the Phase 3 v1 approach.

---

## GPU eviction routing

The renderer calls `renderer.setChunkEvictedCallback(idx => session.onChunkEvictedFromGPU(idx))`. The session's `onChunkEvictedFromGPU(globalIndex)` resolves the tile via `resolveGlobalIndex()` (reverse scan of offsets array) and forwards the local index to the correct engine.

---

## `ManifestSessionOptions`

```typescript
export interface ManifestSessionOptions {
  events: EngineEvents
  workerCount?: number
  sseThreshold?: number
  maxFetches?: number
}
```

Mirrors the relevant constructor params of `StreamingEngine` — no options-object wrapper exists on `StreamingEngine` itself (it takes positional args).

---

## URL validator additions

`src/network/url-validator.ts` was extended with:

| Export | Purpose |
|--------|---------|
| `validateManifestUrl(raw)` | Same scheme/IP checks as `validateSourceUrl`; expects `.lazm.json` extension |
| `EntryParam` | `{ type: 'laz' \| 'manifest'; url: string }` |
| `getEntryFromParams()` | Reads `?manifest=` (priority) then `?url=` from page URL |
| `getUrlFromParams()` | `@deprecated` — alias for `getEntryFromParams()?.url ?? null` |

Shared validation logic extracted into private `validateUrl(raw, endsWith, label)` to avoid duplication.

---

## See also

- [[Manifest Format]] — `.lazm.json` spec (concepts page)
- [[Streaming Engine]] — per-tile engine, `chunkCount` getter
- [[Ring Buffer GPU Memory]] — receives globally-namespaced chunk indices
- [[LidarScout Chunk-Seed]] — seeds aggregated across all tiles
