/**
 * Tests for the mobile-access runtime (`src/access.js`) and its HTTP wiring
 * (`GET /paper-deepread/api/access`, `POST /paper-deepread/api/access/tunnel`).
 *
 * Hermetic: `fetchImpl`, `interfacesImpl`, `hostnameImpl`, `spawnImpl`, and
 * `findCloudflaredImpl` are injected, so nothing probes the real network, no
 * real cloudflared child is spawned, and every server/child is released in
 * `finally` / `t.after`.
 *
 * Run with: node --test tests/access.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAccess } from '../src/access.js'
import { createManager } from '../src/manager.js'
import { createLibraryHandler } from '../src/route.js'
import { makeFixture, startFixtureServer } from './helpers.js'

const URL_ONE = 'https://quick-test-one.trycloudflare.com'
const URL_TWO = 'https://quick-test-two.trycloudflare.com'
const JSON_HEADERS = { 'content-type': 'application/json' }

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/** Fake `os.networkInterfaces()` covering the filter/ranking rules. */
function fakeInterfaces() {
  const v4 = (address, options = {}) => ({ address, family: 'IPv4', internal: false, ...options })
  const v6 = address => ({ address, family: 'IPv6', internal: false })
  return {
    lo0: [v4('127.0.0.1', { internal: true }), v6('::1')],
    en0: [v6('fe80::1'), v4('172.17.1.190')],
    en1: [v4('192.168.1.20')],
    en5: [v4('169.254.10.9')],
    utun3: [v4('10.8.0.2')],
    awdl0: [v4('10.9.0.3')],
    llw0: [v4('10.9.0.4')],
    bridge0: [v4('10.10.0.4')],
    gif0: [v4('10.11.0.5')],
    stf0: [v4('10.12.0.6')],
    p2p0: [v4('10.13.0.7')],
    en6: ['not-an-entry', null],
  }
}

/** Wait until `predicate()` is true (bounded, no timers left behind). */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('waitFor timed out')
}

/** Assert no `undefined`, `NaN`, or `Infinity` anywhere and a lossless round-trip. */
function assertLosslessJson(value, label = 'payload') {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${label} must survive a JSON round-trip`)
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert.notEqual(item, undefined, `${label}.${key} must not be undefined`)
      if (typeof item === 'number') assert.ok(Number.isFinite(item), `${label}.${key} must be finite`)
      assertLosslessJson(item, `${label}.${key}`)
    }
  }
}

function assertStringOrNull(value, label) {
  assert.ok(value === null || typeof value === 'string', `${label} must be a string or null`)
}

/** Fake cloudflared child: EventEmitter streams, kill() emits exit. */
function makeFakeChild() {
  const child = new EventEmitter()
  const stdout = new EventEmitter()
  stdout.destroy = () => {}
  const stderr = new EventEmitter()
  stderr.destroy = () => {}
  child.stdout = stdout
  child.stderr = stderr
  child.kills = []
  child.kill = signal => {
    child.kills.push(signal)
    child.emit('exit', 0, null)
    return true
  }
  child.emitOutput = text => stdout.emit('data', Buffer.from(text))
  return child
}

/** Access runtime over a temp data/library dir, disposed by the test. */
function makeAccess(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-access-'))
  const libraryDir = join(dir, 'library')
  mkdirSync(libraryDir, { recursive: true })
  writeFileSync(join(libraryDir, 'index.html'), '<!doctype html><html><body>managed library</body></html>')
  const fetchLog = []
  const access = createAccess({
    siteUrl: 'http://127.0.0.1:8080',
    libraryDir,
    dataDir: join(dir, 'data'),
    logger: null,
    pluginVersion: '1.6.0',
    getWebOrigin: () => 'http://127.0.0.1:3080',
    interfacesImpl: fakeInterfaces,
    hostnameImpl: () => 'MacMax2',
    fetchImpl: async (url, options) => {
      fetchLog.push({ url, options })
      return { status: 200 }
    },
    findCloudflaredImpl: () => null,
    ...overrides,
  })
  t.after(async () => {
    await access.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return { access, dir, libraryDir, fetchLog }
}

test('snapshot resolves the site target, ranks LAN candidates, and renders QR SVGs', async t => {
  const { access, dir, fetchLog } = makeAccess(t)
  const payload = await access.snapshot()

  assert.equal(payload.ok, true)
  assert.equal(payload.version, '1.6.0')
  assert.deepEqual(payload.target, { kind: 'site', base: 'http://127.0.0.1:8080/', label: '文献站点' })

  // Local candidate is the target base itself.
  assert.deepEqual(Object.keys(payload.local).sort(), ['note', 'qrSvg', 'url'])
  assert.equal(payload.local.url, 'http://127.0.0.1:8080/')
  assert.equal(payload.local.note, '只在当前电脑可用')
  assert.match(payload.local.qrSvg, /^<svg /u)

  // en0 first, then other interfaces, then one Bonjour entry; virtual/link-local skipped.
  assert.deepEqual(
    payload.lan.map(candidate => [candidate.iface, candidate.address]),
    [['en0', '172.17.1.190'], ['en1', '192.168.1.20'], ['bonjour', 'MacMax2.local']],
  )
  for (const candidate of payload.lan) {
    assert.equal(candidate.label, `局域网 · ${candidate.address}`)
    assert.equal(candidate.url, `http://${candidate.address}:8080/`)
    assert.equal(typeof candidate.note, 'string')
    assert.equal(candidate.reachable, true)
    assert.match(candidate.qrSvg, /^<svg /u)
  }

  // Tunnel block is fully populated even when cloudflared is absent.
  assert.deepEqual(payload.tunnel, {
    available: false,
    status: 'off',
    url: null,
    upstream: 'http://127.0.0.1:8080/',
    error: null,
    label: '外网（临时）',
    qrSvg: null,
    binary: null,
  })
  assert.ok(Array.isArray(payload.hints))
  assert.ok(payload.hints.length >= 1)
  for (const hint of payload.hints) assert.equal(typeof hint, 'string')

  assertLosslessJson(payload)
  // Probes use no-store + the 1200 ms abort signal.
  assert.equal(fetchLog.length, payload.lan.length)
  for (const { url, options } of fetchLog) {
    assert.equal(options.cache, 'no-store')
    assert.ok(options.signal)
    assert.match(url, /^http:\/\/(?:172\.17\.1\.190|192\.168\.1\.20|MacMax2\.local):8080\/$/u)
  }
  // A configured site target must not bind a LAN fallback server.
  assert.equal(existsSync(join(dir, 'data', 'lan-server.json')), false)
})

test('probe results are cached for 8 s and ?refresh bypasses the cache', async t => {
  const { access, fetchLog } = makeAccess(t)
  await access.snapshot()
  assert.equal(fetchLog.length, 3)
  await access.snapshot()
  assert.equal(fetchLog.length, 3)
  await access.snapshot({ refresh: true })
  assert.equal(fetchLog.length, 6)
  await access.snapshot()
  assert.equal(fetchLog.length, 6)
})

test('reachable is true for 2xx/3xx, false for errors, null when probing is impossible', async t => {
  const statuses = new Map([
    ['http://172.17.1.190:8080/', 200],
    ['http://192.168.1.20:8080/', 503],
    ['http://MacMax2.local:8080/', 302],
  ])
  const { access } = makeAccess(t, {
    fetchImpl: async url => {
      if (url.includes('MacMax2.local')) return { status: 302 }
      return { status: statuses.get(url) }
    },
  })
  const payload = await access.snapshot()
  assert.deepEqual(payload.lan.map(candidate => candidate.reachable), [true, false, true])

  const { access: failingAccess } = makeAccess(t, {
    fetchImpl: async () => {
      throw new Error('connect ECONNREFUSED')
    },
  })
  const failing = await failingAccess.snapshot()
  assert.deepEqual(failing.lan.map(candidate => candidate.reachable), [false, false, false])

  const { access: blindAccess } = makeAccess(t, { fetchImpl: null })
  const blind = await blindAccess.snapshot()
  assert.deepEqual(blind.lan.map(candidate => candidate.reachable), [null, null, null])
})

test('concurrent snapshots are deduplicated into one computation', async t => {
  const { access, fetchLog } = makeAccess(t)
  const [first, second] = await Promise.all([access.snapshot(), access.snapshot()])
  assert.equal(first, second)
  assert.equal(fetchLog.length, 3)
})

test('without siteUrl the lazy LAN fallback server becomes the target', async t => {
  const { access, dir } = makeAccess(t, { siteUrl: '' })
  const payload = await access.snapshot()
  assert.equal(payload.target.kind, 'library')
  assert.equal(payload.target.label, '本地书库')
  assert.match(payload.target.base, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
  assert.equal(payload.local.url, payload.target.base)
  assert.match(payload.local.qrSvg, /^<svg /u)
  const port = new URL(payload.target.base).port
  assert.equal(payload.lan[0].url, `http://172.17.1.190:${port}/`)
  // The fallback server really serves the library on that URL.
  const response = await fetch(payload.local.url)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /managed library/u)
  // The chosen port is persisted for the next activation.
  const persisted = JSON.parse(readFileSync(join(dir, 'data', 'lan-server.json'), 'utf8'))
  assert.equal(String(persisted.port), port)
})

test('an invalid siteUrl falls back to the LAN server, and a failed LAN server to the DSH web target', async t => {
  const { access } = makeAccess(t, { siteUrl: 'http://not a url' })
  const libraryPayload = await access.snapshot()
  assert.equal(libraryPayload.target.kind, 'library')

  const { access: webAccess } = makeAccess(t, {
    siteUrl: '',
    lanServerFactory: () => {
      throw new Error('bind failed')
    },
  })
  const webPayload = await webAccess.snapshot()
  assert.deepEqual(webPayload.target, {
    kind: 'web',
    base: 'http://127.0.0.1:3080/paper-deepread/index.html',
    label: 'DSH 网页',
  })
  assert.ok(webPayload.hints.some(hint => hint.includes('siteUrl')))
})

test('tunnel actions reject unknown actions and report unavailable cloudflared', async t => {
  const { access, fetchLog } = makeAccess(t)
  await assert.rejects(access.tunnelAction('reboot'), error => error?.code === 'BAD_REQUEST')
  await assert.rejects(access.tunnelAction(undefined), error => error?.code === 'BAD_REQUEST')
  await assert.rejects(access.tunnelAction('start'), error => error?.code === 'TUNNEL_UNAVAILABLE')
  await assert.rejects(access.tunnelAction('refresh'), error => error?.code === 'TUNNEL_UNAVAILABLE')
  // `stop` is tolerant: nothing to stop is still a fresh payload.
  const stopped = await access.tunnelAction('stop')
  assert.equal(stopped.ok, true)
  assert.equal(stopped.tunnel.status, 'off')
  // Only that last snapshot probed the LAN candidates.
  assert.equal(fetchLog.length, 3)
})

test('tunnel start -> running -> refresh (new URL) -> stop through the access runtime', async t => {
  const children = []
  const { access, dir } = makeAccess(t, {
    findCloudflaredImpl: () => '/fake/bin/cloudflared',
    spawnImpl: () => {
      const child = makeFakeChild()
      children.push(child)
      return child
    },
  })
  const starting = access.tunnelAction('start')
  await waitFor(() => children.length === 1)
  children[0].emitOutput(`INF |  ${URL_ONE}  |`)
  const running = await starting
  assert.equal(running.tunnel.available, true)
  assert.equal(running.tunnel.status, 'running')
  assert.equal(running.tunnel.url, URL_ONE)
  assert.equal(running.tunnel.binary, '/fake/bin/cloudflared')
  assert.equal(running.tunnel.upstream, 'http://127.0.0.1:8080/')
  assert.match(running.tunnel.qrSvg, /^<svg /u)
  assertLosslessJson(running)
  const persisted = JSON.parse(readFileSync(join(dir, 'data', 'tunnel.json'), 'utf8'))
  assert.equal(persisted.status, 'running')
  assert.equal(persisted.url, URL_ONE)

  const refreshing = access.tunnelAction('refresh')
  await waitFor(() => children.length === 2)
  children[1].emitOutput(`INF |  ${URL_TWO}  |`)
  const refreshed = await refreshing
  assert.equal(refreshed.tunnel.status, 'running')
  assert.equal(refreshed.tunnel.url, URL_TWO)
  assert.notEqual(refreshed.tunnel.url, URL_ONE)

  const stopped = await access.tunnelAction('stop')
  assert.equal(stopped.tunnel.status, 'off')
  assert.equal(stopped.tunnel.url, null)
  assert.equal(stopped.tunnel.qrSvg, null)
  assert.deepEqual(children[1].kills, ['SIGTERM'])
})

test('tunnel payload is available but off before any start', async t => {
  const { access } = makeAccess(t, {
    findCloudflaredImpl: () => '/fake/bin/cloudflared',
    spawnImpl: () => makeFakeChild(),
  })
  const payload = await access.snapshot()
  assert.equal(payload.tunnel.available, true)
  assert.equal(payload.tunnel.status, 'off')
  assert.equal(payload.tunnel.binary, '/fake/bin/cloudflared')
  assert.equal(payload.tunnel.url, null)
  assert.equal(payload.tunnel.qrSvg, null)
})

test('dispose stops the LAN server, the tunnel, and is idempotent', async t => {
  const { access } = makeAccess(t, { siteUrl: '' })
  const payload = await access.snapshot()
  const lanUrl = payload.local.url
  assert.equal((await fetch(lanUrl)).status, 200)
  await access.dispose()
  await assert.rejects(fetch(lanUrl), /fetch failed|ECONNREFUSED/u)
  await access.dispose()
})

test('HTTP API: GET /api/access and POST /api/access/tunnel through the plugin route', async () => {
  const fixture = makeFixture()
  const probeCalls = []
  const manager = createManager({
    packageDir: fixture.packageDir,
    config: fixture.config,
    getWebOrigin: () => 'http://127.0.0.1:9999',
    accessOptions: {
      interfacesImpl: fakeInterfaces,
      hostnameImpl: () => 'MacMax2',
      fetchImpl: async url => {
        probeCalls.push(url)
        return { status: 200 }
      },
      findCloudflaredImpl: () => null,
    },
  })
  const server = await startFixtureServer(manager, manager.store.libraryRoot, createLibraryHandler)
  let lanUrl = ''
  try {
    const response = await fetch(`${server.base}/paper-deepread/api/access`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/json/u)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.version, PACKAGE_VERSION)
    assert.equal(payload.target.kind, 'library')
    assert.match(payload.target.base, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
    lanUrl = payload.target.base
    assert.equal(payload.lan.length, 3)
    assert.equal(payload.tunnel.available, false)
    assert.equal(payload.tunnel.status, 'off')
    assert.equal(probeCalls.length, 3)

    // The LAN fallback server serves the managed library for a phone.
    assert.equal((await fetch(lanUrl)).status, 200)

    // A fresh snapshot reuses the 8 s probe cache (no extra probes) ...
    assert.equal((await (await fetch(`${server.base}/paper-deepread/api/access`)).json()).ok, true)
    assert.equal(probeCalls.length, 3)
    // ... while `?refresh=1` bypasses it (route.js hands over the path without
    // the query, so the manager reads the flag from the original request URL).
    const refreshed = await fetch(`${server.base}/paper-deepread/api/access?refresh=1`)
    assert.equal(refreshed.status, 200)
    assert.equal((await refreshed.json()).ok, true)
    assert.equal(probeCalls.length, 6)

    // Unknown action -> 400 BAD_REQUEST.
    const badAction = await fetch(`${server.base}/paper-deepread/api/access/tunnel`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'reboot' }),
    })
    assert.equal(badAction.status, 400)
    assert.equal((await badAction.json()).error.code, 'BAD_REQUEST')
    // Non-string action is rejected the same way (browser input is untrusted).
    const numericAction = await fetch(`${server.base}/paper-deepread/api/access/tunnel`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 42 }),
    })
    assert.equal(numericAction.status, 400)

    // Missing cloudflared -> 503 TUNNEL_UNAVAILABLE.
    const unavailable = await fetch(`${server.base}/paper-deepread/api/access/tunnel`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'start' }),
    })
    assert.equal(unavailable.status, 503)
    assert.equal((await unavailable.json()).error.code, 'TUNNEL_UNAVAILABLE')

    // Wrong methods -> 405, and the API stays structurally error-shaped.
    assert.equal((await fetch(`${server.base}/paper-deepread/api/access/tunnel`)).status, 405)
    assert.equal((await fetch(`${server.base}/paper-deepread/api/access`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status, 405)
    const unknown = await fetch(`${server.base}/paper-deepread/api/access/nope`)
    assert.equal(unknown.status, 404)
  } finally {
    await server.close()
    await manager.dispose()
    fixture.cleanup()
  }
  // Manager disposal released the LAN fallback server.
  await assert.rejects(fetch(lanUrl), /fetch failed|ECONNREFUSED/u)
})

test('HTTP API: config.cloudflaredProxy reaches the tunnel child environment', async () => {
  const fixture = makeFixture()
  const children = []
  const spawnCalls = []
  const manager = createManager({
    packageDir: fixture.packageDir,
    config: { ...fixture.config, cloudflaredProxy: 'http://127.0.0.1:7890' },
    getWebOrigin: () => 'http://127.0.0.1:9999',
    accessOptions: {
      interfacesImpl: fakeInterfaces,
      hostnameImpl: () => 'MacMax2',
      fetchImpl: async () => ({ status: 200 }),
      findCloudflaredImpl: () => '/fake/bin/cloudflared',
      spawnImpl: (bin, args, options) => {
        spawnCalls.push({ bin, args, options })
        const child = makeFakeChild()
        children.push(child)
        return child
      },
    },
  })
  const server = await startFixtureServer(manager, manager.store.libraryRoot, createLibraryHandler)
  try {
    const starting = fetch(`${server.base}/paper-deepread/api/access/tunnel`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ action: 'start' }),
    })
    await waitFor(() => children.length === 1)
    children[0].emitOutput([
      '2026-11-13T08:00:02Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |',
      `2026-11-13T08:00:02Z INF |  ${URL_ONE}  |`,
    ].join('\n'))
    const response = await starting
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.tunnel.status, 'running')
    assert.equal(payload.tunnel.url, URL_ONE)
    // config.cloudflaredProxy -> createAccess -> createTunnel -> child env.
    assert.equal(spawnCalls.length, 1)
    assert.deepEqual(spawnCalls[0].args, ['tunnel', '--url', payload.tunnel.upstream, '--no-autoupdate'])
    assert.equal(payload.tunnel.upstream, payload.target.base)
    assert.equal(spawnCalls[0].options.env.HTTPS_PROXY, 'http://127.0.0.1:7890')
    assert.equal(spawnCalls[0].options.env.HTTP_PROXY, 'http://127.0.0.1:7890')
  } finally {
    await server.close()
    await manager.dispose()
    fixture.cleanup()
  }
})
