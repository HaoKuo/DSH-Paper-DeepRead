# Install and verify DSH-Paper-DeepRead

## 1. Install from the release tarball

Download `dsh-paper-deepread-1.1.0.tgz` (or use the copy from `dist/`) and install it into
the Web profile:

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.0.tgz
```

`dsh plugin` forwards to pnpm inside the profile directory. The package declares
`dsh.bundle.patch`, so the plugin manager adds `dsh-paper-deepread` to
`dsh.profile.bundles` and applies `cordis.patch.yml`.

If your shell cannot find `pnpm`, run the same command through the pnpm binary that
installed dsh, for example:

```bash
PATH="$HOME/Library/pnpm/bin:$PATH" dsh plugin --profile web add ./dsh-paper-deepread-1.1.0.tgz
```

## 2. Restart and open the UI

```bash
dsh web
```

Click the **Paper Deepread** icon in the left sidebar. The page renders inside the main
panel; the toolbar has *在新标签页打开* and *刷新*. The same page is available directly:

![Paper Deepread panel](screenshot-panel.png)

```text
http://127.0.0.1:3080/paper-deepread/index.html
```

## 3. Verify the installation

Configuration row (composed profile tree):

```bash
dsh --profile web --dump-config | grep -A2 paper-deepread
```

Direct HTTP check:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://127.0.0.1:3080/paper-deepread/index.html
# 200 text/html; charset=utf-8

curl -s http://127.0.0.1:3080/paper-deepread/index.html | grep -c brand-mark
# > 0
```

A report and a PDF inside a paper directory (URL-encoded path):

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://127.0.0.1:3080/paper-deepread/2026-bioRxiv-Compression%20Sequencing%20enables%20ultra-sensitive%20and%20scalable%20scRNA-seq/2026-bioRxiv-Compression%20Sequencing%20enables%20ultra-sensitive%20and%20scalable%20scRNA-seq.html"
```

Model tool: ask the agent in any session to call `paper_deepread` (no arguments to list,
`query` to search, `id` to fetch one paper).

Skill: the first activation copies the bundled skill only when
`~/.dsh/skills/paper-deepread-html` is missing. If you already maintain your own copy it is
left untouched; check with:

```bash
ls ~/.dsh/skills/paper-deepread-html/SKILL.md
```

## 4. Uninstall

```bash
dsh plugin --profile web remove dsh-paper-deepread
```

Restart `dsh web`. The copied skill directory is not removed automatically.

## 5. Build from source

```bash
npm run check   # node --check on every shipped JavaScript file
npm run pack    # -> dist/dsh-paper-deepread-1.1.0.tgz + dist/SHA256SUMS
```

Test against a throwaway profile instead of your live one:

```bash
dsh --profile pdr-test --from-default-profile web --dump-config >/dev/null
PATH="$HOME/Library/pnpm/bin:$PATH" dsh plugin --profile pdr-test add "$PWD/dist/dsh-paper-deepread-1.1.0.tgz"
dsh --profile pdr-test --dump-config | grep -A2 paper-deepread
dsh --profile pdr-test --port 3099 --no-open   # then curl 127.0.0.1:3099/paper-deepread/index.html
```


## 6. Upload and report management (v1.1.0)

1. Open the **Paper Deepread** panel and switch to **上传**.
2. Drag PDFs onto the drop zone (or click to pick). Uploads are capped at 80 MB and
   validated by their `%PDF-` signature; each file shows progress and joins the queue.
3. Copy the prefilled instruction with **复制指令** and paste it into a chat. The plugin
   does not call a model: an agent calls `paper_deepread_uploads` (`ingest`) and
   `paper_deepread_reports` (`build`) to run the bundled skill.
4. The first ingest/build prepares a PyMuPDF interpreter through the bundled skill's
   `setup_env.sh` (cached under `~/.cache/paper-deepread`; first run may download once).
   Preparation can also be triggered in chat with
   `paper_deepread_uploads` `{action: "env"}`.
5. Switch to **报告管理** to open a report or its RAW PDF, hide/show it, delete one
   report directory, or click **重建索引** (deterministic, no model needed).

Managed data (defaults to `$DSH_HOME/paper-deepread`):

```text
~/.dsh/paper-deepread/
├── library/      seeded once from the packaged 文献精读库; user-owned afterwards
├── uploads/      uploaded PDFs
├── work/<id>/    ingest output + report sources (content.html, meta.json, figures.json)
├── state.json    upload inbox/status
└── .seed.json    seed marker
```

Optional row config:

```yaml
- insert:
    - id: paper-deepread
      name: dsh-paper-deepread
      config:
        dataDir: /absolute/path/to/managed-data   # default $DSH_HOME/paper-deepread
        libraryDir: /path/to/existing/paper-read  # external library root, skips seeding
        maxUploadBytes: 52428800                  # 50 MB
```

Reset: stop dsh, delete the data directory, restart. The packaged library is seeded
again on the next activation; uploaded PDFs, work directories, and `state.json` are lost.

Security notes: uploads need `content-type: application/pdf` and a `%PDF-` header;
report delete/visibility accept only a direct child directory name of the managed root
(absolute paths, `..`, and separator-containing names are rejected with `400`).
