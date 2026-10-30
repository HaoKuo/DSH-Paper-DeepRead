# DSH-Paper-DeepRead 1.0.0

Release date: 2026-10-30

**English** | [中文](#中文)

## Highlights

DSH-Paper-DeepRead is a DeepSeek Harness (dsh) Web plugin that ships a complete
deep-read paper library together with the skill that produces it. One install adds:

- **A sidebar panel** — *Paper Deepread* opens the bundled 文献精读库 library in the main
  panel, with an open-in-new-tab link and a reload button.
- **The library itself** — four deep-read papers (2025–2026, Nature Communications /
  bioRxiv / Anthropic · BigHat Biosciences), each with an interactive single-file HTML
  report (original figure crops with page/figure traceability, redrawn SVG schematics, a
  claims ledger, a critical appraisal) and the untouched source PDF. 56 MB of content is
  bundled inside the tarball; nothing is downloaded at runtime.
- **The `paper-deepread-html` skill** — the full deep-read pipeline. On first activation
  the plugin copies it to `~/.dsh/skills/paper-deepread-html`, but only when that
  directory does not exist; an existing user copy is never overwritten.
- **A model tool, `paper_deepread`** — lists the catalogue, substring-searches English and
  Chinese titles, journals, tags, TL;DRs and full text (up to 20 ranked hits with
  snippets), and returns absolute report/PDF paths plus Web URLs for any paper.

## Install

1. Download `dsh-paper-deepread-1.0.0.tgz` from this release.
2. Install it into the Web profile and restart:

   ```bash
   dsh plugin --profile web add ./dsh-paper-deepread-1.0.0.tgz
   dsh web
   ```

3. Open the UI, then click **Paper Deepread** in the left sidebar. The library is also
   served directly at `/paper-deepread/index.html`.

The exact SHA-256 of the release tarball is listed in `dist/SHA256SUMS` inside the source
repository (and in the release description).

## Requirements

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

## Configuration

Optional row config: `libraryDir` (serve another static-site directory), `skillsDir`
(install the skill elsewhere), `registerSkill: false` (never copy the skill). Defaults
work without configuration.

## Known limitations

- The bundled library is a fixed snapshot; replace `library/` to update it.
- `library/index.html` probes `/api/library` for live updates and falls back to its
  embedded catalogue ("离线快照"); navigation, reports, and PDFs are unaffected.
- The browser panel requires dsh's client module system, so both halves activate only in
  a Web profile.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.0.0

发布日期：2026-10-30

## 亮点

DSH-Paper-DeepRead 是一个 DeepSeek Harness（dsh）Web 插件：把完整的文献精读库和产出它的
精读技能一起打包。一次安装即可获得：

- **侧边栏面板** —— 「Paper Deepread」在主面板中打开内置「文献精读库」，带新标签页打开与刷新按钮。
- **文献精读库本体** —— 4 篇精读论文（2025–2026，Nature Communications / bioRxiv /
  Anthropic · BigHat Biosciences），每篇含单文件交互式 HTML 精读报告（原文图表裁切并标注
  图号/页码、SVG 重绘示意图、证据账本、批判性评估）与未改动的原文 PDF。56 MB 内容随包分发，
  运行时不下载任何东西。
- **`paper-deepread-html` 技能** —— 完整精读流水线。首次激活时复制到
  `~/.dsh/skills/paper-deepread-html`，但仅在该目录不存在时才复制；已有用户副本绝不覆盖。
- **模型工具 `paper_deepread`** —— 列书目、按英文/中文标题、期刊、标签、TL;DR 与全文做包含搜索
  （最多 20 条带摘要命中），并返回每篇论文的报告/PDF 绝对路径与 Web URL。

## 安装

1. 从本 release 下载 `dsh-paper-deepread-1.0.0.tgz`。
2. 安装到 Web profile 并重启：

   ```bash
   dsh plugin --profile web add ./dsh-paper-deepread-1.0.0.tgz
   dsh web
   ```

3. 打开界面，点击左侧边栏的 **Paper Deepread**。也可直接访问
   `/paper-deepread/index.html`。

发布包的 SHA-256 见源码仓库中的 `dist/SHA256SUMS`（以及 release 说明）。

## 环境要求

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

## 配置

可选行配置：`libraryDir`（换一个静态站点目录）、`skillsDir`（把技能安装到别处）、
`registerSkill: false`（从不复制技能）。默认无需配置。

## 已知限制

- 内置书库是固定快照；更新时替换 `library/`。
- `library/index.html` 会请求 `/api/library` 尝试实时更新，失败时回退到内嵌目录
  （「离线快照」）；导航、报告与 PDF 不受影响。
- 浏览器面板依赖 dsh 客户端模块系统，因此两半只在 Web profile 中激活。

## 许可证

MIT © 2026 HaoKuo

</details>
