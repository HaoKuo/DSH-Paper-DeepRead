# DSH-Paper-DeepRead 1.1.4

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

A small UI-polish release for the DSH panel and the bundled management console.

- **Panel header de-duplicated** — the plugin panel dropped its own copy of the
  "文献精读库 / Paper Deepread · 上传、精读与报告管理" header. The embedded library page
  already shows the brand, so the panel now opens directly with the
  **文献库 / 上传 / 报告管理** tab bar; the report count and library version sit on the
  right of that bar, and the 文献库 tab shows the count badge.
- **Upload step cards aligned** — in `manage.html` the three numbered step cards are an
  `<ol>` that kept the browser default 40 px padding, so they were inset relative to the
  cards below. With `padding: 0` they line up with the panel edge (verified with rendered
  geometry: steps / cards / tabs all start at the same left edge).
- **No API, tool, or behaviour changes.** Upload, auto deep-read worker, report
  management, and the shared `paper-read` library are unchanged.

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.4.tgz
dsh web   # restart to load the updated client bundle
```

Then refresh the browser page; the panel appears without the duplicated header block.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.4

发布日期：2026-10-30

## 变更内容

针对 DSH 面板与内置管理台的小型 UI 修正。

- **面板标题去重** —— 插件面板不再重复显示「文献精读库 / Paper Deepread · 上传、精读与报告管理」
  这两行标题（内嵌的文献库页面本身已有品牌头部）。面板现在直接从
  **文献库 / 上传 / 报告管理** 标签栏开始，报告数量与书库版本移到标签栏右侧，
  文献库标签也带数量徽标。
- **上传步骤卡片对齐** —— `manage.html` 的 3 张编号步骤卡使用 `<ol>`，保留了浏览器默认的
  40px 内边距，导致它们相对下方卡片内缩。改为 `padding: 0` 后与面板左边缘对齐
  （已用渲染几何验证：步骤卡 / 卡片 / 标签栏左边缘一致）。
- **无 API、工具或行为变更**：上传、自动精读 worker、报告管理与共享 `paper-read` 书库均不受影响。

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.4.tgz
dsh web   # 重启以加载新的客户端 bundle
```

重启后刷新浏览器页面即可看到去掉重复标题的面板。

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 许可证

MIT © 2026 HaoKuo

</details>
