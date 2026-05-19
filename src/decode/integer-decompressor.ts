/**
 * Integer Decompressor for LAZ Chunk Table
 *
 * Direct port from LASzip/src/integercompressor.cpp
 *
 * For the chunk table, it's instantiated as IntegerCompressor(dec, 32, 2)
 * with default bits_high=8. This means:
 *
 *   - mBits: ArithmeticModel[2] — one per context, (corr_bits + 1) = 33
 *     symbols each. Decodes "how many bits does the corrector use?" (k).
 *
 *   - mCorrector[0]: ArithmeticBitModel — used when k == 0 (corrector is
 *     0 or 1). Shared across contexts.
 *
 *   - mCorrector[1..corr_bits]: ArithmeticModel — used when k >= 1.
 *     For k <= bits_high (8): model has 2^k symbols
 *     For k > bits_high: model has 2^bits_high (256) symbols
 *     When k > bits_high, the remaining (k - bits_high) bits are read raw
 *     and combined with the model-decoded high bits.
 *
 *   - Signed conversion after decoding:
 *     if (c >= 2^(k-1)): c = c + 1        (positive corrector)
 *     else:              c = c - (2^k - 1) (negative corrector)
 *
 *   - For k == corr_bits (32, in our chunk-table case): c = corr_min directly
 *     (the singular "this is the minimum I32" code).
 *
 * Context is used only for mBits selection (which k was used). The corrector
 * models (mCorrector[*]) are shared across all contexts.
 *
 * MELBOURNE FIX (Phase 3, third pass): readCorrector was wrong on k == 0.
 *
 * The canonical C++ behaviour: when k == 0, the corrector is 0 or 1, and
 * decoded via a single bit from the BIT model mCorrector[0]:
 *
 *     if (k) { ... } else { c = dec->decodeBit(mCorrector[0]); }
 *
 * Our port had this completely wrong. It:
 *   (a) returned 0 immediately when k == 0, WITHOUT consuming the bit
 *       from the coder stream
 *   (b) put the decodeBit call at k == 1 instead, where canonical uses
 *       mCorrector[1] (a 2-symbol arithmetic model, not a bit model)
 *
 * Consequence: every encoded "0 or 1" corrector left an undecoded bit in
 * the stream. That bit got swallowed by the next symbol decode, shifting
 * the decoder one bit out of phase. Plus the k == 1 path used the wrong
 * model entirely.
 *
 * For Texas (380 entries) the misalignment may not have triggered, or
 * triggered late enough not to affect rendered chunks. For Melbourne
 * (7073 entries) the bug fires at chunk ~295 producing a massive
 * negative corrector that wraps to a huge U32 delta — explaining why
 * delta[295] suddenly became 4268074065 (= -26893231 as I32) instead of
 * the ~417000 byte values seen for chunks 1-294.
 */

import {
  ArithmeticDecoder,
  ArithmeticBitModel,
  ArithmeticModel,
} from './arithmetic-decoder.js'

export class IntegerDecompressor {
  private bits: number
  private contexts: number
  private bitsHigh: number
  private corrBits: number
  private corrRange: number
  private corrMin: number

  private dec: ArithmeticDecoder

  // Per-context: which bit length the corrector uses
  private mBits: ArithmeticModel[]

  // Shared across contexts: corrector decoding
  //   mCorrector0: BitModel for k == 0 (corrector is 0 or 1)
  //   mCorrector[1..corrBits]: SymbolModels for k >= 1
  private mCorrector0: ArithmeticBitModel
  private mCorrector: (ArithmeticModel | null)[]

  constructor(dec: ArithmeticDecoder, bits = 16, contexts = 1, bitsHigh = 8) {
    this.dec = dec
    this.bits = bits
    this.contexts = contexts
    this.bitsHigh = bitsHigh

    // Determine corrBits and corrRange based on bits.
    // For bits == 32 (chunk-table case): corrBits = 32, corrRange = 0 (no wrap).
    if (bits > 0 && bits < 32) {
      this.corrBits = bits
      this.corrRange = 1 << bits
      this.corrMin = -(this.corrRange >>> 1)
    } else {
      this.corrBits = 32
      this.corrRange = 0
      this.corrMin = -2147483648 // I32_MIN
    }

    // Per-context mBits models: each (corrBits + 1) symbols.
    // For chunk-table: 33 symbols, k can be 0..32.
    this.mBits = new Array(contexts)
    for (let i = 0; i < contexts; i++) {
      this.mBits[i] = new ArithmeticModel(this.corrBits + 1)
    }

    // Shared corrector models.
    this.mCorrector0 = new ArithmeticBitModel()
    this.mCorrector = new Array(this.corrBits + 1).fill(null)

    for (let k = 1; k <= this.corrBits; k++) {
      if (k <= bitsHigh) {
        // Small k: model with 2^k symbols (full range of corrector for this k).
        this.mCorrector[k] = new ArithmeticModel(1 << k)
      } else {
        // Large k: model with 2^bitsHigh symbols (high bits only, low bits raw).
        this.mCorrector[k] = new ArithmeticModel(1 << bitsHigh)
      }
    }
  }

  initDecompressor(): void {
    for (let i = 0; i < this.contexts; i++) {
      this.mBits[i].init()
    }
    this.mCorrector0.init()
    for (let k = 1; k <= this.corrBits; k++) {
      this.mCorrector[k]!.init()
    }
  }

  /**
   * Decompress one integer value.
   *
   * Mirrors C++ IntegerCompressor::decompress exactly:
   *   I32 real = pred + readCorrector(mBits[context]);
   *   if (real < 0) real += corr_range;
   *   else if ((U32)(real) >= corr_range) real -= corr_range;
   *   return real;
   *
   * For corrRange == 0 (chunk-table case, bits == 32) both wrap branches
   * are no-ops and the function effectively returns I32 pred + corr.
   *
   * @param pred - Prediction (typically the previous decompressed value)
   * @param context - Context index (0 or 1 for chunk tables)
   * @returns The decompressed integer (caller can interpret as I32 or U32)
   */
  decompress(pred: number, context: number): number {
    const corr = this.readCorrector(this.mBits[context])
    let real = (pred + corr) | 0   // I32 wrap addition

    // Wrapping for bits < 32 (corrRange > 0). No-op for bits == 32.
    if (this.corrRange > 0) {
      if (real < 0) real += this.corrRange
      else if ((real >>> 0) >= (this.corrRange >>> 0)) real -= this.corrRange
    }

    return real
  }

  /**
   * Decode a corrector value.
   *
   * Mirrors C++ IntegerCompressor::readCorrector exactly. The structure is:
   *
   *   k = dec->decodeSymbol(mBits);
   *   if (k) {
   *     if (k < 32) {
   *       if (k <= bits_high) {
   *         c = dec->decodeSymbol(mCorrector[k]);
   *       } else {
   *         int k1 = k - bits_high;
   *         c = dec->decodeSymbol(mCorrector[k]);    // high bits via model
   *         int c1 = dec->readBits(k1);              // low bits raw
   *         c = (c << k1) | c1;
   *       }
   *       // Convert unsigned symbol back to signed corrector
   *       if (c >= (1 << (k-1))) c += 1;             // positive: [+1 .. +2^(k-1)]
   *       else                   c -= ((1 << k) - 1); // negative: [-(2^k-1) .. -2^(k-1)]
   *     } else {  // k == 32
   *       c = corr_min;
   *     }
   *   } else {  // k == 0
   *     c = dec->decodeBit(mCorrector[0]);
   *   }
   *   return c;
   *
   * Critical: when k == 0 we MUST call decodeBit to consume the bit from
   * the coder stream — otherwise subsequent symbol decodes are shifted
   * out of phase and decoder state drifts. The previous version of this
   * function returned 0 immediately on k == 0, which was the Melbourne bug.
   */
  private readCorrector(mBitsModel: ArithmeticModel): number {
    // Decode k: how many bits the corrector uses (or 0 for the 0/1 case).
    const k = this.dec.decodeSymbol(mBitsModel)

    let c: number

    if (k !== 0) {
      // Corrector is smaller than 0 or bigger than 1.
      if (k < 32) {
        if (k <= this.bitsHigh) {
          // Small k: full corrector value from the symbol model.
          c = this.dec.decodeSymbol(this.mCorrector[k]!)
        } else {
          // Large k: high bits from symbol model, low bits raw.
          const k1 = k - this.bitsHigh
          c = this.dec.decodeSymbol(this.mCorrector[k]!)
          const c1 = this.dec.readBits(k1)
          c = (c << k1) | c1
        }

        // Translate the unsigned symbol back to a signed corrector.
        const half = 1 << (k - 1)
        if (c >= half) {
          // Positive corrector: [half .. 2^k-1] maps to [+1 .. +half]
          c = c + 1
        } else {
          // Negative corrector: [0 .. half-1] maps to [-(2^k-1) .. -half]
          c = c - ((1 << k) - 1)
        }
      } else {
        // k == 32: the singular minimum-corrector code.
        c = this.corrMin
      }
    } else {
      // k == 0: corrector is 0 or 1, decoded as a single bit from the
      // bit model. The previous version returned 0 here WITHOUT consuming
      // the bit — that was the Melbourne bug.
      c = this.dec.decodeBit(this.mCorrector0)
    }

    return c
  }
}