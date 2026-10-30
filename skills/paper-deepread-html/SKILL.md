---
name: paper-deepread-html
description: 把一篇论文 PDF 深读成单文件、可离线打开的交互式 HTML 精读报告——自动从 PDF 裁切原文关键图表（带页码/图号/图注溯源），并用原生 JS + 内联 SVG 重绘机制图、流程图、对比图与数据图，附批判性评估。Deep-read one paper PDF into a self-contained interactive HTML reading companion that mixes high-fidelity original figure crops with JS/SVG redrawn schematics. Use when the user asks to 精读/解读/拆解一篇文献、生成论文精读报告 HTML、给论文配关键截图和示意图、paper deep read, figure highlights, SVG schematic, literature reading notes, or turn a paper into an interactive HTML report.
---

# Paper Deep-Read → 交互式 HTML 精读报告

把**一篇**论文做成一个 HTML：左边是原文关键图表的真实裁切（证据），右边/下方是 SVG 重绘的
机制、流程、对比示意（解释），再加上逐面板解读、证据账本与批判性评估。产物离线可开、单文件可发、
深浅色可切换、可打印。

**适用**：单篇精读、组会拆解、审稿准备、把一篇 paper 变成可反复查阅的阅读伴侣。
**不适用**：几十篇的系统综述（用 literature-review 类流程）、只看摘要的速览、批量图表搬运。

## 三条不可妥协的原则

1. **原图只裁切，不重画**。所有"原文图"必须是 PDF 页面像素级裁切，并在图上标注图号 + 页码 + 图注。
   SVG 只能作为**解释性重绘**，必须挂显式徽标：「AI 重绘示意图 · 非原文图」或「数据转录自 Fig. X」。
2. **每个判断可溯源**。正文里 `[原文 p.5]`、`[推断]`、`[背景]` 三类标记分明；数字、图号、样本量、
   统计量必须来自原文；不确定就写"原文未报告/不确定"，绝不编造。
3. **示意图服务于解释**，回答"它为什么这样工作/流程怎么走/差别在哪"，不是装饰。每张 SVG 先能说出
   目的句，再动手画。

## 工作流

### Step 0 · 确认输入（能默认就默认，别过度追问）

| 项 | 默认 |
|---|---|
| PDF 路径或 DOI | 必填，一次问清 |
| 报告语言 | 中文正文，术语保留英文原文 |
| 深度 | 精读：逐图逐面板 + 批判性评估 |
| 关注角度 | 论文自身机制与证据；用户提了领域再补"与我相关" |
| 输出目录 | `./paper-read/<发表年份>-<期刊名>-<文章名>/`（目录与产物同名，`--paper-root` 自动创建） |

### Step 1 · 摄取 PDF（文字 + 图注 + 裁切 + 调试图）

```bash
SKILL_DIR="<本 skill 目录>"                       # skill 工具给出的 base directory
PY=$(bash "$SKILL_DIR/scripts/setup_env.sh")      # 解析/安装带 PyMuPDF 的解释器

$PY "$SKILL_DIR/scripts/paper_ingest.py" paper.pdf --out work/paper --debug
```

先看 `work/paper/captions.txt`（全部图注一览），再用 `read_image` 看 `work/paper/debug/contact-sheet.png`
与每张 `debug/figN-overlay.png`。**裁切必须肉眼验收**：只能有图、面板字母和轴标签，不能混入正文、
不能切掉坐标轴或面板。

- 某一图裁切不对：从 overlay 读坐标后 `--bbox "fig3=x0,y0,x1,y1"` 重跑（单位 PDF pt）。
- 只要部分图：`--only fig1,fig3`。表格文字：`tables.md`。全文：`text.md`（按 `<!-- page N -->` 分页）。

### Step 2 · 选"关键截图"（3–8 张，宁少勿滥）

按顺序选：
1. 摘要/主结果 claim 的**直接证据图**；
2. 方法核心的**装置/流程示意**（原文的，不是你画的）；
3. **决定性数据**：剂量响应、对照比较、消融/消融式实验；
4. **机制/模型图**；
5. 必要时一张关键表格。

对每张选定图写一行卡片：`图号 / 页码 / caption 原文 / 它证明哪条 claim / 要重点解读哪些面板`。
不选：装饰图、重复的补充图、只在 Discussion 被顺带提到的图。

### Step 3 · 深读并建证据账本

按 `references/reading-protocol.md` 的五遍法读 `text.md`，边读边填（可直接写成 content.html 的段落）：

- 一句话结论（≤40 字，含关键数字）；
- 研究缺口 → 问题 → 方法 → 关键结果 → 边界；
- **逐图逐面板**：a 面板测什么、横纵轴是什么、关键对比、数值、n、误差棒含义、统计检验；
- 机制解释：作者认为为什么有效？证据链哪一环最弱？
- 批判性评估：对照是否充分、统计是否稳健、结论是否超出数据、能否推广、哪些替代解释没排除；
- （可选）与我相关：对用户方向的可迁移点与待验证假设；
- 术语表：英文 / 中文 / 一句话解释。

规则：原文没写的不要补；转述保持数字原样（含单位、n、P 值、误差类型）；推断句加 [推断]。

### Step 4 · 规划 SVG 示意图（先定目的，再画）

每张 SVG 先写一句目的："让人 30 秒内看懂 DropAI 一次筛选循环怎么闭环"。
从 `assets/svg-components.md` 里挑模板改（workflow / mechanism-steps / comparison / timeline /
device-layout / hierarchy / data-redraw），不要从白纸开始。

- 机制/流程：用编号步骤 + 可点击/键盘逐步高亮（`.is-active`），把静态图变成可讲解的图。
- 数据重绘（柱/线/散点/热图）：数值只能来自原文文字或表格；图下注明
  「数据转录自原文 Fig. X / Table Y，未重新分析」；没有可靠数值就不要做这类图，改用定性示意。
- 对比图：两栏/矩阵，突出差异维度，不要把原文图换个颜色重画一遍。
- 所有 SVG：`viewBox` + `role="img"` + `<title>/<desc>`；颜色用 CSS 变量（深色模式自动适配）；
  文字不溢出（必要时 `<tspan>` 换行）；纯离线（不引外部字体/脚本）。

### Step 5 · 写 `content.html`

只写 `<section>` 块（封面/目录/溯源由 builder 生成）。图卡写法：

```html
<figure class="paper-fig" data-fig="fig2">
  <div class="pf-panels">
    <h4>逐面板解读</h4>
    <ul>
      <li><b>a</b><span><strong>器件布局</strong>：…测什么、怎么读、数值、n…
        <span class="ev" data-ev="p.3 Fig.2a">原文 p.3</span></span></li>
      <li><b>b–c</b><span>…</span></li>
    </ul>
  </div>
  <aside class="callout caveat"><p class="callout-label">读图注意</p><p>…</p></aside>
</figure>
```

规则：每张原文图卡的右上角会自动带「原文 p.N ↗」（直接打开 RAW PDF 对应页）；报告右上角有
「跳转章节…」下拉，每个章节标题旁的折叠按钮可收起长节（状态本地记忆，打印时自动展开）。
图卡里 `<li>` 的第一个 `<b>` 只会被渲染成圆形面板徽标，**其余强调一律用 `<strong>`**；
面板文字要包在 `<span>` 里（否则内联证据 chip 会被拆成网格项）。builder 会注入图上方信息条、
裁切图、缩放按钮与图注引用；你只写图内解读部分。

其他可用组件（由模板样式定义）：`<figure class="tbl">` + `<table class="cmp-table">`、
`<div class="appraisal"><div class="card pro|unc|con">…</div></div>`、`<dl class="glossary">`、
`<ol class="refs">`、`<aside class="callout insight|caveat|method|quote">`。
需要编号热点时，在 `data-fig` 图卡内放 `<template data-hotspots>` 包住一段
`<svg class="pf-hotspots" aria-hidden="true">`（**不要 viewBox**），builder 会把它移进图片容器。
热点坐标用百分比（相对图片显示框），结构：

```html
<template data-hotspots>
<svg class="pf-hotspots" aria-hidden="true">
  <g class="hs" tabindex="0" role="button" data-tip="悬停说明" data-tip-kicker="原文 Fig. 2a · p.4">
    <circle class="hs-halo" cx="26%" cy="17%" r="19"/>
    <circle class="hs-dot" cx="26%" cy="17%" r="13"/>
    <text class="hs-num" x="26%" y="17%">1</text>
  </g>
</svg>
</template>
```

热点只标 2–4 个"读者会走错"的位置（装置、编码、关键数据），不要给每个面板都打点。

默认结构（可裁剪，但不要省掉"批判性评估"和"证据"）：

1. **一句话结论** + 3–5 张关键发现卡（每卡带证据 chip）
2. **研究问题与缺口**：这个领域卡在哪、本文赌的是什么
3. **方法拆解**：一张 SVG 流程图 + 原文装置图 + 可复现参数表
4. **逐图精读**：每图 = 原文裁切 + 图注 + 逐面板 + 读图注意 + takeaway
5. **机制解释**：SVG 机制图（编号步骤、可交互）
6. **数据重绘**（可选）：把关键趋势重画成更易读的图，标注来源
7. **批判性评估**：强项 / 不确定处 / 局限 / 替代解释；用表格或卡片
8. **与我相关**（用户给了领域时）
9. **术语表 + 延伸阅读 + 引用**
10. 证据与溯源（builder 自动生成）

写作要求：先"图在证明什么"，再"怎么看出来的"，最后"哪里可疑"；给数字和对照，不写"显著提升"这类空话；
每节至少一处批判性观察；首次出现的缩写给英文全称。

### Step 6 · 构建单文件

```bash
python3 "$SKILL_DIR/scripts/build_report.py" \
  --template "$SKILL_DIR/assets/report_template.html" \
  --content work/paper/content.html \
  --meta work/paper/meta.json \
  --figures work/paper/figures.json \
  --fig-base work/paper \
  --source-pdf paper.pdf \
  --paper-root paper-read/
```

**产物命名（强制，文件与目录同名）**：目录 `paper-read/<发表年份>-<期刊名>-<文章名>/`，里面放
`<发表年份>-<期刊名>-<文章名>.html`、同名 `.pdf`，以及原文 `RAW-<发表年份>-<期刊名>-<文章名>.pdf`
（`--source-pdf` 自动复制并加 `RAW-` 前缀；报告封面/溯源页与文献库卡片都会生成「查看原文」链接）。例如：

```
paper-read/
└── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression/
    ├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.html
    ├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
    ├── RAW-2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
    ├── content.html
    └── paper/   (figures.json + assets + text.md)
```

`--paper-root` 会自动按 `meta.json` 的 `year` / `journal` / `title` 创建**同名目录**并写入报告；空格保留，
文件系统非法字符（`/ \ : * ? " < > |` 及全角变体）替换为空格/`-`，总长截断到 180 字符；需要覆盖时用
`--name`。`--out-dir` 只写指定目录（目录名不符时会提示），`--out` 显式给带 `.html` 的文件名则以你给的为准。

先补全 `work/paper/meta.json`：摄取只给书目字段，封面还需要 `title_zh`、`tldr`（一句话结论，含关键数字）、
`metrics`（3–4 个 `{value,label,note}`）、`tags`；可选 `corresponding`、`system`、`data_code` 用于「论文速览」。
builder 会：展开 `data-fig` 图卡（注入裁切图 + 溯源行 + 图注）、生成封面/目录/溯源页、把本地图片
base64 内嵌成单文件、注入自检脚本。体积 >25 MB 时用 `--no-inline`（改为 assets 目录交付）或降低
`--dpi/--max-width` 重新裁切。

### Step 7 · 验收（不可跳过）

```bash
$PY "$SKILL_DIR/scripts/qa_report.py" \
  --report "paper-read/<year>-<journal>-<title>/<year>-<journal>-<title>.html" \
  --out /tmp/qa-<slug>
# $PY 来自 setup_env.sh；它带 PyMuPDF，可把打印版 PDF 逐页渲染成临时目录里的 print-pXX.png 供肉眼验收
# 打印版 PDF 写在 HTML 同目录、同 basename（<year>-<journal>-<title>.pdf）；--pdf-out 可覆盖
# QA 产物（截图/qa.json/逐页 PNG）只写临时目录；交付前删掉，报告目录里不要留 qa/
```

它会跑自检脚本、给出 1440 / 390 宽的截图（浅色 + 深色）和打印版 PDF 的逐页 PNG。然后用 `read_image` **亲自看截图**，按
`references/qa-checklist.md` 修：图片是否都加载、有无横向溢出、深浅色对比、图注/溯源是否完整、
SVG 文字是否溢出、打印是否正常。QA 未通过不要交付。

### Step 8 · 交付

必需产物：目录 `<发表年份>-<期刊名>-<文章名>/`，内含
① 同名 `.html`（单文件，双击即开）、② **同名** `.pdf`（报告打印版）、
③ `RAW-<同名>.pdf`（论文原文，供查看）。
可选：`paper/`（figures.json + assets + text.md）、`content.html`（可复用源稿）、`README.md`（仅作说明，
不在报告页与文献库里显示，**不要**放 `qa/` 等 QA 产物）。
交付时用一句话说明边界：**原文图=PDF 裁切，SVG=AI 解释性重绘，数字以原文为准**。

### Step 9 · 可选：把所有报告组织成"文献库"（自动归类 + 全库搜索）

单篇报告攒多了以后，跑一次库构建即可得到一个离线可搜的总目录（不移动任何单篇目录，链接稳定）：

```bash
$PY "$SKILL_DIR/scripts/build_library.py" --root paper-read/ --title "文献精读库"
# → paper-read/index.html  （单文件：卡片墙 + 分类视图 + 全库搜索）
# → paper-read/index.md    （Markdown 版，便于 git/编辑器浏览）
```

库页顶栏/页脚会显示**品牌 logo**（程控数芯；浅色模式深蓝、深色模式近白）与**版本号**。版本号用 `--version`
指定（默认取脚本里的 `LIBRARY_VERSION`，当前 `1.2.0`），同时写入 `<meta name="library-version">` 与浏览器标签页标题：

```bash
$PY "$SKILL_DIR/scripts/build_library.py" --root paper-read/ --title "文献精读库" --version 1.3.0
```

- **自动扫描**：遍历 `paper-read/*/`，从报告内嵌的 `report-meta` 提取标题/中文标题/年份/期刊/作者/
  tags/TLDR/指标/图表数/证据数，并抽取正文分节文本做全文索引、提取首图生成封面缩略图。
- **自动归类**：内置关键词分类表（液滴微流控 / 数字微流控 DMF / 单细胞与组学 / AI 与机器学习 /
  蛋白质与抗体工程 / 无细胞与合成生物学 / 药物发现与诊断 / 检测与传感），按标题+tags+TLDR+正文打分取
  Top 1–3。两种人工修正方式（不改报告本体）：
  ① 在单篇目录放 `library.json`，覆盖字段 `categories` / `tags` / `title` / `title_zh` / `journal` /
  `year` / `authors` / `metrics`，或 `"hidden": true` 从库中隐藏；
  ② 用 `--categories my_taxonomy.json` 扩展/覆盖全局关键词表。
- **搜索**：输入即搜（中文子串直接可用），命中标题/标签/TLDR/作者与正文；结果给出带高亮的片段，
  点击片段跳到报告对应章节。支持按分类 / 年份 / 期刊 / 标签筛选与排序。
- **库内阅读**：点卡片即可在页面内嵌的阅读器里直接看报告（不用单独打开 HTML），工具栏可跳到原文
  原文 PDF 查看、在新标签打开、上一篇/下一篇。
- **规模控制**：>100 篇用 `--max-text-per-paper 60000 --thumb-width 280`；>300 篇建议按年份或主题
  分子目录分别建库（`--root paper-read/2024 --out paper-read/2024/index.html`）。
- **增量维护**：每新增一篇报告，重跑一次上面的命令即可刷新 `index.html` / `index.md`。
- **实时模式（可选，适合边写边看）**：静态 `index.html` 是浏览器里的快照，`file://` 无法扫描本地目录，
  所以才需要"重跑"。若想要页面里的**刷新按钮/自动发现新报告**，起一个本地服务即可：

  ```bash
  $PY "$SKILL_DIR/scripts/serve_library.py" --root paper-read/ --port 8765 --open
  # 打开 http://127.0.0.1:8765/ ：右上角「刷新」+ 每 20s 自动检测新报告
  ```

  服务端在每次刷新时按目录 mtime 重新扫描（不重建静态 index.html）；Ctrl+C 停止。

## 红线

- 不把 AI 生成的图说成原文图；不把重绘数据说成原始数据。
- 不编造图号、页码、DOI、样本量、P 值、误差棒类型。
- 不把"作者的解释"写成"事实"；不把"我的推断"写进作者的结论。
- 不引入任何在线资源（字体/CDN/图床）；报告必须断网可读。
- 390 px 宽不横向滚动；图表在深色模式下仍可读。
- 产物**目录与文件**都必须按 `<发表年份>-<期刊名>-<文章名>` 命名（目录、HTML、PDF 三者同名），
  原文 PDF 用 `RAW-` 前缀；不要用 `report.html`、`<slug>/` 这类泛名。
- 报告目录里必须带原文 `RAW-*.pdf`（报告封面/溯源页与文献库卡片给出「查看原文」链接）。
- 交付目录不留 `qa/`；QA 截图与逐页图写到临时目录，验收后删除。

## 故障排除

| 症状 | 处理 |
|---|---|
| `setup_env.sh` 下载慢/失败 | 手动建 venv 后用国内镜像：`pip install -i https://pypi.tuna.tsinghua.edu.cn/simple pymupdf`；再 `export PAPER_READ_PY=<venv>/bin/python` |
| 裁切带正文 / 缺面板 / 切到下一页 | 看 `debug/figN-overlay.png` 读坐标 → `--bbox` 覆盖；跨页图只能取一页时在报告里注明 |
| 矢量图（matplotlib）检测不到区域 | 先 `--list` 确认 caption 抓到；再用 `--bbox` 手动框；把 caption 行当下边界 |
| 报告太大 | `--no-inline`，或 `paper_ingest.py --dpi 180 --max-width 1200` 重新裁切 |
| QA 报横向溢出 | 常见于宽表：给表格容器 `overflow-x:auto`；SVG 用 `max-width:100%;height:auto` |
| 深色模式图看不清 | 图卡容器用中性浅底（`#f6f7f9`），不要透明贴深色背景 |
| 等宽字体下中文不齐 | 当前字体栈是 mono 优先（Latin/数字等宽）；中文需装 Sarasa Mono SC / Noto Sans Mono CJK 才会真正等宽，否则回退 PingFang |

## 文件

- `scripts/paper_ingest.py` — PDF 摄取：图注检测 → 图区定位 → 高 DPI 裁切 → 调试图
- `scripts/build_report.py` — 组装单文件报告（封面/目录/图卡/溯源/内嵌图片/自检注入，自动按年份-期刊-标题命名）
- `scripts/qa_report.py` — headless Chrome 自检 + 截图
- `scripts/build_library.py` — 多篇报告的文献库索引（自动归类 + 全库搜索 + 封面缩略图 + 版本号/品牌页头）
- `scripts/serve_library.py` — 本地实时文献库（/api/library + 刷新按钮/自动检测，stdlib 单文件）
- `scripts/setup_env.sh` — 解析带 PyMuPDF 的解释器
- `assets/report_template.html` — 报告外壳（样式 + 交互：缩放灯箱、滚动目录、深浅色、字体切换 Aa、恢复上次阅读位置、章节跳转/折叠、SVG 步骤/提示）
- `assets/svg-components.md` — 可复制粘贴的 SVG 组件库（流程图/机制/对比/时间线/数据重绘）
- `assets/library_template.html` — 文献库页外壳（搜索 / 筛选 / 列表与密度 / quick-peek / 页内阅读器 / 阅读状态与相关文献 / 字体与深浅色 / 实时刷新）
- `references/reading-protocol.md` — 五遍深读法、面板解读清单、批判性评估框架
- `references/figure-extraction.md` — 裁切原理、手动 bbox 修法、各类版式的坑
- `references/qa-checklist.md` — 交付前检查清单
