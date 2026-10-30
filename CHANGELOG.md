# Changelog

All notable changes to DSH-Paper-DeepRead are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
