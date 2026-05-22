---
title: Manifest Format
type: concept
status: active
updated: 2026-05-23
tags: [manifest, lazm, json, multi-tile, url-params, single-file, validation]
---

# Manifest Format

Defines the `.lazm.json` file format for loading multiple LAZ files in a single viewer session. A manifest is the multi-tile entry point to lazstream; a single `.laz` URL is a degenerate case that the [[Manifest Loader]] wraps in a synthetic manifest automatically.

---

## Why JSON

- `fetch().then(r => r.json())` — zero parser overhead
- Human-readable and hand-editable (operators can author manifests in a text editor)
- Consistent with STAC, 3D Tiles, and every modern geospatial spec
- Smaller than equivalent XML

Extension: `.lazm.json` (LAZ Manifest). The double extension keeps it unambiguous — `.json` ensures any HTTP server serves it with the correct MIME type; `.lazm` identifies the schema.

---

## Full specification (v1.0)

```jsonc
{
  // ── Required ────────────────────────────────────────────────────────────
  "version": "1.0",
  "tiles": [
    {
      // Required per tile
      "url": "https://storage.example.com/tile_0001.laz",

      // Optional per-tile metadata.
      // When provided, the Manifest Loader skips the header fetch for that tile.
      // When absent, the Loader issues a range request to discover these values.
      "bounds": {
        "min": [294000.0, 6236000.0, 0.0],
        "max": [295000.0, 6237000.0, 500.0]
      },
      "points": 19234567,
      "srs": "EPSG:28355"
    },
    {
      // Minimal tile entry — no metadata, Loader must discover via header fetch
      "url": "https://storage.example.com/tile_0002.laz"
    }
  ],

  // ── Optional global metadata ─────────────────────────────────────────────
  "srs": "EPSG:28355",            // Default SRS applied to tiles with no per-tile srs
  "name": "Melbourne 2018",       // Display name shown in the UI
  "attribution": "City of Melbourne (CC BY 4.0)",

  // ── Optional sidecar references ──────────────────────────────────────────
  // These are not yet produced or consumed; reserved for Phase 3 caching layer.
  "sidecars": {
    "index":    "https://storage.example.com/project.lazm.idx",
    "overview": "https://storage.example.com/project.lazm.lod"
  }
}
```

---

## Field reference

### Top-level required

| Field | Type | Notes |
|-------|------|-------|
| `version` | `"1.0"` | Must be exactly the string `"1.0"`. Loader rejects anything else. |
| `tiles` | `TileEntry[]` | Non-empty array. At least one entry required. |

### Top-level optional

| Field | Type | Notes |
|-------|------|-------|
| `srs` | string | EPSG code or PROJ string. Fallback for tiles with no per-tile `srs`. |
| `name` | string | Human-readable dataset name. Shown in the stats overlay. |
| `attribution` | string | Attribution text. Shown in the UI footer. |
| `sidecars` | object | Reserved. See [Sidecars](#sidecars) below. |

### TileEntry

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | ✓ | Must be `https:`. `http:` allowed only on localhost. |
| `bounds.min` | `[x, y, z]` | — | Native CRS coordinates (not geographic degrees). |
| `bounds.max` | `[x, y, z]` | — | Must accompany `bounds.min`. |
| `points` | number | — | Approximate total point count for progress estimation. |
| `srs` | string | — | Per-tile CRS. Overrides the global `srs`. |

**Providing `bounds` + `points` + `srs` per tile is strongly recommended for large datasets.** Without them, the Manifest Loader must issue one header range request per tile before streaming begins, adding latency proportional to tile count.

---

## Single-file shorthand

When the user supplies a single `.laz` URL (via `?url=` query parameter) the [[Manifest Loader]] wraps it in a synthetic manifest before any further processing. The manifest format is the single internal representation — there is no special single-file code path beyond this wrapping step.

```typescript
// ?url=https://example.com/scan.laz  →  synthetic manifest:
const manifest: Manifest = {
  version: "1.0",
  tiles: [{ url: "https://example.com/scan.laz" }]
}
```

No `.lazm.json` file is needed for single-file use.

---

## URL parameter entry points

| Parameter | Accepts | Example |
|-----------|---------|---------|
| `?url=` | Direct `.laz` URL | `?url=https://r2.example.com/scan.laz` |
| `?manifest=` | `.lazm.json` URL | `?manifest=https://r2.example.com/project.lazm.json` |

Both are validated through security checks before any fetch is issued. `?manifest=` takes precedence if both are present. See [[Manifest Loader]] — URL validation.

---

## Validation rules

The Manifest Loader validates before loading any tile:

1. `version` exists and equals `"1.0"` — reject with a versioning error otherwise (future-proof for `"2.0"`)
2. `tiles` is a non-empty array — empty manifests are a user error, not silently ignored
3. Every tile has a `url` field that passes `validateSourceUrl()` — scheme whitelist (`https:` / localhost `http:`)
4. If `bounds` is present it must have both `min` and `max` as 3-element numeric arrays
5. Total declared `points` (sum across tiles, if provided) must not exceed the viewer's configured point budget ceiling

CORS is not pre-validated at manifest parse time — it is discovered at the first range request per tile. A failed CORS preflight produces a user-facing error with actionable guidance.

---

## Multi-tile loading behaviour

All tiles load in parallel. The viewer waits for all tiles' headers and seed points before displaying the initial overview, so the camera frames the full combined dataset extent on first render.

If one tile fails (network error, bad file):
- `onWarning` fires with the tile URL and error message
- That tile is skipped; remaining tiles continue loading
- The combined overview uses seeds from successful tiles only
- If ALL tiles fail, `onError` fires

Chunk index collision is prevented by assigning each tile a `chunkIndexOffset`:
```
tile 0: chunks [0,     N0)
tile 1: chunks [N0,    N0+N1)
tile 2: chunks [N0+N1, N0+N1+N2)
```
Offsets are computed after all tile headers are parsed. The decode loop does not start until all tiles have seeded, guaranteeing offsets are stable before any chunk dispatch.

---

## Multi-tile coordinate handling

When tiles carry different `srs` values, the [[Streaming Engine]] reprojects each tile's points into a common scene coordinate system via `proj4` before uploading to the GPU ring buffer. The target CRS is:

- The global manifest `srs` if present
- The `srs` of the first tile otherwise
- EPSG:4978 (ECEF) as last resort (avoids CRS mismatch errors at the cost of non-metric scene units)

This reprojection path is planned for Phase 3 and not yet implemented. Currently, all tiles must share the same CRS.

---

## Sidecars

Reserved for Phase 3. Not produced or consumed yet.

| Sidecar key | Extension | Purpose |
|-------------|-----------|---------|
| `index` | `.lazm.idx` | Pre-computed per-chunk AABB index. Avoids the background AABB decode pass on revisit. |
| `overview` | `.lazm.lod` | Pre-sampled overview point cloud at fixed density. Replaces seed-point overview. |

Format of `.lazm.idx` and `.lazm.lod` is undecided — see open questions.

---

## Constraints

- Manifests are fetched with `cache: 'no-store'` (COOP/COEP requirement — see [[HTTP/2 Range Requests]])
- Manifest fetch must complete before any tile streaming begins (sequential, not speculative)
- Manifest size must be < 10 MB (a manifest with 100,000 tile entries at ~60 bytes/entry ≈ 6 MB; beyond that, a spatial index format is more appropriate)

---

## Open questions

- [ ] Sidecar `.lazm.idx` format: custom binary vs. CBOR vs. compressed JSON? Decision point: Phase 3 caching layer.
- [ ] Should `bounds` accept geographic coordinates (lon/lat) as well as native CRS? Currently native CRS only — simpler, avoids a CRS assumption.
- [ ] Version negotiation: if a `"2.0"` manifest is loaded by a `"1.0"` viewer, should it warn or hard-reject?
- [ ] Should the manifest support streaming tile lists (NDJSON) to avoid loading a huge JSON blob for very large projects?

---

## See also

- [[Manifest Loader]] — parses and validates manifests; wraps single URLs
- [[Streaming Engine]] — consumes `TileEntry[]`; orchestrates per-tile streaming engines
- [[HTTP/2 Range Requests]] — CORS and `cache: 'no-store'` requirements
- [[Chunk Caching]] — sidecar `.lazm.idx` will feed the cache layer in Phase 3
- [[Spatial Index]] — tile-level spatial index built from manifest bounds
