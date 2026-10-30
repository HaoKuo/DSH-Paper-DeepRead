# Changelog

All notable changes to DSH-Paper-DeepRead are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
