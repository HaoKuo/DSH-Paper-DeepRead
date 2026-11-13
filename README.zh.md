# DSH-Paper-DeepRead

[English](README.md) | **中文**

DeepSeek Harness（dsh）Web 插件：把 Paper Deepread 文献精读库站点和 `paper-deepread-html`
精读技能打成一个安装包。装上之后侧边栏多一个入口，点开就是交互式论文精读报告与原文 PDF；
插件还提供宿主侧的模型工具，用于检索与阅读论文，以及上传 PDF、维护报告的管理控制台。

## 功能

- **内置书库与侧边栏入口** —— 插件在 `/paper-deepread/index.html` 提供 Paper Deepread
  书库页面，选中侧边栏的 Paper Deepread 即显示；初始内置 4 篇示例报告，也可用 `libraryDir`
  指向已有书库。
- **`paper_deepread` 模型工具** —— 列出论文，按标题/期刊/标签/摘要/全文搜索，返回可本地
  读取的报告或 Web 链接。
- **上传 -> 精读 -> 成稿** —— `paper_deepread_uploads` 把 PDF 收进受管收件箱，
  `paper_deepread_reports` 生成、隐藏或删除报告；插件自身不调用模型。
- **管理控制台** —— 上传 / 报告管理 / 手机访问三个标签页，从书库页头在新标签页打开。
- **手机访问** —— 局域网地址与自动启动的 Cloudflare 临时隧道各带一个二维码。
- **可选的独立站点集成** —— 配置 `siteUrl` 指向运行中的 Paper Deepread 站点后，该站点
  成为手机访问的首选目标。
- **内置技能** —— `paper-deepread-html` 缺失时自动安装，并保持版本同步。
- **无运行时依赖** —— 宿主只导入 Node 内置模块与 `@deepseek-ai/dsh-tools` peer；浏览器
  端是单文件、无依赖。

## 环境要求

- DeepSeek Harness `^0.2.0-rc.2 || ^0.2.1-rc.2 || ^0.2.1-rc.3`（`engines.dsh` 的范围）。
- Node.js `>= 24`。
- `web` profile（插件需要 `webServer` 与 `tools` 服务）。
- 可选：`cloudflared`，用于外网（临时）隧道。

## 安装

安装到 Web profile，可用发布 tarball，也可直接从 GitHub 安装：

```bash
dsh plugin --profile web add ./dsh-paper-deepread-1.7.0.tgz
dsh plugin --profile web add "github:HaoKuo/DSH-Paper-DeepRead#v1.7.0"
```

重启 Web UI 并打开 <http://127.0.0.1:3080>：

```bash
dsh web
```

点击左侧边栏的 **Paper Deepread** 图标。书库也可直接访问
<http://127.0.0.1:3080/paper-deepread/index.html>，管理控制台位于
<http://127.0.0.1:3080/paper-deepread/manage.html>。

- 升级：用同样的 `dsh plugin --profile web add` 命令安装新 tarball 或 GitHub tag，再重启
  `dsh web`。
- 卸载：`dsh plugin --profile web remove dsh-paper-deepread`，再重启 `dsh web`。已复制的
  技能与受管数据目录会保留。

## 使用

1. **浏览书库。** 点侧边栏入口，或直接打开书库地址；每张论文卡片打开一份交互式报告，
   含原文图表裁切、SVG 重绘示意图与未改动的原文 PDF。
2. **上传 PDF。** 在书库页头打开 **管理**（或 **上传**）进入管理控制台，把 PDF 拖到上传
   标签页：单篇上限 80 MB，会校验 `%PDF-` 文件头。也可以直接在对话里让 Agent 调用
   `paper_deepread_uploads`（`list` / `ingest`）与 `paper_deepread_reports`（`build`）
   跑完整流水线。
3. **管理报告。** 在控制台的 **报告管理** 标签页里打开报告或原文 PDF、隐藏/显示、删除
   单篇报告目录，或一键**重建索引**（确定性重建，不需要模型）。
4. **手机访问。** 在控制台的 **手机访问** 标签页里，外网 Cloudflare 临时隧道会自动开启，
   点 **关闭外网访问** 可停止；用同一 Wi-Fi 下的手机扫局域网二维码，或用任意网络扫外网
   二维码——外网地址是公开且临时的。

![文献精读库](docs/screenshot-library.png)

![手机访问](docs/screenshot-access.png)

## 配置

默认无需配置。可选行配置：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `$DSH_HOME/paper-deepread` | 受管书库、上传、work 目录与状态文件。 |
| `libraryDir` | 未设置（使用播种的 `dataDir/library`） | 改为提供已有书库根目录；跳过播种。 |
| `siteUrl` | 未设置（功能关闭） | 运行中的独立 Paper Deepread 站点根地址，例如 `http://127.0.0.1:8080`；同时作为手机访问的首选目标。 |
| `maxUploadBytes` | `83886080`（80 MB） | 单篇上传大小上限。 |
| `cloudflaredPath` | 未设置（自动探测） | 临时隧道使用的 `cloudflared` 可执行文件路径。 |
| `cloudflaredProxy` | 未设置（继承进程环境） | 传给 `cloudflared` 的代理，同时设为 `HTTPS_PROXY` / `HTTP_PROXY`。 |
| `lanPort` | `0`（临时端口） | 只读局域网兜底服务器的优先端口。 |

## 说明

- 书库页自带中文 / English 语言切换；管理控制台界面本身只有中文，因此本文档按功能描述
  控制台控件。
- 临时隧道地址是公开且无身份验证的——任何拿到链接的人都能阅读全部报告与 PDF——并且会随
  隧道或 `dsh web` 重启而变化。只在需要时开启，用完关闭。
- macOS 上 `cloudflared`（Go 程序）会忽略系统代理；在 ClashX 这类代理环境下需设置
  `cloudflaredProxy`，例如 `socks5://127.0.0.1:7890`。
- 完整细节见 [docs/install.md](docs/install.md) 与 [docs/architecture.md](docs/architecture.md)。

## 文档与开发

- [docs/install.md](docs/install.md) —— 安装、验证与上传/报告操作说明。
- [docs/architecture.md](docs/architecture.md) —— 宿主/客户端设计与内部实现。
- [CHANGELOG.md](CHANGELOG.md) 与 [RELEASE_NOTES.md](RELEASE_NOTES.md) —— 发布记录。
- 仓库：<https://github.com/HaoKuo/DSH-Paper-DeepRead>

```bash
npm run check   # 对全部随包 JS 执行 node --check
npm test        # node:test 测试套件
npm run pack    # 生成 dist/dsh-paper-deepread-1.7.0.tgz + dist/SHA256SUMS
```

## 许可证

[MIT](LICENSE) © 2026 HaoKuo
