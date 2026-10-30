/**
 * Feature manager: managed library store, upload inbox, report management,
 * the HTTP API under `/paper-deepread/api/*`, and the model tools.
 *
 * The plugin never calls a model. Upload -> deep-read is agent-driven: the UI
 * shows a copyable handoff instruction, and an agent in any session calls
 * `paper_deepread_uploads` (ingest) and `paper_deepread_reports` (build) to run
 * the bundled deterministic skill scripts.
 *
 * @module dsh-paper-deepread/manager
 */

import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  MAX_SEARCH_HITS,
  findPaper,
  loadLibrary,
  publicPaper,
  searchPapers,
} from './library.js'
import {
  PaperStore,
  StoreError,
  resolveDataDir,
} from './store.js'
import {
  assertPdfBody,
  readRequestBody,
  removeFileQuietly,
  sanitizeFilename,
  writeUploadFile,
} from './uploads.js'
import {
  assertReportSources,
  deleteReport,
  rebuildLibrary,
  scanReports,
  setReportHidden,
} from './reports.js'
import {
  INGEST_TIMEOUT_MS,
  PythonRegistry,
  REPORT_TIMEOUT_MS,
  buildIngestArgs,
  buildReportArgs,
  runProcess,
} from './python.js'

/** Maximum JSON body accepted by management endpoints. */
const MAX_JSON_BODY = 1024 * 1024

/** API error-code to HTTP status mapping. */
const STATUS_BY_CODE = {
  BAD_BODY: 400,
  BAD_DIR: 400,
  BAD_FILENAME: 400,
  BAD_ID: 400,
  BAD_REQUEST: 400,
  MISSING_SOURCES: 409,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
}

/** Directory of the bundled skill inside the installed package. */
export function bundledSkillDir(packageDir) {
  return join(packageDir, 'skills', 'paper-deepread-html')
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function failure(error) {
  const code = error instanceof StoreError ? error.code : 'INTERNAL'
  return { code, message: String(error?.message || error).slice(0, 800) }
}

/** Read and parse a JSON request body with a hard size cap. */
async function readJsonBody(req) {
  const type = String(req.headers['content-type'] || '')
  if (!/application\/json/iu.test(type)) {
    throw new StoreError('UNSUPPORTED_MEDIA_TYPE', 'expected content-type: application/json')
  }
  const body = await readRequestBody(req, MAX_JSON_BODY)
  try {
    const parsed = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
    return parsed
  } catch (error) {
    throw new StoreError('BAD_BODY', `invalid JSON body: ${String(error?.message || error)}`)
  }
}

/** Sanitize a user-provided report name (single path segment, no dots). */
export function safeReportName(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new StoreError('BAD_REQUEST', 'name must be a string')
  const cleaned = value.trim().replace(/[\\/]/gu, '-').replace(/^\.+/u, '').replace(/[\u0000-\u001f]/gu, ' ')
  if (!cleaned) throw new StoreError('BAD_REQUEST', 'report name is empty after sanitizing')
  return cleaned.slice(0, 160)
}

/** Files inside a work directory that the ingest tool may have produced. */
function ingestOutputs(workDir) {
  const names = ['text.md', 'captions.txt', 'tables.md', 'figures.json', 'meta.json', 'debug/contact-sheet.png']
  return Object.fromEntries(names.map(name => [name, existsSync(join(workDir, name)) ? join(workDir, name) : null]))
}

function listLibraryDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * Create the managed feature manager for one plugin activation.
 *
 * @param {object} options
 * @param {string} options.packageDir Installed package root.
 * @param {object} [options.config] Plugin row config (`dataDir`, `libraryDir`, `maxUploadBytes`).
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @returns {object} Manager with the store, API handler, and model tools.
 */
export function createManager(options) {
  const { packageDir, config = {}, logger } = options
  const dataDir = resolveDataDir({ dataDir: config.dataDir })
  const store = new PaperStore({
    dataDir,
    packageDir,
    legacyLibraryDir: config.libraryDir,
    logger,
    maxUploadBytes: config.maxUploadBytes,
  }).ensure()
  const skillDir = bundledSkillDir(packageDir)
  const python = new PythonRegistry({ skillDir, logger })
  let cached = null

  /** Current managed library catalogue (re-read when `index.html` changes). */
  function currentLibrary() {
    const indexPath = join(store.libraryRoot, 'index.html')
    try {
      const mtimeMs = statSync(indexPath).mtimeMs
      if (cached === null || cached.mtimeMs !== mtimeMs) {
        cached = { mtimeMs, library: loadLibrary(store.libraryRoot) }
      }
      return cached.library
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: cannot read the managed library at ${store.libraryRoot}: ${String(error?.message || error)}`)
      return null
    }
  }

  function reports() {
    return scanReports(store.libraryRoot)
  }

  async function statePayload() {
    const library = currentLibrary()
    const uploads = store.listUploads()
    const reportList = reports()
    return {
      ok: true,
      dataDir: store.dataDir,
      managed: store.managed,
      library: {
        root: store.libraryRoot,
        managed: store.managed,
        title: library?.title || '',
        version: library?.version || '',
        buildDate: library?.buildDate || '',
        count: library?.papers.length ?? 0,
        indexMtime: (() => {
          try { return statSync(join(store.libraryRoot, 'index.html')).mtimeMs } catch { return null }
        })(),
      },
      stats: library?.stats || {},
      uploads: uploads.map(upload => ({
        ...upload,
        pending: upload.status === 'uploaded',
      })),
      reports: reportList,
      python: await python.describe(),
      skill: { dir: skillDir, installed: existsSync(join(skillDir, 'SKILL.md')) },
      limits: { maxUploadBytes: store.maxUploadBytes },
    }
  }

  /** Rebuild the library index and refresh the catalogue cache. */
  async function rebuild(signal) {
    const result = await rebuildLibrary({ root: store.libraryRoot, skillDir, python, signal })
    cached = null
    return result
  }

  /** Install one report from a work directory. */
  async function buildReport(upload, args, signal) {
    const workDir = args.workDir ? resolve(String(args.workDir)) : join(store.workDir, upload.id)
    if (!existsSync(workDir)) throw new StoreError('NOT_FOUND', `work directory not found: ${workDir}`)
    const sources = assertReportSources(workDir)
    const interpreter = await python.prepare({ install: true })
    if (!interpreter) throw new StoreError('PYTHON_UNAVAILABLE', `could not prepare the deep-read Python environment: ${python.hint || 'unknown error'}`)
    const template = join(skillDir, 'assets', 'report_template.html')
    if (!existsSync(template)) throw new StoreError('INTERNAL', `missing report template: ${template}`)
    const name = safeReportName(args.name)
    const before = new Set(listLibraryDirs(store.libraryRoot))
    const startedAt = Date.now()
    const argv = buildReportArgs({
      skillDir,
      template,
      content: sources.content,
      meta: sources.meta,
      figures: sources.figures,
      figBase: sources.figBase,
      paperRoot: store.libraryRoot,
      name: name || undefined,
      sourcePdf: upload.pdfPath ?? undefined,
    })
    const run = await runProcess(interpreter, argv, { timeoutMs: REPORT_TIMEOUT_MS, signal })
    const log = `${run.stdout}\n${run.stderr}`.trim().slice(-6000)
    if (!run.ok) {
      await store.patchUpload(upload.id, { status: 'failed', error: `build_report.py failed: ${run.timedOut ? 'timeout' : `exit ${run.code}`}` })
      throw new StoreError('BUILD_FAILED', `build_report.py failed: ${run.timedOut ? 'timeout' : `exit ${run.code}`}\n${log.slice(-1200)}`)
    }
    const created = listLibraryDirs(store.libraryRoot).filter(dir => !before.has(dir))
    const reportDir = created[0] ?? listLibraryDirs(store.libraryRoot).find(dir => {
      try { return statSync(join(store.libraryRoot, dir)).mtimeMs >= startedAt - 2000 } catch { return false }
    }) ?? ''
    const patch = {
      status: 'reported',
      reportDir: reportDir || null,
      error: null,
      reportedAt: new Date().toISOString(),
    }
    const updated = await store.patchUpload(upload.id, patch)
    const rebuildIndex = args.rebuild !== false
    const rebuilt = rebuildIndex ? await rebuild(signal) : null
    return { upload: updated, workDir, reportDir, reportDirPath: reportDir ? join(store.libraryRoot, reportDir) : null, log, rebuild: rebuilt }
  }

  /** Ingest one uploaded PDF with the bundled skill script. */
  async function ingestUpload(upload, signal) {
    if (!upload.pdfPath || !existsSync(upload.pdfPath)) throw new StoreError('NOT_FOUND', `uploaded PDF is missing: ${upload.pdfPath}`)
    const interpreter = await python.prepare({ install: true })
    if (!interpreter) {
      await store.patchUpload(upload.id, { status: 'failed', error: python.hint || 'python environment unavailable' })
      throw new StoreError('PYTHON_UNAVAILABLE', `could not prepare the deep-read Python environment: ${python.hint || 'unknown error'}. Run paper_deepread_uploads action "env" to retry preparation.`)
    }
    const outDir = join(store.workDir, upload.id, 'paper')
    mkdirSync(outDir, { recursive: true })
    const argv = buildIngestArgs({ skillDir, pdf: upload.pdfPath, outDir, debug: true })
    const run = await runProcess(interpreter, argv, { timeoutMs: INGEST_TIMEOUT_MS, signal })
    const log = `${run.stdout}\n${run.stderr}`.trim().slice(-6000)
    if (!run.ok) {
      await store.patchUpload(upload.id, { status: 'failed', error: `paper_ingest.py failed: ${run.timedOut ? 'timeout' : `exit ${run.code}`}` })
      throw new StoreError('INGEST_FAILED', `paper_ingest.py failed: ${run.timedOut ? 'timeout' : `exit ${run.code}`}\n${log.slice(-1200)}`)
    }
    const updated = await store.patchUpload(upload.id, {
      status: 'ingested',
      ingestedAt: new Date().toISOString(),
      error: null,
      workDir: join('work', upload.id).split('/').join('/'),
    })
    return { upload: updated, interpreter, outDir, log, outputs: ingestOutputs(outDir) }
  }

  // ---- model tools -------------------------------------------------------

  function catalogueTool(defineTool) {
    return defineTool({
      name: 'paper_deepread',
      description: [
        'Look up a paper in the managed Paper Deepread (文献精读库) library.',
        'The library holds deep-read papers: each one has an interactive HTML reading report, a figure-cropped report PDF, and the untouched source PDF.',
        'Call without arguments to list every paper with its local report path and Web URL.',
        'Pass `query` to run a case-insensitive substring search over English/Chinese titles, journals, tags, summaries, and full text (up to 20 ranked hits with snippets).',
        'Pass `id` (a paper id from this tool, its directory name, or its 1-based index) to fetch one paper.',
        'Use `paper_deepread_uploads` to process newly uploaded PDFs and `paper_deepread_reports` to build, hide, delete, or reindex reports.',
        'Use the returned absolute `reportHtmlPath` with the local file tools to read a report, `rawPdfPath` for the source paper, or `webUrl` to open the report in the DSH Web UI.',
      ].join(' '),
      parameters: {
        query: { type: 'string', description: 'Optional case-insensitive substring to search titles, Chinese titles, journals, tags, summaries, or full text.' },
        id: { type: 'string', description: 'Optional paper id, report directory name, or 1-based index returned by a previous call.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const library = currentLibrary()
        if (!library) {
          return { ok: false, mode: 'error', error: `managed library is unavailable at ${store.libraryRoot}`, dataDir: store.dataDir }
        }
        const uploads = store.listUploads()
        const reportList = reports()
        const meta = {
          title: library.title,
          version: library.version || undefined,
          buildDate: library.buildDate || undefined,
          pageCount: library.papers.length,
          stats: library.stats,
          indexPath: library.indexPath,
          libraryDir: library.root,
          webUrl: `${webOriginString()}/paper-deepread/index.html`,
          dataDir: store.dataDir,
          managed: store.managed,
          uploads: { total: uploads.length, pending: uploads.filter(entry => entry.status === 'uploaded').length, ingested: uploads.filter(entry => entry.status === 'ingested').length },
          reports: { total: reportList.length, visible: reportList.filter(entry => !entry.hidden).length },
        }
        try {
          if (typeof args.id === 'string' && args.id.trim()) {
            const paper = findPaper(library, args.id)
            if (!paper) return { ok: false, mode: 'paper', error: `No paper matches id "${args.id.trim()}".`, library: meta, availableIds: library.papers.map(entry => entry.id) }
            return { ok: true, mode: 'paper', library: meta, paper: publicPaper(paper) }
          }
          if (typeof args.query === 'string' && args.query.trim()) {
            const results = searchPapers(library, args.query, MAX_SEARCH_HITS)
            return { ok: true, mode: 'search', library: meta, query: args.query.trim(), total: results.length, results }
          }
          return { ok: true, mode: 'list', library: meta, papers: library.papers.map(paper => publicPaper(paper)) }
        } catch (error) {
          return { ok: false, mode: 'error', library: meta, error: String(error?.message || error) }
        }
      },
    })
  }

  /** Absolute Web origin captured from the last HTTP request, for tool use. */
  let webOrigin = ''
  function webOriginString() {
    return webOrigin
  }
  function noteOrigin(req) {
    try {
      const host = String(req.headers.host || '')
      if (host) webOrigin = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${host}`
    } catch { /* ignore */ }
  }

  function uploadsTool(defineTool) {
    return defineTool({
      name: 'paper_deepread_uploads',
      description: [
        'Manage the DSH-Paper-DeepRead upload inbox. Uploaded PDFs wait here until an agent deep-reads them with the bundled paper-deepread-html skill scripts.',
        'action "list" (default): pending uploads plus every upload with its absolute PDF path and status (uploaded -> ingested -> reported, or failed).',
        'action "env": prepare and describe the Python interpreter used by the skill (may install PyMuPDF once on first use).',
        'action "ingest" with { id }: run the bundled paper_ingest.py on the uploaded PDF into <dataDir>/work/<id>/paper (text.md, captions.txt, tables.md, figures.json, meta.json, crops, debug contact sheet); marks it ingested and returns next-step instructions.',
        'action "delete" with { id }: remove the upload record, raw PDF, and work directory.',
        'After ingest, follow the paper-deepread-html skill: inspect crops, author content.html and meta.json, then call paper_deepread_reports action "build" with the same id.',
      ].join(' '),
      parameters: {
        action: { type: 'string', enum: ['list', 'env', 'ingest', 'delete'], description: 'Operation; defaults to "list".' },
        id: { type: 'string', description: 'Upload id (required for ingest and delete).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const action = args.action || 'list'
        try {
          if (action === 'env') {
            const interpreter = await python.prepare({ install: true })
            return { ok: Boolean(interpreter), path: interpreter ?? undefined, hint: interpreter ? undefined : python.hint, skillDir, note: interpreter ? 'Python environment is ready for ingest and report builds.' : 'Environment preparation failed; see hint.' }
          }
          if (action === 'ingest') {
            const upload = store.getUpload(args.id)
            const result = await ingestUpload(upload)
            return {
              ok: true,
              action: 'ingest',
              id: upload.id,
              status: result.upload.status,
              interpreter: result.interpreter,
              outDir: result.outDir,
              files: result.outputs,
              log: result.log.slice(-2500),
              next: {
                instruction: 'Follow the paper-deepread-html skill: inspect the crop contact sheet and figures, then write content.html and meta.json in the work directory (or its paper/ subdirectory), then call paper_deepread_reports with action "build" and the same id.',
                workDir: join(store.workDir, upload.id),
                buildTool: 'paper_deepread_reports',
                buildParameters: { action: 'build', id: upload.id },
              },
            }
          }
          if (action === 'delete') {
            const upload = store.getUpload(args.id)
            await store.removeUpload(upload.id)
            store.deleteUploadArtifacts(upload.id)
            return { ok: true, action: 'delete', id: upload.id, deleted: true }
          }
          const uploads = store.listUploads()
          return {
            ok: true,
            action: 'list',
            dataDir: store.dataDir,
            workDir: store.workDir,
            counts: { total: uploads.length, pending: uploads.filter(entry => entry.status === 'uploaded').length, ingested: uploads.filter(entry => entry.status === 'ingested').length, reported: uploads.filter(entry => entry.status === 'reported').length, failed: uploads.filter(entry => entry.status === 'failed').length },
            uploads,
            python: await python.describe(),
            next: uploads.some(entry => entry.status === 'uploaded')
              ? 'Call action "ingest" with a pending id to extract the PDF, then follow the skill and build the report.'
              : 'No pending uploads.',
          }
        } catch (error) {
          return { ok: false, action, error: `[${error?.code || 'INTERNAL'}] ${String(error?.message || error)}` }
        }
      },
    })
  }

  function reportsTool(defineTool) {
    return defineTool({
      name: 'paper_deepread_reports',
      description: [
        'Manage reports in the DSH-Paper-DeepRead managed library.',
        'action "list" (default): every report with title, year, journal, visibility, absolute report/RAW paths, and Web URLs.',
        'action "build" with { id, name?, rebuild? }: validate the work directory sources (content.html, meta.json, figures.json), run the bundled build_report.py to assemble <library>/<year>-<journal>-<title>/ with the report HTML and RAW PDF, mark the upload reported, and rebuild the library index unless rebuild:false.',
        'action "rebuild": rebuild the library index (deterministic, no model needed).',
        'action "delete" with { dir }: delete that one report directory.',
        'action "hide" with { dir, hide }: toggle the hidden flag in the report library.json so the library page skips it.',
        'Use paper_deepread_uploads first to ingest a pending upload; quote the report paths in answers.',
      ].join(' '),
      parameters: {
        action: { type: 'string', enum: ['list', 'build', 'rebuild', 'delete', 'hide'], description: 'Operation; defaults to "list".' },
        id: { type: 'string', description: 'Upload id for build.' },
        dir: { type: 'string', description: 'Report directory name for delete/hide.' },
        hide: { type: 'boolean', description: 'true hides, false shows (hide action).' },
        name: { type: 'string', description: 'Optional report directory/file stem override for build.' },
        rebuild: { type: 'boolean', description: 'Build only: rebuild the index afterwards (default true).' },
        workDir: { type: 'string', description: 'Build only: explicit work directory override.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const action = args.action || 'list'
        try {
          if (action === 'build') {
            const upload = store.getUpload(args.id)
            const result = await buildReport(upload, args)
            return {
              ok: true,
              action: 'build',
              id: upload.id,
              status: result.upload.status,
              workDir: result.workDir,
              reportDir: result.reportDir,
              reportDirPath: result.reportDirPath,
              log: result.log.slice(-2500),
              rebuild: result.rebuild ? { ok: result.rebuild.ok, stats: result.rebuild.stats, log: result.rebuild.log.slice(-1200), error: result.rebuild.error } : undefined,
              next: { libraryUrl: `${webOriginString()}/paper-deepread/index.html`, hint: 'Open the library page or call paper_deepread to read the new report.' },
            }
          }
          if (action === 'rebuild') {
            const result = await rebuild()
            return { ok: result.ok, action: 'rebuild', stats: result.stats, log: result.log.slice(-3000), indexMtime: result.indexMtime, error: result.error }
          }
          if (action === 'delete') {
            const result = deleteReport(store.libraryRoot, args.dir)
            cached = null
            const rebuilt = await rebuild()
            return { ok: true, action: 'delete', ...result, rebuild: { ok: rebuilt.ok, stats: rebuilt.stats, error: rebuilt.error } }
          }
          if (action === 'hide') {
            if (typeof args.hide !== 'boolean') throw new StoreError('BAD_REQUEST', 'hide must be a boolean')
            const result = setReportHidden(store.libraryRoot, args.dir, args.hide)
            const rebuilt = await rebuild()
            return { ok: true, action: 'hide', ...result, rebuild: { ok: rebuilt.ok, stats: rebuilt.stats, error: rebuilt.error } }
          }
          const reportList = reports()
          return {
            ok: true,
            action: 'list',
            library: {
              root: store.libraryRoot,
              managed: store.managed,
              virtual: `${webOriginString()}/paper-deepread/index.html`,
            },
            counts: { total: reportList.length, visible: reportList.filter(entry => !entry.hidden).length, hidden: reportList.filter(entry => entry.hidden).length },
            reports: reportList,
          }
        } catch (error) {
          return { ok: false, action, error: `[${error?.code || 'INTERNAL'}] ${String(error?.message || error)}` }
        }
      },
    })
  }

  // ---- HTTP API ----------------------------------------------------------

  async function handleApi(req, res, subPath) {
    const method = req.method || 'GET'
    noteOrigin(req)
    const route = subPath.replace(/\/+$/u, '')
    try {
      if (route === '/api/state') {
        if (method !== 'GET') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } })
        return json(res, 200, await statePayload())
      }
      if (route === '/api/upload') {
        if (method !== 'POST') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } })
        const type = String(req.headers['content-type'] || '')
        if (!/^application\/pdf\b/iu.test(type)) throw new StoreError('UNSUPPORTED_MEDIA_TYPE', 'expected content-type: application/pdf')
        const { name } = sanitizeFilename(req.headers['x-filename'])
        const body = await readRequestBody(req, store.maxUploadBytes)
        assertPdfBody(body)
        const saved = writeUploadFile(store, { name, bytes: body })
        let upload
        try {
          upload = await store.addUpload(saved)
        } catch (error) {
          removeFileQuietly(saved.pdfPath)
          throw error
        }
        return json(res, 201, { ok: true, upload })
      }
      if (route === '/api/uploads/delete') {
        if (method !== 'POST') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } })
        const body = await readJsonBody(req)
        const upload = store.getUpload(body.id)
        await store.removeUpload(upload.id)
        store.deleteUploadArtifacts(upload.id)
        return json(res, 200, { ok: true, deleted: upload.id })
      }
      if (route === '/api/reports/rebuild') {
        if (method !== 'POST') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } })
        const result = await rebuild()
        return json(res, result.ok ? 200 : 500, { ok: result.ok, stats: result.stats, log: result.log, indexMtime: result.indexMtime, error: result.ok ? undefined : { code: 'REBUILD_FAILED', message: result.error } })
      }
      if (route === '/api/reports/delete') {
        if (method !== 'POST') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } })
        const body = await readJsonBody(req)
        const result = deleteReport(store.libraryRoot, body.dir)
        cached = null
        const rebuilt = await rebuild()
        return json(res, 200, { ok: true, ...result, rebuild: { ok: rebuilt.ok, stats: rebuilt.stats, error: rebuilt.error } })
      }
      if (route === '/api/reports/visibility') {
        if (method !== 'POST') return json(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } })
        const body = await readJsonBody(req)
        const result = setReportHidden(store.libraryRoot, body.dir, body.hidden)
        const rebuilt = await rebuild()
        return json(res, 200, { ok: true, ...result, rebuild: { ok: rebuilt.ok, stats: rebuilt.stats, error: rebuilt.error } })
      }
      return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `unknown API route: ${route}` } })
    } catch (error) {
      const code = error instanceof StoreError ? error.code : 'INTERNAL'
      const status = STATUS_BY_CODE[code] ?? 500
      logger?.warn?.(`DSH-Paper-DeepRead API ${route}: ${String(error?.message || error)}`)
      return json(res, status, { ok: false, error: failure(error) })
    }
  }

  return {
    store,
    skillDir,
    python,
    currentLibrary,
    reports,
    rebuild,
    statePayload,
    handleApi,
    uploadsTool,
    reportsTool,
    catalogueTool,
    tools: defineTool => [catalogueTool(defineTool), uploadsTool(defineTool), reportsTool(defineTool)],
  }
}
