/**
 * Python invocation for the bundled deep-read skill.
 *
 * The host never runs a model. It only runs the deterministic scripts that ship
 * with `paper-deepread-html`: PDF ingestion, report assembly, and library-index
 * rebuild. Interpreter discovery goes through the skill's own `setup_env.sh`,
 * which reuses `$PAPER_READ_PY`, a cached venv, or a PyMuPDF-capable python3,
 * and only then creates a venv (first use may install PyMuPDF from the network).
 *
 * Pure command builders are exported separately so unit tests can check argv
 * without spawning processes.
 *
 * @module dsh-paper-deepread/python
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Ingest timeout: a long PDF may render hundreds of crops. */
export const INGEST_TIMEOUT_MS = 15 * 60 * 1000
/** Report build timeout. */
export const REPORT_TIMEOUT_MS = 5 * 60 * 1000
/** Library index rebuild timeout. */
export const LIBRARY_TIMEOUT_MS = 3 * 60 * 1000
/** Environment preparation timeout (first run may install PyMuPDF). */
export const ENV_TIMEOUT_MS = 10 * 60 * 1000
/** Quick probe timeout: must never block the UI for long. */
export const PROBE_TIMEOUT_MS = 20 * 1000
/** Captured stdout/stderr cap. */
const MAX_OUTPUT_BYTES = 256 * 1024

/**
 * Run one child process, capturing output and enforcing a timeout.
 *
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @param {{cwd?: string, timeoutMs?: number, env?: object, signal?: AbortSignal}} [options]
 * @returns {Promise<{ok: boolean, code: number|null, signal: string|null, timedOut: boolean,
 *   durationMs: number, stdout: string, stderr: string}>}
 */
export function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000
  const started = Date.now()
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer
    let child
    const finish = (code, signal, error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener?.('abort', onAbort)
      if (error) stderr += `${stderr ? '\n' : ''}${String(error.message || error)}`
      resolve({
        ok: code === 0 && !timedOut,
        code: code ?? null,
        signal: signal ?? null,
        timedOut,
        durationMs: Date.now() - started,
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
      })
    }
    const onAbort = () => {
      try { child?.kill('SIGKILL') } catch { /* ignore */ }
      finish(null, 'SIGKILL', new Error('cancelled'))
    }
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env, PYTHONUNBUFFERED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(null, null, error)
      return
    }
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    child.on('error', error => finish(null, null, error))
    child.on('close', (code, signal) => finish(code, signal, null))
    if (options.signal) {
      if (options.signal.aborted) { onAbort(); return }
      options.signal.addEventListener?.('abort', onAbort, { once: true })
    }
    timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(null, 'SIGKILL', new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    timer.unref?.()
  })
}

/** `setup_env.sh` invocation: prints the interpreter path on stdout. */
export function buildSetupEnvCommand(skillDir) {
  return { command: 'bash', args: [join(skillDir, 'scripts', 'setup_env.sh')] }
}

/** `paper_ingest.py` argv. */
export function buildIngestArgs({ skillDir, pdf, outDir, debug = true, extra = [] }) {
  const args = [join(skillDir, 'scripts', 'paper_ingest.py'), pdf, '--out', outDir]
  if (debug) args.push('--debug')
  return [...args, ...extra]
}

/** `build_report.py` argv (template, content, meta, figures, managed root, source PDF). */
export function buildReportArgs({ skillDir, template, content, meta, figures, figBase, paperRoot, name, sourcePdf, noInline = false }) {
  const args = [
    join(skillDir, 'scripts', 'build_report.py'),
    '--template', template,
    '--content', content,
    '--meta', meta,
    '--figures', figures,
  ]
  if (figBase) args.push('--fig-base', figBase)
  if (paperRoot) args.push('--paper-root', paperRoot)
  if (name) args.push('--name', name)
  if (sourcePdf) args.push('--source-pdf', sourcePdf)
  if (noInline) args.push('--no-inline')
  return args
}

/** `build_library.py` argv. */
export function buildLibraryArgs({ skillDir, template, root, out, md, thumbs = true, noThumbCache = true }) {
  const args = [
    join(skillDir, 'scripts', 'build_library.py'),
    '--root', root,
    '--template', template,
  ]
  if (out) args.push('--out', out)
  if (md !== undefined) args.push('--md', md)
  if (!thumbs) args.push('--no-thumbs')
  if (noThumbCache) args.push('--no-thumb-cache')
  return args
}

/** Path of the shared cached PyMuPDF venv, mirroring setup_env.sh. */
export function cachedVenvPython() {
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(cacheRoot, 'paper-deepread', 'venv', 'bin', 'python')
}

/** Common python3 candidates on PATH, checked without a shell. */
const SYSTEM_PYTHON_CANDIDATES = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3']

/**
 * Locate a python3 that already exists (no install, no network).
 * @returns {string|null} Interpreter path or null.
 */
export function findSystemPython() {
  const fromPath = (process.env.PATH || '').split(':').filter(Boolean)
    .map(directory => join(directory, 'python3'))
  for (const candidate of [...fromPath, ...SYSTEM_PYTHON_CANDIDATES]) {
    try {
      if (existsSync(candidate)) return candidate
    } catch { /* ignore */ }
  }
  return null
}

/**
 * Interpreter registry for one managed instance.
 *
 * `quick()` never installs anything: it reuses a cached venv or a
 * PyMuPDF-capable python3, otherwise returns null. `prepare()` runs the
 * skill's `setup_env.sh`, which may create the cached venv and install PyMuPDF
 * on first use; the resolved path is cached for the process lifetime.
 */
export class PythonRegistry {
  /** @param {{skillDir: string, logger?: object}} options */
  constructor(options) {
    this.skillDir = options.skillDir
    this.logger = options.logger
    this.resolved = null
    this.preparePromise = null
    this.hint = null
  }

  /** Cached interpreter path, if any. */
  get path() {
    return this.resolved
  }

  /** Describe availability without installing anything. */
  async quick() {
    if (this.resolved) return this.resolved
    const candidates = [cachedVenvPython(), findSystemPython()].filter(Boolean)
    for (const candidate of candidates) {
      const probe = await runProcess(candidate, ['-c', 'import fitz, sys; print(sys.executable)'], { timeoutMs: PROBE_TIMEOUT_MS })
      if (probe.ok) {
        this.resolved = probe.stdout.trim().split('\n').pop() || candidate
        return this.resolved
      }
    }
    this.hint = 'PyMuPDF interpreter not prepared yet; call paper_deepread_uploads action "env" once.'
    return null
  }

  /**
   * Prepare (possibly installing PyMuPDF) and return the interpreter.
   * @param {{install?: boolean}} [options] `install:false` behaves like quick().
   */
  async prepare(options = {}) {
    if (this.resolved) return this.resolved
    if (options.install === false) return this.quick()
    if (!this.preparePromise) {
      this.preparePromise = (async () => {
        const { command, args } = buildSetupEnvCommand(this.skillDir)
        const result = await runProcess(command, args, { timeoutMs: ENV_TIMEOUT_MS })
        const lines = result.stdout.split('\n').map(line => line.trim()).filter(Boolean)
        const candidate = lines.length > 0 ? lines[lines.length - 1] : ''
        if (result.ok && candidate && existsSync(candidate)) {
          this.resolved = candidate
          this.hint = null
          return this.resolved
        }
        this.hint = `setup_env.sh failed (${result.timedOut ? 'timeout' : `exit ${result.code}`}): ${result.stderr.split('\n').slice(-6).join(' ').slice(0, 500)}`
        this.logger?.warn?.(`DSH-Paper-DeepRead: ${this.hint}`)
        return null
      })().finally(() => { this.preparePromise = null })
    }
    return this.preparePromise
  }

  /** Availability snapshot for the API/tools. */
  async describe() {
    const path = await this.quick()
    return {
      ok: Boolean(path),
      path: path ?? undefined,
      hint: path ? undefined : this.hint,
      skillDir: this.skillDir,
    }
  }
}
