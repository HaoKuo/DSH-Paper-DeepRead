/**
 * Standalone-site integration tests (v1.2.0).
 *
 * Covers the `siteUrl` config, the health proxy cache, the raw upload proxy
 * (filename/content-type/token forwarding, verbatim duplicate payloads), the
 * unconfigured/unreachable states, and the new state/tool fields.
 *
 * Everything runs against a throwaway local `node:http` mock server and a
 * disposable data directory — no real site, no network.
 *
 * Run with: node --test tests/site.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

import { createManager } from '../src/manager.js'
import { createLibraryHandler } from '../src/route.js'
import {
  SITE_HEALTH_CACHE_MS,
  createSiteProxy,
  normalizeSiteUrl,
} from '../src/site.js'
import { makeFixture, pdfBody, startFixtureServer } from './helpers.js'

/** Write one JSON response. */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length) })
  res.end(body)
}

const DEFAULT_HEALTH = {
  ok: true,
  version: '1.4.0',
  uptimeSeconds: 42,
  queue: { uploaded: 2, processing: 1 },
  worker: { online: true, lastHeartbeat: '2026-10-30T12:00:00Z', concurrency: 2 },
  library: { count: 5, version: '1.4.0' },
}

/**
 * Throwaway stand-in for `deploy/serve.py`.
 * @param {{health?: object|Function, upload?: object|Function}} [handlers]
 */
async function startMockSite(handlers = {}) {
  const requests = []
  const pick = (value, entry) => (typeof value === 'function' ? value(entry) : value)
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }
    requests.push(entry)
    if (entry.url === '/api/health') {
      const result = pick(handlers.health, entry) ?? { status: 200, payload: DEFAULT_HEALTH }
      return sendJson(res, result.status ?? 200, result.payload ?? result)
    }
    if (entry.url === '/api/upload') {
      const result = pick(handlers.upload, entry) ?? {
        status: 201,
        payload: { ok: true, upload: { id: 'site-upload-1', name: 'paper.pdf', status: 'uploaded' }, queue: 1 },
      }
      return sendJson(res, result.status ?? 201, result.payload ?? result)
    }
    return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown route' } })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    healthRequests: () => requests.filter(entry => entry.url === '/api/health').length,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** Boot a managed fixture whose manager points at `siteUrl` (when given). */
async function bootPlugin(siteUrl) {
  const fixture = makeFixture({ maxUploadBytes: 4096 })
  const manager = createManager({
    packageDir: fixture.packageDir,
    config: siteUrl ? { ...fixture.config, siteUrl } : fixture.config,
  })
  const server = await startFixtureServer(manager, manager.store.libraryRoot, createLibraryHandler)
  return { fixture, manager, server }
}

test('normalizeSiteUrl keeps http(s) bases and rejects unusable values', () => {
  assert.equal(normalizeSiteUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080')
  assert.equal(normalizeSiteUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080')
  assert.equal(normalizeSiteUrl('  http://127.0.0.1:8080/kb///  '), 'http://127.0.0.1:8080/kb')
  assert.equal(normalizeSiteUrl('https://example.test?x=1#frag'), 'https://example.test')
  assert.equal(normalizeSiteUrl(''), '')
  assert.equal(normalizeSiteUrl('   '), '')
  assert.equal(normalizeSiteUrl(undefined), '')
  assert.equal(normalizeSiteUrl('/relative/path'), '')
  assert.equal(normalizeSiteUrl('ftp://127.0.0.1/'), '')
  assert.equal(normalizeSiteUrl('not a url'), '')
})

test('createSiteProxy caches health for the configured window and reports failures', async () => {
  let calls = 0
  let nowMs = 0
  const proxy = createSiteProxy({
    siteUrl: 'http://127.0.0.1:8080/',
    now: () => nowMs,
    fetchImpl: async (url) => {
      calls += 1
      assert.equal(url, 'http://127.0.0.1:8080/api/health')
      return new Response(JSON.stringify({ ok: true, version: '1.4.0', worker: { online: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(proxy.configured, true)
  assert.deepEqual(proxy.describe(), { configured: true, url: 'http://127.0.0.1:8080' })
  const first = await proxy.health()
  assert.equal(first.ok, true)
  assert.equal(first.configured, true)
  assert.equal(first.version, '1.4.0')
  nowMs = SITE_HEALTH_CACHE_MS - 1
  assert.equal((await proxy.health()).version, '1.4.0')
  assert.equal(calls, 1, 'health must be served from cache within the window')
  nowMs = SITE_HEALTH_CACHE_MS
  await proxy.health()
  assert.equal(calls, 2, 'the cache must expire after the window')

  const timeoutProxy = createSiteProxy({
    siteUrl: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) },
  })
  const timedOut = await timeoutProxy.health()
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.configured, true)
  assert.equal(timedOut.error.code, 'SITE_TIMEOUT')

  const refusedProxy = createSiteProxy({
    siteUrl: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED') },
  })
  const refused = await refusedProxy.health()
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'SITE_UNREACHABLE')

  const disabled = createSiteProxy({})
  assert.equal(disabled.configured, false)
  assert.deepEqual(await disabled.health(), { configured: false })
  await assert.rejects(disabled.upload({ req: null }), /siteUrl is not configured/)
})

test('GET api/state exposes site config and both skill versions', async () => {
  const site = await startMockSite()
  const { fixture, manager, server } = await bootPlugin(site.base)
  try {
    const state = await (await fetch(`${server.base}/paper-deepread/api/state`)).json()
    assert.equal(state.ok, true)
    assert.deepEqual(state.site, { configured: true, url: site.base })
    assert.equal(state.skillVersion, '1.1.5')
    assert.equal(state.installedSkillVersion, '')
    assert.equal(state.skill.installed, true)
    assert.equal(state.skill.installedPresent, false)
    assert.equal(state.skill.syncMode, 'update')
    assert.equal(state.version, '1.2.0')

    const tools = manager.tools(options => options)
    const catalogue = await tools[0].execute({}, {})
    assert.equal(catalogue.ok, true)
    assert.equal(catalogue.library.skillVersion, '1.1.5')
    assert.equal(catalogue.library.installedSkillVersion, '')
    assert.deepEqual(catalogue.library.site, { configured: true, url: site.base })
    // Tool payloads must stay lossless JSON.
    assert.deepStrictEqual(JSON.parse(JSON.stringify(catalogue)), catalogue)
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('GET api/site/health proxies site health and caches it', async () => {
  const site = await startMockSite()
  const { fixture, server } = await bootPlugin(site.base)
  try {
    const first = await fetch(`${server.base}/paper-deepread/api/site/health`)
    assert.equal(first.status, 200)
    assert.match(first.headers.get('content-type'), /application\/json/)
    const body = await first.json()
    assert.equal(body.configured, true)
    assert.equal(body.ok, true)
    assert.equal(body.url, site.base)
    assert.equal(body.version, '1.4.0')
    assert.equal(body.worker.online, true)
    assert.equal(body.queue.uploaded, 2)
    assert.equal(body.library.count, 5)
    const second = await (await fetch(`${server.base}/paper-deepread/api/site/health`)).json()
    assert.equal(second.version, '1.4.0')
    assert.equal(site.healthRequests(), 1, 'the plugin proxy must cache health for 5 s')
    assert.equal(site.requests[0].method, 'GET')
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('POST api/site/upload forwards filename/content-type/token and returns the site JSON verbatim', async () => {
  const site = await startMockSite()
  const { fixture, server } = await bootPlugin(site.base)
  try {
    const pdf = pdfBody(256)
    const response = await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-filename': encodeURIComponent('论文 one.pdf'),
        'x-kb-upload-token': 'test-upload-token',
      },
      body: pdf,
    })
    assert.equal(response.status, 201)
    assert.match(response.headers.get('content-type'), /application\/json/)
    const body = await response.json()
    assert.deepEqual(body, { ok: true, upload: { id: 'site-upload-1', name: 'paper.pdf', status: 'uploaded' }, queue: 1 })
    const forwarded = site.requests.find(entry => entry.url === '/api/upload')
    assert.ok(forwarded, 'the site must receive the proxied upload')
    assert.equal(forwarded.method, 'POST')
    assert.equal(forwarded.headers['x-filename'], encodeURIComponent('论文 one.pdf'))
    assert.equal(forwarded.headers['content-type'], 'application/pdf')
    assert.equal(forwarded.headers['x-kb-upload-token'], 'test-upload-token')
    assert.equal(forwarded.body.length, pdf.length)
    assert.equal(forwarded.body.subarray(0, 5).toString(), '%PDF-')
    // No token header is invented when the browser does not send one.
    await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'plain.pdf' },
      body: pdfBody(64),
    })
    const plain = site.requests.filter(entry => entry.url === '/api/upload').at(-1)
    assert.equal(plain.body.length, 64)
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('duplicate and possible-duplicate upload payloads pass through unchanged', async () => {
  const duplicate = {
    ok: true,
    duplicate: { kind: 'report', sha256: 'abc', report: { dir: '2025-Journal-Paper', title: 'Paper' }, hint: '文献库中已有这篇 PDF 的精读报告' },
    message: '文献库中已有这篇 PDF 的精读报告；如需重新精读请管理员使用「强制重新精读」',
  }
  const site = await startMockSite({ upload: { status: 200, payload: duplicate } })
  const { fixture, server } = await bootPlugin(site.base)
  try {
    const response = await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'dup.pdf' },
      body: pdfBody(128),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), duplicate)
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('site errors are proxied with their HTTP status and JSON body', async () => {
  const unauthorized = { ok: false, error: { code: 'UPLOAD_TOKEN_REQUIRED', message: 'upload token required' } }
  const site = await startMockSite({ upload: { status: 401, payload: unauthorized } })
  const { fixture, server } = await bootPlugin(site.base)
  try {
    const response = await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'x.pdf' },
      body: pdfBody(64),
    })
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), unauthorized)
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('health proxy preserves an unhealthy upstream payload', async () => {
  const unhealthy = { ok: false, error: { code: 'SITE_MAINTENANCE', message: '正在维护' } }
  const site = await startMockSite({ health: { status: 503, payload: unhealthy } })
  const { fixture, server } = await bootPlugin(site.base)
  try {
    const body = await (await fetch(`${server.base}/paper-deepread/api/site/health`)).json()
    assert.equal(body.configured, true)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'SITE_MAINTENANCE')
  } finally { await server.close(); await site.close(); fixture.cleanup() }
})

test('without siteUrl the feature stays disabled and the local API is unchanged', async () => {
  const { fixture, server } = await bootPlugin('')
  try {
    const state = await (await fetch(`${server.base}/paper-deepread/api/state`)).json()
    assert.deepEqual(state.site, { configured: false, url: '' })
    const health = await fetch(`${server.base}/paper-deepread/api/site/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { configured: false })
    const upload = await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'x.pdf' },
      body: pdfBody(64),
    })
    assert.equal(upload.status, 503)
    assert.equal((await upload.json()).error.code, 'SITE_NOT_CONFIGURED')
  } finally { await server.close(); fixture.cleanup() }
})

test('an unreachable site degrades to a structured error', async () => {
  // Port 1 is not served by the test environment.
  const { fixture, server } = await bootPlugin('http://127.0.0.1:1')
  try {
    const health = await (await fetch(`${server.base}/paper-deepread/api/site/health`)).json()
    assert.equal(health.configured, true)
    assert.equal(health.ok, false)
    assert.match(health.error.code, /SITE_UNREACHABLE|SITE_TIMEOUT/u)
    const upload = await fetch(`${server.base}/paper-deepread/api/site/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': 'x.pdf' },
      body: pdfBody(64),
    })
    assert.equal(upload.status, 502)
    assert.match((await upload.json()).error.code, /SITE_UNREACHABLE|SITE_TIMEOUT/u)
  } finally { await server.close(); fixture.cleanup() }
})

test('an invalid siteUrl is ignored with a warning', async () => {
  const fixture = makeFixture()
  try {
    const warnings = []
    const manager = createManager({
      packageDir: fixture.packageDir,
      config: { ...fixture.config, siteUrl: 'not-a-url' },
      logger: { warn: message => warnings.push(message), info: () => {} },
    })
    assert.deepEqual(manager.site.describe(), { configured: false, url: '' })
    assert.match(warnings.join('\n'), /ignoring invalid siteUrl/u)
  } finally { fixture.cleanup() }
})
