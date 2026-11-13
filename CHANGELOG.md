# Changelog

All notable changes to DSH-Paper-DeepRead are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] — 2026-11-13

### Added

- **手机访问 tab in the site management page.** The library page's 管理 console
  (`library/manage.html`, served by the plugin at `/paper-deepread/manage.html`) gains a
  third **手机访问** tab next to 上传 / 报告管理. It shows two blocks — **外网（临时）** (the
  Cloudflare quick tunnel, started automatically when the tab opens, with the status chips
  `连接中…` / `已开启` / `连接失败` / `未开启`, **关闭外网访问** and **连不上？刷新链接**)
  and **局域网 · `<IP>`** (the first non-loopback IPv4 address, with URL, **复制链接** and a
  locally rendered QR code) — plus the security note that the tunnel URL is public and
  unauthenticated. The tab calls `api/access` relatively, so it works through the plugin
  origin; on the standalone site (`:8080`) it shows a note that 手机访问 requires the DSH
  panel.
- `docs/screenshot-access.png` is re-captured for this release (the 手机访问 tab in the
  management console); the README (EN/ZH) references it once.

### Changed

- **Thin client browser half.** `lib/client.js` is now a thin wrapper: selecting Paper
  Deepread in the sidebar shows only the bundled 文献精读库 page as a full-height,
  same-origin iframe. It injects no tabs, toolbar or modal chrome of its own; the sidebar
  entry, main-slot registration and `.pdr`-scoped styles are unchanged.
- **Management UI lives in the bundled site page.** Uploading, report management and
  手机访问 are reached from the library page header (上传 / 管理 → `manage.html`), which is
  served both as `/paper-deepread/manage.html` (plugin API) and `/manage.html` (site API).
  README (EN/ZH), `RELEASE_NOTES.md`, `docs/architecture.md` and `docs/install.md` now
  document the manage-page walkthroughs; the mobile-access section describes the tab.
- Package version bumped to `1.7.0` (`package.json`; `tests/api.test.js` and
  `tests/site.test.js` version assertions). Tarball references in the docs now read
  `dsh-paper-deepread-1.7.0.tgz`.
- **Unchanged host side:** the library route, the management API, the model tools
  (`paper_deepread`, `paper_deepread_uploads`, `paper_deepread_reports`), skill
  install/sync, the mobile-access runtime (`src/qr.js`, `src/access.js`, `src/lan.js`,
  `src/tunnel.js`), both `/paper-deepread/api/access*` routes and their payload, the
  config keys `cloudflaredPath` / `cloudflaredProxy` / `lanPort`, and the bundled skill
  (1.5.1). No data migration is required.

### Removed

- The plugin panel's 文献库 / 上传 / 报告管理 tab row and its 刷新 / 在新标签页打开
  actions, the embedded 上传 panel (local inbox uploader and the 自动精读 card) and 报告管理
  panel, and the 手机访问 modal. Upload and report management now happen in the management
  console or through the agent tools; 手机访问 lives in the console's tab.

### Testing

- `npm run check` (`node --check` on every shipped JavaScript file, including the thin
  `lib/client.js`) and `npm test` (`node --test tests/*.test.js`) pass; the host suites
  (API, skill sync, site proxy, QR, access, LAN, tunnel) are unchanged apart from the
  version assertions.
- Manual browser verification: the Paper Deepread panel renders only the library page; the
  library header's 管理 opens the console with the 上传 / 报告管理 / 手机访问 tabs; through
  the plugin the 手机访问 tab auto-starts the tunnel, shows both blocks with QR codes and
  supports 关闭外网访问 / 连不上？刷新链接; on `:8080` the tab shows the "requires the DSH
  panel" note. `docs/screenshot-access.png` is re-captured from the manage-page tab.

## [1.6.2] — 2026-11-13

### Changed

- **Simplified 手机访问 modal.** The entry moved from the tab bar into a 手机访问 card on the
  报告管理 tab. The modal no longer has a candidate tab row: it shows two blocks — 外网（临时）
  and the first LAN address (loopback and Bonjour entries are not rendered) — each with its
  own URL, copy button and locally rendered QR code, side by side on wide screens.
- **External tunnel on by default.** Opening the modal starts the Cloudflare quick tunnel
  automatically (status chip `连接中…` → `已开启` / `连接失败`); 关闭外网访问 stops it and
  连不上？刷新链接 rebuilds it with a new URL. The security note is unchanged: the tunnel
  URL is public and unauthenticated.
- Browser half only — no host-side, API or data changes.

## [1.6.1] — 2026-11-13

### Changed

- **Single-row panel header (UI polish).** The plugin chrome above the library is now one
  44 px tab row instead of three stacked bars. 刷新, 在新标签页打开 and 手机访问 share the
  right-side action cluster; the separate library toolbar row and the duplicated
  `N 篇 · vX` meta line are gone, and the library version moved into the 文献库 tab's
  tooltip. Library actions only render on the 文献库 tab, so the other tabs keep a clean
  row. No host-side, API or data changes — the browser half is a drop-in replacement.

## [1.6.0] — 2026-11-13

### Added

- **手机访问 (mobile access QR).** A **手机访问** button on the right side of the panel tab
  bar opens a modal with one tab per candidate address: 本机, 局域网 · `<IP>` (one per
  reachable IPv4 address plus a Bonjour `<host>.local` entry) and 外网（临时）. Each tab
  shows a copyable URL and a locally rendered, scannable SVG QR code; **连不上？刷新链接**
  re-probes the addresses. Nothing is probed, bound or spawned until the button is pressed.
- **Mobile-access runtime.** New host modules:
  - `src/access.js` — target resolution (`siteUrl` site → lazy read-only LAN fallback server
    → DSH Web page fallback with a hint), non-internal IPv4 candidates ranked `en0` first
    with virtual/link-local interfaces skipped, one Bonjour candidate, 8 s reachability
    probe cache with `?refresh=1` bypass, per-candidate QR SVGs, concurrency-deduped
    snapshots, and tunnel action serialization.
  - `src/lan.js` — lazy read-only static server for the managed library, reusing
    `createLibraryHandler` from `src/route.js`; binds `0.0.0.0`, prefers `lanPort`, and
    persists the bound port in `<dataDir>/lan-server.json`. GET/HEAD static files only.
  - `src/tunnel.js` — opt-in Cloudflare quick-tunnel child manager: `findCloudflared`
    (config `cloudflaredPath` → `CLOUDFLARED_BIN` → `/opt/homebrew/bin` → `/usr/local/bin`
    → `PATH`), `config.cloudflaredProxy` forwarded to the child as
    `HTTPS_PROXY`/`HTTP_PROXY`, banner-gated URL parsing (only multi-word
    `*.trycloudflare.com` hostnames after `quick Tunnel has been created`),
    `off|starting|running|error` state, 25 s start timeout, `<dataDir>/tunnel.json`
    snapshot, SIGTERM→SIGKILL stop, no orphan child.
  - `src/qr.js` — pure QR Code Model 2 encoder (byte mode/UTF-8, EC L/M/Q/H, versions 1–40,
    automatic version and mask selection with ISO penalty rules N1–N4) plus a compact
    single-`<path>` SVG renderer, so the host hands the browser ready-to-inject markup
    without any external QR service or dependency.
- **HTTP API.** `GET /paper-deepread/api/access` returns `{ok, version, target, local, lan[],
  tunnel, hints}` with `label`/`note`, `reachable` and `qrSvg` per candidate;
  `POST /paper-deepread/api/access/tunnel` accepts `{action: "start"|"stop"|"refresh"}` and
  returns a fresh payload (`400 BAD_REQUEST` for unknown actions, `503 TUNNEL_UNAVAILABLE`
  without `cloudflared`, `405` for wrong methods).
- New optional config keys: `cloudflaredPath` (explicit `cloudflared` binary),
  `cloudflaredProxy` (proxy for the cloudflared child, passed as
  `HTTPS_PROXY`/`HTTP_PROXY`; macOS system-proxy escape hatch, e.g.
  `socks5://127.0.0.1:7890`) and `lanPort` (preferred LAN fallback port). New disposable
  data files `lan-server.json` (remembered port) and `tunnel.json` (last tunnel state
  snapshot).
- `createManager` now exposes `dispose()`; `src/index.js` registers a `ctx.effect` cleanup
  so the tunnel child and the LAN fallback server are released with the plugin fiber.

### Changed

- Package version bumped to `1.6.0` (`package.json`; `tests/api.test.js` version assertion);
  `npm run check` now covers the four new host modules (`src/qr.js`, `src/access.js`,
  `src/lan.js`, `src/tunnel.js`).
- Tunnel discovery hardened for flaky/proxied networks: a URL is accepted only after
  cloudflared's `quick Tunnel has been created` banner and only for multi-word
  `*.trycloudflare.com` hostnames (the API endpoint in an error message never becomes the
  tunnel URL), and a failed quick-tunnel request reports `status:'error'` with cloudflared's
  trimmed message instead of a running tunnel with a dead URL. On macOS, where cloudflared
  (Go) ignores the system proxy, `cloudflaredProxy` is the documented workaround and the
  外网（异常） tab can be retried with 连不上？刷新链接.
- No new npm dependencies and no build step: the host still imports only Node built-ins
  plus the `@deepseek-ai/dsh-tools` peer, and the browser half stays a single plain-JS file.
- No model-tool changes: `paper_deepread`, `paper_deepread_uploads` and
  `paper_deepread_reports` keep their parameters and behaviour. No data migration is
  required; an existing managed data directory, uploads, reports and skill state are reused
  as-is.
- README (EN/ZH) gained a "Mobile access (v1.6.0)" section with
  `docs/screenshot-access.png`, the two new config rows, and updated version matrix and
  tarball references. `RELEASE_NOTES.md` was rewritten for 1.6.0, and
  `docs/architecture.md` / `docs/install.md` document the new modules, routes and
  verification steps.

### Testing

- `tests/qr.test.js` + `tests/fixtures/qr-golden.json`: golden matrices from an independent
  reference implementation covering short ASCII, long trycloudflare-like URLs, Chinese text,
  all EC levels, versions 1/3/5/7 and mask coverage, plus structural assertions (finder
  patterns, size `4*version+17`, quiet zone) and automatic version/mask sanity.
- `tests/access.test.js`: target resolution (site / library / web fallback), interface
  filtering and ranking, Bonjour candidate, probe cache and `?refresh=1` bypass, per-
  candidate QR failure tolerance, snapshot dedupe, tunnel action validation, and both HTTP
  routes end to end. `tests/lan.test.js`: ephemeral start, library `index.html`, read-only
  404/405 behaviour, stop releases the port, port reuse and explicit-port precedence.
  `tests/tunnel.test.js`: URL parsing (banner-gated, multi-word hostnames only), trimmed
  quick-tunnel failure messages and prompt failure resolution (never a running URL), proxy
  forwarding as `HTTPS_PROXY`/`HTTP_PROXY` (and environment inheritance when unset),
  start→running, timeout→error, exit→off, refresh→new URL, SIGTERM/SIGKILL stop, dispose
  idempotence, and binary detection order.
- `npm test` (`node --test tests/*.test.js`) and `npm run check` (`node --check` on every
  shipped file) pass. Manual check: open the panel, click 手机访问, confirm the QR renders
  and the 外网 tab reports `off`/`unavailable`/`running` correctly (see
  `docs/install.md` §9).

## [1.5.2] — 2026-10-31

### Docs only

- README version matrix corrected to the current components (site 1.5.0, library 1.5.0,
  plugin 1.5.2, bundled skill 1.5.1); tarball references bumped. No code changes.

## [1.5.1] — 2026-10-31

### Bundled skill

- `paper-deepread-html` **1.5.1** — TOC/anchor repair:
  - `build_report.py` now assigns `id`s to every `h2`/`h3` that lacks one, so TOC links always
    resolve (previously an agent-authored report without heading ids produced dead TOC entries).
  - The report shell self-heals a server-generated TOC whose anchors no longer resolve.
  - No plugin code or API changes.

## [1.5.0] — 2026-10-30

### Bundled skill

- `paper-deepread-html` **1.5.0** — research-report content pass:
  - Result units carry a `机制 / 为什么` paragraph (inference tagged `[推断]`) and run 400–650 chars,
    so each fused claim+figure block explains numbers → mechanism → boundary instead of only
    restating results.
  - The standalone **批判性评估** section returns for research papers (≤1 screen): what holds up /
    weakest link / alternative explanations and boundaries (3–5 bullets each), on top of the
    evidence table.
  - Library page: short links now 302 to the canonical report URL (fixes TOC anchors resolving to
    the paper directory and returning 404); the service worker serves navigations network-first so
    rebuilt reports replace stale copies (library version 1.5.0).
- No plugin code or API changes.

## [1.3.0] — 2026-10-30

### Bundled skill

- `paper-deepread-html` **1.3.0** — fixes under-reading in research articles:
  - **All main figures and main tables are mandatory** (no 3–8 figure cap for research; every main
    figure gets a card, every main table a table card). Key supplementary figures/tables must be read
    or explicitly referenced; skipped ones need a written reason.
  - **Section-by-section reading for research papers**: every Results subsection gets a `sec-brief`
    plus 2–4 body paragraphs (goal / key evidence and numbers / conclusion and place in the argument
    chain / doubts), quoting its figures, tables and page numbers.
  - New required **reading-coverage checklist** (`<details class="coverage">`) listing every main
    figure/table and key supplementary item with where it was read or why it was skipped.
  - QA checklist, article-type reference and the unattended worker prompt enforce the new rules.
- No plugin code or API changes.

## [1.2.0] — 2026-10-30

### Bundled skill

The bundled skill `paper-deepread-html` is updated to **1.2.0**: library templates now ship citation export (BibTeX/RIS), favorites, build-time related papers, PWA/offline support, a zh/en UI switch and accessibility polish; the report template adds a citation block. Existing installs are updated by the version-sync logic (or kept when modified).

### Added

- **Skill version sync.** `src/skill.js` now reads the skill `version:` from the
  `paper-deepread-html` SKILL.md frontmatter (bundled and installed), records the installed
  tree's content hash in `<dataDir>/skill-state.json`, and applies a conservative update
  policy: install when missing; skip when up to date; never downgrade; update an outdated
  copy only when the tree is identical to the recorded hash, after backing the old copy up
  to `<skillsDir>/.backup/paper-deepread-html-<version>-<UTC>/`; keep the user's copy with a
  warning when it was modified or is untracked. New `skillSync: "update" | "keep"` config
  (default `update`). `/api/state` and the `paper_deepread` tool output now expose
  `skillVersion` (bundled) and `installedSkillVersion`, plus sync/tracking details.
- **Optional standalone-site integration.** New `siteUrl` config wires the plugin panel to a
  running Paper Deepread site (`deploy/serve.py`): `GET /paper-deepread/api/site/health`
  proxies `<siteUrl>/api/health` (5 s timeout, 5 s cache) and
  `POST /paper-deepread/api/site/upload` forwards the raw PDF with `X-Filename`,
  `Content-Type`, and the optional `X-KB-Upload-Token` to `<siteUrl>/api/upload`
  (120 s timeout), returning the site JSON verbatim.
- **「自动精读」 card** in the 上传 tab when `siteUrl` is configured: worker/queue status
  from site health, drag & drop uploader through the proxy with per-file progress,
  duplicate / possible-duplicate feedback reused from the site response, optional upload
  token stored in sessionStorage, and links to `<siteUrl>/manage.html` / the site library.
  With no `siteUrl` the local upload UI and agent handoff stay exactly as in v1.1.6.
- New host module `src/site.js` (stdlib-only site proxy) and `tests/skill.test.js` /
  `tests/site.test.js` covering frontmatter parsing, version compare, hash-tracked
  install/update/backup/modified/untracked/downgrade/keep paths, site URL normalization,
  health caching, proxy header/body forwarding, verbatim duplicate payloads, and the
  unconfigured/unreachable states.
- README (EN/ZH) documents `siteUrl` + `skillSync`, the sync policy table, and a version
  matrix (site 1.4.0 / library 1.4.0 / plugin 1.2.0 / skill 1.2.0).

### Changed

- Package version bumped to `1.2.0`; `npm run check` includes the new host module.
- Skill self-registration became a full install-and-sync step at activation; failures are
  still logged and swallowed so a read-only `$DSH_HOME` never breaks plugin activation.

<details>
<summary>中文</summary>

### 新增

- **技能版本同步。** `src/skill.js` 从 `paper-deepread-html` 的 SKILL.md frontmatter 读取
  内置与已安装副本的 `version:`，把已安装目录的内容 hash 记录到
  `<dataDir>/skill-state.json`，并执行保守的更新策略：缺失则安装；同版本跳过；绝不降级；
  仅当目录内容与记录的 hash 完全一致时才更新旧版本，且先把旧副本备份到
  `<skillsDir>/.backup/paper-deepread-html-<版本>-<UTC>/`；被用户修改或没有记录时保留并
  告警。新增 `skillSync: "update" | "keep"` 配置（默认 `update`）。`/api/state` 与
  `paper_deepread` 工具输出新增 `skillVersion`（内置）与 `installedSkillVersion`，并附带
  同步/追踪信息。
- **可选的独立站点集成。** 新增 `siteUrl` 配置，把插件面板接到运行中的 Paper Deepread
  站点（`deploy/serve.py`）：`GET /paper-deepread/api/site/health` 代理
  `<siteUrl>/api/health`（5 秒超时、5 秒缓存）；
  `POST /paper-deepread/api/site/upload` 把原始 PDF 连同 `X-Filename`、`Content-Type`、
  可选 `X-KB-Upload-Token` 转发到 `<siteUrl>/api/upload`（120 秒超时），并把站点 JSON
  原样返回。
- **「自动精读」卡片**：配置 `siteUrl` 后出现在上传标签页顶部——站点 health 提供
  worker/队列状态；拖放 PDF 经代理上传并显示逐文件进度；重复/可能重复反馈直接复用站点
  返回文案；可选上传令牌只存 sessionStorage；提供 `<siteUrl>/manage.html` 与站点书库
  链接。未配置 `siteUrl` 时上传标签页保持 v1.1.6 的本地上传与 Agent 交接流程。
- 新增宿主模块 `src/site.js`（仅标准库的站点代理）与 `tests/skill.test.js`、
  `tests/site.test.js`：覆盖 frontmatter 解析、版本比较、hash 追踪的安装/更新/备份/
  被修改/未追踪/不降级/keep 各路径，站点 URL 规范化、health 缓存、代理头/body 转发、
  重复上传载荷原样透传，以及未配置/不可达状态。
- 中英文 README 记录 `siteUrl` + `skillSync`、同步策略表与版本矩阵
  （站点 1.4.0 / 书库 1.4.0 / 插件 1.2.0 / 技能 1.2.0）。

### 变更

- 包版本升到 `1.2.0`；`npm run check` 纳入新的宿主模块。
- 技能自注册升级为激活时的完整安装+同步步骤；失败仍只记日志、不影响插件激活。

</details>

## [1.1.6] — 2026-10-30

### Changed (docs/screenshots only)

- README (EN/ZH) no longer embeds the DSH panel screenshot that showed the local
  Harness sidebar (workspace/session titles). The docs now use screenshots of the
  standalone library and management console captured outside the DSH Web UI.
- Removed the unused sidebar/mobile screenshots that contained the same sidebar;
  `docs/` now ships only three sidebar-free images (library, upload tab, report tab).
- No code, API, skill, or behaviour changes.

## [1.1.5] — 2026-10-30

### Changed (bundled skill)

- Skill `paper-deepread-html` now **classifies the paper first**: research article vs
  review / perspective / roadmap vs methods-resource-benchmark, with a dedicated reading
  path, figure focus, methods depth and critical-appraisal framework for each type.
- New mandatory **section briefs**: every major section of the report starts with a
  `<div class="sec-brief">` card — section goal (one sentence), 3–5 evidence-chipped
  points, and a one-sentence takeaway (150–300 characters per section). This is in
  addition to the original figure/table deep-read.
- Default report structures split by type: research papers keep problem → methods →
  evidence chain → critique; reviews get a domain map, taxonomy/class, per-chapter
  briefs, comparison table, evidence coverage, consensus vs controversy, trend/roadmap.
- Read protocol and QA checklist updated to enforce the above; report template gained
  the `.sec-brief` component styles (light/dark/print/mobile).
- Auto worker prompt now asks for the type classification and section briefs, so
  unattended reports follow the same structure.
- No API/tool behaviour changes; library pages untouched.

## [1.1.4] — 2026-10-30

### Changed (UI polish)

- Plugin panel: removed the duplicated header block (icon + 文献精读库 title +
  "Paper Deepread · 上传、精读与报告管理" subtitle). The embedded library page already
  carries its own header; the panel now starts with the 文献库 / 上传 / 报告管理 tab bar,
  and the report count + library version moved to the right side of that bar (文献库 tab
  also shows the count badge).
- Bundled `library/manage.html`: fixed the step-card row on the upload tab — the `<ol>`
  kept the browser's default 40px padding, so the three numbered cards were inset
  relative to the cards below; `padding: 0` aligns them with the panel edge.
- No API/tool/behaviour changes.

## [1.1.3] — 2026-10-30

### Fixed

- Model-tool outputs are now lossless JSON. The live `paper_deepread` tool failed with
  `tool "paper_deepread" returned invalid output: value is not lossless JSON` because
  absent optional fields were emitted as `undefined` properties (`publicPaper` used
  `doi: paper.doi || undefined`, `publicLibrary` used `version/buildDate || undefined`,
  uploads used `path/hint: ... ?? undefined`, reports `rebuild: ... : undefined`).
  Every tool execute result now passes through a recursive `toLosslessJson` sanitizer
  (`src/lossless.js`): undefined/function/symbol/BigInt object properties are omitted,
  array holes become `null`, NaN/Infinity become `null`, cycles become `null`. The three
  tools keep the same schemas and behaviour; only invalid properties disappear.
- Added `tests/lossless.test.js`: recursively rejects undefined/NaN/Infinity and asserts
  `JSON.parse(JSON.stringify(value))` deep-equals every tool payload, using the real
  bundled library (catalogue list/query/id, reports list/errors) plus a synthetic upload
  record for the uploads tool. It fails on v1.1.2 (`papers[1].doi: undefined`,
  `python.hint: undefined`) and passes on v1.1.3.

### Changed

- Content-only patch: no library/skill asset changes, API routes and tool parameters are
  identical to v1.1.2.

## [1.1.2] — 2026-10-30

### Changed (assets-only)

- Bundled library page rebuilt from the patched template for v1.3.0: header now carries
  compact 「上传」「管理」 entries that open the new self-contained management console.
- Added `library/manage.html` — one tolerant page for two backends (site `/api/*` and plugin
  `/paper-deepread/api/*`), with upload inbox + copyable agent handoff instruction and
  report hide/delete/rebuild controls.
- Bundled `library/{index.html,index.md,README.md}` regenerated at v1.3.0 with the reverted
  compact logo and no legacy brand wording.
- Management console validates the admin token before claiming success: the site
  backend gained an ADMIN-only `GET /api/auth` (401 missing/wrong token, 503
  `ADMIN_DISABLED` when the token is unset), and `manage.html` now shows an inline
  "管理令牌无效" error instead of storing a wrong token; a sessionStorage token is
  re-verified and cleared with a hint when it becomes invalid. Graceful fallback for
  older backends via `GET /api/uploads/__verify__.pdf`.
- Plugin API state now mirrors the standalone site's `state` shape (adds `size`,
  `admin`, `publish`, `limits.maxUploadMb`, `version`, `library.updated`) so the shared
  manage page runs unchanged against the plugin. No plugin behaviour change; upload,
  report management, API routes, and model tools are identical to v1.1.1.

## [1.1.1] — 2026-10-30

### Changed

- Removed the legacy brand wording from the bundled 文献精读库 page: the footer now
  shows the library title alone (plus the version chip) and the browser-title suffix is
  gone.
- Applied the same cleanup to the library README, the bundled skill's `SKILL.md`, and the
  packaged `library_template.html`, so rebuilding the index or reinstalling the plugin
  never reintroduces the wording.
- No functional changes: upload, report management, the HTTP API, and the model tools are
  identical to v1.1.0.

## [1.1.0] — 2026-10-30

### Added

- Managed data directory (`dataDir`, default `$DSH_HOME/paper-deepread`) with a one-time
  seed of the packaged library, `uploads/`, `work/<id>/`, and an atomic `state.json`.
  Legacy `libraryDir` still works and becomes the managed root without seeding.
- Paper upload: drag & drop / file picker in the panel, raw-body `POST
  /paper-deepread/api/upload` (80 MB default, `%PDF-` sniff, sanitized filename,
  `413`/`415`/`400` errors), per-file progress, and an upload list with delete.
- Agent handoff: the plugin never calls a model. The upload tab carries a prefilled,
  copyable instruction; agents use the new tools to run the bundled skill.
- Report management: report scan with metadata, open report / raw PDF, hide/unhide via
  `library.json`, delete one report directory, and deterministic one-click index rebuild.
- Model tools `paper_deepread_uploads` (`list`/`ingest`/`env`/`delete`) and
  `paper_deepread_reports` (`list`/`build`/`rebuild`/`delete`/`hide`) driving
  `paper_ingest.py`, `build_report.py`, and `build_library.py`.
- HTTP API under `/paper-deepread/api/*` on the existing single prefix route:
  `state`, `upload`, `uploads/delete`, `reports/rebuild`, `reports/delete`,
  `reports/visibility`.
- Host modules `src/store.js`, `src/uploads.js`, `src/reports.js`, `src/python.js`,
  `src/manager.js`, plus `node:test` suites for upload validation, atomic state, report
  scan/path safety, Python command builders, and the API handler.
- Panel tabs 文献库 | 上传 | 报告管理 with drag & drop, queue/status list, handoff
  prompt, report table, rebuild log, and 390px-friendly layout.

### Changed

- `paper_deepread` now reads the managed library (seeded or `libraryDir`) and reports
  upload/report counts in its `library` metadata.
- The existing `/paper-deepread` static route dispatches `/paper-deepread/api/*` before
  static lookup.

## [1.0.0] — 2026-10-30

### Added

- Host half (`src/index.js`): prefix Web route `GET|HEAD /paper-deepread/*` serving the
  bundled library with percent-decoded paths, correct content types, `Content-Length`,
  and traversal protection.
- Model tool `paper_deepread`: lists the bundled catalogue, substring-searches titles,
  Chinese titles, journals, tags, TL;DRs and full text (max 20 ranked hits with
  snippets), and resolves one paper by id, directory name, or 1-based index.
- Browser half (`lib/client.js`): **Paper Deepread** sidebar panel and a full-height
  main-panel page with title, open-in-new-tab link, and reload button.
- `skills/paper-deepread-html/` bundled and self-registered into `$DSH_HOME/skills` only
  when the target directory does not exist; an existing user skill is never overwritten.
- `library/` bundled: the 文献精读库 static site with four deep-read papers (interactive
  HTML reports, report PDFs, untouched source PDFs).
- Optional row config: `libraryDir`, `skillsDir`, `registerSkill`.
- Bilingual README (English default, Chinese mirror), architecture and install docs,
  MIT license, release notes, and `scripts/pack.sh` producing the installable tarball
  plus `dist/SHA256SUMS`.
