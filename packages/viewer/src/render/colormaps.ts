/**
 * ASPRS default classification colour lookup table.
 * 256 entries packed as RGBA8 little-endian u32: R | (G<<8) | (B<<16) | (A<<24).
 * Matches the extraction in points-depth.wgsl classLUT reads.
 */
function rgb(r: number, g: number, b: number): number {
  return ((0xFF << 24) | (b << 16) | (g << 8) | r) >>> 0
}

export const CLASS_LUT: Uint32Array = (() => {
  const lut = new Uint32Array(256)
  lut.fill(rgb(150, 150, 150)) // default: neutral grey for undefined classes

  lut[0]  = rgb(160, 160, 160) // Never classified
  lut[1]  = rgb(200, 200, 200) // Unclassified
  lut[2]  = rgb(160, 120,  70) // Ground
  lut[3]  = rgb(120, 200,  90) // Low vegetation
  lut[4]  = rgb( 60, 170,  60) // Medium vegetation
  lut[5]  = rgb( 30, 120,  30) // High vegetation
  lut[6]  = rgb(240, 120,  60) // Building
  lut[7]  = rgb(255,   0, 255) // Low point (noise)
  lut[9]  = rgb( 50, 130, 230) // Water
  lut[10] = rgb(130,  80, 150) // Rail
  lut[11] = rgb(100, 100, 100) // Road surface
  lut[17] = rgb(180, 160,  40) // Bridge deck
  lut[18] = rgb(230,  40,  40) // High noise

  return lut
})()
