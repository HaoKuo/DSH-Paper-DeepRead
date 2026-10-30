# 论文精读：用无细胞合成快速制备 GPCR–纳米盘复合物并解出冷冻电镜结构

- **原文**：Guilliam, T. A., Jakimowicz, A. K., Manni, M. M., Gaber, Z. B., Paris, G., Hardwick, S. W.,
  Cooper, L., Chirgadze, D. Y., & Ost, T. W. B. *Rapid Production and Cryo-EM Structure Determination of
  GPCR-Nanodisc Complexes via Cell-Free Synthesis*. bioRxiv (2026-10-23), 29 页，未同行评审。
  doi:[10.64898/2026.10.21.760646](https://doi.org/10.64898/2026.10.21.760646)
- **产物**：同名 `.html`（3.4 MB，单文件离线可开）、同名 `.pdf`（20 页打印版）、`RAW-*.pdf`（原文）
- **单位**：Nuclera Ltd（英国 Cambridge，通讯作者 tguilliam@nuclera.com）· 剑桥大学生化系

## 这篇论文讲了什么

把"GPCR 冷冻电镜结构"的整条产线搬进无细胞体系：**PURE 体系表达 + 共翻译插入脂质纳米盘 +
ICL3 上的 β-内酰胺酶刚性基准模块（配 BLIP-II 加质量）+ 数字微流控纳升级筛选**，四天内从
基因组装走到电镜上样，得到拮抗剂结合的 A<sub>2A</sub>R 复合物 **3.38 Å** 结构（47,986 颗粒），
并把流程扩到 **12 个** Class A/B/C 与孤儿受体，全部以 FSEC 质量达标。

一句话判读：**这是一篇"产线可行性"论文，价值在流程而不在结构**——它没有揭示新构象或新机制，
但把三个既有技术串成了一条四天闭合、可复制的流水线。

## 报告结构（10 节）

| 节 | 内容 |
|---|---|
| 01 结论先行 | 一句话结论、4 个指标卡、五条主张的证据强度判读表 |
| 02 问题 | GPCR 电镜的三重瓶颈（小/软/慢）与三条既有路线；本文的组合赌注 |
| 03 筛选 | Fig. 1 逐面板；**AI 重绘的四天流程图**；可复现参数表（货号/缓冲液/上样参数） |
| 04 放大与验证 | Fig. 2；复合物形成的正反对照；聚集体占荧光 35–36% 的含义 |
| 05 结构 | Fig. 3；**刚性基准模块机制图**；电镜数据与建模统计表（含"未报告"清单）；颗粒数与分辨率对比数据图 |
| 06 泛化 | Fig. 4（12 个受体面板，含 6 个孤儿受体）；面板清单；与三条既有路线的定位表 |
| 07 批判性评估 | 强项 / 不确定 / 薄弱点三栏 + 三个必须自己回答的问题 |
| 08 与我相关 | 四条可迁移经验 + 一个可检验假设 |
| 09 术语表 | 22 个术语 | 
| 10 引用与延伸 | 10 条文献（含 9T9P、Collu 2026、Köck/Merino、PURE、纳米盘、FSEC 原始文献） |

## 证据边界

- **原文图**：4 张全部为 PDF 页面像素级裁切（PyMuPDF 240 dpi），图卡顶栏标注图号/页码/裁切尺寸，
  右上角「原文 p.N ↗」直接跳到原文 PDF 对应页。
- **SVG 示意图**：3 张（D 天流程图、刚性基准机制、颗粒数对比数据图），图内明确标
  「AI 重绘示意图 · 非原文图」或「数据重绘自 p.9–10、p.21」；机制图的结构形状为示意。
- **数字**：全部转录自原文（正文/方法/图注），正文 25 处证据 chip 可点击回跳；
  `[推断]` / `[背景]` 与「原文 p.N」三类标记分明。原文未报告的项（FSC 曲线、对称性、
  B-factor、坐标沉积）在表 C 中明确列为"未报告"。
- 报告里对 12 vs 18 个面板、四天计时、12 倍颗粒数归因等处的质疑，均已在第 07 节写明依据。

## 复现 / 重新生成

```bash
SKILL_DIR=~/.dsh/skills/paper-deepread-html
PY=$(bash "$SKILL_DIR/scripts/setup_env.sh")

# 本目录的 paper/ 已含 content 源所需的 figures.json / meta.json / assets / text.md
$PY "$SKILL_DIR/scripts/build_report.py" \
  --template "$SKILL_DIR/assets/report_template.html" \
  --content content.html --meta paper/meta.json --figures paper/figures.json \
  --fig-base paper --out "$(basename "$PWD").html"
```

## 自检

`qa_report.py`：无外部资源、无占位符残留、图片 8/8 加载、横向溢出 0、4/4 图卡、10 个 section、
25 处证据 chip、打印 20 页；1440/390 宽与深浅色截图已逐张肉眼核对（工作目录 `work/paper2/` 保留中间产物）。
