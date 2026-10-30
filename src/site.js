/**
 * Optional integration with a standalone Paper Deepread site (the
 * `deploy/serve.py` server behind `http://127.0.0.1:8080`).
 *
 * When `siteUrl` is configured the plugin panel can hand PDFs to that site's
 * upload queue instead of (or beside) the plugin's own inbox: the site's worker
 * runs the deep-read pipeline unattended and publishes the result to its
 * library. The plugin only proxies two calls, because the site API is
 * same-origin-only by design and the browser panel lives on the Harness origin:
 *
 *   GET  <siteUrl>/api/health  -> plugin `GET /paper-deepread/api/site/health`
 *   POST <siteUrl>/api/upload  -> plugin `POST /paper-deepread/api/site/upload`
 *
 * The upload proxy forwards the raw body with `X-Filename`, `Content-Type`, and
 * (when the browser sends it) `X-KB-Upload-Token`, then returns the site JSON
 * verbatim, so duplicate/possible-duplicate/429/401 payloads keep their exact
 * semantics. Health is cached for 5 s to keep panel polling cheap.
 *
 * No site credential is stored in the plugin config: the optional upload token
 * is supplied per request by the browser and only forwarded.
 *
 * @module dsh-paper-deepread/site
 */

import { StoreError } from './store.js'
import { readRequestBody } from './uploads.js'

/** Health request timeout. */
export const SITE_HEALTH_TIMEOUT_MS = 5_000

/** Upload proxy timeout (large PDFs over a slow link). */
export const SITE_UPLOAD_TIMEOUT_MS = 120_000

/** How long one health result is reused. */
export const SITE_HEALTH_CACHE_MS = 5_000

/**
 * Upper bound for one proxied upload body. The site keeps its own limit (80 MB
 * by default, `KB_MAX_UPLOAD_MB`); this only protects the plugin process from
 * buffering an unbounded body.
 */
export const SITE_MAX_UPLOAD_BYTES = 160 * 1024 * 1024

/** Header the standalone site uses for its optional upload token. */
export const SITE_UPLOAD_TOKEN_HEADER = 'x-kb-upload-token'

/**
 * Normalize the configured site URL.
 *
 * Returns `''` for an empty/unset value and for anything that is not an
 * absolute `http(s)` URL. A path prefix is preserved (`http://host/kb`), but
 * trailing slashes, query, and fragment are dropped.
 *
 * @param {unknown} value Configured `siteUrl`.
 * @returns {string} Canonical base URL, or `''`.
 */
export function normalizeSiteUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  let url
  try {
    url = new URL(trimmed)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  if (!url.hostname) return ''
  url.search = ''
  url.hash = ''
  const href = url.href.replace(/\/+$/u, '')
  return href === url.origin ? url.origin : href
}

/** Whether an error came from aborting a fetch (timeout). */
function isTimeout(error) {
  const name = error?.name || ''
  return name === 'TimeoutError' || name === 'AbortError' || /timed out|timeout/iu.test(String(error?.message || ''))
}

/** JSON-safe error body for a failed proxied call. */
function failed(code, message) {
  return { ok: false, error: { code, message: String(message).slice(0, 500) } }
}

/**
 * Create the site proxy for one plugin activation.
 *
 * @param {object} options
 * @param {string} [options.siteUrl] Configured site base URL (may be invalid/empty).
 * @param {number} [options.maxUploadBytes] Proxied body cap.
 * @param {number} [options.healthCacheMs] Health cache lifetime.
 * @param {Function} [options.fetchImpl] `fetch` override for tests.
 * @param {() => number} [options.now] Clock override for tests.
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @returns {object} Proxy with `configured`, `url`, `describe()`, `health()`, `upload()`.
 */
export function createSiteProxy(options = {}) {
  const { logger } = options
  const rawUrl = typeof options.siteUrl === 'string' ? options.siteUrl.trim() : ''
  const url = normalizeSiteUrl(rawUrl)
  const configured = Boolean(url)
  if (rawUrl && !configured) {
    logger?.warn?.(`DSH-Paper-DeepRead: ignoring invalid siteUrl ${JSON.stringify(rawUrl)} (expected an absolute http(s) URL)`)
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = typeof options.now === 'function' ? options.now : Date.now
  const healthCacheMs = Number.isFinite(options.healthCacheMs) ? options.healthCacheMs : SITE_HEALTH_CACHE_MS
  const maxUploadBytes = Number.isFinite(options.maxUploadBytes) && options.maxUploadBytes > 0
    ? options.maxUploadBytes
    : SITE_MAX_UPLOAD_BYTES
  let cachedHealth = null

  /** JSON-safe configuration summary for `/state` and tool output. */
  function describe() {
    return { configured, url: configured ? url : '' }
  }

  /** Wrap a fetch/parse failure into the health payload shape. */
  function healthFailure(code, message, extra = {}) {
    return { configured: true, url, ok: false, ...failed(code, message), ...extra }
  }

  /**
   * Fetch `<siteUrl>/api/health`, cached for a few seconds.
   * Never throws: reachability failures are returned as `{ok:false,error}`.
   * @returns {Promise<object>} JSON-safe health payload.
   */
  async function health() {
    if (!configured) return { configured: false }
    const stamp = now()
    if (cachedHealth && stamp - cachedHealth.at < healthCacheMs) return { ...cachedHealth.payload }
    let payload
    if (typeof fetchImpl !== 'function') {
      payload = healthFailure('SITE_UNREACHABLE', 'fetch is unavailable in this Node runtime')
    } else {
      try {
        const response = await fetchImpl(`${url}/api/health`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(SITE_HEALTH_TIMEOUT_MS),
        })
        const text = await response.text()
        let body = null
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          payload = healthFailure('SITE_BAD_RESPONSE', `site health returned no JSON (HTTP ${response.status})`, { status: response.status })
        } else if (!response.ok) {
          payload = { ...healthFailure('SITE_HEALTH_FAILED', `site health returned HTTP ${response.status}`, { status: response.status }), ...body }
        } else {
          payload = { ...body, configured: true, url, ok: body.ok !== false, checkedAt: new Date(stamp).toISOString() }
        }
      } catch (error) {
        payload = isTimeout(error)
          ? healthFailure('SITE_TIMEOUT', `site health timed out after ${SITE_HEALTH_TIMEOUT_MS} ms`)
          : healthFailure('SITE_UNREACHABLE', `site health request failed: ${String(error?.message || error)}`)
      }
    }
    cachedHealth = { at: stamp, payload }
    return { ...payload }
  }

  /**
   * Proxy one raw PDF upload to `<siteUrl>/api/upload`.
   *
   * Reads the incoming request body with the configured cap, forwards the
   * filename/content-type/optional upload token, and returns the site response
   * verbatim (status, content type, bytes).
   *
   * @param {object} request
   * @param {import('node:http').IncomingMessage} request.req Incoming plugin request.
   * @returns {Promise<{status: number, contentType: string, body: Buffer}>} Proxied response.
   * @throws {StoreError} `SITE_NOT_CONFIGURED`, `SITE_TIMEOUT`, `SITE_UNREACHABLE`,
   *   `PAYLOAD_TOO_LARGE`, or `BAD_BODY`.
   */
  async function upload({ req }) {
    if (!configured) throw new StoreError('SITE_NOT_CONFIGURED', 'siteUrl is not configured')
    if (typeof fetchImpl !== 'function') throw new StoreError('SITE_UNREACHABLE', 'fetch is unavailable in this Node runtime')
    const body = await readRequestBody(req, maxUploadBytes)
    const headers = {}
    const fileName = req.headers['x-filename']
    if (typeof fileName === 'string' && fileName) headers['x-filename'] = fileName
    const contentType = req.headers['content-type']
    if (typeof contentType === 'string' && contentType) headers['content-type'] = contentType
    const token = req.headers[SITE_UPLOAD_TOKEN_HEADER]
    if (typeof token === 'string' && token) headers[SITE_UPLOAD_TOKEN_HEADER] = token
    let response
    try {
      response = await fetchImpl(`${url}/api/upload`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(SITE_UPLOAD_TIMEOUT_MS),
      })
    } catch (error) {
      if (isTimeout(error)) {
        throw new StoreError('SITE_TIMEOUT', `site upload timed out after ${Math.round(SITE_UPLOAD_TIMEOUT_MS / 1000)} s`)
      }
      throw new StoreError('SITE_UNREACHABLE', `site upload request failed: ${String(error?.message || error)}`)
    }
    let bytes
    try {
      bytes = Buffer.from(await response.arrayBuffer())
    } catch (error) {
      throw new StoreError('SITE_BAD_RESPONSE', `could not read the site response: ${String(error?.message || error)}`)
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json; charset=utf-8',
      body: bytes,
    }
  }

  return { configured, url: configured ? url : '', describe, health, upload }
}
