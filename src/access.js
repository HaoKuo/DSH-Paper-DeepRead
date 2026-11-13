/**
 * Mobile-access (手机访问) runtime: resolves the best phone target, discovers
 * LAN / Bonjour candidates, probes their reachability, renders QR SVGs, and
 * owns the optional Cloudflare quick tunnel plus the lazy LAN fallback server.
 *
 * Target resolution order (contract §2.4):
 *
 *   1. a valid absolute `siteUrl` config -> the standalone 文献精读库 site;
 *   2. else the lazy read-only LAN fallback server for the managed library;
 *   3. else the DSH Web page itself (only reachable on this machine), with a hint.
 *
 * The payload returned by `snapshot()` is the exact JSON shape consumed by the
 * browser modal (contract §3): every field is always present, missing values
 * are `null` (never `undefined`), there are no `NaN`s, and the whole payload
 * survives a JSON round-trip. QR rendering failures and reachability failures
 * for a single candidate never fail the payload.
 *
 * The optional Cloudflare quick tunnel is delegated to `src/tunnel.js`. On Macs
 * behind a system/transparent proxy (Go's cloudflared ignores the macOS proxy
 * settings) the `cloudflaredProxy` config is forwarded to the child as
 * `HTTPS_PROXY`/`HTTP_PROXY`, which is the escape hatch for
 * `failed to request quick Tunnel ... context deadline exceeded`.
 *
 * @module dsh-paper-deepread/access
 */

import { hostname as osHostname, networkInterfaces as osNetworkInterfaces } from 'node:os'
import { join } from 'node:path'
import { renderQrSvg } from './qr.js'
import { StoreError } from './store.js'
import { normalizeSiteUrl } from './site.js'
import { createLanServer } from './lan.js'
import { createTunnel, findCloudflared } from './tunnel.js'
import { LIBRARY_INDEX, ROUTE_PREFIX } from './route.js'

/** Reachability probe timeout for one LAN candidate. */
export const ACCESS_PROBE_TIMEOUT_MS = 1_200

/** How long one reachability probe result is reused. */
export const ACCESS_PROBE_CACHE_MS = 8_000

/** Tunnel tab label shown by the browser modal. */
export const ACCESS_TUNNEL_LABEL = '外网（临时）'

/** Tunnel actions accepted from the browser. */
export const ACCESS_TUNNEL_ACTIONS = Object.freeze(['start', 'stop', 'refresh'])

/** Human-readable target labels. */
const TARGET_LABELS = Object.freeze({
  site: '文献站点',
  library: '本地书库',
  web: 'DSH 网页',
})

const LOCAL_NOTE = '只在当前电脑可用'
const LAN_NOTE = '同一 Wi-Fi 可用'
const BONJOUR_NOTE = '同一 Wi-Fi 可用（Bonjour）'

/** Interfaces that never carry a phone-reachable LAN address. */
const VIRTUAL_INTERFACE_RE = /^(?:utun|awdl|llw|bridge|gif|stf|p2p|lo)\d*$/u

/** IPv4 link-local range (169.254.0.0/16): never useful for a phone. */
const LINK_LOCAL_PREFIX = '169.254.'

/** Parse an absolute http(s) base URL into the pieces needed for candidates. */
function parseTargetBase(base) {
  if (typeof base !== 'string' || !base) return null
  let url
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return { protocol: url.protocol, port: url.port, pathname: url.pathname || '/' }
}

/** LAN candidate URL: same protocol/port/path as the target, different host. */
function candidateUrl(parts, host) {
  const port = parts.port ? `:${parts.port}` : ''
  return `${parts.protocol}//${host}${port}${parts.pathname || '/'}`
}

function isIpv4Entry(entry) {
  const family = entry?.family
  return family === 'IPv4' || family === 4
}

function isVirtualInterface(iface) {
  return VIRTUAL_INTERFACE_RE.test(String(iface))
}

function isLinkLocalIpv4(address) {
  return address.startsWith(LINK_LOCAL_PREFIX)
}

/** Ranking: en0 first, then other Ethernet-ish `en*`, then everything else. */
function interfaceRank(iface) {
  if (iface === 'en0') return 0
  if (/^en\d+$/u.test(String(iface))) return 1
  return 2
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value) || value.includes(':')
}

function isLocalhostName(value) {
  return /^localhost$/iu.test(value)
}

/** JSON-safe string or `null`. */
function stringOrNull(value) {
  return typeof value === 'string' ? value : null
}

/**
 * Create the mobile-access runtime for one plugin activation.
 *
 * @param {object} options
 * @param {string} [options.siteUrl] Configured standalone site URL (preferred target).
 * @param {string} options.libraryDir Managed 文献精读库 root (LAN fallback target).
 * @param {string} options.dataDir Resolved managed data directory (state files).
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @param {() => (string|null)} [options.getWebOrigin] DSH Web origin resolver.
 * @param {string} [options.pluginVersion] Version reported in the payload.
 * @param {number} [options.lanPort] Preferred LAN fallback port (0 = ephemeral).
 * @param {string} [options.cloudflaredPath] Explicit cloudflared binary path.
 * @param {string} [options.cloudflaredProxy] Optional HTTP(S) proxy handed to
 *   the cloudflared child (`HTTPS_PROXY`/`HTTP_PROXY`); empty inherits the env.
 * @param {Function} [options.spawnImpl] Child-process spawn override (tests).
 * @param {Function} [options.fetchImpl] fetch override for probes (tests).
 * @param {Function} [options.interfacesImpl] `os.networkInterfaces` override (tests).
 * @param {Function} [options.hostnameImpl] `os.hostname` override (tests).
 * @param {object} [options.env] Environment override for binary detection (tests).
 * @param {() => (string|null)} [options.findCloudflaredImpl] Binary detection override (tests).
 * @param {Function} [options.lanServerFactory] LAN server factory override (tests).
 * @param {number} [options.tunnelStartTimeoutMs] Tunnel URL discovery budget.
 * @returns {{snapshot: Function, tunnelAction: Function, dispose: Function}} Access runtime.
 */
export function createAccess(options = {}) {
  const {
    siteUrl,
    libraryDir,
    dataDir,
    logger,
    getWebOrigin,
    pluginVersion = '',
    lanPort = 0,
    cloudflaredPath,
    cloudflaredProxy = '',
    spawnImpl,
    fetchImpl = globalThis.fetch,
    interfacesImpl = osNetworkInterfaces,
    hostnameImpl = osHostname,
    env = process.env,
    findCloudflaredImpl,
    lanServerFactory = createLanServer,
    tunnelStartTimeoutMs,
  } = options
  const version = typeof pluginVersion === 'string' ? pluginVersion : ''
  const resolvedDataDir = typeof dataDir === 'string' && dataDir ? dataDir : ''
  const now = () => Date.now()

  /** Persisted-state path under the managed data directory, if any. */
  function statePath(name) {
    return resolvedDataDir ? join(resolvedDataDir, name) : undefined
  }

  // ---- target resolution --------------------------------------------------

  let lanServer = null

  function getLanServer() {
    if (!lanServer) {
      lanServer = lanServerFactory({
        libraryDir,
        logger,
        port: lanPort,
        stateFile: statePath('lan-server.json'),
      })
    }
    return lanServer
  }

  /** Resolve which URL a phone should open: site -> LAN fallback -> DSH web. */
  async function resolveTarget() {
    const normalized = normalizeSiteUrl(siteUrl)
    if (normalized) return { kind: 'site', base: `${normalized}/`, label: TARGET_LABELS.site }
    try {
      const started = await getLanServer().ensure()
      return { kind: 'library', base: started.url, label: TARGET_LABELS.library }
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: LAN fallback server unavailable: ${String(error?.message || error)}`)
    }
    let origin = ''
    try {
      const value = typeof getWebOrigin === 'function' ? getWebOrigin() : null
      if (typeof value === 'string') origin = value.trim().replace(/\/+$/u, '')
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not resolve the DSH Web origin: ${String(error?.message || error)}`)
    }
    return { kind: 'web', base: `${origin}${ROUTE_PREFIX}/${LIBRARY_INDEX}`, label: TARGET_LABELS.web }
  }

  // ---- LAN / Bonjour candidate discovery ---------------------------------

  /** Discover phone-reachable LAN IPv4 addresses plus one Bonjour name. */
  function discoverCandidates(target) {
    const parts = parseTargetBase(target.base)
    if (!parts) return []
    let table = {}
    try {
      table = interfacesImpl() ?? {}
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not enumerate network interfaces: ${String(error?.message || error)}`)
      table = {}
    }
    const found = []
    if (table && typeof table === 'object') {
      for (const [iface, entries] of Object.entries(table)) {
        if (!Array.isArray(entries) || isVirtualInterface(iface)) continue
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object' || !isIpv4Entry(entry) || entry.internal) continue
          const address = typeof entry.address === 'string' ? entry.address.trim() : ''
          if (!address || isLinkLocalIpv4(address)) continue
          found.push({ iface, address })
        }
      }
    }
    found.sort((left, right) => interfaceRank(left.iface) - interfaceRank(right.iface))
    const seen = new Set()
    const candidates = []
    for (const entry of found) {
      if (seen.has(entry.address)) continue
      seen.add(entry.address)
      candidates.push({
        address: entry.address,
        iface: entry.iface,
        label: `局域网 · ${entry.address}`,
        url: candidateUrl(parts, entry.address),
        note: LAN_NOTE,
      })
    }
    let hostname = ''
    try {
      const value = hostnameImpl()
      if (typeof value === 'string') hostname = value.trim()
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not read the host name: ${String(error?.message || error)}`)
    }
    if (hostname && !isIpAddress(hostname) && !isLocalhostName(hostname)) {
      const name = hostname.toLowerCase().endsWith('.local') ? hostname : `${hostname}.local`
      if (!seen.has(name)) {
        seen.add(name)
        candidates.push({
          address: name,
          iface: 'bonjour',
          label: `局域网 · ${name}`,
          url: candidateUrl(parts, name),
          note: BONJOUR_NOTE,
        })
      }
    }
    return candidates
  }

  // ---- reachability probing (8 s cache, refresh bypass) -------------------

  const probeCache = new Map()

  /**
   * Probe one candidate URL. A reachable target answers HTTP 200..399;
   * network/timeout failures are `false` (the server is not listening on that
   * address), and `null` means the probe could not be attempted at all.
   */
  async function probe(url, refresh) {
    if (!refresh) {
      const cached = probeCache.get(url)
      if (cached && now() - cached.at < ACCESS_PROBE_CACHE_MS) return cached.reachable
    }
    if (typeof fetchImpl !== 'function') return null
    let reachable = null
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(ACCESS_PROBE_TIMEOUT_MS),
      })
      const status = Number(response?.status)
      reachable = Number.isFinite(status) ? status >= 200 && status < 400 : null
    } catch {
      reachable = false
    }
    probeCache.set(url, { at: now(), reachable })
    return reachable
  }

  // ---- QR SVGs (best effort per URL) --------------------------------------

  function qrFor(url) {
    if (typeof url !== 'string' || !url) return null
    if (!/^https?:\/\//iu.test(url)) return null
    try {
      return renderQrSvg(url, { margin: 2 })
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not render a QR code for ${url}: ${String(error?.message || error)}`)
      return null
    }
  }

  // ---- tunnel -------------------------------------------------------------

  let tunnelInstance = null
  let tunnelTarget = null
  let tunnelBin = null
  let resolvedBin = null

  /** Current cloudflared path (cached once found; re-detected while missing). */
  function resolveBin() {
    if (typeof findCloudflaredImpl === 'function') return findCloudflaredImpl()
    if (resolvedBin) return resolvedBin
    try {
      resolvedBin = findCloudflared({ path: cloudflaredPath, env })
    } catch (error) {
      resolvedBin = null
      logger?.warn?.(`DSH-Paper-DeepRead: cloudflared detection failed: ${String(error?.message || error)}`)
    }
    return resolvedBin
  }

  /** Tunnel instance for one upstream base, or `null` when cloudflared is absent. */
  function ensureTunnel(targetBase) {
    const bin = resolveBin()
    if (tunnelInstance && tunnelTarget === targetBase && tunnelBin === bin) return tunnelInstance
    if (tunnelInstance) {
      try {
        tunnelInstance.dispose()
      } catch (error) {
        logger?.warn?.(`DSH-Paper-DeepRead: could not dispose the stale tunnel: ${String(error?.message || error)}`)
      }
      tunnelInstance = null
    }
    if (!bin) {
      tunnelTarget = null
      tunnelBin = null
      return null
    }
    tunnelInstance = createTunnel({
      targetUrl: targetBase,
      logger,
      bin,
      spawnImpl,
      proxy: cloudflaredProxy,
      stateFile: statePath('tunnel.json'),
      startTimeoutMs: tunnelStartTimeoutMs,
    })
    tunnelTarget = targetBase
    tunnelBin = bin
    return tunnelInstance
  }

  /** Tunnel block of the payload (always fully populated). */
  function tunnelPayload(targetBase) {
    const instance = ensureTunnel(targetBase)
    if (!instance) {
      return {
        available: false,
        status: 'off',
        url: null,
        upstream: targetBase,
        error: null,
        label: ACCESS_TUNNEL_LABEL,
        qrSvg: null,
        binary: null,
      }
    }
    const tunnelState = instance.state()
    const tunnelUrl = stringOrNull(tunnelState.url)
    return {
      available: tunnelState.available === true,
      status: typeof tunnelState.status === 'string' ? tunnelState.status : 'off',
      url: tunnelUrl,
      upstream: targetBase,
      error: stringOrNull(tunnelState.error),
      label: ACCESS_TUNNEL_LABEL,
      qrSvg: tunnelUrl ? qrFor(tunnelUrl) : null,
      binary: stringOrNull(tunnelState.binary),
    }
  }

  // ---- payload ------------------------------------------------------------

  function buildHints(target, lan) {
    const hints = []
    if (target.kind === 'web') {
      hints.push('手机无法直接打开本机的 DSH 页面：请配置 siteUrl 使用独立站点，或开启外网访问。')
    }
    hints.push('同一网络优先用局域网地址；外网地址由 Cloudflare 临时隧道提供。')
    if (target.kind !== 'web' && lan.length === 0) {
      hints.push('未发现可用的局域网地址，请确认电脑已连接 Wi-Fi 或有线网络。')
    }
    return hints
  }

  async function snapshotOnce(refresh) {
    const target = await resolveTarget()
    const candidates = discoverCandidates(target)
    const reachable = await Promise.all(candidates.map(candidate => probe(candidate.url, refresh)))
    const lan = candidates.map((candidate, index) => ({
      address: candidate.address,
      iface: candidate.iface,
      label: candidate.label,
      url: candidate.url,
      note: candidate.note,
      reachable: reachable[index],
      qrSvg: qrFor(candidate.url),
    }))
    return {
      ok: true,
      version,
      target: { kind: target.kind, base: target.base, label: target.label },
      local: { url: target.base, note: LOCAL_NOTE, qrSvg: qrFor(target.base) },
      lan,
      tunnel: tunnelPayload(target.base),
      hints: buildHints(target, lan),
    }
  }

  /** In-flight snapshot used to dedupe concurrent `/access` requests. */
  let inflight = null

  /**
   * Build the mobile-access payload.
   * @param {{refresh?: boolean}} [snapshotOptions] `refresh` bypasses probe caches.
   * @returns {Promise<object>} JSON-safe payload (contract §3).
   */
  function snapshot(snapshotOptions = {}) {
    const refresh = snapshotOptions?.refresh === true
    if (inflight) {
      if (!refresh) return inflight
      return inflight.catch(() => undefined).then(() => snapshot({ refresh: true }))
    }
    const promise = snapshotOnce(refresh)
    inflight = promise
    const clear = () => {
      if (inflight === promise) inflight = null
    }
    promise.then(clear, clear)
    return promise
  }

  // ---- browser-triggered tunnel actions -----------------------------------

  let actionTail = Promise.resolve()

  function serializeAction(task) {
    const run = actionTail.then(task, task)
    actionTail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Run one tunnel action (`start` | `stop` | `refresh`) then return a fresh payload.
   * Only these three browser-supplied strings are accepted.
   * @param {unknown} action Raw action from the request body.
   * @returns {Promise<object>} Fresh payload.
   * @throws {StoreError} `BAD_REQUEST` for an unknown action, `TUNNEL_UNAVAILABLE`
   *   when cloudflared is missing.
   */
  function tunnelAction(action) {
    if (!ACCESS_TUNNEL_ACTIONS.includes(action)) {
      return Promise.reject(new StoreError('BAD_REQUEST', `action must be one of: ${ACCESS_TUNNEL_ACTIONS.join(', ')}`))
    }
    return serializeAction(async () => {
      const target = await resolveTarget()
      if (action === 'stop') {
        if (tunnelInstance) await tunnelInstance.stop()
        return snapshotOnce(false)
      }
      if (!resolveBin()) {
        throw new StoreError('TUNNEL_UNAVAILABLE', 'cloudflared is not installed; install it or set the cloudflaredPath config')
      }
      const instance = ensureTunnel(target.base)
      if (!instance) {
        throw new StoreError('TUNNEL_UNAVAILABLE', 'cloudflared is not installed; install it or set the cloudflaredPath config')
      }
      if (action === 'start') await instance.start()
      else await instance.refresh()
      // Always recompute (never reuse a snapshot that may have started before
      // the action finished), so the returned payload reflects the new status.
      return snapshotOnce(false)
    })
  }

  /** Release the tunnel child and the LAN fallback server (plugin fiber cleanup). */
  async function dispose() {
    const failures = []
    if (tunnelInstance) {
      try {
        tunnelInstance.dispose()
      } catch (error) {
        failures.push(error)
      }
      tunnelInstance = null
      tunnelTarget = null
      tunnelBin = null
      resolvedBin = null
    }
    if (lanServer) {
      const current = lanServer
      lanServer = null
      try {
        await current.stop()
      } catch (error) {
        failures.push(error)
      }
    }
    probeCache.clear()
    for (const error of failures) {
      logger?.warn?.(`DSH-Paper-DeepRead: access cleanup failed: ${String(error?.message || error)}`)
    }
  }

  return { snapshot, tunnelAction, dispose }
}
