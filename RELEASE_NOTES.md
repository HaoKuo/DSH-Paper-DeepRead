# DSH-Paper-DeepRead 1.6.2

Release date: 2026-11-13

**English** | [中文](#中文)

## What changed

This release adds **手机访问 (mobile access)**: scan a QR code and read the 文献精读库 on a
phone, without installing anything on the phone.

- **Simplified 手机访问 modal (1.6.2)** — the entry is now a card on the 报告管理 tab. The
  modal has no candidate tab row: it shows two blocks (外网（临时） and the first LAN address,
  no loopback/Bonjour entries), each with URL, copy button and QR code. The external tunnel
  is started automatically when the modal opens (default-on) and can be stopped with
  关闭外网访问. Security caveat unchanged: the tunnel URL is public and unauthenticated.
- **Single-row panel header (1.6.1 UI polish)** — the plugin chrome is one 44 px tab row
  now: 刷新, 在新标签页打开 and 手机访问 sit together in the right-side action cluster, the
  separate library toolbar row and the duplicated `N 篇 · vX` meta line are gone, and the
  library version moved into the 文献库 tab's tooltip. No host-side or API changes.
- **手机访问 card and modal** — the 报告管理 tab has a **手机访问** card that opens a modal
  with two blocks: 外网（临时） (auto-started Cloudflare quick tunnel) and 局域网 · `<IP>`
  (the first non-loopback IPv4 address). Each block shows a copyable URL and a locally
  rendered, scannable SVG QR code, and **连不上？刷新链接** re-probes/rebuilds the address.
- **The phone target** — a phone cannot open `dsh web` itself, which stays loopback-bound on
  `127.0.0.1:3080`. With `siteUrl` configured the modal targets the standalone 文献精读库
  site; without it the plugin starts a lazy, read-only LAN static server for its managed
  library (`lanPort` pins the port, the chosen port is remembered). Only when neither is
  available does the modal fall back to the DSH Web page with a hint that it works on this
  machine only.
- **Optional Cloudflare quick tunnel** — the 外网（临时） tab can start a temporary public URL
  through `cloudflared`, opt-in on every button press: nothing is spawned on page load or on
  plugin activation. The binary is auto-detected from the `cloudflaredPath` config, the
  `CLOUDFLARED_BIN` environment variable, the Homebrew locations and `PATH`. The quick-tunnel
  URL is temporary and changes whenever the tunnel or `dsh web` restarts.
- **Proxy escape hatch for cloudflared (`cloudflaredProxy`)** — cloudflared is a Go program
  and ignores the macOS system proxy, so behind a proxy such as ClashX quick-tunnel creation
  can fail with a `failed to request quick Tunnel` error (`context deadline exceeded` or
  `connection reset`). The new optional `cloudflaredProxy` config is forwarded to the child
  as `HTTPS_PROXY`/`HTTP_PROXY`; `socks5://127.0.0.1:7890` works on this machine, while
  routing the quick-tunnel API through a plain HTTP proxy is flakier. A failed start shows
  外网（异常） with cloudflared's trimmed message (never a dead QR code), and
  **连不上？刷新链接** retries.
- **New HTTP API** — `GET /paper-deepread/api/access` returns the payload the modal renders
  (target, local URL, LAN/Bonjour candidates with reachability and QR SVGs, tunnel state,
  hints); `POST /paper-deepread/api/access/tunnel` starts, stops, or refreshes the tunnel.
  The tunnel URL is accepted only after cloudflared's `quick Tunnel has been created` banner
  and only for multi-word `*.trycloudflare.com` hostnames, so an API endpoint from an error
  message never appears as the tunnel address.
- **No model-tool API changes** — `paper_deepread`, `paper_deepread_uploads` and
  `paper_deepread_reports` keep their parameters and behaviour. **No data migration** — the
  existing managed data directory, uploads, reports and skill state are reused as-is; only
  two disposable state files (`lan-server.json`, `tunnel.json`) are added.
- No new npm dependencies and no build step: the QR encoder is a small stdlib-only module.

## Security note

The quick tunnel publishes the library to the public internet **without authentication**:
anyone who has the URL can read every report and PDF. Enable it only when you need it, share
the link or QR code only with people you trust, and close the tunnel when you are done. The
LAN fallback server is read-only (GET/HEAD static files only; its API and upload requests are
not served), but it is reachable by any device on the same network for as long as `dsh web`
runs.

## Troubleshooting the tunnel

If 开启外网访问（临时） ends in 外网（异常） with a `failed to request quick Tunnel ...`
message, cloudflared could not reach Cloudflare. On macOS it ignores the system proxy: set
`cloudflaredProxy` to the proxy your system uses (`socks5://127.0.0.1:7890` works with
ClashX) and press **连不上？刷新链接** to rebuild the tunnel with a new address. The URL only
appears after cloudflared prints its `quick Tunnel has been created` banner; when
`cloudflared` is not installed at all, the tab reports that the tunnel is unavailable and the
本机 / 局域网 tabs keep working.

## Install / upgrade

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.6.2.tgz
dsh web   # restart to reload the plugin package
```

Upgrading in place keeps the managed data directory; nothing is migrated or rewritten.
`cloudflared` is optional: without it the 外网（临时） tab reports that the tunnel is
unavailable and the 本机 / 局域网 tabs keep working.

See [docs/install.md](docs/install.md) for verification commands, including the new
`/paper-deepread/api/access` check and the 手机访问 walkthrough.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3` (the engine range declared in `package.json`)
- Node.js `>= 24`
- The `web` profile
- Optional: `cloudflared` (Cloudflare) for the 外网（临时） quick tunnel

The SHA-256 of the tarball is listed in `SHA256SUMS` on this release.

## License

MIT © 2026 HaoKuo

## 中文

**DSH-Paper-DeepRead 1.6.0** · 发布日期：2026-11-13

### 变更内容

本次新增 **手机访问**：扫码即可在手机上阅读文献精读库，手机端无需安装任何东西。

- **手机访问弹窗简化（1.6.2）** —— 入口移到「报告管理」标签页的卡片；弹窗取消候选地址标签行，
  改为两个区块（外网（临时）与本机第一个局域网地址，不再显示回环/Bonjour 条目），各自带
  URL、复制按钮和二维码；外网隧道在弹窗打开时**默认自动开启**，可点「关闭外网访问」停止。
  安全提示不变：外网链接公开、无鉴权。
- **单行面板头部（1.6.1 UI 优化）** —— 插件自有的顶部界面合并成一行 44 px 标签栏：
  「刷新」「在新标签页打开」「手机访问」收进右侧动作区，独立的书库工具栏行与重复的
  `N 篇 · vX` 元数据行已删除，书库版本号移入「文献库」标签的 tooltip。宿主端与 API 无改动。
- **手机访问卡片与弹窗** —— 「报告管理」标签页里的 **手机访问** 卡片点开后是左右两个区块：
  **外网（临时）**（自动开启的 Cloudflare 临时隧道）和 **局域网 · `<IP>`**（本机第一个
  非回环 IPv4 地址）。每个区块都有可复制的 URL 和本地生成的可扫描 SVG 二维码；
  **连不上？刷新链接** 会重新探测/重建地址。
- **手机打开的目标** —— 手机无法直接打开 `dsh web` 本身（它只监听 `127.0.0.1:3080`）。
  配置 `siteUrl` 时目标是独立的文献精读库站点；未配置时插件懒启动一个只读的局域网静态
  服务器来提供受管书库（可用 `lanPort` 固定端口，实际端口会被记住）。两者都不可用时，
  弹窗才退回 DSH Web 页面并提示该地址只在当前电脑可用。
- **可选的 Cloudflare 临时隧道** —— 「外网（临时）」标签页每次点击才开启临时公网地址；
  隧道子进程不会在页面加载或插件激活时启动。`cloudflared` 的查找顺序为
  `cloudflaredPath` 配置 → `CLOUDFLARED_BIN` 环境变量 → Homebrew 安装位置 → `PATH`。
  临时隧道地址在隧道或 `dsh web` 重启后会变化。
- **cloudflared 代理开关（`cloudflaredProxy`）** —— cloudflared 是 Go 程序，会忽略 macOS
  系统代理，因此在 ClashX 这类代理环境下建立临时隧道可能失败，报
  `failed to request quick Tunnel ... context deadline exceeded` / `connection reset`。
  新增的可选配置 `cloudflaredProxy` 会作为 `HTTPS_PROXY`/`HTTP_PROXY` 传给子进程；
  本机可用 `socks5://127.0.0.1:7890`，而经普通 HTTP 代理转发隧道 API 请求不稳定。
  建立失败时标签页显示 **外网（异常）** 与精简后的 cloudflared 报错（不会给出一个打不开
  的二维码），**连不上？刷新链接** 会重试。
- **新增 HTTP API** —— `GET /paper-deepread/api/access` 返回弹窗渲染的完整载荷（目标、
  本机地址、局域网/Bonjour 候选及其可达性与二维码 SVG、隧道状态、提示）；
  `POST /paper-deepread/api/access/tunnel` 负责开启、关闭与刷新隧道。隧道 URL 只在
  cloudflared 输出 `quick Tunnel has been created` 横幅之后、且为带连字符的多词
  `*.trycloudflare.com` 主机名时才被接受，因此错误信息里的 API 地址永远不会被当成隧道地址。
- **模型工具 API 未变** —— `paper_deepread`、`paper_deepread_uploads` 与
  `paper_deepread_reports` 的参数与行为完全不变。**无需数据迁移**：已有受管数据目录、
  上传、报告与技能状态原样沿用，只新增两个可丢弃的状态文件（`lan-server.json`、
  `tunnel.json`）。
- 没有新增 npm 依赖，也没有构建步骤：二维码编码器是仅用标准库的小模块。

### 安全提示

临时隧道会把书库发布到公网且**没有身份验证**：任何拿到链接的人都能阅读全部报告与 PDF。
请只在需要时开启，只把链接或二维码分享给信任的人，用完立即关闭。局域网兜底服务器是只读的
（仅 GET/HEAD 静态文件，其 API 与上传请求不会被处理），但 `dsh web` 运行期间同一网络内的
设备都能访问。

### 故障排查

如果「开启外网访问（临时）」最后停在 **外网（异常）** 并显示
`failed to request quick Tunnel ...`，说明 cloudflared 连不上 Cloudflare。macOS 上它会
忽略系统代理：把 `cloudflaredProxy` 设为系统使用的代理（ClashX 可用
`socks5://127.0.0.1:7890`），然后点 **连不上？刷新链接** 重建隧道并换新地址。隧道 URL
只在 cloudflared 输出 `quick Tunnel has been created` 横幅后才会出现；完全没有安装
`cloudflared` 时，标签页会提示隧道不可用，本机与局域网标签页照常工作。

### 安装 / 升级

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.6.2.tgz
dsh web   # 重启以重新加载插件包
```

原地升级会保留受管数据目录，不需要迁移或重写任何数据。`cloudflared` 是可选的：没有安装
时「外网（临时）」标签页会提示隧道不可用，本机与局域网标签页照常工作。

完整验证命令（含新增的 `/paper-deepread/api/access` 检查与手机访问步骤）见
[docs/install.md](docs/install.md)。

### 兼容性

- DeepSeek Harness `0.2.0-rc.2` – `0.2.1-rc.3`（`package.json` engines 声明的范围）
- Node.js `>= 24`
- `web` profile
- 可选：`cloudflared`（Cloudflare）用于「外网（临时）」隧道

tarball 的 SHA-256 见本 release 的 `SHA256SUMS`。

### 许可证

MIT © 2026 HaoKuo
