/**
 * API + tool wiring tests for the v1.1.0 managed library.
 * Run with: node --test tests/api.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createManager } from '../src/manager.js'
import { createLibraryHandler } from '../src/route.js'
import { makeFixture, makeReportDirectory, pdfBody, startFixtureServer } from './helpers.js'

const JSON_HEADERS = { 'content-type': 'application/json' }

async function bootManagedFixture() {
  const fixture = makeFixture({ maxUploadBytes: 2048 })
  const manager = createManager({ packageDir: fixture.packageDir, config: fixture.config })
  const server = await startFixtureServer(manager, manager.store.libraryRoot, createLibraryHandler)
  return { fixture, manager, server }
}

test('GET api/state reports the managed library, skill, and limits', async () => {
  const { fixture, manager, server } = await bootManagedFixture()
  try {
    const response = await fetch(`${server.base}/paper-deepread/api/state`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/json/)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.library.count, 1)
    assert.equal(body.library.managed, true)
    assert.equal(body.library.root, manager.store.libraryRoot)
    assert.equal(body.dataDir, fixture.dataDir)
    assert.equal(body.limits.maxUploadBytes, 2048)
    assert.deepEqual(body.uploads, [])
    assert.equal(body.reports.length, 1)
    assert.equal(body.reports[0].dir, '2025-Journal-Seeded paper')
    assert.equal(body.skill.installed, true)
    // v1.2.0: bundled/installed skill versions and the optional site config.
    assert.equal(body.skillVersion, '1.1.5')
    assert.equal(body.installedSkillVersion, '')
    assert.equal(body.skill.syncMode, 'update')
    assert.deepEqual(body.site, { configured: false, url: '' })
    assert.equal(body.version, '1.5.2')
    assert.equal(typeof body.python.ok, 'boolean')
    // Static route still works next to the API.
    const staticResponse = await fetch(`${server.base}/paper-deepread/index.html`)
    assert.equal(staticResponse.status, 200)
    assert.match(await staticResponse.text(), /library-data/)
  } finally { await server.close(); fixture.cleanup() }
})

test('upload endpoint accepts a PDF and state reflects it', async () => {
  const { fixture, manager, server } = await bootManagedFixture()
  try {
    const response = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent('My paper.pdf') },
      body: pdfBody(512),
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.upload.status, 'uploaded')
    assert.equal(body.upload.name, 'My paper.pdf')
    assert.equal(body.upload.bytes, 512)
    assert.ok(existsSync(body.upload.pdfPath))
    assert.ok(body.upload.pdfPath.startsWith(manager.store.uploadsDir))
    const state = await (await fetch(`${server.base}/paper-deepread/api/state`)).json()
    assert.equal(state.uploads.length, 1)
    assert.equal(state.uploads[0].pending, true)
    // Traversal filename is reduced to its base name and never writes outside.
    const traversal = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-filename': encodeURIComponent('../../etc/passwd') },
      body: pdfBody(64),
    })
    assert.equal(traversal.status, 201)
    assert.equal((await traversal.json()).upload.name, 'passwd.pdf')
    assert.equal(existsSync(join(fixture.base, 'etc')), false)
  } finally { await server.close(); fixture.cleanup() }
})

test('upload rejects bad content type, missing magic, oversized bodies, and missing filename', async () => {
  const { fixture, server } = await bootManagedFixture()
  try {
    const wrongType = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST', headers: { 'content-type': 'text/plain', 'x-filename': 'a.pdf' }, body: pdfBody(32),
    })
    assert.equal(wrongType.status, 415)
    const noMagic = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST', headers: { 'content-type': 'application/pdf', 'x-filename': 'a.pdf' }, body: '<html>not a pdf</html>',
    })
    assert.equal(noMagic.status, 415)
    assert.equal((await noMagic.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')
    const oversized = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST', headers: { 'content-type': 'application/pdf', 'x-filename': 'big.pdf' }, body: pdfBody(4096),
    })
    assert.equal(oversized.status, 413)
    const noName = await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST', headers: { 'content-type': 'application/pdf' }, body: pdfBody(32),
    })
    assert.equal(noName.status, 400)
    assert.equal((await noName.json()).error.code, 'BAD_FILENAME')
  } finally { await server.close(); fixture.cleanup() }
})

test('methods and unknown routes return structured errors', async () => {
  const { fixture, server } = await bootManagedFixture()
  try {
    const getUpload = await fetch(`${server.base}/paper-deepread/api/upload`)
    assert.equal(getUpload.status, 405)
    const statePost = await fetch(`${server.base}/paper-deepread/api/state`, { method: 'POST', headers: JSON_HEADERS, body: '{}' })
    assert.equal(statePost.status, 405)
    const unknown = await fetch(`${server.base}/paper-deepread/api/nope`)
    assert.equal(unknown.status, 404)
    assert.equal((await unknown.json()).error.code, 'NOT_FOUND')
    const plainBody = await fetch(`${server.base}/paper-deepread/api/reports/delete`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
    })
    assert.equal(plainBody.status, 415)
  } finally { await server.close(); fixture.cleanup() }
})

test('rebuild, visibility, and delete endpoints operate on the managed root', async () => {
  const { fixture, manager, server } = await bootManagedFixture()
  try {
    const rebuild = await fetch(`${server.base}/paper-deepread/api/reports/rebuild`, {
      method: 'POST', headers: JSON_HEADERS, body: '{}',
    })
    assert.equal(rebuild.status, 200)
    const rebuilt = await rebuild.json()
    assert.equal(rebuilt.ok, true)
    assert.equal(rebuilt.stats.n, 1)
    assert.ok(existsSync(join(manager.store.libraryRoot, 'index.html')))
    const fake = makeReportDirectory(manager.store.libraryRoot, '2026-bioRxiv-Fake paper', { title: 'Fake paper', year: '2026', journal: 'bioRxiv' })
    const visibility = await fetch(`${server.base}/paper-deepread/api/reports/visibility`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ dir: '2026-bioRxiv-Fake paper', hidden: true }),
    })
    assert.equal(visibility.status, 200)
    assert.equal(JSON.parse(readFileSync(join(fake, 'library.json'), 'utf8')).hidden, true)
    const traversal = await fetch(`${server.base}/paper-deepread/api/reports/delete`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ dir: '../etc' }),
    })
    assert.equal(traversal.status, 400)
    const deleted = await fetch(`${server.base}/paper-deepread/api/reports/delete`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ dir: '2026-bioRxiv-Fake paper' }),
    })
    assert.equal(deleted.status, 200)
    assert.equal(existsSync(fake), false)
    assert.ok(existsSync(join(manager.store.libraryRoot, '2025-Journal-Seeded paper')))
  } finally { await server.close(); fixture.cleanup() }
})

test('uploads/delete removes the record, raw PDF, and work directory', async () => {
  const { fixture, manager, server } = await bootManagedFixture()
  try {
    const upload = await (await fetch(`${server.base}/paper-deepread/api/upload`, {
      method: 'POST', headers: { 'content-type': 'application/pdf', 'x-filename': 'del.pdf' }, body: pdfBody(128),
    })).json()
    writeFileSync(join(manager.store.workDir, upload.upload.id, 'art.txt'), 'x')
    const response = await fetch(`${server.base}/paper-deepread/api/uploads/delete`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: upload.upload.id }),
    })
    assert.equal(response.status, 200)
    assert.equal(existsSync(upload.upload.pdfPath), false)
    assert.equal(existsSync(join(manager.store.workDir, upload.upload.id)), false)
    const missing = await fetch(`${server.base}/paper-deepread/api/uploads/delete`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id: upload.upload.id }),
    })
    assert.equal(missing.status, 404)
  } finally { await server.close(); fixture.cleanup() }
})

test('model tools expose catalogue, uploads, and reports', async () => {
  const fixture = makeFixture({ maxUploadBytes: 2048 })
  try {
    const manager = createManager({ packageDir: fixture.packageDir, config: fixture.config })
    const fakeDefineTool = options => options
    const tools = manager.tools(fakeDefineTool)
    assert.deepEqual(tools.map(tool => tool.name), ['paper_deepread', 'paper_deepread_uploads', 'paper_deepread_reports'])
    const catalogue = await tools[0].execute({}, {})
    assert.equal(catalogue.ok, true)
    assert.equal(catalogue.mode, 'list')
    assert.equal(catalogue.papers.length, 1)
    assert.equal(catalogue.library.uploads.total, 0)
    const search = await tools[0].execute({ query: 'seeded' }, {})
    assert.equal(search.total, 1)
    const uploads = await tools[1].execute({ action: 'list' }, {})
    assert.equal(uploads.ok, true)
    assert.equal(uploads.counts.total, 0)
    const reports = await tools[2].execute({ action: 'list' }, {})
    assert.equal(reports.ok, true)
    assert.equal(reports.counts.total, 1)
    assert.equal(reports.reports[0].dir, '2025-Journal-Seeded paper')
    const rebuild = await tools[2].execute({ action: 'rebuild' }, {})
    assert.equal(rebuild.ok, true)
    assert.equal(rebuild.stats.n, 1)
    const unsafeHide = await tools[2].execute({ action: 'hide', dir: '../x', hide: true }, {})
    assert.equal(unsafeHide.ok, false)
    assert.match(unsafeHide.error, /BAD_DIR|unsafe/)
    const missingIngest = await tools[1].execute({ action: 'ingest', id: 'nope-nope' }, {})
    assert.equal(missingIngest.ok, false)
    assert.match(missingIngest.error, /BAD_ID|NOT_FOUND/)
  } finally { fixture.cleanup() }
})
