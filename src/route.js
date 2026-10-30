/**
 * Static-site route for the bundled Paper Deepread library.
 *
 * Kept in its own standard-library-only module so the HTTP contract can be
 * tested with a throwaway `node:http` server, without booting dsh or resolving
 * the `@deepseek-ai/dsh-tools` peer.
 *
 * @module dsh-paper-deepread/route
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

/** URL prefix owned by the host half. Must match the registered Web route. */
export const ROUTE_PREFIX = '/paper-deepread'

/** Relative index page of the bundled library. */
export const LIBRARY_INDEX = 'index.html'

/** Content types served by the library route. */
const CONTENT_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.gz': 'application/gzip',
}))

/** Documents that must revalidate on every request, because a reload button exists. */
const REVALIDATE = new Set(['.html', '.htm'])

function sendText(res, status, body, extraHeaders = {}) {
  const payload = `${body}\n`
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

/** Content type of one served file. */
export function contentTypeOf(file) {
  return CONTENT_TYPES.get(extname(file).toLowerCase()) ?? 'application/octet-stream'
}

function cacheControlOf(file) {
  return REVALIDATE.has(extname(file).toLowerCase()) ? 'no-cache' : 'public, max-age=3600'
}

/**
 * Create the HTTP handler that serves the bundled library directory.
 *
 * The handler answers `GET` and `HEAD` only, decodes percent-encoded paths
 * (the library uses spaces, `·`, and Chinese characters in file names),
 * resolves the request against `libraryDir`, and rejects any target outside
 * that directory after resolution.
 *
 * @param {string} libraryDir Directory of the static site to serve.
 * @param {{info?: Function, warn?: Function}} [logger] Plugin logger.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createLibraryHandler(libraryDir, logger) {
  const root = resolve(libraryDir)
  return async function libraryHandler(req, res) {
    try {
      const method = req.method || 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        sendText(res, 405, 'Method Not Allowed', { allow: 'GET, HEAD' })
        return
      }
      let pathname
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      } catch {
        sendText(res, 400, 'Bad Request')
        return
      }
      let decoded
      try {
        decoded = decodeURIComponent(pathname)
      } catch {
        sendText(res, 400, 'Bad Request: malformed percent-encoding')
        return
      }
      if (decoded.includes('\0')) {
        sendText(res, 400, 'Bad Request')
        return
      }
      if (decoded !== ROUTE_PREFIX && !decoded.startsWith(`${ROUTE_PREFIX}/`)) {
        sendText(res, 404, 'Not Found')
        return
      }
      let relativePath = decoded.slice(ROUTE_PREFIX.length).replace(/^\/+/u, '')
      if (relativePath === '' || relativePath.endsWith('/')) relativePath += LIBRARY_INDEX
      let target = resolve(root, relativePath)
      if (target !== root && !target.startsWith(`${root}${sep}`)) {
        sendText(res, 403, 'Forbidden')
        return
      }
      let info
      try {
        info = await stat(target)
      } catch {
        sendText(res, 404, 'Not Found')
        return
      }
      if (info.isDirectory()) {
        target = join(target, LIBRARY_INDEX)
        try {
          info = await stat(target)
        } catch {
          sendText(res, 404, 'Not Found')
          return
        }
      }
      if (!info.isFile()) {
        sendText(res, 404, 'Not Found')
        return
      }
      res.writeHead(200, {
        'content-type': contentTypeOf(target),
        'content-length': String(info.size),
        'cache-control': cacheControlOf(target),
        'x-content-type-options': 'nosniff',
        'accept-ranges': 'none',
      })
      if (method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(target)
      stream.on('error', error => {
        logger?.warn?.(`DSH-Paper-DeepRead: failed to stream ${target}: ${String(error?.message || error)}`)
        if (!res.headersSent) sendText(res, 500, 'Internal Server Error')
        else res.destroy(error)
      })
      stream.pipe(res)
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: library route failed: ${String(error?.message || error)}`)
      if (!res.headersSent) sendText(res, 500, 'Internal Server Error')
      else res.destroy()
    }
  }
}

/**
 * Web root of the running Harness, or `null` before the listener binds.
 * @param {object} ctx Plugin context.
 * @returns {string|null} Origin such as `http://127.0.0.1:3080`.
 */
export function webOrigin(ctx) {
  try {
    const origin = ctx.webServer?.getOrigin?.()
    return typeof origin === 'string' && origin ? origin.replace(/\/+$/u, '') : null
  } catch {
    return null
  }
}

/**
 * Absolute (when an origin is known) or relative URL of the library page.
 * @param {object} ctx Plugin context.
 * @returns {string} Browser URL of `library/index.html`.
 */
export function libraryWebUrl(ctx) {
  const origin = webOrigin(ctx)
  return `${origin ?? ''}${ROUTE_PREFIX}/${LIBRARY_INDEX}`
}
