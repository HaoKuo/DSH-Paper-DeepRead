/**
 * Unit tests for the Cloudflare quick-tunnel manager (`src/tunnel.js`).
 *
 * Hermetic: a fake `spawnImpl` child process replaces the real cloudflared
 * binary, no network is touched, and every child is disposed in `finally`.
 *
 * Run with: node --test tests/tunnel.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CLOUDFLARED_HOME_PATHS,
  TUNNEL_CREATED_MARKER,
  TUNNEL_FAILED_MARKER,
  TUNNEL_URL_RE,
  createTunnel,
  findCloudflared,
  findTunnelFailure,
  findTunnelUrl,
} from '../src/tunnel.js'

const URL_ONE = 'https://quick-test-one.trycloudflare.com'
const URL_TWO = 'https://quick-test-two.trycloudflare.com'
const REAL_URL = 'https://middle-june-streets-showed.trycloudflare.com'
const FAILURE_LINE = '2026-11-13T08:00:02Z ERR failed to request quick Tunnel: '
  + 'Post "https://api.trycloudflare.com/tunnel": context deadline exceeded (Client.Timeout exceeded while awaiting headers)'

/** Fake cloudflared child: EventEmitter streams, kill() emits exit. */
function makeFakeChild(options = {}) {
  const child = new EventEmitter()
  const stdout = new EventEmitter()
  stdout.destroyed = false
  stdout.destroy = function destroy() { this.destroyed = true }
  const stderr = new EventEmitter()
  stderr.destroyed = false
  stderr.destroy = function destroy() { this.destroyed = true }
  child.stdout = stdout
  child.stderr = stderr
  child.pid = 4242
  child.kills = []
  child.kill = signal => {
    child.kills.push(signal)
    if (signal === 'SIGKILL' || options.exitOnSigterm !== false) child.emit('exit', 0, null)
    return true
  }
  child.emitOutput = text => stdout.emit('data', Buffer.from(text))
  child.emitExit = (code, signal = null) => child.emit('exit', code, signal)
  return child
}

/** Wait until `predicate()` is true (bounded, no timers left behind). */
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error('waitFor timed out')
}

/** A tunnel + temp state dir that are always cleaned up. */
function makeTunnel(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-tunnel-'))
  const stateFile = join(dir, 'tunnel.json')
  const children = []
  const spawnImpl = () => {
    const child = makeFakeChild()
    children.push(child)
    return child
  }
  const tunnel = createTunnel({
    targetUrl: 'http://127.0.0.1:8080/',
    bin: '/fake/bin/cloudflared',
    spawnImpl,
    stateFile,
    ...overrides,
  })
  t.after(() => {
    tunnel.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return { tunnel, children, stateFile }
}

/** Like {@link makeTunnel} but records every spawn call (bin/args/options). */
function makeSpyTunnel(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-tunnel-'))
  const stateFile = join(dir, 'tunnel.json')
  const children = []
  const spawnCalls = []
  const tunnel = createTunnel({
    targetUrl: 'http://127.0.0.1:8080/',
    bin: '/fake/bin/cloudflared',
    spawnImpl: (bin, args, options) => {
      spawnCalls.push({ bin, args, options })
      const child = makeFakeChild()
      children.push(child)
      return child
    },
    stateFile,
    ...overrides,
  })
  t.after(() => {
    tunnel.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return { tunnel, children, spawnCalls, stateFile }
}

test('findTunnelUrl parses the cloudflared banner URL', () => {
  const banner = [
    '2026-11-13T08:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
    `2026-11-13T08:00:02Z INF |  ${URL_ONE}  |`,
    '',
  ].join('\n')
  assert.equal(findTunnelUrl(banner), URL_ONE)
  assert.equal(findTunnelUrl('no url here'), null)
  assert.equal(findTunnelUrl(undefined), null)
  // A bare uppercase host is not a valid quick-tunnel URL.
  assert.equal(findTunnelUrl('https://AbC.trycloudflare.com'), null)
  assert.match(URL_ONE, TUNNEL_URL_RE)
  assert.match(REAL_URL, TUNNEL_URL_RE)
  // Cloudflare infrastructure hosts must never be adopted as the tunnel URL.
  assert.equal(findTunnelUrl('https://api.trycloudflare.com/tunnel'), null)
  assert.equal(findTunnelUrl('https://www.trycloudflare.com'), null)
  assert.equal(findTunnelUrl('https://update.trycloudflare.com'), null)
  assert.equal(findTunnelUrl('https://pkg.trycloudflare.com'), null)
  assert.equal(
    findTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded'),
    null,
  )
  // Quick-tunnel names are multi-word; a single label is not one.
  assert.equal(findTunnelUrl('https://mytest.trycloudflare.com'), null)
  assert.equal(findTunnelUrl(REAL_URL), REAL_URL)
})

test('findTunnelFailure extracts the trimmed failure message from cloudflared output', () => {
  const output = [
    '2026-11-13T08:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
    FAILURE_LINE,
    '',
  ].join('\n')
  const message = findTunnelFailure(output)
  assert.match(message, /^failed to request quick Tunnel: /u)
  assert.match(message, /context deadline exceeded/u)
  assert.doesNotMatch(message, /^\d{4}-\d{2}-\d{2}T/u)
  assert.equal(findTunnelFailure('all good'), null)
  assert.equal(findTunnelFailure(''), null)
  assert.equal(findTunnelFailure(undefined), null)
  assert.match('Your quick Tunnel has been created! Visit it at', TUNNEL_CREATED_MARKER)
  assert.match(FAILURE_LINE, TUNNEL_FAILED_MARKER)
})

test('findCloudflared honours config, env, homebrew, and PATH candidates in order', () => {
  assert.equal(findCloudflared({ path: '/custom/cloudflared', env: {}, existsImpl: () => false }), null)
  assert.equal(
    findCloudflared({ path: '/custom/cloudflared', env: {}, existsImpl: file => file === '/custom/cloudflared' }),
    '/custom/cloudflared',
  )
  assert.equal(
    findCloudflared({ env: { CLOUDFLARED_BIN: '/env/cloudflared' }, existsImpl: file => file === '/env/cloudflared' }),
    '/env/cloudflared',
  )
  assert.equal(
    findCloudflared({ env: {}, existsImpl: file => file === CLOUDFLARED_HOME_PATHS[0] }),
    CLOUDFLARED_HOME_PATHS[0],
  )
  assert.equal(
    findCloudflared({ env: { PATH: '/first:/second' }, existsImpl: file => file === '/second/cloudflared' }),
    '/second/cloudflared',
  )
  // Config wins over later candidates.
  const both = file => file === '/custom/cloudflared' || file === CLOUDFLARED_HOME_PATHS[0]
  assert.equal(findCloudflared({ path: '/custom/cloudflared', env: {}, existsImpl: both }), '/custom/cloudflared')
})

test('start spawns cloudflared with the quick-tunnel args and reaches running', async t => {
  const { tunnel, children, stateFile } = makeTunnel(t)
  const spawnCalls = []
  const tunnelWithSpy = createTunnel({
    targetUrl: 'http://127.0.0.1:8080/',
    bin: '/fake/bin/cloudflared',
    spawnImpl: (bin, args, options) => {
      spawnCalls.push({ bin, args, options })
      const child = makeFakeChild()
      children.push(child)
      return child
    },
    stateFile,
  })
  t.after(() => tunnelWithSpy.dispose())
  const started = tunnelWithSpy.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(`INF |  ${URL_ONE}  |`)
  const state = await started
  assert.equal(state.status, 'running')
  assert.equal(state.url, URL_ONE)
  assert.equal(state.binary, '/fake/bin/cloudflared')
  assert.deepEqual(spawnCalls, [{
    bin: '/fake/bin/cloudflared',
    args: ['tunnel', '--url', 'http://127.0.0.1:8080/', '--no-autoupdate'],
    options: { stdio: ['ignore', 'pipe', 'pipe'] },
  }])
  // Persisted snapshot reflects the running URL.
  const persisted = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(persisted.status, 'running')
  assert.equal(persisted.url, URL_ONE)
  assert.equal(persisted.target, 'http://127.0.0.1:8080/')
  // Idempotent: a second start neither respawns nor changes state.
  const again = await tunnelWithSpy.start()
  assert.equal(again.status, 'running')
  assert.equal(children.length, 1)
  // The helper tunnel created by makeTunnel() was not started.
  assert.equal(tunnel.state().status, 'off')
})

test('an explicit proxy is forwarded to cloudflared as HTTPS_PROXY/HTTP_PROXY', async t => {
  const { tunnel, children, spawnCalls } = makeSpyTunnel(t, { proxy: 'http://127.0.0.1:7890' })
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(`2026-11-13T08:00:02Z INF |  ${REAL_URL}  |`)
  const state = await started
  assert.equal(state.status, 'running')
  assert.equal(state.url, REAL_URL)
  assert.equal(spawnCalls.length, 1)
  assert.deepEqual(spawnCalls[0].args, ['tunnel', '--url', 'http://127.0.0.1:8080/', '--no-autoupdate'])
  assert.equal(spawnCalls[0].options.env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(spawnCalls[0].options.env.HTTP_PROXY, 'http://127.0.0.1:7890')
  // The rest of the plugin environment is inherited by the child.
  if (process.env.PATH !== undefined) assert.equal(spawnCalls[0].options.env.PATH, process.env.PATH)
})

test('without a proxy cloudflared simply inherits the plugin environment', async t => {
  const { tunnel, children, spawnCalls } = makeSpyTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(REAL_URL)
  await started
  assert.equal(spawnCalls.length, 1)
  assert.equal(spawnCalls[0].options.env, undefined)
  assert.deepEqual(spawnCalls[0].options, { stdio: ['ignore', 'pipe', 'pipe'] })
})

test('a whitespace-only proxy is ignored', async t => {
  const { tunnel, children, spawnCalls } = makeSpyTunnel(t, { proxy: '   ' })
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(REAL_URL)
  await started
  assert.equal(spawnCalls[0].options.env, undefined)
})

test('the "quick Tunnel has been created" banner makes the tunnel running with the real URL', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput([
    '2026-11-13T08:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...',
    '2026-11-13T08:00:02Z INF +--------------------------------------------------------------------------------------------+',
    '2026-11-13T08:00:02Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |',
    `2026-11-13T08:00:02Z INF |  ${REAL_URL}                                        |`,
    '2026-11-13T08:00:02Z INF +--------------------------------------------------------------------------------------------+',
    '',
  ].join('\n'))
  const state = await started
  assert.equal(state.status, 'running')
  assert.equal(state.url, REAL_URL)
})

test('a failed quick-tunnel request never becomes running, even with a trycloudflare URL in the output', async t => {
  const { tunnel, children } = makeTunnel(t, { startTimeoutMs: 60_000 })
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  // The bannerless output contains a plausible quick-tunnel URL *and* the
  // API-host failure line; the API host must never be adopted and neither may
  // a failed creation be reported as running.
  children[0].emitOutput([
    `2026-11-13T08:00:01Z INF |  ${REAL_URL}  |`,
    FAILURE_LINE,
    '2026-11-13T08:00:02Z ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": context deadline exceeded',
    '',
  ].join('\n'))
  const state = await started
  assert.equal(state.status, 'error')
  assert.equal(state.url, null)
  assert.notEqual(tunnel.state().status, 'running')
})

test('quick-tunnel failure resolves start() promptly with the cloudflared message', async t => {
  const { tunnel, children, stateFile } = makeTunnel(t, { startTimeoutMs: 60_000 })
  const begun = Date.now()
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(`${FAILURE_LINE}\n`)
  const state = await started
  const elapsed = Date.now() - begun
  assert.ok(elapsed < 5_000, `start() resolved in ${elapsed} ms; must not wait out the 60 s timeout`)
  assert.equal(state.status, 'error')
  assert.equal(state.url, null)
  assert.match(state.error, /^failed to request quick Tunnel: /u)
  assert.match(state.error, /context deadline exceeded/u)
  assert.doesNotMatch(state.error, /^\d{4}-\d{2}-\d{2}T/u)
  // The broken child is terminated and the error is persisted for the panel.
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  const persisted = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(persisted.status, 'error')
  assert.equal(persisted.url, null)
  assert.match(persisted.error, /context deadline exceeded/u)
})

test('start times out when cloudflared never prints a URL', async t => {
  const { tunnel, children } = makeTunnel(t, { startTimeoutMs: 30 })
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  const state = await started
  assert.equal(state.status, 'error')
  assert.equal(state.url, null)
  assert.match(state.error, /timed out after 30 ms/)
  assert.deepEqual(children[0].kills, ['SIGTERM'])
})

test('a child that exits with code 0 before the URL leaves the tunnel off', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitExit(0, null)
  const state = await started
  assert.equal(state.status, 'off')
  assert.equal(state.url, null)
  assert.equal(state.error, null)
})

test('a child that crashes before the URL reports an error', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitExit(2, null)
  const state = await started
  assert.equal(state.status, 'error')
  assert.equal(state.url, null)
  assert.match(state.error, /exited with code 2/)
})

test('an unexpected exit while running reports an error and clears the URL', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(URL_ONE)
  assert.equal((await started).status, 'running')
  children[0].emitExit(1, null)
  const state = tunnel.state()
  assert.equal(state.status, 'error')
  assert.equal(state.url, null)
  assert.match(state.error, /exited with code 1/)
})

test('stop sends SIGTERM, waits for exit, and reports off', async t => {
  const { tunnel, children, stateFile } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(URL_ONE)
  await started
  const state = await tunnel.stop()
  assert.equal(state.status, 'off')
  assert.equal(state.url, null)
  assert.equal(state.error, null)
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).status, 'off')
})

test('stop escalates to SIGKILL when the child ignores SIGTERM', async t => {
  const { tunnel, children } = makeTunnel(t, { killGraceMs: 20 })
  // Every child ignores SIGTERM; only SIGKILL emits exit.
  const originalSpawn = makeFakeChild
  assert.equal(typeof originalSpawn, 'function')
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].kill = signal => {
    children[0].kills.push(signal)
    if (signal === 'SIGKILL') children[0].emit('exit', 0, null)
    return true
  }
  children[0].emitOutput(URL_ONE)
  await started
  const state = await tunnel.stop()
  assert.equal(state.status, 'off')
  assert.deepEqual(children[0].kills, ['SIGTERM', 'SIGKILL'])
})

test('refresh stops the old tunnel and starts a new URL', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(URL_ONE)
  assert.equal((await started).url, URL_ONE)
  const refreshed = tunnel.refresh()
  await waitFor(() => children.length === 2)
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  children[1].emitOutput(URL_TWO)
  const state = await refreshed
  assert.equal(state.status, 'running')
  assert.equal(state.url, URL_TWO)
  assert.notEqual(state.url, URL_ONE)
})

test('dispose kills the child, releases its streams, and is idempotent', async t => {
  const { tunnel, children } = makeTunnel(t)
  const started = tunnel.start()
  await waitFor(() => children.length === 1)
  children[0].emitOutput(URL_ONE)
  await started
  const state = tunnel.dispose()
  assert.equal(state.status, 'off')
  assert.deepEqual(children[0].kills, ['SIGTERM'])
  assert.equal(children[0].stdout.destroyed, true)
  assert.equal(children[0].stderr.destroyed, true)
  assert.equal(tunnel.dispose().status, 'off')
})

test('a missing binary never spawns and reports unavailable', async t => {
  let spawnCalls = 0
  const dir = mkdtempSync(join(tmpdir(), 'pdr-tunnel-'))
  const tunnel = createTunnel({
    targetUrl: 'http://127.0.0.1:8080/',
    bin: null,
    spawnImpl: () => {
      spawnCalls += 1
      return makeFakeChild()
    },
    stateFile: join(dir, 'tunnel.json'),
  })
  t.after(() => {
    tunnel.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  assert.equal(tunnel.state().available, false)
  assert.equal(tunnel.state().binary, null)
  const state = await tunnel.start()
  assert.equal(spawnCalls, 0)
  assert.equal(state.status, 'error')
  assert.match(state.error, /not found/)
  assert.equal((await tunnel.refresh()).status, 'error')
  assert.equal(spawnCalls, 0)
})
