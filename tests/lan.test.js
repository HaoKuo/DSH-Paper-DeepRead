/**
 * Tests for the read-only LAN fallback server (`src/lan.js`).
 *
 * Hermetic: binds only an ephemeral loopback-bindable port on 0.0.0.0 and
 * always stops the server, so no port or process is leaked.
 *
 * Run with: node --test tests/lan.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createLanServer } from '../src/lan.js'

/** Temporary 文献精读库 root with an index page and one report. */
function makeLibrary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-lan-lib-'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>LAN index 文献精读库</body></html>')
  mkdirSync(join(dir, '2025-Journal-Paper'))
  writeFileSync(join(dir, '2025-Journal-Paper', 'report.html'), '<html><body>report body</body></html>')
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Temporary state directory for a `lan-server.json`. */
function makeStateDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-lan-state-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('ensure listens on an ephemeral port and serves the library index', async t => {
  const libraryDir = makeLibrary(t)
  const stateDir = makeStateDir(t)
  const stateFile = join(stateDir, 'lan-server.json')
  const server = createLanServer({ libraryDir, port: 0, stateFile })
  t.after(() => server.stop())
  const first = await server.ensure()
  assert.equal(first.started, true)
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u)
  assert.ok(first.port > 0)
  // Chosen port is persisted for the next activation.
  assert.equal(JSON.parse(readFileSync(stateFile, 'utf8')).port, first.port)
  // Idempotent: the same server is reused.
  const second = await server.ensure()
  assert.equal(second.started, false)
  assert.equal(second.port, first.port)
  // Root serves index.html through the /paper-deepread rewrite.
  const index = await fetch(first.url)
  assert.equal(index.status, 200)
  assert.match(index.headers.get('content-type'), /text\/html/)
  assert.match(await index.text(), /LAN index/)
  // Nested report paths are relative to the library root.
  const report = await fetch(`${first.url}2025-Journal-Paper/report.html`)
  assert.equal(report.status, 200)
  assert.match(await report.text(), /report body/)
  // HEAD is answered without a body.
  const head = await fetch(first.url, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
})

test('the LAN server is read-only: unknown paths 404 and writes 405', async t => {
  const libraryDir = makeLibrary(t)
  const server = createLanServer({ libraryDir, port: 0 })
  t.after(() => server.stop())
  const { url } = await server.ensure()
  const missing = await fetch(`${url}no-such-file.html`)
  assert.equal(missing.status, 404)
  const traversal = await fetch(`${url}%2e%2e/%2e%2e/etc/passwd`)
  assert.equal(traversal.status, 404)
  const post = await fetch(url, { method: 'POST', body: 'x' })
  assert.equal(post.status, 405)
  // No management API is exposed by the fallback server.
  const api = await fetch(`${url}paper-deepread/api/state`)
  assert.equal(api.status, 404)
})

test('stop closes the bound port', async t => {
  const libraryDir = makeLibrary(t)
  const server = createLanServer({ libraryDir, port: 0 })
  const { url } = await server.ensure()
  await server.stop()
  await assert.rejects(fetch(url), /fetch failed|ECONNREFUSED/u)
  // Stopping an already stopped server is a no-op.
  await server.stop()
})

test('a previously bound port is reused when it is still free', async t => {
  const libraryDir = makeLibrary(t)
  const stateFile = join(makeStateDir(t), 'lan-server.json')
  const first = createLanServer({ libraryDir, port: 0, stateFile })
  const bound = await first.ensure()
  await first.stop()
  const second = createLanServer({ libraryDir, port: 0, stateFile })
  t.after(() => second.stop())
  const reused = await second.ensure()
  assert.equal(reused.port, bound.port)
  assert.equal(reused.url, bound.url)
})

test('an explicitly configured port wins over the remembered one', async t => {
  const libraryDir = makeLibrary(t)
  const stateFile = join(makeStateDir(t), 'lan-server.json')
  const probe = createLanServer({ libraryDir, port: 0, stateFile })
  const ephemeral = await probe.ensure()
  await probe.stop()
  const explicit = createLanServer({ libraryDir, port: ephemeral.port, stateFile })
  t.after(() => explicit.stop())
  const bound = await explicit.ensure()
  assert.equal(bound.port, ephemeral.port)
})

test('a library without index.html still starts but serves 404', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pdr-lan-empty-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const server = createLanServer({ libraryDir: dir, port: 0 })
  t.after(() => server.stop())
  const { url } = await server.ensure()
  const response = await fetch(url)
  assert.equal(response.status, 404)
})
