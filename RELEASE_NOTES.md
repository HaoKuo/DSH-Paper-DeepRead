# DSH-Paper-DeepRead 1.1.5

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

A skill update: deep-read reports now adapt to the **article type** and give the
**main sections real narrative coverage**, not only figure/table commentary.

- **Type-aware deep read** — the bundled `paper-deepread-html` skill first classifies the
  paper as *research article*, *review / perspective / roadmap*, or
  *methods / resource / benchmark*. Each type gets its own reading path, figure focus,
  methods depth, required sections and critical-appraisal framework. Report headers state
  the detected type.
- **Section briefs (new, mandatory)** — every major section starts with a
  `sec-brief` card: one-sentence section goal, 3–5 evidence-chipped key points, and a
  one-sentence takeaway (150–300 characters per section), in addition to the original
  figure/table deep-read. This applies to both research and review papers.
- **Type-specific report structures** — research: problem → methods → evidence chain →
  critique; review: domain map/classification → per-chapter briefs → comparison table →
  evidence coverage → consensus vs controversy → trends/roadmap.
- **Templates and checklists** — report template ships `.sec-brief` styles
  (light/dark/print/mobile); reading protocol and QA checklist enforce the new rules;
  the unattended worker prompt requests type classification and section briefs.
- **No API, tool, or behaviour changes**; the library pages are untouched.

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.5.tgz
dsh web   # restart to reload the plugin package
```

Existing reports are not modified — only newly generated reports follow the new rules.
To regenerate an old report, re-run the skill (or ask the agent to re-deep-read that PDF).

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.5

发布日期：2026-10-30

## 变更内容

本次更新技能：精读报告现在会**先区分文章类型**，并给**正文主要章节补充详细介绍与总结**，
不再只围绕原图/原表做解读。

- **按类型精读** —— 内置 `paper-deepread-html` 技能先判定论文类型：研究类（research）、
  综述类（review / perspective / roadmap）、方法或资源与基准类；每种类型有独立的阅读路径、
  图表重点、方法深度、必写章节与批判框架，报告开头会标注类型。
- **章节导读（新增，强制）** —— 报告每个主要章节开头都要有 `sec-brief` 卡片：1 句本节目标、
  3–5 条带证据 chip 的要点、1 句小结（每节 150–300 字），与原图/原表精读并存，研究类与综述类都需要。
- **按类型的报告结构** —— 研究类：问题 → 方法 → 证据链 → 批判；综述类：领域地图/分类框架 →
  逐章导读 → 横向对比表 → 证据覆盖 → 共识/争议 → 趋势与路线图。
- **模板与清单** —— 报告模板新增 `.sec-brief` 样式（深浅色/打印/移动端）；阅读协议与 QA 清单
  加入对应验收项；自动精读 worker 的提示词也要求先分类并写章节导读。
- **无 API、工具或行为变更**；文献库页面不受影响。

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.5.tgz
dsh web   # 重启以重新加载插件包
```

已有报告不会被改动，只有新生成的报告采用新规则；如需重做旧报告，重跑该篇精读即可。

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 许可证

MIT © 2026 HaoKuo

</details>
