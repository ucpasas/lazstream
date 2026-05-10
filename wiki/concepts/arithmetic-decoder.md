---
title: Arithmetic Decoder
type: concept
status: active
updated: 2026-05-10
tags: [arithmetic-coding, integer-decompressor, chunk-table, decode, laz]
---

# Arithmetic Decoder

The arithmetic decoder and integer decompressor are used exclusively to decode the LAZ chunk table. They are not used to decode point data (that is handled by laz-perf WASM). The implementation lives in `src/decode/`.

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

---

## IntegerDecompressor

Wraps `ArithmeticDecoder` to decompress delta-coded 32-bit integers. Used for chunk table entries.

Constructor signature: `IntegerDecompressor(decoder, bits, contexts, bits_high?)`

- `bits`: 32 (chunk sizes are 32-bit)
- `contexts`: 2 (the compressor uses context 1 for all chunk table entries after the first)
- `bits_high`: **8** — this default is in the constructor signature, not the spec. Using `bits_high = 0` produces incorrect output.

### Decompress call for chunk table

```typescript
// context=1 for all entries (matches LASzip read_chunk_table())
// previousValue = previous raw delta (0 for first entry)
const delta = ic.decompress(previousValue, 1)
```

---

## Chunk table decode procedure

```typescript
const view = new DataView(buffer)            // the raw chunk table bytes
const version = view.getUint32(0, true)      // must be 0
const count   = view.getUint32(4, true)      // number of chunks

const dec = new ArithmeticDecoder(buffer, 8) // skip 8-byte header
dec.init()

const ic = new IntegerDecompressor(dec, 32, 2)
ic.initDecompressor()

const deltas: number[] = []
for (let i = 0; i < count; i++) {
    deltas[i] = ic.decompress(i > 0 ? deltas[i - 1] : 0, 1)
}
dec.done()

// Accumulate deltas → absolute byte sizes
const sizes: number[] = []
let acc = 0
for (const d of deltas) {
    acc += d
    sizes.push(acc)
}

// chunk_starts[0] = pointDataOffset + 8 (the chunk table header)
```

---

## Performance

Decoding 380 chunk table entries from 797 compressed bytes: **< 1 ms** (JavaScript, no WASM needed).

---

## See also

- [[LAZ Format]] — chunk table structure and the two discoveries that require this decoder
- [[Manifest Loader]] — invokes the decoder as part of header parsing
