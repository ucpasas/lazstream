/**
 * Phase 1 Renderer
 *
 * Simple Three.js WebGL renderer for seed point visualisation.
 * No WebGPU compute shaders yet — that's Phase 2.
 * Uses standard Three.js Points with a ShaderMaterial for colour-by-elevation.
 *
 * This renderer is intentionally minimal. Its job is to prove the
 * chunk-seed pipeline works end-to-end. WebGPU replaces it in Phase 2.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SeedPoint } from '../types/las.js'

export interface RendererStats {
  fps: number
  pointCount: number
  visiblePoints: number
}

export class PointCloudRenderer {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private clock: THREE.Clock

  private seedPointsObject: THREE.Points | null = null
  private frameCount = 0
  private lastFpsTime = 0
  private currentFps = 0

  private onStats?: (stats: RendererStats) => void
  private animFrameId: number | null = null

  constructor(canvas: HTMLCanvasElement, onStats?: (stats: RendererStats) => void) {
    this.onStats = onStats

    // Renderer — WebGL, antialias off for performance at scale
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    this.renderer.setClearColor(0x1a1a2e)  // Dark navy background

    // Scene
    this.scene = new THREE.Scene()

    // Camera — perspective, wide FOV for point clouds
    this.camera = new THREE.PerspectiveCamera(
      60,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1_000_000
    )
    this.camera.position.set(0, 0, 1000)

    // Orbit controls
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.screenSpacePanning = false

    this.clock = new THREE.Clock()

    // Handle resize
    window.addEventListener('resize', this.onResize.bind(this))

    this.animate()
  }

  /**
   * Load seed points into the scene.
   * Called once when seed extraction completes.
   */
  loadSeedPoints(seeds: SeedPoint[]): void {
    // Remove existing
    if (this.seedPointsObject) {
      this.scene.remove(this.seedPointsObject)
      this.seedPointsObject.geometry.dispose()
    }

    if (seeds.length === 0) return

    // Compute centroid for camera positioning
    let sumX = 0, sumY = 0, sumZ = 0
    let minZ = Infinity, maxZ = -Infinity

    for (const s of seeds) {
      sumX += s.x
      sumY += s.y
      sumZ += s.z
      if (s.z < minZ) minZ = s.z
      if (s.z > maxZ) maxZ = s.z
    }

    const cx = sumX / seeds.length
    const cy = sumY / seeds.length
    const cz = sumZ / seeds.length
    const elevRange = maxZ - minZ

    // Build BufferGeometry — positions are relative to centroid
    // to avoid floating-point precision loss at large coordinates
    const positions = new Float32Array(seeds.length * 3)
    const colors = new Float32Array(seeds.length * 3)

    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]
      positions[i * 3]     = s.x - cx
      positions[i * 3 + 1] = s.y - cy
      positions[i * 3 + 2] = s.z - cz

      // Colour by elevation — simple gradient: blue (low) → green → red (high)
      const t = elevRange > 0 ? (s.z - minZ) / elevRange : 0.5
      const rgb = elevationToRgb(t)
      colors[i * 3]     = rgb[0]
      colors[i * 3 + 1] = rgb[1]
      colors[i * 3 + 2] = rgb[2]
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // Material — vertex colors, round points
    const material = new THREE.PointsMaterial({
      size: 4.0,
      sizeAttenuation: false,  // Fixed pixel size — seed points are sparse
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    })

    this.seedPointsObject = new THREE.Points(geometry, material)
    this.scene.add(this.seedPointsObject)

    // Position camera to frame the point cloud
    const spread = Math.max(
      seeds.reduce((max, s) => Math.max(max, Math.abs(s.x - cx), Math.abs(s.y - cy)), 0)
    )
    this.camera.position.set(0, -spread * 1.5, spread * 0.8)
    this.camera.lookAt(0, 0, 0)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
  }

  private animate(): void {
    this.animFrameId = requestAnimationFrame(this.animate.bind(this))

    this.controls.update()
    this.renderer.render(this.scene, this.camera)

    // FPS tracking
    this.frameCount++
    const now = performance.now()
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = Math.round(this.frameCount * 1000 / (now - this.lastFpsTime))
      this.frameCount = 0
      this.lastFpsTime = now

      this.onStats?.({
        fps: this.currentFps,
        pointCount: this.seedPointsObject?.geometry.attributes.position.count ?? 0,
        visiblePoints: this.seedPointsObject?.geometry.attributes.position.count ?? 0,
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
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId)
    }
    this.seedPointsObject?.geometry.dispose()
    this.renderer.dispose()
    window.removeEventListener('resize', this.onResize.bind(this))
  }
}

/**
 * Map a normalised value [0-1] to an RGB colour for elevation visualisation.
 * Blue → Cyan → Green → Yellow → Red
 */
function elevationToRgb(t: number): [number, number, number] {
  // 4-stop gradient
  const stops: [number, number, number][] = [
    [0.0, 0.2, 0.8],   // Blue (low)
    [0.0, 0.8, 0.6],   // Cyan-green
    [0.2, 0.9, 0.1],   // Green
    [1.0, 0.8, 0.0],   // Yellow
    [1.0, 0.1, 0.0],   // Red (high)
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