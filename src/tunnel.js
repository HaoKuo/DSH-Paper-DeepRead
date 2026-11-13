/**
 * Optional Cloudflare quick-tunnel manager for 手机访问 (mobile access).
 *
 * A quick tunnel is a short-lived public URL in front of the loopback target
 * that the plugin already serves:
 *
 *   cloudflared tunnel --url <targetUrl> --no-autoupdate
 *   -> https://<random-words>.trycloudflare.com
 *
 * The tunnel is strictly opt-in: nothing here runs until the browser panel asks
 * for it. This module owns the child process, the URL discovery (cloudflared
 * prints the URL on stderr after its `quick Tunnel has been created` banner), a
 * small `off | starting | running | error` state machine with a start timeout,
 * a persisted snapshot (`tunnel.json`), and disposal that never leaves an
 * orphan child behind. `spawn` is injectable so the whole state machine is
 * testable without a real cloudflared binary or network access.
 *
 * Quick-tunnel creation can fail (`failed to request quick Tunnel: Post
 * "https://api.trycloudflare.com/tunnel": ...`); such output is reported as
 * `status:'error'` with cloudflared's message and resolves the pending start
 * immediately, never as a running tunnel with the API host as its URL.
 *
 * Proxy escape hatch: cloudflared is a Go program and ignores the macOS system
 * proxy, so on Macs behind a transparent/system proxy (e.g. ClashX) quick
 * tunnel creation times out. When `proxy` is configured the child is spawned
 * with `HTTPS_PROXY`/`HTTP_PROXY` set to it; when unset the child simply
 * inherits the plugin process environment.
 *
 * @module dsh-paper-deepread/tunnel
 */

import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { atomicWriteJson } from './store.js'

/** Default time budget for cloudflared to print its public URL. */
export const TUNNEL_START_TIMEOUT_MS = 25_000

/** Grace period between SIGTERM and the forced SIGKILL. */
export const TUNNEL_KILL_GRACE_MS = 3_000

/**
 * Public quick-tunnel URL emitted by cloudflared.
 *
 * Quick-tunnel hostnames are multi-word (e.g.
 * `middle-june-streets-showed.trycloudflare.com`), so the host label must
 * contain at least one hyphen. Cloudflare infrastructure hosts that also live
 * under `trycloudflare.com` (`api`, `www`, `update`, `pkg`) must never match:
 * cloudflared error output contains
 * `Post "https://api.trycloudflare.com/tunnel": ...` and treating that as the
 * tunnel URL would make the panel show a dead QR code.
 */
export const TUNNEL_URL_RE = /https:\/\/(?!api\.|www\.|update\.|pkg\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/u

/** Banner marker cloudflared prints once the quick tunnel exists. */
export const TUNNEL_CREATED_MARKER = /quick tunnel has been created/iu

/** Error marker cloudflared prints when quick-tunnel creation fails. */
export const TUNNEL_FAILED_MARKER = /failed to request quick tunnel/iu

/** Absolute locations where Homebrew installs `cloudflared` on macOS. */
export const CLOUDFLARED_HOME_PATHS = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']

/** Expand a leading `~` in a user-configured path. */
function expandHome(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}

/** Whether `file` exists and is a regular file. */
function isExecutableFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Locate the `cloudflared` binary.
 *
 * Candidates are checked in order, first existing file wins:
 *
 *   1. `options.path` (the `cloudflaredPath` row config);
 *   2. `$CLOUDFLARED_BIN` from the environment;
 *   3. `/opt/homebrew/bin/cloudflared` and `/usr/local/bin/cloudflared`;
 *   4. `<dir>/cloudflared` for every directory on `$PATH`.
 *
 * @param {object} [options]
 * @param {string} [options.path] Explicit path from plugin config.
 * @param {object} [options.env] Environment override (tests).
 * @param {(file: string) => boolean} [options.existsImpl] Existence check override (tests).
 * @returns {string|null} Absolute binary path, or `null` when it is not installed.
 */
export function findCloudflared(options = {}) {
  const env = options.env ?? process.env
  const exists = typeof options.existsImpl === 'function' ? options.existsImpl : isExecutableFile
  const candidates = []
  const add = value => {
    if (typeof value !== 'string') return
    const trimmed = expandHome(value.trim())
    if (trimmed) candidates.push(trimmed)
  }
  add(options.path)
  add(env.CLOUDFLARED_BIN)
  for (const candidate of CLOUDFLARED_HOME_PATHS) add(candidate)
  const pathValue = typeof env.PATH === 'string' ? env.PATH : ''
  for (const directory of pathValue.split(delimiter)) {
    if (directory) add(join(directory, 'cloudflared'))
  }
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    try {
      if (exists(candidate)) return candidate
    } catch {
      // A broken existence check must not abort detection.
    }
  }
  return null
}

/**
 * Extract the first quick-tunnel URL from a chunk of process output.
 *
 * Only real quick-tunnel hostnames match: multi-word labels with a hyphen and
 * no Cloudflare infrastructure prefix (`api.`, `www.`, `update.`, `pkg.`).
 *
 * @param {unknown} text stdout/stderr text.
 * @returns {string|null} Matching URL.
 */
export function findTunnelUrl(text) {
  if (typeof text !== 'string') return null
  const match = TUNNEL_URL_RE.exec(text)
  return match ? match[0] : null
}

/**
 * Trim cloudflared's `<ISO timestamp> <LEVEL>` prefix from one output line.
 * @param {string} line Raw cloudflared stderr line.
 * @returns {string} Human-readable message.
 */
function trimCloudflaredLine(line) {
  return line
    .trim()
    .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+(?:TRC|DBG|INF|WRN|ERR|FTL)\s+/u, '')
    .trim()
}

/**
 * Last `failed to request quick Tunnel` message in the accumulated output.
 * @param {string} output Accumulated stdout+stderr text.
 * @returns {string|null} Trimmed failure message for the panel, or `null`.
 */
export function findTunnelFailure(output) {
  if (typeof output !== 'string' || !output) return null
  let found = null
  for (const line of output.split(/\r?\n/u)) {
    if (TUNNEL_FAILED_MARKER.test(line)) found = line
  }
  if (found === null) return null
  const trimmed = trimCloudflaredLine(found).slice(0, 800)
  return trimmed || 'failed to request quick Tunnel'
}

/** Convert a stdout/stderr chunk to text. */
function chunkText(chunk) {
  if (typeof chunk === 'string') return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString('utf8')
  return String(chunk ?? '')
}

/** Unref'd timer helper: never keeps the plugin process alive. */
function unrefTimeout(fn, ms) {
  const timer = setTimeout(fn, ms)
  timer.unref?.()
  return timer
}

/**
 * Create the Cloudflare quick-tunnel manager for one plugin activation.
 *
 * All methods are safe to call from HTTP handlers: they never throw for
 * expected process failures (a failed start resolves with `status:'error'`).
 *
 * @param {object} options
 * @param {string} options.targetUrl Loopback base URL the tunnel forwards to.
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @param {string|null} [options.bin] Detected `cloudflared` path, or `null`.
 * @param {Function} [options.spawnImpl] `child_process.spawn` override (tests).
 * @param {string} [options.stateFile] JSON snapshot path (`<dataDir>/tunnel.json`).
 * @param {number} [options.startTimeoutMs] Time budget for URL discovery.
 * @param {number} [options.killGraceMs] Delay before the forced SIGKILL.
 * @param {string} [options.proxy] Optional HTTP(S) proxy for cloudflared
 *   (`config.cloudflaredProxy`): when set, the child gets `HTTPS_PROXY` and
 *   `HTTP_PROXY`; when empty the child inherits the plugin environment.
 * @returns {object} Tunnel manager with `state`, `start`, `stop`, `refresh`, `dispose`.
 */
export function createTunnel(options = {}) {
  const {
    targetUrl = '',
    logger,
    bin = null,
    spawnImpl = nodeSpawn,
    stateFile = null,
    startTimeoutMs = TUNNEL_START_TIMEOUT_MS,
    killGraceMs = TUNNEL_KILL_GRACE_MS,
    proxy = '',
  } = options
  const available = typeof bin === 'string' && bin.trim().length > 0
  const binary = available ? bin.trim() : null
  const target = typeof targetUrl === 'string' ? targetUrl : ''
  const statePath = typeof stateFile === 'string' && stateFile ? stateFile : null
  const graceMs = Number.isFinite(killGraceMs) && killGraceMs >= 0 ? killGraceMs : TUNNEL_KILL_GRACE_MS
  const timeoutMs = Number.isFinite(startTimeoutMs) && startTimeoutMs > 0 ? startTimeoutMs : TUNNEL_START_TIMEOUT_MS
  const proxyUrl = typeof proxy === 'string' ? proxy.trim() : ''

  let status = 'off'
  let url = null
  let error = null
  let child = null
  let disposed = false
  let stopping = false
  let startTimer = null
  let settleStart = null
  let startPromise = null
  let output = ''
  /** Resolvers waiting for the current child to exit. */
  const exitWaiters = []

  /** Fresh JSON-safe state snapshot. */
  function state() {
    return {
      available,
      status,
      url: url ?? null,
      target,
      error: error ?? null,
      binary,
    }
  }

  /** Write the current state snapshot to `stateFile` (best effort). */
  function persist() {
    if (!statePath) return
    try {
      atomicWriteJson(statePath, { ...state(), updatedAt: new Date().toISOString() })
    } catch (writeError) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not persist tunnel state: ${String(writeError?.message || writeError)}`)
    }
  }

  function clearStartTimer() {
    if (startTimer) {
      clearTimeout(startTimer)
      startTimer = null
    }
  }

  function notifyExit() {
    for (const resolve of exitWaiters.splice(0)) resolve()
  }

  /** Resolve the pending `start()` promise, if any. */
  function finishStart() {
    clearStartTimer()
    const resolve = settleStart
    settleStart = null
    startPromise = null
    if (resolve) resolve(state())
  }

  /** Drop data listeners so a finished child cannot emit into the manager. */
  function detachChild(proc) {
    try {
      proc.stdout?.removeAllListeners?.('data')
      proc.stderr?.removeAllListeners?.('data')
    } catch {
      // A fake/foreign child may not implement EventEmitter removal.
    }
  }

  function terminate(proc) {
    try {
      proc?.kill?.('SIGTERM')
    } catch {
      // Already gone.
    }
    unrefTimeout(() => {
      try {
        proc?.kill?.('SIGKILL')
      } catch {
        // Already gone.
      }
    }, graceMs)
  }

  function onData(proc, chunk) {
    if (disposed || child !== proc || status !== 'starting') return
    output = `${output}${chunkText(chunk)}`.slice(-64 * 1024)
    // A failed quick-tunnel creation must never look like a running tunnel,
    // even when the same output also carries a (validation) trycloudflare URL.
    const failure = findTunnelFailure(output)
    if (failure) {
      markFailed(failure)
      return
    }
    // Prefer the creation banner and only search from that marker onward; fall
    // back to the whole output for cloudflared versions whose banner wording
    // differs.
    const marker = TUNNEL_CREATED_MARKER.exec(output)
    const searchable = marker ? output.slice(marker.index) : output
    const found = findTunnelUrl(searchable)
    if (found) markRunning(found)
  }

  function markRunning(found) {
    status = 'running'
    url = found
    error = null
    logger?.info?.(`DSH-Paper-DeepRead: cloudflared tunnel is running at ${found}`)
    persist()
    finishStart()
  }

  function markFailed(message) {
    status = 'error'
    url = null
    error = TUNNEL_FAILED_MARKER.test(message) ? message : `failed to request quick Tunnel: ${message}`
    logger?.warn?.(`DSH-Paper-DeepRead: cloudflared tunnel failed: ${error}`)
    persist()
    // Resolve start() immediately and stop wasting time on a broken child.
    const proc = child
    if (proc) terminate(proc)
    finishStart()
  }

  function onError(proc, spawnError) {
    if (disposed || child !== proc) return
    child = null
    detachChild(proc)
    const message = String(spawnError?.message || spawnError)
    if (status === 'starting' || status === 'running') {
      status = 'error'
      url = null
      error = `cloudflared failed: ${message}`
      logger?.warn?.(`DSH-Paper-DeepRead: ${error}`)
      persist()
    }
    finishStart()
    notifyExit()
  }

  function onExit(proc, code, signal) {
    const wasCurrent = child === proc
    if (wasCurrent) child = null
    detachChild(proc)
    notifyExit()
    if (!wasCurrent || disposed) return
    if (stopping) {
      status = 'off'
      url = null
      error = null
      persist()
      finishStart()
      return
    }
    if (status !== 'starting' && status !== 'running') return
    if (code === 0 && !signal) {
      status = 'off'
      url = null
      error = null
    } else {
      status = 'error'
      url = null
      error = `cloudflared exited ${signal ? `on signal ${signal}` : `with code ${code}`}`
      logger?.warn?.(`DSH-Paper-DeepRead: ${error}`)
    }
    persist()
    finishStart()
  }

  function onSpawnTimeout(proc) {
    if (disposed || status !== 'starting') return
    startTimer = null
    status = 'error'
    url = null
    error = `timed out after ${timeoutMs} ms waiting for the cloudflared tunnel URL`
    logger?.warn?.(`DSH-Paper-DeepRead: ${error}`)
    persist()
    terminate(proc)
    finishStart()
  }

  /** Start the tunnel (idempotent). Resolves once the URL is known or it failed. */
  function start() {
    if (disposed) return Promise.resolve(state())
    if (status === 'running') return Promise.resolve(state())
    if (startPromise) return startPromise
    if (!available) {
      status = 'error'
      url = null
      error = 'cloudflared binary not found'
      persist()
      return Promise.resolve(state())
    }
    // A timed-out start may have left a child that ignored SIGTERM; never let
    // a retry run beside it.
    if (child) {
      const stale = child
      child = null
      detachChild(stale)
      terminate(stale)
    }
    status = 'starting'
    url = null
    error = null
    output = ''
    persist()
    const promise = new Promise(resolve => {
      settleStart = resolve
    })
    startPromise = promise
    // cloudflared is Go and ignores the macOS system proxy: an explicitly
    // configured proxy is passed through both variables so the quick-tunnel
    // API request and the tunnel connection both use it. With no proxy the
    // child simply inherits the plugin process environment.
    const spawnOptions = { stdio: ['ignore', 'pipe', 'pipe'] }
    if (proxyUrl) {
      spawnOptions.env = {
        ...process.env,
        HTTPS_PROXY: proxyUrl,
        HTTP_PROXY: proxyUrl,
      }
    }
    let proc
    try {
      proc = spawnImpl(binary, ['tunnel', '--url', target, '--no-autoupdate'], spawnOptions)
    } catch (spawnError) {
      status = 'error'
      error = `could not start cloudflared: ${String(spawnError?.message || spawnError)}`
      logger?.warn?.(`DSH-Paper-DeepRead: ${error}`)
      persist()
      finishStart()
      return promise
    }
    if (!proc || typeof proc.once !== 'function') {
      status = 'error'
      error = 'spawnImpl returned an invalid child process'
      persist()
      finishStart()
      return promise
    }
    child = proc
    proc.stdout?.on?.('data', chunk => onData(proc, chunk))
    proc.stderr?.on?.('data', chunk => onData(proc, chunk))
    proc.once('error', spawnError => onError(proc, spawnError))
    proc.once('exit', (code, signal) => onExit(proc, code, signal))
    // Ref'd on purpose: the timeout must fire while the plugin is otherwise
    // idle in `starting`. It is always cleared once the start settles.
    startTimer = setTimeout(() => onSpawnTimeout(proc), timeoutMs)
    return promise
  }

  /** Stop the tunnel: SIGTERM, forced SIGKILL after the grace period. */
  async function stop() {
    const proc = child
    stopping = true
    if (proc) {
      const exited = new Promise(resolve => exitWaiters.push(resolve))
      terminate(proc)
      let settleDelay
      const delayed = new Promise(resolve => {
        settleDelay = resolve
      })
      const timer = setTimeout(settleDelay, graceMs + 250)
      timer.unref?.()
      await Promise.race([exited, delayed])
      clearTimeout(timer)
      if (child === proc) {
        try {
          proc.kill?.('SIGKILL')
        } catch {
          // Already gone.
        }
        child = null
        detachChild(proc)
      }
    }
    stopping = false
    if (status !== 'off') {
      status = 'off'
      url = null
      error = null
      persist()
    }
    finishStart()
    return state()
  }

  /** Refresh the link: stop the current tunnel, then start a new one. */
  async function refresh() {
    await stop()
    return start()
  }

  /** Kill the child (sync) and release the streams; idempotent. */
  function dispose() {
    if (disposed) return state()
    disposed = true
    clearStartTimer()
    const proc = child
    child = null
    stopping = false
    if (proc) {
      try {
        proc.stdout?.destroy?.()
        proc.stderr?.destroy?.()
      } catch {
        // Streams may already be closed.
      }
      terminate(proc)
      try {
        proc.unref?.()
      } catch {
        // Not a real child process.
      }
    }
    status = 'off'
    url = null
    error = null
    finishStart()
    notifyExit()
    persist()
    return state()
  }

  return { state, start, stop, refresh, dispose }
}
