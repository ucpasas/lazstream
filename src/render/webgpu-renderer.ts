/**
 * WebGPURenderer — Phase 2 Track B + Phase 3 Track C
 *
 * Drop-in replacement for the Track A WebGL validation renderer. Public
 * interface matches: loadSeedPoints, addDecodedChunk, getCameraWorldPosition,
 * getSceneCenter, dispose.
 *
 * Track C additions (frustum culling support for engine):
 *   - getFrustumWorldBBox3D()   : world-space AABB of the camera frustum
 *   - getFovY()                 : vertical FOV in radians (for SSE)
 *   - getCanvasHeight()         : current canvas pixel height (for SSE)
 *
 * The frustum extraction reuses the cached viewProj from writeCameraUniform()
 * — both are refreshed every frame, so the inverse is always up-to-date when
 * engine.updateCamera() queries it.
 *
 * Pipeline per frame:
 *  1. clear-depth compute: reset depth buffer to 0xFFFFFFFF sentinel
 *  2. points-depth compute: one dispatch per slot, projects + atomicMin
 *  3. resolve-edl render: fullscreen triangle reads depth/color, applies EDL
 *
 * See plan + wiki ([[Renderer]], [[WebGPU Compute]], [[Ring Buffer GPU Memory]])
 * for the design rationale.
 *
 * Vite note: the .wgsl ?raw imports require Vite to treat .wgsl as importable
 * text. This works out of the box in Vite 6 — no plugin needed — but if you've
 * customized `assetsInclude`, ensure '**\/*.wgsl' is allowed.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import depthShaderSrc   from './shaders/points-depth.wgsl?raw'
import clearShaderSrc   from './shaders/clear-depth.wgsl?raw'
import resolveShaderSrc from './shaders/resolve-edl.wgsl?raw'

import { createWebGPUContext, type WebGPUContext } from './webgpu-context'
export { WebGPUUnsupportedError } from './webgpu-context'
import { RingBufferAllocator, type Slot } from './ring-buffer'
import {
  BYTES_PER_POINT,
  packChunk,
  packSeedsAsChunk,
  type SeedPoint,
} from './point-packing'
import type { DecodedChunk } from '../decode/worker-pool.js'
import type { BBox3D } from '../types/spatial.js'
import type { LasHeader } from '../types/las.js'

// --- Constants ---------------------------------------------------------------

const SEED_PSEUDO_CHUNK_INDEX = -1
const SEED_HIDE_THRESHOLD     = Infinity      // keep seeds visible always — they provide the file-wide overview outline at every zoom level, useful when the ring buffer holds only a fraction of the file's chunks. Cost is trivial (one extra slot, ~7000 points per frame). Set to a finite number (e.g. 10) to hide seeds once N real chunks have landed.
const MAX_SLOTS               = 4096          // upper bound on simultaneous chunks
const COMPUTE_WORKGROUP_SIZE  = 128
const CLEAR_WORKGROUP_SIZE    = 256
const MAX_DPR                 = 2.0           // clamp devicePixelRatio
const CAMERA_FOV              = 60
const CAMERA_NEAR             = 0.1
const CAMERA_FAR              = 100_000

/**
 * Initial-view framing on `loadSeedPoints`.
 *
 * Camera is placed at this elevation angle above the model centre, looking
 * down at it from due south (azimuth ignored — south-facing convention).
 * Distance is computed from the file bbox diagonal so the whole model fits
 * comfortably in the FOV.
 *
 * 45° gives a 3/4 oblique aerial view — best for understanding both ground
 * footprint and vertical structure (buildings, terrain). Change to 60° for
 * a more top-down feel, or 30° for a more horizontal/horizon view.
 */
const CAMERA_INITIAL_ELEVATION_DEG = 30
/** Multiplier on bbox diagonal for initial camera distance. Higher = more padding. */
const CAMERA_INITIAL_DISTANCE_MULT = 1.2

// Uniform buffer sizes (WGSL-aligned layouts — see shader files)
const CAMERA_UNIFORM_BYTES = 96   // mat4 + vec2 + pad + vec3 + pad
const CHUNK_UNIFORM_BYTES  = 32   // vec3 + u32 + vec3 + u32  (padded to stride)
const VIEWPORT_UNIFORM_BYTES = 16 // vec2 + f32 + f32

// --- Types -------------------------------------------------------------------

export interface WebGPURendererOptions {
  /** Override ring buffer size in bytes. Defaults to context.ringBufferCapacity. */
  ringBufferCapacity?: number
  edlStrength?: number   // default 200
  edlRadius?:   number   // default 1
  onFrame?:     (info: FrameInfo) => void
}

export interface FrameInfo {
  frame: number
  slots: number
  pointsLoaded: number
}

// =============================================================================
// WebGPURenderer
// =============================================================================

export class WebGPURenderer {
  // Context
  private readonly ctx: WebGPUContext
  private readonly device: GPUDevice

  // Pipelines + layouts
  private readonly clearPipeline:   GPUComputePipeline
  private readonly depthPipeline:   GPUComputePipeline
  private readonly resolvePipeline: GPURenderPipeline
  private readonly clearBindLayout:   GPUBindGroupLayout
  private readonly depthBindLayout:   GPUBindGroupLayout
  private readonly resolveBindLayout: GPUBindGroupLayout

  // Buffers — static (created once)
  private readonly ringBuffer:      GPUBuffer  // packed points, sized to ringBufferCapacity
  private readonly cameraUniform:   GPUBuffer  // CAMERA_UNIFORM_BYTES
  private readonly chunkUniform:    GPUBuffer  // MAX_SLOTS * chunkUniformStride
  private readonly viewportUniform: GPUBuffer  // VIEWPORT_UNIFORM_BYTES
  private readonly chunkUniformStride: number  // 256 typically (device alignment)

  // Buffers — viewport-dependent (recreated on resize)
  private depthBuffer!: GPUBuffer
  private colorBuffer!: GPUBuffer
  private viewportPixels = { w: 0, h: 0 }

  // Bind groups (recreated when their backing buffers change)
  private clearBindGroup!:   GPUBindGroup
  private depthBindGroup!:   GPUBindGroup
  private resolveBindGroup!: GPUBindGroup

  // Slot management
  private readonly slots: RingBufferAllocator
  private readonly freeUniformSlotIdxs: number[] // indices 0..MAX_SLOTS-1
  /** Map chunkIndex → uniform slot index (0..MAX_SLOTS-1). */
  private readonly chunkToUniformIdx = new Map<number, number>()

  /**
   * Chunks that arrived from decode but couldn't fit in the ring buffer at the
   * moment they landed (all 374 slots were touched by the just-completed render
   * frame → no LRU-evictable slot → allocate() returned null). They get retried
   * each renderFrame after the cull marks new slots stale.
   *
   * Why this is needed: the engine's back-pressure provider sees X stale slots
   * at frame N and dispatches ≤8 chunks. Those chunks travel through fetch +
   * worker decode for ~30 frames; by the time they arrive at the renderer, the
   * camera may have moved such that the previously-stale slots are now visible
   * again. Without the queue, the worker's decode work is thrown away and the
   * prioritiser has already marked the chunk as "decoded" so it can't be
   * re-dispatched in this session.
   *
   * Bounded — MAX_DEFERRED_CHUNKS caps memory at ~38 MB (64 × ~600 KB). Beyond
   * that, oldest chunks get dropped (the dispatch flow is faster than the
   * buffer can absorb).
   */
  private readonly MAX_DEFERRED_CHUNKS = 64
  private deferredChunks: Array<{
    chunkIndex: number
    packed: Uint32Array
    pointCount: number
    min:   [number, number, number]
    range: [number, number, number]
  }> = []
  private deferredOverflowCount = 0

  // Camera + controls
  private readonly camera:   THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly sceneCenter = { x: 0, y: 0, z: 0 }
  private cameraDirty = true

  // Frame loop
  private currentFrame = 0
  private rafHandle: number | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposed = false
  private realChunkCount = 0

  // Cached matrices (avoid allocs in render loop)
  private readonly viewProj = new THREE.Matrix4()
  private readonly cameraUniformView: Float32Array
  private readonly chunkUniformScratch: Float32Array  // single-slot view

  // Track C — frustum extraction scratch (reused each frame, no allocs)
  private readonly invViewProj    = new THREE.Matrix4()
  private readonly frustumCorners: THREE.Vector3[] =
    Array.from({ length: 8 }, () => new THREE.Vector3())

  // CPU-side frustum culling scratch (reused each frame). Three.js's
  // Frustum + Box3 do proper 6-plane vs AABB testing — much tighter than
  // the AABB-vs-frustum-AABB approximation, which is too loose at our
  // scene scale (CAMERA_FAR=100km, 60° FOV → frustum AABB ~115 km wide).
  private readonly cullFrustum = new THREE.Frustum()
  private readonly cullSlotBox = new THREE.Box3()

  // Options
  private readonly edlStrength: number
  private readonly edlRadius: number
  private readonly onFrame?: (info: FrameInfo) => void

  // --- Constructor / factory ------------------------------------------------

  private constructor(ctx: WebGPUContext, options: WebGPURendererOptions) {
    this.ctx = ctx
    this.device = ctx.device
    this.edlStrength = options.edlStrength ?? 600
    this.edlRadius   = options.edlRadius   ?? 1
    this.onFrame     = options.onFrame

    const ringCapacity = options.ringBufferCapacity ?? ctx.ringBufferCapacity
    this.slots = new RingBufferAllocator(ringCapacity)
    this.freeUniformSlotIdxs = Array.from({ length: MAX_SLOTS }, (_, i) => MAX_SLOTS - 1 - i)
    // (Stored as a stack — pop() returns lowest idx first since we built it
    //  reversed. Order doesn't actually matter; we just need O(1) get/release.)

    // Dynamic-offset minimum alignment is device-reported. Default is 256.
    // Pad CHUNK_UNIFORM_BYTES (32) up to the alignment.
    const align = this.device.limits.minUniformBufferOffsetAlignment ?? 256
    this.chunkUniformStride = Math.max(align, Math.ceil(CHUNK_UNIFORM_BYTES / align) * align)

    // --- Static buffers ---------------------------------------------------
    this.ringBuffer = this.device.createBuffer({
      label: 'lazstream/ring',
      size: ringCapacity,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.cameraUniform = this.device.createBuffer({
      label: 'lazstream/camera-uniform',
      size: CAMERA_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.chunkUniform = this.device.createBuffer({
      label: 'lazstream/chunk-uniform',
      size: MAX_SLOTS * this.chunkUniformStride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.viewportUniform = this.device.createBuffer({
      label: 'lazstream/viewport-uniform',
      size: VIEWPORT_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.cameraUniformView   = new Float32Array(CAMERA_UNIFORM_BYTES / 4)
    this.chunkUniformScratch = new Float32Array(this.chunkUniformStride / 4)

    // --- Bind group layouts -----------------------------------------------
    this.clearBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/clear-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' } },
      ],
    })

    this.depthBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/depth-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform', hasDynamicOffset: true,
                    minBindingSize: CHUNK_UNIFORM_BYTES } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    })

    this.resolveBindLayout = this.device.createBindGroupLayout({
      label: 'lazstream/resolve-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })

    // --- Pipelines --------------------------------------------------------
    const clearModule   = this.device.createShaderModule({ code: clearShaderSrc,   label: 'clear' })
    const depthModule   = this.device.createShaderModule({ code: depthShaderSrc,   label: 'points-depth' })
    const resolveModule = this.device.createShaderModule({ code: resolveShaderSrc, label: 'resolve-edl' })

    this.clearPipeline = this.device.createComputePipeline({
      label: 'lazstream/clear-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.clearBindLayout] }),
      compute: { module: clearModule, entryPoint: 'main' },
    })
    this.depthPipeline = this.device.createComputePipeline({
      label: 'lazstream/depth-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.depthBindLayout] }),
      compute: { module: depthModule, entryPoint: 'main' },
    })
    this.resolvePipeline = this.device.createRenderPipeline({
      label: 'lazstream/resolve-pl',
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.resolveBindLayout] }),
      vertex:   { module: resolveModule, entryPoint: 'vs_main' },
      fragment: { module: resolveModule, entryPoint: 'fs_main',
                  targets: [{ format: ctx.canvasFormat }] },
      primitive: { topology: 'triangle-list' },
    })

    // --- Camera + controls ------------------------------------------------
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR)
    this.camera.position.set(0, 0, 1000)
    this.camera.up.set(0, 0, 1) // Z-up for geospatial data

    this.controls = new OrbitControls(this.camera, ctx.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.addEventListener('change', () => { this.cameraDirty = true })

    // --- Viewport setup ---------------------------------------------------
    this.handleResize(ctx.canvas.clientWidth, ctx.canvas.clientHeight)
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect
        this.handleResize(cr.width, cr.height)
      }
    })
    this.resizeObserver.observe(ctx.canvas)

    // --- Start frame loop -------------------------------------------------
    this.writeViewportUniform()
    this.rafHandle = requestAnimationFrame(this.renderFrame)
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: WebGPURendererOptions = {},
  ): Promise<WebGPURenderer> {
    // ringBufferCapacity, if specified, both:
    //   (a) tells the context to negotiate that much from the adapter
    //   (b) overrides the actual ring buffer size used by the renderer
    // If not specified, the context negotiates its default (2 GB target).
    const ctx = await createWebGPUContext(canvas, {
      targetCapacityBytes: options.ringBufferCapacity,
    })
    return new WebGPURenderer(ctx, options)
  }

  // --- Public API -----------------------------------------------------------

  loadSeedPoints(seeds: SeedPoint[], header?: LasHeader): void {
    if (this.disposed) return

    const packed = packSeedsAsChunk(seeds)
    if (packed.pointCount === 0) return

    // Camera framing: prefer the LAS header bbox (authoritative — covers
    // every point in the file, not just sampled seeds). Falls back to the
    // seed-derived bbox if the header isn't available (older callers).
    const bbox = header
      ? {
          min: [header.minX, header.minY, header.minZ] as const,
          max: [header.maxX, header.maxY, header.maxZ] as const,
          range: [
            header.maxX - header.minX,
            header.maxY - header.minY,
            header.maxZ - header.minZ,
          ] as const,
        }
      : {
          min: packed.min,
          max: [
            packed.min[0] + packed.range[0],
            packed.min[1] + packed.range[1],
            packed.min[2] + packed.range[2],
          ] as const,
          range: packed.range,
        }

    // Set sceneCenter to the model's geometric centre so all downstream math
    // (camera, frustum cull, GPU dequantization) operates relative to it.
    this.sceneCenter.x = bbox.min[0] + bbox.range[0] / 2
    this.sceneCenter.y = bbox.min[1] + bbox.range[1] / 2
    this.sceneCenter.z = 1
    // Distance: enough to fit the bbox diagonal in the FOV with some padding.
    // Min of 100 m prevents extreme close-in for tiny files (a single point
    // would otherwise give distance = 0).
    const diag = Math.hypot(bbox.range[0], bbox.range[1], bbox.range[2])
    const dist = Math.max(diag * CAMERA_INITIAL_DISTANCE_MULT, 100)

    // Camera position: looking at the scene-local origin (which is the model
    // centre in world coords) from due south at the configured elevation.
    //   horizontal = cos(elevation): how far away in the XY plane
    //   vertical   = sin(elevation): how high above the target
    // South-facing convention: position has y < 0 (south of target), x = 0,
    // z > 0 (above ground).
    const elevationRad = (CAMERA_INITIAL_ELEVATION_DEG * Math.PI) / 180
    const cosE = Math.cos(elevationRad)
    const sinE = Math.sin(elevationRad)
    this.camera.position.set(0, -dist * cosE, dist * sinE)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.cameraDirty = true

    this.addPackedData(
      SEED_PSEUDO_CHUNK_INDEX,
      packed.packed,
      packed.pointCount,
      packed.min,
      packed.range,
    )
  }

  addDecodedChunk(chunk: DecodedChunk): void {
    if (this.disposed) return

    const packed = packChunk(chunk)
    const min: [number, number, number]   = [chunk.minX, chunk.minY, chunk.minZ]
    const range: [number, number, number] = [
      (chunk.maxX - chunk.minX) || 1,
      (chunk.maxY - chunk.minY) || 1,
      (chunk.maxZ - chunk.minZ) || 1,
    ]

    if (this.addPackedData(chunk.chunkIndex, packed, chunk.pointCount, min, range)) {
      this.realChunkCount++
      if (this.realChunkCount === SEED_HIDE_THRESHOLD) {
        this.releaseSlot(SEED_PSEUDO_CHUNK_INDEX)
      }
      return
    }

    // Couldn't fit right now. Defer: each renderFrame retries the queue
    // after the cull may have freed an LRU slot. Bounded queue length;
    // overflow drops the oldest deferred chunk and increments a counter.
    if (this.deferredChunks.length >= this.MAX_DEFERRED_CHUNKS) {
      this.deferredChunks.shift()
      this.deferredOverflowCount++
      // Rate-limited warning so we know if camera movement is consistently
      // outpacing buffer turnover.
      if (this.deferredOverflowCount % 25 === 1) {
        console.warn(
          `[webgpu] deferred queue overflow: ${this.deferredOverflowCount} chunks ` +
          `permanently lost (camera moving faster than ring buffer can absorb)`
        )
      }
    }
    this.deferredChunks.push({
      chunkIndex: chunk.chunkIndex,
      packed,
      pointCount: chunk.pointCount,
      min,
      range,
    })
  }

  /**
   * Retry queued chunks that previously couldn't fit. Called from renderFrame
   * AFTER the depth compute pass so slot.lastRenderedFrame reflects the
   * just-completed frame's visibility — LRU-evictable slots are the ones not
   * touched this frame, which is what we want to overwrite.
   *
   * Stops at the first chunk that still can't fit — all deferred chunks have
   * identical byteLength (one slot each), so if one fails to allocate, the
   * rest will too. Cheap when the queue is empty (common case).
   */
  private flushDeferredChunks(): void {
    while (this.deferredChunks.length > 0) {
      const d = this.deferredChunks[0]!
      if (!this.addPackedData(d.chunkIndex, d.packed, d.pointCount, d.min, d.range)) break
      this.deferredChunks.shift()
      this.realChunkCount++
      if (this.realChunkCount === SEED_HIDE_THRESHOLD) {
        this.releaseSlot(SEED_PSEUDO_CHUNK_INDEX)
      }
    }
  }

  /** Current deferred queue depth — for stats overlay diagnostics. */
  getDeferredCount(): number {
    return this.deferredChunks.length
  }

  getCameraWorldPosition(): { x: number; y: number; z: number } {
    return {
      x: this.camera.position.x + this.sceneCenter.x,
      y: this.camera.position.y + this.sceneCenter.y,
      z: this.camera.position.z + this.sceneCenter.z,
    }
  }

  getSceneCenter(): { x: number; y: number; z: number } {
    return { ...this.sceneCenter }
  }

  /**
   * Ring buffer state for engine back-pressure (Phase 3 Track A — Step 6).
   *
   * `slotsFree` here means "slots `allocate()` could fulfill right now" —
   * not just untouched free slots. Once the buffer fills the first time,
   * the freeStack is empty forever; making progress means LRU-evicting
   * stale slots. Reports the combined count so the engine can dispatch
   * fresh chunks when stale ones are ready to be replaced.
   *
   * Cheap O(slotCount) — called once per engine tick.
   */
  getRingBufferStatus(): { slotsFree: number; slotsTotal: number } {
    const m = this.slots.metrics()
    return {
      slotsFree: this.slots.getAvailableCount(this.currentFrame),
      slotsTotal: m.slotCount,
    }
  }

  /**
   * Clear all rendered state so the next file load starts from a clean slate.
   *
   * Called by main.ts at the top of loadUrl() — before the engine begins
   * fetching the new file's header. Without this, the renderer accumulates
   * state across loads: previous file's chunks live in the ring buffer
   * until LRU eviction reclaims them, and they're positioned relative to
   * the previous sceneCenter so they render in the wrong place.
   *
   * What gets reset:
   *   - Ring buffer slot table → empty (next allocations start from offset 0)
   *   - Uniform slot allocator → all MAX_SLOTS free
   *   - chunkIndex → uniform-slot map → empty
   *   - sceneCenter → 0,0,0 (next loadSeedPoints establishes new origin)
   *   - realChunkCount → 0 (SEED_HIDE_THRESHOLD counter restarts)
   *
   * What stays:
   *   - GPU buffers (ring, depth, color) — their contents are orphaned but
   *     don't render because the depth buffer is cleared per-frame and an
   *     empty slot table means no compute pass writes new depth/color
   *   - Camera position — loadSeedPoints() re-fits when new seeds arrive.
   *     If the new load fails before seeds, user sees a blank canvas at
   *     the old camera angle; better than seeing stale data.
   */
  reset(): void {
    if (this.disposed) return

    // CPU-side slot bookkeeping → empty
    this.slots.clear()
    this.chunkToUniformIdx.clear()

    // Uniform-slot allocator → all-free (mirror constructor's initialiser)
    this.freeUniformSlotIdxs.length = 0
    for (let i = 0; i < MAX_SLOTS; i++) {
      this.freeUniformSlotIdxs.push(MAX_SLOTS - 1 - i)
    }

    // Scene origin → 0; next loadSeedPoints() sets it from new seed bbox
    this.sceneCenter.x = 0
    this.sceneCenter.y = 0
    this.sceneCenter.z = 0

    // Seed-hide counter restarts
    this.realChunkCount = 0

    // Deferred-chunk queue → empty (any in-flight from previous load is moot)
    this.deferredChunks = []
    this.deferredOverflowCount = 0

    // Force a camera uniform write next frame so sceneCenter change lands
    this.cameraDirty = true
  }

  // --- Track C: camera + frustum providers -----------------------------------

  /** Vertical field of view, in radians. Used by the engine's SSE calc. */
  getFovY(): number {
    return this.camera.fov * (Math.PI / 180)
  }

  /** Current canvas height in pixels (after DPR scaling). Used by SSE calc. */
  getCanvasHeight(): number {
    return this.viewportPixels.h
  }

  /**
   * World-space 3D AABB of the camera's view frustum. Used by
   * SpatialIndex.queryFrustum() to gate chunk decode requests.
   *
   * Reuses the viewProj matrix computed in writeCameraUniform() each frame,
   * so this is cheap to call from updateCamera() in the engine.
   *
   * Coordinate system: the renderer internally works in scene-local
   * coordinates (world XYZ minus sceneCenter). We unproject NDC corners
   * to scene-local, then offset by sceneCenter to return WORLD coords —
   * what the spatial index stores.
   */
  getFrustumWorldBBox3D(): BBox3D {
    // viewProj was already composed this frame in writeCameraUniform().
    // Invert into a separate matrix so we don't corrupt the cached viewProj.
    this.invViewProj.copy(this.viewProj).invert()

    // 8 NDC cube corners. Three.js uses OpenGL-style NDC depth [-1, 1] for
    // its Matrix4.invert() + Vector3.applyMatrix4 unprojection path, even
    // when targeting WebGPU canvases — projectionMatrix.invert() internally
    // handles the WebGPU [0,1] → [-1,1] depth mapping transparently.
    const ndcNear = -1
    const ndcFar  =  1
    this.frustumCorners[0].set(-1, -1, ndcNear)
    this.frustumCorners[1].set( 1, -1, ndcNear)
    this.frustumCorners[2].set(-1,  1, ndcNear)
    this.frustumCorners[3].set( 1,  1, ndcNear)
    this.frustumCorners[4].set(-1, -1, ndcFar)
    this.frustumCorners[5].set( 1, -1, ndcFar)
    this.frustumCorners[6].set(-1,  1, ndcFar)
    this.frustumCorners[7].set( 1,  1, ndcFar)

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (let i = 0; i < 8; i++) {
      const c = this.frustumCorners[i]
      c.applyMatrix4(this.invViewProj)
      const wx = c.x + this.sceneCenter.x
      const wy = c.y + this.sceneCenter.y
      const wz = c.z + this.sceneCenter.z
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wz < minZ) minZ = wz
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
      if (wz > maxZ) maxZ = wz
    }

    return { minX, minY, minZ, maxX, maxY, maxZ }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle)
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    // GPU resources are released when the device is GC'd. We explicitly
    // destroy() the larger buffers to release device memory eagerly.
    this.ringBuffer.destroy()
    this.depthBuffer.destroy()
    this.colorBuffer.destroy()
    this.cameraUniform.destroy()
    this.chunkUniform.destroy()
    this.viewportUniform.destroy()
    // Note: we don't `device.destroy()` because the canvas may outlive us
    // and another renderer instance might re-use the device.
  }

  // --- Internal: slot + buffer management -----------------------------------

  /**
   * Allocate a slot, upload the packed point data, and write the per-slot
   * uniform entry. Returns false if the data couldn't fit (no allocatable
   * slots in the ring) — caller should silently drop and try later.
   */
  private addPackedData(
    chunkIndex: number,
    packedPoints: Uint32Array,
    pointCount: number,
    min:   [number, number, number],
    range: [number, number, number],
  ): boolean {
    if (this.freeUniformSlotIdxs.length === 0) {
      console.warn(`[webgpu] no free uniform slot for chunk ${chunkIndex} — dropped`)
      return false
    }

    const byteLength = pointCount * BYTES_PER_POINT
    const result = this.slots.allocate(
      chunkIndex, byteLength, pointCount, min, range, this.currentFrame,
    )
    if (!result) {
      // Not a permanent drop — the caller (addDecodedChunk or
      // flushDeferredChunks) queues the chunk for retry next frame after
      // the cull may have freed an LRU slot.
      return false
    }

    // Return uniform-slot indices of evicted slots to the free pool.
    for (const evicted of result.evicted) {
      const idx = this.chunkToUniformIdx.get(evicted.chunkIndex)
      if (idx !== undefined) {
        this.freeUniformSlotIdxs.push(idx)
        this.chunkToUniformIdx.delete(evicted.chunkIndex)
      }
    }

    // Assign a fresh uniform slot.
    const uniformIdx = this.freeUniformSlotIdxs.pop()!
    this.chunkToUniformIdx.set(chunkIndex, uniformIdx)

    // Upload point data into the ring buffer at the allocated offset.
    this.device.queue.writeBuffer(
      this.ringBuffer,
      result.slot.byteOffset,
      packedPoints.buffer,
      packedPoints.byteOffset,
      packedPoints.byteLength,
    )

    // Write the chunk uniform. Stride is per-device alignment (256 typically).
    const u = this.chunkUniformScratch
    u[0] = min[0]; u[1] = min[1]; u[2] = min[2]
    // word 3 (u32 reinterpret of float bits) — pointCount. Pack as int via DataView later.
    // For brevity: write floats now, overwrite words 3 and 7 with u32 via a sibling DataView.
    u[4] = range[0]; u[5] = range[1]; u[6] = range[2]
    // word 7 = pointStrideOffset (u32)
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength)
    dv.setUint32(12, pointCount, true)
    dv.setUint32(28, result.slot.byteOffset / 4, true) // pointStrideOffset in u32s
    // Zero the rest to be safe (alignment padding).
    for (let i = 8; i < u.length; i++) u[i] = 0

    this.device.queue.writeBuffer(
      this.chunkUniform,
      uniformIdx * this.chunkUniformStride,
      u.buffer,
      u.byteOffset,
      this.chunkUniformStride,
    )

    return true
  }

  private releaseSlot(chunkIndex: number): void {
    const uniformIdx = this.chunkToUniformIdx.get(chunkIndex)
    if (uniformIdx !== undefined) {
      this.freeUniformSlotIdxs.push(uniformIdx)
      this.chunkToUniformIdx.delete(chunkIndex)
    }
    this.slots.remove(chunkIndex)
  }

  // --- Resize / viewport handling ------------------------------------------

  private handleResize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = Math.max(1, Math.floor(cssWidth  * dpr))
    const h = Math.max(1, Math.floor(cssHeight * dpr))
    if (w === this.viewportPixels.w && h === this.viewportPixels.h) return

    this.viewportPixels = { w, h }
    this.ctx.canvas.width  = w
    this.ctx.canvas.height = h

    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()

    // Recreate viewport-sized buffers.
    if (this.depthBuffer) this.depthBuffer.destroy()
    if (this.colorBuffer) this.colorBuffer.destroy()

    const pixelCount = w * h
    const sizeBytes  = pixelCount * 4

    this.depthBuffer = this.device.createBuffer({
      label: 'lazstream/depth',
      size: sizeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.colorBuffer = this.device.createBuffer({
      label: 'lazstream/color',
      size: sizeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.rebuildBindGroups()
    this.writeViewportUniform()
    this.cameraDirty = true
  }

  private rebuildBindGroups(): void {
    this.clearBindGroup = this.device.createBindGroup({
      label: 'lazstream/clear-bg',
      layout: this.clearBindLayout,
      entries: [{ binding: 0, resource: { buffer: this.depthBuffer } }],
    })

    this.depthBindGroup = this.device.createBindGroup({
      label: 'lazstream/depth-bg',
      layout: this.depthBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniform } },
        { binding: 1, resource: { buffer: this.chunkUniform, size: CHUNK_UNIFORM_BYTES } },
        { binding: 2, resource: { buffer: this.ringBuffer } },
        { binding: 3, resource: { buffer: this.depthBuffer } },
        { binding: 4, resource: { buffer: this.colorBuffer } },
      ],
    })

    this.resolveBindGroup = this.device.createBindGroup({
      label: 'lazstream/resolve-bg',
      layout: this.resolveBindLayout,
      entries: [
        { binding: 0, resource: { buffer: this.viewportUniform } },
        { binding: 1, resource: { buffer: this.depthBuffer } },
        { binding: 2, resource: { buffer: this.colorBuffer } },
      ],
    })
  }

  private writeViewportUniform(): void {
    const buf = new ArrayBuffer(VIEWPORT_UNIFORM_BYTES)
    const dv = new DataView(buf)
    dv.setFloat32(0,  this.viewportPixels.w, true)
    dv.setFloat32(4,  this.viewportPixels.h, true)
    dv.setFloat32(8,  this.edlStrength,      true)
    dv.setFloat32(12, this.edlRadius,        true)
    this.device.queue.writeBuffer(this.viewportUniform, 0, buf)
  }

  private writeCameraUniform(): void {
    // Recompute viewProj = projectionMatrix × matrixWorldInverse
    this.camera.updateMatrixWorld()
    this.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)

    const v = this.cameraUniformView
    // mat4x4<f32> at offset 0..63 (16 floats, column-major — Three.js native)
    v.set(this.viewProj.elements, 0)
    // viewportSize: vec2<f32> at offset 64..71
    v[16] = this.viewportPixels.w
    v[17] = this.viewportPixels.h
    // pad at 18, 19
    v[18] = 0; v[19] = 0
    // sceneCenter: vec3<f32> at offset 80..91
    v[20] = this.sceneCenter.x
    v[21] = this.sceneCenter.y
    v[22] = this.sceneCenter.z
    v[23] = 0

    this.device.queue.writeBuffer(this.cameraUniform, 0, v.buffer, v.byteOffset, v.byteLength)
  }

  // --- Frame loop -----------------------------------------------------------

  private renderFrame = (): void => {
    if (this.disposed) return
    this.rafHandle = requestAnimationFrame(this.renderFrame)
    this.currentFrame++

    this.controls.update()
    // Always rewrite camera uniform — cheap, and OrbitControls damping may
    // mutate the camera even when cameraDirty was reset.
    this.writeCameraUniform()
    this.cameraDirty = false

    const encoder = this.device.createCommandEncoder({ label: `lazstream/frame-${this.currentFrame}` })

    // --- Clear depth buffer to 0xFFFFFFFF ---
    {
      const pass = encoder.beginComputePass({ label: 'clear-depth' })
      pass.setPipeline(this.clearPipeline)
      pass.setBindGroup(0, this.clearBindGroup)
      const pixelCount = this.viewportPixels.w * this.viewportPixels.h
      pass.dispatchWorkgroups(Math.ceil(pixelCount / CLEAR_WORKGROUP_SIZE))
      pass.end()
    }

    // --- Compute pass: project + atomicMin per slot ---
    {
      const pass = encoder.beginComputePass({ label: 'points-depth' })
      pass.setPipeline(this.depthPipeline)

      // CPU-side frustum cull (6-plane vs AABB). Skip dispatch AND touch
      // for chunks whose AABB doesn't intersect the actual frustum.
      // Without this, every loaded slot is touched every frame regardless
      // of visibility → LRU eviction impossible → engine back-pressure
      // sees zero free slots forever → no streaming progress on camera
      // movement.
      //
      // Earlier attempt used frustum-AABB vs slot-AABB, which is too
      // loose: with CAMERA_FAR=100 km and 60° FOV, the enclosing AABB
      // is ~115 km wide and contains every chunk in the file. The proper
      // plane-vs-box test from THREE.Frustum handles this correctly —
      // it walks the 6 frustum planes and rejects an AABB only when all
      // 8 corners are on the negative side of any single plane.
      //
      // viewProj already operates in scene-local coords (the shader
      // applies it to worldPos - sceneCenter), so the extracted planes
      // are scene-local. We convert each slot's world AABB to scene-local
      // before testing.
      this.cullFrustum.setFromProjectionMatrix(this.viewProj)
      const cx = this.sceneCenter.x
      const cy = this.sceneCenter.y
      const cz = this.sceneCenter.z

      for (const slot of this.slots.getSlots()) {
        if (slot.pointCount === 0) continue

        // Slot AABB in scene-local coords (slot.min/range are world).
        this.cullSlotBox.min.set(
          slot.min[0] - cx,
          slot.min[1] - cy,
          slot.min[2] - cz,
        )
        this.cullSlotBox.max.set(
          slot.min[0] - cx + slot.range[0],
          slot.min[1] - cy + slot.range[1],
          slot.min[2] - cz + slot.range[2],
        )
        if (!this.cullFrustum.intersectsBox(this.cullSlotBox)) continue

        const uniformIdx = this.chunkToUniformIdx.get(slot.chunkIndex)
        if (uniformIdx === undefined) continue // shouldn't happen
        pass.setBindGroup(0, this.depthBindGroup, [uniformIdx * this.chunkUniformStride])
        pass.dispatchWorkgroups(Math.ceil(slot.pointCount / COMPUTE_WORKGROUP_SIZE))
        // Touch for LRU bookkeeping — this slot was rendered this frame.
        this.slots.touch(slot.chunkIndex, this.currentFrame)
      }
      pass.end()
    }

    // Retry any chunks that arrived from decode but couldn't fit at the time —
    // the compute pass just updated lastRenderedFrame for visible slots, so any
    // slot NOT touched this frame is now LRU-evictable. Allocates them in,
    // evicting stale slots in the process. Cheap when queue is empty.
    this.flushDeferredChunks()

    // --- Resolve pass: fullscreen triangle to canvas texture ---
    {
      const view = this.ctx.context.getCurrentTexture().createView()
      const pass = encoder.beginRenderPass({
        label: 'resolve',
        colorAttachments: [{
          view,
          loadOp:  'clear',
          storeOp: 'store',
          clearValue: { r: 0.04, g: 0.04, b: 0.06, a: 1.0 },
        }],
      })
      pass.setPipeline(this.resolvePipeline)
      pass.setBindGroup(0, this.resolveBindGroup)
      pass.draw(3)
      pass.end()
    }

    this.device.queue.submit([encoder.finish()])

    if (this.onFrame) {
      this.onFrame({
        frame: this.currentFrame,
        slots: this.slots.getSlots().length,
        pointsLoaded: this.slots.pointsLoaded(),
      })
    }
  }
}