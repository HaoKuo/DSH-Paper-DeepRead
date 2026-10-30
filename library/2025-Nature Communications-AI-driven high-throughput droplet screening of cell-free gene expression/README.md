# DropAI 论文精读（demo）

《AI-driven high-throughput droplet screening of cell-free gene expression》（Nature Communications, 2025）
的单文件交互式精读报告，也是 `paper-deepread-html` skill 的端到端样例。

- **报告**：`2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.html`
  （5.3 MB，单文件、双击即开、断网可读）
- **打印版**：同名 `.pdf`（19 页 A4，与 HTML 同目录同名）
- **原文 PDF**：`RAW-2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf`
  （报告封面与溯源页内嵌「查看原文」链接）

## 命名规则

目录、HTML、PDF 三者同名，统一按 `<发表年份>-<期刊名>-<文章名>`；原始 PDF 加 `RAW-` 前缀：

```
paper-read/2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression/
├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.html
├── 2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
├── RAW-2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.pdf
├── content.html
├── paper/   (figures.json + 图表裁切 + 原文 text.md)
└── README.md
```

## 报告里有什么

| 内容 | 说明 |
| --- | --- |
| 封面 / 速览 / 关键指标 | 标题、作者、DOI、原文 PDF 查看、一句话结论、4 个核心数字 |
| 结论先行 | 四条主结论 + 证据强度判读表 |
| 问题背景 / 方法拆解 | 论证骨架 + 复现参数表 + **AI 重绘的三段闭环 SVG**（可逐步点选） |
| 逐图精读（Fig. 1–5） | **原文图 PDF 裁切**（带图号/页码/图注溯源）+ 逐面板解读 + 读图注意 |
| 机制重绘 | **FluoreCode 编码/解码 SVG**（4 步可交互） |
| 数据重绘 | 产量/添加剂成本/单位成本 3 组柱状图（数据转录自原文，明确标注） |
| 批判性评估 | 强项 / 存疑 / 薄弱点三栏 + 8 个追问 + 成本口径与统计单元的具体质疑 |
| 与我相关 | 对 DMF / 液滴 / AI 实验平台的 3 条可迁移点 + 1 个可检验假设 |
| 术语表 / 引用 / 溯源附录 | 图表裁切清单、PDF SHA-256、证据分级说明 |

## 图片版权与证据边界

- **原文图**：全部来自 PDF 页面的高分辨率裁切（PyMuPDF 220 dpi），保留原始面板标记与图注；
  图上标「原文 Fig. X · p.N」。
- **SVG 示意图**：基于原文文字/数字的**解释性重绘**，图内明确标「AI 重绘示意图 · 非原文图」或
  「数据转录自原文 · 未重新分析」。数字以原文为准。

## 复现 / 重新生成

```bash
SKILL_DIR=~/.dsh/skills/paper-deepread-html
PY=$(bash "$SKILL_DIR/scripts/setup_env.sh")
PAPER_DIR="paper-read/2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression"

# 1. 摄取 PDF（文字 / 图注 / 裁切 / 调试图）
$PY "$SKILL_DIR/scripts/paper_ingest.py" work/demo/paper.pdf --out "$PAPER_DIR/paper" --debug

# 2. content.html 已在本目录；补全 paper/meta.json 封面字段后组装
python3 "$SKILL_DIR/scripts/build_report.py" \
  --template "$SKILL_DIR/assets/report_template.html" \
  --content "$PAPER_DIR/content.html" \
  --meta "$PAPER_DIR/paper/meta.json" \
  --figures "$PAPER_DIR/paper/figures.json" \
  --fig-base "$PAPER_DIR/paper" \
  --source-pdf work/demo/paper.pdf \
  --out-dir "$PAPER_DIR"

# 3. QA（截图/自检只写临时目录，不随报告分发；打印版 PDF 与 HTML 同名同目录）
$PY "$SKILL_DIR/scripts/qa_report.py" \
  --report "$PAPER_DIR/2025-Nature Communications-AI-driven high-throughput droplet screening of cell-free gene expression.html" \
  --out /tmp/qa-dropai
```

## 在文献库中浏览

`paper-read/index.html` 会把本报告和其它精读报告一起索引：支持全库搜索、主题分类筛选，
并可在页面内直接阅读本报告（无需单独打开 HTML）；阅读器里还能一键切到相关文献。

报告自身新增的阅读工具：右上角「跳转章节…」下拉、章节标题旁折叠按钮（本地记忆，打印自动展开）、
每张原文图卡右上角「原文 p.N ↗」直接跳到 RAW PDF 对应页码；顶栏「Aa」切换阅读/等宽字体；
再次打开会自动恢复到上次阅读位置。
