/**
 * Skill version sync tests (v1.2.0).
 *
 * Exercises the stdlib-only `src/skill.js` against throwaway package roots,
 * skills directories, and data directories: frontmatter parsing, version
 * comparison, hash-tracked install/update, backups, user-modification
 * preservation, and the `skillSync` policy.
 *
 * Run with: node --test tests/skill.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  SKILL_NAME,
  compareVersions,
  describeSkill,
  hashSkillTree,
  parseSkillVersion,
  readSkillState,
  syncBundledSkill,
} from '../src/skill.js'

/** SKILL.md contents with a versioned frontmatter block. */
function skillMarkdown(version, body = 'skill body') {
  const header = version === null ? ['---', 'name: paper-deepread-html', '---'] : ['---', 'name: paper-deepread-html', `version: ${version}`, '---']
  return `${header.join('\n')}\n\n# ${body}\n`
}

/** Disposable package + skills dir + data dir for skill sync tests. */
function makeSkillFixture({ bundledVersion = '1.1.5', body = 'v1' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'pdr-skill-'))
  const packageDir = join(base, 'package')
  const source = join(packageDir, 'skills', SKILL_NAME)
  mkdirSync(join(source, 'scripts'), { recursive: true })
  mkdirSync(join(source, 'assets'), { recursive: true })
  writeFileSync(join(source, 'SKILL.md'), skillMarkdown(bundledVersion, body))
  writeFileSync(join(source, 'scripts', 'build_report.py'), `print("${body}")\n`)
  writeFileSync(join(source, 'assets', 'report_template.html'), `<html>${body}</html>\n`)
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-paper-deepread', version: '1.2.0' }))
  const dataDir = join(base, 'data')
  const skillsDir = join(base, 'skills')
  const installedDir = join(skillsDir, SKILL_NAME)
  return {
    base,
    packageDir,
    source,
    dataDir,
    skillsDir,
    installedDir,
    statePath: join(dataDir, 'skill-state.json'),
    /** Replace the bundled tree to simulate a newer packaged skill release. */
    writeBundled(version, nextBody = `v-${version}`) {
      writeFileSync(join(source, 'SKILL.md'), skillMarkdown(version, nextBody))
      writeFileSync(join(source, 'scripts', 'build_report.py'), `print("${nextBody}")\n`)
      writeFileSync(join(source, 'assets', 'report_template.html'), `<html>${nextBody}</html>\n`)
    },
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  }
}

/** Logger that records every message so tests can assert on warnings. */
function recordingLogger() {
  const entries = []
  return {
    entries,
    info: message => entries.push({ level: 'info', message }),
    warn: message => entries.push({ level: 'warn', message }),
    warnings: () => entries.filter(entry => entry.level === 'warn').map(entry => entry.message).join('\n'),
    text: () => entries.map(entry => entry.message).join('\n'),
  }
}

test('parseSkillVersion reads the frontmatter version field', () => {
  assert.equal(parseSkillVersion('---\nname: x\nversion: 1.1.5\n---\n# body\n'), '1.1.5')
  assert.equal(parseSkillVersion('---\r\nname: x\r\nversion: 1.1.5\r\n---\r\n'), '1.1.5')
  assert.equal(parseSkillVersion('---\nversion: "1.2.0"\n---\n'), '1.2.0')
  assert.equal(parseSkillVersion("---\nversion: '2.0.0-rc.1'\n---\n"), '2.0.0-rc.1')
  assert.equal(parseSkillVersion('---\nversion: 1.1.5 # bundled\n---\n'), '1.1.5')
  assert.equal(parseSkillVersion('---\nname: x\n---\n'), '')
  assert.equal(parseSkillVersion('no frontmatter\nversion: 1.0.0\n'), '')
  assert.equal(parseSkillVersion(''), '')
  assert.equal(parseSkillVersion(null), '')
})

test('compareVersions orders dotted versions and prereleases', () => {
  assert.equal(compareVersions('1.1.5', '1.1.5'), 0)
  assert.equal(compareVersions('1.1.4', '1.1.5'), -1)
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1)
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersions('1.1', '1.1.0'), 0)
  assert.equal(compareVersions('1.1.5-rc.1', '1.1.5'), -1)
  assert.equal(compareVersions('1.1.5', '1.1.5-rc.1'), 1)
  assert.equal(compareVersions('v1.1.5', '1.1.5'), 0)
})

test('syncBundledSkill installs a missing skill and records its hash', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'installed')
    assert.equal(result.installedVersion, '1.1.5')
    assert.ok(existsSync(join(fixture.installedDir, 'SKILL.md')))
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 1\.1\.5/)
    const state = readSkillState(fixture.dataDir)
    assert.equal(state.installedVersion, '1.1.5')
    assert.equal(state.packageVersion, '1.2.0')
    assert.equal(state.skill, SKILL_NAME)
    assert.equal(state.contentHash, hashSkillTree(fixture.installedDir))
    assert.match(logger.text(), /installed bundled skill/)
    // A second activation is a no-op.
    const again = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(again.status, 'skipped')
    assert.equal(again.reason, 'up-to-date')
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill updates a tracked unmodified copy and backs up the old one', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    fixture.writeBundled('1.2.0', 'v2')
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'updated')
    assert.equal(result.previousVersion, '1.1.5')
    assert.equal(result.installedVersion, '1.2.0')
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 1\.2\.0/)
    assert.match(readFileSync(join(fixture.installedDir, 'scripts', 'build_report.py'), 'utf8'), /v2/)
    const backups = readdirSync(join(fixture.skillsDir, '.backup'))
    assert.equal(backups.length, 1)
    assert.match(backups[0], /^paper-deepread-html-1\.1\.5-\d{8}T\d{6}Z$/u)
    assert.equal(join(fixture.skillsDir, '.backup', backups[0]), result.backupDir)
    assert.match(readFileSync(join(result.backupDir, 'SKILL.md'), 'utf8'), /version: 1\.1\.5/)
    assert.equal(readSkillState(fixture.dataDir).installedVersion, '1.2.0')
    assert.equal(readSkillState(fixture.dataDir).contentHash, hashSkillTree(fixture.installedDir))
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill preserves a user-modified installed copy', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    writeFileSync(join(fixture.installedDir, 'scripts', 'build_report.py'), 'print("user edit")\n')
    fixture.writeBundled('1.2.0', 'v2')
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'preserved')
    assert.equal(result.reason, 'modified')
    assert.match(readFileSync(join(fixture.installedDir, 'scripts', 'build_report.py'), 'utf8'), /user edit/)
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 1\.1\.5/)
    assert.equal(readSkillState(fixture.dataDir).installedVersion, '1.1.5')
    assert.equal(existsSync(join(fixture.skillsDir, '.backup')), false)
    assert.match(logger.warnings(), /modified since it was installed/u)
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill keeps untracked legacy copies instead of overwriting them', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    fixture.writeBundled('1.2.0', 'v2')
    rmSync(fixture.statePath, { force: true })
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'preserved')
    assert.equal(result.reason, 'untracked')
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 1\.1\.5/)
    assert.match(logger.warnings(), /no recorded content hash/u)
    // An installed copy without a version field is also user-managed.
    writeFileSync(join(fixture.installedDir, 'SKILL.md'), '# no frontmatter version\n')
    const unversioned = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(unversioned.status, 'preserved')
    assert.match(logger.warnings(), /no version in its SKILL\.md frontmatter/u)
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill never downgrades an installed newer copy', () => {
  const fixture = makeSkillFixture({ bundledVersion: '2.0.0' })
  const logger = recordingLogger()
  try {
    const installed = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(installed.status, 'installed')
    fixture.writeBundled('1.1.5', 'old')
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'newer')
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 2\.0\.0/)
  } finally {
    fixture.cleanup()
  }
})

test('skillSync "keep" leaves an outdated copy untouched', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    fixture.writeBundled('1.2.0', 'v2')
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, skillSync: 'keep', logger })
    assert.equal(result.status, 'skipped')
    assert.equal(result.reason, 'config-keep')
    assert.equal(result.mode, 'keep')
    assert.match(readFileSync(join(fixture.installedDir, 'SKILL.md'), 'utf8'), /version: 1\.1\.5/)
  } finally {
    fixture.cleanup()
  }
})

test('registerSkill false disables the sync and an invalid mode falls back to update', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    const disabled = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, registerSkill: false, logger })
    assert.equal(disabled.status, 'disabled')
    assert.equal(existsSync(fixture.installedDir), false)
    const installed = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, skillSync: 'bogus', logger })
    assert.equal(installed.status, 'installed')
    assert.equal(installed.mode, 'update')
    assert.match(logger.warnings(), /unknown skillSync value/u)
  } finally {
    fixture.cleanup()
  }
})

test('describeSkill reports bundled/installed versions and tracking', () => {
  const fixture = makeSkillFixture()
  try {
    const before = describeSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir })
    assert.equal(before.installed, true)
    assert.equal(before.version, '1.1.5')
    assert.equal(before.installedPresent, false)
    assert.equal(before.installedVersion, '')
    assert.equal(before.tracked, false)
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir })
    const after = describeSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, skillSync: 'keep' })
    assert.equal(after.installedPresent, true)
    assert.equal(after.installedVersion, '1.1.5')
    assert.equal(after.tracked, true)
    assert.equal(after.trackedVersion, '1.1.5')
    assert.equal(after.syncMode, 'keep')
    assert.equal(after.statePath, fixture.statePath)
    // Every value must survive a JSON round-trip (no undefined properties).
    assert.deepStrictEqual(JSON.parse(JSON.stringify(after)), after)
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill keeps backup directory names path-safe', () => {
  const fixture = makeSkillFixture({ bundledVersion: '../1.1.5' })
  const logger = recordingLogger()
  try {
    syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    fixture.writeBundled('1.2.0', 'v2')
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'updated')
    assert.equal(dirname(result.backupDir), join(fixture.skillsDir, '.backup'))
    assert.equal(readdirSync(join(fixture.skillsDir, '.backup')).length, 1)
    assert.match(basename(result.backupDir), /^paper-deepread-html-[A-Za-z0-9._-]+$/u)
    assert.doesNotMatch(basename(result.backupDir), /\//u)
  } finally {
    fixture.cleanup()
  }
})

test('syncBundledSkill reports a missing bundled skill as failed', () => {
  const fixture = makeSkillFixture()
  const logger = recordingLogger()
  try {
    rmSync(join(fixture.packageDir, 'skills'), { recursive: true, force: true })
    const result = syncBundledSkill({ packageDir: fixture.packageDir, skillsDir: fixture.skillsDir, dataDir: fixture.dataDir, logger })
    assert.equal(result.status, 'failed')
    assert.match(result.error, /missing from the package/u)
    assert.match(logger.warnings(), /missing from the package/u)
  } finally {
    fixture.cleanup()
  }
})
