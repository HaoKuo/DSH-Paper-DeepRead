# SVG 组件库 · 可复制片段与交互钩子

> 供报告撰写 Agent 在**生成重绘示意图**时直接复制。所有片段都是纯内联 SVG（无外部依赖），颜色一律使用模板定义的 CSS 变量，因此浅色/深色主题自动切换。每个片段放在 `<figure class="schematic">` 的 `.sch-canvas` 里即可，交互由模板内联 JS 自动接管。
>
> **硬性要求**
> 1. 每个 `<svg>` 必须有 `viewBox`、`role="img"`、`<title>`、`<desc>`；`<title>/<desc>` 的 `id` 必须全局唯一。
> 2. 可见徽章必须写：AI 重绘用 `<span class="sch-badge">AI 重绘示意图（非原文图）</span>`；数据重绘用 `<span class="sch-badge data">数据重绘自 Fig. X</span>`，并在 `<figcaption>` 末尾加 `<p class="source-note">数据转录自原文，未重新分析…</p>`。
> 3. **不得编造数据**。图上出现的每个数字都要在 `sch-source` / `source-note` 中给出 Fig/Table/页码，或明确写“示意”。
> 4. 所有 `id`（marker / title / 图层组）全局唯一；建议统一前缀，例如 `wf-`、`dev-`、`mech-`。
> 5. 尺寸：宽 900–980 的 `viewBox` 最稳；高度 220–380（宽高比约 2.4:1–3.8:1）。文字最小 9.5，正文标注 10–11，主标签 12–13。

## 0. 颜色与字体变量（由模板 CSS 提供）

| 用途 | 变量 | 说明 |
|---|---|---|
| 主文字 / 次文字 / 弱文字 | `--svg-ink` `--svg-ink-2` `--svg-mute` | 深色主题自动反色 |
| 描边 / 网格 | `--svg-rule` `--svg-grid` | 分隔线、坐标轴 |
| 节点底 / 画布底 | `--svg-node` `--svg-bg` | 卡片与区块填充 |
| 强调色 1/2/3 | `--svg-1` `--svg-2` `--svg-3` | 青绿 / 琥珀 / 藏蓝 |
| 强调色浅底 | `--svg-1-soft` `--svg-2-soft` `--svg-3-soft` | 区块背景 |
| 警示 / 负向 | `--svg-accent` | 红褐色，少量使用 |

写法：`fill="var(--svg-node)"`、`stroke="var(--svg-rule)"`、`fill="var(--svg-1)"`。**不要硬编码颜色**（`#fff` 仅可用于强调色圆点上的白色数字/图标）。

---

## 1. 工作流 / 流水线（workflow pipeline）

五阶段横向流程 + 可选反馈回路。每个 `<g>` 带 `data-tip`，悬停/聚焦显示释义；`tabindex="0"` 让键盘也能触发。

```html
<figure class="schematic">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">结构重绘自 Fig. 1a–c · 悬停阶段查看释义</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 980 330" role="img" aria-labelledby="wf-title wf-desc">
      <title id="wf-title"><!-- replace: 一句话概括流程 --></title>
      <desc id="wf-desc"><!-- replace: 给屏幕阅读器的完整描述，含每个阶段 --></desc>
      <defs>
        <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--svg-rule)"/>
        </marker>
        <marker id="wf-arrow-accent" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--svg-1)"/>
        </marker>
      </defs>
      <!-- 复用块：一个阶段 = 矩形 + 编号圆 + 标题 + 两行说明。复制 5 次，改 x 与文字。 -->
      <g data-tip-kicker="阶段 01" data-tip="<!-- replace: 该阶段释义 -->" tabindex="0">
        <rect x="30" y="84" width="152" height="112" rx="12" fill="var(--svg-node)" stroke="var(--svg-rule)"/>
        <circle cx="68" cy="112" r="15" fill="var(--svg-1)" opacity=".18"/>
        <text x="68" y="117" text-anchor="middle" fill="var(--svg-1)" font-size="11" font-weight="700">01</text>
        <text x="106" y="112" fill="var(--svg-ink)" font-size="13" font-weight="600"><!-- replace: 阶段名 --></text>
        <text x="106" y="130" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 说明 1 --></text>
        <text x="106" y="146" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 说明 2 --></text>
      </g>
      <line x1="186" y1="140" x2="220" y2="140" stroke="var(--svg-rule)" stroke-width="1.6" marker-end="url(#wf-arrow)"/>
      <!-- … 复制阶段 2–5：x 依次 +196（230/426/622/818） … -->
      <path d="M 894 200 C 894 300, 110 300, 110 200" fill="none" stroke="var(--svg-1)" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#wf-arrow-accent)"/>
      <text x="502" y="286" text-anchor="middle" fill="var(--svg-1)" font-size="10.5" font-weight="600"><!-- replace: 反馈回路说明 --></text>
    </svg>
  </div>
  <figcaption><p class="sch-caption"><!-- replace: 这张图真正的要点（1–2 句，不要复述图注） --></p></figcaption>
</figure>
```

JS 钩子：`data-tip` / `data-tip-kicker`（`<g>` 或任意 SVG 元素均可；`tabindex="0"` 支持键盘聚焦）。

---

## 2. 机制分步图（step-through mechanism）

四步机制：SVG 内用 `[data-step="n"]` 分组，图下用 `.step-text[data-step="n"]` 写每步文字。模板自动生成 `← / → / 1–9` 控制条；屏幕端 spotlight，打印端**全部步骤可见**（所以分组请设计成“可叠加/可并列”，不要依赖隐藏才能看懂）。

```html
<figure class="schematic" data-stepfig data-stepmode="spotlight" data-stepstart="first">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">机制重绘自 Fig. 2b–e · 分步演示</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 300" role="img" aria-labelledby="mech-title mech-desc">
      <title id="mech-title"><!-- replace: 机制名 --></title>
      <desc id="mech-desc"><!-- replace: 四步的完整描述 --></desc>
      <defs>
        <marker id="mech-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="var(--svg-rule)"/>
        </marker>
      </defs>
      <!-- 基础层（无 data-step）：通道、坐标、静态标签，屏幕/打印都显示 -->
      <rect x="36" y="120" width="848" height="54" rx="27" fill="var(--svg-1-soft)" stroke="var(--svg-1)" stroke-width="1.2"/>
      <!-- 每一步一个分组；第一步加 class="is-active" 作为无 JS 回退 -->
      <g data-step="1" class="is-active">
        <circle cx="120" cy="147" r="18" fill="var(--svg-1)" opacity=".92"/>
        <text x="240" y="88" text-anchor="middle" fill="var(--svg-ink)" font-size="12" font-weight="600"><!-- replace: 步骤 1 标注 --></text>
      </g>
      <g data-step="2"><!-- … 步骤 2 图形 … --></g>
      <g data-step="3"><!-- … 步骤 3 图形 … --></g>
      <g data-step="4"><!-- … 步骤 4 图形 … --></g>
    </svg>
  </div>
  <div class="step-read">
    <div class="step-text is-active" data-step="1">
      <h4><span class="step-n">1</span><!-- replace: 步骤 1 标题 --></h4>
      <p><!-- replace: 步骤 1 解释 1–2 句 --></p>
    </div>
    <div class="step-text" data-step="2"><h4><span class="step-n">2</span><!-- replace --></h4><p><!-- replace --></p></div>
    <div class="step-text" data-step="3"><h4><span class="step-n">3</span><!-- replace --></h4><p><!-- replace --></p></div>
    <div class="step-text" data-step="4"><h4><span class="step-n">4</span><!-- replace --></h4><p><!-- replace --></p></div>
  </div>
  <div class="sch-legend" aria-label="图例：悬停高亮对应元素">
    <span class="legend-item" tabindex="0" data-legend="a"><span class="legend-swatch" style="--sw:var(--svg-1)"></span><!-- replace --></span>
    <span class="legend-item" tabindex="0" data-legend="b"><span class="legend-swatch" style="--sw:var(--svg-2)"></span><!-- replace --></span>
  </div>
  <figcaption><p class="sch-caption"><!-- replace --></p></figcaption>
</figure>
```

属性：`data-stepfig`（必需）、`data-stepmode="spotlight|accumulate"`、`data-stepstart="first|last|all"`（`all` = 初始全部高亮，点击数字后回到 spotlight）。步骤分组内如要参与图例联动，加 `data-key="a"`（可多值 `data-key="a b"`）。

---

## 3. 时间线（timeline）

适合“优化轮次 / 研究阶段 / 版本演进”。节点用 `data-tip` 显示细节。

```html
<figure class="schematic">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">时间线由正文叙述重构，非原文图 · 数字转录自原文</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 250" role="img" aria-labelledby="tl-title tl-desc">
      <title id="tl-title"><!-- replace --></title><desc id="tl-desc"><!-- replace --></desc>
      <defs><marker id="tl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--svg-rule)"/></marker></defs>
      <line x1="70" y1="130" x2="860" y2="130" stroke="var(--svg-rule)" stroke-width="1.6" marker-end="url(#tl-arrow)"/>
      <!-- 里程碑复用块；x 依次 120 / 340 / 560 / 780；颜色 var(--svg-1)/1/2/3 -->
      <g data-tip-kicker="阶段 1" data-tip="<!-- replace -->" tabindex="0">
        <circle cx="120" cy="130" r="13" fill="var(--svg-1)"/>
        <text x="120" y="135" text-anchor="middle" fill="#fff" font-size="10" font-weight="700">1</text>
        <text x="120" y="86" text-anchor="middle" fill="var(--svg-ink)" font-size="11.5" font-weight="600"><!-- replace: 阶段名 --></text>
        <text x="120" y="104" text-anchor="middle" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 关键数据 --></text>
        <text x="120" y="170" text-anchor="middle" fill="var(--svg-ink-2)" font-size="9.5"><!-- replace: 结论 --></text>
      </g>
      <!-- … 3 个里程碑 … -->
    </svg>
  </div>
  <figcaption><p class="sch-caption"><!-- replace --></p></figcaption>
</figure>
```

---

## 4. 对比矩阵 / 2×2 象限（comparison matrix）

比较“方法 / 维度”时比表格更直观。也可做 3 列 × 2 行的能力矩阵：`rect` 按 `--svg-1-soft` / `--svg-2-soft` 区分，单元格内打 ✓/—。

```html
<figure class="schematic">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">结构重绘自 Table 1 / Fig. X · 评价维度为解读性归纳</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 340" role="img" aria-labelledby="cmp-title cmp-desc">
      <title id="cmp-title"><!-- replace --></title><desc id="cmp-desc"><!-- replace --></desc>
      <!-- 轴 -->
      <line x1="90" y1="290" x2="870" y2="290" stroke="var(--svg-rule)" stroke-width="1.4"/>
      <line x1="90" y1="290" x2="90" y2="40" stroke="var(--svg-rule)" stroke-width="1.4"/>
      <text x="90" y="318" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 横轴低 --></text>
      <text x="870" y="318" text-anchor="end" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 横轴高 --></text>
      <text x="76" y="46" text-anchor="end" fill="var(--svg-ink-2)" font-size="10" transform="rotate(-90 76 46)"><!-- replace: 纵轴 --></text>
      <!-- 象限底（可选） -->
      <rect x="90" y="40" width="390" height="125" fill="var(--svg-1-soft)" opacity=".5"/>
      <rect x="480" y="40" width="390" height="125" fill="var(--svg-2-soft)" opacity=".55"/>
      <!-- 数据点：悬停看方法名；data-key 用于与图例联动 -->
      <g data-key="ours" data-tip-kicker="本方法" data-tip="<!-- replace: 位置理由 -->" tabindex="0">
        <circle cx="700" cy="98" r="16" fill="var(--svg-1)" opacity=".9"/>
        <text x="700" y="103" text-anchor="middle" fill="#fff" font-size="11" font-weight="700">A</text>
        <text x="700" y="130" text-anchor="middle" fill="var(--svg-ink)" font-size="10"><!-- replace: 方法名 --></text>
      </g>
      <!-- … 其他方法点（可用 var(--svg-2)/var(--svg-3)/var(--svg-mute)）… -->
    </svg>
  </div>
  <div class="sch-legend" aria-label="图例">
    <span class="legend-item" tabindex="0" data-legend="ours"><span class="legend-swatch dot" style="--sw:var(--svg-1)"></span><!-- replace --></span>
    <span class="legend-item" tabindex="0" data-legend="other"><span class="legend-swatch dot" style="--sw:var(--svg-mute)"></span><!-- replace --></span>
  </div>
  <figcaption><p class="sch-caption"><!-- replace --></p></figcaption>
</figure>
```

---

## 5. 层级 / 分类树（hierarchy / taxonomy）

根节点 → 3 条分支 → 叶节点。悬停图例时，`[data-key]` 之外的节点自动变暗（`.dim`）。

```html
<figure class="schematic">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">结构转录自 Fig. X / Table Y · 类别为示意</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 330" role="img" aria-labelledby="tax-title tax-desc">
      <title id="tax-title"><!-- replace --></title><desc id="tax-desc"><!-- replace --></desc>
      <defs><marker id="tax-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--svg-rule)"/></marker></defs>
      <g>
        <rect x="330" y="16" width="260" height="52" rx="10" fill="var(--svg-node)" stroke="var(--svg-rule)"/>
        <text x="460" y="40" text-anchor="middle" fill="var(--svg-ink)" font-size="13" font-weight="600"><!-- replace: 根节点 --></text>
        <text x="460" y="58" text-anchor="middle" fill="var(--svg-ink-2)" font-size="10"><!-- replace: 副标题 --></text>
      </g>
      <!-- 分支：复制 3 次，x = 200 / 460 / 720；颜色依次 svg-1 / svg-3 / svg-2 -->
      <g data-key="branch-a">
        <path d="M 460 68 C 460 100, 200 92, 200 128" fill="none" stroke="var(--svg-rule)" stroke-width="1.5" marker-end="url(#tax-arrow)"/>
        <rect x="86" y="132" width="228" height="46" rx="9" fill="var(--svg-1-soft)" stroke="var(--svg-1)" stroke-width="1.2"/>
        <text x="200" y="152" text-anchor="middle" fill="var(--svg-ink)" font-size="12.5" font-weight="600"><!-- replace --></text>
        <text x="200" y="168" text-anchor="middle" fill="var(--svg-ink-2)" font-size="10"><!-- replace --></text>
        <rect x="96" y="194" width="208" height="54" rx="8" fill="var(--svg-node)" stroke="var(--svg-rule)"/>
        <text x="200" y="215" text-anchor="middle" fill="var(--svg-ink)" font-size="11"><!-- replace: 叶节点 --></text>
        <text x="200" y="232" text-anchor="middle" fill="var(--svg-ink-2)" font-size="9.5"><!-- replace --></text>
      </g>
    </svg>
  </div>
  <div class="sch-legend" aria-label="图例：悬停高亮对应分支">
    <span class="legend-item" tabindex="0" data-legend="branch-a"><span class="legend-swatch" style="--sw:var(--svg-1)"></span><!-- replace --></span>
    <span class="legend-item" tabindex="0" data-legend="branch-b"><span class="legend-swatch" style="--sw:var(--svg-3)"></span><!-- replace --></span>
    <span class="legend-item" tabindex="0" data-legend="branch-c"><span class="legend-swatch" style="--sw:var(--svg-2)"></span><!-- replace --></span>
  </div>
  <figcaption><p class="sch-caption"><!-- replace --></p></figcaption>
</figure>
```

---

## 6. 空间 / 器件布局（spatial device layout）

芯片、流路、器件、微流控示意图。图层分组各给唯一 `id`，用 `.sch-tools` 按钮 `data-toggle="#id"` 切换显示/隐藏（初始 `aria-pressed="true"`）。

```html
<figure class="schematic">
  <div class="sch-head">
    <span class="sch-badge">AI 重绘示意图（非原文图）</span>
    <span class="sch-source">结构重绘自 Fig. 2a · 可切换标注 / 流向图层</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 360" role="img" aria-labelledby="dev-title dev-desc">
      <title id="dev-title"><!-- replace --></title><desc id="dev-desc"><!-- replace --></desc>
      <defs><marker id="dev-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="var(--svg-1)"/></marker></defs>
      <!-- 器件主体（始终显示） -->
      <rect x="28" y="94" width="864" height="196" rx="18" fill="var(--svg-bg)" stroke="var(--svg-rule)"/>
      <rect x="56" y="176" width="800" height="32" rx="16" fill="var(--svg-1-soft)" stroke="var(--svg-1)" stroke-width="1.2"/>
      <!-- 液滴 / 细胞 / 颗粒等复用元素 -->
      <circle cx="120" cy="192" r="15" fill="var(--svg-1)" opacity=".9"/>
      <!-- 可切换图层 1：标注 -->
      <g id="dev-annots">
        <text x="120" y="148" fill="var(--svg-ink-2)" font-size="9.5"><!-- replace: 标注 --></text>
        <path d="M 156 156 L 138 178" stroke="var(--svg-rule)" stroke-width="1"/>
      </g>
      <!-- 可切换图层 2：流向 -->
      <g id="dev-flow">
        <path d="M 90 262 L 820 262" stroke="var(--svg-1)" stroke-width="1.6" stroke-dasharray="6 5" marker-end="url(#dev-arrow)"/>
        <text x="460" y="284" text-anchor="middle" fill="var(--svg-1)" font-size="10"><!-- replace: 流向说明 --></text>
      </g>
    </svg>
  </div>
  <div class="sch-tools">
    <button class="tg" type="button" data-toggle="#dev-annots" aria-pressed="true">显示标注</button>
    <button class="tg" type="button" data-toggle="#dev-flow" aria-pressed="true">显示流向</button>
  </div>
  <figcaption><p class="sch-caption"><!-- replace --></p></figcaption>
</figure>
```

---

## 7. 数据重绘（bar / line / dot plot）

规则：只用**从原文转录**的数值；图上不放无出处的成分；`sch-badge data` + `source-note` 必须写明“数据转录自原文，未重新分析”。下面三种片段可混用同一套坐标轴。

### 7a. 竖排柱状图（R²、产量、成本）

```html
<figure class="schematic datafig">
  <div class="sch-head">
    <span class="sch-badge data">数据重绘自 Fig. 3h, Fig. 5b–c</span>
    <span class="sch-source">数据转录自原文，未重新分析</span>
  </div>
  <div class="sch-canvas">
    <svg viewBox="0 0 920 340" role="img" aria-labelledby="bar-title bar-desc">
      <title id="bar-title"><!-- replace --></title><desc id="bar-desc"><!-- replace：含每个数值与出处 --></desc>
      <!-- 网格 + 轴：y 从 0（y=260）到 1.0（y=60），每 0.25 一格（50px） -->
      <g stroke="var(--svg-grid)" stroke-width="1">
        <line x1="120" y1="260" x2="860" y2="260"/><line x1="120" y1="200" x2="860" y2="200"/>
        <line x1="120" y1="140" x2="860" y2="140"/><line x1="120" y1="80" x2="860" y2="80"/>
      </g>
      <line x1="120" y1="260" x2="120" y2="60" stroke="var(--svg-rule)" stroke-width="1.4"/>
      <line x1="120" y1="260" x2="870" y2="260" stroke="var(--svg-rule)" stroke-width="1.4"/>
      <g font-size="10" fill="var(--svg-mute)" text-anchor="end">
        <text x="110" y="264">0</text><text x="110" y="204">0.25</text>
        <text x="110" y="144">0.50</text><text x="110" y="84">0.75</text><text x="110" y="62">1.00</text>
      </g>
      <!-- 柱：y = 260 - value*200；宽 96、rx 3。第一个柱示例 value=0.88 → y=84 -->
      <g>
        <rect x="180" y="84" width="96" height="176" rx="3" fill="var(--svg-1)" opacity=".85"/>
        <text x="228" y="76" text-anchor="middle" fill="var(--svg-ink)" font-size="11" font-weight="600">0.88</text>
        <text x="228" y="280" text-anchor="middle" fill="var(--svg-ink)" font-size="10.5"><!-- replace: 组名 --></text>
        <text x="228" y="296" text-anchor="middle" fill="var(--svg-ink-2)" font-size="9.5"><!-- replace: 条件 --></text>
      </g>
      <!-- … 其余柱 x = 360 / 540 / 720 … -->
    </svg>
  </div>
  <figcaption>
    <p class="sch-caption"><!-- replace: 一句话结论 --></p>
    <p class="source-note">数据转录自原文 p.X Fig. Y；未重新分析。</p>
  </figcaption>
</figure>
```

### 7b. 折线图（趋势 / 学习曲线）

```html
<svg viewBox="0 0 920 320" role="img" aria-labelledby="line-title line-desc">
  <title id="line-title"><!-- replace --></title><desc id="line-desc"><!-- replace --></desc>
  <g stroke="var(--svg-grid)" stroke-width="1"><line x1="110" y1="260" x2="860" y2="260"/><line x1="110" y1="180" x2="860" y2="180"/><line x1="110" y1="100" x2="860" y2="100"/></g>
  <line x1="110" y1="260" x2="110" y2="50" stroke="var(--svg-rule)" stroke-width="1.4"/>
  <line x1="110" y1="260" x2="870" y2="260" stroke="var(--svg-rule)" stroke-width="1.4"/>
  <!-- 系列 1：polyline points 由数据换算（x 均分，y = 260 - 归一化值*200） -->
  <polyline points="140,210 320,190 500,150 680,120 860,112" fill="none" stroke="var(--svg-1)" stroke-width="2.2" stroke-linejoin="round"/>
  <polyline points="140,240 320,232 500,206 680,180 860,166" fill="none" stroke="var(--svg-2)" stroke-width="2.2" stroke-dasharray="6 4" stroke-linejoin="round"/>
  <g font-size="10" fill="var(--svg-mute)" text-anchor="middle">
    <text x="140" y="282"><!-- replace: x 刻度 --></text><text x="860" y="282">…</text>
  </g>
  <g font-size="10.5">
    <text x="820" y="104" fill="var(--svg-1)" text-anchor="end"><!-- replace: 系列 1 --></text>
    <text x="820" y="184" fill="var(--svg-2)" text-anchor="end"><!-- replace: 系列 2 --></text>
  </g>
</svg>
```

### 7c. 点图 / 横向倍数条（dot plot，适合 fold-change）

```html
<svg viewBox="0 0 920 280" role="img" aria-labelledby="dot-title dot-desc">
  <title id="dot-title"><!-- replace --></title><desc id="dot-desc"><!-- replace --></desc>
  <!-- 横向轴：1× → 4×，x = 110 + (倍-1)*250 -->
  <line x1="110" y1="150" x2="860" y2="150" stroke="var(--svg-rule)" stroke-width="1.4"/>
  <g font-size="10" fill="var(--svg-mute)" text-anchor="middle">
    <text x="110" y="176">1×</text><text x="360" y="176">2×</text><text x="610" y="176">3×</text><text x="860" y="176">4×</text>
  </g>
  <!-- 每个点：data-tip 写明原始数值与出处；标签放上方错开 -->
  <circle cx="335" cy="150" r="9" fill="var(--svg-1)" data-tip-kicker="<!-- replace -->" data-tip="<!-- replace: 数值 + 出处 -->" tabindex="0"/>
  <text x="335" y="122" text-anchor="middle" fill="var(--svg-ink)" font-size="11" font-weight="600"><!-- replace: 指标 --></text>
  <text x="335" y="200" text-anchor="middle" fill="var(--svg-ink-2)" font-size="10.5"><!-- replace: 倍数 --></text>
</svg>
```

---

## 8. 原文图热点叠加（hotspot overlay，配合 `.paper-fig`）

原文裁片由 builder 生成，Agent 在 `.pf-caption-wrap` 内写解读；热点叠在 `.pf-imgwrap` 里的 `svg.pf-hotspots` 上。**该 SVG 没有 viewBox**：`cx/cy` 用百分比（相对图片宽高），`r` 用 px，因此圆点不会被拉伸变形。

```html
<svg class="pf-hotspots" aria-label="Fig. 2 编号热点">
  <g class="hs" data-tip-kicker="面板 a · 芯片" data-tip="<!-- replace: 看什么 -->"
     tabindex="0" role="button" aria-label="热点 1：<!-- replace -->">
    <circle class="hs-halo" cx="19%" cy="37%" r="19"></circle>
    <circle class="hs-dot" cx="19%" cy="37%" r="13"></circle>
    <text class="hs-num" x="19%" y="37%">1</text>
  </g>
  <!-- 复制并按面板位置改 cx/cy（0–100%），圆点必须落在图片元素上 -->
</svg>
```

点击热点会 pin 住 tooltip（再点/点空白/Esc 关闭），无需额外 JS。

---

## 9. 交互钩子速查（无需写 JS，模板自动接管）

| 钩子 | 写在哪 | 行为 |
|---|---|---|
| `data-tip="…"` | 任意 HTML / SVG 元素 | 悬停/聚焦显示 tooltip；SVG 节点加 `tabindex="0"` 可键盘触发 |
| `data-tip-kicker="面板 a"` | 同上 | tooltip 顶部小标签 |
| `data-tip-html="<b>…</b>"` | 同上 | 富文本 tooltip（内含标签需转义） |
| `data-stepfig` + `[data-step="n"]` | `<figure class="schematic">` / SVG 分组 / `.step-text` | 自动生成上一步/下一步 + 数字键 + 计数器 |
| `data-stepmode="accumulate"` | 同上 | 累积显示（step ≤ n 全亮）而非 spotlight |
| `data-stepstart="last"`/`"all"` | 同上 | 初始停在最后一步 / 全部点亮 |
| `data-toggle="#id"` | `<button class="tg">` | 切换目标元素 `.hidden`，同步 `aria-pressed` |
| `data-legend="key"` | 图例项（HTML 或 SVG `<g>`） | 悬停时给 `[data-key]` 加 `.hl`，无关节点加 `.dim` |
| `data-key="a b"` | SVG 元素 | 参与图例联动；可多个 key |
| `data-zoom` | `.pf-imgwrap` 或任意容器 | 点击容器内 `<img>` 打开全屏缩放/平移 lightbox |
| `data-thumb` | 封面缩略图按钮 | 点击打开 lightbox |
| `.ev` + `data-ev="p.5 Fig.2b"` | `<span class="ev">` | 悬停显示溯源、点击滚动并闪烁对应 `#fig-N`；可用 `data-ev-target="#fig-2"` 覆盖 |
| `data-figref="fig1"` | 封面缩略图 `<img>`（无 src） | JS 从 `#fig-1 img` 复制 src，避免 base64 重复 |

---

## 10. 页面结构片段（Agent 写 `content.html` 时用）

```html
<section>
  <h2 id="sec-example">章节标题（不要手写序号，CSS 自动编号）</h2>
  <p class="lede">本章导语。</p>
  <p>正文。证据处用 <span class="ev" data-ev="p.5 Fig.2b">该结论的原文依据</span> 标注。</p>

  <aside class="callout insight">   <!-- insight | caveat | method | quote -->
    <p class="callout-label">核心洞察</p>
    <p>…</p>
    <span class="callout-src">来源：原文 p.X；本段为解读</span>
  </aside>

  <figure class="tbl">
    <figcaption><b>表 1.</b> 说明 + 数据出处。</figcaption>
    <div class="table-wrap"><table class="cmp-table">…</table></div>
    <p class="table-note">注：…</p>
  </figure>

  <div class="appraisal">
    <div class="card pro"><h3>优势 Strengths</h3><ul><li><b>要点：</b>…</li></ul></div>
    <div class="card unc"><h3>不确定性 Uncertainties</h3><ul>…</ul></div>
    <div class="card con"><h3>局限 Limitations</h3><ul>…</ul></div>
  </div>

  <dl class="glossary"><div><dt>术语<span>English</span></dt><dd>解释。</dd></div></dl>
  <ol class="refs"><li>…</li></ol>
</section>
```

原文图卡片由 builder 自动生成（`.paper-fig` + `.pf-top` + `.pf-frame` + `.pf-caption-wrap`），Agent 只写 `.pf-caption-wrap` 内部：`<div class="pf-panels"><h4>逐面板解读</h4><ul><li><b>a</b><span>…</span></li></ul></div>`。

## 11. 自检清单

- [ ] 每个 SVG 有 `viewBox` + `role="img"` + 唯一 `<title>/<desc>`
- [ ] 没有硬编码颜色（除强调圆点上的白字）；深浅色都试过
- [ ] 所有 id 唯一（marker、title、图层组）
- [ ] AI 重绘徽章存在；数据重绘有 `source-note`
- [ ] 图上数字均能在原文找到出处，或已标注“示意”
- [ ] 悬停/键盘焦点有可见反馈（`tabindex="0"`）
- [ ] 390 px 宽下不溢出（SVG 宽度 100% 自适应）
- [ ] 打印时 stepfig 所有步骤可见——分组设计不要依赖“隐藏才能看懂”
