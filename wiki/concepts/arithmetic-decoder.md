---
title: Arithmetic Decoder
type: concept
status: active
updated: 2026-05-16
tags: [arithmetic-coding, integer-decompressor, chunk-table, decode, laz]
---

# Arithmetic Decoder

The arithmetic decoder and integer decompressor are used exclusively to decode the LAZ chunk table. They are not used to decode point data (that is handled by laz-perf WASM). The implementation lives in `src/decode/`.

**Production-correct as of 2026-05-16.** See [[Chunk-Table Decoder Saga]] for the four-bug debugging history. The port now matches canonical LASzip C++ line-for-line and has been validated end-to-end against Melbourne 2018 (7073 entries, 2.93 GB).

---

## Why this exists

The LAZ chunk table is not raw uint64 data — it is arithmetically coded. No existing JavaScript browser viewer implements this independently (they all call laz-perf's full-file `LASZip.open()` which decodes the chunk table internally, or require COPC which restructures the index). lazstream decodes the chunk table directly to enable range-request-based streaming without full-file WASM processing.

---

## Files

| File | Exports | Responsibility |
|------|---------|---------------|
| `src/decode/arithmetic-decoder.ts` | `ArithmeticDecoder`, `ArithmeticBitModel`, `ArithmeticModel` | Core range coder |
| `src/decode/integer-decompressor.ts` | `IntegerDecompressor` | Delta-coded integer decompression on top of `ArithmeticDecoder` |

Both files have zero dependencies on HTTP, Three.js, or LAS-specific types. They operate purely on `Uint8Array` input and return numbers — fully testable in isolation.

---

## ArithmeticDecoder

Range coder with the following constants (ported from LASzip `arithmeticdecoder.hpp`):

| Constant | Value | Purpose |
|----------|-------|---------|
| `AC_MAX_LENGTH` | `0xFFFFFFFF` | Upper bound of coding interval |
| `AC_MIN_LENGTH` | `0x01000000` | Renormalisation threshold |
| `BM_LENGTH_SHIFT` | `13` | Bit model probability shift |
| `BM_MAX_COUNT` | `8191` | Bit model max counter (2^13 − 1) |
| `DM_LENGTH_SHIFT` | `15` | Data model probability shift |
| `DM_MAX_COUNT` | `16383` | Data model max counter (2^15 − 1) |

### ArithmeticBitModel

Used for single-bit symbols. Tracks a running probability estimate updated after each decoded bit.

### ArithmeticModel

Used for multi-symbol alphabets (for IntegerDecompressor correction values). Initialised with a symbol count, updates symbol frequencies after each decode.

Key fields:
- `lastSymbol = symbols - 1` — cached for `decodeSymbol` hot path; used to preserve `y = pre-shift length` for the top symbol
- `decoderTable: Uint32Array | null` — present when `symbols > 16`; length `tableSize + 2` (trailing fill writes through `decoderTable[tableSize + 1]` inclusive)
- `tableSize = 1 << tableBits`, `tableShift = DM_LENGTH_SHIFT - tableBits`

**Table allocation policy** (canonical C++ `arithmeticmodel.cpp`):

```typescript
// For symbols > 16:
let tableBits = 3
while (symbols > (1 << (tableBits + 2))) tableBits++
tableSize  = 1 << tableBits
tableShift = DM_LENGTH_SHIFT - tableBits
```

For 256 symbols: `tableBits = 6`, `tableSize = 64`, `tableShift = 9`.

**Table fill** (canonical pre-increment semantics):

```typescript
for (let k = 0; k < symbols; k++) {
  distribution[k] = ...
  const w = distribution[k] >>> tableShift
  while (s < w) { s++; decoderTable[s] = k - 1 }   // pre-increment
}
decoderTable[0] = 0                                  // explicit slot 0
while (s <= tableSize) { s++; decoderTable[s] = symbols - 1 }
```

### `decodeSymbol`

Two-entry table lookup + bisection, with `lastSymbol` guard on `y`:

```typescript
sym = decoderTable[t]
n   = decoderTable[t + 1] + 1
while (n > sym + 1) {
  const k = (sym + n) >>> 1
  if (distribution[k] > dv) n = k; else sym = k
}
x = distribution[sym] * length
if (sym !== lastSymbol) y = distribution[sym + 1] * length
```

When `sym === lastSymbol`, `y` retains its pre-shift value (`this.length` before the `>>> DM_LENGTH_SHIFT` shift). This is the canonical behaviour — the top symbol uses the full remaining interval.

### `renormalize`

Defensive `length === 0` throw prevents infinite hang if decoder state is corrupt:

```typescript
if (this.length === 0) throw new Error('renormalize called with length=0 — decoder state corrupt')
```

---

## IntegerDecompressor

Wraps `ArithmeticDecoder` to decompress delta-coded 32-bit integers. Used for chunk table entries.

Constructor signature: `IntegerDecompressor(decoder, bits, contexts, bits_high?)`

- `bits`: 32 (chunk sizes are 32-bit)
- `contexts`: 2 (the compressor uses context 1 for all chunk table entries after the first)
- `bits_high`: **8** — this default is in the constructor signature, not the spec. Using `bits_high = 0` produces incorrect output.

### readCorrector — canonical k=0 path

When `k == 0` (the corrector is 0 or 1), the decoder MUST call `decodeBit` to consume the bit from the stream:

```typescript
if (k !== 0) {
  // ... normal k >= 1 path
} else {
  c = this.dec.decodeBit(this.mCorrector0)  // MUST consume the bit
}
```

The previous version returned `0` immediately on `k == 0` without consuming the bit, causing one missed bit to shift the entire arithmetic coder out of phase. See [[Chunk-Table Decoder Saga]] Round 4.

---

## Chunk table decode procedure

```typescript
const dec = new ArithmeticDecoder(compressedBytes)
dec.init()

const ic = new IntegerDecompressor(dec, 32, 2)
ic.initDecompressor()

const deltas = new Uint32Array(count)
for (let i = 0; i < count; i++) {
  deltas[i] = (ic.decompress(i > 0 ? deltas[i - 1] : 0, 1)) >>> 0
}

// Accumulate deltas → absolute byte offsets
let acc = 0
for (let i = 0; i < count; i++) {
  acc = (acc + deltas[i]) >>> 0   // Uint32 wrap required for files > 2^31 bytes
  chunkByteOffsets[i] = acc
}
// chunkByteOffsets[i] is the compressed byte size of chunk i
// chunk_starts[0] = pointDataOffset + 8 (the chunk table header)
```

Note: `deltas` must be `Uint32Array` and accumulation must use `>>> 0`. Using `Int32Array` silently corrupts offsets for files larger than ~2.15 GB where the cumulative sum crosses `2^31`. See [[Chunk-Table Decoder Saga]] Round 3.

---

## Performance

| File | Chunks | Compressed bytes | Decode time |
|------|--------|-----------------|-------------|
| USGS Central Texas | 380 | 797 | < 1 ms |
| Melbourne 2018 | 7073 | 8883 | ~3 ms |

---

## See also

- [[Chunk-Table Decoder Saga]] — four-round debugging narrative; canonical alignment history
- [[LAZ Format]] — chunk table structure and the discoveries that require this decoder
- [[Manifest Loader]] — invokes the decoder as part of header parsing
