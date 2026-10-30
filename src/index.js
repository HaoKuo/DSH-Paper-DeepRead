/**
 * DSH-Paper-DeepRead — host half.
 *
 * Serves the bundled 文献精读库 (Paper Deepread library) static site over the
 * Harness Web server, exposes one model tool that lists/searches the same
 * catalogue, and installs the bundled `paper-deepread-html` skill on first
 * activation. Every registration is made through the plugin `ctx`, so Cordis
 * disposes routes and tools with the plugin fiber; a missing optional feature
 * (for example no bound Web server) degrades gracefully instead of failing
 * activation.
 *
 * The browser half lives in `lib/client.js` and is registered by the
 * `dsh.client` manifest in `package.json`.
 *
 * @module dsh-paper-deepread
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  MAX_SEARCH_HITS,
  findPaper,
  loadLibrary,
  publicLibrary,
  publicPaper,
  searchPapers,
} from './library.js'
import { ROUTE_PREFIX, createLibraryHandler, libraryWebUrl } from './route.js'
import { installBundledSkill } from './skill.js'

/** Stable plugin name. */
export const name = 'dsh-paper-deepread'

/** Services required before activation; both are provided by the Web profile. */
export const inject = ['webServer', 'tools']

/** Package root of the installed plugin (inside the profile's node_modules). */
const PACKAGE_DIR = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/** Bundled library directory used when `config.libraryDir` is absent. */
const DEFAULT_LIBRARY_DIR = join(PACKAGE_DIR, 'library')

/**
 * Register the model-facing `paper_deepread` tool.
 * @param {object} ctx Plugin context.
 * @param {object} library Loaded library catalogue.
 */
function registerTool(ctx, library) {
  ctx.tools.register(defineTool({
    name: 'paper_deepread',
    description: [
      'Look up a paper in the bundled Paper Deepread (文献精读库) library that ships with the DSH-Paper-DeepRead plugin.',
      'The library holds deep-read papers: each one has an interactive HTML reading report, a figure-cropped report PDF, and the untouched source PDF.',
      'Call without arguments to list every paper with its local report path and Web URL.',
      'Pass `query` to run a case-insensitive substring search over English/Chinese titles, journals, tags, summaries, and full text (up to 20 ranked hits with snippets).',
      'Pass `id` (a paper id from this tool, its directory name, or its 1-based index) to fetch one paper.',
      'Use the returned absolute `reportHtmlPath` with the local file tools to read a report, `rawPdfPath` for the source paper, or `webUrl` to open the report in the DSH Web UI (/paper-deepread/ is served by this plugin).',
      'Cite the paper title and journal when answering.',
    ].join(' '),
    parameters: {
      query: {
        type: 'string',
        description: 'Optional case-insensitive substring to search titles, Chinese titles, journals, tags, summaries, or full text.',
      },
      id: {
        type: 'string',
        description: 'Optional paper id, report directory name, or 1-based index returned by a previous call.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const webBaseUrl = libraryWebUrl(ctx)
      const meta = publicLibrary(library, webBaseUrl)
      try {
        if (typeof args.id === 'string' && args.id.trim()) {
          const paper = findPaper(library, args.id)
          if (!paper) {
            return {
              ok: false,
              mode: 'paper',
              error: `No paper matches id "${args.id.trim()}".`,
              library: meta,
              availableIds: library.papers.map(entry => entry.id),
            }
          }
          return { ok: true, mode: 'paper', library: meta, paper: publicPaper(paper) }
        }
        if (typeof args.query === 'string' && args.query.trim()) {
          const results = searchPapers(library, args.query, MAX_SEARCH_HITS)
          return {
            ok: true,
            mode: 'search',
            library: meta,
            query: args.query.trim(),
            total: results.length,
            results,
            ...(results.length === 0
              ? { hint: 'No substring match. Try a shorter English or Chinese keyword, or call without arguments to list all papers.' }
              : {}),
          }
        }
        return {
          ok: true,
          mode: 'list',
          library: meta,
          papers: library.papers.map(paper => publicPaper(paper)),
        }
      } catch (error) {
        return { ok: false, mode: 'error', library: meta, error: String(error?.message || error) }
      }
    },
  }))
}

/**
 * Plugin activation.
 * @param {object} ctx Cordis plugin context.
 * @param {{libraryDir?: string, skillsDir?: string, registerSkill?: boolean}} [config]
 *   Optional row config: serve another static-site directory, install the skill
 *   elsewhere, or disable skill self-registration.
 */
export function apply(ctx, config = {}) {
  const libraryDir = typeof config.libraryDir === 'string' && config.libraryDir.trim()
    ? resolve(config.libraryDir)
    : DEFAULT_LIBRARY_DIR
  const logger = ctx.logger

  // Load the catalogue once; a missing or malformed library must not take the
  // whole plugin down, because the route and skill are still useful.
  let library = null
  try {
    library = loadLibrary(libraryDir)
  } catch (error) {
    logger?.warn?.(`DSH-Paper-DeepRead: cannot read the bundled library at ${libraryDir}: ${String(error?.message || error)}`)
  }

  // Serve the bundled static site under /paper-deepread.
  try {
    const webServer = ctx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      logger?.warn?.('DSH-Paper-DeepRead: webServer is unavailable; the /paper-deepread route was not registered')
    } else {
      ctx.effect(() => webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createLibraryHandler(libraryDir, logger),
      }), 'DSH-Paper-DeepRead: /paper-deepread route')
    }
  } catch (error) {
    logger?.warn?.(`DSH-Paper-DeepRead: could not register the /paper-deepread route: ${String(error?.message || error)}`)
  }

  // Expose the catalogue to the model.
  if (library) {
    try {
      registerTool(ctx, library)
    } catch (error) {
      logger?.warn?.(`DSH-Paper-DeepRead: could not register the paper_deepread tool: ${String(error?.message || error)}`)
    }
  }

  // Install the bundled skill only when the user has no copy yet.
  installBundledSkill({
    packageDir: PACKAGE_DIR,
    dshHome: process.env.DSH_HOME,
    skillsDir: typeof config.skillsDir === 'string' && config.skillsDir.trim() ? config.skillsDir : undefined,
    registerSkill: config.registerSkill !== false,
    logger,
  })
}
