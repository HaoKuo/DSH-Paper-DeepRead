# DSH-Paper-DeepRead 1.1.6

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

Documentation-only release: the README screenshots no longer show the local DSH sidebar
(workspace and session titles).

- The README (English/Chinese) dropped the panel screenshot that included the Harness
  sidebar; the remaining images are captured from the standalone library and management
  console, so they contain no local workspace/session information.
- Unused sidebar and mobile screenshots were removed from `docs/`; the package now ships
  three sidebar-free images (library, upload tab, report management tab).
- No code, API, skill or behaviour changes.

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.6.tgz
dsh web   # restart to reload the plugin package
```

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.6

发布日期：2026-10-30

## 变更内容

仅文档更新：README 截图不再包含本机 DSH 左侧边栏（工作区/会话标题）。

- 中英文 README 移除了包含 Harness 左边栏的面板截图；保留的截图均来自独立站点与
  管理控制台，不含本地工作区/会话信息。
- 从 `docs/` 删除未使用的侧边栏与移动端截图；安装包现在只带三张无侧边栏截图
  （文献库、上传标签页、报告管理标签页）。
- 无代码、API、技能或行为变更。

## 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.6.tgz
dsh web   # 重启以重新加载插件包
```

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 许可证

MIT © 2026 HaoKuo

</details>
