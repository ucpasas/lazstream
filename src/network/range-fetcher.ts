/**
 * HTTP Range request fetcher
 * Abstracts byte-range reads from cloud storage
 */

export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string
  ) {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Fetch a specific byte range from a URL.
 * Returns the raw ArrayBuffer for that range.
 */
export async function fetchRange(
  url: string,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      // Inclusive range: bytes=start-end fetches end-start+1 bytes
      Range: `bytes=${start}-${end}`,
    },
    cache: 'no-store',
    signal,
  })

  if (response.status !== 206 && response.status !== 200) {
    throw new NetworkError(
      `Range request failed with status ${response.status}`,
      response.status,
      url
    )
  }

  return response.arrayBuffer()
}

/**
 * Fetch from a byte offset to the end of file.
 * Used for the chunk table (at EOF).
 */
export async function fetchFromOffset(
  url: string,
  start: number
): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-`,
    },
    cache: 'no-store', 
  })

  if (response.status !== 206 && response.status !== 200) {
    throw new NetworkError(
      `Range request failed with status ${response.status}`,
      response.status,
      url
    )
  }

  return response.arrayBuffer()
}

/**
 * Fetch the last N bytes of a file.
 * Used for speculative chunk table read.
 */
export async function fetchTail(
  url: string,
  bytes: number
): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=-${bytes}`,
    },
    cache: 'no-store', 
  })

  if (response.status !== 206 && response.status !== 200) {
    throw new NetworkError(
      `Tail fetch failed with status ${response.status}`,
      response.status,
      url
    )
  }

  return response.arrayBuffer()
}

/**
 * Probe a URL to get file size and confirm Range support.
 *
 * Strategy:
 * 1. HEAD request to get Content-Length and check Accept-Ranges header
 * 2. If Accept-Ranges header is missing or ambiguous, verify by issuing
 *    a small GET range request and checking for a 206 response.
 *
 * Why not rely on Accept-Ranges alone:
 * Some servers (including Cloudflare R2 r2.dev) honour Range requests
 * but do not include Accept-Ranges in HEAD responses. The only reliable
 * way to confirm range support is to actually attempt one.
 */
export async function probeUrl(url: string, signal?: AbortSignal): Promise<{
  fileSize: number
  supportsRange: boolean
}> {
  // Step 1: HEAD request for file size
  const headResponse = await fetch(url, { method: 'HEAD', cache: 'no-store', signal })

  if (!headResponse.ok) {
    throw new NetworkError(
      `File not accessible (HTTP ${headResponse.status}). ` +
      `Check that the file is publicly accessible and CORS is enabled.`,
      headResponse.status,
      url
    )
  }

  // Try to get file size from Content-Length
  const contentLengthHeader = headResponse.headers.get('Content-Length')
  let fileSize = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0

  // Check Accept-Ranges header — present on most S3/Azure/GCS responses
  const acceptRanges = headResponse.headers.get('Accept-Ranges')
  const headerSaysRanges = acceptRanges === 'bytes'

  // Step 2: If header is missing or uncertain, verify with an actual range request
  // Fetch bytes 0–0 (1 byte) — minimal cost, definitive answer
  if (!headerSaysRanges) {
    const rangeResponse = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store',
      signal,
    })

    if (rangeResponse.status === 206) {
      // Server confirmed range support via actual 206 response
      // Also extract file size from Content-Range if we didn't get it from HEAD
      // Content-Range format: "bytes 0-0/TOTAL"
      if (fileSize === 0) {
        const contentRange = rangeResponse.headers.get('Content-Range')
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/)
          if (match) fileSize = parseInt(match[1], 10)
        }
      }
      return { fileSize, supportsRange: true }
    }

    // Server returned something other than 206 — range not supported
    return { fileSize, supportsRange: false }
  }

  return { fileSize, supportsRange: true }
}