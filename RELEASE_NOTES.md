# DSH-Paper-DeepRead 1.7.0

Release date: 2026-11-13

**English** | [中文](#中文)

## What changed

This release simplifies the plugin panel into a **thin client** and moves **手机访问
(mobile access)** into the library's own management page.

- **Thin client panel** — selecting Paper Deepread in the DSH sidebar now shows only the
  bundled 文献精读库 page, as a full-height same-origin iframe. The plugin's own
  文献库 / 上传 / 报告管理 tab row, the *刷新* and *在新标签页打开* actions, the 上传 and
  报告管理 panels, and the 手机访问 modal are gone. The sidebar entry and the host half
  (library route, management API, model tools, skill install/sync, mobile-access runtime)
  are unchanged.
- **手机访问 moved into the site management page** — on the library page click **管理**
  (top-right) and the management console opens in a new browser tab; its third tab,
  **手机访问**, sits next to 上传 / 报告管理. It shows two blocks:
  **外网（临时）** — the Cloudflare quick tunnel, started automatically when the tab opens,
  with status chips `连接中…` / `已开启` / `连接失败` / `未开启`, **关闭外网访问** to stop
  it and **连不上？刷新链接** to rebuild it — and **局域网 · `<IP>`** — the first
  non-loopback IPv4 address, with URL, **复制链接** and a locally rendered QR code. The
  tunnel block carries the security note that the tunnel URL is public and
  unauthenticated.
- **Where the tab works** — the console opened through the plugin
  (`/paper-deepread/manage.html`, same-origin plugin API) serves the tab fully; the same
  page opened on the standalone site (`:8080`) shows a note that 手机访问 requires the DSH
  panel.
- **Upload and report management** — now done from the management console (the 上传 tab
  feeds the plugin's managed inbox through the plugin API; the 报告管理 tab keeps
  hide/unhide, delete and 重建索引) or through the agent tools, which keep their
  parameters and behaviour.
- **No host-side or data changes** — `GET /paper-deepread/api/access` and
  `POST /paper-deepread/api/access/tunnel` keep the same payload; `src/qr.js`,
  `src/access.js`, `src/lan.js`, `src/tunnel.js`, the config keys `cloudflaredPath` /
  `cloudflaredProxy` / `lanPort`, the cloudflared detection order and proxy caveat, the
  locally generated QR codes and the read-only LAN fallback server are unchanged.
  Existing data directories, uploads, reports and skill state are reused as-is — no
  migration.

## Security note

The Cloudflare quick tunnel publishes the library to the public internet **without
authentication**: anyone who has the URL can read every report and PDF. It is started
automatically when the 手机访问 tab opens; stop it with **关闭外网访问** when you are done,
and share the link or QR code only with people you trust. The LAN fallback server is
read-only (GET/HEAD static files only) but reachable by any device on the same network for
as long as `dsh web` runs. `dsh web` itself stays loopback-only.

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.7.0.tgz
dsh web   # restart to reload the plugin package
```

Upgrading in place keeps the managed data directory; nothing is migrated or rewritten.
`cloudflared` is optional: without it the 外网（临时） block reports that the tunnel is
unavailable and the 局域网 block keeps working.

See [docs/install.md](docs/install.md) for verification commands, including the
`/paper-deepread/api/access` check and the 文献库 → 管理 → 手机访问 walkthrough.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (the engine range declared in `package.json`)
- Node.js `>= 24`
- The `web` profile
- Optional: `cloudflared` (Cloudflare) for the 外网（临时） quick tunnel

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

## 中文

**DSH-Paper-DeepRead 1.7.0** · 发布日期：2026-11-13

### 变更内容

本次把插件面板简化为**薄客户端**，并把**「手机访问」迁入书库自带的管理页**。

- **薄客户端面板** —— 在 DSH 侧边栏选中 Paper Deepread，现在只显示内置的文献精读库页面
  （全高、同源 iframe）。插件自有的「文献库 / 上传 / 报告管理」标签栏、「刷新」
  「在新标签页打开」动作、上传面板、报告管理面板以及「手机访问」弹窗全部移除；侧边栏
  入口与宿主端（书库路由、管理 API、模型工具、技能安装/同步、手机访问运行时）均未改动。
- **「手机访问」迁入站点管理页** —— 在书库页点右上角「管理」，管理控制台会在新浏览器
  标签页打开；其第三个标签页 **手机访问** 与「上传」「报告管理」并列。页面有两个区块：
  **外网（临时）** —— Cloudflare 临时隧道，标签页打开时自动开启，带状态标签
  `连接中…` / `已开启` / `连接失败` / `未开启`，可用「关闭外网访问」停止、
  「连不上？刷新链接」重建；**局域网 · `<IP>`** —— 本机第一个非回环 IPv4 地址，带 URL、
  「复制链接」和本地生成的二维码。外网区块附安全提示：隧道地址公开且无身份验证。
- **标签页的可用范围** —— 经插件打开的管理控制台（`/paper-deepread/manage.html`，
  同源插件 API）可完整使用；在独立站点（`:8080`）打开同一页面时，该标签页会提示需要
  DSH 面板。
- **上传与报告管理** —— 改由管理控制台完成（「上传」标签页经插件 API 进入受管收件箱；
  「报告管理」标签页保留隐藏/显示、删除与「重建索引」），或继续通过 Agent 工具完成
  （参数与行为不变）。
- **宿主端与数据均无变化** —— `GET /paper-deepread/api/access` 与
  `POST /paper-deepread/api/access/tunnel` 载荷不变；`src/qr.js`、`src/access.js`、
  `src/lan.js`、`src/tunnel.js`、配置项 `cloudflaredPath` / `cloudflaredProxy` /
  `lanPort`、cloudflared 查找顺序与代理说明、本地二维码生成、只读局域网兜底服务器均未
  改动。已有数据目录、上传记录、报告与技能状态原样沿用，无需迁移。

### 安全提示

Cloudflare 临时隧道会把书库发布到公网且**没有身份验证**：任何拿到链接的人都能阅读全部
报告与 PDF。隧道会在「手机访问」标签页打开时自动开启；用完请点「关闭外网访问」，并只把
链接或二维码分享给信任的人。局域网兜底服务器是只读的（仅 GET/HEAD 静态文件），但
`dsh web` 运行期间同一网络内的设备都能访问；`dsh web` 本身仍只监听回环地址。

### 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.7.0.tgz
dsh web   # 重启以重新加载插件包
```

原地升级会保留受管数据目录，不需要迁移或重写任何数据。`cloudflared` 是可选的：没有安装
时「外网（临时）」区块会提示隧道不可用，局域网区块照常工作。

完整验证命令（含 `/paper-deepread/api/access` 检查与「文献库 → 管理 → 手机访问」步骤）见
[docs/install.md](docs/install.md)。

### 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（`package.json` engines 声明的范围）
- Node.js `>= 24`
- `web` profile
- 可选：`cloudflared`（Cloudflare）用于「外网（临时）」隧道

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

### 许可证

MIT © 2026 HaoKuo
