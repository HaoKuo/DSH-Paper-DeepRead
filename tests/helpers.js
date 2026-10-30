/**
 * Shared fixtures for DSH-Paper-DeepRead unit/API tests.
 *
 * Creates a disposable package root (minimal `library/` + stub skill scripts)
 * and a disposable data directory, so tests never touch a real profile or the
 * user's 文献精读库.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Minimal library index the host parser accepts. */
export function libraryIndexHtml({ title = '文献精读库', version = '9.9.9', papers = [], stats = {} } = {}) {
  const data = { papers, stats: { n: papers.length, version, updated: '2026-10-30', ...stats } }
  return `<!doctype html><html><head><title>Paper Deepread</title>
<meta name="library-version" content="${version}">
</head><body>
<div id="libraryTitleSrc" hidden>${title}</div>
<div id="buildDateSrc" hidden>2026-10-30</div>
<script id="library-data" type="application/json">${JSON.stringify(data)}</script>
</body></html>`
}

/** One fake report directory with an embedded report-meta block. */
export function makeReportDirectory(root, name, meta = {}) {
  const directory = join(root, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, `${name}.html`), `<!doctype html><html><head><title>${meta.title || name}</title></head>
<body><script id="report-meta" type="application/json">${JSON.stringify(meta)}</script></body></html>`)
  writeFileSync(join(directory, `RAW-${name}.pdf`), '%PDF-1.4 test raw\n')
  return directory
}

/**
 * Create a disposable package root and data directory.
 * @param {{maxUploadBytes?: number}} [options]
 */
export function makeFixture(options = {}) {
  const base = mkdtempSync(join(tmpdir(), 'pdr-v11-'))
  const packageDir = join(base, 'package')
  const libraryDir = join(packageDir, 'library')
  mkdirSync(libraryDir, { recursive: true })
  const seededDir = '2025-Journal-Seeded paper'
  writeFileSync(join(libraryDir, 'index.html'), libraryIndexHtml({ papers: [{
    id: seededDir,
    dir: `${seededDir}/`,
    html: `${seededDir}/${seededDir}.html`,
    pdf: `${seededDir}/${seededDir}.pdf`,
    raw: `${seededDir}/RAW-${seededDir}.pdf`,
    raw_name: `RAW-${seededDir}.pdf`,
    title: 'Seeded paper',
    title_zh: '种子论文',
    journal: 'Journal',
    year: '2025',
    categories: ['AI'],
    tags: ['cryo-EM'],
    tldr: 'A seeded deep-read paper for tests.',
  }] }))
  makeReportDirectory(libraryDir, seededDir, { title: 'Seeded paper', year: '2025', journal: 'Journal' })
  const skillDir = join(packageDir, 'skills', 'paper-deepread-html')
  mkdirSync(join(skillDir, 'assets'), { recursive: true })
  mkdirSync(join(skillDir, 'scripts'), { recursive: true })
  writeFileSync(join(skillDir, 'assets', 'library_template.html'), '<html><body>{{LIBRARY_JSON}}</body></html>')
  writeFileSync(join(skillDir, 'SKILL.md'), '# test skill\n')
  writeFileSync(join(skillDir, 'scripts', 'build_library.py'), [
    'import argparse, json, pathlib',
    'p = argparse.ArgumentParser()',
    'p.add_argument("--root", required=True)',
    'p.add_argument("--out", default=None)',
    'p.add_argument("--template", default=None)',
    'p.add_argument("--md", default=None)',
    'p.add_argument("--no-thumbs", action="store_true")',
    'p.add_argument("--no-thumb-cache", action="store_true")',
    'a = p.parse_args()',
    'root = pathlib.Path(a.root)',
    'dirs = [d.name for d in sorted(root.iterdir()) if d.is_dir() and not d.name.startswith(".")]',
    'stats = {"n": len(dirs), "version": "1.1.0", "updated": "2026-10-30"}',
    'html = "<html><div id=\\"libraryTitleSrc\\" hidden>文献精读库</div><script id=\\"library-data\\" type=\\"application/json\\">" + json.dumps({"papers": [], "stats": stats}) + "</script></html>"',
    '(root / "index.html").write_text(html, encoding="utf-8")',
    'print("[library] rebuilt", len(dirs), "reports")',
  ].join('\n'))
  writeFileSync(join(skillDir, 'scripts', 'setup_env.sh'), '#!/usr/bin/env bash\necho /usr/bin/python3\n')
  const dataDir = join(base, 'data')
  return {
    base,
    packageDir,
    dataDir,
    skillDir,
    libraryDir,
    config: { dataDir, ...(options.maxUploadBytes ? { maxUploadBytes: options.maxUploadBytes } : {}) },
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  }
}

/** Small valid PDF body. */
export function pdfBody(size = 128) {
  const head = '%PDF-1.4\n'
  return Buffer.from(head + 'x'.repeat(Math.max(0, size - head.length)))
}

/** Start a throwaway HTTP server for a manager + static route. */
export async function startFixtureServer(manager, libraryRoot, createLibraryHandler) {
  const { createServer } = await import('node:http')
  const handler = createLibraryHandler(libraryRoot, null, (req, res, subPath) => manager.handleApi(req, res, subPath))
  const server = createServer((req, res) => { handler(req, res).catch(error => { res.writeHead(500); res.end(String(error)) }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
