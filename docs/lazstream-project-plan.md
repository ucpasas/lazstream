# lazstream — Browser-Based LAZ Point Cloud Viewer

## Project Plan & Technical Architecture

**Version:** 0.2 (Decisions Locked)
**Date:** 2026-05-09
**Author:** Kix + Claude (Geospatial Solutions Architect)

---

## 1. Project Definition

### 1.1 What It Is

A browser-based point cloud viewer that streams arbitrary LAZ files directly from cloud storage (S3, Azure Blob, Cloudflare R2) and renders them at 30fps without server-side preprocessing. Users provide a URL to a LAZ file (or a manifest of multiple LAZ files) and get an interactive 3D viewer. No COPC conversion, no tile server, no installation.

### 1.2 What It Is Not

- Not a GIS analysis tool (no measurements, cross-sections, or spatial queries in v1)
- Not a COPC/EPT viewer (those already exist — Potree, viewer.copc.io, Giro3D)
- Not a desktop application (browser-only, Chromium target)
- Not a file converter (source LAZ files are never modified)

### 1.3 Why It Matters

Every existing browser point cloud viewer requires preprocessing: LAZ → COPC, LAZ → EPT, or LAZ → 3D Tiles. This preprocessing step is a barrier to adoption — it requires tooling knowledge (PDAL, untwine, PotreeConverter), compute resources, and storage for the converted output. lazstream eliminates that barrier entirely. Drop a public LAZ URL, get an interactive viewer.

The technical differentiator is the LidarScout chunk-seed technique (HPG 2025) adapted for the browser: exploiting the uncompressed first point of every LAZ chunk to provide instant spatial overviews before any arithmetic decoding begins.

### 1.4 Success Criteria (Ordered by Priority)

| # | Criterion | Target | Hard Minimum |
|---|-----------|--------|--------------|
| 1 | Point capacity | 500M points | 100M points |
| 2 | Frame rate | 60 fps | 30 fps |
| 3 | Time to first frame | < 3 s | < 10 s |
| 4 | Time to interactive detail | < 6 s (100M pts) | < 10 s |
| 5 | Cloud storage support | S3, Blob, R2 | Any HTTP with Range + CORS |
| 6 | Browser support | Chrome 120+, Edge 120+ | Any Chromium with WebGPU |
| 7 | SDK integration | `npm install lazstream` | Importable ES module |
| 8 | URL sharing (MVP) | `?url=https://...` full URL in query param | Working with public URLs |
| 9 | URL sharing (post-MVP) | Short URL + camera position/orientation encoded | Priority feature after core complete |

### 1.5 LAZ Version Scope (Locked)

| Version | Chunk-seed overview | Parallel decode | Selective layer decode | Status |
|---------|--------------------|-----------------|-----------------------|--------|
| LAZ 1.4 PDRF 6–10 | ✅ | ✅ | ✅ (XYZ-only fast path) | **Primary target — full performance** |
| LAZ 1.2/1.3 PDRF 0–5 | ✅ | ✅ | ❌ (all-or-nothing per chunk) | Supported — degraded performance |
| Uncompressed LAS | ❌ | ❌ | ❌ | Rejected — clear error to user |

**Detection:** byte 24 (major version) + byte 25 (minor version) in LAS header. Set `isLayered: boolean` flag on first header fetch; all decode paths branch on this flag.

**User communication:** If a LAZ 1.2/1.3 file is loaded, show a non-blocking banner: "This file uses an older compression format — loading will be slower. Consider converting to LAZ 1.4 for better performance."

---

## 2. Technical Stack

### 2.1 Stack Decision Matrix

| Layer | Choice | Alternatives Considered | Rationale |
|-------|--------|------------------------|-----------|
| **Renderer** | Three.js r168+ (WebGPURenderer) | Raw WebGPU, Babylon.js, deck.gl | Three.js provides camera/matrix/controls infrastructure; WebGPURenderer gives compute shader access; largest ecosystem |
| **LAZ Decoder** | laz-perf 0.0.7 (WASM) | laz-rs-wasm, custom decoder | Pre-built npm package, Apache 2.0, proven in Potree/Giro3D/plasio. laz-rs has no published WASM npm package. |
| **Spatial Index** | rbush (2D) + custom chunk index | rbush-3d, flatbush, kd-tree | rbush is 10KB, stable, handles chunk-level AABB culling. 2D is sufficient for aerial LiDAR frustum culling. |
| **Bundler** | Vite 6 | webpack, esbuild, Rollup | Fast HMR, native ESM, proven in giro3d-viewer. Library mode for SDK builds. |
| **Language** | TypeScript 5.5+ | JavaScript | SDK target requires type definitions; TS catches spatial math bugs at compile time |
| **Workers** | Native Web Workers | Comlink, workerpool | Minimal abstraction; Transferable ArrayBuffers are the hot path — wrappers add latency |
| **Caching** | IndexedDB (idb-keyval) | Cache API, localStorage | Stores decoded chunk buffers + sidecar metadata; survives page reload; per-origin quota ~60% free disk |
| **HTTP** | Fetch API + ReadableStream | XMLHttpRequest, axios | Native Range request support, HTTP/2 multiplexing automatic, streaming body for progressive decode |

### 2.2 Dependencies (Production)

```json
{
  "dependencies": {
    "three": "^0.168.0",
    "laz-perf": "^0.0.7",
    "rbush": "^4.0.0",
    "idb-keyval": "^6.2.0",
    "proj4": "^2.12.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "@types/three": "^0.168.0"
  }
}
```

**Total production bundle (estimated):** ~1.8 MB (three.js ~800KB, laz-perf WASM ~400KB, rest ~100KB, app code ~500KB).

### 2.3 Browser Requirements

| Feature | Required | Fallback |
|---------|----------|----------|
| WebGPU | Yes (compute shaders) | WebGL2 with GL_POINTS (capped at ~50M pts) |
| Web Workers | Yes | None — decode on main thread is not viable |
| Fetch + Range headers | Yes | None — streaming requires byte-range reads |
| SharedArrayBuffer | Optional (perf boost) | Transferable ArrayBuffers (one copy per chunk) |
| IndexedDB | Optional (caching) | No persistence; re-decode on revisit |

**SharedArrayBuffer note:** Requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` HTTP headers. These break some third-party embeds (Google Analytics, YouTube iframes). Decision: ship without SAB in v1; add as opt-in when headers can be controlled.

---

## 3. Architecture

### 3.1 Module Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  @lazstream/viewer (Host Application)                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  UI Shell (HTML/CSS)                                      │  │
│  │  - Progress bar, stats overlay, controls                  │  │
│  │  - NOT part of the SDK — app-specific                     │  │
│  └───────────────┬───────────────────────────────────────────┘  │
│                  │ uses                                          │
│  ┌───────────────▼───────────────────────────────────────────┐  │
│  │  @lazstream/core (SDK — the reusable library)             │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌────────────────────┐  │  │
│  │  │ Manifest    │ │ Streaming   │ │ Renderer           │  │  │
│  │  │ Loader      │ │ Engine      │ │ (Three.js/WebGPU)  │  │  │
│  │  │             │ │             │ │                    │  │  │
│  │  │ - parse     │ │ - fetch     │ │ - GPU buffers      │  │  │
│  │  │ - validate  │ │ - decode    │ │ - compute shaders  │  │  │
│  │  │ - resolve   │ │ - index     │ │ - camera + LOD     │  │  │
│  │  │   URLs      │ │ - cache     │ │ - EDL post-proc    │  │  │
│  │  └──────┬──────┘ └──────┬──────┘ └─────────┬──────────┘  │  │
│  │         │               │                   │             │  │
│  │  ┌──────▼───────────────▼───────────────────▼──────────┐  │  │
│  │  │  Shared Types + Events (EventEmitter)               │  │  │
│  │  │  - LazFile, Chunk, ChunkAABB, ManifestConfig        │  │  │
│  │  │  - on('overview-ready'), on('chunk-decoded'), etc.   │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                  │ spawns                                        │
│  ┌───────────────▼───────────────────────────────────────────┐  │
│  │  Web Workers (decode pool)                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │
│  │  │ Worker 1 │ │ Worker 2 │ │ Worker 3 │ │ Worker N │    │  │
│  │  │ laz-perf │ │ laz-perf │ │ laz-perf │ │ laz-perf │    │  │
│  │  │ WASM     │ │ WASM     │ │ WASM     │ │ WASM     │    │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 SDK vs App Boundary (Critical Design Decision)

The SDK (`@lazstream/core`) exposes a **programmatic API**, not a UI:

```typescript
// SDK usage in any web app
import { LazStreamViewer } from '@lazstream/core';

const viewer = new LazStreamViewer({
  container: document.getElementById('viewer'),
  workerCount: navigator.hardwareConcurrency - 1,
  pointBudget: 5_000_000,
  cacheSize: 1024 * 1024 * 1024, // 1 GB IndexedDB
});

// Single file
await viewer.load('https://storage.example.com/scan.laz');

// Manifest
await viewer.loadManifest('https://storage.example.com/project.lazm.json');

// Events
viewer.on('overview-ready', ({ pointCount, bounds }) => { ... });
viewer.on('progress', ({ decoded, total, fps }) => { ... });
viewer.on('error', ({ code, message, url }) => { ... });

// Controls
viewer.setPointBudget(10_000_000);
viewer.setColorBy('classification'); // 'elevation' | 'intensity' | 'rgb'
viewer.flyTo({ center: [x, y, z], distance: 500 });
viewer.dispose();
```

**The hosted viewer** (`@lazstream/viewer`) is a thin app that uses the SDK and adds:
- URL parameter parsing (`?url=...`, `?manifest=...`)
- UI controls (point budget slider, color mode selector, stats overlay)
- Share button (copies URL to clipboard)
- Error display

This separation means any developer can `npm install @lazstream/core` and embed the viewer in their own app without carrying our UI opinions.

### 3.3 Streaming Pipeline (Data Flow)

```
User provides URL(s)
    │
    ▼
┌─ Manifest Loader ──────────────────────────────────────────┐
│  1. If single URL: wrap in synthetic manifest               │
│  2. If manifest URL: fetch + parse + validate               │
│  3. Resolve relative URLs to absolute                        │
│  4. Emit: ManifestConfig { tiles: TileEntry[] }             │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─ Streaming Engine (per tile, parallelized) ─────────────────┐
│                                                              │
│  Stage 1: Header Scan (~200ms)                               │
│  ├─ Fetch bytes 0–64KB (LAS header + VLRs)                  │
│  ├─ Fetch bytes -1MB (chunk table from EOF)                  │
│  │  (both in parallel on HTTP/2)                             │
│  ├─ Parse: point format, point count, bbox, SRS              │
│  ├─ Parse: chunk table → array of {offset, size}             │
│  └─ Emit: 'header-parsed' { bounds, pointCount, srs }       │
│                                                              │
│  Stage 2: Seed Point Overview (~500ms)                       │
│  ├─ Compute byte offset of first raw point per chunk         │
│  ├─ Fetch seed bytes via coalesced Range requests            │
│  ├─ Parse raw PDRF records (no arithmetic decode)            │
│  ├─ Build rbush index from seed positions                    │
│  ├─ Upload seed points to GPU buffer                         │
│  └─ Emit: 'overview-ready' { seedCount, bounds }             │
│                                                              │
│  Stage 3: Progressive Chunk Decode (ongoing)                 │
│  ├─ Camera frustum → rbush query → visible chunks            │
│  ├─ Priority queue: SSE = (spacing * canvasH) / (dist * fov) │
│  ├─ Coalesce adjacent chunks into 2-4 MB Range requests      │
│  ├─ Dispatch to worker pool → laz-perf decode                │
│  ├─ Quantize: Int32 XYZ → Int16 per-chunk-local coords      │
│  ├─ Transfer decoded buffer back (Transferable)              │
│  ├─ Update chunk AABB in rbush (tighten from seed estimate)  │
│  ├─ Upload to GPU ring buffer                                │
│  ├─ Cache decoded chunk in IndexedDB (LRU eviction)         │
│  └─ Emit: 'chunk-decoded' { chunkIndex, pointCount }         │
│                                                              │
│  Stage 4: Background AABB Pass (low priority)                │
│  ├─ Decode remaining chunks at lowest worker priority         │
│  ├─ Compute tight AABB per chunk                             │
│  ├─ Persist all AABBs to IndexedDB for next visit            │
│  └─ Emit: 'index-complete' { chunkCount }                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                             ▼
┌─ Renderer ──────────────────────────────────────────────────┐
│  GPU ring buffer (256MB, append-only, cyclic eviction)       │
│  ├─ Int16 XYZ + Uint8 RGBA per point (10 bytes/point)       │
│  ├─ Per-chunk uniforms: origin (f64), scale (f32)            │
│  │                                                           │
│  WebGPU compute pass (Schütz atomic-depth technique):        │
│  ├─ Transform points: origin + scale * quantized → world     │
│  ├─ Project: viewProj * worldPos → screenPos                 │
│  ├─ Frustum cull per-point                                   │
│  ├─ atomicMin(depthBuffer[pixel], depth)                     │
│  ├─ Write color if depth test passed                         │
│  │                                                           │
│  WebGPU render pass (fullscreen quad):                        │
│  ├─ Sample depth+color buffer → canvas                       │
│  ├─ Eye-dome lighting post-process                           │
│  └─ Stats overlay (point count, FPS, decode rate)            │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Manifest Format

### 4.1 Format Choice: JSON

JSON over XML because:
- Native `fetch().then(r => r.json())` — no parser needed
- Human-readable and hand-editable
- Consistent with STAC, 3D Tiles, and every modern geospatial spec
- Smaller than equivalent XML

### 4.2 Specification: `.lazm.json` (LAZ Manifest)

```jsonc
{
  // Required
  "version": "1.0",
  "tiles": [
    {
      "url": "https://storage.example.com/tile_0001.laz",
      // Optional per-tile metadata (avoids header fetch if provided)
      "bounds": {
        "min": [294000.0, 6236000.0, 0.0],
        "max": [295000.0, 6237000.0, 500.0]
      },
      "points": 19234567,
      "srs": "EPSG:6343"
    },
    {
      "url": "https://storage.example.com/tile_0002.laz"
      // No metadata — viewer will fetch header to discover
    }
  ],

  // Optional global metadata
  "srs": "EPSG:6343",           // Default SRS if not per-tile
  "name": "Central Texas 2017", // Display name
  "attribution": "USGS 3DEP",  // Attribution string
  
  // Optional sidecar references
  "sidecars": {
    "index": "https://storage.example.com/project.lazm.idx",
    "overview": "https://storage.example.com/project.lazm.lod"
  }
}
```

### 4.3 Single-File Shorthand

When the user provides a single `.laz` URL (not a manifest), the viewer wraps it in a synthetic manifest internally:

```typescript
// ?url=https://example.com/scan.laz
// becomes:
const manifest = {
  version: "1.0",
  tiles: [{ url: "https://example.com/scan.laz" }]
};
```

No manifest file needed for single-file use.

### 4.4 Manifest Validation

Before loading, validate:
- `version` field exists and is `"1.0"`
- `tiles` is a non-empty array
- Each tile has a `url` field that is a valid HTTPS URL (HTTP allowed only on localhost)
- URLs resolve to the same origin or have CORS headers (tested via preflight)
- Total estimated point count (if provided) is within the viewer's stated capacity

---

## 5. Security

### 5.1 Threat Model

The primary attack surface is **user-supplied URLs**. The viewer fetches arbitrary URLs provided via query parameters or manifest files.

| Threat | Risk | Mitigation |
|--------|------|------------|
| **SSRF (Server-Side Request Forgery)** | Low — viewer runs client-side only, no server component | N/A — no server to exploit |
| **XSS via URL parameter** | Medium — `?url=javascript:...` or `?url=data:...` | URL scheme whitelist: only `https:` (and `http:` on localhost for dev) |
| **Malicious LAZ file** | Medium — crafted LAZ could crash the decoder or exhaust memory | laz-perf runs in a Web Worker (isolated); OOM kills the worker, not the page. Validate LAS header magic bytes before decode. |
| **Data exfiltration via manifest** | Low — manifest could reference internal URLs | Client-side only; CORS prevents reading responses from non-permissioned origins |
| **Mixed content** | Medium — HTTP LAZ on HTTPS page blocked by browsers | Enforce HTTPS for all remote URLs; warn on HTTP |
| **Open redirect** | Low — `?url=` could be used to phish | Viewer only fetches binary data, never renders HTML from the URL |
| **Denial of service (client)** | Medium — 100GB LAZ file could exhaust memory | Enforce point budget ceiling (configurable, default 20M GPU-resident); abort fetch if `Content-Length` exceeds configurable max (default 10GB) |
| **URL injection in shared links** | Medium — crafted share URLs with XSS payloads | Sanitise URL parameters on parse; never use `innerHTML` with URL-derived content |

### 5.2 URL Sanitisation

```typescript
function validateSourceUrl(raw: string): URL {
  const url = new URL(raw); // Throws on malformed

  // Scheme whitelist
  const allowed = ['https:'];
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    allowed.push('http:');
  }
  if (!allowed.includes(url.protocol)) {
    throw new SecurityError(`Blocked scheme: ${url.protocol}`);
  }

  // Block data: and javascript: (defense in depth — already caught by scheme check)
  if (url.protocol === 'data:' || url.protocol === 'javascript:') {
    throw new SecurityError('Blocked dangerous URI scheme');
  }

  // Block private/internal IPs (defense in depth — CORS will also block)
  const ip = url.hostname;
  if (isPrivateIP(ip) && !isLocalhost(ip)) {
    throw new SecurityError('Blocked private IP address');
  }

  return url;
}
```

### 5.3 CORS Requirements

The viewer is **purely client-side** — all data fetching happens in the browser via `fetch()`. This means:

- **Cloud storage must have CORS configured** to allow `GET` + `Range` headers from the viewer's origin
- S3: bucket CORS policy with `AllowedHeaders: ["Range"]`, `AllowedMethods: ["GET", "HEAD"]`
- R2: CORS configured in Cloudflare dashboard (already done for `geospatial-vision` bucket)
- Azure Blob: CORS rules in storage account settings

The viewer cannot bypass CORS. If a LAZ file isn't accessible, the viewer shows a clear error: "This file's server doesn't allow cross-origin access. The storage administrator needs to enable CORS."

### 5.4 Content-Security-Policy

For the hosted viewer, ship with:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:;
  connect-src https: http://localhost:*;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
```

- `wasm-unsafe-eval` required for laz-perf WASM instantiation
- `blob:` required for Web Worker creation from bundled code
- `connect-src https:` allows fetching LAZ from any HTTPS origin
- No `unsafe-eval` — all code is bundled, no dynamic eval

---

## 6. Cloud Storage Compatibility

### 6.1 Requirements Per Provider

| Provider | Range Requests | CORS | HTTP/2 | Notes |
|----------|---------------|------|--------|-------|
| **AWS S3** | ✅ Native | ✅ Configurable | ✅ Via CloudFront | Multi-range requests NOT supported; use parallel single-range |
| **Cloudflare R2** | ✅ Native | ✅ Configurable | ✅ Native | Zero egress cost — ideal for COPC/LAZ range request patterns |
| **Azure Blob** | ✅ Native | ✅ Configurable | ✅ Via CDN | `x-ms-range` header also accepted alongside standard `Range` |
| **Google Cloud Storage** | ✅ Native | ✅ Configurable | ✅ Via CDN | |
| **MinIO** | ✅ S3-compatible | ✅ Configurable | Depends on proxy | Self-hosted; common in enterprise |
| **Any HTTP server** | ✅ If `Accept-Ranges: bytes` | ❓ Must configure | ❓ Depends | nginx, Apache, Caddy all support Range by default |

### 6.2 Storage Detection and Adaptation

The viewer detects storage capabilities via a `HEAD` request before streaming:

```typescript
async function probeStorage(url: URL): Promise<StorageCapabilities> {
  const head = await fetch(url, { method: 'HEAD' });
  return {
    supportsRange: head.headers.get('Accept-Ranges') === 'bytes',
    contentLength: parseInt(head.headers.get('Content-Length') || '0'),
    cors: true, // If HEAD succeeded, CORS is working
    http2: /* inferred from performance.getEntriesByType('resource') */
  };
}
```

If Range requests aren't supported, the viewer falls back to full-file download (viable for files < 200MB).

---

## 7. Rendering Architecture

### 7.1 WebGPU Compute Shader Point Renderer

The renderer uses the Schütz atomicMin technique (CGF 2021) adapted for WebGPU:

**Why compute shaders over point primitives:**
- `GL_POINTS` / `point-list` topology caps at ~700M points (Kitware 2025 benchmark)
- Compute shaders: 2B points at 30fps on the same hardware
- 10× throughput improvement for datasets > 100M points

**Pipeline:**
1. **Compute pass** — one dispatch per loaded chunk buffer:
   - Workgroup size: 128 threads
   - Each thread transforms one point: dequantize → world → clip → screen
   - Per-point frustum cull (cheap — just clip-space bounds check)
   - `atomicMin` on a u32 depth buffer; write color if depth test passes
2. **Render pass** — fullscreen quad:
   - Fragment shader samples the depth+color buffer
   - Eye-dome lighting applied as post-process (4 neighbor depth samples)
   - Output to canvas

### 7.2 WebGL2 Fallback (Nice-to-Have — Post-Core)

Deferred until all core features are complete and validated. For browsers without WebGPU (Safari, older Chrome):
- Standard Three.js `Points` with `BufferGeometry`
- `ShaderMaterial` with per-chunk uniforms for dequantization
- Point budget reduced to 5M (vs 20M for WebGPU)
- No compute shader LOD — use stride-based decimation instead

### 7.3 GPU Memory Management

```
Ring Buffer Layout (256 MB default):
┌──────────┬──────────┬──────────┬──────────┬─ ─ ─ ─ ─┐
│ Chunk 0  │ Chunk 1  │ Chunk 2  │ Chunk 3  │  ...     │
│ 50K pts  │ 50K pts  │ 50K pts  │ 50K pts  │          │
│ 500 KB   │ 500 KB   │ 500 KB   │ 500 KB   │          │
└──────────┴──────────┴──────────┴──────────┴─ ─ ─ ─ ─┘
  ← write head moves forward; evicts oldest when full →
```

- 256 MB buffer holds ~25M points at 10 bytes/point (Int16×3 + RGBA8)
- LRU eviction: when buffer is full, overwrite the chunk furthest from camera
- Per-chunk metadata array tracks: chunkIndex, offset in buffer, pointCount, AABB, lastRenderedFrame
- Multiple buffers if > 25M points needed simultaneously (split at WebGPU 4GB buffer limit)

---

## 8. Development Phases

### Phase 1: Core Streaming + Seed Overview (Weeks 1–3)

**Goal:** Load a single LAZ file from a URL and render chunk seed points within 3 seconds.

**Deliverables:**
- TypeScript project scaffold with Vite + Three.js WebGPURenderer
- LAS header parser (bytes 0–375, VLR scan for LAZ VLR)
- Chunk table parser (EOF read, decode chunk offsets + sizes)
- Chunk seed point extractor (read raw uncompressed first point per chunk)
- Basic Three.js `Points` rendering of seed points (WebGL2 — compute shaders in Phase 2)
- Dual-range parallel fetch (header + tail) for single-RTT cold start
- rbush spatial index populated from seed positions
- `?url=` query parameter support
- Stats overlay: point count, FPS, load state

**Validation:**
- Load USGS Central Texas tile (19M points) from R2
- Seed overview visible in < 2s on 100 Mbps connection
- Load a 100M+ point file from USGS 3DEP public S3 and confirm seed overview works

### Phase 2: Worker Pool Decode + WebGPU Compute Renderer (Weeks 3–5)

**Goal:** Full chunk decode with parallel workers, WebGPU compute shader rendering, 30fps at 50M+ points.

**Deliverables:**
- Web Worker pool (N = `hardwareConcurrency - 1`, pinned laz-perf WASM instances)
- Chunk priority queue (screen-space error from camera + chunk AABB)
- HTTP/2 range-request coalescing (2–4 MB per coalesced fetch)
- Int16 quantization in workers (per-chunk-local coords)
- Transferable ArrayBuffer pipeline (zero-copy worker → main)
- WebGPU compute shader renderer (atomicMin depth + color)
- GPU ring buffer with LRU eviction
- Eye-dome lighting post-process
- Frame-amortized decode budget (never block render)
- Camera trajectory prediction for prefetch

**Validation:**
- 19M point tile at 60fps
- 100M point file at 30fps
- No frame drops during camera pan (decode runs async)

### Phase 3: Multi-Tile Manifest + Caching (Weeks 5–7)

**Goal:** Load multiple LAZ files from a manifest, with IndexedDB caching for revisits.

**Deliverables:**
- `.lazm.json` manifest parser + validator
- Multi-tile R-tree (tile-level spatial index for frustum culling)
- Per-tile streaming engine instances (shared worker pool)
- Unified coordinate system handling (detect per-tile SRS, reproject if needed via proj4)
- IndexedDB caching layer:
  - Decoded chunk buffers (LRU, configurable size)
  - Chunk table + AABB sidecar (persisted on first visit)
  - File fingerprint keyed by URL + Content-Length + Last-Modified
- Background AABB pass with IndexedDB persistence
- Coherence score detection (flag non-spatially-coherent files)

**Validation:**
- Load 10-tile manifest (200M total points) from R2
- Second visit loads from IndexedDB cache (< 1s to interactive)
- Mixed-SRS tiles render in unified coordinate system

### Phase 4: SDK Extraction + Hosted Viewer (Weeks 7–9)

**Goal:** Extract core into an npm-publishable SDK; build the hosted viewer app around it.

**Deliverables:**
- Monorepo structure:
  ```
  packages/
    core/        → @lazstream/core (SDK)
    viewer/      → @lazstream/viewer (hosted app)
    shared/      → @lazstream/types (shared TypeScript types)
  ```
- Vite library mode build for `@lazstream/core` (ESM + CJS + types)
- Public API surface:
  - `LazStreamViewer` — main entry point
  - `LazStreamEngine` — headless streaming engine (no renderer)
  - Event system (`on`, `off`, `once`)
  - Configuration types
- Hosted viewer:
  - URL parameter parsing (`?url=`, `?manifest=`, `?colorBy=`, `?budget=`)
  - Share button MVP: copies full `?url=https://...` to clipboard
  - UI controls (point budget, color mode, EDL toggle)
  - Error display with actionable CORS guidance
- GitHub Pages deployment via Actions (same pattern as giro3d-viewer)
- README with SDK usage examples
- `npm pack` verified — installable locally

**Validation:**
- `npm install @lazstream/core` in a fresh Vite project → renders a LAZ file
- Hosted viewer accessible at `ucpasas.github.io/lazstream`
- Share URL works: paste in new tab → same file loads

### Phase 5: Core Polish (Weeks 9–10)

**Goal:** Performance optimisation and edge case hardening on core features. Nice-to-haves explicitly excluded.

**Deliverables (core only):**
- Selective layer decode for LAZ 1.4 PDRF 6+ (XYZ-only fast path)
- WASM SIMD build of laz-perf (custom Emscripten build)
- File validation: LAS magic bytes check, version detection, meaningful errors for non-LAZ files
- Large file handling: abort + error for files > configurable max
- Network error handling: retry with exponential backoff, offline detection
- Performance profiling: `?debug=perf` mode with decode/render/network timing overlay
- LAZ 1.2 / 1.3 / 1.4 compatibility testing across real-world files

**Deferred to post-core (nice-to-haves):**
- Short URL + camera state share button — priority post-core feature
- WebGL2 fallback renderer — nice-to-have, not blocking
- PWA / Service Worker / offline support — nice-to-have
- Mobile detection + reduced settings — nice-to-have

---

## 9. Repository Structure

```
lazstream/
├── packages/
│   ├── core/                          # @lazstream/core (SDK)
│   │   ├── src/
│   │   │   ├── index.ts               # Public API exports
│   │   │   ├── viewer.ts              # LazStreamViewer class
│   │   │   ├── engine/
│   │   │   │   ├── streaming-engine.ts # Orchestrates fetch → decode → render
│   │   │   │   ├── manifest-loader.ts  # Parse + validate manifests
│   │   │   │   ├── header-parser.ts    # LAS header + LAZ VLR parsing
│   │   │   │   ├── chunk-table.ts      # Chunk table parsing + seed extraction
│   │   │   │   ├── chunk-priority.ts   # SSE-based priority queue
│   │   │   │   └── spatial-index.ts    # rbush wrapper for chunk AABBs
│   │   │   ├── decode/
│   │   │   │   ├── worker-pool.ts      # Web Worker lifecycle management
│   │   │   │   ├── decode-worker.ts    # Worker entry point (laz-perf)
│   │   │   │   └── quantizer.ts        # Int32 → Int16 quantization
│   │   │   ├── render/
│   │   │   │   ├── webgpu-renderer.ts  # Compute shader pipeline
│   │   │   │   ├── webgl-fallback.ts   # Three.js Points fallback
│   │   │   │   ├── ring-buffer.ts      # GPU memory management
│   │   │   │   ├── camera-controller.ts# OrbitControls wrapper
│   │   │   │   └── shaders/
│   │   │   │       ├── render-points.wgsl
│   │   │   │       ├── resolve.wgsl
│   │   │   │       └── edl.wgsl
│   │   │   ├── cache/
│   │   │   │   ├── idb-cache.ts        # IndexedDB chunk cache
│   │   │   │   └── sidecar-cache.ts    # AABB + chunk table persistence
│   │   │   ├── network/
│   │   │   │   ├── range-fetcher.ts    # HTTP Range request with coalescing
│   │   │   │   ├── storage-probe.ts    # Detect capabilities (Range, CORS)
│   │   │   │   └── url-validator.ts    # Security: URL sanitisation
│   │   │   └── types/
│   │   │       ├── las.ts              # LAS/LAZ format types
│   │   │       ├── manifest.ts         # Manifest schema types
│   │   │       └── events.ts           # Event type definitions
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts              # Library mode build
│   │
│   └── viewer/                         # @lazstream/viewer (hosted app)
│       ├── src/
│       │   ├── main.ts                 # Entry point
│       │   ├── url-params.ts           # Parse ?url=, ?manifest=, etc.
│       │   ├── ui/
│       │   │   ├── controls.ts         # Point budget, color mode, EDL
│       │   │   ├── stats-overlay.ts    # FPS, point count, decode rate
│       │   │   ├── error-display.ts    # User-facing error messages
│       │   │   └── share-button.ts     # Copy URL to clipboard
│       │   └── styles/
│       │       └── viewer.css
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
│
├── .github/
│   └── workflows/
│       └── deploy.yml                  # Build + deploy to GitHub Pages
├── package.json                        # Workspace root
├── tsconfig.base.json
├── CLAUDE.md                           # Project context for Claude Code
├── wiki/                               # llm-wiki (same pattern as geospatial-vision)
│   ├── index.md
│   ├── log.md
│   └── ...
└── README.md
```

---

## 10. Performance Budget

### 10.1 Frame Budget (33ms at 30fps)

| Phase | Budget | Notes |
|-------|--------|-------|
| Camera update + frustum cull | 1 ms | rbush query + SSE calc |
| Chunk priority update | 0.5 ms | Re-sort priority queue |
| GPU buffer updates (new chunks) | 2 ms | `queue.writeBuffer` for 1–3 chunks/frame |
| Compute pass (point rendering) | 8–15 ms | Scales with visible point count |
| Resolve + EDL pass | 2–4 ms | Fullscreen quad + 4 texture samples |
| JS overhead + GC | 2–4 ms | Event dispatch, stats update |
| **Total** | **15–27 ms** | **Headroom: 6–18 ms** |

### 10.2 Network Budget (per 100M points)

| Data | Size | When |
|------|------|------|
| LAS header + VLRs | ~4 KB | Immediate |
| Chunk table | ~64 KB (2K chunks) | Immediate |
| Seed points (2K × 30 bytes) | ~60 KB | < 1s |
| Visible chunks (5M point view) | ~50 MB compressed | 3–6s |
| Full file (background) | ~2.5 GB | Minutes (or never, if user doesn't zoom to every region) |

### 10.3 Memory Budget

| Component | Budget | Notes |
|-----------|--------|-------|
| GPU buffers (visible points) | 256 MB | ~25M points at 10 bytes/point |
| CPU decoded cache | 512 MB | ~50 chunks warm for quick pan-back |
| WASM heaps (N workers) | 50 MB | ~6 MB per laz-perf instance × 8 |
| JS heap (index, metadata) | 50 MB | rbush, chunk metadata |
| IndexedDB (persistent) | 1 GB | Configurable; LRU eviction |
| **Total runtime** | **~870 MB** | **Safe for 16GB+ desktop** |

---

## 11. Testing Strategy

### 11.1 Test Files

| File | Points | Format | Source | Purpose |
|------|--------|--------|--------|---------|
| USGS Central Texas | 19M | LAZ 1.4 PDRF 6 | R2 (existing) | Primary dev file |
| USGS 3DEP public tile | 50–100M | LAZ 1.2/1.4 | S3 (public) | Scale + format compat |
| AHN4 Netherlands tile | 100–500M | LAZ 1.4 PDRF 6 | Public download | Large file stress test |
| Mobile mapping scan | ~10M | LAZ 1.4 PDRF 7 | OpenTopography | Non-coherent file test |
| Synthetic corrupt LAZ | N/A | Invalid | Generated | Error handling test |

### 11.2 Automated Tests

- **Unit tests** (Vitest): header parser, chunk table parser, URL validator, manifest parser, quantizer
- **Integration tests** (Playwright): load file → assert seed points visible → assert FPS ≥ 30
- **Performance benchmarks** (custom): decode throughput, TTFF, memory peak — tracked in CI

---

## 12. Open Questions (To Resolve During Implementation)

| # | Question | Options | Decision Point |
|---|----------|---------|----------------|
| 1 | Monorepo tool | npm workspaces vs pnpm vs turborepo | Phase 4 — when extracting SDK |
| 2 | WebGPU adapter fallback | Auto-detect vs user toggle | Post-core nice-to-have — after WebGL2 fallback built |
| 3 | Coordinate system handling | Force all tiles to one CRS vs render per-tile in native CRS | Phase 3 — when multi-tile tested |
| 4 | Sidecar `.laz.idx` format | Custom binary vs JSON | Phase 3 — when caching layer built |
| 5 | Selective layer decode | Fork laz-perf vs build laz-rs-wasm | Phase 5 — profile first to confirm gain |
| 6 | Short URL service | Self-hosted vs third-party (e.g. Dub.co) | Post-core — priority feature after core complete |

---

## 13. Relationship to geospatial-vision

lazstream is a **separate repository** from geospatial-vision, but connected:

- **Data pipeline**: geospatial-vision's `pipeline-system` produces LAZ/COPC from raw data. lazstream consumes LAZ directly.
- **Storage**: Both use Cloudflare R2. lazstream test files served from the same `geospatial-vision` bucket.
- **Portfolio**: lazstream is linked from the geospatial-vision portfolio landing page as the flagship project.
- **Wiki**: lazstream gets its own wiki (same llm-wiki pattern), not merged into geospatial-vision's wiki.
- **CI/CD**: Separate GitHub Actions workflow; deployed to its own GitHub Pages subdomain.

---

## 14. Timeline Summary

| Phase | Weeks | Key Milestone |
|-------|-------|---------------|
| 1: Core Streaming + Seed Overview | 1–3 | Single LAZ loads with seed overview in < 3s |
| 2: Workers + WebGPU Renderer | 3–5 | 100M points at 30fps |
| 3: Multi-Tile + Caching | 5–7 | Manifest loading, revisit caching |
| 4: SDK + Hosted Viewer | 7–9 | `npm install @lazstream/core` works |
| 5: Polish + Performance | 9–10 | WebGL fallback, SIMD, edge cases |

**Total: 10 weeks to v1.0 core**

Post-core roadmap (priority order):
1. **Short URL + camera state share button** — encode camera position/orientation/zoom into a short URL so recipients open to the identical view
2. **WebGL2 fallback** — support non-WebGPU browsers (Safari, older Chrome)
3. **PWA / offline / Service Worker** — nice-to-have for repeat users
4. **Measurement tools** — distance, area, cross-section
5. **COPC dual-mode support** — accept COPC files natively alongside raw LAZ
6. **Classification filtering** — toggle ASPRS classes (ground, vegetation, buildings)
7. **Mobile-optimised renderer** — reduced settings, touch controls