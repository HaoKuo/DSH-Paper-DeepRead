# DSH-Paper-DeepRead 1.1.1

Release date: 2026-10-30

**English** | [中文](#中文)

## What changed

This is a content release: the **legacy brand wording has been removed** from the
bundled 文献精读库 (Paper Deepread) page and from the material that generates it.

- **Library page** — the footer no longer starts with the old brand name; it shows just
  the library title (文献精读库) and the version chip. The browser-tab title loses the
  old brand suffix and reads `文献精读库 v1.2.0`.
- **Sources kept in sync** — the library README, the packaged
  `assets/library_template.html`, and the bundled skill's `SKILL.md` were cleaned up as
  well, so running `build_library.py` again or reinstalling the plugin never reintroduces
  the wording.
- **No functional changes** — upload, agent handoff, report management, the
  `/paper-deepread/api/*` endpoints, and the three model tools are identical to v1.1.0.

## Install / upgrade

Upgrade by installing the new tarball over the old version, then restart `dsh web`:

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.1.tgz
dsh web
```

Fresh install is the same command. The managed data directory
(`$DSH_HOME/paper-deepread`) is preserved across upgrades; only the packaged snapshot
changes. Users who already have a seeded library keep it untouched, and they can delete
`$DSH_HOME/paper-deepread/library` (or the whole data directory) to re-seed from this
package if they want the updated snapshot.

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (built and verified against `0.2.1-rc.3`)
- Node.js `>= 24`
- The `web` profile

## License

MIT © 2026 HaoKuo

<details>
<summary>中文</summary>

# DSH-Paper-DeepRead 1.1.1

发布日期：2026-10-30

## 变更内容

本次为内容更新：**已从内置「文献精读库」页面及其生成链路中去除旧品牌字样。**

- **书库页面** —— 页脚不再以旧品牌名开头，只显示书库标题（文献精读库）与版本徽标；
  浏览器标签标题去掉旧品牌后缀，显示为 `文献精读库 v1.2.0`。
- **同步清理源文件** —— 书库 README、打包的 `assets/library_template.html` 与内置技能
  `SKILL.md` 一并清理，因此重新运行 `build_library.py` 或重装插件都不会再出现该字样。
- **无功能性变更** —— 上传、Agent 交接、报告管理、`/paper-deepread/api/*` 接口与三个模型工具
  均与 v1.1.0 完全一致。

## 安装 / 升级

用新 tarball 覆盖安装旧版本，然后重启 `dsh web`：

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.1.1.tgz
dsh web
```

首次安装使用同样的命令。受管数据目录（`$DSH_HOME/paper-deepread`）在升级时保留，仅打包快照更新。
已播种过书库的用户不会被覆盖；如需换成此版本的快照，可删除
`$DSH_HOME/paper-deepread/library`（或整个数据目录）后重启，让它重新播种。

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

## 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（针对 `0.2.1-rc.3` 构建与验证）
- Node.js `>= 24`
- `web` profile

## 许可证

MIT © 2026 HaoKuo

</details>
