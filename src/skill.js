/**
 * Self-registration of the bundled Paper Deepread skill.
 *
 * The plugin ships `skills/paper-deepread-html/` and installs a copy into the
 * Harness skills directory on first activation. The rule is intentionally
 * conservative: an existing directory is never touched, because the user's own
 * copy of this skill may be newer than the bundled snapshot. Every failure is
 * reported through the logger and swallowed, so a read-only or unusual
 * `$DSH_HOME` degrades the skill feature instead of failing plugin activation.
 *
 * This module imports nothing outside Node's standard library so it can be
 * exercised directly in a throwaway `$DSH_HOME`.
 *
 * @module dsh-paper-deepread/skill
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name the bundled skill must keep inside `skills/`. */
export const SKILL_NAME = 'paper-deepread-html'

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
 * Install the bundled skill when the target directory does not exist yet.
 * @param {object} options Registration options.
 * @param {string} options.packageDir Root of the installed plugin package.
 * @param {string} [options.dshHome] Harness home override (defaults to `$DSH_HOME`).
 * @param {string} [options.skillsDir] Explicit skills directory override.
 * @param {boolean} [options.registerSkill] `false` skips registration entirely.
 * @param {{info?: Function, warn?: Function}} [options.logger] Plugin logger.
 * @returns {{status: 'installed'|'skipped'|'disabled'|'failed', target?: string, error?: string}}
 *   `installed` copies the bundle, `skipped` keeps the user's existing skill,
 *   `disabled` is the explicit opt-out, and `failed` carries a message.
 */
export function installBundledSkill(options = {}) {
  const { packageDir, logger } = options
  if (options.registerSkill === false) return { status: 'disabled' }
  const source = packageDir ? join(packageDir, 'skills', SKILL_NAME) : undefined
  const skillsDir = resolveSkillsDir(options)
  const target = join(skillsDir, SKILL_NAME)
  try {
    if (!source || !existsSync(source)) {
      const message = `bundled skill "${SKILL_NAME}" is missing from the package at ${source ?? '<unknown>'}`
      logger?.warn?.(`DSH-Paper-DeepRead: ${message}`)
      return { status: 'failed', target, error: message }
    }
    if (existsSync(target)) {
      // Never overwrite the user's existing copy, even when it looks outdated.
      logger?.info?.(`DSH-Paper-DeepRead: skill "${SKILL_NAME}" already exists at ${target}; keeping the existing copy`)
      return { status: 'skipped', target }
    }
    mkdirSync(skillsDir, { recursive: true })
    cpSync(source, target, { recursive: true, dereference: true })
    logger?.info?.(`DSH-Paper-DeepRead: installed bundled skill "${SKILL_NAME}" at ${target}`)
    return { status: 'installed', target }
  } catch (error) {
    const message = String(error?.message || error)
    logger?.warn?.(`DSH-Paper-DeepRead: could not install bundled skill "${SKILL_NAME}" at ${target}: ${message}`)
    return { status: 'failed', target, error: message }
  }
}
