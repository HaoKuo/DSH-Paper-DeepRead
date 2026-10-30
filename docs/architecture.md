# Architecture

DSH-Paper-DeepRead is one dsh bundle package with two runtime halves and two read-only
payload directories. Nothing is generated at install time; the tarball already contains
the library, the skill, and both JavaScript halves.

```text
                    dsh Web profile
  ┌──────────────────────────────────────────────────────────────┐
  │  Host fiber (src/index.js)                                   │
  │   ├─ webServer.register({kind:'prefix', path:'/paper-deepread'}) │
  │   ├─ tools.register(defineTool('paper_deepread'))             │
  │   └─ installBundledSkill() → $DSH_HOME/skills/... (once)      │
  └───────────────┬──────────────────────────────────────────────┘
                  │ same-origin HTTP
  ┌───────────────▼──────────────────────────────────────────────┐
  │  Browser fiber (lib/client.js)                                │
  │   ├─ slots.register('main', key:'paper-deepread')             │
  │   └─ slots.register('sidebar.panellist', id:'paper-deepread') │
  │         └─ page → <iframe src="/paper-deepread/index.html">   │
  └──────────────────────────────────────────────────────────────┘
```

## Bundle row

`cordis.patch.yml` inserts exactly one Loader row:

```yaml
- insert:
    - id: paper-deepread
      name: dsh-paper-deepread
```

`package.json` declares `dsh.bundle.patch` (the row above) and `dsh.client`
(`platform: web` plus the client packages whose module table the browser half needs).
Installing the tarball into a profile makes the package a profile dependency; dsh's
plugin manager adds it to `dsh.profile.bundles` and applies the patch layer, exactly like
the reference plugins it was modelled on.

## Host half — `src/index.js`

Exports `name`, `inject = ['webServer', 'tools']`, and `apply(ctx, config)`.

1. **Static route.** `ctx.effect(() => ctx.webServer.register({ kind: 'prefix',
   path: '/paper-deepread', handler }), ...)` registers a prefix route. The handler:
   - answers `GET`/`HEAD` only (`405` otherwise),
   - parses `new URL(req.url).pathname` and `decodeURIComponent`s it, because report
     directories and file names contain spaces, `·`, and Chinese characters,
   - maps `/paper-deepread` and `/paper-deepread/` to `library/index.html`,
   - resolves the target against `config.libraryDir` (default `library/` next to
     `package.json`) and rejects anything that escapes that directory after resolution,
   - returns `Content-Type`, `Content-Length`, `Cache-Control`, and
     `X-Content-Type-Options: nosniff`; missing files are `404`,
   - streams the file with `fs.createReadStream`, so the 56 MB library is never buffered.

2. **Model tool.** `ctx.tools.register(defineTool({ name: 'paper_deepread', ... }))`.
   The tool loads `library/index.html` once at activation, extracts the
   `<script id="library-data" type="application/json">` block that
   `scripts/build_library.py` embeds, and answers three shapes: list, substring search
   (ranked, max 20), and single-paper lookup. Absolute local paths come from the loaded
   catalogue; the Web URL is built from `ctx.webServer.getOrigin()` when the listener is
   already bound and falls back to a relative URL otherwise.

3. **Skill self-registration.** `installBundledSkill()` resolves
   `$DSH_HOME/skills` (or `config.skillsDir`) and copies `skills/paper-deepread-html`
   only when the target directory does not exist. The user's own copy therefore wins.
   Failures are logged with `ctx.logger.warn` and swallowed.

The catalogue parser, the static route, and the skill installer live in
`src/library.js`, `src/route.js`, and `src/skill.js`. They import only Node built-ins, so
they can be exercised directly with `node` (the route with a throwaway `node:http`
server, the skill with a throwaway `$DSH_HOME`) without booting dsh.

## Browser half — `lib/client.js`

A plain script (no build step) registered through `window.__ModuleLoader__.load({ id:
'dsh-paper-deepread', factory })`. React comes from the browser module table:
`const React = require('react')`.

`apply(ctx)`:

- injects a `<style data-plugin-css="dsh-paper-deepread">` element and removes it in the
  effect disposer,
- registers the main page in two steps, mirroring the built-in conversation panel:
  1. a keyed `main` entry (`key: 'paper-deepread'`) whose children declare
     `paper-deepread.page` as a single root slot,
  2. the `paper-deepread.page` component itself,
- registers `sidebar.panellist` with `id: 'paper-deepread'`, `order: -9`, and the label
  `Paper Deepread`. The sidebar's panel id matches the `main` key, so selecting the icon
  switches the main panel to the plugin page and selecting another panel leaves it intact.

The page is a flex column: a compact toolbar (title 文献精读库 / Paper Deepread, an
*open in new tab* link, and a reload button that re-keys the iframe) above a flexing
same-origin iframe pointing at `/paper-deepread/index.html`. No sandbox attribute is
needed because the route is served by the host half on the same origin.

## Payload directories

- `library/` — the 文献精读库 static site: `index.html`, `index.md`, `README.md`, and one
  directory per paper with the interactive report HTML, the report PDF, and the untouched
  `RAW-*.pdf`. It is shipped as-is; the plugin never writes into it.
- `skills/paper-deepread-html/` — the deep-read skill. It is shipped as-is and only ever
  copied out to the Harness skills directory.

## Disposal and failure behaviour

Every registration goes through the plugin `ctx`, so Cordis disposes the route, the tool,
and the browser slots with the plugin fiber. A malformed library, an unavailable
`webServer`, or a failed skill copy is logged and skipped; the plugin still loads.
