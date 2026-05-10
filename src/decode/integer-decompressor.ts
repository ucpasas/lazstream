/**
 * Integer Decompressor for LAZ Chunk Table
 *
 * Direct port from LASzip/src/integercompressor.cpp
 *
 * For the chunk table, it's instantiated as IntegerCompressor(dec, 32, 2)
 * with default bits_high=8. This means:
 *
 *   - mBits: ArithmeticModel[2] — one per context, 33 symbols each (0..32)
 *     Decodes "how many bits does the corrector use?"
 *
 *   - mCorrector0: ArithmeticBitModel — shared across contexts
 *     Decodes 1-bit correctors (+1 or -1)
 *
 *   - mCorrector[1..32]: ArithmeticModel — shared across contexts
 *     For k <= bits_high (8): model has 2^k symbols
 *     For k > bits_high: model has 2^bits_high (256) symbols
 *     When k > bits_high, the remaining (k - bits_high) bits are read raw
 *
 *   - Signed conversion after decoding:
 *     if (c >= 2^(k-1)): c = c + 1        (positive corrector)
 *     else:              c = c - (2^k - 1) (negative corrector)
 *
 * Context is used only for mBits selection. Corrector models are shared.
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
  private mCorrector0: ArithmeticBitModel
  private mCorrector: (ArithmeticModel | null)[]

  constructor(dec: ArithmeticDecoder, bits = 16, contexts = 1, bitsHigh = 8) {
    this.dec = dec
    this.bits = bits
    this.contexts = contexts
    this.bitsHigh = bitsHigh

    // Determine corrBits and corrRange based on bits
    if (bits > 0 && bits < 32) {
      this.corrBits = bits
      this.corrRange = 1 << bits
      this.corrMin = -(this.corrRange >>> 1)
    } else {
      // bits >= 32: no wrapping
      this.corrBits = 32
      this.corrRange = 0
      this.corrMin = -2147483648 // I32_MIN
    }

    // Per-context mBits models
    this.mBits = new Array(contexts)
    for (let i = 0; i < contexts; i++) {
      this.mBits[i] = new ArithmeticModel(this.corrBits + 1)
    }

    // Shared corrector models
    this.mCorrector0 = new ArithmeticBitModel()
    this.mCorrector = new Array(this.corrBits + 1).fill(null)

    for (let k = 1; k <= this.corrBits; k++) {
      if (k <= bitsHigh) {
        // Small k: model with 2^k symbols
        this.mCorrector[k] = new ArithmeticModel(1 << k)
      } else {
        // Large k: model with 2^bitsHigh symbols (high bits only)
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
   * @param pred - Prediction (typically the previous decompressed value)
   * @param context - Context index (0 or 1 for chunk tables)
   * @returns The decompressed integer
   */
  decompress(pred: number, context: number): number {
    const corr = this.readCorrector(this.mBits[context])
    let real = (pred + corr) | 0

    // Wrapping for bits < 32
    if (this.corrRange > 0) {
      if (real < 0) real += this.corrRange
      else if ((real >>> 0) >= (this.corrRange >>> 0)) real -= this.corrRange
    }

    return real
  }

  private readCorrector(mBitsModel: ArithmeticModel): number {
    // Step 1: Decode how many bits the corrector uses (0 = corrector is 0)
    const k = this.dec.decodeSymbol(mBitsModel)

    if (k === 0) return 0

    let c: number

    if (k < 32) {
      if (k === 1) {
        // 1-bit corrector: use dedicated bit model
        c = this.dec.decodeBit(this.mCorrector0)
        return c === 0 ? -1 : 1
      }

      if (k <= this.bitsHigh) {
        // Small k: decode all bits from the corrector model
        c = this.dec.decodeSymbol(this.mCorrector[k]!)
      } else {
        // Large k: decode high bits from model, low bits raw
        const k1 = k - this.bitsHigh
        const cHigh = this.dec.decodeSymbol(this.mCorrector[k]!)
        const cLow = this.dec.readBits(k1)
        c = (cHigh << k1) | cLow
      }

      // Convert unsigned symbol to signed corrector
      const half = 1 << (k - 1)
      if (c >= half) {
        // Positive corrector: [half .. 2^k-1] maps to [+1 .. +half]
        c = c + 1
      } else {
        // Negative corrector: [0 .. half-1] maps to [-(2^k-1) .. -half]
        c = c - ((1 << k) - 1)
      }
    } else {
      // k === 32: minimum corrector value
      c = this.corrMin
    }

    return c
  }
}