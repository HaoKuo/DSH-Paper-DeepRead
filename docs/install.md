# Install and verify DSH-Paper-DeepRead

## 1. Install from the release tarball

Download `dsh-paper-deepread-1.0.0.tgz` (or use the copy from `dist/`) and install it into
the Web profile:

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.0.0.tgz
```

`dsh plugin` forwards to pnpm inside the profile directory. The package declares
`dsh.bundle.patch`, so the plugin manager adds `dsh-paper-deepread` to
`dsh.profile.bundles` and applies `cordis.patch.yml`.

If your shell cannot find `pnpm`, run the same command through the pnpm binary that
installed dsh, for example:

```bash
PATH="$HOME/Library/pnpm/bin:$PATH" dsh plugin --profile web add ./dsh-paper-deepread-1.0.0.tgz
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
npm run pack    # -> dist/dsh-paper-deepread-1.0.0.tgz + dist/SHA256SUMS
```

Test against a throwaway profile instead of your live one:

```bash
dsh --profile pdr-test --from-default-profile web --dump-config >/dev/null
PATH="$HOME/Library/pnpm/bin:$PATH" dsh plugin --profile pdr-test add "$PWD/dist/dsh-paper-deepread-1.0.0.tgz"
dsh --profile pdr-test --dump-config | grep -A2 paper-deepread
dsh --profile pdr-test --port 3099 --no-open   # then curl 127.0.0.1:3099/paper-deepread/index.html
```
