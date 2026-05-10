/**
 * Arithmetic Decoder for LAZ Chunk Table
 *
 * Direct port from LASzip/src/arithmeticdecoder.cpp
 * Only implements the subset needed for chunk table decompression:
 * - ArithmeticDecoder (range coder)
 * - ArithmeticBitModel (adaptive binary model)
 * - ArithmeticModel (adaptive multi-symbol model)
 *
 * All arithmetic uses 32-bit unsigned integers via >>> 0 to stay
 * in uint32 range. JavaScript bitwise operators work on int32;
 * >>> 0 converts to uint32.
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
  distribution: Uint32Array
  symbolCount: Uint32Array
  decoderTable: Uint32Array | null = null
  tableShift = 0
  totalCount = 0
  updateCycle = 0
  symbolsUntilUpdate = 0

  constructor(symbols: number) {
    this.symbols = symbols
    this.distribution = new Uint32Array(symbols + 2)
    this.symbolCount = new Uint32Array(symbols)

    // Decoder table for fast lookup (only for small symbol counts)
    if (symbols <= 16) {
      this.tableShift = Math.max(0, Math.ceil(Math.log2(symbols)) - 2)
      this.decoderTable = new Uint32Array(1 << (DM_LENGTH_SHIFT - this.tableShift))
    } else {
      this.tableShift = Math.max(0, Math.ceil(Math.log2(symbols)) - 4)
      this.decoderTable = new Uint32Array(1 << (DM_LENGTH_SHIFT - this.tableShift))
    }
  }

  init(table?: Uint32Array): void {
    this.totalCount = 0
    if (table) {
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = table[n]
        this.totalCount += table[n]
      }
    } else {
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = 1
      }
      this.totalCount = this.symbols
    }
    this.doUpdate()
    this.symbolsUntilUpdate = this.updateCycle = (this.symbols + 6) >>> 1
  }

  update(): void {
    this.totalCount += this.updateCycle
    if (this.totalCount > DM_MAX_COUNT) {
      this.totalCount = 0
      for (let n = 0; n < this.symbols; n++) {
        this.symbolCount[n] = (this.symbolCount[n] + 1) >>> 1
        this.totalCount += this.symbolCount[n]
      }
    }
    this.doUpdate()
    this.updateCycle = (5 * this.updateCycle) >>> 2
    const maxCycle = (this.symbols + 6) << 3
    if (this.updateCycle > maxCycle) this.updateCycle = maxCycle
    this.symbolsUntilUpdate = this.updateCycle
  }

  private doUpdate(): void {
    const scale = (0x80000000 / this.totalCount) >>> 0
    let sum = 0
    let s = 0

    if (this.decoderTable) {
      for (let k = 0; k < this.symbols; k++) {
        this.distribution[k] = (Math.imul(scale, sum) >>> (31 - DM_LENGTH_SHIFT)) >>> 0
        sum += this.symbolCount[k]
        const w = this.distribution[k] >>> this.tableShift
        while (s < w) this.decoderTable[s++] = k - 1
      }
      const tableSize = 1 << (DM_LENGTH_SHIFT - this.tableShift)
      while (s < tableSize) this.decoderTable[s++] = this.symbols - 1
    } else {
      for (let k = 0; k < this.symbols; k++) {
        this.distribution[k] = (Math.imul(scale, sum) >>> (31 - DM_LENGTH_SHIFT)) >>> 0
        sum += this.symbolCount[k]
      }
    }
    this.distribution[this.symbols] = 1 << DM_LENGTH_SHIFT
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

  decodeSymbol(model: ArithmeticModel): number {
    let sym: number
    let x: number
    let y = this.length

    if (model.decoderTable) {
      this.length = (this.length >>> DM_LENGTH_SHIFT) >>> 0
      const dv = (this.value / this.length) >>> 0
      const t = dv >>> model.tableShift
      sym = model.decoderTable[Math.min(t, model.decoderTable.length - 1)]
      while (model.distribution[sym + 1] <= dv) sym++
      x = Math.imul(model.distribution[sym], this.length) >>> 0
      y = Math.imul(model.distribution[sym + 1], this.length) >>> 0
    } else {
      x = 0
      sym = 0
      this.length = (this.length >>> DM_LENGTH_SHIFT) >>> 0
      let n = model.symbols
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
        k = (sym + n) >>> 1
      } while (k !== sym)
    }

    this.value = (this.value - x) >>> 0
    this.length = (y - x) >>> 0

    if (this.length < AC_MIN_LENGTH) this.renormalize()

    model.symbolCount[sym]++
    model.symbolsUntilUpdate--
    if (model.symbolsUntilUpdate === 0) model.update()

    return sym
  }

  readBits(bits: number): number {
    if (bits > 19) {
      // Split into two reads to avoid precision loss
      const loValue = this.readShort()
      const hiBits = bits - 16
      const hiValue = this.readBitsInternal(hiBits)
      return (hiValue << 16) | loValue
    }
    return this.readBitsInternal(bits)
  }

  private readBitsInternal(bits: number): number {
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