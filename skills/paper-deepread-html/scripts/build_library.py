#!/usr/bin/env python3
"""Build a self-contained library index for paper-deepread-html reports.

Scans a folder of per-paper output directories (each containing
``<year>-<journal>-<title>.html``), extracts metadata + searchable text +
cover thumbnails, auto-classifies by keywords, and writes one offline
``index.html`` (plus an optional ``index.md``).

Usage:
  build_library.py --root paper-read/ [--out paper-read/index.html]
                   [--template assets/library_template.html]
                   [--title "文献精读库"] [--md paper-read/index.md]
                   [--thumb-width 360] [--max-text-per-paper 120000]
                   [--no-thumbs] [--categories my_categories.json]

PyMuPDF is optional: when importable it downscales cover crops for thumbnails;
without it the first embedded image is reused only when small, otherwise the
card falls back to a monogram block.
"""
import argparse
import base64
import datetime
import hashlib
import html
import io
import json
import mimetypes
import re
import struct
import sys
import zlib
from pathlib import Path

# Shown in the index header/footer. Bump on content or presentation changes.
LIBRARY_VERSION = "1.4.0"

META_RE = re.compile(r'<script[^>]*\bid="report-meta"[^>]*>(?P<body>.*?)</script>', re.S)
MAIN_RE = re.compile(r'<main\b[^>]*\bid="report"[^>]*>(?P<body>.*?)</main>', re.S)
SECTION_RE = re.compile(r"<section\b(?P<attrs>[^>]*)>(?P<body>.*?)</section>", re.S)
HEADING_RE = re.compile(r"<h[123]\b(?P<attrs>[^>]*)>(?P<body>.*?)</h[123]>", re.S)
TITLE_RE = re.compile(r"<title>(?P<body>.*?)</title>", re.S)
ID_RE = re.compile(r'\bid="([^"]+)"')
IMG_RE = re.compile(r"data:image/(?P<fmt>png|jpeg|webp);base64,(?P<data>[A-Za-z0-9+/=\s]+)")
READ_HEAD_RE = re.compile(r"^#\s+(.+)$", re.M)
YEAR_RE = re.compile(r"^(19|20)\d{2}$")

# Broad, explainable keyword taxonomy. Extend with --categories (JSON:
# {"分类名": ["keyword", ...]}) or per-paper meta "categories": [...]
DEFAULT_CATEGORIES = {
    "液滴微流控": ["droplet", "液滴", "emulsion", "microfluidic", "微流控"],
    "数字微流控 DMF": ["digital microfluidic", "dmf", "ewod", "electrowetting", "数字微流控", "介电润湿"],
    "单细胞与组学": ["single-cell", "single cell", "scrna", "transcriptom", "单细胞", "组学", "barcode", "条形码", "sequencing", "测序"],
    "AI 与机器学习": [
        "machine learning", "deep learning", "neural network", "artificial intelligence",
        "llm", "language model", "agent", "bayesian optimization", "xgboost",
        "机器学习", "深度学习", "人工智能", "大模型", "算法",
    ],
    "蛋白质与抗体工程": ["protein", "antibody", "enzyme", "protein design", "directed evolution", "抗体", "蛋白", "酶", "affinity"],
    "无细胞与合成生物学": ["cell-free", "cfe", "synthetic biology", "无细胞", "合成生物"],
    "药物发现与诊断": ["drug", "therapeutic", "diagnostic", "药物", "诊断", "临床", "patient"],
    "检测与传感": ["sensor", "biosensor", "detection", "传感", "检测", "fluorescence"],
}
MIN_CATEGORY_SCORE = 3.0


def replace_last(text, token, value):
    """Replace the FINAL occurrence of token.

    Templates may mention the placeholder inside their header contract comment
    (an earlier occurrence); the real slot is the last one.
    """
    idx = text.rfind(token)
    if idx < 0:
        return text
    return text[:idx] + str(value) + text[idx + len(token):]


def e(text):
    return html.escape(str(text or ""), quote=True)


def strip_tags(text):
    text = re.sub(r"<script\b.*?</script>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<style\b.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<svg\b.*?</svg>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"[ \t\r\f\v\u00a0]+", " ", text).strip()
def norm(text):
    return re.sub(r"\s+", " ", str(text or "")).strip()


def read_meta(raw):
    """First #report-meta block whose body is valid JSON (the template header
    comment also mentions the tag literally, so the first regex hit can be prose)."""
    for m in META_RE.finditer(raw):
        body = m.group("body").strip()
        if not body.startswith("{"):
            continue
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            continue
    return {}


def apply_overrides(meta, directory):
    """Optional <paper-dir>/library.json for manual curation without rebuilding.

    Supported keys: hidden, categories, tags, title, title_zh, journal, year.
    """
    path = directory / "library.json"
    if not path.exists():
        return meta
    try:
        override = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return meta
    if not isinstance(override, dict):
        return meta
    merged = dict(meta)
    for key in ("categories", "tags", "authors", "metrics"):
        if isinstance(override.get(key), list):
            merged[key] = override[key]
    for key in ("title", "title_zh", "journal", "year", "tldr", "doi"):
        if isinstance(override.get(key), str) and override[key].strip():
            merged[key] = override[key].strip()
    merged["_hidden"] = bool(override.get("hidden"))
    return merged


def find_report(directory):
    candidates = sorted(directory.glob("*.html"))
    candidates = [p for p in candidates if p.name.lower() not in ("index.html", "readme.html")]
    if not candidates:
        return None
    named = directory / (directory.name + ".html")
    return named if named in candidates else candidates[0]


def extract_sections(raw, max_text_per_paper):
    main = MAIN_RE.search(raw)
    scope = main.group("body") if main else raw
    sections = []
    total = 0
    for m in SECTION_RE.finditer(scope):
        body = m.group("body")
        attrs = m.group("attrs") or ""
        head = HEADING_RE.search(body)
        heading = strip_tags(head.group("body")) if head else ""
        if not heading:
            continue
        sid = ""
        idm = ID_RE.search(attrs)
        if idm:
            sid = idm.group(1)
        elif head:
            idm2 = ID_RE.search(head.group("attrs") or "")
            sid = idm2.group(1) if idm2 else ""
        text_body = (body[: head.start()] + body[head.end():]) if head else body
        text = strip_tags(text_body)
        if len(text) > 4000:
            text = text[:4000].rsplit(" ", 1)[0]
        if total + len(text) > max_text_per_paper:
            text = text[: max(0, max_text_per_paper - total)]
        total += len(text)
        if text:
            sections.append({"id": sid, "h": heading[:120], "t": text})
        if total >= max_text_per_paper:
            break
    if not sections:
        # fallback: whole document text minus the page chrome
        text = strip_tags(scope)
        if text:
            sections.append({"id": "", "h": "全文", "t": text[:max_text_per_paper]})
    return sections


def load_thumbnail(raw, width, enabled, cache_dir=None, cache_key=None):
    """Small JPEG thumbnail for a card (cached on disk when cache_dir is given).

    PNG thumbs are 40–80 KB each; 320 px JPEG q=82 is ~15–25 KB and keeps plots
    legible. The cache lives in <root>/.library-cache/thumbs and is keyed by
    report path + mtime + width, so unchanged reports are never re-decoded.
    """
    if not enabled:
        return None
    cache_path = None
    if cache_dir and cache_key:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            cache_path = cache_dir / (cache_key + ".jpg")
            if cache_path.exists() and cache_path.stat().st_size > 200:
                data = cache_path.read_bytes()
                return "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")
        except OSError:
            cache_path = None
    m = IMG_RE.search(raw)
    if not m:
        return None
    raw_bytes = base64.b64decode(re.sub(r"\s+", "", m.group("data")))
    fmt = m.group("fmt")
    try:
        import fitz  # PyMuPDF (optional)
        doc = fitz.open(stream=raw_bytes, filetype=fmt)
        page = doc[0]
        if page.rect.width <= 0:
            return None
        dpi = int(max(24, min(300, round(72 * width / page.rect.width))))
        pix = page.get_pixmap(dpi=dpi)
        try:
            jpg = pix.tobytes("jpg", jpg_quality=82)
            mime = "image/jpeg"
        except Exception:
            jpg = pix.tobytes("png")
            mime = "image/png"
        if cache_path:
            try:
                cache_path.write_bytes(jpg)
            except OSError:
                pass
        return "data:%s;base64,%s" % (mime, base64.b64encode(jpg).decode("ascii"))
    except Exception:
        if len(raw_bytes) <= 120_000:
            mime = mimetypes.guess_type("x." + fmt)[0] or "image/png"
            return "data:%s;base64,%s" % (mime, base64.b64encode(raw_bytes).decode("ascii"))
        return None


def classify(meta, sections, taxonomy):
    title = norm(meta.get("title"))
    title_zh = norm(meta.get("title_zh"))
    tldr = norm(meta.get("tldr"))
    tags = " ".join(meta.get("tags") or [])
    headings = " ".join(s.get("h", "") for s in sections[:14])
    body = " ".join(s.get("t", "") for s in sections[:10])[:12000]
    haystacks = [
        ((title + " " + title_zh).lower(), 3.0),
        (tags.lower(), 3.0),
        (tldr.lower(), 2.0),
        (headings.lower(), 2.0),
        (body.lower(), 1.0),
    ]
    scored = []
    for category, words in taxonomy.items():
        score = 0.0
        for word in words:
            w = str(word).lower().strip()
            if not w:
                continue
            for hay, weight in haystacks:
                if w in hay:
                    score += weight
                    break
        if score >= MIN_CATEGORY_SCORE:
            scored.append((score, category))
    scored.sort(reverse=True)
    return [c for _, c in scored[:3]]


def load_taxonomy(path):
    taxonomy = {k: list(v) for k, v in DEFAULT_CATEGORIES.items()}
    if path:
        extra = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(extra, dict):
            for key, val in extra.items():
                if isinstance(val, list):
                    taxonomy[key] = list(val)
    return taxonomy


def relative(path, base):
    try:
        return str(path.resolve().relative_to(base)).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def _year_num(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return -9999


def related_ids(paper, papers, limit=3):
    """Build-time related papers: shared tags (weight 3) + same journal (weight 2).

    The library UI renders these as 「相关」 chips on the card and scrolls to the
    target card, so the list must be stable and cheap: no full-text scoring here.
    """
    tags = {str(t).strip().lower() for t in paper.get("tags") or [] if str(t).strip()}
    journal = str(paper.get("journal") or "").strip().lower()
    by_id = {p.get("id"): p for p in papers}
    scored = []
    for other in papers:
        if other is paper or other.get("id") == paper.get("id"):
            continue
        other_tags = {str(t).strip().lower() for t in other.get("tags") or [] if str(t).strip()}
        score = len(tags & other_tags) * 3
        if journal and journal == str(other.get("journal") or "").strip().lower():
            score += 2
        if score > 0:
            scored.append((score, other.get("id")))
    # Deterministic order: score desc, newest year, then title.
    scored.sort(key=lambda row: (
        -row[0],
        -_year_num(by_id.get(row[1], {}).get("year")),
        str(by_id.get(row[1], {}).get("title") or ""),
    ))
    return [pid for _, pid in scored[:limit]]


def add_related(papers, limit=3):
    """Attach the related-id list to every paper (in place) and return papers."""
    for paper in papers:
        paper["related"] = related_ids(paper, papers, limit)
    return papers


# ---------------------------------------------------------------------------
# PWA assets: manifest.json + sw.js + PNG icons, generated next to index.html
# ---------------------------------------------------------------------------
PWA_ICON_SIZES = (192, 512)

_PNG_ICON_LAYERS = (
    # (color, x0, y0, x1, y1, radius) as fractions of the canvas size, painted
    # back to front. The mark mirrors the inline library logo (navy tile + book).
    ((13, 43, 68), 0.0, 0.0, 1.0, 1.0, 0.22),            # navy rounded tile
    ((15, 111, 103), 0.195, 0.205, 0.30, 0.795, 0.03),    # teal spine
    ((255, 253, 248), 0.285, 0.205, 0.755, 0.795, 0.045),  # cream page
    ((20, 36, 46), 0.36, 0.30, 0.66, 0.325, 0.012),        # text line 1
    ((20, 36, 46), 0.36, 0.395, 0.66, 0.42, 0.012),        # text line 2
    ((20, 36, 46), 0.36, 0.49, 0.56, 0.515, 0.012),        # text line 3 (short)
    ((164, 97, 11), 0.36, 0.62, 0.60, 0.655, 0.014),       # amber highlight
)


def _rounded_rect_hit(x, y, x0, y0, x1, y1, r):
    """Point-in-rounded-rectangle test for a pixel sample."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _blend(dst, src, coverage):
    if coverage <= 0:
        return dst
    if coverage >= 1:
        return src
    return tuple(int(round(dst[i] + (src[i] - dst[i]) * coverage)) for i in range(3))


def _icon_rgba(size):
    """Render the PWA icon (RGBA bytes per row) with supersampling."""
    samples = 4 if size <= 256 else 2
    layers = [
        (color, x0 * size, y0 * size, x1 * size, y1 * size, radius * size)
        for color, x0, y0, x1, y1, radius in _PNG_ICON_LAYERS
    ]
    total = samples * samples
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0]
            covered = 0
            for sy in range(samples):
                for sx in range(samples):
                    x = px + (sx + 0.5) / samples
                    y = py + (sy + 0.5) / samples
                    sample = None
                    for color, x0, y0, x1, y1, radius in layers:
                        if _rounded_rect_hit(x, y, x0, y0, x1, y1, radius):
                            sample = color  # topmost layer wins
                    if sample is not None:
                        covered += 1
                        acc[0] += sample[0]
                        acc[1] += sample[1]
                        acc[2] += sample[2]
            if covered:
                r, g, b = (int(round(acc[i] / covered)) for i in range(3))
            else:
                r = g = b = 0
            row.extend((r, g, b, int(round(covered * 255.0 / total))))
        rows.append(bytes(row))
    return rows


def png_bytes(width, height, rows):
    """Minimal PNG encoder (RGBA, no external deps)."""
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def write_if_changed(path, data):
    """Write bytes only when the content differs (keeps mtimes/hardlinks stable)."""
    try:
        if path.read_bytes() == data:
            return False
    except OSError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return True


def manifest_payload(title, version):
    name = "%s · Paper Deepread" % (title or "文献精读库")
    return {
        "name": name,
        "short_name": (title or "文献库")[:12],
        "description": "论文精读报告库：全文检索、收藏、引用导出与离线阅读。",
        "lang": "zh-CN",
        "dir": "ltr",
        "start_url": "./index.html",
        "scope": "./",
        "id": "./",
        "display": "standalone",
        "orientation": "any",
        "background_color": "#f5f2ea",
        "theme_color": "#0d2b44",
        "categories": ["education", "productivity"],
        "version": str(version),
        "icons": [
            {"src": "assets/pwa-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "assets/pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "assets/pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


SW_TEMPLATE = """/* Paper DeepRead library service worker · library v__VERSION__
 *
 * Generated by scripts/build_library.py — do not edit the published copy.
 * Strategy:
 *   - install: precache the app shell (index/manage/manifest/icons)
 *   - fetch:   cache-first for same-origin GET; visited report pages are cached
 *              on first read, so the library keeps working offline.
 *   - /api/* and the service worker itself are never cached.
 *   - skipWaiting + clients.claim: a new build takes over on next load.
 */
'use strict';

var VERSION = '__VERSION__';
var CACHE = 'deepread-library-v' + VERSION;
var SHELL = [
  './',
  './index.html',
  './manage.html',
  './manifest.json',
  './assets/pwa-192.png',
  './assets/pwa-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll() fails as a whole when one entry is missing; add individually.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key === CACHE) return null;
        if (key.indexOf('deepread-library-') !== 0) return null;
        return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;
  var url;
  try { url = new URL(request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (/\\.pdf$/i.test(url.pathname)) return;            // PDFs can be huge: straight to network
  if (/(^|\\/)api\\//.test(url.pathname)) return;        // never cache the management API
  if (/\\/sw\\.js$/.test(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) {
          if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
            cache.put(request, response.clone()).catch(function () {});
          }
          return response;
        }).catch(function (error) {
          if (request.mode === 'navigate') {
            return cache.match('./index.html').then(function (shell) {
              if (shell) return shell;
              throw error;
            });
          }
          throw error;
        });
      });
    })
  );
});
"""


def write_pwa_assets(out_dir, title, version):
    """Write manifest.json, sw.js and the 192/512 PNG icons next to index.html."""
    out_dir = Path(out_dir)
    written = []
    manifest_path = out_dir / "manifest.json"
    if write_if_changed(manifest_path, (json.dumps(manifest_payload(title, version),
                                                    ensure_ascii=False, indent=2) + "\n").encode("utf-8")):
        written.append(manifest_path)
    sw_path = out_dir / "sw.js"
    if write_if_changed(sw_path, SW_TEMPLATE.replace("__VERSION__", str(version)).encode("utf-8")):
        written.append(sw_path)
    for size in PWA_ICON_SIZES:
        icon_path = out_dir / "assets" / ("pwa-%d.png" % size)
        if write_if_changed(icon_path, png_bytes(size, size, _icon_rgba(size))):
            written.append(icon_path)
    return written


def collect(root, link_base, thumb_width, max_text_per_paper, use_thumbs, taxonomy, thumb_cache_dir=None):
    papers = []
    for directory in sorted(root.iterdir()):
        if not directory.is_dir() or directory.name.startswith((".", "_")):
            continue
        report = find_report(directory)
        if not report:
            continue
        raw = report.read_text(encoding="utf-8", errors="replace")
        meta = apply_overrides(read_meta(raw), directory)
        if meta.pop("_hidden", False):
            print("[library] skip hidden paper: %s" % directory.name)
            continue
        if not meta:
            readme = directory / "README.md"
            if readme.exists():
                m = READ_HEAD_RE.search(readme.read_text(encoding="utf-8", errors="replace"))
                meta = {"title": m.group(1).strip() if m else report.stem}
        title = norm(meta.get("title")) or norm(strip_tags(TITLE_RE.search(raw).group("body")) if TITLE_RE.search(raw) else "") or report.stem
        year = str(meta.get("year") or "")
        if not YEAR_RE.match(year):
            m = YEAR_RE.search(report.stem[:5])
            year = m.group(0) if m else ""
        sections = extract_sections(raw, max_text_per_paper)
        categories = meta.get("categories") if isinstance(meta.get("categories"), list) else None
        categories = [str(c) for c in categories] if categories else classify(meta, sections, taxonomy)
        entry = {
            "id": directory.name,
            "dir": relative(directory, link_base).rstrip("/") + "/",
            "html": relative(report, link_base),
            "pdf": None,
            "raw": None,
            "raw_name": "",
            "title": title,
            "title_zh": norm(meta.get("title_zh")),
            "journal": norm(meta.get("journal")),
            "year": year,
            "authors": [norm(a) for a in (meta.get("authors") or [])][:12],
            "doi": norm(meta.get("doi")),
            "tags": [norm(t) for t in (meta.get("tags") or [])][:10],
            "tldr": norm(meta.get("tldr")),
            "metrics": [
                {"value": norm(m.get("value") or m.get("v")), "label": norm(m.get("label") or m.get("l")),
                 "note": norm(m.get("note") or m.get("n"))}
                for m in (meta.get("metrics") or [])[:4]
            ],
            "figures": len(meta.get("figures") or []) or raw.count('class="paper-fig"'),
            "claims": raw.count('class="ev"'),
            "sections": len(sections),
            "categories": categories,
            "updated": datetime.date.fromtimestamp(report.stat().st_mtime).isoformat(),
            "thumb": load_thumbnail(
                raw, thumb_width, use_thumbs,
                cache_dir=thumb_cache_dir,
                cache_key=(
                    hashlib.sha1(
                        ("%s|%s|%s|%s" % (report.resolve(), report.stat().st_size,
                                           report.stat().st_mtime_ns, thumb_width)).encode("utf-8")
                    ).hexdigest()[:20]
                    if thumb_cache_dir else None
                ),
            ),
            "text": sections,
        }
        pdf = report.with_suffix(".pdf")
        if pdf.exists():
            entry["pdf"] = relative(pdf, link_base)
        raws = sorted(directory.glob("RAW-*.pdf"))
        if raws:
            entry["raw"] = relative(raws[0], link_base)
            entry["raw_name"] = raws[0].name
        papers.append(entry)
    papers.sort(key=lambda p: (p.get("year") or "0000", p.get("updated") or ""), reverse=True)
    return papers


def build_payload(root, link_base, thumb_width=320, max_text_per_paper=120000,
                  use_thumbs=True, taxonomy=None, thumb_cache_dir=None):
    """Collect papers + stats. Shared by the CLI builder and serve_library.py."""
    if taxonomy is None:
        taxonomy = {k: list(v) for k, v in DEFAULT_CATEGORIES.items()}
    papers = collect(root, Path(link_base), thumb_width, max_text_per_paper,
                     use_thumbs, taxonomy, Path(thumb_cache_dir) if thumb_cache_dir else None)
    add_related(papers)
    return {"papers": papers, "stats": build_stats(papers)}


def build_stats(papers):
    years = sorted({p["year"] for p in papers if p.get("year")})
    journals = sorted({p["journal"] for p in papers if p.get("journal")})
    categories = sorted({c for p in papers for c in p.get("categories") or []})
    return {
        "n": len(papers),
        "years": years,
        "journals": journals,
        "categories": categories,
        "updated": datetime.date.today().isoformat(),
    }


def write_markdown(path, papers, stats, title, version=""):
    ver = (" v%s" % version.lstrip("v")) if version else ""
    lines = ["# %s%s" % (title, ver), "",
             "> 自动生成于 %s · 共 %d 篇 · 版本%s" % (stats["updated"], stats["n"], ver or " —"), ""]
    by_cat = {}
    for paper in papers:
        cats = paper.get("categories") or ["未分类"]
        for cat in cats:
            by_cat.setdefault(cat, []).append(paper)
    for cat in sorted(by_cat):
        lines += ["## %s（%d）" % (cat, len(by_cat[cat])), ""]
        lines += ["| 年份 | 期刊 | 标题 | 报告 | 原文 PDF |", "|---|---|---|---|---|"]
        for p in by_cat[cat]:
            name = p.get("title_zh") or p.get("title") or p["id"]
            links = "[HTML](<%s>)" % p["html"]
            raw = p.get("raw")
            lines.append(
                "| %s | %s | %s | %s | %s |"
                % (
                    p.get("year", ""),
                    p.get("journal", ""),
                    name.replace("|", "\\|"),
                    links,
                    ("[RAW](<%s>)" % raw) if raw else "—",
                )
            )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent
    ap.add_argument("--root", default="paper-read", help="folder containing per-paper output directories")
    ap.add_argument("--out", default=None, help="index html path (default <root>/index.html)")
    ap.add_argument("--template", default=str(here.parent / "assets" / "library_template.html"))
    ap.add_argument("--title", default="文献精读库")
    ap.add_argument("--version", default=LIBRARY_VERSION,
                    help="library version shown in the index header/footer (default %s)" % LIBRARY_VERSION)
    ap.add_argument("--md", default=None, help="optional markdown index path (default <root>/index.md; '' disables)")
    ap.add_argument("--thumb-width", type=int, default=360)
    ap.add_argument("--max-text-per-paper", type=int, default=120000)
    ap.add_argument("--no-thumbs", action="store_true")
    ap.add_argument("--no-thumb-cache", action="store_true",
                    help="do not cache JPEG thumbnails in <root>/.library-cache/thumbs")
    ap.add_argument("--cache-dir", default=None,
                    help="thumbnail cache dir (default <root>/.library-cache/thumbs)")
    ap.add_argument("--categories", default=None, help="JSON file extending/overriding the keyword taxonomy")
    ap.add_argument("--no-pwa", action="store_true",
                    help="do not write manifest.json / sw.js / PWA icons next to the index")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        sys.exit("[library] root not found: %s" % root)
    template_path = Path(args.template)
    if not template_path.exists():
        sys.exit("[library] template not found: %s (pass --template)" % template_path)
    out = Path(args.out).resolve() if args.out else root / "index.html"
    link_base = out.parent
    taxonomy = load_taxonomy(args.categories)
    thumb_cache_dir = None
    if not args.no_thumbs and not args.no_thumb_cache:
        thumb_cache_dir = Path(args.cache_dir) if args.cache_dir else (root / ".library-cache" / "thumbs")
    papers = collect(root, link_base, args.thumb_width, args.max_text_per_paper,
                     not args.no_thumbs, taxonomy, thumb_cache_dir)
    add_related(papers)
    if not papers:
        sys.exit("[library] no reports found under %s" % root)
    stats = build_stats(papers)
    stats["version"] = str(args.version)

    # Escape "<" as \u003c so paper text containing "</script>" cannot break the page.
    data = (
        json.dumps({"papers": papers, "stats": stats}, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
    out_html = template_path.read_text(encoding="utf-8")
    out_html = replace_last(out_html, "{{LIBRARY_TITLE}}", str(args.title))
    out_html = replace_last(out_html, "{{BUILD_DATE}}", stats["updated"])
    out_html = replace_last(out_html, "{{LIBRARY_VERSION}}", str(args.version))
    out_html = replace_last(out_html, "{{LIBRARY_JSON}}", data)
    leftover = re.findall(r"\{\{[A-Z_]+\}\}", out_html)
    if leftover:
        print("[library] WARN: unreplaced placeholders: %s" % sorted(set(leftover)))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(out_html, encoding="utf-8")

    if not args.no_pwa:
        for path in write_pwa_assets(out.parent, args.title, str(args.version)):
            print("[library] pwa asset -> %s" % path)

    md = Path(args.md) if args.md else root / "index.md"
    if str(args.md) != "":
        write_markdown(md, papers, stats, args.title, str(args.version))

    size_mb = out.stat().st_size / 1e6
    print("[library] v%s · %d reports · %d categories · %.2f MB → %s"
          % (args.version, len(papers), len(stats["categories"]), size_mb, out))
    for p in papers:
        print("  - %-4s %-28s %s" % (p.get("year", "?"), p.get("journal", "")[:28], p.get("title", "")[:60]))
    print("[library] categories: %s" % ", ".join(stats["categories"]))
    if str(args.md) != "":
        print("[library] markdown index → %s" % md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
