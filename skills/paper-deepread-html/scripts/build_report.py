#!/usr/bin/env python3
"""Assemble a single-file deep-read HTML report from template + content + figure manifest.

Usage:
  build_report.py --template assets/report_template.html \
                  --content work/demo/content.html \
                  --meta work/demo/paper/meta.json \
                  --figures work/demo/paper/figures.json \
                  --fig-base work/demo/paper \
                  --out work/demo/report.html [--no-inline] [--no-qa-hook]
                  # or: --paper-root paper-read/  -> paper-read/<year>-<journal>-<title>/<year>-<journal>-<title>.html

Contract (mirrors the header comment of assets/report_template.html):
  template placeholders (inner HTML, replaced exactly once):
    {{META_JSON}} {{COVER}} {{NAV}} {{CONTENT}} {{PROVENANCE}} {{BUILD_DATE}}
  content.html: <section> blocks, each starting with <h2 id="...">.
  figures:      <figure class="paper-fig" data-fig="fig2">AGENT-INNER</figure>
                builder injects .pf-top/.pf-frame/.pf-imgwrap and wraps AGENT-INNER
                inside .pf-caption-wrap (after the original caption quote).
                A child <template data-hotspots>…</template> is moved inside .pf-imgwrap.
  images:       <img src="assets/figN.png"> is inlined as data:image/... unless --no-inline.
"""
import argparse
import base64
import shutil
import datetime
import hashlib
import html
import json
import mimetypes
import re
import sys
from pathlib import Path
from urllib.parse import quote as url_quote

PLACEHOLDER_RE = re.compile(r"\{\{([A-Z_]+)\}\}")
FIG_RE = re.compile(
    r'<figure\b(?P<attrs>[^>]*\bdata-fig="(?P<id>[^"]+)"[^>]*)>(?P<inner>.*?)</figure>',
    re.S,
)
SECTION_RE = re.compile(r"<section\b(?P<attrs>[^>]*)>(?P<body>.*?)</section>", re.S)
H2_RE = re.compile(r'<h2\b(?P<attrs>[^>]*)>(?P<title>.*?)</h2>', re.S)
H3_RE = re.compile(r'<h3\b(?P<attrs>[^>]*)>(?P<title>.*?)</h3>', re.S)
IMG_RE = re.compile(r'(<img\b[^>]*?\bsrc=")([^"]+)(")')
HOTSPOT_RE = re.compile(
    r"<template\b[^>]*\bdata-hotspots\b[^>]*>(?P<svg>.*?)</template>", re.S
)
HOTSPOT_SVG_RE = re.compile(
    r'<svg\b[^>]*\bclass="[^"]*\bpf-hotspots\b[^"]*"[^>]*>.*?</svg>', re.S
)
ID_RE = re.compile(r'\bid="([^"]+)"')

ZOOM_ICON = (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    'stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.2"/>'
    '<path d="M15.6 15.6 20 20M11 8.6v4.8M8.6 11h4.8"/></svg>'
)


def e(text):
    return html.escape(str(text), quote=True)


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", str(s)).replace("&nbsp;", " ").strip()


def read_json(path, default):
    p = Path(path)
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"[build] invalid JSON in {p}: {exc}")


ILLEGAL_FS = re.compile(r'[\\/:*?"<>|\x00-\x1f\uFF0F\uFF3C\uFF1A\uFF0A\uFF1F\uFF02\uFF1C\uFF1E\uFF5C]')


def sanitize_name(name, max_len=180):
    """Filesystem-safe single path component: keeps words readable, drops separators."""
    name = ILLEGAL_FS.sub(" ", str(name or ""))          # illegal chars -> word break
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"\s*-\s*", "-", name)                 # tidy "a - b" -> "a-b"
    name = re.sub(r"-{2,}", "-", name).strip(" .-")
    if len(name) > max_len:
        cut = name[:max_len].rsplit(" ", 1)[0] if " " in name[:max_len] else name[:max_len]
        name = cut.strip(" .-")
    return name or "untitled"


def default_report_name(meta):
    """<发表年份>-<期刊名>-<文章名>.html  (title kept in the paper's original language)."""
    year = str(meta.get("year") or "").strip()
    journal = str(meta.get("journal") or "").strip()
    title = str(meta.get("title") or meta.get("title_en") or meta.get("title_zh") or "").strip()
    base = "-".join([year or "unknown", journal or "unknown-journal", title or "untitled"])
    return sanitize_name(base) + ".html"


def resolve_out_path(args, meta):
    """--out may be a file or a directory; --out-dir forces directory mode.

    Directory mode (the skill's default) names the report
    <year>-<journal>-<title>.html so HTML and print PDF share one basename.
    """
    name = (sanitize_name(args.name) + ".html") if args.name else default_report_name(meta)
    if args.paper_root:
        stem = name[:-5] if name.lower().endswith(".html") else name
        return Path(args.paper_root) / stem / (stem + ".html")
    if args.out_dir:
        return Path(args.out_dir) / name
    raw = args.out or "."
    target = Path(raw)
    if target.is_dir() or str(raw).endswith(("/", "\\")) or not target.suffix:
        return target / name
    return target


RAW_PREFIX = "RAW-"


def place_raw_pdf(source_pdf, out_path, meta):
    """Copy the original PDF next to the report as RAW-<report stem>.pdf."""
    folder = out_path.parent
    raw_name = RAW_PREFIX + out_path.stem + ".pdf"
    existing = sorted(folder.glob(RAW_PREFIX + "*.pdf"))
    if source_pdf:
        src = Path(source_pdf).expanduser().resolve()
        if not src.exists():
            print("[build] WARN: --source-pdf not found: %s" % src, file=sys.stderr)
        else:
            dest = folder / raw_name
            if src != dest.resolve():
                folder.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest)
            print("[build] original PDF -> %s" % dest.name)
            return dest.name
    if len(existing) == 1:
        return existing[0].name
    known = meta.get("raw_pdf")
    if known and (folder / known).exists():
        return known
    if len(existing) > 1:
        print("[build] note: multiple RAW-*.pdf in %s; keep one or pass --source-pdf" % folder, file=sys.stderr)
    return None


def raw_pdf_link(raw_name):
    """Single "查看原文 PDF" anchor for the original PDF (view-only)."""
    if not raw_name:
        return ""
    return ('<a class="chip chip-raw" href="%s" target="_blank" rel="noopener" '
            'title="在新标签查看原文 PDF">查看原文 PDF</a>' % url_quote(raw_name))


def strip_duplicate_section_ids(content):
    """Content often sets id="sec-x" on both <section> and its <h2>; keep only the
    heading id (TOC/anchors target it) so the DOM has no duplicate ids."""
    import re as _re
    h2_ids = set(_re.findall(r'<h2\b[^>]*\bid="([^"]+)"', content))
    if not h2_ids:
        return content

    def repl(m):
        attrs = m.group(1)
        idm = _re.search(r'\s+id="([^"]+)"', attrs)
        if idm and idm.group(1) in h2_ids:
            attrs = attrs.replace(idm.group(0), "")
        return "<section" + attrs + ">"

    return _re.sub(r"<section\b([^>]*)>", repl, content)


def fig_dom_id(fid):
    m = re.match(r"^(fig|tab|scheme|extfig)(\d+)$", str(fid), re.I)
    if m:
        return "%s-%s" % (m.group(1).lower(), m.group(2))
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", str(fid))


class Inliner:
    def __init__(self, enabled):
        self.enabled = enabled
        self.cache = {}

    def data_uri(self, src, base_dirs):
        if src.startswith(("data:", "http://", "https://", "#")):
            return src
        for base in base_dirs:
            p = (Path(base) / src).resolve()
            if p.is_file():
                key = str(p)
                if key not in self.cache:
                    mime = mimetypes.guess_type(p.name)[0] or "image/png"
                    self.cache[key] = "data:%s;base64,%s" % (
                        mime,
                        base64.b64encode(p.read_bytes()).decode("ascii"),
                    )
                return self.cache[key]
        return None


def build_cover(meta, figures, raw_name=None):
    title_en = meta.get("title") or meta.get("title_en") or "(untitled paper)"
    title_zh = meta.get("title_zh") or ""
    journal = meta.get("journal") or ""
    year = meta.get("year") or ""
    doi = meta.get("doi") or ""
    authors = meta.get("authors") or []
    n_pages = meta.get("n_pages") or ""
    tldr = meta.get("tldr") or ""
    tags = meta.get("tags") or []
    metrics = meta.get("metrics") or []

    kicker_chips = []
    jy = " · ".join([x for x in (journal, str(year)) if x])
    if jy:
        kicker_chips.append('<span class="chip">%s</span>' % e(jy))
    for t in tags[:3]:
        kicker_chips.append('<span class="chip">%s</span>' % e(t))
    authors_html = " · ".join(e(a) for a in authors[:8]) if authors else ""
    if len(authors) > 8:
        authors_html += " 等"

    meta_chips = []
    if doi:
        meta_chips.append(
            '<a class="chip chip-doi" href="https://doi.org/%s" target="_blank" rel="noopener">DOI %s</a>'
            % (e(doi), e(doi))
        )
    if meta.get("n_figures") or figures:
        meta_chips.append('<span class="chip">%d 张原文图表</span>' % (meta.get("n_figures") or len(figures)))
    if n_pages:
        meta_chips.append('<span class="chip">%s 页</span>' % e(n_pages))
    view_link = raw_pdf_link(raw_name or "")
    if view_link:
        meta_chips.append(view_link)

    glance = []
    for dt, dd in (
        ("期刊", journal),
        ("年份", year),
        ("通讯", (meta.get("corresponding") or "")),
        ("体系", (meta.get("system") or "")),
        ("数据/代码", (meta.get("data_code") or "")),
    ):
        if dd:
            glance.append("<div><dt>%s</dt><dd>%s</dd></div>" % (e(dt), e(dd)))
    glance_html = ""
    if glance:
        glance_html = (
            '<aside class="cover-side"><div class="glance">'
            '<p class="glance-title">论文速览 <span>At a glance</span></p>'
            '<dl class="glance-list">%s</dl></div></aside>' % "".join(glance)
        )

    metrics_html = "".join(
        '<div class="metric"><span class="metric-v">%s</span>'
        '<span class="metric-l">%s</span>%s</div>'
        % (
            e(m.get("value") or m.get("v") or ""),
            e(m.get("label") or m.get("l") or ""),
            ('<span class="metric-n">%s</span>' % e(m.get("note") or m.get("n"))) if (m.get("note") or m.get("n")) else "",
        )
        for m in metrics
    )

    thumbs = []
    for f in figures[:6]:
        if not f.get("crop"):
            continue
        thumbs.append(
            '<button class="thumb" type="button" data-thumb>'
            '<img data-figref="%s" alt="%s 缩略图" loading="lazy">'
            '<span class="thumb-cap">%s · p.%s</span></button>'
            % (e(f.get("id", "")), e(f.get("label", "")), e(f.get("label", "")), e(f.get("page", "?")))
        )
    thumbs_html = ""
    if thumbs:
        thumbs_html = (
            '<div class="cover-thumbs"><p class="thumbs-label">原文图表 · Figures</p>'
            '<div class="thumbs-track">%s</div></div>' % "".join(thumbs)
        )

    tldr_html = ""
    if tldr:
        tldr_html = (
            '<p class="cover-tldr"><span class="tldr-label">一句话读懂</span>%s</p>' % e(tldr)
        )

    return (
        '<div class="cover-inner"><div class="cover-main">'
        '<p class="cover-kicker"><span class="badge-ai">AI 深度解读 · 图表重绘</span>%s</p>'
        '<h1 class="cover-title">%s</h1>%s<p class="cover-authors">%s</p>'
        '<div class="cover-meta">%s</div>%s</div>%s</div>%s%s'
        % (
            "".join(kicker_chips),
            e(title_en),
            ('<p class="cover-title-zh">%s</p>' % e(title_zh)) if title_zh else "",
            authors_html,
            "".join(meta_chips),
            tldr_html,
            glance_html,
            ('<div class="cover-metrics">%s</div>' % metrics_html) if metrics_html else "",
            thumbs_html,
        )
    )


def ensure_heading_ids(content: str) -> str:
    """Give every h2/h3 an id so TOC links always resolve.

    The report authoring contract asks for ids, but agents occasionally omit
    them; build_nav() would then emit links to non-existent anchors and the TOC
    silently does nothing. Assign ``sec-N`` / ``sec-h3-N`` for headings that are
    missing an id (existing ids are preserved).
    """
    used = set(ID_RE.findall(content))
    h2_counter = [0]

    def h2_repl(m):
        attrs, title = m.group("attrs"), m.group("title")
        if ID_RE.search(attrs):
            h2_counter[0] += 1
            return m.group(0)
        h2_counter[0] += 1
        sid = "sec-%d" % h2_counter[0]
        while sid in used:
            sid += "-x"
        used.add(sid)
        return '<h2%s id="%s">%s</h2>' % (attrs, sid, title)

    content = H2_RE.sub(h2_repl, content)
    h3_counter = [0]

    def h3_repl(m):
        attrs, title = m.group("attrs"), m.group("title")
        if ID_RE.search(attrs):
            return m.group(0)
        h3_counter[0] += 1
        sid = "sec-h3-%d" % h3_counter[0]
        while sid in used:
            sid += "-x"
        used.add(sid)
        return '<h3%s id="%s">%s</h3>' % (attrs, sid, title)

    return H3_RE.sub(h3_repl, content)


def build_nav(content):
    items = []
    for i, m in enumerate(H2_RE.finditer(content), 1):
        attrs, title = m.group("attrs"), strip_tags(m.group("title"))
        idm = ID_RE.search(attrs)
        sid = idm.group(1) if idm else "sec-%d" % i
        # h3 subsections that follow this h2 in document order
        subs = H3_RE.findall(content[m.end():])
        subs_html = ""
        if subs:
            sub_items = []
            for j, (sattrs, stitle) in enumerate(subs[:8], 1):
                sidm = ID_RE.search(sattrs)
                if not sidm:
                    continue
                sub_items.append(
                    '<li><a class="toc-link" href="#%s"><span class="toc-num">%d.%d</span>'
                    '<span class="toc-text">%s</span></a></li>'
                    % (e(sidm.group(1)), i, j, e(strip_tags(stitle)))
                )
            if sub_items:
                subs_html = '<ol class="toc-sub">%s</ol>' % "".join(sub_items)
        items.append(
            '<li class="toc-item"><a class="toc-link" href="#%s">'
            '<span class="toc-num">%02d</span><span class="toc-text">%s</span></a>%s</li>'
            % (e(sid), i, e(title), subs_html)
        )
    if not items:
        return ""
    return '<ol class="toc-list">%s</ol>' % "".join(items)


def build_figure(fig, inner, inliner, bases, raw_name=None):
    fid = fig.get("id", "fig")
    dom_id = fig_dom_id(fid)
    label = fig.get("label") or fid
    page = fig.get("page", "?")
    caption = (fig.get("caption") or "").strip()
    detect = {"image": "图像块", "vector": "矢量图形", "mixed": "混合", "manual": "手动指定"}.get(
        fig.get("detect", ""), fig.get("detect", "")
    )
    dims = ""
    if fig.get("width") and fig.get("height"):
        dims = " · %s×%s px" % (fig.get("width"), fig.get("height"))

    # hotspots: <template data-hotspots>…</template> -> move inside .pf-imgwrap
    hotspots = ""
    inner = inner or ""
    m = HOTSPOT_RE.search(inner)
    if m:
        hotspots = m.group("svg").strip()
        inner = (inner[: m.start()] + inner[m.end():]).strip()
    else:
        m = HOTSPOT_SVG_RE.search(inner)
        if m:
            hotspots = m.group(0).strip()
            inner = (inner[: m.start()] + inner[m.end():]).strip()

    img_src = fig.get("crop") or ""
    if inliner.enabled and img_src:
        img_src = inliner.data_uri(img_src, bases) or img_src
    alt = "原文 %s（p.%s）" % (label, page)
    img_html = (
        '<img src="%s" alt="%s" loading="lazy" decoding="async">' % (e(img_src), e(alt))
        if img_src
        else '<p class="source-note">（裁切图缺失）</p>'
    )
    zoom = (
        '<span class="pf-zoom-hint">%s放大</span>' % ZOOM_ICON
        if img_src
        else ""
    )
    warn = ""
    warnings = fig.get("warnings") or []
    if warnings:
        warn = '<p class="source-note">%s</p>' % e("；".join(warnings))
    quote = ""
    if caption:
        quote = (
            '<blockquote class="pf-quote"><span class="q-label">原文图注 · p.%s</span>“%s”</blockquote>'
            % (e(page), e(caption))
        )
    prov = "原文 <b>%s</b> · p.%s · %s裁切 · 来自 PDF 原始页面%s" % (
        e(label),
        e(page),
        e(detect or "自动"),
        e(dims),
    )
    page_link = ""
    if raw_name and str(page).isdigit():
        page_link = (
            '<a class="pf-page" href="%s#page=%s" target="_blank" rel="noopener" '
            'title="在原文 PDF 第 %s 页查看">原文 p.%s ↗</a>'
            % (url_quote(raw_name), page, page, page)
        )
    return (
        '<figure class="paper-fig" id="%s" data-fig="%s">'
        '<div class="pf-top"><span class="pf-label">%s</span><span class="pf-prov">%s</span>%s</div>'
        '<div class="pf-frame"><div class="pf-imgwrap" data-zoom tabindex="0" role="button" '
        'aria-label="放大查看 %s">%s%s%s</div></div>'
        '<div class="pf-caption-wrap">%s%s%s</div></figure>'
        % (e(dom_id), e(fid), e(label), prov, page_link, e(alt), img_html, hotspots, zoom, quote, warn, inner or "")
    )


def expand_figures(content, figures, inliner, bases, raw_name=None):
    by_id = {f.get("id"): f for f in figures}
    used = []

    def repl(m):
        fid = m.group("id")
        fig = by_id.get(fid)
        if not fig:
            print(f"[build] WARN: content references unknown figure '{fid}'", file=sys.stderr)
            return m.group(0)
        used.append(fid)
        return build_figure(fig, m.group("inner"), inliner, bases, raw_name)

    out = FIG_RE.sub(repl, content)
    unused = [f.get("id") for f in figures if f.get("id") not in used]
    if unused:
        print("[build] note: figures not referenced by content: %s" % ", ".join(unused), file=sys.stderr)
    return out, used


def build_provenance(meta, figures, report_path, raw_name=None):
    rows = "".join(
        "<tr><td><b>%s</b></td><td>%s</td><td><code>%s</code></td><td>%s</td>"
        "<td>%s×%s</td><td>%s</td></tr>"
        % (
            e(f.get("label", f.get("id", ""))),
            (
                '<a href="%s#page=%s" target="_blank" rel="noopener">p.%s</a>'
                % (url_quote(raw_name), f.get("page", ""), e(f.get("page", "?")))
                if raw_name and str(f.get("page", "")).isdigit()
                else "p.%s" % e(f.get("page", "?"))
            ),
            e(", ".join("%.1f" % v for v in f.get("bbox", [])) or "—"),
            e(f.get("detect", "—")),
            e(f.get("width", "?")),
            e(f.get("height", "?")),
            e(Path(f.get("crop", "")).name or "—"),
        )
        for f in figures
    )
    sha = meta.get("pdf_sha256") or ""
    src = meta.get("source_path") or ""
    n_pages = meta.get("n_pages", "?")
    n_figs = len(figures)
    raw_note = ""
    if raw_name:
        raw_note = (
            '<br><b>原文 PDF</b>：<a href="%s" target="_blank" rel="noopener">查看</a> ｜ <code>%s</code>'
            % (url_quote(raw_name), e(raw_name))
        )
    return (
        '<div class="prov-inner">'
        '<div class="prov-head"><h2 class="prov-title">图表溯源附录 <span>Provenance</span></h2>'
        '<p class="prov-sub">本报告的原文图均为论文 PDF 页面按坐标裁切的高分辨率渲染（非 AI 生成）；'
        '图中文字与面板标记保留自原文。裁切框单位为 PDF point（1/72 inch），原点在页面左上角。</p></div>'
        '<div class="table-wrap"><table class="prov-table">'
        "<thead><tr><th>图号</th><th>页码</th><th>裁切框 (pt)</th><th>检测</th><th>尺寸</th><th>文件</th></tr></thead>"
        "<tbody>%s</tbody></table></div>"
        '<p class="prov-note"><b>证据分级</b>：<span class="ev" data-ev="本报告">证据标记</span> 指向原文页码/图号或本报告图表；'
        '「AI 重绘示意图」为基于原文文字/图表的解释性重绘，不代表原始数据；未标注来源的判断为解读性推断。'
        '<br><b>源文件</b>：%s ｜ <b>PDF SHA-256</b>：<code>%s</code> ｜ <b>页数</b>：%s ｜ '
        '<b>收录图表</b>：%d ｜ <b>生成</b>：%s ｜ '
        '<b>工具</b>：paper-deepread-html（PyMuPDF 裁切 + 单文件内嵌 + 纯 JS/SVG 重绘）'
        '%s</p>'
        '</div>'
        % (
            rows,
            e(src),
            e(sha),
            e(n_pages),
            n_figs,
            e(datetime.date.today().isoformat()),
            raw_note,
        )
    )


QA_HOOK = """
<script>
/* injected by build_report.py as a fallback machine-readable QA summary.
   Skips itself when the template's own hook already wrote #qa-report. */
window.addEventListener('load', function () {
  setTimeout(function () {
    try {
      var existing = document.getElementById('qa-report');
      if (existing && (existing.textContent || '').trim().length > 2) return;
      var imgs = [].slice.call(document.images), broken = [];
      imgs.forEach(function (im, i) {
        if (!im.complete || im.naturalWidth === 0) broken.push(im.getAttribute('alt') || ('img-' + i));
      });
      var overflow = [];
      [].slice.call(document.querySelectorAll('body *')).forEach(function (el) {
        var cs = getComputedStyle(el);
        if (el.scrollWidth - el.clientWidth > 2 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll')
          overflow.push((el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''));
      });
      var ext = [];
      [].slice.call(document.querySelectorAll('[src],link[href]')).forEach(function (el) {
        var v = el.getAttribute('src') || el.getAttribute('href') || '';
        if (/^https?:/i.test(v)) ext.push(v);
      });
      var out = {
        title: document.title,
        images: { total: imgs.length, broken: broken },
        overflowCount: overflow.length, overflow: overflow.slice(0, 25),
        externalResources: ext,
        svg: document.querySelectorAll('svg').length,
        schematics: document.querySelectorAll('.schematic').length,
        sections: document.querySelectorAll('main#report > section, .report-section').length,
        figures: document.querySelectorAll('.paper-fig').length,
        claims: document.querySelectorAll('.ev').length,
        height: document.body.scrollHeight,
        width: document.documentElement.clientWidth,
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        hasToc: !!document.querySelector('#toc'), hasLightbox: !!document.getElementById('lightbox'),
        sectionIds: [].slice.call(document.querySelectorAll('main#report > section[id]'))
          .map(function (s) { return s.id; }).slice(0, 24),
        figureIds: [].slice.call(document.querySelectorAll('.paper-fig[id]'))
          .map(function (s) { return s.id; }).slice(0, 12),
        jsErrors: (window.__qaErrors || []).slice(0, 5)
      };
      var s = document.createElement('script'); s.type = 'application/json'; s.id = 'qa-report';
      s.textContent = JSON.stringify(out); document.body.appendChild(s);
    } catch (err) {
      var s2 = document.createElement('script'); s2.type = 'application/json'; s2.id = 'qa-report';
      s2.textContent = JSON.stringify({ error: String(err) }); document.body.appendChild(s2);
    }
  }, 400);
});
</script>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--content", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--figures", required=True)
    ap.add_argument("--fig-base", default=None)
    ap.add_argument("--out", help="output file OR directory (dir => auto <year>-<journal>-<title>.html)")
    ap.add_argument("--out-dir", help="output directory (always auto-name the report)")
    ap.add_argument("--paper-root",
                    help="parent dir; creates <root>/<year>-<journal>-<title>/ and writes report+assets there")
    ap.add_argument("--name", help="override the auto file stem (no .html needed)")
    ap.add_argument("--source-pdf", default=None,
                    help="original paper PDF; copied next to the report as RAW-<year>-<journal>-<title>.pdf")
    ap.add_argument("--no-inline", action="store_true")
    ap.add_argument("--no-qa-hook", action="store_true")
    args = ap.parse_args()

    template = Path(args.template).read_text(encoding="utf-8")
    content = strip_duplicate_section_ids(Path(args.content).read_text(encoding="utf-8"))
    meta = read_json(args.meta, {})
    figures = read_json(args.figures, [])
    if isinstance(figures, dict):
        figures = figures.get("figures", [])
    fig_base = Path(args.fig_base) if args.fig_base else Path(args.figures).parent
    inliner = Inliner(not args.no_inline)

    out_path = resolve_out_path(args, meta)
    raw_name = place_raw_pdf(args.source_pdf, out_path, meta)
    if not raw_name:
        print("[build] WARN: no RAW-*.pdf in the report folder; pass --source-pdf to ship the original PDF",
              file=sys.stderr)

    content, used = expand_figures(content, figures, inliner, [fig_base, Path(args.content).parent], raw_name)

    if inliner.enabled:
        def repl_img(m):
            data = inliner.data_uri(m.group(2), [fig_base, Path(args.content).parent])
            return m.group(1) + (data or m.group(2)) + m.group(3)

        content = IMG_RE.sub(repl_img, content)

    cover = build_cover(meta, [f for f in figures if f.get("crop")], raw_name)
    content = ensure_heading_ids(content)
    nav = build_nav(content)
    provenance = build_provenance(meta, [f for f in figures if f.get("id") in used], str(out_path), raw_name)

    normalized_metrics = []
    for m in meta.get("metrics") or []:
        normalized_metrics.append(
            {
                "value": m.get("value") or m.get("v", ""),
                "label": m.get("label") or m.get("l", ""),
                "note": m.get("note") or m.get("n", ""),
                "v": m.get("value") or m.get("v", ""),
                "l": m.get("label") or m.get("l", ""),
                "n": m.get("note") or m.get("n", ""),
            }
        )
    meta_json = dict(meta)
    meta_json["raw_pdf"] = raw_name
    meta_json["metrics"] = normalized_metrics
    meta_json["figures"] = [
        {"id": f.get("id"), "label": f.get("label"), "page": f.get("page"), "crop": f.get("crop")}
        for f in figures
    ]
    meta_json = dict(meta_json)
    meta_json.pop("_fig_base", None)

    substitutions = {
        "META_JSON": json.dumps(meta_json, ensure_ascii=False).replace("</", "<\\/"),
        "COVER": cover,
        "NAV": nav,
        "CONTENT": content,
        "PROVENANCE": provenance,
        "BUILD_DATE": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    out_html = template
    for key, value in substitutions.items():
        out_html = out_html.replace("{{%s}}" % key, value)

    leftovers = PLACEHOLDER_RE.findall(out_html)
    if leftovers:
        print("[build] WARN: unreplaced placeholders: %s" % ", ".join(sorted(set(leftovers))), file=sys.stderr)

    if not args.no_qa_hook:
        out_html = out_html.replace("</body>", QA_HOOK + "\n</body>", 1)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.parent.name != out_path.stem:
        print(
            "[build] note: output directory '%s' differs from the paper naming rule '<year>-<journal>-<title>'; "
            "use --paper-root to auto-create the matching directory"
            % out_path.parent.name,
            file=sys.stderr,
        )
    out_path.write_text(out_html, encoding="utf-8")
    size_mb = out_path.stat().st_size / 1e6
    print("[build] name rule: <year>-<journal>-<title> for both the report file and its paper directory (override with --name)")
    print(
        "[build] wrote %s (%.2f MB | %d/%d figures used | inline=%s | nav=%d items)"
        % (out_path, size_mb, len(used), len(figures), inliner.enabled, nav.count("<li"))
    )
    if size_mb > 25:
        print("[build] WARN: >25 MB; consider --no-inline or lower crop dpi/max-width", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
