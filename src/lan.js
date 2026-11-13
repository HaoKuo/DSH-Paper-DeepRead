/**
 * Read-only LAN fallback server for 手机访问 (mobile access).
 *
 * The standalone Paper Deepread site (`config.siteUrl`) is the preferred phone
 * target. Plugin-only users have no site yet, so this module lazily starts a
 * tiny `node:http` server that serves the managed 文献精读库 on `0.0.0.0` and
 * reuses the exact same static handler as the DSH Web route (`src/route.js`):
 * the handler only accepts paths under `/paper-deepread`, so the incoming
 * request URL is rewritten to `/paper-deepread<pathname>` before the hand-off.
 *
 * It is read-only by construction: `createLibraryHandler` without an API
 * handler answers GET/HEAD static files only, everything else is 404/405.
 * The bound port is persisted in `lan-server.json` so the same LAN URL keeps
 * working across plugin activations when the port is still free.
 *
 * @module dsh-paper-deepread/lan
 */

import { createServer } from 'node:http'
import { readJsonFile, atomicWriteJson } from './store.js'
import { createLibraryHandler, ROUTE_PREFIX } from './route.js'

/** JSON state file (under `<dataDir>`) recording the bound port. */
export const LAN_STATE_FILE = 'lan-server.json'

/** Host the fallback server binds to, so phones on the same network can reach it. */
export const LAN_BIND_HOST = '0.0.0.0'

/** Host used in the URL returned to the plugin itself (it runs on this machine). */
export const LAN_LOCAL_HOST = '127.0.0.1'

/** Normalize a configured port; anything invalid becomes an ephemeral port. */
function normalizePort(value) {
  const number = Number(value)
  return Number.isInteger(number) && number >= 1 && number <= 65535 ? number : 0
}

/**
 * Create the lazy LAN fallback server for one plugin activation.
 *
 * @param {object} options
 * @param {string} options.libraryDir Managed 文献精读库 root to serve.
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @param {number} [options.port] Preferred port; `0` means ephemeral (default).
 * @param {string} [options.stateFile] JSON file remembering the previously bound port.
 * @returns {{ensure: () => Promise<{url: string, port: number, started: boolean}>,
 *   stop: () => Promise<void>}} Lazy server handle.
 */
export function createLanServer(options = {}) {
  const { libraryDir, logger, port = 0, stateFile } = options
  const preferredPort = normalizePort(port)
  const statePath = typeof stateFile === 'string' && stateFile ? stateFile : null
  const libraryHandler = createLibraryHandler(libraryDir, logger)

  let server = null
  let boundPort = 0

  /** Port remembered from the previous activation, when it is still usable. */
  function persistedPort() {
    if (!statePath) return 0
    const state = readJsonFile(statePath, null)
    if (!state || typeof state !== 'object' || Array.isArray(state)) return 0
    return normalizePort(state.port)
  }

  function persistPort(value) {
    if (!statePath) return
    try {
      atomicWriteJson(statePath, { port: value, updatedAt: new Date().toISOString() })
    } catch (writeError) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not persist the LAN fallback port: ${String(writeError?.message || writeError)}`)
    }
  }

  /** Rewrite the request URL into the `/paper-deepread` prefix of route.js. */
  function handleRequest(req, res) {
    let pathname = '/'
    try {
      pathname = new URL(typeof req.url === 'string' && req.url ? req.url : '/', 'http://localhost').pathname
    } catch {
      pathname = '/'
    }
    req.url = `${ROUTE_PREFIX}${pathname}`
    return libraryHandler(req, res)
  }

  function listenOn(candidate) {
    return new Promise((resolve, reject) => {
      const instance = createServer((req, res) => {
        handleRequest(req, res).catch(error => {
          libraryHandlerWarn(error)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('Internal Server Error\n')
          } else {
            res.destroy()
          }
        })
      })
      const onError = error => {
        instance.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        instance.removeListener('error', onError)
        resolve(instance)
      }
      instance.once('error', onError)
      instance.once('listening', onListening)
      instance.listen(candidate, LAN_BIND_HOST)
    })
  }

  function libraryHandlerWarn(error) {
    logger?.warn?.(`DSH-Paper-DeepRead: LAN fallback request failed: ${String(error?.message || error)}`)
  }

  /**
   * Start the server if it is not running yet (idempotent).
   * @returns {Promise<{url: string, port: number, started: boolean}>} Bound address.
   */
  async function ensure() {
    if (server) return { url: `http://${LAN_LOCAL_HOST}:${boundPort}/`, port: boundPort, started: false }
    const candidates = []
    if (preferredPort) candidates.push(preferredPort)
    if (!preferredPort) {
      const remembered = persistedPort()
      if (remembered) candidates.push(remembered)
    }
    candidates.push(0)
    let lastError = null
    for (const candidate of [...new Set(candidates)]) {
      try {
        const instance = await listenOn(candidate)
        server = instance
        const address = instance.address()
        boundPort = address && typeof address === 'object' ? address.port : 0
        instance.on('error', error => libraryHandlerWarn(error))
        persistPort(boundPort)
        logger?.info?.(`DSH-Paper-DeepRead: LAN fallback server listening on ${LAN_BIND_HOST}:${boundPort}`)
        return { url: `http://${LAN_LOCAL_HOST}:${boundPort}/`, port: boundPort, started: true }
      } catch (error) {
        lastError = error
        if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error
      }
    }
    throw lastError ?? new Error('could not start the LAN fallback server')
  }

  /** Stop the server started by this handle (no-op when it never started). */
  async function stop() {
    const instance = server
    if (!instance) return
    server = null
    boundPort = 0
    await new Promise(resolve => {
      instance.close(() => resolve())
      // Static file consumers (browsers, phone) may hold keep-alive sockets;
      // release them so disposal cannot hang.
      instance.closeIdleConnections?.()
      instance.closeAllConnections?.()
    })
  }

  return { ensure, stop }
}
