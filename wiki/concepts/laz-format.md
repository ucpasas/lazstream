---
title: LAZ Format
type: concept
status: active
updated: 2026-05-16
tags: [laz, las, header, pdrf, chunk-table, compression]
---

# LAZ Format

LAS (LiDAR Aerial Survey) is the open standard point cloud format. LAZ is its lossless compressed variant. lazstream targets LAZ 1.2–1.4.

---

## LAS public header block

Bytes 0–374 (v1.4) or 0–226 (v1.2/1.3). Key fields:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | File signature (`LASF`) |
| 24 | 1 | Version major |
| 25 | 1 | Version minor |
| 94 | 1 | Point Data Record Format (PDRF) |
| 96 | 2 | Point Data Record Length |
| 100 | 4 | Offset to point data |
| 105 | 4 | Number of point records (v1.2/1.3) |
| 247 | 8 | Number of point records (v1.4, 64-bit) |

Version detection: read bytes 24–25. `1.4` → LAZ 1.4. `1.2` or `1.3` → legacy path.

---

## Point Data Record Formats (PDRF)

| PDRF | Version | Core | Intensity | RGB | Near-IR | Waveform |
|------|---------|------|-----------|-----|---------|----------|
| 0 | 1.2 | XYZ + return info | ✓ | — | — | — |
| 1 | 1.2 | PDRF 0 + GPS time | ✓ | — | — | — |
| 2 | 1.2 | PDRF 0 + RGB | ✓ | ✓ | — | — |
| 3 | 1.2 | PDRF 1 + RGB | ✓ | ✓ | — | — |
| 4 | 1.3 | PDRF 1 + waveform | ✓ | — | — | ✓ |
| 5 | 1.3 | PDRF 3 + waveform | ✓ | ✓ | — | ✓ |
| 6 | 1.4 | Extended core | ✓ | — | — | — |
| 7 | 1.4 | PDRF 6 + RGB | ✓ | ✓ | — | — |
| 8 | 1.4 | PDRF 7 + near-IR | ✓ | ✓ | ✓ | — |
| 9 | 1.4 | PDRF 6 + waveform | ✓ | — | — | ✓ |
| 10 | 1.4 | PDRF 7 + waveform | ✓ | ✓ | — | ✓ |

PDRF 6–10 use layered compression — attributes are stored in separate layers, enabling selective decode.

---

## LAZ compression

LAZ adds a Variable Length Record (VLR) immediately after the LAS header that describes the compression scheme. The point data is replaced with compressed chunks.

### LAZ VLR: chunk size field

The LAZ VLR contains a `chunkSize` field with two meaningful values:
- `chunkSize > 0`: fixed-size chunks (default for PDAL, PDAL writes 50,000 points/chunk)
- `chunkSize === 0`: variable-size / adaptive chunks (used by COPC)

This distinction is critical for seed point reading — see Discovery 2 below.

### Chunk table: what the spec says vs. what files contain

**What the public documentation implies:** The chunk table contains raw uint64 entries, one per chunk, each being the compressed byte size of that chunk.

**What PDAL-written files actually contain:** The chunk table is encoded using an `IntegerCompressor(32, 2, bits_high=8)` on top of an `ArithmeticDecoder`. The 8-byte uncompressed header (version=0 + count=N) is followed by an arithmetically coded bitstream of N uint32 delta values.

This was discovered empirically during Phase 1. See [[Arithmetic Decoder]] for the codec implementation.

**Chunk table layout:**

```
[8 bytes uncompressed]
  uint32 version  = 0
  uint32 count    = N (number of chunks)

[variable bytes — ArithmeticDecoder + IntegerDecompressor output]
  N × uint32 delta values (each delta = compressed byte size of chunk i)
```

**Decoding algorithm (from LASzip `lasreadpoint.cpp` `read_chunk_table()`):**

```cpp
dec->init(instream);
IntegerCompressor ic(dec, 32, 2);  // 32 bits, 2 contexts, bits_high=8 (default)
ic.initDecompressor();
for (i = 1; i <= number_chunks; i++) {
    chunk_starts[i] = ic.decompress((i>1 ? (U32)(chunk_starts[i-1]) : 0), 1);
}
dec->done();
for (i = 1; i <= number_chunks; i++) {
    chunk_starts[i] += chunk_starts[i-1];  // accumulate deltas
}
// chunk_starts[0] = pointDataOffset + 8 (the 8-byte header itself)
```

**Verified against:** USGS 3DEP Central Texas, 380 chunks, 797 compressed bytes → 380 uint32 delta values.

The hand-port of the LASzip arithmetic decoder + integer compressor + model code took four rounds of debugging against Melbourne 2018 (7073 entries) to align with the canonical C++ semantics. See [[Chunk-Table Decoder Saga]] for the full diagnostic narrative. As of 2026-05-16 the port is production-correct: 7073 entries decode in ~3 ms with all values matching what the `laszip` CLI produces.

### Discovery 2: 4-byte point count prefix — fixed vs. variable chunks

**What many sources suggest:** LAZ 1.4 PDRF 6–10 chunks begin with a 4-byte point count prefix before the first raw point.

**Actual behaviour (verified against PDAL-written files):**

- `chunkSize > 0` (fixed chunks, default): **no prefix** — seed point starts at `chunkOffset + 0`
- `chunkSize === 0` (variable chunks, COPC): **4-byte prefix** — seed point starts at `chunkOffset + 4`

```typescript
const seedByteOffset = (lazVlr.chunkSize === 0) ? 4 : 0
```

Using `isPdrf6Plus ? 4 : 0` (the wrong logic) produces swapped Y/Z seed coordinates because the raw Z integer is read as the X field.

**Byte-level verification** — USGS Central Texas file, first chunk bytes `2b 6f 21 04 1e 8f ca 13 e0 21 00 00`:

| Offset | Raw int32 | Scaled value | Field |
|--------|-----------|--------------|-------|
| 0 | `0x04216f2b` = 69300011 | 693000.11 m | X (Easting ✓) |
| 4 | `0x13ca8f1e` = 332042014 | 3320420.14 m | Y (Northing ✓) |
| 8 | `0x000021e0` = 8672 | 86.72 m | Z (elevation ✓) |

---

## Layered decode (PDRF 6–10)

LAZ 1.4 compresses each attribute layer independently:
- Layer 0: XYZ coordinates
- Layer 1: return information, classification
- Layer 2: intensity
- Layer 3: GPS time
- Layer 4+: RGB, near-IR, waveform

laz-perf exposes per-layer byte offsets so only the needed layers are decompressed. For a depth-only view, only layer 0 is required.

---

## LAZ 1.2/1.3 chunk tables

Chunk tables may be present or absent. When absent, [[Manifest Loader]] falls back to sequential scan mode. Chunk size in this case is typically 50,000 points.

The `seedByteOffset = 0` rule for fixed-size chunks also applies to LAZ 1.2/1.3 (they predate variable chunks entirely), but this has not been tested against a real LAZ 1.2/1.3 file.

---

## See also

- [[Manifest Loader]] — parses the header and chunk table
- [[Arithmetic Decoder]] — implements the chunk table codec
- [[Decoder Workers]] — uses laz-perf to decompress point data
- [[LidarScout Chunk-Seed]] — uses first-point sampling across chunks
