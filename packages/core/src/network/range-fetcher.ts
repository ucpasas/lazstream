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

export class CorsError extends Error {
  constructor(
    public readonly url?: string,
    reason: 'blocked' | 'expose-headers' = 'blocked'
  ) {
    super(
      reason === 'expose-headers'
        ? 'Server does not expose Content-Range — add Access-Control-Expose-Headers: Content-Range, Content-Length to the bucket CORS config'
        : 'Could not reach file — CORS headers are missing. The server must send Access-Control-Allow-Origin and Access-Control-Allow-Headers: Range'
    )
    this.name = 'CorsError'
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
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        // Inclusive range: bytes=start-end fetches end-start+1 bytes
        Range: `bytes=${start}-${end}`,
      },
      cache: 'no-store',
      signal,
    })
  } catch (err) {
    if (err instanceof TypeError) throw new CorsError(url)
    throw err
  }

  if (response.status !== 206 && response.status !== 200) {
    throw new NetworkError(
      `Range request failed with status ${response.status}`,
      response.status,
      url
    )
  }

  // Guard against redirect-based SSRF: if the server redirected us to a
  // different origin, the browser followed silently. Reject if the final
  // URL origin doesn't match the requested URL origin.
  if (response.url && response.url !== url) {
    const requestedOrigin = new URL(url).origin
    const finalOrigin = new URL(response.url).origin
    if (requestedOrigin !== finalOrigin) {
      throw new NetworkError(
        `Blocked cross-origin redirect from "${requestedOrigin}" to "${finalOrigin}".`,
        0,
        url
      )
    }
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
  let headResponse: Response
  try {
    headResponse = await fetch(url, { method: 'HEAD', cache: 'no-store', signal })
  } catch (err) {
    if (err instanceof TypeError) throw new CorsError(url)
    throw err
  }

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

  // Step 2: If header is missing or uncertain, verify with an actual range request.
  // Fetch bytes 0–0 (1 byte) — minimal cost, definitive answer.
  // Also confirms Content-Range is exposed (required for file size on range responses).
  if (!headerSaysRanges) {
    let rangeResponse: Response
    try {
      rangeResponse = await fetch(url, {
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
        signal,
      })
    } catch (err) {
      if (err instanceof TypeError) throw new CorsError(url)
      throw err
    }

    if (rangeResponse.status === 206) {
      if (fileSize === 0) {
        // No Content-Length from HEAD — need Content-Range to get file size.
        // Requires Access-Control-Expose-Headers: Content-Range on the server.
        const contentRange = rangeResponse.headers.get('Content-Range')
        if (!contentRange) {
          throw new CorsError(url, 'expose-headers')
        }
        // Content-Range format: "bytes 0-0/TOTAL"
        const match = contentRange.match(/\/(\d+)$/)
        if (match) fileSize = parseInt(match[1], 10)
      }
      return { fileSize, supportsRange: true }
    }

    // Server returned something other than 206 — range not supported
    return { fileSize, supportsRange: false }
  }

  return { fileSize, supportsRange: true }
}
