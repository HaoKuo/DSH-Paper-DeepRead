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
  │   └─ syncBundledSkill() → $DSH_HOME/skills/... (+ state)     │
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

3. **Skill install + version sync.** `syncBundledSkill()` resolves
   `$DSH_HOME/skills` (or `config.skillsDir`), installs `skills/paper-deepread-html` when
   the target is missing, and otherwise compares the `version:` frontmatter of the bundled
   and installed SKILL.md. The installed tree's content hash (recorded in
   `<dataDir>/skill-state.json` when the plugin installed it) decides whether an outdated
   copy is updated (old copy backed up under `.backup/`) or preserved because the user
   modified it. Copies newer than the bundle are never downgraded; `skillSync: "keep"`
   disables updates. Failures are logged with `ctx.logger.warn` and swallowed.

The catalogue parser, the static route, the skill sync, and the optional site proxy live in
`src/library.js`, `src/route.js`, `src/skill.js`, and `src/site.js`. They import only Node
built-ins, so they can be exercised directly with `node` (the route with a throwaway
`node:http` server, the skill with a throwaway `$DSH_HOME`, the site proxy against a mock
site) without booting dsh.

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


## v1.1.1 — brand wording removal

Content-only release. The packaged `library/` snapshot, the library template, and the
bundled skill documentation no longer contain the old brand name; the rendered footer is
`<libTitle> + version` and the browser title is `TITLE + version`. Serving, upload, report
management, and the API are unchanged from v1.1.0.

## v1.1.0 — managed library, upload inbox, report management

```text
dataDir ($DSH_HOME/paper-deepread)
├── library/      seeded once from <package>/library, then user-owned
├── uploads/      <uploadId>.pdf raw uploads
├── work/<id>/    paper_ingest.py output + agent-authored content.html/meta.json
├── state.json    upload records (status uploaded|ingested|reported|failed)
└── .seed.json    one-time seed marker (never overwrites an existing library)
```

Host modules:

- `src/store.js` — resolves `dataDir` (`config.dataDir` → else `$DSH_HOME/paper-deepread`),
  seeds the packaged library once, serializes `state.json` writes (temp file + rename),
  and exposes `safeChildDir()` for report path validation. Legacy `config.libraryDir`
  makes that directory the managed root and skips seeding (`managed: false`).
- `src/uploads.js` — filename sanitizing, raw-body streaming with a hard 80 MB limit,
  `%PDF-` magic sniffing, and `uploads/<id>.pdf` storage.
- `src/reports.js` — scans direct child directories of the managed root for report HTML
  + `library.json` metadata + `RAW-*.pdf`; hide/unhide merges `{"hidden": bool}` into
  `library.json`; delete removes exactly one validated child directory; rebuild runs
  `build_library.py` (thumbs when a PyMuPDF interpreter is already prepared, otherwise a
  plain `python3 --no-thumbs` fallback).
- `src/python.js` — resolves the skill interpreter through `setup_env.sh` (cached venv
  or PyMuPDF-capable python3; first run may install PyMuPDF), runs child processes with
  timeouts/cancellation and captured output, and exports pure argv builders.
- `src/manager.js` — wires the store, reports, and Python together; dispatches the
  `/paper-deepread/api/*` routes; and defines the three model tools:
  `paper_deepread` (catalogue/search), `paper_deepread_uploads`
  (`list`/`env`/`ingest`/`delete`), `paper_deepread_reports`
  (`list`/`build`/`rebuild`/`delete`/`hide`).

The plugin never calls a model: the upload tab hands the user a prefilled instruction,
and an agent runs ingest (deterministic) then follows the skill to author report sources
and call `build`. The one-click index rebuild is deterministic and model-free.

### API (same `/paper-deepread` prefix route)

| Method | Path | Meaning |
| --- | --- | --- |
| GET | `/paper-deepread/api/state` | library root/title/version, stats, uploads, reports, Python status, `skillVersion` / `installedSkillVersion`, `site {configured,url}`, limits |
| POST | `/paper-deepread/api/upload` | raw PDF body, `x-filename` (percent-encoded), `content-type: application/pdf` → `201`/`413`/`415`/`400` |
| POST | `/paper-deepread/api/uploads/delete` | `{id}` — record, raw PDF, and work directory |
| POST | `/paper-deepread/api/reports/rebuild` | rebuild `index.html`/`index.md`; returns stats + log tail |
| POST | `/paper-deepread/api/reports/delete` | `{dir}` — exactly one validated child directory |
| POST | `/paper-deepread/api/reports/visibility` | `{dir, hidden}` — merges `library.json` |
| GET | `/paper-deepread/api/site/health` | v1.2.0: proxies `<siteUrl>/api/health` (5 s timeout, 5 s cache); `{configured:false}` when `siteUrl` is unset |
| POST | `/paper-deepread/api/site/upload` | v1.2.0: raw PDF body forwarded to `<siteUrl>/api/upload` with `X-Filename`/`Content-Type`/optional `X-KB-Upload-Token` (120 s timeout); returns the site JSON verbatim |

Errors are `{"ok": false, "error": {"code", "message"}}`; non-GET on state/upload and
unknown routes return `405`/`404`; management bodies must be `application/json`.

### Browser half

`lib/client.js` keeps the same sidebar/main-slot registration and adds a three-tab page:
文献库 (the iframe), 上传 (optional 自动精读 card, drop zone, XHR progress, queue, copyable
agent instruction), 报告管理 (summary, report table, hide/delete, one-click rebuild + log
tail). The panel header/tab design is unchanged from v1.1.4.

## v1.2.0 — skill version sync + standalone site integration

### Skill sync state machine

```text
activation
  │  syncBundledSkill(packageDir, skillsDir, dataDir, skillSync)
  ├─ installed missing ─────────────────────► copy bundle + write skill-state.json
  ├─ skillSync == "keep" ───────────────────► skip (log)
  ├─ installed == bundled ──────────────────► skip
  ├─ installed  > bundled ──────────────────► skip (never downgrade)
  ├─ installed  < bundled
  │    ├─ no state record ──────────────────► keep + warn (untracked)
  │    ├─ hash(tree) != state.contentHash ──► keep + warn (user modified)
  │    └─ hash matches ─────────────────────► backup old copy
  │                                            → copy bundle → update hash
  └─ errors ────────────────────────────────► log + continue activation
```

`<dataDir>/skill-state.json` shape:

```json
{
  "version": 1,
  "skill": "paper-deepread-html",
  "installedVersion": "1.1.5",
  "contentHash": "sha256:…",
  "source": "package",
  "packageVersion": "1.2.0",
  "installedAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

Backups go to `<skillsDir>/.backup/paper-deepread-html-<oldVersion>-<UTC>/`
(`UTC` = `20261030T211500Z`, no colons so it is path-safe).

### Standalone-site proxy

```text
browser (Harness origin)                plugin host                     site :8080
  GET  /paper-deepread/api/site/health ─► src/site.js health()  ───────► GET /api/health
                                          cache 5 s, timeout 5 s
  POST /paper-deepread/api/site/upload ─► src/site.js upload()  ───────► POST /api/upload
                                          readRequestBody(cap)
                                          forward X-Filename, Content-Type,
                                          X-KB-Upload-Token
  ◄────────────── status/content-type/body verbatim ────────────────────┘
```

The proxy exists because the site API is same-origin-only; the browser panel lives on the
Harness origin. `siteUrl` is normalized once (absolute `http(s)`, path prefix kept,
trailing slash removed); an invalid value disables the feature with a warning. The site
upload token is never stored in the plugin config — it is per-request browser state in
`sessionStorage` and is only forwarded.

