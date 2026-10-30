/**
 * Managed installation and version sync of the bundled Paper Deepread skill.
 *
 * The plugin ships `skills/paper-deepread-html/` and keeps a copy installed in
 * the Harness skills directory. v1.2.0 replaces the old "install once, never
 * touch again" rule with an explicit, conservative sync policy:
 *
 *   - missing installed copy            -> install it (always);
 *   - `skillSync: "keep"`               -> never update an existing copy;
 *   - installed version == bundled      -> skip (nothing to do);
 *   - installed version > bundled       -> skip (never downgrade);
 *   - installed version < bundled and the installed tree is byte-identical to
 *     the tree this plugin installed last time (content hash recorded in
 *     `<dataDir>/skill-state.json`) -> back up the old copy to
 *     `<skillsDir>/.backup/paper-deepread-html-<version>-<UTC>/`, copy the
 *     bundled tree, and refresh the recorded hash;
 *   - installed < bundled but modified (or not tracked) -> keep the user's
 *     copy and warn. The plugin never silently overwrites user edits.
 *
 * Every failure is reported through the logger and swallowed, so a read-only
 * or unusual `$DSH_HOME` degrades the skill feature instead of failing plugin
 * activation. The module imports only Node built-ins (plus the stdlib-only
 * `store.js` helpers) so it can be exercised directly in a throwaway
 * `$DSH_HOME`.
 *
 * @module dsh-paper-deepread/skill
 */

import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { atomicWriteJson, readJsonFile } from './store.js'

/** Directory name the bundled skill must keep inside `skills/`. */
export const SKILL_NAME = 'paper-deepread-html'

/** File recording what this plugin last installed, under `dataDir`. */
export const SKILL_STATE_FILE = 'skill-state.json'

/** Supported `skillSync` modes. */
export const SKILL_SYNC_MODES = ['update', 'keep']

/** Sub-directory of the skills directory that holds pre-update backups. */
export const SKILL_BACKUP_DIR = '.backup'

/** Current `skill-state.json` schema version. */
export const SKILL_STATE_VERSION = 1

/** Frontmatter that starts a SKILL.md document. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u

/**
 * Resolve the Harness skills directory.
 * @param {{dshHome?: string, skillsDir?: string}} [options] Explicit overrides.
 * @returns {string} Absolute skills directory.
 */
export function resolveSkillsDir(options = {}) {
  if (typeof options.skillsDir === 'string' && options.skillsDir.trim()) {
    return resolve(options.skillsDir)
  }
  const home = typeof options.dshHome === 'string' && options.dshHome.trim()
    ? options.dshHome
    : (process.env.DSH_HOME || join(homedir(), '.dsh'))
  return join(resolve(home), 'skills')
}

/**
 * Parse the `version:` field of a SKILL.md YAML frontmatter block.
 *
 * Only the simple scalar form is supported (`version: 1.1.5`, optionally
 * single/double quoted, optionally followed by a comment); that is all the
 * skill format uses. A document without frontmatter or without the field
 * yields `""`.
 *
 * @param {string} markdown Full SKILL.md contents.
 * @returns {string} Version string, or `''` when absent.
 */
export function parseSkillVersion(markdown) {
  if (typeof markdown !== 'string' || !markdown) return ''
  const text = markdown.replace(/^\uFEFF/u, '')
  const block = FRONTMATTER_RE.exec(text)
  if (!block) return ''
  for (const line of block[1].split(/\r?\n/u)) {
    const match = /^version\s*:\s*(.*)$/u.exec(line)
    if (!match) continue
    const value = match[1].replace(/\s+#.*$/u, '').trim()
    if (!value) return ''
    const quoted = /^(['"])(.*)\1$/u.exec(value)
    return (quoted ? quoted[2] : value).trim().slice(0, 40)
  }
  return ''
}

/**
 * Read the version declared by `<skillDir>/SKILL.md`.
 * @param {string} skillDir Skill directory (bundled or installed).
 * @returns {string} Version string, or `''` when the file/field is absent.
 */
export function readSkillVersion(skillDir) {
  if (typeof skillDir !== 'string' || !skillDir.trim()) return ''
  try {
    return parseSkillVersion(readFileSync(join(resolve(skillDir), 'SKILL.md'), 'utf8'))
  } catch {
    return ''
  }
}

/** Split a version into numeric parts plus a prerelease label. */
function versionParts(version) {
  const text = String(version ?? '').trim().replace(/^v/iu, '')
  const [core, ...rest] = text.split('-')
  const numbers = (core || '').split('.').map(part => {
    const match = /^\d+/u.exec(part)
    return match ? Number(match[0]) : 0
  })
  while (numbers.length < 3) numbers.push(0)
  return { numbers, prerelease: rest.join('-') }
}

/**
 * Compare two dotted versions (semver-ish, tolerant of missing parts).
 *
 * @param {string} left Version such as `1.1.5`.
 * @param {string} right Version such as `1.2.0`.
 * @returns {-1|0|1} `-1` when left is older, `0` when equal, `1` when newer.
 */
export function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  const length = Math.max(a.numbers.length, b.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const av = a.numbers[index] ?? 0
    const bv = b.numbers[index] ?? 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

/**
 * Content hash of a skill tree.
 *
 * Hashes every regular file's POSIX-style relative path and bytes in sorted
 * order. Directory timestamps and empty directories do not participate, so a
 * re-copied but unchanged tree hashes identically. Returns `null` when the
 * directory does not exist or cannot be read.
 *
 * @param {string} skillDir Skill directory.
 * @returns {string|null} `sha256:<hex>`, or `null`.
 */
export function hashSkillTree(skillDir) {
  if (typeof skillDir !== 'string' || !skillDir.trim()) return null
  const root = resolve(skillDir)
  if (!existsSync(root)) return null
  try {
    const files = []
    const walk = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name)
        if (entry.isDirectory()) walk(full)
        else files.push(full)
      }
    }
    walk(root)
    files.sort((a, b) => {
      const left = relative(root, a)
      const right = relative(root, b)
      return left < right ? -1 : left > right ? 1 : 0
    })
    const hash = createHash('sha256')
    for (const file of files) {
      hash.update(relative(root, file).split(sep).join('/'))
      hash.update('\0')
      try {
        hash.update(readFileSync(file))
      } catch {
        hash.update('<unreadable>')
      }
      hash.update('\0')
    }
    return `sha256:${hash.digest('hex')}`
  } catch {
    return null
  }
}

/**
 * Absolute path of the skill state file for one data directory.
 * @param {string} dataDir Managed data directory.
 * @returns {string} Absolute path, or `''` when no data directory is known.
 */
export function skillStatePath(dataDir) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) return ''
  return join(resolve(dataDir), SKILL_STATE_FILE)
}

/**
 * Read `<dataDir>/skill-state.json`.
 * @param {string} dataDir Managed data directory.
 * @returns {object|null} Recorded state, or `null` when absent/malformed.
 */
export function readSkillState(dataDir) {
  const file = skillStatePath(dataDir)
  if (!file) return null
  const value = readJsonFile(file, null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

/** Write the skill state atomically; errors are logged by the caller. */
function writeSkillState(dataDir, record) {
  const file = skillStatePath(dataDir)
  if (!file) return null
  return atomicWriteJson(file, {
    version: SKILL_STATE_VERSION,
    skill: SKILL_NAME,
    updatedAt: new Date().toISOString(),
    ...record,
  })
}

/** Version of the plugin package that bundled the skill. */
function packageVersionOf(packageDir) {
  try {
    const value = readJsonFile(join(packageDir, 'package.json'), null)
    return typeof value?.version === 'string' ? value.version : ''
  } catch {
    return ''
  }
}

/** Current UTC stamp that is safe inside a directory name (`20261030T211500Z`). */
function utcStamp() {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')
}

/** Version fragment safe inside one backup directory name. */
function versionForPath(version) {
  const value = String(version ?? '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[.-]+/u, '')
    .replace(/[.-]+$/u, '')
    .slice(0, 40)
  return value || 'unknown'
}

/** Resolve the configured sync mode, defaulting to `update`. */
function normalizeMode(value, logger) {
  if (value === undefined || value === null || value === '') return 'update'
  const mode = String(value).trim().toLowerCase()
  if (SKILL_SYNC_MODES.includes(mode)) return mode
  logger?.warn?.(`DSH-Paper-DeepRead: unknown skillSync value ${JSON.stringify(value)}; using "update"`)
  return 'update'
}

/** Copy the bundled skill into place and record its version + content hash. */
function installCopy({ source, target, dataDir, bundledVersion, packageDir }) {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true, dereference: true })
  const now = new Date().toISOString()
  try {
    writeSkillState(dataDir, {
      installedVersion: bundledVersion,
      contentHash: hashSkillTree(target),
      source: 'package',
      packageVersion: packageVersionOf(packageDir),
      installedAt: now,
    })
  } catch {
    // A read-only data directory must not break the install itself.
  }
}

/**
 * Describe the bundled and installed skill for the API/tool surface.
 *
 * Reads only version metadata (never hashes the tree) so it can run on every
 * `/state` poll.
 *
 * @param {object} options
 * @param {string} options.packageDir Installed package root.
 * @param {string} [options.skillsDir] Harness skills directory.
 * @param {string} [options.dataDir] Managed data directory.
 * @param {string} [options.skillSync] Configured sync mode.
 * @returns {object} JSON-safe description.
 */
export function describeSkill(options = {}) {
  const { packageDir } = options
  const skillsDir = resolveSkillsDir(options)
  const dir = packageDir ? join(packageDir, 'skills', SKILL_NAME) : ''
  const installedDir = join(skillsDir, SKILL_NAME)
  const bundledPresent = Boolean(dir) && existsSync(join(dir, 'SKILL.md'))
  const installedPresent = existsSync(join(installedDir, 'SKILL.md'))
  const version = readSkillVersion(dir)
  const installedVersion = installedPresent ? readSkillVersion(installedDir) : ''
  const state = readSkillState(options.dataDir)
  const tracked = Boolean(state && state.skill === SKILL_NAME && typeof state.contentHash === 'string' && state.contentHash)
  return {
    dir,
    installed: bundledPresent,
    version,
    installedDir,
    installedPresent,
    installedVersion,
    tracked,
    trackedVersion: typeof state?.installedVersion === 'string' ? state.installedVersion : '',
    syncMode: normalizeMode(options.skillSync),
    statePath: skillStatePath(options.dataDir) || null,
  }
}

/**
 * Install or update the bundled skill according to the version-sync policy.
 *
 * @param {object} options
 * @param {string} options.packageDir Root of the installed plugin package.
 * @param {string} [options.dshHome] Harness home override (defaults to `$DSH_HOME`).
 * @param {string} [options.skillsDir] Explicit skills directory override.
 * @param {string} [options.dataDir] Managed data directory for `skill-state.json`.
 * @param {'update'|'keep'} [options.skillSync] Sync mode (default `update`).
 * @param {boolean} [options.registerSkill] `false` skips skill registration entirely.
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @returns {{status: 'installed'|'updated'|'skipped'|'preserved'|'disabled'|'failed',
 *   reason?: string, target: string, bundledVersion: string, installedVersion: string,
 *   previousVersion?: string, backupDir?: string, error?: string}}
 *   `installed` copied the bundle, `updated` replaced a tracked unmodified copy,
 *   `skipped`/`preserved` left the installed copy alone, `disabled` is the
 *   explicit opt-out, and `failed` carries a message.
 */
export function syncBundledSkill(options = {}) {
  const { packageDir, logger } = options
  const mode = normalizeMode(options.skillSync, logger)
  const source = packageDir ? join(packageDir, 'skills', SKILL_NAME) : ''
  const skillsDir = resolveSkillsDir(options)
  const target = join(skillsDir, SKILL_NAME)
  const bundledVersion = readSkillVersion(source)
  const base = { target, skillsDir, mode, bundledVersion }
  if (options.registerSkill === false) return { ...base, status: 'disabled', installedVersion: '' }
  try {
    if (!source || !existsSync(join(source, 'SKILL.md'))) {
      const message = `bundled skill "${SKILL_NAME}" is missing from the package at ${source || '<unknown>'}`
      logger?.warn?.(`DSH-Paper-DeepRead: ${message}`)
      return { ...base, status: 'failed', installedVersion: '', error: message }
    }
    if (!existsSync(join(target, 'SKILL.md'))) {
      installCopy({ source, target, dataDir: options.dataDir, bundledVersion, packageDir })
      logger?.info?.(`DSH-Paper-DeepRead: installed bundled skill "${SKILL_NAME}" ${bundledVersion || '(unversioned)'} at ${target}`)
      return { ...base, status: 'installed', installedVersion: bundledVersion }
    }

    const installedVersion = readSkillVersion(target)
    if (mode === 'keep') {
      logger?.info?.(`DSH-Paper-DeepRead: skillSync "keep" — leaving installed skill "${SKILL_NAME}" untouched (installed ${installedVersion || 'unknown'}, bundled ${bundledVersion || 'unknown'})`)
      return { ...base, status: 'skipped', reason: 'config-keep', installedVersion }
    }
    if (!bundledVersion) {
      logger?.warn?.(`DSH-Paper-DeepRead: bundled skill "${SKILL_NAME}" has no version in its SKILL.md frontmatter; keeping the installed copy`)
      return { ...base, status: 'skipped', reason: 'no-bundled-version', installedVersion }
    }
    if (!installedVersion) {
      logger?.warn?.(`DSH-Paper-DeepRead: installed skill "${SKILL_NAME}" at ${target} has no version in its SKILL.md frontmatter; keeping the user-managed copy`)
      return { ...base, status: 'preserved', reason: 'untracked', installedVersion }
    }
    const comparison = compareVersions(installedVersion, bundledVersion)
    if (comparison === 0) {
      logger?.info?.(`DSH-Paper-DeepRead: skill "${SKILL_NAME}" is up to date (${bundledVersion})`)
      return { ...base, status: 'skipped', reason: 'up-to-date', installedVersion }
    }
    if (comparison > 0) {
      logger?.info?.(`DSH-Paper-DeepRead: installed skill "${SKILL_NAME}" ${installedVersion} is newer than the bundled ${bundledVersion}; never downgrading`)
      return { ...base, status: 'skipped', reason: 'newer', installedVersion }
    }

    const state = readSkillState(options.dataDir)
    const tracked = Boolean(state && state.skill === SKILL_NAME && typeof state.contentHash === 'string' && state.contentHash)
    if (!tracked) {
      logger?.warn?.(`DSH-Paper-DeepRead: installed skill "${SKILL_NAME}" ${installedVersion} is older than the bundled ${bundledVersion}, but it was not installed by this plugin or has no recorded content hash; keeping the user's copy`)
      return { ...base, status: 'preserved', reason: 'untracked', installedVersion }
    }
    const currentHash = hashSkillTree(target)
    if (!currentHash || currentHash !== state.contentHash) {
      logger?.warn?.(`DSH-Paper-DeepRead: installed skill "${SKILL_NAME}" was modified since it was installed; keeping the user's copy (bundled ${bundledVersion} not copied)`)
      return { ...base, status: 'preserved', reason: 'modified', installedVersion }
    }

    const backupDir = join(skillsDir, SKILL_BACKUP_DIR, `${SKILL_NAME}-${versionForPath(installedVersion)}-${utcStamp()}`)
    mkdirSync(dirname(backupDir), { recursive: true })
    cpSync(target, backupDir, { recursive: true, dereference: true })
    rmSync(target, { recursive: true, force: true })
    installCopy({ source, target, dataDir: options.dataDir, bundledVersion, packageDir })
    logger?.info?.(`DSH-Paper-DeepRead: updated skill "${SKILL_NAME}" ${installedVersion} -> ${bundledVersion} (previous copy backed up to ${backupDir})`)
    return { ...base, status: 'updated', reason: 'outdated', previousVersion: installedVersion, installedVersion: bundledVersion, backupDir }
  } catch (error) {
    const message = String(error?.message || error)
    logger?.warn?.(`DSH-Paper-DeepRead: could not sync bundled skill "${SKILL_NAME}" at ${target}: ${message}`)
    return { ...base, status: 'failed', installedVersion: readSkillVersion(target), error: message }
  }
}

/**
 * Legacy alias kept for callers written against v1.1.x.
 *
 * v1.2.0 uses {@link syncBundledSkill}; the alias keeps the old "install when
 * missing" behaviour for external code that imported this name.
 *
 * @deprecated Use {@link syncBundledSkill}.
 */
export function installBundledSkill(options = {}) {
  return syncBundledSkill(options)
}
