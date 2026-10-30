/**
 * Unit tests for the v1.1.0 host modules (standard library only).
 * Run with: node --test tests/units.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  PaperStore,
  atomicWriteJson,
  isPathInside,
  readJsonFile,
  safeChildDir,
} from '../src/store.js'
import {
  assertPdfBody,
  readRequestBody,
  sanitizeFilename,
  sanitizeFilename as sanitizeUploadFilename,
  writeUploadFile,
} from '../src/uploads.js'
import {
  buildIngestArgs,
  buildLibraryArgs,
  buildReportArgs,
  findSystemPython,
  runProcess,
} from '../src/python.js'
import {
  deleteReport,
  parseDirectoryName,
  rebuildLibrary,
  scanReports,
  setReportHidden,
} from '../src/reports.js'
import { makeFixture, makeReportDirectory, pdfBody } from './helpers.js'

test('sanitizeFilename strips paths, control characters, and enforces .pdf', () => {
  assert.equal(sanitizeFilename('paper one.pdf').name, 'paper one.pdf')
  assert.equal(sanitizeFilename('../../etc/passwd').name, 'passwd.pdf')
  assert.equal(sanitizeFilename('C:\\papers\\name.PDF').name, 'name.pdf')
  assert.equal(sanitizeFilename('weird\u0000name').name, 'weird name.pdf')
  assert.equal(sanitizeFilename('noext').name, 'noext.pdf')
  assert.throws(() => sanitizeFilename(''), /filename is empty|required/)
  assert.throws(() => sanitizeFilename('   '), /empty|required/)
  assert.throws(() => sanitizeFilename('%zz'), /percent-encoding/)
  assert.equal(sanitizeUploadFilename(encodeURIComponent('中文 论文.pdf')).name, '中文 论文.pdf')
  assert.ok(sanitizeFilename(`a${'b'.repeat(400)}.pdf`).stem.length <= 180)
})

test('assertPdfBody requires the %PDF- magic', () => {
  assert.doesNotThrow(() => assertPdfBody(pdfBody(64)))
  assert.throws(() => assertPdfBody(Buffer.from('<html>')), /not a PDF/)
  assert.throws(() => assertPdfBody(Buffer.alloc(0)), /not a PDF/)
})

test('readRequestBody enforces the byte limit', async () => {
  const make = chunks => ({ headers: {}, [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c } })
  assert.deepEqual((await readRequestBody(make([Buffer.from('abc')]), 16)).toString(), 'abc')
  await assert.rejects(readRequestBody(make([Buffer.alloc(8), Buffer.alloc(8)]), 10), /exceeds/)
  await assert.rejects(readRequestBody({ headers: { 'content-length': '99' }, [Symbol.asyncIterator]: async function* () {} }, 10), /exceeds/)
})

test('atomicWriteJson writes valid JSON and leaves no temp files', () => {
  const fixture = makeFixture()
  try {
    const file = join(fixture.base, 'nested', 'state.json')
    atomicWriteJson(file, { a: 1 })
    assert.deepEqual(readJsonFile(file), { a: 1 })
    assert.deepEqual(readdirSync(join(fixture.base, 'nested')), ['state.json'])
  } finally { fixture.cleanup() }
})

test('PaperStore seeds the managed library exactly once', () => {
  const fixture = makeFixture()
  try {
    const store = new PaperStore({ dataDir: fixture.dataDir, packageDir: fixture.packageDir }).ensure()
    assert.equal(store.managed, true)
    const index = join(store.libraryRoot, 'index.html')
    assert.ok(existsSync(index))
    assert.ok(existsSync(join(fixture.dataDir, '.seed.json')))
    // User edits must survive the next activation.
    writeFileSync(index, 'USER EDIT')
    const second = new PaperStore({ dataDir: fixture.dataDir, packageDir: fixture.packageDir }).ensure()
    assert.equal(readFileSync(join(second.libraryRoot, 'index.html'), 'utf8'), 'USER EDIT')
  } finally { fixture.cleanup() }
})

test('PaperStore uses a legacy external library root without seeding', () => {
  const fixture = makeFixture()
  try {
    const external = join(fixture.base, 'external-library')
    mkdirSync(external, { recursive: true })
    writeFileSync(join(external, 'index.html'), 'external index')
    const store = new PaperStore({ dataDir: fixture.dataDir, packageDir: fixture.packageDir, legacyLibraryDir: external }).ensure()
    assert.equal(store.managed, false)
    assert.equal(store.libraryRoot, external)
    assert.equal(readFileSync(join(external, 'index.html'), 'utf8'), 'external index')
    assert.equal(existsSync(join(fixture.dataDir, '.seed.json')), false)
  } finally { fixture.cleanup() }
})

test('state writes are serialized and uploads round-trip', async () => {
  const fixture = makeFixture()
  try {
    const store = new PaperStore({ dataDir: fixture.dataDir, packageDir: fixture.packageDir }).ensure()
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.addUpload({
      id: `2026103012000${index}-abcd`, name: `p${index}.pdf`, bytes: 10, pdfRelative: `p${index}.pdf`,
    })))
    assert.equal(store.listUploads().length, 5)
    assert.equal(store.getUpload('20261030120000-abcd').pdfPath.endsWith('p0.pdf'), true)
    await store.patchUpload('20261030120000-abcd', { status: 'ingested' })
    assert.equal(store.getUpload('20261030120000-abcd').status, 'ingested')
    await store.removeUpload('20261030120000-abcd')
    assert.equal(store.listUploads().length, 4)
    assert.throws(() => store.getUpload('../etc'), /invalid upload id/)
    assert.throws(() => store.getUpload('20261030999999-ffff'), /not found/)
  } finally { fixture.cleanup() }
})

test('safeChildDir rejects traversal, absolute paths, files, and the root', () => {
  const fixture = makeFixture()
  try {
    const root = fixture.libraryDir
    const child = safeChildDir(root, '2025-Journal-Seeded paper')
    assert.ok(child.endsWith('2025-Journal-Seeded paper'))
    for (const bad of ['..', '.', '../etc', '/etc/passwd', 'a/b', '', 'index.html']) {
      assert.throws(() => safeChildDir(root, bad), /unsafe report directory|not found|must be a direct child|required|not a real directory/)
    }
    assert.ok(isPathInside(root, join(root, 'x')))
    assert.equal(isPathInside(root, join(root, '..', 'x')), false)
  } finally { fixture.cleanup() }
})

test('scanReports reads metadata, visibility, RAWs, and URLs', () => {
  const fixture = makeFixture()
  try {
    const root = fixture.libraryDir
    makeReportDirectory(root, '2026-bioRxiv-Test paper', { title: 'Test paper', year: '2026', journal: 'bioRxiv', categories: ['AI'] })
    writeFileSync(join(root, '2026-bioRxiv-Test paper', 'library.json'), JSON.stringify({ hidden: true, tags: ['x'] }))
    const reports = scanReports(root)
    assert.equal(reports.length, 2)
    const hidden = reports.find(entry => entry.dir === '2026-bioRxiv-Test paper')
    assert.equal(hidden.hidden, true)
    assert.equal(hidden.title, 'Test paper')
    assert.equal(hidden.year, '2026')
    assert.match(hidden.reportUrl, /^\/paper-deepread\/2026-bioRxiv-Test%20paper\//)
    assert.match(hidden.rawUrl, /RAW-/)
    assert.ok(hidden.rawPdfPath.endsWith('.pdf'))
    assert.equal(parseDirectoryName('2025-Nature Communications-Deep stuff').journal, 'Nature Communications')
  } finally { fixture.cleanup() }
})

test('visibility merges library.json and delete removes only that directory', () => {
  const fixture = makeFixture()
  try {
    const root = fixture.libraryDir
    const directory = makeReportDirectory(root, '2025-Journal-Keep me', { title: 'Keep me' })
    writeFileSync(join(directory, 'library.json'), JSON.stringify({ categories: ['AI'], tags: ['t'] }))
    setReportHidden(root, '2025-Journal-Keep me', true)
    let override = JSON.parse(readFileSync(join(directory, 'library.json'), 'utf8'))
    assert.equal(override.hidden, true)
    assert.deepEqual(override.categories, ['AI'])
    assert.deepEqual(override.tags, ['t'])
    setReportHidden(root, '2025-Journal-Keep me', false)
    override = JSON.parse(readFileSync(join(directory, 'library.json'), 'utf8'))
    assert.equal(override.hidden, false)
    assert.throws(() => setReportHidden(root, '..', true), /unsafe|must be/)
    assert.throws(() => setReportHidden(root, '/tmp', true), /unsafe|must be/)
    assert.throws(() => setReportHidden(root, 'missing-dir', true), /not found/)
    assert.throws(() => setReportHidden(root, '2025-Journal-Keep me', 'yes'), /boolean/)
    deleteReport(root, '2025-Journal-Keep me')
    assert.equal(existsSync(directory), false)
    assert.ok(existsSync(join(root, 'index.html')))
    assert.throws(() => deleteReport(root, '../'), /unsafe|must be/)
  } finally { fixture.cleanup() }
})

test('python command builders produce the skill CLI argv', () => {
  const skill = '/skill'
  assert.deepEqual(buildIngestArgs({ skillDir: skill, pdf: '/p.pdf', outDir: '/out' }), ['/skill/scripts/paper_ingest.py', '/p.pdf', '--out', '/out', '--debug'])
  const report = buildReportArgs({ skillDir: skill, template: '/t.html', content: '/c.html', meta: '/m.json', figures: '/f.json', figBase: '/fb', paperRoot: '/lib', name: 'N', sourcePdf: '/raw.pdf' })
  assert.deepEqual(report.slice(0, 2), ['/skill/scripts/build_report.py', '--template'])
  for (const expected of ['/t.html', '/c.html', '/m.json', '/f.json', '--fig-base', '/fb', '--paper-root', '/lib', '--name', 'N', '--source-pdf', '/raw.pdf']) {
    assert.ok(report.includes(expected), `missing ${expected}`)
  }
  const library = buildLibraryArgs({ skillDir: skill, template: '/t.html', root: '/lib', out: '/lib/index.html', md: '/lib/index.md', thumbs: false })
  assert.deepEqual(library, ['/skill/scripts/build_library.py', '--root', '/lib', '--template', '/t.html', '--out', '/lib/index.html', '--md', '/lib/index.md', '--no-thumbs', '--no-thumb-cache'])
})

test('runProcess captures output, exit codes, and timeouts', async () => {
  const ok = await runProcess(process.execPath, ['-e', 'process.stdout.write("hello")'], { timeoutMs: 10_000 })
  assert.equal(ok.ok, true)
  assert.equal(ok.stdout, 'hello')
  const bad = await runProcess(process.execPath, ['-e', 'process.exit(3)'], { timeoutMs: 10_000 })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 3)
  const slow = await runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 200 })
  assert.equal(slow.ok, false)
  assert.equal(slow.timedOut, true)
  assert.ok(findSystemPython())
})

test('rebuildLibrary runs the skill script through a python3', async () => {
  const fixture = makeFixture()
  try {
    const rendered = await rebuildLibrary({
      root: fixture.libraryDir,
      skillDir: fixture.skillDir,
      python: { quick: async () => null },
    })
    assert.equal(rendered.ok, true, rendered.error)
    assert.equal(rendered.stats.n, 1)
    assert.match(readFileSync(join(fixture.libraryDir, 'index.html'), 'utf8'), /library-data/)
  } finally { fixture.cleanup() }
})

test('writeUploadFile stores bytes and cleanup helpers are path-safe', async () => {
  const fixture = makeFixture()
  try {
    const store = new PaperStore({ dataDir: fixture.dataDir, packageDir: fixture.packageDir }).ensure()
    const saved = writeUploadFile(store, { name: 'x.pdf', bytes: pdfBody(64) })
    assert.ok(saved.pdfPath.startsWith(store.uploadsDir))
    assert.equal(readFileSync(saved.pdfPath).length, 64)
    const { removeFileQuietly } = await import('../src/uploads.js')
    removeFileQuietly(saved.pdfPath)
    assert.equal(existsSync(saved.pdfPath), false)
  } finally { fixture.cleanup() }
})
