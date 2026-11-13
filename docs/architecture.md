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
  │   ├─ mobile-access runtime (src/access.js)                    │
  │   │    └─ src/lan.js (LAN fallback) / src/tunnel.js (opt-in)  │
  │   └─ syncBundledSkill() → $DSH_HOME/skills/... (+ state)     │
  └───────────────┬──────────────────────────────────────────────┘
                  │ same-origin HTTP
  ┌───────────────▼──────────────────────────────────────────────┐
  │  Browser fiber (lib/client.js) — thin wrapper since v1.7.0    │
  │   ├─ slots.register('main', key:'paper-deepread')             │
  │   └─ slots.register('sidebar.panellist', id:'paper-deepread') │
  │         └─ page → full-height <iframe>                         │
  │              src="/paper-deepread/index.html"                  │
  │              └─ header 上传 / 管理 ──► new tab: manage.html    │
  │                   (upload / reports / 手机访问)                 │
  │                   → /paper-deepread/api/* (same origin)         │
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

Since v1.7.0 the browser half is a **thin client**. `apply(ctx)`:

- injects a `<style data-plugin-css="dsh-paper-deepread">` element and removes it in the
  effect disposer,
- registers the main page in two steps, mirroring the built-in conversation panel:
  1. a keyed `main` entry (`key: 'paper-deepread'`) whose children declare
     `paper-deepread.page` as a single root slot,
  2. the `paper-deepread.page` component itself,
- registers `sidebar.panellist` with `id: 'paper-deepread'`, `order: -9`, and the label
  `Paper Deepread`. The sidebar's panel id matches the `main` key, so selecting the icon
  switches the main panel to the plugin page and selecting another panel leaves it intact.

The page is a flex column containing exactly one element: a full-height, same-origin
iframe pointing at `/paper-deepread/index.html`. It renders no tab row, toolbar or modal.
Upload, report management and 手机访问 are UI *inside that page* — i.e. inside the bundled
`library/manage.html` console, which the library header opens in a new browser tab. No
sandbox attribute is needed because the route is served by the host half on the same
origin.

## Payload directories

- `library/` — the 文献精读库 static site: `index.html`, `index.md`, `README.md`,
  `manage.html` (the self-contained management console: upload, report management and
  手机访问), and one directory per paper with the interactive report HTML, the report PDF,
  and the untouched `RAW-*.pdf`. It is shipped as-is; the plugin never writes into it.
- `skills/paper-deepread-html/` — the deep-read skill. It is shipped as-is and only ever
  copied out to the Harness skills directory.

## Disposal and failure behaviour

Every registration goes through the plugin `ctx`, so Cordis disposes the route, the tool,
and the browser slots with the plugin fiber. A malformed library, an unavailable
`webServer`, or a failed skill copy is logged and skipped; the plugin still loads.

Since v1.6.0 a second `ctx.effect` calls the manager's `dispose()`, which kills the optional
Cloudflare tunnel child (SIGTERM, then SIGKILL after ~3 s) and closes the lazy LAN fallback
server, so no child or listening socket outlives the plugin fiber.

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
| GET | `/paper-deepread/api/access` | v1.6.0: phone-access payload — `target`, `local`, `lan[]` (labels, URLs, `reachable`, QR SVGs), `tunnel` state, `hints`; `?refresh=1` bypasses the 8 s probe cache |
| POST | `/paper-deepread/api/access/tunnel` | v1.6.0: `{action:"start"|"stop"|"refresh"}` → fresh payload; `400 BAD_REQUEST`, `503 TUNNEL_UNAVAILABLE`, `405` for wrong methods |

Errors are `{"ok": false, "error": {"code", "message"}}`; non-GET on state/upload and
unknown routes return `405`/`404`; management bodies must be `application/json`.

### Browser half

`lib/client.js` keeps the same sidebar/main-slot registration and, from v1.1.0 to v1.6.2,
carried a three-tab page: 文献库 (the iframe), 上传 (optional 自动精读 card, drop zone, XHR
progress, queue, copyable agent instruction) and 报告管理 (summary, report table,
hide/delete, one-click rebuild + log tail). v1.7.0 removed that chrome again — the browser
half is a thin iframe wrapper and the same management functionality is exercised from the
site's own `manage.html` console.

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

## v1.6.0 — 手机访问 (mobile access)

### Modules

| Module | Role |
| --- | --- |
| `src/qr.js` | Pure QR Code Model 2 encoder: byte mode/UTF-8, EC L/M/Q/H, versions 1–40, smallest fitting version, automatic mask selection with ISO penalty rules N1–N4; renders one `<svg>` with a single compact `<path>` for direct injection. No I/O, no dependencies. |
| `src/access.js` | Access runtime: target resolution (`siteUrl` site → lazy LAN fallback server → DSH Web page), non-internal IPv4 discovery ranked `en0` first (virtual and link-local interfaces skipped) plus one Bonjour candidate, 8 s reachability probe cache with `?refresh=1` bypass, per-candidate QR SVGs, concurrency-deduped snapshots, serialized tunnel actions, and `dispose()`. |
| `src/lan.js` | Lazy read-only LAN fallback server for the managed library. Reuses `createLibraryHandler` from `src/route.js` (the request URL is rewritten to `/paper-deepread<pathname>`), binds `0.0.0.0` on `lanPort` or an ephemeral port, and persists the bound port in `<dataDir>/lan-server.json` so the LAN URL survives reactivation. |
| `src/tunnel.js` | Cloudflare quick-tunnel child manager (started automatically when the 手机访问 tab opens since v1.6.2; **关闭外网访问** stops it): `findCloudflared` (config `cloudflaredPath` → `CLOUDFLARED_BIN` → `/opt/homebrew/bin` → `/usr/local/bin` → `PATH`), `cloudflared tunnel --url <target> --no-autoupdate`, `config.cloudflaredProxy` forwarded to the child as `HTTPS_PROXY`/`HTTP_PROXY`, banner-gated URL parsing, `off|starting|running|error` state with a persisted `tunnel.json` snapshot, 25 s start timeout, and SIGTERM→SIGKILL disposal that never leaves an orphan child. |

### Data flow

The 手机访问 tab (inside `library/manage.html`, in the browser) is a pure renderer; all
resolution happens on the host.

```text
手机访问 tab (library/manage.html)        host (src/access.js)
  │  GET /paper-deepread/api/access          │
  ├─────────────────────────────────────────►│ 1. target resolution
  │                                          │    siteUrl site → lan.js ensure()
  │                                          │    → DSH Web page fallback + hint
  │                                          │ 2. LAN/Bonjour candidates
  │                                          │    (IPv4 non-internal, en0 first)
  │                                          │ 3. probe each candidate URL (8 s cache)
  │                                          │ 4. render a QR SVG for every URL
  │◄────────── {target, local, lan[], ───────┤    (src/qr.js, per-candidate failures
  │             tunnel, hints}                │     are tolerated)
  │                                          │
  │ blocks 外网（临时） / 局域网 · <first IP>│
  │ URL + 复制链接 + inject the host-rendered │
  │ `qrSvg` (guarded: only strings that       │
  │ start with `<svg`)                        │
  │                                          │
  │ phone scans QR ──► resolved target        │
  │                                          │
  │ POST /paper-deepread/api/access/tunnel    │
  ├──────── {action:start|stop|refresh} ────►│ src/tunnel.js child process
  │◄──────── fresh payload (new URL) ────────┤ → https://<words>.trycloudflare.com
```

Since v1.6.2 the UI renders no candidate tab row and no loopback/Bonjour entries: it
shows the external tunnel block and the first LAN IPv4 block, and the tab starts the
tunnel automatically on first activation (one auto-start per page load; failures stay
visible and are retried through **连不上？刷新链接**).

`dsh web` listens on loopback only, so the phone target is deliberately never the DSH Web
listener: it is the standalone site (`siteUrl`) or the plugin's own read-only LAN server,
optionally fronted by the temporary public tunnel. The `target.kind === 'web'` fallback
exists only so the UI can explain that limitation.

### Tunnel URL discovery and failure handling

The child is spawned as `cloudflared tunnel --url <target> --no-autoupdate` with
`stdio: ['ignore', 'pipe', 'pipe']`. When `config.cloudflaredProxy` is a non-empty string
after trimming, the child environment is `{...process.env, HTTPS_PROXY: proxy,
HTTP_PROXY: proxy}`; otherwise it inherits the plugin environment. That is the escape hatch
for macOS, where cloudflared is a Go program that ignores the system proxy: behind a
ClashX-style proxy quick-tunnel creation fails with a `failed to request quick Tunnel` error
(`context deadline exceeded` / `connection reset`). A SOCKS5 proxy such as
`socks5://127.0.0.1:7890` works there; routing the quick-tunnel API through a plain HTTP
proxy is flakier.

URL discovery and failure handling are deliberately conservative:

- a URL is accepted only after cloudflared prints its `quick Tunnel has been created`
  banner (the scan starts at the banner; the whole output is a fallback for versions whose
  banner wording differs);
- only multi-word `https://<words>.trycloudflare.com` hostnames match, and the
  `api.`/`www.`/`update.`/`pkg.` infrastructure hosts never do — the
  `Post "https://api.trycloudflare.com/tunnel"` endpoint inside error output can never
  become the tunnel URL;
- output containing `failed to request quick Tunnel` sets `status:'error'` before any URL
  scan: the child is terminated, the pending start resolves immediately, `url` is `null`,
  and `error` carries cloudflared's last failure line with the `<ISO timestamp> <LEVEL>`
  prefix stripped and capped at 800 characters. A failure can never look like a running
  tunnel.

The 手机访问 tab shows this as a `连接失败` status chip with the `tunnel.error` message (no QR
code), and **连不上？刷新链接** posts `refresh` (stop + start) to retry.

### State and lifecycle

```text
dataDir additions (v1.6.0)
├── lan-server.json   last bound port of the read-only LAN fallback server
└── tunnel.json       last Cloudflare tunnel state snapshot (available/status/url)
```

Both files are disposable: losing them only means the next activation picks a new ephemeral
port or shows the tunnel as `off`. The LAN server starts only when a snapshot is requested
and no `siteUrl` is configured; the tunnel child starts when the 手机访问 tab auto-starts it
(once per page load) or after an explicit `start` / `refresh` action. `createManager` returns
`dispose()` and the plugin registers it through `ctx.effect`, so both are released with the
plugin fiber.

### Payload contract

Every field is always present: missing values are `null`, never `undefined`, and there are no
`NaN`s, so the payload survives a JSON round-trip losslessly (the same convention as the
model tools). `qrSvg` is SVG markup, not a data URL. Errors keep the standard shape
`{"ok":false,"error":{"code","message"}}` (`BAD_REQUEST` 400, `TUNNEL_UNAVAILABLE` 503,
`METHOD_NOT_ALLOWED` 405, `NOT_FOUND` 404).

## v1.7.0 — thin client

The browser half no longer renders plugin UI of its own. `lib/client.js` registers the
sidebar entry and one main-panel page, and that page is a full-height, same-origin iframe of
the bundled site at `/paper-deepread/index.html`. There is no plugin tab row, no toolbar /
reload action, no upload or report-management panel and no mobile-access modal.

Everything that used to live in those panels is UI inside the bundled site itself, reached
from the library page header:

```text
library/index.html  ── header 上传 / 管理 ──►  library/manage.html
                                                ├─ 上传       upload (plugin managed
                                                │              inbox or site queue)
                                                ├─ 报告管理   hide / delete / rebuild
                                                └─ 手机访问   tunnel + LAN + QR
```

The same `manage.html` is served from two origins and uses only relative API URLs:

- through the plugin: `/paper-deepread/manage.html` → `/paper-deepread/api/*` (plugin host —
  managed inbox, reports, mobile-access payload), so its 手机访问 tab works;
- on the standalone site: `/manage.html` → `/api/*` (`deploy/serve.py`), where `api/access`
  does not exist, so the 手机访问 tab renders a note explaining that the feature requires
  the DSH panel.

The host half, API routes and payloads, config keys and the bundled skill are unchanged by
this release; only the browser half and the bundled `library/manage.html` console changed.
