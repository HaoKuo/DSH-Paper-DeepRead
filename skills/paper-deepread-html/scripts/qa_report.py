#!/usr/bin/env python3
"""Headless QA for a built deep-read report.

Runs the report in Chrome (file://), collects the injected self-QA JSON
(<script id="qa-report">), takes screenshots at desktop/mobile widths plus a
full print-to-PDF, and writes qa.json + a pass/fail summary.

Usage:
  qa_report.py --report work/demo/report.html [--out work/demo/qa]
               [--widths 1440,390] [--chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
               [--no-screenshots] [--max-mb 25] [--pdf-out PATH]

The print PDF is written next to the HTML with the same basename
(<year>-<journal>-<title>.pdf) unless --pdf-out overrides it.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
QA_RE = re.compile(
    r'<script(?P<attrs>[^>]*\bid="qa-report"[^>]*)>(?P<body>.*?)</script>', re.S
)
# Only *resource* URLs count (never plain <a href> hyperlinks).
RES_SRC_RE = re.compile(r'\bsrc="(?P<url>https?://[^"]+)"', re.I)
RES_LINK_RE = re.compile(r'<link\b[^>]*\bhref="(?P<url>https?://[^"]+)"', re.I)
RES_CSS_RE = re.compile(r'url\(\s*["\']?(?P<url>https?://[^)"\']+)', re.I)
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_]+\}\}")


def chrome_bin(explicit=None):
    if explicit:
        return explicit
    for cand in (
        os.environ.get("CHROME"),
        DEFAULT_CHROME,
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("chromium"),
    ):
        if cand and Path(cand).exists():
            return str(cand)
    return None


def run(cmd, timeout=120):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None


def dump_dom(chrome, url):
    """Run Chrome headless and return the post-JS DOM."""
    with tempfile.TemporaryDirectory() as tmp:
        prof = Path(tmp) / "profile"
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--no-first-run",
            "--no-default-browser-check",
            "--allow-file-access-from-files",
            "--user-data-dir=%s" % prof,
            "--virtual-time-budget=6000",
            "--dump-dom",
            url,
        ]
        proc = run(cmd, timeout=90)
        return proc.stdout if proc else ""


def _crop_png_to_width(path, css_width, emulated_css_width=500):
    """Crop a screenshot of a 500px-wide wrapper down to the emulated CSS width."""
    try:
        import fitz
    except Exception:
        return
    try:
        doc = fitz.open(str(path))
        page = doc[0]
        ratio = css_width / float(emulated_css_width)
        clip = fitz.Rect(0, 0, page.rect.width * ratio, page.rect.height)
        page.get_pixmap(clip=clip, dpi=96).save(str(path))
    except Exception:
        pass


def screenshot(chrome, url, out_png, width, height=2600):
    """Viewport screenshot.

    Chrome clamps its window width to 500px, so narrower "mobile" widths are emulated
    with an exactly-sized iframe inside a 500px wrapper, then cropped back to the
    requested width. The embedded document really lays out at `width` CSS px.
    """
    out_png = Path(out_png).resolve()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    wrapper = None
    target_url = url
    win_w = max(width, 500)
    if width < 500:
        wrapper = out_png.parent / ("_wrap-%s.html" % out_png.stem)
        wrapper.write_text(
            '<!doctype html><html><head><meta charset="utf-8">'
            '<style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}'
            'iframe{display:block;width:%dpx;height:%dpx;border:0}</style></head>'
            '<body><iframe src="%s" scrolling="no"></iframe></body></html>'
            % (width, height, url),
            encoding="utf-8",
        )
        target_url = wrapper.as_uri()
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--allow-file-access-from-files",
        "--virtual-time-budget=6000",
        "--window-size=%d,%d" % (win_w, height),
        "--screenshot=%s" % out_png,
        target_url,
    ]
    run(cmd, timeout=90)
    if wrapper is not None:
        try:
            wrapper.unlink()
        except OSError:
            pass
        if out_png.exists():
            _crop_png_to_width(out_png, width)
    return out_png.exists() and out_png.stat().st_size > 1000


def inject_shot(chrome, report_path, out_png, width, scroll_id=None, theme=None,
                extra_js="", height=2600):
    """Screenshot a temporary copy of the report with JS applied after load.

    Chrome's --screenshot does not render file:// URLs that carry ?query or #hash,
    so section/theme states are forced from an injected inline script instead.
    """
    src = Path(report_path)
    html = src.read_text(encoding="utf-8", errors="replace")
    lines = []
    if theme in ("dark", "light"):
        lines.append("document.documentElement.setAttribute('data-theme','%s');" % theme)
    if scroll_id:
        lines.append(
            "document.documentElement.style.scrollBehavior='auto';"
            "document.body.style.scrollBehavior='auto';"
            "var el=document.getElementById(%r);"
            "if(el){window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top+window.pageYOffset-72));}"
            % scroll_id
        )
    if extra_js:
        lines.append(extra_js)
    inline = "".join(lines)
    script = (
        "<script>(function(){%s})();"
        "window.addEventListener('load',function(){%s});</script>" % (inline, inline)
    )
    tmp = src.parent / (".qa-shot-%s.html" % out_png.stem)
    tmp.write_text(html.replace("</body>", script + "\n</body>", 1), encoding="utf-8")
    try:
        return screenshot(chrome, tmp.as_uri(), out_png, width, height=height)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


def print_pdf(chrome, url, out_pdf):
    out_pdf.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--allow-file-access-from-files",
        "--virtual-time-budget=6000",
        "--no-pdf-header-footer",
        "--print-to-pdf=%s" % out_pdf,
        url,
    ]
    proc = run(cmd, timeout=90)
    return out_pdf.exists() and out_pdf.stat().st_size > 1000


def render_pdf_pages(pdf_path, out_dir, max_pages=48, dpi=110):
    """Render the print PDF to PNG pages for visual review. Returns page count."""
    try:
        import fitz  # PyMuPDF, optional
    except Exception:
        return None
    try:
        doc = fitz.open(str(pdf_path))
        n = min(doc.page_count, max_pages)
        for i in range(n):
            pix = doc[i].get_pixmap(dpi=dpi)
            pix.save(str(out_dir / ("print-p%02d.png" % (i + 1))))
        return doc.page_count
    except Exception:
        return None


def parse_qa(dump):
    """Return the first #qa-report block whose body is valid JSON.

    The template's header comment also contains the literal markup, so the first
    regex hit can be the comment; iterate instead of trusting the first match.
    """
    for m in QA_RE.finditer(dump):
        body = m.group("body").strip()
        body = (body.replace("&quot;", '"').replace("&amp;", "&")
                    .replace("&lt;", "<").replace("&gt;", ">"))
        if not body.startswith("{"):
            continue
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--out", default=None, help="QA output dir (default: <report dir>/qa)")
    ap.add_argument("--widths", default="1440,390")
    ap.add_argument("--chrome", default=None)
    ap.add_argument("--no-screenshots", action="store_true")
    ap.add_argument("--max-mb", type=float, default=25.0)
    ap.add_argument("--pdf-out", default=None,
                    help="print-PDF path (default: same folder/basename as the report, .pdf)")
    ap.add_argument("--shots-per-page", type=int, default=8)
    args = ap.parse_args()

    report = Path(args.report).resolve()
    if not report.exists():
        sys.exit(f"[qa] report not found: {report}")
    out_dir = Path(args.out) if args.out else report.parent / "qa"
    out_dir.mkdir(parents=True, exist_ok=True)
    url = report.as_uri()
    raw = report.read_text(encoding="utf-8", errors="replace")
    size_mb = report.stat().st_size / 1e6

    failures, warnings = [], []

    # ---- static checks -------------------------------------------------
    static_http = (
        RES_SRC_RE.findall(raw) + RES_LINK_RE.findall(raw) + RES_CSS_RE.findall(raw)
    )
    placeholders = sorted(set(PLACEHOLDER_RE.findall(raw)))
    if placeholders:
        failures.append("unreplaced template placeholders: %s" % ", ".join(placeholders))
    if static_http:
        failures.append("%d external resource URL(s) (must be offline): %s" % (len(static_http), static_http[:3]))
    if size_mb > args.max_mb:
        warnings.append("report is %.1f MB (> %.1f MB)" % (size_mb, args.max_mb))
    if not re.search(r"<html[^>]*\blang=", raw):
        warnings.append("<html> has no lang attribute")
    if "<title>" not in raw:
        warnings.append("missing <title>")
    inline_imgs = raw.count("data:image")
    local_imgs = len(re.findall(r'<img\b[^>]*src="(?!data:|https?:|#)', raw))
    if local_imgs and not inline_imgs:
        warnings.append("%d non-inlined <img> refs (single-file delivery expects data: URIs)" % local_imgs)

    chrome = chrome_bin(args.chrome)
    qa = None
    shots = []
    pdf_path = None
    if chrome is None:
        warnings.append("Chrome not found: skipped runtime QA and screenshots")
    else:
        dump = dump_dom(chrome, url)
        (out_dir / "dom.html").write_text(dump, encoding="utf-8")
        qa = parse_qa(dump)
        if qa is None:
            failures.append("self-QA hook missing from rendered DOM (build without --no-qa-hook?)")
        else:
            if qa.get("error"):
                failures.append("self-QA script error: %s" % qa["error"])
            broken = (qa.get("images") or {}).get("broken") or []
            if broken:
                failures.append("broken images: %s" % broken[:6])
            if qa.get("externalResources"):
                failures.append("external resources at runtime: %s" % qa["externalResources"][:4])
            if qa.get("overflowCount"):
                (warnings if qa.get("width", 1440) < 900 else failures).append(
                    "horizontal overflow in %d element(s): %s" % (qa["overflowCount"], qa.get("overflow", [])[:6])
                )
            if not qa.get("hasToc"):
                warnings.append("no #toc element")
            if not qa.get("hasLightbox"):
                warnings.append("no lightbox element (figure zoom unavailable)")
            for counter, label in ((("figures"), "figures"), (("svg"), "inline SVG"), (("claims"), "claim chips")):
                if not qa.get(counter):
                    warnings.append("0 %s in report" % label)
            if qa.get("schematics") is None:
                pass
            qa["width"] = qa.get("width") or args.widths.split(",")[0]

        if not args.no_screenshots:
            widths = [int(w) for w in args.widths.split(",") if w.strip()]
            for width in widths:
                name = "shot-%d-top.png" % width
                target = out_dir / name
                if inject_shot(chrome, report, target, width):
                    shots.append(str(target))
                else:
                    warnings.append("screenshot failed: %s" % name)
            # explicit light + dark top shots (OS theme may be either)
            for theme in ("light", "dark"):
                target = out_dir / ("shot-1440-top-%s.png" % theme)
                if inject_shot(chrome, report, target, widths[0], theme=theme):
                    shots.append(str(target))
            # tall screen shot: whole page as far as Chrome's texture limit allows
            tall = out_dir / "shot-1440-tall.png"
            if inject_shot(chrome, report, tall, widths[0], height=14000):
                shots.append(str(tall))

        pdf_path = Path(args.pdf_out) if args.pdf_out else report.with_name(report.stem + ".pdf")
        if print_pdf(chrome, url, pdf_path):
            pages = render_pdf_pages(pdf_path, out_dir)
            if pages is not None:
                if qa is None:
                    qa = {}
                qa["printPages"] = pages
                if pages > 60:
                    warnings.append("print PDF has %d pages" % pages)
            else:
                warnings.append("could not render print PDF pages (PyMuPDF unavailable)")
            shots.extend(str(p) for p in sorted(out_dir.glob("print-p*.png")))
        else:
            warnings.append("print-to-PDF failed")


    result = {
        "report": str(report),
        "sizeMB": round(size_mb, 2),
        "static": {
            "placeholders": placeholders,
            "externalResourceUrls": static_http[:10],
            "inlineImages": inline_imgs,
            "nonInlinedImages": local_imgs,
        },
        "runtime": qa,
        "screenshots": shots,
        "printPdf": str(pdf_path) if pdf_path and pdf_path.exists() else None,
        "failures": failures,
        "warnings": warnings,
        "ok": not failures,
    }
    (out_dir / "qa.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print("[qa] %s — %.2f MB" % (report.name, size_mb))
    if qa:
        print(
            "[qa] images=%s/%s broken, figures=%s, svg=%s, schematics=%s, claims=%s, sections=%s, height=%spx, theme=%s"
            % (
                (qa.get("images") or {}).get("total"),
                len((qa.get("images") or {}).get("broken") or []),
                qa.get("figures"),
                qa.get("svg"),
                qa.get("schematics"),
                qa.get("claims"),
                qa.get("sections"),
                qa.get("height"),
                qa.get("theme"),
            )
        )
    for f in failures:
        print("[qa] FAIL: %s" % f)
    for w in warnings:
        print("[qa] warn: %s" % w)
    if shots:
        print("[qa] screenshots: %s" % ", ".join(Path(s).name for s in shots))
    print("[qa] wrote %s" % (out_dir / "qa.json"))
    print("[qa] RESULT: %s" % ("PASS" if not failures else "FAIL"))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
