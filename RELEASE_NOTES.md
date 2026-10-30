# DSH-Paper-DeepRead 1.1.0

Release date: 2026-10-30

**English** | [中文](#中文)

## Highlights

v1.1.0 turns the library viewer into a managed deep-read workspace: upload papers,
hand them to an agent, then manage the reports.

- **Upload tab** — drag & drop (or pick) multiple PDFs with per-file progress. Files
  land in a persistent managed inbox (`$DSH_HOME/paper-deepread` by default; 80 MB
  limit, `%PDF-` content check, sanitized filenames). The queue shows status
  (`待精读 → 已摄取 → 已成稿`, plus `失败`) and lets you delete pending uploads.
- **Agent-driven deep-read** — the plugin never calls a model. A prefilled instruction
  on the upload tab is copied into a chat; an agent in any session then calls
  `paper_deepread_uploads` (`ingest`) and `paper_deepread_reports` (`build`) to run the
  bundled `paper-deepread-html` skill and assemble the report. Rebuilding the index is
  deterministic and needs no model.
- **Report management tab** — table of reports with title/year/journal/size, open report
  and raw PDF links, hide/unhide (filtered on the library page), delete one report
  directory, and one-click **重建索引** with the rebuild log.
- **Managed library** — the packaged 文献精读库 is seeded once into `dataDir/library`
  and then belongs to you; user edits are never overwritten and a second boot does not
  re-seed. The legacy `libraryDir` option still points the plugin at an external local
  文献精读库 (no seeding).
- **New model tools** — `paper_deepread_uploads` (`list`/`env`/`ingest`/`delete`) and
  `paper_deepread_reports` (`list`/`build`/`rebuild`/`delete`/`hide`); the existing
  `paper_deepread` catalogue/search tool now reads the managed library and reports
  upload/report counts.
- **HTTP API** under `/paper-deepread/api/*` on the same single prefix route: `state`,
  `upload`, `uploads/delete`, `reports/rebuild`, `reports/delete`, `reports/visibility`.

## Install

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.0.tgz
dsh web
```

Open the UI, click **Paper Deepread**, then use the 文献库 / 上传 / 报告管理 tabs.
The first ingest or report build prepares a PyMuPDF interpreter through the bundled
skill's `setup_env.sh` (cached in `~/.cache/paper-deepread`; first run may download
PyMuPDF once).

## Upgrade notes

- Upgrading from 1.0.0 is in place: on first activation the packaged library is copied
  once into `$DSH_HOME/paper-deepread/library`, so the existing library page keeps
  working. Nothing is written into the package directory.
- Remove `$DSH_HOME/paper-deepread` to reset uploads, work directories, and the managed
  library (the packaged snapshot is copied again on the next activation).
- Existing configuration keys (`libraryDir`, `skillsDir`, `registerSkill`) keep working;
  new optional keys are `dataDir` and `maxUploadBytes`.

## Requirements

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- Python 3 for ingest/report builds (prepared by the bundled skill; PyMuPDF cached venv)

## Known limitations

- Deep-reading itself is agent-driven and needs a model session; the plugin only runs
  deterministic extraction/build/reindex scripts.
- `library/index.html` probes `/api/library` for live updates and falls back to its
  embedded catalogue ("离线快照"); navigation, reports, and PDFs are unaffected.
- Hidden reports stay on disk (that is the point of hide); only delete removes files.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.0

发布日期：2026-10-30

## 亮点

v1.1.0 把「书库浏览」升级为受管的精读工作台：上传论文、交给 Agent 精读、再管理报告。

- **上传标签页** —— 拖放或选择多个 PDF，逐文件显示进度。文件进入持久化受管收件箱
  （默认 `$DSH_HOME/paper-deepread`；单篇 80 MB 上限、校验 `%PDF-`、文件名净化）。
  队列显示状态（`待精读 → 已摄取 → 已成稿`，失败为 `失败`），可删除待处理上传。
- **Agent 驱动精读** —— 插件本身不调用模型。上传页提供预填指令，复制到对话后，
  任意会话中的 Agent 调用 `paper_deepread_uploads`（`ingest`）与
  `paper_deepread_reports`（`build`）驱动内置 `paper-deepread-html` 技能成稿；
  重建索引是确定性操作，不需要模型。
- **报告管理标签页** —— 报告表格展示标题/年份/期刊/大小，支持打开报告与原文、
  隐藏/显示（书库页面过滤）、删除单篇报告目录，以及一键「重建索引」并查看日志。
- **受管书库** —— 安装包内的「文献精读库」首次激活时复制到 `dataDir/library`，
  之后归用户所有；不会覆盖用户修改，第二次启动不会重复播种。旧版 `libraryDir`
  仍可指向外部本地书库（不播种）。
- **新增模型工具** —— `paper_deepread_uploads`（`list`/`env`/`ingest`/`delete`）与
  `paper_deepread_reports`（`list`/`build`/`rebuild`/`delete`/`hide`）；原有
  `paper_deepread` 目录/搜索工具改为读取受管书库，并附带上传/报告计数。
- **HTTP API** 仍在同一个 `/paper-deepread` 前缀路由下：`api/state`、`api/upload`、
  `api/uploads/delete`、`api/reports/rebuild`、`api/reports/delete`、`api/reports/visibility`。

## 安装

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.0.tgz
dsh web
```

打开界面点击 **Paper Deepread**，使用 文献库 / 上传 / 报告管理 三个标签页。
首次摄取或成稿会通过内置技能的 `setup_env.sh` 准备带 PyMuPDF 的解释器
（缓存于 `~/.cache/paper-deepread`，首次可能联网安装一次 PyMuPDF）。

## 升级说明

- 从 1.0.0 原地升级：首次激活时把安装包内的书库复制一次到
  `$DSH_HOME/paper-deepread/library`，原有书库页面继续可用；不会写入安装包目录。
- 删除 `$DSH_HOME/paper-deepread` 可重置上传、work 与受管书库（下次激活会重新播种）。
- 原有配置（`libraryDir`、`skillsDir`、`registerSkill`）继续有效；新增可选
  `dataDir` 与 `maxUploadBytes`。

## 环境要求

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 验证）
- Node.js `>= 24`
- Python 3（用于摄取/成稿，由内置技能准备；PyMuPDF 使用缓存 venv）

## 已知限制

- 精读本身由 Agent 驱动，需要模型会话；插件只运行确定性的提取、成稿与重建脚本。
- `library/index.html` 会请求 `/api/library` 尝试实时更新，失败时回退内嵌目录（「离线快照」）；
  导航、报告与 PDF 不受影响。
- 隐藏的报告仍保留在磁盘上（隐藏的目的就是保留下次显示）；只有删除才会移除文件。

## 许可证

MIT © 2026 HaoKuo

</details>
