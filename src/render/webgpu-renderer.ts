/**
 * WebGPURenderer — Phase 2 Track B
 *
 * Drop-in replacement for the Track A WebGL validation renderer. Public
 * interface matches: loadSeedPoints, addDecodedChunk, getCameraWorldPosition,
 * getSceneCenter, dispose.
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

// --- Constants ---------------------------------------------------------------

const SEED_PSEUDO_CHUNK_INDEX = -1
const SEED_HIDE_THRESHOLD     = 10            // hide seeds once N real chunks load
const MAX_SLOTS               = 4096          // upper bound on simultaneous chunks
const COMPUTE_WORKGROUP_SIZE  = 128
const CLEAR_WORKGROUP_SIZE    = 256
const MAX_DPR                 = 2.0           // clamp devicePixelRatio
const CAMERA_FOV              = 60
const CAMERA_NEAR             = 0.1
const CAMERA_FAR              = 100_000

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
    const ctx = await createWebGPUContext(canvas)
    return new WebGPURenderer(ctx, options)
  }

  // --- Public API -----------------------------------------------------------

  loadSeedPoints(seeds: SeedPoint[]): void {
    if (this.disposed) return

    const packed = packSeedsAsChunk(seeds)
    if (packed.pointCount === 0) return

    // Set sceneCenter from seed bbox so all downstream math is scene-local.
    // (This may be called before any real chunks arrive — that's the point.)
    this.sceneCenter.x = packed.min[0] + packed.range[0] / 2
    this.sceneCenter.y = packed.min[1] + packed.range[1] / 2
    this.sceneCenter.z = packed.min[2] + packed.range[2] / 2

    // Fit camera to seed bbox. Diagonal × 1.2 gives generous framing.
    const diag = Math.hypot(packed.range[0], packed.range[1], packed.range[2])
    const dist = Math.max(diag * 1.2, 100)
    // Aerial-ish initial view: camera up and a bit south, looking down at origin.
    this.camera.position.set(0, -dist * 0.6, dist * 0.7)
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

    const ok = this.addPackedData(chunk.chunkIndex, packed, chunk.pointCount, min, range)
    if (!ok) return

    // Once enough real chunks have landed, evict the seed pseudo-chunk so it
    // doesn't compete with the higher-quality decoded points.
    this.realChunkCount++
    if (this.realChunkCount === SEED_HIDE_THRESHOLD) {
      this.releaseSlot(SEED_PSEUDO_CHUNK_INDEX)
    }
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
      console.warn(`[webgpu] ring buffer can't fit chunk ${chunkIndex} (${byteLength} B) — dropped`)
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
      for (const slot of this.slots.getSlots()) {
        if (slot.pointCount === 0) continue
        const uniformIdx = this.chunkToUniformIdx.get(slot.chunkIndex)
        if (uniformIdx === undefined) continue // shouldn't happen
        pass.setBindGroup(0, this.depthBindGroup, [uniformIdx * this.chunkUniformStride])
        pass.dispatchWorkgroups(Math.ceil(slot.pointCount / COMPUTE_WORKGROUP_SIZE))
        // Touch for LRU bookkeeping — this slot was rendered this frame.
        this.slots.touch(slot.chunkIndex, this.currentFrame)
      }
      pass.end()
    }

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