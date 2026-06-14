export interface RawPick {
  /** World-space position recovered from the depth buffer (T1). Always present on a hit. */
  worldPos: { x: number; y: number; z: number }
  /** CSS pixel position of the click on the canvas. */
  screenPos: { x: number; y: number }
  /** Global chunk index. -1 when the pick-ID buffer is not active (T2 off) or no point was hit. */
  chunkIndex: number
  /** Point index within the chunk. -1 when T2 is off or no point was hit. */
  localPointIndex: number
}
