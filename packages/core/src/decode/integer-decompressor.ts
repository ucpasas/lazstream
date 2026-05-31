/**
 * Integer Decompressor for LAZ Chunk Table
 *
 * Direct port from LASzip/src/integercompressor.cpp. For the chunk table,
 * instantiated as IntegerDecompressor(dec, 32, 2) with default bitsHigh=8.
 *
 * Context selects the per-context mBits model (which k was used for encoding);
 * the corrector models (mCorrector[*]) are shared across all contexts.
 *
 * Critical invariant: when k == 0, readCorrector MUST call
 * decodeBit(mCorrector0) to consume the bit from the coder stream.
 * Skipping the call shifts all subsequent decodes out of phase.
 */

import {
  ArithmeticDecoder,
  ArithmeticBitModel,
  ArithmeticModel,
} from './arithmetic-decoder.js'

export class IntegerDecompressor {
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

  /** Decode one corrector value. Mirrors C++ IntegerCompressor::readCorrector. */
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
      // k == 0: must consume the bit from the stream (see class invariant).
      c = this.dec.decodeBit(this.mCorrector0)
    }

    return c
  }
}