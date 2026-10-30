/**
 * Regression test: every model-tool output must be a lossless JSON value.
 *
 * DSH rejects tool results whose JSON round-trip drops or changes data (the
 * live failure was `tool "paper_deepread" returned invalid output: value is not
 * lossless JSON` because paper #2 has no DOI and publicPaper used
 * `doi: paper.doi || undefined`).
 *
 * Run with: node --test tests/lossless.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createManager } from '../src/manager.js'
import { losslessToolResult, toLosslessJson } from '../src/lossless.js'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const REAL_LIBRARY = join(REPO, 'library')

/** Fail on values that cannot survive JSON.stringify/parse unchanged. */
function assertLosslessJson(value, path = '$') {
  if (value === undefined) assert.fail(`${path}: undefined is not a JSON value`)
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path}: ${value} is not a finite JSON number`)
    return
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    assert.fail(`${path}: ${typeof value} is not a JSON value`)
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertLosslessJson(item, `${path}[${index}]`))
    return
  }
  assert.equal(typeof value, 'object', `${path}: unsupported value`)
  for (const [key, item] of Object.entries(value)) {
    assert.notEqual(item, undefined, `${path}.${key}: undefined is not a JSON value`)
    assertLosslessJson(item, `${path}.${key}`)
  }
}

/** A payload is lossless when serialize->parse returns an identical structure. */
function assertRoundTrip(value, label) {
  assertLosslessJson(value, label)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(value)), value,
    `${label}: JSON round-trip lost or changed data`)
}

function buildTools() {
  const dataDir = mkdtempSync(join(tmpdir(), 'pdr-lossless-'))
  const manager = createManager({
    packageDir: REPO,
    config: { dataDir, libraryDir: REAL_LIBRARY },
  })
  const fakeDefineTool = options => options
  const tools = manager.tools(fakeDefineTool)
  return { manager, tools, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) }
}

async function addSyntheticUpload(manager) {
  const id = '20261030T120000-dead'
  await manager.store.addUpload({
    id,
    name: 'Lossless 测试 paper.pdf',
    bytes: 1234,
    pdfRelative: `uploads/${id}.pdf`,
  })
  await manager.store.patchUpload(id, { status: 'failed', message: 'synthetic failure (lossless test)' })
  return id
}

test('real bundled library: catalogue list/query/id outputs are lossless JSON', async () => {
  const { tools, cleanup } = buildTools()
  try {
    const [catalogue] = tools
    const list = await catalogue.execute({}, {})
    assertRoundTrip(list, 'paper_deepread list')
    assert.equal(list.ok, true)
    assert.ok(list.papers.length >= 4)

    // The 2nd bundled paper has no DOI: after the fix the key must be omitted,
    // never present with an undefined value.
    const noDoi = list.papers.find(paper => !paper.doi)
    assert.ok(noDoi, 'expected one bundled paper without a DOI')
    assert.equal(Object.hasOwn(noDoi, 'doi'), false,
      'absent DOI must be omitted from the tool output, not left undefined')

    const search = await catalogue.execute({ query: 'cryo' }, {})
    assertRoundTrip(search, 'paper_deepread query')
    assert.ok(search.total >= 1)
    search.results.forEach((hit, index) => assertRoundTrip(hit, `search hit ${index}`))

    const one = await catalogue.execute({ id: list.papers[1].id }, {})
    assertRoundTrip(one, 'paper_deepread id')
    const missing = await catalogue.execute({ id: 'definitely-not-a-paper' }, {})
    assertRoundTrip(missing, 'paper_deepread missing id')
  } finally { cleanup() }
})

test('uploads tool outputs are lossless JSON (synthetic upload record)', async () => {
  const { manager, tools, cleanup } = buildTools()
  try {
    const uploads = tools[1]
    const id = await addSyntheticUpload(manager)
    const list = await uploads.execute({ action: 'list' }, {})
    assertRoundTrip(list, 'paper_deepread_uploads list')
    const synthetic = list.uploads.find(entry => entry.id === id)
    assert.ok(synthetic, 'synthetic upload record should be listed')
    assert.equal(synthetic.status, 'failed')
    const deleted = await uploads.execute({ action: 'delete', id: 'no-such-upload' }, {})
    assertRoundTrip(deleted, 'paper_deepread_uploads delete error')
  } finally { cleanup() }
})

test('reports tool outputs are lossless JSON on the real bundled library', async () => {
  const { tools, cleanup } = buildTools()
  try {
    const reports = tools[2]
    const list = await reports.execute({ action: 'list' }, {})
    assertRoundTrip(list, 'paper_deepread_reports list')
    assert.ok(list.reports.length >= 4)
    list.reports.forEach((report, index) => assertRoundTrip(report, `report ${index}`))
    const missing = await reports.execute({ action: 'hide', dir: '../etc', hide: true }, {})
    assertRoundTrip(missing, 'paper_deepread_reports bad dir')
    const badBuild = await reports.execute({ action: 'build', id: 'no-such-upload' }, {})
    assertRoundTrip(badBuild, 'paper_deepread_reports bad build')
  } finally { cleanup() }
})


test('toLosslessJson drops undefined properties and sanitizes array holes', () => {
  const source = {
    keep: 'value',
    absent: undefined,
    nested: { a: 1, b: undefined, c: NaN, d: Infinity, e: -Infinity },
    list: [1, undefined, NaN, { x: undefined, y: 2 }],
  }
  const clean = losslessToolResult(source)
  assert.deepStrictEqual(clean, {
    keep: 'value',
    nested: { a: 1, c: null, d: null, e: null },
    list: [1, null, null, { y: 2 }],
  })
  assertRoundTrip(clean, 'toLosslessJson output')

  const cyclic = { name: 'cycle' }
  cyclic.self = cyclic
  const converted = toLosslessJson(cyclic)
  assert.deepStrictEqual(converted, { name: 'cycle', self: null })
  assertRoundTrip(converted, 'cycle sanitized')

  assert.deepStrictEqual(losslessToolResult(undefined), {})
  assert.deepStrictEqual(losslessToolResult([undefined, 1]), [null, 1])
})
