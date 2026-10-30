# 文献精读库（paper-read）

这里存放 `paper-deepread-html` skill 生成的所有论文精读报告。每篇一个目录，**目录名、报告 HTML、报告 PDF
三者同名**（`<发表年份>-<期刊名>-<文章名>`），原始论文 PDF 加 `RAW-` 前缀放在同一目录：

```
paper-read/
├── index.html                    ← 打开它：文献库（卡片/表格 + 全库搜索 + 页内阅读）
├── index.md                      ← 自动生成的 Markdown 索引（按主题分组）
├── README.md                     ← 本说明（不在库页面里显示）
├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression/
│   ├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.html
│   ├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
│   ├── RAW-2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
│   ├── content.html
│   ├── paper/                    ← figures.json + 图表裁切 + 原文 text.md
│   └── README.md
├── 2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement/
│   └── …
└── 2026-bioRxiv-Compression Sequencing enables ultra-sensitive and scalable scRNA-seq/
    └── …
```

## 怎么用

- **日常查阅**：浏览器打开 `index.html`。点卡片或「阅读」直接在页面内嵌阅读器看报告（不用单独打开 HTML）；
  阅读器工具栏可**查看原文 RAW PDF**、在新标签打开、切换上一篇/下一篇。
- **检索**：搜索标题、中文标题、作者、标签、摘要与**全文章节**；命中片段点击后跳到报告对应章节（库内打开）。
  可按主题分类、年份、期刊、标签筛选；支持卡片 / 表格视图、浅色深色。
- **阅读状态（本地）**：自动记录已读与最近打开，顶部「继续阅读」回到上次那篇；卡片可星标，
  侧栏可筛「仅看星标 / 仅看未读」，排序支持「最近阅读」；数据只存在浏览器 localStorage。
- **相关文献**：阅读器工具栏「相关 N」按共享主题/标签推荐库内论文，点一下在同一阅读器切换。
- **视图与密度**：工具栏可切「卡片 / 表格 / 列表」和「舒适 / 紧凑」；桌面端悬停卡片有 quick-peek
  （完整标题/摘要/标签/操作），不用打开报告即可速览。
- **字体**：顶栏「Aa」在可读中文字体 / 全等宽之间切换（本地记忆）；移动端 ≤760px 有底部 tab
  （库/未读/星标/继续），阅读器工具栏自动收成两行。
- **报告内的新工具**：原文图卡右上角「原文 p.N ↗」直接跳 PDF 页码；右上角「跳转章节…」下拉；
  章节标题旁折叠按钮收起长节（打印时自动展开）；「Aa」切换阅读/等宽字体；再次打开时自动恢复上次阅读位置。
- **原文入口**：每篇报告封面与「溯源附录」都有原文 PDF 的**查看**链接；库里每张卡片与阅读器工具栏也有入口。
- 页内阅读器是 `file://` iframe：若浏览器/企业策略阻止本地 iframe，工具栏的「在新标签打开」始终可用；
  焦点进入 iframe 后 Esc 不再传到库页面，用左上角「返回文库」关闭。

## 版本与品牌

- **版本号**：`index.html` 顶栏标题右侧、页脚、浏览器标签页标题都显示当前文献库版本（现为 `v1.2.0`），
  同时写入 `<meta name="library-version">`，便于脚本核对。版本号由构建参数控制，不用改模板：

  ```bash
  $PY "$S/scripts/build_library.py" --root paper-read/ --title "文献精读库" --version 1.2.0
  ```

  默认值在 `scripts/build_library.py` 的 `LIBRARY_VERSION`；内容或版式有变化时递增即可。
- **品牌**：左上角是文献库品牌 logo（矢量内联，无外部依赖）——浅色模式用深蓝（`#0d2b44`），
  深色模式用近白（`#f2f5f7`）；页脚同步显示「文献精读库 + 版本徽标」。
- **版本记录**（此前页面不显示版本号，从 v1.2.0 起开始展示）：

  | 版本 | 变更 |
  |---|---|
  | v1.2.0 | 换用新版品牌 logo（明暗双色）、index 展示版本号、页头/页脚与响应式排版联动优化 |
  | v1.1.0 | 收录 Compression Sequencing 精读报告（第 3 篇） |
  | v1.0.0 | 文献库首版（2 篇） |

## 新增文献后，index 怎么更新？

**不会自动更新**：`index.html` 是构建时的静态快照。两种方式：

- **A. 静态快照（适合分享/归档）**：重跑一次
  `$PY "$S/scripts/build_library.py" --root paper-read/ --title "文献精读库"`，然后刷新浏览器。
- **B. 本地实时模式（适合边生成边看）**：

  ```bash
  $PY "$S/scripts/serve_library.py" --root paper-read/ --port 8765 --open
  # → http://127.0.0.1:8765/ ，页面右上角有「刷新」按钮，并每 20s 自动检测新文献
  ```

  服务端按目录 mtime 扫描（报告/RAW 增删都会发现），不需要重建 `index.html`；Ctrl+C 停止。
  `file://` 打不开扫描能力（浏览器安全限制），所以静态文件模式只能靠重跑命令。

## 新增一篇报告

```bash
S=~/.dsh/skills/paper-deepread-html
PY=$(bash "$S/scripts/setup_env.sh")

# 1. PDF → 文字/图注/裁切
$PY "$S/scripts/paper_ingest.py" <paper.pdf> --out work/paper --debug
# 2. 写 content.html、补全 meta.json 后构建（--source-pdf 会把原文复制成 RAW-<同名>.pdf）
python3 "$S/scripts/build_report.py" ... --source-pdf <paper.pdf> --paper-root paper-read/
# 3. QA：截图/逐页图只写临时目录，验收后删除，不放进报告目录
$PY "$S/scripts/qa_report.py" --report "<报告.html>" --out /tmp/qa-<slug>
# 4. 重建文献库索引
$PY "$S/scripts/build_library.py" --root paper-read/ --title "文献精读库"
```

## 自动归类与人工修正

库构建时按 **标题 + tags + TLDR + 正文关键词** 自动打主题标签（内置：液滴微流控 / 数字微流控 DMF /
单细胞与组学 / AI 与机器学习 / 蛋白质与抗体工程 / 无细胞与合成生物学 / 药物发现与诊断 / 检测与传感）。
两种修正方式（都不用改报告本体）：

- 单篇目录放 `library.json`：`{"categories": ["液滴微流控"], "tags": ["..."], "hidden": false}`，
  支持字段 `categories / tags / title / title_zh / journal / year / authors / metrics / hidden`；
- `build_library.py --categories my_taxonomy.json` 扩展/覆盖全局词表。

## 说明

- `index.html` 是**自包含单文件**（离线可开、无外部依赖），可直接发给同事；`index.md` 适合放进 git。
- 单篇目录**不要改名或移动**：库链接与报告内命名依赖 `<年份>-<期刊名>-<文章名>`。
- 报告目录里不要放 `qa/`：QA 截图和打印逐页图只在临时目录；交付物是 `.html` + `.pdf` + `RAW-*.pdf`。
- 报告多到上百篇时，可用 `--max-text-per-paper 60000 --thumb-width 280` 控制索引体积；
  缩略图会缓存到 `.library-cache/thumbs`（可随时删除，重建时自动生成）。
