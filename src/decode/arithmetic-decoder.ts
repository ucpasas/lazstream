/**
 * Arithmetic Decoder for LAZ Chunk Table
 *
 * Direct port from LASzip/src/arithmeticdecoder.cpp and arithmeticmodel.cpp
 * (rapidlasso GmbH, Apache 2.0).
 *
 * Only implements the subset needed for chunk table decompression:
 * - ArithmeticDecoder (range coder)
 * - ArithmeticBitModel (adaptive binary model)
 * - ArithmeticModel (adaptive multi-symbol model)
 *
 * All arithmetic uses 32-bit unsigned integers via >>> 0 to stay in uint32
 * range. JavaScript bitwise operators work on int32; >>> 0 converts to
 * uint32. 32×32 → 32 multiplication is via Math.imul (which returns a signed
 * result; we always coerce back via >>> 0).
 *
 * MELBOURNE FIXES (2026-05): three bugs found during 7073-entry Melbourne
 * chunk table decode (Texas's 380 entries masked all three). After each
 * round of fixes the decoder ran further before failing:
 *
 *   round 0 (original):     hangs at i=200, renormalize loops forever
 *   round 1 (decodeSymbol): hangs at i=370, defensive throw triggers
 *   round 2 (model build):  expected to complete; this file
 *
 * The three bugs:
 *
 *   (a) decodeSymbol used a linear scan with no upper bound and unconditionally
 *       overwrote y for the top symbol. Canonical uses two table entries as
 *       bisection bounds and preserves y = pre-shift length when sym ===
 *       lastSymbol. [Fixed round 1.]
 *
 *   (b) ArithmeticModel.tableShift computation was wrong. The original port
 *       used "ceil(log2(symbols)) - 4" which has no basis in the C++ source.
 *       Canonical: start at table_bits=3, increment while symbols > 1 << (table_bits+2),
 *       then table_shift = DM_LENGTH_SHIFT - table_bits. For 256 symbols this
 *       yields table_bits=6, tableSize=64, tableShift=9 — vs the previous
 *       tableSize=2048, tableShift=4. [Fixed this round.]
 *
 *   (c) doUpdate decoder-table fill used post-increment (`decoderTable[s++]`)
 *       writing at slot s, then incrementing. Canonical C++ uses
 *       pre-increment (`decoder_table[++s]`) — writes at slot s+1. The
 *       canonical version explicitly sets decoder_table[0] = 0 after the main
 *       loop, and the trailing fill uses condition `s <= table_size` so it
 *       writes through decoder_table[table_size + 1] inclusive. Every entry
 *       in our decoder table was off by one slot, causing every table lookup
 *       in decodeSymbol to read the wrong symbol. [Fixed this round.]
 *
 * The bugs compounded: (b) produced a wildly wrong-sized table, and (c) wrote
 * its entries at wrong slots within that wrong table. Texas's 380-entry decode
 * sometimes happened to land on table entries where these errors cancelled
 * or stayed in valid ranges. Melbourne's 7073 entries traverse the decoder
 * state space more thoroughly and reliably hit corrupted slots.
 */

// Constants from LASzip
const AC_MIN_LENGTH = 0x01000000  // 2^24 — renormalisation threshold
const BM_LENGTH_SHIFT = 13
const BM_MAX_COUNT = 8191         // 2^13 - 1
const DM_LENGTH_SHIFT = 15
const DM_MAX_COUNT = 16383        // 2^14 - 1

// ─── ArithmeticBitModel ──────────────────────────────────────────────────────

export class ArithmeticBitModel {
  bit0Prob = 0
  bit0Count = 0
  bitCount = 0
  updateCycle = 0
  bitsUntilUpdate = 0

  constructor() {
    this.init()
  }

  init(): void {
    this.bit0Count = 1
    this.bitCount = 2
    this.bit0Prob = 1 << (BM_LENGTH_SHIFT - 1)
    this.updateCycle = this.bitsUntilUpdate = 4
  }

  update(): void {
    this.bitCount += this.updateCycle
    if (this.bitCount > BM_MAX_COUNT) {
      this.bitCount = (this.bitCount + 1) >>> 1
      this.bit0Count = (this.bit0Count + 1) >>> 1
      if (this.bit0Count === this.bitCount) this.bitCount++
    }
    const scale = (0x80000000 / this.bitCount) >>> 0
    this.bit0Prob = (Math.imul(this.bit0Count, scale) >>> (31 - BM_LENGTH_SHIFT)) >>> 0
    this.updateCycle = (5 * this.updateCycle) >>> 2
    if (this.updateCycle > 64) this.updateCycle = 64
    this.bitsUntilUpdate = this.updateCycle
  }
}

// ─── ArithmeticModel ─────────────────────────────────────────────────────────

export class ArithmeticModel {
  symbols: number
  lastSymbol: number               // symbols - 1, cached for decodeSymbol hot path
  distribution: Uint32Array        // length: symbols + 1 (sentinel slot at [symbols])
  symbolCount: Uint32Array         // length: symbols
  decoderTable: Uint32Array | null = null  // length: tableSize + 2 when present
  tableShift = 0
  tableSize = 0                    // 1 << table_bits
  totalCount = 0
  updateCycle = 0
  symbolsUntilUpdate = 0

  constructor(symbols: number) {
    if (symbols < 2 || symbols > (1 << 11)) {
      throw new Error(`ArithmeticModel: invalid symbol count ${symbols}`)
    }
    this.symbols = symbols
    this.lastSymbol = symbols - 1

    // distribution[symbols] is the sentinel = 1 << DM_LENGTH_SHIFT, used as
    // the upper bound for the top symbol in the no-table path's bisection.
    this.distribution = new Uint32Array(symbols + 1)
    this.symbolCount = new Uint32Array(symbols)

    // Table allocation policy from C++ ArithmeticModel::init:
    //   if (symbols > 16):
    //     table_bits = 3
    //     while (symbols > (1 << (table_bits + 2))) ++table_bits
    //     table_size  = 1 << table_bits
    //     table_shift = DM_LengthShift - table_bits
    //
    // For 256 symbols: table_bits = 6, table_size = 64, table_shift = 9.
    // For 16 symbols or fewer: no table at all (pure bisection in decodeSymbol).
    //
    // decoder_table is allocated with table_size + 2 slots — the C++ trailing
    // fill writes through decoder_table[table_size + 1] inclusive.
    if (symbols > 16) {
      let tableBits = 3
      while (symbols > (1 << (tableBits + 2))) tableBits++
      this.tableSize = 1 << tableBits
      this.tableShift = DM_LENGTH_SHIFT - tableBits
      this.decoderTable = new Uint32Array(this.tableSize + 2)
    } else {
      this.decoderTable = null
      this.tableSize = 0
      this.tableShift = 0
    }
  }

  init(table?: Uint32Array): void {
    this.totalCount = 0
    this.updateCycle = this.symbols
    if (table) {
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = table[n]
      }
    } else {
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = 1
      }
    }
    this.update()
    this.symbolsUntilUpdate = this.updateCycle = (this.symbols + 6) >>> 1
  }

  update(): void {
    // Halve counts when threshold is reached.
    this.totalCount += this.updateCycle
    if (this.totalCount > DM_MAX_COUNT) {
      this.totalCount = 0
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = (this.symbolCount[n] + 1) >>> 1
        this.totalCount += this.symbolCount[n]
      }
    }

    // Compute cumulative distribution and decoder table.
    const scale = (0x80000000 / this.totalCount) >>> 0
    let sum = 0
    let s = 0

    if (this.decoderTable) {
      // Build distribution AND decoder table.
      //
      // C++ canonical (pre-increment matters):
      //   for (k = 0; k < symbols; k++) {
      //     distribution[k] = (scale * sum) >> (31 - DM__LengthShift);
      //     sum += symbol_count[k];
      //     U32 w = distribution[k] >> table_shift;
      //     while (s < w) decoder_table[++s] = k - 1;    // pre-inc: writes at s+1
      //   }
      //   decoder_table[0] = 0;                           // explicit slot 0
      //   while (s <= table_size) decoder_table[++s] = symbols - 1;
      //
      // Pre-increment means decoder_table[s] is left unwritten by the inner
      // loop until the next iteration's increment. Slot 0 is always set
      // explicitly to 0 after the main loop. The trailing fill writes through
      // decoder_table[table_size + 1] inclusive (note the `<=`).
      for (let k = 0; k < this.symbols; k++) {
        this.distribution[k] = (Math.imul(scale, sum) >>> (31 - DM_LENGTH_SHIFT)) >>> 0
        sum += this.symbolCount[k]
        const w = this.distribution[k] >>> this.tableShift
        while (s < w) {
          s++
          this.decoderTable[s] = k - 1
        }
      }
      this.decoderTable[0] = 0
      while (s <= this.tableSize) {
        s++
        this.decoderTable[s] = this.symbols - 1
      }
    } else {
      // No table — distribution only.
      for (let k = 0; k < this.symbols; k++) {
        this.distribution[k] = (Math.imul(scale, sum) >>> (31 - DM_LENGTH_SHIFT)) >>> 0
        sum += this.symbolCount[k]
      }
    }

    // distribution[symbols] is the sentinel = 1 << DM_LENGTH_SHIFT — used
    // as the upper bound for the top symbol in the no-table bisection. The
    // table path doesn't read this slot (it bounces off lastSymbol guard).
    this.distribution[this.symbols] = 1 << DM_LENGTH_SHIFT

    // Set frequency of model updates.
    this.updateCycle = (5 * this.updateCycle) >>> 2
    const maxCycle = (this.symbols + 6) << 3
    if (this.updateCycle > maxCycle) this.updateCycle = maxCycle
    this.symbolsUntilUpdate = this.updateCycle
  }
}

// ─── ArithmeticDecoder ───────────────────────────────────────────────────────

export class ArithmeticDecoder {
  private value = 0
  private length = 0
  private data: Uint8Array
  private pos = 0

  constructor(data: Uint8Array) {
    this.data = data
    this.pos = 0
  }

  init(): void {
    this.value = (
      (this.readByte() << 24) |
      (this.readByte() << 16) |
      (this.readByte() << 8) |
      this.readByte()
    ) >>> 0
    this.length = 0xFFFFFFFF
  }

  decodeBit(model: ArithmeticBitModel): number {
    const x = (Math.imul(model.bit0Prob, this.length >>> BM_LENGTH_SHIFT)) >>> 0
    const sym = (this.value >= x) ? 1 : 0

    if (sym === 0) {
      this.length = x
      model.bit0Count++
    } else {
      this.value = (this.value - x) >>> 0
      this.length = (this.length - x) >>> 0
    }

    if (this.length < AC_MIN_LENGTH) this.renormalize()

    model.bitsUntilUpdate--
    if (model.bitsUntilUpdate === 0) model.update()

    return sym
  }

  /**
   * Decode one symbol from an adaptive multi-symbol model.
   *
   * Mirrors C++ ArithmeticDecoder::decode_symbol from LASzip's
   * arithmeticdecoder.cpp.
   */
  decodeSymbol(model: ArithmeticModel): number {
    let n: number
    let sym: number
    let x: number
    let y = this.length    // pre-shift length — preserved for top symbol

    if (model.decoderTable) {
      this.length = (this.length >>> DM_LENGTH_SHIFT) >>> 0
      const dv = (this.value / this.length) >>> 0
      const t = dv >>> model.tableShift

      // Two-entry table lookup: lower bound at t, upper bound at t+1.
      sym = model.decoderTable[t]
      n = model.decoderTable[t + 1] + 1

      // Bisect between sym and n.
      while (n > sym + 1) {
        const k = (sym + n) >>> 1
        if (model.distribution[k] > dv) n = k
        else sym = k
      }

      x = Math.imul(model.distribution[sym], this.length) >>> 0
      // Only overwrite y when not on the top symbol.
      if (sym !== model.lastSymbol) {
        y = Math.imul(model.distribution[sym + 1], this.length) >>> 0
      }
    } else {
      // No-table path — pure bisection.
      x = 0
      sym = 0
      this.length = (this.length >>> DM_LENGTH_SHIFT) >>> 0
      n = model.symbols
      let k = n >>> 1
      do {
        const z = Math.imul(this.length, model.distribution[k]) >>> 0
        if (z > this.value) {
          n = k
          y = z
        } else {
          sym = k
          x = z
        }
      } while ((k = (sym + n) >>> 1) !== sym)
    }

    this.value = (this.value - x) >>> 0
    this.length = (y - x) >>> 0

    if (this.length < AC_MIN_LENGTH) this.renormalize()

    model.symbolCount[sym]++
    model.symbolsUntilUpdate--
    if (model.symbolsUntilUpdate === 0) model.update()

    return sym
  }

  /**
   * Read `bits` raw bits from the coder. Mirrors C++ ArithmeticDecoder::readBits.
   */
  readBits(bits: number): number {
    if (bits > 19) {
      const tmp = this.readShort()
      const tmp1 = this.readBits(bits - 16) << 16
      return (tmp1 | tmp) >>> 0
    }
    this.length = (this.length >>> bits) >>> 0
    const sym = (this.value / this.length) >>> 0
    this.value = (this.value - Math.imul(sym, this.length)) >>> 0
    if (this.length < AC_MIN_LENGTH) this.renormalize()
    return sym
  }

  readShort(): number {
    this.length = (this.length >>> 16) >>> 0
    const sym = (this.value / this.length) >>> 0
    this.value = (this.value - Math.imul(sym, this.length)) >>> 0
    if (this.length < AC_MIN_LENGTH) this.renormalize()
    return sym
  }

  private renormalize(): void {
    // Defensive guard: if length === 0 going in, the loop body cannot
    // restore it (0 << 8 === 0). This should never happen in correct
    // operation — if it does, decoder state is corrupt and looping
    // forever helps no one. Throw so the caller can surface the error
    // instead of hanging the page.
    if (this.length === 0) {
      throw new Error(
        'ArithmeticDecoder: renormalize called with length=0 — decoder state corrupt'
      )
    }
    do {
      this.value = ((this.value << 8) | this.readByte()) >>> 0
      this.length = (this.length << 8) >>> 0
    } while (this.length < AC_MIN_LENGTH)
  }

  private readByte(): number {
    if (this.pos >= this.data.length) return 0
    return this.data[this.pos++]
  }
}