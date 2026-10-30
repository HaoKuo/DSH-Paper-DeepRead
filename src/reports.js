/**
 * Report management over the managed 文献精读库 root.
 *
 * A report directory is one direct child of the library root containing the
 * interactive report HTML, optional `content.html`, a report PDF, a
 * `RAW-*.pdf` source paper, and an optional `library.json` curation file
 * (`hidden`, `title`, `journal`, `year`, `categories`, `tags`).
 *
 * All mutations validate the directory as a direct, real child of the root and
 * write through `atomicWriteJson` where curation is changed.
 *
 * @module dsh-paper-deepread/reports
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { ROUTE_PREFIX } from './route.js'
import { encodeSitePath } from './library.js'
import {
  StoreError,
  atomicWriteJson,
  readJsonFile,
  safeChildDir,
} from './store.js'
import {
  LIBRARY_TIMEOUT_MS,
  buildLibraryArgs,
  findSystemPython,
  runProcess,
} from './python.js'

const META_BLOCK = /<script\b[^>]*\bid=["']report-meta["'][^>]*>([\s\S]*?)<\/script>/i
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i
const README_HEAD = /^#\s+(.+)$/m
const YEAR_RE = /^(19|20)\d{2}$/

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stripTags(value) {
  return textOf(value).replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim()
}

/** Pick the report HTML of a directory, mirroring the skill's library builder. */
export function findReportFile(directory) {
  const candidates = readdirSync(directory)
    .filter(name => /\.html?$/iu.test(name))
    .filter(name => !['index.html', 'readme.html', 'content.html'].includes(name.toLowerCase()))
    .sort()
  if (candidates.length === 0) return null
  const named = `${basename(directory)}.html`
  return candidates.includes(named) ? join(directory, named) : join(directory, candidates[0])
}

/** Embedded report metadata (`<script id="report-meta">`), or `{}`. */
export function readReportMeta(reportFile) {
  try {
    const raw = readFileSync(reportFile, 'utf8')
    for (const match of raw.matchAll(new RegExp(META_BLOCK.source, 'giu'))) {
      const body = match[1].trim()
      if (!body.startsWith('{')) continue
      try {
        const parsed = JSON.parse(body)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      } catch { /* keep looking */ }
    }
    const title = TITLE_TAG.exec(raw)
    return title ? { title: stripTags(title[1]) } : {}
  } catch {
    return {}
  }
}

/** Optional per-paper curation file (`library.json`). */
export function readLibraryOverride(directory) {
  const value = readJsonFile(join(directory, 'library.json'), null)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Derive `{year, journal, title}` from a report directory name. */
export function parseDirectoryName(name) {
  const match = /^((?:19|20)\d{2})-(.+)$/u.exec(name)
  if (!match) return { year: '', journal: '', title: name }
  const rest = match[2]
  const dash = rest.indexOf('-')
  if (dash < 0) return { year: match[1], journal: rest, title: rest }
  return { year: match[1], journal: rest.slice(0, dash), title: rest.slice(dash + 1) }
}

/**
 * Scan one report directory into an API record.
 * @param {string} root Library root.
 * @param {string} directory Absolute report directory.
 * @returns {object|null} Report record, or null when the directory has no report HTML.
 */
export function scanReport(root, directory) {
  const report = findReportFile(directory)
  if (!report) return null
  const meta = readReportMeta(report)
  const override = readLibraryOverride(directory)
  const fromName = parseDirectoryName(basename(directory))
  let readme = ''
  try {
    const readmePath = join(directory, 'README.md')
    if (existsSync(readmePath)) readme = README_HEAD.exec(readFileSync(readmePath, 'utf8'))?.[1] ?? ''
  } catch { /* ignore */ }
  const pick = key => textOf(override[key]) || textOf(meta[key])
  let year = pick('year') || fromName.year
  if (!YEAR_RE.test(year)) {
    const yearMatch = /^((?:19|20)\d{2})/u.exec(basename(directory))
    year = yearMatch ? yearMatch[1] : ''
  }
  const title = pick('title') || stripTags(readme) || fromName.title || basename(directory)
  const rawFiles = readdirSync(directory).filter(name => /^RAW-.*\.pdf$/iu.test(name)).sort()
  const reportRelative = relative(root, report).split(sep).join('/')
  const rawRelative = rawFiles.length > 0 ? relative(root, join(directory, rawFiles[0])).split(sep).join('/') : ''
  let sizeBytes = 0
  try {
    const info = statSync(directory)
    sizeBytes = info.size
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile()) sizeBytes += statSync(join(directory, entry.name)).size
    }
  } catch { /* ignore */ }
  return {
    dir: basename(directory),
    title,
    titleZh: pick('title_zh') || textOf(meta.title_zh) || undefined,
    journal: pick('journal') || fromName.journal || '',
    year,
    hidden: override.hidden === true,
    updated: new Date(statSync(report).mtimeMs).toISOString(),
    sizeBytes,
    reportFile: basename(report),
    reportHtmlPath: report,
    reportUrl: `${ROUTE_PREFIX}/${encodeSitePath(reportRelative)}`,
    rawPdfName: rawFiles[0] || '',
    rawPdfPath: rawRelative ? join(root, ...rawRelative.split('/')) : null,
    rawUrl: rawRelative ? `${ROUTE_PREFIX}/${encodeSitePath(rawRelative)}` : '',
  }
}

/**
 * List report directories under a library root, newest first.
 * @param {string} root Library root.
 * @returns {object[]} Report records.
 */
export function scanReports(root) {
  const resolvedRoot = resolve(root)
  let entries
  try {
    entries = readdirSync(resolvedRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const reports = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue
    const record = scanReport(resolvedRoot, join(resolvedRoot, entry.name))
    if (record) reports.push(record)
  }
  reports.sort((left, right) => String(right.year).localeCompare(String(left.year))
    || String(right.updated).localeCompare(String(left.updated)))
  return reports
}

/** Merge keys into a report's `library.json` (preserving unrelated keys). */
export function writeLibraryOverride(directory, patch) {
  const current = readLibraryOverride(directory)
  // Collection keys in `library.json` remain user-authored; the plugin only
  // owns the visibility flag.
  atomicWriteJson(join(directory, 'library.json'), { ...current, ...patch })
}

/**
 * Show or hide one report.
 * @param {string} root Library root.
 * @param {unknown} dir Report directory name.
 * @param {unknown} hidden New visibility.
 * @returns {{dir: string, hidden: boolean}} Updated visibility.
 */
export function setReportHidden(root, dir, hidden) {
  if (typeof hidden !== 'boolean') throw new StoreError('BAD_REQUEST', 'hidden must be a boolean')
  const target = safeChildDir(root, dir)
  writeLibraryOverride(target, { hidden })
  return { dir: basename(target), hidden }
}

/**
 * Delete one report directory (only that paper, never the root).
 * @param {string} root Library root.
 * @param {unknown} dir Report directory name.
 * @returns {{dir: string, deleted: true}} Deleted directory.
 */
export function deleteReport(root, dir) {
  const target = safeChildDir(root, dir)
  rmSync(target, { recursive: true, force: true })
  return { dir: basename(target), deleted: true }
}

/**
 * Rebuild the library index with the bundled `build_library.py`.
 *
 * Thumbnails need PyMuPDF. When a prepared interpreter is available the rebuild
 * keeps them; otherwise it falls back to a plain `python3 --no-thumbs` rebuild so
 * one-click reindexing never depends on a model or a network install.
 *
 * @param {object} options
 * @param {string} options.root Library root.
 * @param {string} options.skillDir Bundled skill directory.
 * @param {{quick: Function}} options.python Python registry.
 * @param {AbortSignal} [options.signal] Cancellation.
 * @returns {Promise<{ok: boolean, stats: object|null, log: string, indexMtime: number|null, error?: string}>}
 */
export async function rebuildLibrary(options) {
  const { root, skillDir, python, signal } = options
  const template = join(skillDir, 'assets', 'library_template.html')
  const script = join(skillDir, 'scripts', 'build_library.py')
  if (!existsSync(script)) return { ok: false, log: '', stats: null, indexMtime: null, error: `missing ${script}` }
  if (!existsSync(template)) return { ok: false, log: '', stats: null, indexMtime: null, error: `missing ${template}` }
  let interpreter = null
  let thumbs = false
  try {
    interpreter = await python.quick()
  } catch { /* ignore */ }
  if (!interpreter) {
    interpreter = findSystemPython()
    thumbs = false
  } else {
    thumbs = true
  }
  if (!interpreter) return { ok: false, log: '', stats: null, indexMtime: null, error: 'no python3 interpreter found for build_library.py' }
  const args = buildLibraryArgs({ skillDir, template, root, out: join(root, 'index.html'), md: join(root, 'index.md'), thumbs })
  const result = await runProcess(interpreter, args, { timeoutMs: LIBRARY_TIMEOUT_MS, signal })
  const log = `${result.stdout}\n${result.stderr}`.trim().slice(-6000)
  if (!result.ok) {
    return { ok: false, log, stats: null, indexMtime: null, error: result.timedOut ? 'rebuild timed out' : `build_library.py exited ${result.code}` }
  }
  const indexPath = join(root, 'index.html')
  let indexMtime = null
  try { indexMtime = statSync(indexPath).mtimeMs } catch { /* ignore */ }
  let stats = null
  try {
    const raw = readFileSync(indexPath, 'utf8')
    const match = /<script\b[^>]*\bid=["']library-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(raw)
    if (match) stats = JSON.parse(match[1]).stats ?? null
  } catch { /* ignore */ }
  return { ok: true, log, stats, indexMtime }
}

/** Install a report from a work directory: validate sources, then build. */
export function assertReportSources(workDir) {
  const candidates = [workDir, join(workDir, 'paper')]
  const find = name => candidates.map(directory => join(directory, name)).find(file => existsSync(file))
  const content = find('content.html')
  const meta = find('meta.json')
  const figures = find('figures.json')
  const missing = []
  if (!content) missing.push('content.html')
  if (!meta) missing.push('meta.json')
  if (!figures) missing.push('figures.json')
  if (missing.length > 0) {
    throw new StoreError('MISSING_SOURCES', `work directory is missing ${missing.join(', ')} (expected in ${workDir} or ${join(workDir, 'paper')}); run paper_ingest.py and author content.html/meta.json first`)
  }
  return { content, meta, figures, figBase: dirname(content) }
}

/** Relative/absolute helpers used by the manager and tests. */
export function reportRelative(root, file) {
  return relative(root, file).split(sep).join('/')
}

/** Extension helper. */
export function reportExtension(file) {
  return extname(file).toLowerCase()
}
