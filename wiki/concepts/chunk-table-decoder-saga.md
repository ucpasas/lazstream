---
title: Chunk-Table Decoder Saga
type: concept
status: active
updated: 2026-05-16
tags: [arithmetic-decoder, integer-decompressor, debugging, canonical-port, laszip, melbourne]
---

# Chunk-Table Decoder Saga

A documentary account of four bugs in the lazstream chunk-table decoder, found during Phase 3 validation against Melbourne 2018 (7073 chunks, 2.93 GB). Each round of fixes made the decoder run further before failing; each fix was found by reading the canonical LASzip C++ source directly.

---

## Why this page exists

The chunk-table decoder is a hand-port of LASzip's `ArithmeticDecoder` + `ArithmeticModel` + `IntegerCompressor` from `arithmeticdecoder.cpp`, `arithmeticmodel.cpp`, and `integercompressor.cpp`. Phase 1 chose to port this rather than depend on laz-perf for chunk-table decode, to keep the manifest stage pure-TypeScript and minimise initial WASM load.

The port worked for Texas (380 entries) from day one and was assumed production-ready. Phase 3 validation against Melbourne 2018 (7073 entries, 2.93 GB) exposed four distinct bugs over four debugging rounds. This page documents the bugs, the C++ source comparisons that found them, and the fixes — all in one place because the bugs are interconnected and only make sense as a sequence.

See [[Arithmetic Decoder]] for the implementation reference, and [[LAZ Format]] for the chunk table structure.

---

## Why Texas worked and Melbourne didn't

| Metric | Texas | Melbourne |
|--------|-------|-----------|
| Chunks | 380 | 7073 |
| Compressed bytes | 797 | 8883 |
| File size | ~61 MB | ~2.93 GB |
| Cumulative offsets > 2^31? | No | Yes (from chunk ~287) |

The bugs cluster around (a) edge cases in the decoder state machine that Texas's short stream didn't exercise enough times to manifest, and (b) U32/I32 semantic gaps that only matter for files larger than 2.15 GB.

---

## Round 0 — Infinite loop in renormalize

**Symptom:** Loading Melbourne → "Page Unresponsive" within seconds. Chunk-table header parsed, then silence. Pause-execution in Chrome DevTools showed the call stack inside `renormalize()` with `length === 0` and `value === 0`, looping forever (`0 << 8 === 0`).

**Fix:** Added a defensive throw for `length === 0` at the top of `renormalize`:

```typescript
if (this.length === 0) {
  throw new Error('ArithmeticDecoder: renormalize called with length=0 — decoder state corrupt')
}
```

This turned the infinite hang into a catchable error. The real bug causing `length` to reach zero was in `decodeSymbol`, exposed in Round 1.

---

## Round 1 — decodeSymbol: linear scan and unconditional y overwrite

**Symptom after Round 0 fix:** Decoder ran ~370 entries before throwing. Pause-execution showed the throw coming from inside `decodeSymbol` of the 256-symbol corrector model `mCorrector[k]` (the `k > bitsHigh` path).

**Bug:** The original port used a linear scan with no upper bound (`while (model.distribution[sym] <= dv) sym++`) which could read past `distribution[symbols]` into `undefined`. It also unconditionally overwrote `y = distribution[sym+1] * length` for the top symbol — but the top symbol has no `distribution[sym+1]` (it uses the pre-shift length as the interval upper bound).

**Canonical C++ pattern** (`arithmeticdecoder.cpp`):

```cpp
sym = m->decoder_table[t];
n = m->decoder_table[t+1] + 1;
while (n > sym + 1) {
  U32 k = (sym + n) >> 1;
  if (m->distribution[k] > dv) n = k; else sym = k;
}
x = m->distribution[sym] * length;
if (sym != m->last_symbol) y = m->distribution[sym+1] * length;
```

**Fix:** Two-entry table lookup as bisection bounds; bisection loop between `sym` and `n`; preserve `y = pre-shift length` when `sym === lastSymbol`.

---

## Round 2 — ArithmeticModel: wrong table sizing and post-increment fill

**Symptom after Round 1 fix:** Decoder still failed around entry ~370 (same spot). Audit of `arithmeticmodel.cpp` revealed two more divergences.

### Bug 2a — Wrong tableShift formula

The original port used:

```typescript
this.tableShift = Math.ceil(Math.log2(symbols)) - 4  // WRONG
```

No basis in the C++ source. The canonical algorithm:

```cpp
table_bits = 3;
while (symbols > (1 << (table_bits + 2))) table_bits++;
table_size  = 1 << table_bits;
table_shift = DM_LENGTH_SHIFT - table_bits;
```

For 256 symbols: `table_bits = 6`, `tableSize = 64`, `tableShift = 9`. The original port produced `tableSize = 2048`, `tableShift = 4` — wildly wrong.

### Bug 2b — Post-increment table fill

The original port used:

```typescript
while (s < w) decoderTable[s++] = k - 1  // post-increment: writes at s, then increments
```

Canonical C++ uses **pre-increment** (`++s`) — writes at `s+1`:

```cpp
while (s < w) decoder_table[++s] = k - 1;
// After main loop:
decoder_table[0] = 0;
// Trailing fill:
while (s <= table_size) decoder_table[++s] = symbols - 1;
```

Combined effect: every entry in the decoder table was off by one slot. Slot 0 was never explicitly set to 0. The trailing fill boundary was wrong.

**Fix:** Canonical pre-increment fill, explicit `decoderTable[0] = 0`, trailing fill with `s <= tableSize` condition (writes through `decoderTable[tableSize + 1]` inclusive).

After Rounds 1 + 2: decoder ran all 7073 entries to completion and reported `arithmetic decode: 7073 entries in 2.5ms`. But the *values* were wrong.

---

## Round 3 — Uint32 accumulation for offsets > 2^31

**Symptom:** Decoder ran clean to completion. Diagnostic logging showed deltas were stable (~416000 bytes/chunk) for chunks 1-294, then chunk 295 suddenly produced `4268074065` (= `0xfe65a451`, = `-26893231` as I32). Cumulative offset then exceeded the file size.

**Root cause:** `deltas` was typed as `Int32Array`. The decoder was producing a normal small-signed corrector, but when accumulated as I32 the running sum crossed `2^31` and wrapped to a large negative, which in JS number arithmetic corrupted the offset chain.

`0xfe65a451` is correctly `-26893231` as I32, or `4268074065` as U32. The chunk table stores U32 deltas; I32 semantics break for cumulative offsets > 2.15 GB.

**Fix:** Switched `deltas` from `Int32Array` to `Uint32Array` and used `(a + b) >>> 0` for accumulation (U32 wrap semantics, matching C++ `U32` addition).

After Round 3: same deltas now stored unsigned. But the cumulative offsets STILL exceeded the file size. The decoder was producing wrong values, not just accumulating them wrong — which led to Round 4.

---

## Round 4 — readCorrector k=0 bit consumption

**Symptom after Round 3:** Deltas were stable and small for chunks 1-294, then chunk 295 produced `0xfe65a451`. The corruption wasn't progressive drift — something specific broke at exactly one point.

**Bug:** Audit of `integercompressor.cpp` `readCorrector`:

```cpp
k = dec->decodeSymbol(mBits);
if (k) {
  // ... k >= 1 path
} else {  // k == 0
  c = dec->decodeBit((ArithmeticBitModel*)mCorrector[0]);
}
return c;
```

When `k == 0`, the canonical decoder reads ONE BIT from the bit model `mCorrector[0]` — yielding a corrector of 0 or 1.

**Original port:**

```typescript
if (k === 0) return 0   // WRONG: returns 0 without consuming the bit
```

Whenever the encoder wrote a small corrector (k=0 case), the decoder read the k=0 symbol but **did not consume the follow-up bit from the stream**. That bit was then swallowed by the next decode call, shifting the entire arithmetic coder one bit out of phase.

The port also had `decodeBit(mCorrector0)` placed at `k === 1`, where canonical uses the regular `mCorrector[1]` (a 2-symbol arithmetic model). Both pieces of the k=0/k=1 readCorrector logic were misplaced.

**Why Texas survived:** The k=0 case may not have fired within Texas's 380 entries, or fired late enough that the misaligned decode still produced values in the plausible range. For Melbourne, the first k=0 corrector fired at chunk ~294, and chunk 295 was where misalignment first manifested as a wildly wrong delta.

**Fix:**

```typescript
if (k !== 0) {
  // ... normal path
} else {
  // k == 0: MUST call decodeBit to consume the bit from the stream.
  c = this.dec.decodeBit(this.mCorrector0)
}
```

After Round 4: Melbourne decoded fully. All 7073 deltas in normal chunk-size range (~416000 bytes), all seeds in bounds, `gapToTable` near zero. End-to-end validated.

---

## Summary of all four fixes

| Round | File | Bug | Texas? |
|-------|------|-----|--------|
| 1 | `arithmetic-decoder.ts` | `decodeSymbol`: linear scan past `distribution[symbols]` + unconditional `y` overwrite for top symbol | Survived by chance |
| 2 | `arithmetic-decoder.ts` | `ArithmeticModel`: wrong `tableShift` formula (`ceil(log2) - 4`) + post-increment fill (off-by-one slot) | Survived by chance |
| 3 | `chunk-table.ts` | `deltas` typed as `Int32Array` instead of `Uint32Array`; accumulation without `>>> 0` | N/A (Texas < 2^31) |
| 4 | `integer-decompressor.ts` | `readCorrector` k=0 returned 0 without consuming bit; k=1 used wrong model | Coincidentally survived |

All four fixes preserve the C++ algorithm exactly. None are JavaScript-specific hacks. The port now matches canonical line-for-line in `decodeSymbol`, `ArithmeticModel.update()`, `readCorrector`, and `IntegerCompressor.decompress`.

---

## Why this matters

After all four fixes, lazstream has a working pure-TypeScript port of:
- LASzip `ArithmeticDecoder` (range coder + bit model + symbol model)
- LASzip `ArithmeticModel` (adaptive distribution + decoder table)
- LASzip `IntegerCompressor` (k-bit corrector decode for arithmetic-coded deltas)

Every other browser-based LAZ tool delegates chunk-table decode to laz-perf WASM, consuming the entire file via `LASZip.open()`. lazstream implements chunk-table decode independently — enabling the streaming architecture (HTTP-range-fetched manifest stage, no whole-file WASM upfront).

**Validated end-to-end on:**
- USGS 3DEP Central Texas: 380 chunks, 19M points, 61 MB — chunk table decodes in < 1 ms
- Melbourne 2018: 7073 chunks, 353M points, 2.93 GB — chunk table decodes in ~3 ms

---

## References

LASzip source (`https://github.com/LASzip/LASzip/tree/master/src`):
- `arithmeticdecoder.cpp` — range coder and `decode_symbol`
- `arithmeticmodel.cpp` — `ArithmeticModel` state and update
- `integercompressor.cpp` — corrector decode and chunk-table integer encoding
- `lasreadpoint.cpp` `read_chunk_table()` — the algorithm we're matching

---

## See also

- [[Arithmetic Decoder]] — implementation reference
- [[LAZ Format]] — chunk table layout and Discovery 1
- [[Manifest Loader]] — caller of the decoder
- [[Phase 1 — Core Streaming and Seed Overview]] — original Discovery 1
