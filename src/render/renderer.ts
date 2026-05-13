/**
 * Point Cloud Renderer — Phase 2 (validation)
 *
 * Extends the Phase 1 WebGL renderer with one new method:
 *   addDecodedChunk(chunk: DecodedChunk)
 *
 * This method dequantizes Int16 positions back to Float32 world
 * coordinates, converts colours from Uint8 to Float32, and adds
 * the chunk as a new THREE.Points object to the scene.
 *
 * This is deliberately a WebGL adapter — NOT the final WebGPU renderer.
 * Its purpose is to validate the decode pipeline (worker pool → WASM →
 * quantize → transfer) without involving WebGPU.
 *
 * Once Track A is validated, Track B replaces this file with a WebGPU
 * compute shader renderer. The public interface stays the same:
 *   - loadSeedPoints(seeds)
 *   - addDecodedChunk(chunk)
 *   - dispose()
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SeedPoint } from '../types/las.js'
import type { DecodedChunk } from '../decode/worker-pool.js'

export interface RendererStats {
  fps: number
  pointCount: number
  visiblePoints: number
  decodedChunks: number
}

export class PointCloudRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls

  private seedPointsObject: THREE.Points | null = null
  private decodedChunkObjects: THREE.Points[] = []

  // Scene center — world coordinates of the dataset centroid
  // Set when loadSeedPoints is called, used by addDecodedChunk
  // to place decoded points in the same coordinate space
  cx = 0
  cy = 0
  cz = 0

  private frameCount = 0
  private lastFpsTime = 0
  private currentFps = 0

  private onStats?: (stats: RendererStats) => void
  private animFrameId: number | null = null

  constructor(canvas: HTMLCanvasElement, onStats?: (stats: RendererStats) => void) {
    this.onStats = onStats

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    this.renderer.setClearColor(0x1a1a2e)

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1_000_000
    )
    this.camera.position.set(0, 0, 1000)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.screenSpacePanning = false

    window.addEventListener('resize', this.onResize.bind(this))
    this.animate()
  }

  /**
   * Load seed points from Phase 1 pipeline.
   * Sets the scene center used for all subsequent coordinate transforms.
   */
  loadSeedPoints(seeds: SeedPoint[]): void {
    if (this.seedPointsObject) {
      this.scene.remove(this.seedPointsObject)
      this.seedPointsObject.geometry.dispose()
    }

    if (seeds.length === 0) return

    // Compute centroid — this becomes the scene origin
    let sumX = 0, sumY = 0, sumZ = 0
    let minZ = Infinity, maxZ = -Infinity

    for (const s of seeds) {
      sumX += s.x; sumY += s.y; sumZ += s.z
      if (s.z < minZ) minZ = s.z
      if (s.z > maxZ) maxZ = s.z
    }

    this.cx = sumX / seeds.length
    this.cy = sumY / seeds.length
    this.cz = sumZ / seeds.length
    const elevRange = maxZ - minZ

    const positions = new Float32Array(seeds.length * 3)
    const colors = new Float32Array(seeds.length * 3)

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]
      positions[i * 3]     = s.x - this.cx
      positions[i * 3 + 1] = s.y - this.cy
      positions[i * 3 + 2] = s.z - this.cz

      const t = elevRange > 0 ? (s.z - minZ) / elevRange : 0.5
      const rgb = elevationToRgb(t)
      colors[i * 3]     = rgb[0]
      colors[i * 3 + 1] = rgb[1]
      colors[i * 3 + 2] = rgb[2]
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size: 4.0,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
    })

    this.seedPointsObject = new THREE.Points(geometry, material)
    this.scene.add(this.seedPointsObject)

    // Frame camera on the dataset
    const spread = seeds.reduce(
      (max, s) => Math.max(max, Math.abs(s.x - this.cx), Math.abs(s.y - this.cy)),
      0
    )
    this.camera.position.set(0, -spread * 1.5, spread * 0.8)
    this.camera.lookAt(0, 0, 0)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  /**
   * Add a decoded chunk to the scene.
   *
   * Dequantizes Int16 positions back to world coordinates,
   * then subtracts the scene center to get scene-relative Float32.
   *
   * Track A validation path — WebGL fallback.
   * Track B replaces this with GPU ring buffer upload.
   */
  addDecodedChunk(chunk: DecodedChunk): void {
    const positions = new Float32Array(chunk.pointCount * 3)
    const colors = new Float32Array(chunk.pointCount * 3)

    const rangeX = chunk.maxX - chunk.minX || 1
    const rangeY = chunk.maxY - chunk.minY || 1
    const rangeZ = chunk.maxZ - chunk.minZ || 1

    for (let i = 0; i < chunk.pointCount; i++) {
      // Dequantize: Int16 → [0, 1] → world coordinate
      const wx = ((chunk.positions[i * 3]     + 32768) / 65535) * rangeX + chunk.minX
      const wy = ((chunk.positions[i * 3 + 1] + 32768) / 65535) * rangeY + chunk.minY
      const wz = ((chunk.positions[i * 3 + 2] + 32768) / 65535) * rangeZ + chunk.minZ

      // Subtract scene center for GPU-safe Float32
      positions[i * 3]     = wx - this.cx
      positions[i * 3 + 1] = wy - this.cy
      positions[i * 3 + 2] = wz - this.cz

      // Colors: Uint8 RGBA → Float32 RGB
      colors[i * 3]     = chunk.colors[i * 4]     / 255
      colors[i * 3 + 1] = chunk.colors[i * 4 + 1] / 255
      colors[i * 3 + 2] = chunk.colors[i * 4 + 2] / 255
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const material = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: false,
      vertexColors: true,
    })

    const points = new THREE.Points(geometry, material)
    this.scene.add(points)
    this.decodedChunkObjects.push(points)

    // Hide seed points once enough chunks have arrived —
    // 4px seed splats look chunky next to 1.5px decoded points
    if (this.decodedChunkObjects.length >= 10 && this.seedPointsObject) {
      this.seedPointsObject.visible = false
    }
  }

  /**
   * Get current camera position in world coordinates.
   * Used by the streaming engine to prioritise chunk decode order.
   */
  getCameraWorldPosition(): { x: number; y: number; z: number } {
    return {
      x: this.camera.position.x + this.cx,
      y: this.camera.position.y + this.cy,
      z: this.camera.position.z + this.cz,
    }
  }

  private animate(): void {
    this.animFrameId = requestAnimationFrame(this.animate.bind(this))
    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    this.frameCount++
    const now = performance.now()
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime))
      this.frameCount = 0
      this.lastFpsTime = now

      const totalPoints =
        (this.seedPointsObject?.geometry.attributes.position.count ?? 0) +
        this.decodedChunkObjects.reduce(
          (sum, obj) => sum + obj.geometry.attributes.position.count, 0
        )

      this.onStats?.({
        fps: this.currentFps,
        pointCount: totalPoints,
        visiblePoints: totalPoints,
        decodedChunks: this.decodedChunkObjects.length,
      })
    }
  }

  private onResize(): void {
    const canvas = this.renderer.domElement
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId)
    this.seedPointsObject?.geometry.dispose()
    for (const obj of this.decodedChunkObjects) obj.geometry.dispose()
    this.renderer.dispose()
    window.removeEventListener('resize', this.onResize.bind(this))
  }
}

function elevationToRgb(t: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0.0, 0.2, 0.8],
    [0.0, 0.8, 0.6],
    [0.2, 0.9, 0.1],
    [1.0, 0.8, 0.0],
    [1.0, 0.1, 0.0],
  ]
  const idx = t * (stops.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, stops.length - 1)
  const f = idx - lo
  return [
    stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f,
    stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f,
    stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f,
  ]
}