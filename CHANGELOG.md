# Changelog

All notable changes to DSH-Paper-DeepRead are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
