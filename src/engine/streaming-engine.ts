/**
 * Streaming Engine — Phase 1
 *
 * Orchestrates the full pipeline:
 *   URL → probe → header → chunk table → seed points → renderer
 *
 * Emits events at each stage so the UI can update progressively.
 */

import type { LasHeader, LazVlr, ChunkTableEntry, SeedPoint } from '../types/las.js'
import { classifyLazVersion, getLazVersionWarning } from '../types/las.js'
import { validateSourceUrl } from '../network/url-validator.js'
import { probeUrl } from '../network/range-fetcher.js'
import { fetchAndParseLasHeader, ParseError } from '../engine/header-parser.js'
import { fetchChunkTable, fetchSeedPoints } from '../engine/chunk-table.js'

export type LoadState =
  | 'idle'
  | 'probing'       // HEAD request to check file accessibility
  | 'header'        // Fetching + parsing LAS header
  | 'chunk-table'   // Fetching + parsing chunk table
  | 'seeds'         // Fetching seed points
  | 'ready'         // Seed points rendered, ready for interaction
  | 'error'

export interface EngineEvents {
  onStateChange?: (state: LoadState, message: string) => void
  onWarning?: (message: string) => void
  onSeedsReady?: (seeds: SeedPoint[], header: LasHeader) => void
  onProgress?: (loaded: number, total: number, phase: string) => void
  onError?: (error: Error) => void
  onStats?: (stats: {
    fileSize: number
    pointCount: number
    chunkCount: number
    version: string
    format: number
  }) => void
}

export class StreamingEngine {
  private events: EngineEvents

  constructor(events: EngineEvents = {}) {
    this.events = events
  }

  async load(rawUrl: string): Promise<void> {
    try {
      // Stage 1: Validate URL
      this.emit('probing', 'Validating URL...')
      const url = validateSourceUrl(rawUrl)

      // Stage 2: Probe — HEAD request
      this.emit('probing', 'Checking file accessibility...')
      const { fileSize, supportsRange } = await probeUrl(url.toString())

      if (!supportsRange) {
        throw new Error(
          'This server does not support HTTP Range requests. ' +
          'lazstream requires Range support to stream point clouds. ' +
          'Try serving the file from S3, R2, or Azure Blob Storage.'
        )
      }

      if (fileSize === 0) {
        throw new Error(
          'Could not determine file size. ' +
          'The server did not return a Content-Length header.'
        )
      }

      // Stage 3: Fetch + parse LAS header and LAZ VLR
      this.emit('header', 'Reading file header...')
      const { header, lazVlr } = await fetchAndParseLasHeader(url.toString())

      // Classify the LAZ version and warn if degraded
      const lazVersion = classifyLazVersion(header, lazVlr)
      const warning = getLazVersionWarning(lazVersion)
      if (warning) {
        this.events.onWarning?.(warning)
      }

      if (lazVersion === 'unsupported') {
        throw new ParseError(
          'This file cannot be displayed. lazstream requires LAZ 1.2–1.4 compressed files.'
        )
      }

      // Emit file stats
      this.events.onStats?.({
        fileSize,
        pointCount: header.pointCount,
        chunkCount: 0,  // Will update after chunk table
        version: `LAS ${header.versionMajor}.${header.versionMinor} (${lazVersion})`,
        format: header.pointDataRecordFormat,
      })

      // Stage 4: Fetch chunk table
      this.emit('chunk-table', 'Reading chunk index...')
      const chunks = await fetchChunkTable(
        url.toString(),
        header,
        lazVlr,
        fileSize
      )

      // Update stats with actual chunk count
      this.events.onStats?.({
        fileSize,
        pointCount: header.pointCount,
        chunkCount: chunks.length,
        version: `LAS ${header.versionMajor}.${header.versionMinor} (${lazVersion})`,
        format: header.pointDataRecordFormat,
      })

      // Stage 5: Fetch seed points (LidarScout technique)
      this.emit('seeds', `Fetching ${chunks.length} chunk seed points...`)
      const seeds = await fetchSeedPoints(
        url.toString(),
        chunks,
        header,
        lazVlr,
        (loaded, total) => {
          this.events.onProgress?.(loaded, total, 'seeds')
        }
      )

      // Stage 6: Ready
      this.emit('ready', `Overview ready — ${seeds.length} seed points from ${chunks.length} chunks`)
      this.events.onSeedsReady?.(seeds, header)

    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.events.onStateChange?.('error', error.message)
      this.events.onError?.(error)
    }
  }

  private emit(state: LoadState, message: string): void {
    this.events.onStateChange?.(state, message)
  }
}