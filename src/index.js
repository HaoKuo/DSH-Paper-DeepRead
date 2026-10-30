/**
 * DSH-Paper-DeepRead — host half.
 *
 * Serves the managed 文献精读库 (Paper Deepread library) static site over the
 * Harness Web server, exposes the model tools that read/search the catalogue
 * and drive the bundled deep-read skill on uploaded PDFs, manages reports, and
 * installs the bundled `paper-deepread-html` skill on first activation.
 *
 * v1.1.0 adds a persistent managed data directory (`dataDir`):
 *
 *   <dataDir>/library/   seeded once from the package snapshot, then user-owned
 *   <dataDir>/uploads/   uploaded PDFs waiting to be deep-read
 *   <dataDir>/work/      ingest output and agent-authored report sources
 *   <dataDir>/state.json the upload inbox
 *
 * The plugin never calls a model itself: upload -> deep-read is agent-driven
 * through `paper_deepread_uploads` / `paper_deepread_reports`.
 *
 * v1.2.0 adds two optional integrations on top of that layout:
 *
 *   - the bundled skill is installed and kept in sync with a hash-tracked,
 *     backup-first policy (`skillSync: update|keep`, `<dataDir>/skill-state.json`);
 *   - with `siteUrl` configured, the panel can hand PDFs to a standalone
 *     Paper Deepread site through a small health/upload proxy (`src/site.js`)
 *     whose background worker runs the same pipeline unattended.
 *
 * Every registration goes through the plugin `ctx`, so Cordis disposes routes
 * and tools with the plugin fiber; a missing optional feature degrades
 * gracefully instead of failing activation.
 *
 * The browser half lives in `lib/client.js` and is registered by the
 * `dsh.client` manifest in `package.json`.
 *
 * @module dsh-paper-deepread
 */

import { dirname, join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fileURLToPath } from 'node:url'
import { createLibraryHandler, ROUTE_PREFIX } from './route.js'
import { createManager } from './manager.js'
import { syncBundledSkill } from './skill.js'
import { resolveDataDir } from './store.js'

/** Stable plugin name. */
export const name = 'dsh-paper-deepread'

/** Services required before activation; both are provided by the Web profile. */
export const inject = ['webServer', 'tools']

/** Package root of the installed plugin (inside the profile's node_modules). */
const PACKAGE_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/**
 * Plugin activation.
 * @param {object} ctx Cordis plugin context.
 * @param {{dataDir?: string, libraryDir?: string, skillsDir?: string,
 *   registerSkill?: boolean, skillSync?: 'update'|'keep', siteUrl?: string,
 *   maxUploadBytes?: number}} [config]
 *   Optional row config: managed data directory (default `$DSH_HOME/paper-deepread`),
 *   an external 文献精读库 root (legacy `libraryDir`, disables seeding), skill
 *   installation/sync overrides, the optional standalone site URL, and the
 *   local upload size limit.
 */
export function apply(ctx, config = {}) {
  const logger = ctx.logger

  // The data directory is resolved before the manager so skill state still
  // works when the managed library cannot be initialized.
  const dataDir = resolveDataDir({ dataDir: config.dataDir })

  // The manager owns the managed library and the upload/report feature set.
  let manager = null
  try {
    manager = createManager({ packageDir: PACKAGE_DIR, config, logger })
  } catch (error) {
    logger?.warn?.(`DSH-Paper-DeepRead: cannot initialize the managed library: ${String(error?.message || error)}`)
  }
  const libraryDir = manager
    ? manager.store.libraryRoot
    : (typeof config.libraryDir === 'string' && config.libraryDir.trim()
        ? resolve(config.libraryDir)
        : join(PACKAGE_DIR, 'library'))

  // Serve the library plus the management API under one prefix route.
  try {
    const webServer = ctx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      logger?.warn?.('DSH-Paper-DeepRead: webServer is unavailable; the /paper-deepread route was not registered')
    } else {
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createLibraryHandler(
          libraryDir,
          logger,
          manager ? (req, res, subPath) => manager.handleApi(req, res, subPath) : undefined,
        ),
      }), 'DSH-Paper-DeepRead: /paper-deepread route')
    }
  } catch (error) {
    logger?.warn?.(`DSH-Paper-DeepRead: could not register the /paper-deepread route: ${String(error?.message || error)}`)
  }

  // Model tools: catalogue/search, upload inbox, report management.
  if (manager) {
    for (const tool of manager.tools(defineTool)) {
      try {
        ctx.tools.register(tool)
      } catch (error) {
        logger?.warn?.(`DSH-Paper-DeepRead: could not register tool ${tool.name ?? '<unknown>'}: ${String(error?.message || error)}`)
      }
    }
  }

  // Install or update the bundled skill according to the version-sync policy.
  try {
    syncBundledSkill({
      packageDir: PACKAGE_DIR,
      dshHome: process.env.DSH_HOME,
      skillsDir: typeof config.skillsDir === 'string' && config.skillsDir.trim() ? config.skillsDir : undefined,
      dataDir,
      skillSync: config.skillSync,
      registerSkill: config.registerSkill !== false,
      logger,
    })
  } catch (error) {
    logger?.warn?.(`DSH-Paper-DeepRead: skill sync failed: ${String(error?.message || error)}`)
  }
}
