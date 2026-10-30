/**
 * Read the bundled Paper Deepread (文献精读库) static site.
 *
 * The site is a self-contained HTML app: `library/index.html` embeds the whole
 * catalogue in a `<script id="library-data" type="application/json">` block, so
 * the host half can expose the same data to the model without parsing the
 * rendered markup or starting a separate service. This module keeps no state
 * and imports nothing outside Node's standard library, which makes it testable
 * on its own (`node src/library.js <library-dir>`).
 *
 * @module dsh-paper-deepread/library
 */

import { readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** URL prefix owned by the host half. Must match the registered Web route. */
export const ROUTE_PREFIX = '/paper-deepread'

/** Relative index page of the bundled library. */
export const LIBRARY_INDEX = 'index.html'

const DATA_BLOCK = /<script\b[^>]*\bid=["']library-data["'][^>]*>([\s\S]*?)<\/script>/i
const TITLE_BLOCK = /<div\b[^>]*\bid=["']libraryTitleSrc["'][^>]*>([\s\S]*?)<\/div>/i
const BUILD_DATE_BLOCK = /<div\b[^>]*\bid=["']buildDateSrc["'][^>]*>([\s\S]*?)<\/div>/i
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i
const VERSION_META = /<meta\b[^>]*\bname=["']library-version["'][^>]*\bcontent=["']([^"']+)["']/i

/** Maximum search hits returned to the model. */
export const MAX_SEARCH_HITS = 20

/** Field weights used to rank substring search hits. */
const SEARCH_WEIGHTS = {
  title: 8,
  titleZh: 8,
  tags: 5,
  categories: 4,
  journal: 3,
  year: 2,
  authors: 2,
  tldr: 2,
  text: 1,
}

function textOf(value) {
  return typeof value === 'string' ? value : ''
}

function collapse(value) {
  return textOf(value).replace(/\s+/gu, ' ').trim()
}

function stripTags(value) {
  return collapse(value.replace(/<[^>]*>/gu, ''))
}

/** Encode a site-relative path for a browser URL, one segment at a time. */
export function encodeSitePath(relativePath) {
  return String(relativePath)
    .split('/')
    .filter(segment => segment.length > 0)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

/** Absolute file under the library root, or `undefined` for unsafe/empty paths. */
function libraryFile(root, relativePath) {
  const candidate = textOf(relativePath).trim()
  if (!candidate) return undefined
  const absolute = resolve(root, candidate)
  if (absolute !== root && !absolute.startsWith(root + sep)) return undefined
  return absolute
}

/** Short snippet centred on the first occurrence of `needle`. */
export function makeSnippet(value, needle, radius = 90) {
  const text = collapse(value)
  if (!text) return ''
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (at < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + needle.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** One catalogue entry, normalised and enriched with local/Web locations. */
function normalisePaper(raw, root) {
  const paper = raw && typeof raw === 'object' ? raw : {}
  const id = textOf(paper.id) || textOf(paper.dir) || collapse(paper.title)
  const directory = textOf(paper.dir)
  // `html` is the interactive report; `pdf` is the figure-cropped report PDF
  // and `raw` is the untouched source paper. Tolerate a renamed source PDF.
  const reportRelative = textOf(paper.html) || (directory ? `${directory}${id}.html` : '')
  const previewRelative = textOf(paper.pdf) || (directory ? `${directory}${id}.pdf` : '')
  const rawRelative = textOf(paper.raw) || previewRelative
  const reportHtmlPath = libraryFile(root, reportRelative)
  const previewPdfPath = libraryFile(root, previewRelative)
  const rawPdfPath = libraryFile(root, rawRelative)
  return {
    id,
    title: textOf(paper.title) || id,
    titleZh: textOf(paper.title_zh),
    journal: textOf(paper.journal),
    year: textOf(paper.year),
    authors: Array.isArray(paper.authors) ? paper.authors.filter(entry => typeof entry === 'string') : [],
    doi: textOf(paper.doi),
    categories: Array.isArray(paper.categories) ? paper.categories.filter(entry => typeof entry === 'string') : [],
    tags: Array.isArray(paper.tags) ? paper.tags.filter(entry => typeof entry === 'string') : [],
    tldr: textOf(paper.tldr),
    figures: Number.isFinite(Number(paper.figures)) ? Number(paper.figures) : undefined,
    claims: Number.isFinite(Number(paper.claims)) ? Number(paper.claims) : undefined,
    sections: Number.isFinite(Number(paper.sections)) ? Number(paper.sections) : undefined,
    updated: textOf(paper.updated),
    directory,
    reportRelative,
    previewRelative,
    rawRelative,
    reportHtmlPath,
    previewPdfPath,
    rawPdfPath,
    webUrl: reportRelative ? `${ROUTE_PREFIX}/${encodeSitePath(reportRelative)}` : '',
    text: typeof paper.text === 'string' ? paper.text : '',
  }
}

/**
 * Load and parse the bundled library catalogue.
 * @param {string} libraryDir Absolute path of the `library/` directory.
 * @returns {{root: string, indexPath: string, title: string, version: string,
 *   buildDate: string, stats: object, papers: object[]}}
 */
export function loadLibrary(libraryDir) {
  const root = resolve(libraryDir)
  const indexPath = join(root, LIBRARY_INDEX)
  const html = readFileSync(indexPath, 'utf8')
  const block = DATA_BLOCK.exec(html)
  if (block === null) {
    throw new Error(`library catalogue not found in ${indexPath}: expected <script id="library-data"> with JSON`)
  }
  let data
  try {
    data = JSON.parse(block[1])
  } catch (error) {
    throw new Error(`library catalogue in ${indexPath} is not valid JSON: ${error.message}`)
  }
  const stats = data && typeof data.stats === 'object' && data.stats !== null ? data.stats : {}
  const papers = Array.isArray(data?.papers) ? data.papers.map(entry => normalisePaper(entry, root)) : []
  const titleBlock = TITLE_BLOCK.exec(html)
  const buildDateBlock = BUILD_DATE_BLOCK.exec(html)
  const titleTag = TITLE_TAG.exec(html)
  const versionMeta = VERSION_META.exec(html)
  const title = stripTags(titleBlock?.[1] ?? '')
    || stripTags(titleTag?.[1] ?? '')
    || 'Paper Deepread'
  return {
    root,
    indexPath,
    title,
    version: textOf(stats.version) || textOf(versionMeta?.[1]) || '',
    buildDate: stripTags(buildDateBlock?.[1] ?? '') || textOf(stats.updated) || '',
    stats,
    papers,
  }
}

/** Public summary of one paper for tool results. */
export function publicPaper(paper) {
  return {
    id: paper.id,
    title: paper.title,
    title_zh: paper.titleZh || undefined,
    journal: paper.journal || undefined,
    year: paper.year || undefined,
    authors: paper.authors.length > 0 ? paper.authors : undefined,
    doi: paper.doi || undefined,
    categories: paper.categories.length > 0 ? paper.categories : undefined,
    tags: paper.tags.length > 0 ? paper.tags : undefined,
    tldr: paper.tldr || undefined,
    figures: paper.figures,
    claims: paper.claims,
    sections: paper.sections,
    updated: paper.updated || undefined,
    reportHtmlPath: paper.reportHtmlPath,
    rawPdfPath: paper.rawPdfPath,
    previewPdfPath: paper.previewPdfPath,
    webUrl: paper.webUrl,
  }
}

/** Library-level metadata shared by every tool result. */
export function publicLibrary(library, webBaseUrl) {
  return {
    title: library.title,
    version: library.version || undefined,
    buildDate: library.buildDate || undefined,
    pageCount: library.papers.length,
    stats: library.stats,
    indexPath: library.indexPath,
    libraryDir: library.root,
    webUrl: webBaseUrl,
  }
}

/**
 * Case-insensitive substring search over every model-searchable field.
 * @param {ReturnType<typeof loadLibrary>} library Loaded catalogue.
 * @param {string} query Substring supplied by the model or user.
 * @param {number} [limit] Maximum hits (capped by {@link MAX_SEARCH_HITS}).
 * @returns {object[]} Ranked copies carrying `score` and `snippet`.
 */
export function searchPapers(library, query, limit = MAX_SEARCH_HITS) {
  const needle = collapse(query).toLowerCase()
  const capped = Math.max(1, Math.min(Number.isFinite(limit) ? limit : MAX_SEARCH_HITS, MAX_SEARCH_HITS))
  if (!needle) return []
  const hits = []
  for (const paper of library.papers) {
    const fields = [
      ['title', paper.title],
      ['titleZh', paper.titleZh],
      ['tags', paper.tags.join(' ')],
      ['categories', paper.categories.join(' ')],
      ['journal', paper.journal],
      ['year', paper.year],
      ['authors', paper.authors.join(' ')],
      ['tldr', paper.tldr],
      ['text', paper.text],
    ]
    let score = 0
    let snippet = ''
    for (const [field, value] of fields) {
      const haystack = value.toLowerCase()
      const at = haystack.indexOf(needle)
      if (at < 0) continue
      score += SEARCH_WEIGHTS[field] ?? 1
      if (!snippet) snippet = makeSnippet(value, needle)
    }
    if (score === 0) continue
    hits.push({ ...publicPaper(paper), score, snippet })
  }
  hits.sort((left, right) => right.score - left.score
    || String(right.year).localeCompare(String(left.year))
    || left.title.localeCompare(right.title))
  return hits.slice(0, capped)
}

/**
 * Resolve one paper by catalogue id, directory, report filename, 1-based index,
 * or (case-insensitive) title.
 * @param {ReturnType<typeof loadLibrary>} library Loaded catalogue.
 * @param {string} id Identifier supplied by the model.
 * @returns {object|undefined} The matching paper.
 */
export function findPaper(library, id) {
  const needle = collapse(id)
  if (!needle) return undefined
  const exact = library.papers.find(paper => paper.id === needle
    || paper.directory === needle
    || paper.reportRelative === needle
    || paper.rawRelative === needle
    || paper.previewRelative === needle)
  if (exact) return exact
  const lower = needle.toLowerCase()
  const byTitle = library.papers.find(paper => paper.title.toLowerCase() === lower
    || paper.titleZh.toLowerCase() === lower)
  if (byTitle) return byTitle
  const byDirectory = library.papers.find(paper => paper.directory.toLowerCase() === lower
    || paper.directory.toLowerCase() === `${lower}/`)
  if (byDirectory) return byDirectory
  const index = Number.parseInt(needle, 10)
  if (Number.isSafeInteger(index) && index >= 1 && index <= library.papers.length) {
    return library.papers[index - 1]
  }
  return undefined
}

/** Directory a verification helper may report as `relative(library.root, file)`. */
export function relativeToLibrary(library, file) {
  return file ? relative(library.root, file).split(sep).join('/') : undefined
}
