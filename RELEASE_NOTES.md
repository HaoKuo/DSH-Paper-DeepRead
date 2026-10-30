# DSH-Paper-DeepRead 1.1.2

Release date: 2026-10-30

**English** | [中文](#中文)

## Highlights

v1.1.2 is an assets-only sync with the standalone 文献精读库 site (v1.3.0). Plugin runtime
behaviour, the HTTP API routes, and the three model tools are identical to v1.1.1.

- **Library page entry points** — the bundled library header now carries compact
  「上传」「管理」 links that open the new management console. Rebuilt from the patched
  template at library version 1.3.0, with the reverted compact logo and no legacy brand
  wording.
- **`library/manage.html`** — a self-contained upload + report-management console shared
  with the standalone site. It uses relative API URLs, so the same file works at
  `/manage.html` on the site (site API) and at `/paper-deepread/manage.html` in the plugin
  (plugin API). Features: drag & drop upload inbox with progress, copyable agent handoff
  instruction (the plugin/site never calls a model), report table with open/raw links,
  hide/unhide, typed-confirm delete, and one-click index rebuild (plus publish on the site).
- **Token unlock validation** — the standalone site's management console now verifies a
  token before accepting it: `GET /api/auth` (ADMIN-only; 401/503) replaces the previous
  store-first behaviour, so a wrong token shows an inline "管理令牌无效" error and is
  never saved; a stale sessionStorage token is re-verified and cleared on page load.
  Older backends without `/api/auth` fall back to a read-only inbox probe.
- **API state alignment** — the plugin's `GET /paper-deepread/api/state` now mirrors the
  site's shape (`size`, `admin`, `publish`, `limits.maxUploadMb`, `version`,
  `library.updated`) so the shared manage page needs no branching. Upload remains open;
  plugin management endpoints stay token-free by design (local plugin API).

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.2.tgz
dsh web
```

Upgrading from 1.1.x is in place; existing managed data (`$DSH_HOME/paper-deepread`) is
untouched. Delete that directory to reset uploads/work/library (the packaged snapshot is
seeded again on the next activation).

## Requirements

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- Python 3 for ingest/report builds (prepared by the bundled skill; PyMuPDF cached venv)

## Known limitations

- Deep-reading stays agent-driven; the plugin only runs deterministic extract/build/reindex
  scripts and serves the shared console.
- The standalone site's management console additionally requires `KB_ADMIN_TOKEN` on the
  server (see the site repo's `deploy/README.md`); inside the plugin the manage page needs
  no token.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.2

发布日期：2026-10-30

## 亮点

v1.1.2 是与独立「文献精读库」站点（v1.3.0）同步的纯资源更新。插件运行时行为、HTTP API 路由与
三个模型工具均与 v1.1.1 完全一致。

- **书库页入口** —— 内置书库页头新增紧凑的「上传」「管理」链接，打开新的管理控制台。
  页面由修补后的模板按书库版本 1.3.0 重建，保留原回退的紧凑 logo、无旧品牌字样。
- **`library/manage.html`** —— 与独立站点共用的自包含「上传 + 报告管理」控制台。所有 API 使用
  相对路径，因此同一份文件在站点 `/manage.html`（站点 API）与插件
  `/paper-deepread/manage.html`（插件 API）都能工作。功能：拖放上传收件箱与进度、
  可复制的 Agent 手递指令（插件/站点都不调用模型）、报告表格（打开/原文）、隐藏/显示、
  输入确认的删除、一键重建索引（站点端还含发布）。
- **令牌解锁校验** —— 独立站点的管理控制台现在会先校验令牌再接受：新增 ADMIN-only
  `GET /api/auth`（缺失/错误令牌 401，令牌未配置 503），输错令牌会内联提示「管理令牌无效」
  且不会保存；刷新页面时 sessionStorage 里的旧令牌会被重新校验并清除。缺少 `/api/auth` 的
  旧后端会回退为只读收件箱探测。
- **API state 对齐** —— 插件 `GET /paper-deepread/api/state` 现在提供与站点一致的形状
  （`size`、`admin`、`publish`、`limits.maxUploadMb`、`version`、`library.updated`），
  共享管理页无需分支判断。上传保持开放；插件管理端点按设计免令牌（本地插件 API）。

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.2.tgz
dsh web
```

从 1.1.x 原地升级；既有受管数据（`$DSH_HOME/paper-deepread`）不受影响。删除该目录可重置
上传/work/书库（下次激活会重新播种安装包快照）。

## 环境要求

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 验证）
- Node.js `>= 24`
- Python 3（摄取/成稿由内置技能准备；PyMuPDF 使用缓存 venv）

## 已知限制

- 精读仍由 Agent 驱动；插件只运行确定性的提取/成稿/重建脚本并提供共享控制台。
- 独立站点的管理控制台额外要求服务端配置 `KB_ADMIN_TOKEN`（见站点仓库 `deploy/README.md`）；
  插件内的管理页无需令牌。

## 许可证

MIT © 2026 HaoKuo

</details>
