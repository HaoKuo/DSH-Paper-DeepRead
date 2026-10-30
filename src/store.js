/**
 * Persistent managed library store for DSH-Paper-DeepRead.
 *
 * Layout under `dataDir`:
 *
 *   dataDir/
 *   ├── .seed.json          marker: the package snapshot was copied once
 *   ├── state.json          upload inbox and statuses (atomic writes)
 *   ├── library/            managed 文献精读库 root (seeded once, then user-owned)
 *   ├── uploads/<id>.pdf    raw uploaded PDFs
 *   └── work/<id>/          ingest output + agent-authored report sources
 *
 * When the legacy `libraryDir` option is configured, that directory is the
 * managed root and no seeding happens: the user owns an external 文献精读库.
 *
 * This module imports only Node built-ins and keeps every write atomic
 * (write to a sibling temp file, then rename) so a crash cannot truncate
 * `state.json` or a curated `library.json`.
 *
 * @module dsh-paper-deepread/store
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { randomBytes } from 'node:crypto'

/** Current `state.json` schema version. */
export const STATE_VERSION = 1

/** Marker file recording the one-time package-library seed. */
export const SEED_MARKER = '.seed.json'

/** Default upload limit: 80 MB per PDF. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024

/** Directory name created under `$DSH_HOME` when no `dataDir` is configured. */
export const DEFAULT_DATA_DIR_NAME = 'paper-deepread'

/**
 * Resolve the Harness home directory.
 * @param {string} [explicit] Explicit override, then `$DSH_HOME`, then `~/.dsh`.
 * @returns {string} Absolute home directory.
 */
export function resolveDshHome(explicit) {
  const value = explicit || process.env.DSH_HOME
  return value ? resolve(value) : join(homedir(), '.dsh')
}

/**
 * Resolve the managed data directory.
 * @param {{dataDir?: string, dshHome?: string}} [options] Row config and home.
 * @returns {string} Absolute data directory.
 */
export function resolveDataDir(options = {}) {
  const configured = typeof options.dataDir === 'string' ? options.dataDir.trim() : ''
  if (configured) return resolve(configured)
  return join(resolveDshHome(options.dshHome), DEFAULT_DATA_DIR_NAME)
}

/** Read JSON, or `fallback` when the file is absent or malformed. */
export function readJsonFile(file, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Write JSON atomically (temp file + rename) and return the value. */
export function atomicWriteJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  return value
}

/** Whether `candidate` stays inside `root` after path resolution. */
export function isPathInside(root, candidate) {
  const resolvedRoot = resolve(root)
  const resolved = resolve(candidate)
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`)
}

/** Error carrying a stable API code. */
export class StoreError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

/**
 * Validate a report directory name and return its absolute path.
 *
 * Only a direct child directory of `root` is accepted: absolute paths, `..`,
 * separators, dot names, files, and symlinks that escape the root are refused.
 *
 * @param {string} root Managed library root.
 * @param {unknown} name Candidate directory name (not a path).
 * @returns {string} Absolute directory path.
 */
export function safeChildDir(root, name) {
  if (typeof name !== 'string' || !name.trim()) throw new StoreError('BAD_DIR', 'directory name is required')
  const value = name.trim()
  if (isAbsolute(value) || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new StoreError('BAD_DIR', `unsafe report directory name: ${JSON.stringify(value)}`)
  }
  const target = resolve(root, value)
  if (!isPathInside(root, target) || target === resolve(root)) throw new StoreError('BAD_DIR', 'report directory must be a direct child of the library root')
  let info
  try {
    info = statSync(target)
  } catch {
    throw new StoreError('NOT_FOUND', `report directory not found: ${value}`)
  }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new StoreError('BAD_DIR', 'report target is not a real directory')
  try {
    const realRoot = realpathSync(root)
    const realTarget = realpathSync(target)
    if (!isPathInside(realRoot, realTarget)) throw new StoreError('BAD_DIR', 'report directory resolves outside the library root')
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError('BAD_DIR', `cannot resolve report directory: ${String(error?.message || error)}`)
  }
  return target
}

/** New upload identifier: sortable timestamp plus random suffix. */
export function newUploadId(now = Date.now()) {
  const stamp = new Date(now).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `${stamp}-${randomBytes(4).toString('hex')}`
}

/**
 * One managed instance: directories, one-time seed, and `state.json`.
 */
export class PaperStore {
  /**
   * @param {object} options Store options.
   * @param {string} options.dataDir Absolute managed data directory.
   * @param {string} options.packageDir Installed package root (seed source).
   * @param {string} [options.legacyLibraryDir] External 文献精读库 root (legacy config).
   * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
   */
  constructor(options) {
    this.dataDir = resolve(options.dataDir)
    this.packageDir = resolve(options.packageDir)
    this.legacyLibraryDir = options.legacyLibraryDir ? resolve(options.legacyLibraryDir) : null
    this.logger = options.logger
    this.managed = this.legacyLibraryDir === null
    this.libraryRoot = this.legacyLibraryDir ?? join(this.dataDir, 'library')
    this.uploadsDir = join(this.dataDir, 'uploads')
    this.workDir = join(this.dataDir, 'work')
    this.statePath = join(this.dataDir, 'state.json')
    this.seedMarkerPath = join(this.dataDir, SEED_MARKER)
    this.maxUploadBytes = options.maxUploadBytes ?? MAX_UPLOAD_BYTES
    this.writeTail = Promise.resolve()
    this.ready = false
  }

  /** Create directories and seed the snapshot exactly once. */
  ensure() {
    if (this.ready) return this
    mkdirSync(this.dataDir, { recursive: true })
    mkdirSync(this.uploadsDir, { recursive: true })
    mkdirSync(this.workDir, { recursive: true })
    if (this.managed) this.seedOnce()
    if (!existsSync(this.statePath)) this.writeState(this.defaultState())
    else if (readJsonFile(this.statePath, null) === null) this.writeState(this.defaultState())
    this.ready = true
    return this
  }

  /** Copy the package `library/` snapshot into the managed root on first run. */
  seedOnce() {
    const source = join(this.packageDir, 'library')
    const marker = readJsonFile(this.seedMarkerPath, null)
    if (marker !== null) return
    const targetIndex = join(this.libraryRoot, 'index.html')
    if (existsSync(targetIndex)) {
      // An existing library without a marker belongs to the user; record the
      // seed decision but never overwrite it.
      this.writeSeedMarker({ copied: false, reason: 'existing-library' })
      return
    }
    try {
      mkdirSync(this.libraryRoot, { recursive: true })
      if (existsSync(source)) cpSync(source, this.libraryRoot, { recursive: true, dereference: true })
      this.writeSeedMarker({ copied: true, source: 'package-library' })
      this.logger?.info?.(`DSH-Paper-DeepRead: seeded managed library at ${this.libraryRoot}`)
    } catch (error) {
      this.logger?.warn?.(`DSH-Paper-DeepRead: could not seed managed library at ${this.libraryRoot}: ${String(error?.message || error)}`)
    }
  }

  writeSeedMarker(extra) {
    try {
      atomicWriteJson(this.seedMarkerPath, {
        seededAt: new Date().toISOString(),
        packageLibrary: join(this.packageDir, 'library'),
        ...extra,
      })
    } catch (error) {
      this.logger?.warn?.(`DSH-Paper-DeepRead: could not write seed marker: ${String(error?.message || error)}`)
    }
  }

  defaultState() {
    const now = new Date().toISOString()
    return {
      version: STATE_VERSION,
      createdAt: now,
      updatedAt: now,
      seed: this.managed ? { packageLibrary: join(this.packageDir, 'library') } : { external: this.legacyLibraryDir },
      uploads: [],
    }
  }

  /** Read the current state (defaults are filled for older documents). */
  readState() {
    const value = readJsonFile(this.statePath, null)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return this.defaultState()
    return {
      version: STATE_VERSION,
      createdAt: value.createdAt || new Date().toISOString(),
      updatedAt: value.updatedAt || new Date().toISOString(),
      seed: value.seed || (this.managed ? { packageLibrary: join(this.packageDir, 'library') } : {}),
      uploads: Array.isArray(value.uploads) ? value.uploads.filter(entry => entry && typeof entry.id === 'string') : [],
    }
  }

  writeState(state) {
    return atomicWriteJson(this.statePath, state)
  }

  /**
   * Serialize a read-modify-write cycle.
   * @template T
   * @param {(state: object) => T|Promise<T>} mutator Receives a copy of the state.
   * @returns {Promise<T>} Mutator result.
   */
  async update(mutator) {
    const run = async () => {
      const state = this.readState()
      const result = await mutator(state)
      state.updatedAt = new Date().toISOString()
      this.writeState(state)
      return result
    }
    const next = this.writeTail.then(run, run)
    this.writeTail = next.then(() => undefined, () => undefined)
    return next
  }

  /** Upload record with absolute paths, as exposed through the API. */
  publicUpload(upload) {
    return {
      ...upload,
      pdfPath: upload.pdf ? join(this.dataDir, upload.pdf) : null,
      workDir: upload.workDir ? join(this.dataDir, upload.workDir) : join(this.workDir, upload.id),
    }
  }

  listUploads() {
    return this.readState().uploads.map(entry => this.publicUpload(entry))
  }

  getUpload(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,80}$/u.test(id)) throw new StoreError('BAD_ID', `invalid upload id: ${JSON.stringify(id)}`)
    const found = this.readState().uploads.find(entry => entry.id === id)
    if (!found) throw new StoreError('NOT_FOUND', `upload not found: ${id}`)
    return this.publicUpload(found)
  }

  /** Append an upload record and return its public shape. */
  async addUpload(record) {
    mkdirSync(join(this.workDir, record.id), { recursive: true })
    await this.update(state => {
      state.uploads.push({
        id: record.id,
        name: record.name,
        bytes: record.bytes,
        createdAt: new Date().toISOString(),
        status: 'uploaded',
        error: null,
        pdf: record.pdfRelative,
        workDir: join('work', record.id).split(sep).join('/'),
        reportDir: null,
      })
    })
    return this.getUpload(record.id)
  }

  /** Patch one upload record. */
  async patchUpload(id, patch) {
    return this.update(state => {
      const entry = state.uploads.find(item => item.id === id)
      if (!entry) throw new StoreError('NOT_FOUND', `upload not found: ${id}`)
      Object.assign(entry, patch)
      return entry
    }).then(entry => this.publicUpload(entry))
  }

  /** Remove an upload record; the caller deletes files. */
  async removeUpload(id) {
    let removed = null
    await this.update(state => {
      const index = state.uploads.findIndex(item => item.id === id)
      if (index < 0) throw new StoreError('NOT_FOUND', `upload not found: ${id}`)
      removed = state.uploads.splice(index, 1)[0]
    })
    return removed
  }

  /** Remove `work/<id>/` and the raw PDF if present. */
  deleteUploadArtifacts(id) {
    const workDirectory = join(this.workDir, id)
    if (isPathInside(this.workDir, workDirectory)) rmSync(workDirectory, { recursive: true, force: true })
    const pdf = join(this.uploadsDir, `${id}.pdf`)
    if (isPathInside(this.uploadsDir, pdf)) rmSync(pdf, { force: true })
  }
}
