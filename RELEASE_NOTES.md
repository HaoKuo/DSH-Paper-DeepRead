# DSH-Paper-DeepRead 1.3.0

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

A bundled-skill release: deep-read reports for **research articles** now cover every main figure and
main table, and explain the paper **section by section**.

- **No more under-reading**: research articles must deep-read **all main figures and main tables**
  (one card per main figure, one table card per main table). The old "3–8 figures" guidance no longer
  applies to research papers. Key supplementary figures/tables must be read or explicitly referenced;
  skipped items need a written reason.
- **Section-by-section interpretation**: every Results subsection gets a section brief plus 2–4 body
  paragraphs (goal / key evidence and numbers / conclusion and role in the argument chain / doubts),
  citing its figures, tables and page numbers. Abstract or figure captions are not acceptable
  substitutes.
- **Reading-coverage checklist**: a mandatory `<details class="coverage">` table lists every main
  figure/table and key supplementary item with the place it was read or why it was skipped.
- QA checklist, article-type reference and the unattended worker prompt now enforce these rules.
- **No plugin code, API or behaviour changes.**

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.3.0.tgz
dsh web   # restart to reload the plugin package (skill content updates live)
```

Existing reports are not modified; only newly generated reports follow the new rules. To refresh an
older report, re-run the skill or force a re-read with the admin console.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.3.0

发布日期：2026-10-30

## 变更内容

本次为内置技能更新：**研究类文章**的精读报告现在会覆盖全部主图/主表，并按原文章节逐节解读。

- **解决漏读**：研究类必须精读**全部主图与主表**（每张主图一个图卡、每张主表一个表卡），
  不再适用"只选 3–8 张"的旧规则；关键补充图/表必须解读或明确引用，跳过项要写理由。
- **逐章节解读**：Results 的每个小节 = 章节导读卡 + 2–4 段正文（本节目标 / 关键证据与数字 /
  结论与在论证链中的位置 / 可疑处），逐节引用对应图、表与页码；不得用摘要或图注替代。
- **阅读覆盖清单**：报告必须包含 `<details class="coverage">` 清单，列出全部主图/主表/关键补充项，
  标注精读位置或跳过理由。
- QA 清单、文章类型参考与自动精读 worker 提示词均已同步强制这些规则。
- **无插件代码、API 或行为变更。**

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.3.0.tgz
dsh web   # 重启以重新加载插件包（技能内容本身即时生效）
```

已有报告不会被改动；只有新生成的报告采用新规则。如需刷新旧报告，重跑该篇精读或在管理台强制重读。

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 许可证

MIT © 2026 HaoKuo

</details>
