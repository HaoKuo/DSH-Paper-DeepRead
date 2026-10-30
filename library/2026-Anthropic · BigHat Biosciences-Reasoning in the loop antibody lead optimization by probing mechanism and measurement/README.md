# 论文精读：Reasoning in the loop（Anthropic × BigHat Biosciences, 2026）

把 31 页的原始 PDF 深读成一份**单文件、离线可开**的交互式 HTML 精读报告。

- **原文**：Stanton, S. et al., *Reasoning in the loop: antibody lead optimization by probing mechanism
  and measurement*. Anthropic / BigHat Biosciences 技术报告（未同行评审），31 页。通讯作者
  <samuelstanton@anthropic.com>。
- **报告**：`2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.html`
  （1.96 MB，9 张原文图表裁切 + 3 张 AI 重绘示意图 / 3 张数据重绘 + 4 张对照表，双击即开、断网可读）
- **打印版**：同名 `.pdf`（32 页 A4，与 HTML 同目录同名）
- **原文 PDF**：`RAW-2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.pdf`
  （报告封面与溯源页内嵌「查看原文」链接）

## 命名规则

目录、HTML、PDF 三者同名，统一按 `<发表年份>-<期刊名>-<文章名>`；原始 PDF 加 `RAW-` 前缀：

```
paper-read/2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement/
├── 2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.html
├── 2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.pdf
├── RAW-2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.pdf
└── README.md
```

## 这份报告回答什么

原文的核心不是"AI 设计了更好的抗体"，而是**把闭环优化的"指标"本身当成假设来检验**：
两个抗体优化战役（抗白蛋白 VHH / 抗间皮素 scFv，7 轮、1,232 个设计孔）里，团队 + Claude
发现软件报出的两个"热稳定性指标"在各自 scaffold 上都名不副实，于是回到原始曲线建物理模型、
换指标、用预注册的浓度/升温速率扰动去证伪，最后两个 lead 全面超过亲本。

报告按 13 节展开：

| 节 | 内容 |
| --- | --- |
| 01 结论先行 | 一句话结论 + 5 条主结论的证据强度判读表 |
| 02 问题 | 闭环优化的是"标签"不是分子；仪器/分析/指标的链条；Fig. 1 逐面板 |
| 03 战役设置 | 平台、轮次、日程、原始/修订规格；可复现参数表；**AI 重绘的闭环+指标审计流程图** |
| 04 设计库 | 谱系先验、化学问题式扫描、模块组合；Walsh 回归与布尔格子；Fig. 3（含 4 个热点） |
| 05 诊断 | 跨轮可迁移性作为错配探针；Fig. 2、Fig. D2；**"该报告什么"判定树** |
| 06 物理模型 | 式 1–5 的逐条解读；Fig. 4；**两 scaffold 机制对照图**；作者自拆的 5 处局限 |
| 07 判决性检验 | 预注册扰动实验；11 行记分卡（含 3 条失败与日效应混淆）；Fig. 5 |
| 08 结果 | 两个 lead 与原/修订规格对照；前沿而非排序；Fig. 6 |
| 09 专门模型 vs 推理 | 模型族判决登记表；Fig. F1；"格子样本内失序"的含义 |
| 10 批判性评估 | 强项 / 不确定 / 薄弱点三栏 + 3 个必须自己回答的问题 |
| 11 与我相关 | 指标审计五问、预注册最小模板、少孔多突变因子设计、一个可检验假设 |
| 12 术语表 | 17 个术语的中英对照与一句话解释 |
| 13 引用与延伸 | 10 条延伸阅读 + 原文最值得记住的两句 |

## 证据边界（重要）

- **原文图**：全部是 PDF 页面的像素级裁切（PyMuPDF 220 dpi；Table 1 为矢量区重裁），
  图卡上方标注 `原文 Fig. X · p.N · 裁切尺寸`，并逐字引用原图注。
- **SVG 示意图**：基于原文文字与数字的**解释性重绘**，图内明确标「AI 重绘示意图 · 非原文图」
  或「曲线为定性示意」。机制图的曲线形状为示意，标注数字转录自原文 p.7。
- **数字**：全部转录自原文（正文 / 表 1 / 附录 H），没有重新分析；正文里 39 处
  `原文 p.N` / `Table X` 证据 chip 可点击回跳。**推断**用 `[推断]`、文献背景用 `[背景]` 标出。
- 原文没有标注期刊、DOI 或投稿/接收日期，本报告按"2026 年技术报告"引用，不虚构出处。

## 复现 / 重新生成

```bash
SKILL_DIR=~/.dsh/skills/paper-deepread-html
PY=$(bash "$SKILL_DIR/scripts/setup_env.sh")
PAPER_DIR="paper-read/2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement"

# 1. 摄取 PDF（文字 / 图注 / 高 DPI 裁切 / 调试图）
$PY "$SKILL_DIR/scripts/paper_ingest.py" <paper.pdf> --out work/paper --debug

# 2. 写 work/paper/content.html（由 part1–3 拼接）并补全 meta.json 封面字段
cat work/paper/part1.html work/paper/part2.html work/paper/part3.html > work/paper/content.html

# 3. 组装单文件（目录/报告同名；--source-pdf 会把原文复制成 RAW-<同名>.pdf）
$PY "$SKILL_DIR/scripts/build_report.py" \
  --template "$SKILL_DIR/assets/report_template.html" \
  --content work/paper/content.html --meta work/paper/meta.json \
  --figures work/paper/figures.json --fig-base work/paper \
  --source-pdf <paper.pdf> \
  --paper-root paper-read/

# 4. QA：自检 + 截图 + 打印版（同名 .pdf 写在 HTML 同目录；截图只写临时目录，不随报告分发）
$PY "$SKILL_DIR/scripts/qa_report.py" \
  --report "$PAPER_DIR/2026-Anthropic · BigHat Biosciences-Reasoning in the loop antibody lead optimization by probing mechanism and measurement.html" \
  --out /tmp/qa-bighat
```

## 自检结果

构建期 QA（临时目录，不随报告分发）：无外部资源引用、无占位符残留、图片 15/15 加载、
横向溢出 0、9/9 图卡、13 个 section、39 处证据 chip、打印 32 页。

## 在文献库中浏览

`paper-read/index.html` 会把本报告和其它精读报告一起索引：支持全库搜索、主题分类筛选，
并可在页面内直接阅读本报告（无需单独打开 HTML）；阅读器里还能一键切到相关文献。

报告自身新增的阅读工具：右上角「跳转章节…」下拉、章节标题旁折叠按钮（本地记忆，打印自动展开）、
每张原文图卡右上角「原文 p.N ↗」直接跳到 RAW PDF 对应页码；顶栏「Aa」切换阅读/等宽字体；
再次打开会自动恢复到上次阅读位置。
