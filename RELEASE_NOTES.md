# DSH-Paper-DeepRead 1.2.0

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

v1.2.0 connects the plugin to the standalone deep-read site and makes the bundled skill
update itself safely.

- **Skill version sync.** The bundled `paper-deepread-html` skill now carries
  `version: 1.2.0` in its SKILL.md frontmatter. On activation the plugin compares it with
  the installed copy under `~/.dsh/skills/paper-deepread-html`, records a content hash in
  `<dataDir>/skill-state.json`, and only replaces an outdated copy when the installed tree
  is byte-identical to the recorded hash — after backing the old copy up to
  `~/.dsh/skills/.backup/paper-deepread-html-<version>-<UTC>/`. User-modified or legacy
  untracked copies are kept with a warning, and newer installed copies are never
  downgraded. Config `skillSync: "update" | "keep"` (default `update`). `/api/state` and
  the `paper_deepread` tool now report `skillVersion` and `installedSkillVersion`.
- **Automatic deep-read pipeline (optional).** With `siteUrl` configured (e.g.
  `http://127.0.0.1:8080`), the 上传 tab shows an **自动精读** card: worker online state,
  queue counts, and site version come from the site health endpoint; PDFs are posted
  through `POST /paper-deepread/api/site/upload` (raw body, `X-Filename`, `Content-Type`,
  optional `X-KB-Upload-Token`, 120 s timeout) and land in the site worker's queue.
  Duplicate and possible-duplicate uploads show the site's own message, `401
  UPLOAD_TOKEN_REQUIRED` asks for the upload token, and links open `<siteUrl>/manage.html`
  and the site library. No site credential is stored in the plugin config.
- **Unchanged without `siteUrl`.** The local inbox, agent-handoff instruction, and report
  management workflow behave exactly as in v1.1.6; the panel header/tab design is
  unchanged.
- **Docs and tests.** README (EN/ZH) documents `siteUrl` and `skillSync`, adds the sync
  policy table and a version matrix (site 1.4.0 / library 1.4.0 / plugin 1.2.0 / skill
  1.2.0). New `tests/skill.test.js` and `tests/site.test.js` cover the sync state machine
  and the site proxy against a local mock server.

## Version matrix

| Component | Version |
| --- | --- |
| Deep-read site backend (`deploy/serve.py`) | 1.4.0 |
| 文献精读库 library index | 1.4.0 |
| DSH-Paper-DeepRead plugin | 1.2.0 |
| Bundled `paper-deepread-html` skill | 1.2.0 |

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.2.0.tgz
dsh web   # restart to reload the plugin package
```

Upgrading from v1.1.x: the plugin keeps your existing skill copy (it has no recorded hash)
and warns once; delete `~/.dsh/skills/paper-deepread-html` if you want the plugin to manage
it from now on. To use the auto pipeline, add `siteUrl` to the plugin row config.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile
- The automatic pipeline needs a running site ≥ 1.4.0 with `GET /api/health`

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.2.0

发布日期：2026-10-30

## 变更内容

v1.2.0 把插件接入独立精读站点，并让内置技能可以安全地自我更新。

- **技能版本同步。** 内置 `paper-deepread-html` 技能在 SKILL.md frontmatter 中声明
  `version: 1.2.0`。激活时插件与 `~/.dsh/skills/paper-deepread-html` 中的已安装副本比较，
  把内容 hash 记录到 `<dataDir>/skill-state.json`；只有当已安装目录与记录的 hash 完全
  一致时才会替换旧版本——替换前先把旧副本备份到
  `~/.dsh/skills/.backup/paper-deepread-html-<版本>-<UTC>/`。被用户修改或没有记录的旧副本
  会保留并告警，已安装版本更高时绝不降级。新增 `skillSync: "update" | "keep"`
  （默认 `update`）。`/api/state` 与 `paper_deepread` 工具输出会报告 `skillVersion` 与
  `installedSkillVersion`。
- **自动精读流水线（可选）。** 配置 `siteUrl`（如 `http://127.0.0.1:8080`）后，上传标签页
  顶部出现 **自动精读** 卡片：worker 在线状态、队列计数与站点版本来自站点 health 接口；
  PDF 经 `POST /paper-deepread/api/site/upload` 原样转发（文件名、Content-Type、可选
  `X-KB-Upload-Token`，120 秒超时）进入站点 worker 队列。重复/可能重复上传直接显示站点
  文案；`401 UPLOAD_TOKEN_REQUIRED` 时提示填写上传令牌；卡片提供
  `<siteUrl>/manage.html` 与站点书库链接。插件配置不保存任何站点凭据。
- **未配置 `siteUrl` 时行为不变。** 本地收件箱、Agent 交接指令与报告管理流程与 v1.1.6
  完全一致；面板头部/标签设计不变。
- **文档与测试。** 中英文 README 记录 `siteUrl` 与 `skillSync`，新增同步策略表与版本矩阵
  （站点 1.4.0 / 书库 1.4.0 / 插件 1.2.0 / 技能 1.2.0）。新增 `tests/skill.test.js` 与
  `tests/site.test.js`，覆盖同步状态机与本地 mock 服务器上的站点代理。

## 版本矩阵

| 组件 | 版本 |
| --- | --- |
| 精读站点后端（`deploy/serve.py`） | 1.4.0 |
| 文献精读库索引 | 1.4.0 |
| DSH-Paper-DeepRead 插件 | 1.2.0 |
| 内置 `paper-deepread-html` 技能 | 1.2.0 |

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.2.0.tgz
dsh web   # 重启以重新加载插件包
```

从 v1.1.x 升级：插件会保留已有技能副本（没有 hash 记录）并告警一次；如果希望交给插件
管理，删除 `~/.dsh/skills/paper-deepread-html` 即可。要使用自动精读，在插件行配置中加入
`siteUrl`。

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile
- 自动精读需要运行中的站点 ≥ 1.4.0 且提供 `GET /api/health`

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 许可证

MIT © 2026 HaoKuo

</details>
