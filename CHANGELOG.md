# Changelog

All notable changes to DSH-Paper-DeepRead are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
