#!/usr/bin/env python3
"""paper_ingest.py - PDF -> text, figure captions, figure/table crops, debug overlays.

Part of the ``paper-deepread-html`` skill.  Dependency-light on purpose:
Python 3.9+ standard library plus PyMuPDF (``import fitz``).  Nothing else.

Usage
-----
    python paper_ingest.py PAPER.pdf --out OUTDIR [options]

Options
-------
    --dpi N            render resolution for crops (default 220)
    --max-width N      crop pixel size cap, applied to max(width, height) (default 1600)
    --pages SPEC       pages to scan: "1-13", "1,3,5", "2-4,7" (default: all)
    --list             print a compact caption table and exit (no files written)
    --only IDS         comma separated ids to emit/render, e.g. "fig1,fig3"
    --bbox SPEC        override a region, "fig2=x0,y0,x1,y1" (repeatable)
    --debug            verbose detection diagnostics + debug/detect.json
    --no-crop          skip PNG rendering (figures.json still written; width/height null)
    --with-caption     include the caption strip in crops

Outputs (inside --out)
-----------------------
    text.md                 extracted text, page markers ``<!-- page N -->``
    meta.json               {title, authors[], journal, year, doi, n_pages,
                             pdf_sha256, source_path}
    figures.json            one entry per figure/table caption (see README/spec)
    captions.txt            id <tab> p.N <tab> label <tab> caption (one line)
    tables.md               best-effort markdown of captioned tables
    assets/figN.png         rendered crops (tables: assets/tabN.png)
    debug/figN-overlay.png  page render + red crop bbox + blue caption bbox
    debug/contact-sheet.png all crops with labels, for fast visual QA
    debug/detect.json       (only with --debug) detection diagnostics

Region detection notes
----------------------
The figure drawing area is the union of embedded-image boxes
(``page.get_image_info``) and vector drawing boxes (``page.get_drawings``),
with page furniture (header/footer rules, full-page backgrounds, hairlines)
filtered out.  Boxes are clustered by vertical gap inside inferred column
bands, and the cluster adjacent to the caption (same column, above the
caption for figures, usually below it for tables) is selected.  When the
result is uncertain the entry is still written with best-effort bbox,
``"detect": "manual"`` and explanatory ``warnings`` - the agent is expected
to inspect ``debug/contact-sheet.png`` and repair with
``--bbox "figN=x0,y0,x1,y1"``.

Exit codes: 0 ok (even when no figures found), 2 bad usage / unreadable PDF.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Iterable, Optional

try:
    import fitz  # PyMuPDF
except Exception as exc:  # pragma: no cover - environment guard
    sys.stderr.write(
        "error: PyMuPDF (fitz) is not importable (%s).\n"
        "       Use the skill's venv, e.g. $(scripts/setup_env.sh --print-python), "
        "or ~/.cache/paper-deepread/venv/bin/python.\n" % exc
    )
    raise SystemExit(2)


# --------------------------------------------------------------------------
# Tunables (PDF points; 1 pt = 1/72 inch)
# --------------------------------------------------------------------------
CROP_PAD = 5.0                 # padding around detected region
CAPTION_GAP_TRIM = 1.5         # keep this much clear space before caption
FIG_MERGE_VGAP = 14.0          # vertical gap for clustering boxes
FIG_MERGE_HGAP = 36.0          # horizontal gap for clustering boxes
EXTEND_HGAP = 60.0             # horizontal gap when extending a chosen cluster
EXTEND_VGAP = 30.0             # vertical gap when extending a chosen cluster
ATTACH_SMALL_GAP = 16.0        # tiny glyph boxes attach within this gap
MAX_CAPTION_SEARCH = 0.20      # fraction of page height searched for content
TOP_BAND = 0.050               # page furniture bands (fractions of height)
BOTTOM_BAND = 0.950
TEXT_REF_MAX_GAP = 28.0        # text labels further than this are not pulled in

# caption patterns -----------------------------------------------------------
CAPTION_RE = re.compile(
    r"""^\s*
    (?P<prefix>(?:Extended\s+Data|Extended\s+Table|Supplementary|Supplemental|
                 Supporting|Suppl\.?)\s+)?
    (?P<kind>Fig(?:ure)?s?|Tables?)
    \b\s*[.:]?\s*
    (?P<num>S?\d+[a-z]?)
    (?P<tail>(?:\s*[.:|)\u2014\u2013\u2012-].*)|(?:\s+.*)|(?:\s*$))
    """,
    re.IGNORECASE | re.VERBOSE,
)
# "Fig. 1 shows that ..." style in-text references must NOT become captions
REF_VERB_RE = re.compile(
    r"^\s*[.:|)\u2014\u2013-]?\s*"
    r"(?:shows?|illustrates?|depicts?|displays?|presents?|summari[sz]es?|"
    r"reports?|indicates?|demonstrates?|compares?|lists?|describes?)\b",
    re.IGNORECASE,
)
SI_FILE_RE = re.compile(
    r"^\(\s*(?:TIFF?|DOCX?|PDF|AVI|MOV|MP4|XLSX?|XLS|CSV|ZIP|PNG|JPG|JPEG|TIF|"
    r"PPTX?|TXT|GZ|BAM|FASTQ)\s*\)\s*$",
    re.IGNORECASE,
)
NOISE_LINE_RE = re.compile(
    r"^(?:article|research article|author manuscript|hhs public access|"
    r"users may view, print, copy|downloaded from|this article is protected|"
    r"check for updates|page \d+|cao et al\. page \d+|"
    r"nature\. author manuscript.*|author manuscript; available.*|"
    r"plos one \| www\.plosone\.org.*|"
    r"1234567890\(\):,;)$",
    re.IGNORECASE,
)
DOI_RE = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")
YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")
JOURNALS = [
    "Nature Communications", "Nature Methods", "Nature Biotechnology", "Nature Cell Biology",
    "Nature Chemical Biology", "Nature Genetics", "Nature Medicine", "Nature Neuroscience",
    "Nature Immunology", "Nature Structural & Molecular Biology", "Nature",
    "Science Advances", "Science Immunology", "Science Signaling", "Science Translational Medicine",
    "Science", "Cell Reports", "Cell Stem Cell", "Cell Systems", "Cell Chemical Biology",
    "Cell Host & Microbe", "Developmental Cell", "Molecular Cell", "Current Biology", "Cell",
    "eLife", "PLOS ONE", "PLoS ONE", "PLOS Biology", "PLOS Genetics", "PLOS Computational Biology",
    "Proceedings of the National Academy of Sciences", "PNAS", "EMBO Journal", "EMBO Reports",
    "Journal of the American Chemical Society", "Angewandte Chemie", "Nucleic Acids Research",
    "Genome Biology", "Genome Research", "Bioinformatics", "Lab on a Chip", "Analytical Chemistry",
    "Advanced Materials", "ACS Nano", "Nano Letters", "PNAS Nexus", "Trends in Biotechnology",
]


# --------------------------------------------------------------------------
# Small data containers
# --------------------------------------------------------------------------
@dataclass
class TextBlock:
    rect: "fitz.Rect"
    text: str
    first_line: str
    n_lines: int
    size: float          # dominant font size (weighted median)
    max_size: float      # largest span size (bold labels etc.)
    lines: list = field(default_factory=list)   # raw per-line text
    is_caption: bool = False


@dataclass
class Layout:
    mode: str = "one"           # "one" | "two"
    gutter: float = 0.0         # x of the central gutter (two column)
    left: tuple = (0.0, 0.0)    # (x0, x1) left column band
    right: tuple = (0.0, 0.0)
    margin_left: float = 0.0
    margin_right: float = 0.0


@dataclass
class Item:
    rect: "fitz.Rect"
    kind: str = "draw"          # "image" | "draw"
    small: bool = False
    band: str = "F"


@dataclass
class Cluster:
    rect: "fitz.Rect"
    items: list = field(default_factory=list)
    band: str = "F"
    n_img: int = 0
    n_draw: int = 0
    img_area: float = 0.0
    draw_area: float = 0.0

    def add(self, it: Item) -> None:
        if self.items:
            self.rect |= it.rect
        else:
            self.rect = fitz.Rect(it.rect)
        self.items.append(it)
        if it.kind == "image":
            self.n_img += 1
            self.img_area += max(0.0, it.rect.width) * max(0.0, it.rect.height)
        else:
            self.n_draw += 1
            self.draw_area += max(0.0, it.rect.width) * max(0.0, it.rect.height)

    def recompute_band(self) -> None:
        bands = {it.band for it in self.items}
        if "F" in bands:
            self.band = "F"
        elif bands == {"L"}:
            self.band = "L"
        elif bands == {"R"}:
            self.band = "R"
        else:
            self.band = "F"


@dataclass
class Caption:
    label: str
    kind: str                   # "figure" | "table"
    page_no: int                # 1-based
    rect: "fitz.Rect"
    blocks: list = field(default_factory=list)
    text: str = ""
    size: float = 8.0
    id: str = ""
    region: Optional["fitz.Rect"] = None
    clip: Optional["fitz.Rect"] = None
    detect: str = ""
    direction: str = ""
    gap: float = -1.0
    warnings: list = field(default_factory=list)
    manual: bool = False
    n_img: int = 0
    n_draw: int = 0
    table_md: str = ""


@dataclass
class PageInfo:
    page: "fitz.Page"
    page_no: int
    rect: "fitz.Rect"
    blocks: list
    layout: Layout
    clusters: list
    body_size: float
    captions: list = field(default_factory=list)


# --------------------------------------------------------------------------
# Basic helpers
# --------------------------------------------------------------------------
def _r(rect: "fitz.Rect") -> list:
    return [round(float(rect.x0), 2), round(float(rect.y0), 2),
            round(float(rect.x1), 2), round(float(rect.y1), 2)]


def _median(values: Iterable[float]) -> float:
    vals = list(values)
    return statistics.median(vals) if vals else 0.0


def _clamp_rect(rect: "fitz.Rect", bounds: "fitz.Rect") -> "fitz.Rect":
    r = fitz.Rect(rect)
    r.x0 = max(bounds.x0, r.x0)
    r.y0 = max(bounds.y0, r.y0)
    r.x1 = min(bounds.x1, r.x1)
    r.y1 = min(bounds.y1, r.y1)
    if r.x1 < r.x0:
        r.x1 = r.x0
    if r.y1 < r.y0:
        r.y1 = r.y0
    return r


def _x_overlap(a: "fitz.Rect", b: "fitz.Rect") -> float:
    return max(0.0, min(a.x1, b.x1) - max(a.x0, b.x0))


def _area(r: "fitz.Rect") -> float:
    return max(0.0, r.width) * max(0.0, r.height)


def _intersection_area(a: "fitz.Rect", b: "fitz.Rect") -> float:
    return _area(fitz.Rect(max(a.x0, b.x0), max(a.y0, b.y0),
                           min(a.x1, b.x1), min(a.y1, b.y1)))


_LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi",
    "\ufb04": "ffl", "\ufb05": "ft", "\ufb06": "st", "\u00ad": "",
}


def _norm_text(text: str) -> str:
    for bad, good in _LIGATURES.items():
        text = text.replace(bad, good)
    return text


def _join_lines(lines: list) -> str:
    """Join PDF text lines, undoing end-of-line hyphenation + ligatures."""
    lines = [_norm_text(ln) for ln in lines]
    out = ""
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if not out:
            out = ln
        elif out.endswith("-") and re.search(r"[a-z]$", out[:-1]) and ln[:1].islower():
            out = out[:-1] + ln
        elif out.endswith("\u00ad"):       # soft hyphen
            out = out[:-1] + ln
        else:
            out = out + " " + ln
    return re.sub(r"[ \t]+", " ", out).strip()


def _block_size(block: dict) -> tuple:
    """Return (weighted median size, max size) for a raw PyMuPDF text block."""
    sizes = {}
    for ln in block.get("lines", []):
        for sp in ln.get("spans", []):
            txt = sp.get("text", "")
            size = round(float(sp.get("size", 0.0)) * 2) / 2.0
            if not txt.strip():
                continue
            sizes[size] = sizes.get(size, 0) + len(txt)
    if not sizes:
        return 0.0, 0.0
    total = sum(sizes.values())
    acc = 0
    median = max(sizes)
    for size in sorted(sizes):
        acc += sizes[size]
        if acc >= total / 2.0:
            median = size
            break
    return median, max(sizes)


def _raw_blocks(page: "fitz.Page") -> list:
    try:
        data = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    except Exception:
        data = page.get_text("dict")
    out = []
    for b in data.get("blocks", []):
        if b.get("type", 0) != 0:
            continue
        lines = [ln for ln in b.get("lines", []) if ln.get("spans")]
        if not lines:
            continue
        out.append({"rect": fitz.Rect(b["bbox"]), "lines": lines})
    return out


def _line_text(line: dict) -> str:
    return "".join(sp.get("text", "") for sp in line.get("spans", [])).strip()


def _make_blocks(raw_blocks: list, page_rect: "fitz.Rect") -> list:
    blocks = []
    for rb in raw_blocks:
        lines = [ln for ln in rb["lines"] if ln.get("spans")]
        if not lines:
            continue
        # Some PDFs put several captions (or captions of side-by-side figures)
        # into one text block.  Split a block when a later line starts with a
        # caption label; each piece keeps its own geometry.
        groups = [[lines[0]]]
        for ln in lines[1:]:
            txt = _line_text(ln)
            same_row = abs(float(ln["bbox"][1]) - float(groups[0][0]["bbox"][1])) < 4.0
            if txt and same_row and _caption_head(txt):
                groups.append([ln])
            else:
                groups[-1].append(ln)
        for group in groups:
            line_texts = [_line_text(ln) for ln in group]
            text = _join_lines(line_texts)
            if not text:
                continue
            rect = fitz.Rect(group[0]["bbox"])
            for ln in group[1:]:
                rect |= fitz.Rect(ln["bbox"])
            sizes = {}
            for ln in group:
                for sp in ln.get("spans", []):
                    t = sp.get("text", "")
                    if not t.strip():
                        continue
                    s = round(float(sp.get("size", 0.0)) * 2) / 2.0
                    sizes[s] = sizes.get(s, 0) + len(t)
            if sizes:
                total = sum(sizes.values())
                acc = 0
                med = max(sizes)
                for s in sorted(sizes):
                    acc += sizes[s]
                    if acc >= total / 2.0:
                        med = s
                        break
                max_size = max(sizes)
            else:
                med, max_size = 0.0, 0.0
            blocks.append(TextBlock(
                rect=rect, text=text,
                first_line=line_texts[0] if line_texts else text,
                n_lines=len(group), size=med, max_size=max_size,
                lines=line_texts,
            ))
    return blocks


def _band_of(rect: "fitz.Rect", layout: Layout, page_rect: "fitz.Rect") -> str:
    if layout.mode != "two":
        return "F"
    if rect.width > 0.62 * page_rect.width:
        return "F"
    if rect.x0 < layout.gutter - 3 and rect.x1 > layout.gutter + 3:
        return "F"
    if rect.x1 <= layout.gutter + 3:
        return "L"
    if rect.x0 >= layout.gutter - 3:
        return "R"
    return "F"


def _in_furniture(rect: "fitz.Rect", page_rect: "fitz.Rect") -> bool:
    H = page_rect.height
    return rect.y1 <= page_rect.y0 + TOP_BAND * H or rect.y0 >= page_rect.y0 + BOTTOM_BAND * H


# --------------------------------------------------------------------------
# Page layout / columns
# --------------------------------------------------------------------------
def infer_columns(page_rect: "fitz.Rect", blocks: list) -> Layout:
    W = page_rect.width
    body = [b for b in blocks
            if b.n_lines >= 2 and 6.0 <= b.size <= 14.0
            and 0.12 * W < b.rect.width < 0.60 * W]
    layout = Layout(mode="one",
                    margin_left=min((b.rect.x0 for b in blocks), default=page_rect.x0),
                    margin_right=max((b.rect.x1 for b in blocks), default=page_rect.x1))
    lefts = [b for b in body if b.rect.x1 < page_rect.x0 + 0.52 * W]
    rights = [b for b in body if b.rect.x0 > page_rect.x0 + 0.48 * W]
    if len(lefts) >= 1 and len(rights) >= 1:
        lux0 = _median(b.rect.x0 for b in lefts)
        lux1 = _median(b.rect.x1 for b in lefts)
        rix0 = _median(b.rect.x0 for b in rights)
        rix1 = _median(b.rect.x1 for b in rights)
        if rix0 - lux1 > 3.0 and rix0 > page_rect.x0 + 0.40 * W and lux1 < page_rect.x0 + 0.60 * W:
            layout.mode = "two"
            layout.gutter = (lux1 + rix0) / 2.0
            layout.left = (lux0, lux1)
            layout.right = (rix0, rix1)
    return layout


# --------------------------------------------------------------------------
# Caption detection
# --------------------------------------------------------------------------
def _caption_head(first_line: str) -> Optional[dict]:
    """Match a caption label at the start of a text line."""
    m = CAPTION_RE.match(first_line)
    if not m:
        return None
    prefix = (m.group("prefix") or "").strip()
    kind_word = (m.group("kind") or "").strip()
    num = (m.group("num") or "").strip()
    tail = m.group("tail") or ""
    # normalise label as printed (prefix + kind + num)
    kind_lower = kind_word.lower().rstrip("s")
    if kind_lower.startswith("fig"):
        kind = "figure"
        label = "%s %s" % (prefix, num) if prefix else "Fig. %s" % num
        if prefix:
            label = "%s Fig. %s" % (prefix, num)
        if not prefix and kind_word.lower().startswith("figure"):
            label = "Figure %s" % num
    else:
        kind = "table"
        label = "%s Table %s" % (prefix, num) if prefix else "Table %s" % num
    label = re.sub(r"\s+", " ", label).strip()
    return {"kind": kind, "label": label, "num": num, "prefix": prefix,
            "tail": tail, "kind_word": kind_word}


def _looks_like_reference(head: dict, block: TextBlock, body_size: float) -> bool:
    """Decide whether 'Fig. N ...' is an in-text reference instead of a caption."""
    tail = head["tail"] or ""
    if REF_VERB_RE.match(tail):
        return True
    stripped = tail.strip()
    if not stripped:
        return False
    first = stripped[0]
    # Figure captions almost always continue with a delimiter, a capital letter,
    # a digit, or an opening bracket/parenthesis; lowercase wording after the
    # bare label is usually an in-text reference ("Fig. 1 shows ...").
    if first == ")" and block.size >= body_size - 0.2:
        # "Table 1) and only encoded ..." -> closes a parenthetical reference
        return True
    if first in ".:|)\u2014\u2013-\u2012":
        return False
    if first.isupper() or first.isdigit() or first in "([{\"'\u201c\u2018":
        return False
    # lowercase continuation: only accept when the block is clearly caption
    # (smaller than body text and a single-line block)
    if block.size <= body_size - 0.7 and block.n_lines <= 2:
        return False
    return True


def _caption_blocks(blocks: list, body_size: float, page_rect: "fitz.Rect") -> list:
    """Find candidate caption anchor blocks on one page (unmerged)."""
    out = []
    for b in blocks:
        if b.n_lines == 0 or not b.first_line:
            continue
        if _in_furniture(b.rect, page_rect):
            continue
        # vertical watermarks / rotated sidebars
        if b.rect.width < 0.10 * page_rect.width and b.rect.height > 0.45 * page_rect.height:
            continue
        head = _caption_head(b.first_line)
        if not head:
            continue
        if _looks_like_reference(head, b, body_size):
            continue
        # absurdly large text is a heading/logo, not a caption (allow short
        # "Table 1" style labels though)
        if b.size > body_size + 3.0 and b.text.strip().lower() != head["label"].lower():
            continue
        b.is_caption = True
        out.append((b, head))
    return out


def _merge_caption_row(anchor: TextBlock, anchor_head: dict, blocks: list,
                       page_rect: "fitz.Rect") -> list:
    """Merge caption halves that were typeset as separate column blocks."""
    group = [anchor]
    group_ids = {id(anchor)}
    changed = True
    while changed:
        changed = False
        group_rect = group[0].rect
        for b in group[1:]:
            group_rect = group_rect | b.rect
        for b in blocks:
            if id(b) in group_ids or b.is_caption:
                continue
            if b.n_lines > 24:
                continue
            if _caption_head(b.first_line):
                continue
            # same visual row
            if abs(b.rect.y0 - group_rect.y0) > 5.0:
                continue
            if _x_overlap(b.rect, group_rect) > 0.08 * min(b.rect.width, group_rect.width):
                continue
            gap = max(b.rect.x0 - group_rect.x1, group_rect.x0 - b.rect.x1)
            if gap > 0.13 * page_rect.width or gap < -2:
                continue
            if abs(b.size - anchor.size) > 0.4:
                continue
            if b.size > anchor.size + 2.0:      # clearly larger heading
                continue
            group.append(b)
            group_ids.add(id(b))
            changed = True
    return group


def _caption_text(group: list) -> str:
    # blocks that sit on the same visual row are column halves: read left->right
    ordered = sorted(group, key=lambda b: (round(b.rect.y0 / 6.0), b.rect.x0))
    parts = []
    for b in ordered:
        t = b.text.strip()
        if t:
            parts.append(t)
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def find_captions(page_no: int, blocks: list, layout: Layout,
                  page_rect: "fitz.Rect", body_size: float) -> list:
    cands = _caption_blocks(blocks, body_size, page_rect)
    captions = []
    used = set()
    for b, head in cands:
        if id(b) in used:
            continue
        group = _merge_caption_row(b, head, blocks, page_rect)
        for g in group:
            used.add(id(g))
        rect = fitz.Rect(group[0].rect)
        for g in group[1:]:
            rect |= g.rect
        text = _caption_text(group)
        captions.append(Caption(
            label=head["label"], kind=head["kind"], page_no=page_no,
            rect=rect, blocks=group, text=text,
            size=max(g.max_size for g in group),
        ))
    return captions


_SI_SUFFIX_RE = re.compile(
    r"\((?:TIFF?|DOCX?|PDF|AVI|MOV|MP4|XLSX?|XLS|CSV|ZIP|PNG|JPG|JPEG|TIF|"
    r"PPTX?|TXT|GZ|BAM|FASTQ)\)\s*$",
    re.IGNORECASE,
)


def _is_si_listing(caption: Caption, blocks: list) -> bool:
    """True for 'Figure S1 ... (TIFF)' entries in a Supporting-Information list."""
    text = caption.text.strip()
    if SI_FILE_RE.match(text) or _SI_SUFFIX_RE.search(text):
        return True
    block_ids = {id(b) for b in caption.blocks}
    for b in blocks:
        if id(b) in block_ids:
            continue
        if b.rect.y0 < caption.rect.y1 - 3:
            continue
        if b.rect.y0 - caption.rect.y1 > 45:
            continue
        if _x_overlap(b.rect, caption.rect) < 0.2 * min(b.rect.width, caption.rect.width):
            continue
        if SI_FILE_RE.match(b.text.strip()):
            return True
    return False


# --------------------------------------------------------------------------
# Figure content collection & clustering
# --------------------------------------------------------------------------
def _inflate_degenerate(rect: "fitz.Rect") -> "fitz.Rect":
    """Give zero-width/height boxes a tiny extent.

    PyMuPDF treats x0==x1 or y0==y1 rectangles as *empty*, and empty rects are
    dropped by Rect.__or__ - which would silently lose axis spines, tick marks
    and hairlines from the union.
    """
    r = fitz.Rect(rect)
    if r.x1 - r.x0 < 0.2:
        r.x0 -= 0.15
        r.x1 += 0.15
    if r.y1 - r.y0 < 0.2:
        r.y0 -= 0.15
        r.y1 += 0.15
    return r


def collect_items(page: "fitz.Page", page_rect: "fitz.Rect",
                  layout: Layout) -> list:
    W, H = page_rect.width, page_rect.height
    page_area = W * H
    items = []

    # embedded images -----------------------------------------------------
    try:
        infos = page.get_image_info()
    except Exception:
        infos = []
    for info in infos:
        try:
            rect = fitz.Rect(info["bbox"]) & page_rect
        except Exception:
            continue
        area = _area(rect)
        if area <= 0:
            continue
        if area > 0.90 * page_area:                     # page background
            continue
        if _in_furniture(rect, page_rect):
            continue
        small = rect.width < 2.5 and rect.height < 2.5     # glyph/tile
        items.append(Item(rect=rect, kind="image", small=small,
                          band=_band_of(rect, layout, page_rect)))

    # vector drawings -----------------------------------------------------
    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    for d in drawings:
        try:
            rect = fitz.Rect(d.get("rect"))
        except Exception:
            continue
        rect = _clamp_rect(rect, page_rect)
        w, h = rect.width, rect.height
        if w <= 0.05 and h <= 0.05:
            continue
        # page furniture rules (header/footer hairlines)
        if h <= 2.5 and w >= 0.60 * W:
            continue
        if w <= 2.5 and h >= 0.55 * H:
            continue
        if _in_furniture(rect, page_rect):
            continue
        if _area(rect) > 0.90 * page_area:
            continue
        rect = _inflate_degenerate(rect)
        w, h = rect.width, rect.height
        small = max(w, h) < 2.0        # dots / glyph strokes only, not rules
        items.append(Item(rect=rect, kind="draw", small=small,
                          band=_band_of(rect, layout, page_rect)))
    return items


def _bands_compatible(a: str, b: str, layout: Layout) -> bool:
    if layout.mode != "two":
        return True
    return a == "F" or b == "F" or a == b


def cluster_items(items: list, layout: Layout) -> tuple:
    """Agglomerative sweep clustering of figure content boxes."""
    small_items = [it for it in items if it.small]
    big_items = sorted([it for it in items if not it.small],
                       key=lambda it: (round(it.rect.y0, 1), it.rect.x0))
    clusters = []

    for it in big_items:
        merge_list = []
        for cl in clusters:
            # items are sorted by y0, so a cluster is usually above; its
            # rect.y1 grows as it absorbs later items.
            v_gap = it.rect.y0 - cl.rect.y1
            if v_gap > FIG_MERGE_VGAP:
                continue
            h_gap = max(it.rect.x0 - cl.rect.x1, cl.rect.x0 - it.rect.x1)
            if h_gap > FIG_MERGE_HGAP:
                continue
            if not _bands_compatible(it.band, cl.band, layout):
                continue
            merge_list.append(cl)
        if not merge_list:
            cl = Cluster(rect=fitz.Rect(it.rect), band=it.band)
            cl.add(it)
            clusters.append(cl)
            continue
        base = merge_list[0]
        for other in merge_list[1:]:
            for oi in other.items:
                base.add(oi)
            clusters.remove(other)
        base.add(it)
        base.recompute_band()

    # absorb tiny glyph/tile boxes into nearby clusters
    for it in small_items:
        best = None
        best_gap = None
        for cl in clusters:
            h_gap = max(it.rect.x0 - cl.rect.x1, cl.rect.x0 - it.rect.x1)
            v_gap = max(it.rect.y0 - cl.rect.y1, cl.rect.y0 - it.rect.y1)
            if h_gap > ATTACH_SMALL_GAP or v_gap > ATTACH_SMALL_GAP:
                continue
            gap = max(0.0, v_gap) + max(0.0, h_gap)
            if best is None or gap < best_gap:
                best, best_gap = cl, gap
        if best is not None:
            best.add(it)

    clusters = [c for c in clusters if not (c.rect.width < 4 and c.rect.height < 4)]
    return clusters, len(small_items)


# --------------------------------------------------------------------------
# Region selection
# --------------------------------------------------------------------------
def _caption_band(caption: Caption, layout: Layout, page_rect: "fitz.Rect") -> str:
    if layout.mode != "two":
        return "F"
    if caption.rect.width > 0.55 * page_rect.width:
        return "F"
    if caption.rect.x1 <= layout.gutter + 3:
        return "L"
    if caption.rect.x0 >= layout.gutter - 3:
        return "R"
    return "F"


def _col_score(cluster: Cluster, caption: Caption, layout: Layout,
               page_rect: "fitz.Rect") -> float:
    cband = _caption_band(caption, layout, page_rect)
    if cband == "F":
        return 1.0 if _x_overlap(cluster.rect, caption.rect) > 0.25 * cluster.rect.width else 0.55
    if _x_overlap(cluster.rect, caption.rect) >= 0.45 * min(cluster.rect.width,
                                                           caption.rect.width):
        return 1.0
    # same column as caption, even if the caption is narrower than the figure
    if layout.mode == "two":
        lo, hi = (layout.left if cband == "L" else layout.right)
        if cluster.rect.x0 >= lo - 15 and cluster.rect.x1 <= hi + 15:
            return 0.85
    return 0.15


def _effective_rect(cluster: Cluster, caption: Caption, direction: str) -> Optional["fitz.Rect"]:
    """Restrict a cluster to the items on the requested side of the caption."""
    rect = None
    for it in cluster.items:
        if direction == "above":
            if it.rect.y1 > caption.rect.y0 + 1.5:
                continue
        else:
            if it.rect.y0 < caption.rect.y1 - 1.5:
                continue
        rect = fitz.Rect(it.rect) if rect is None else (rect | it.rect)
    return rect


def _body_like(block: TextBlock, body_size: float) -> bool:
    return block.size >= body_size - 0.15 and block.n_lines >= 2 and len(block.text) > 45


def _gap_has_body_text(caption: Caption, eff: "fitz.Rect", direction: str,
                       blocks: list, body_size: float) -> bool:
    if direction == "above":
        band = fitz.Rect(eff.x0, eff.y1 - 1, eff.x1, caption.rect.y0)
    else:
        band = fitz.Rect(eff.x0, caption.rect.y1, eff.x1, eff.y0 + 1)
    for b in blocks:
        if b.is_caption:
            continue
        if not _body_like(b, body_size):
            continue
        if _x_overlap(b.rect, band) < 0.25 * min(b.rect.width, band.width or b.rect.width):
            continue
        if _intersection_area(b.rect, band) > 0.25 * _area(b.rect):
            return True
    return False


def _extend_region(region: "fitz.Rect", clusters: list, used: set,
                   caption: Caption, direction: str, layout: Layout,
                   other_captions: list, page_rect: "fitz.Rect") -> "fitz.Rect":
    region = fitz.Rect(region)
    changed = True
    guard = 0
    while changed and guard < 40:
        guard += 1
        changed = False
        for cl in clusters:
            if id(cl) in used:
                continue
            r = cl.rect
            if _intersection_area(r, caption.rect) > 0.05 * _area(r):
                continue
            if any(_intersection_area(r, c.rect) > 0.15 * _area(r)
                   for c in other_captions):
                continue
            if direction == "above" and r.y1 > caption.rect.y0 + 2:
                continue
            if direction == "below" and r.y0 < caption.rect.y1 - 2:
                continue
            v_gap = max(r.y0 - region.y1, region.y0 - r.y1)
            h_gap = max(r.x0 - region.x1, region.x0 - r.x1)
            if v_gap > EXTEND_VGAP or h_gap > EXTEND_HGAP:
                continue
            if not _bands_compatible(cl.band, _band_of(region, layout, page_rect), layout):
                continue
            region |= r
            used.add(id(cl))
            changed = True
    return region


def _small_text(block: TextBlock, caption: Caption, body_size: float) -> bool:
    """Text that plausibly belongs to a figure (axis labels, table cells...)."""
    if block.size <= body_size - 0.4:
        return True
    if block.size <= caption.size - 0.3:
        return True
    if block.n_lines <= 2 and block.size <= body_size + 0.2:
        return True
    return False


def _refine_with_text(region: "fitz.Rect", caption: Caption, blocks: list,
                      body_size: float, direction: str) -> "fitz.Rect":
    region = fitz.Rect(region)
    cap_rect = caption.rect
    caption_ids = {id(b) for b in caption.blocks}
    for _ in range(8):
        changed = False
        for b in blocks:
            if id(b) in caption_ids:
                continue
            if b.rect.intersects(cap_rect):
                continue
            if _body_like(b, body_size):
                continue
            hov = _x_overlap(b.rect, region)
            if hov < 0.30 * min(b.rect.width, region.width or b.rect.width):
                continue
            # already covered
            if region.contains(b.rect):
                continue
            if direction == "above":
                same_side = b.rect.y1 <= cap_rect.y0 + 1
                gap = b.rect.y0 - region.y1
                upward = region.y0 - b.rect.y1
            else:
                same_side = b.rect.y0 >= cap_rect.y1 - 1
                gap = b.rect.y0 - region.y1
                upward = region.y0 - b.rect.y1
            # (1) text rows between the region and its caption (axis labels etc.)
            if same_side and -2 <= gap <= TEXT_REF_MAX_GAP and _small_text(b, caption, body_size):
                region |= b.rect
                changed = True
                continue
            # (2) small labels just above (panel letters, axis titles)
            if -2 <= upward <= 8 and _small_text(b, caption, body_size):
                region |= b.rect
                changed = True
                continue
            # (3) labels beside the region (y-axis titles, colourbars)
            vov = min(b.rect.y1, region.y1) - max(b.rect.y0, region.y0)
            if vov >= 0.5 * min(b.rect.height, region.height or b.rect.height):
                hgap = max(b.rect.x0 - region.x1, region.x0 - b.rect.x1)
                if -2 <= hgap <= 28 and _small_text(b, caption, body_size):
                    region |= b.rect
                    changed = True
        # include text inside the region (figure-internal labels of vector figures)
        for b in blocks:
            if id(b) in caption_ids:
                continue
            if _body_like(b, body_size):
                continue
            if _intersection_area(b.rect, region) > 0.55 * _area(b.rect):
                expanded = region | b.rect
                if expanded != region:
                    region = expanded
                    changed = True
        if not changed:
            break
    return region


def detect_region(caption: Caption, info: PageInfo, all_captions: list,
                  doc: "fitz.Document") -> None:
    page_rect = info.rect
    layout = info.layout
    H = page_rect.height
    page_area = _area(page_rect)
    body_size = info.body_size
    max_gap = min(0.20 * H, 150.0)
    prior_dir = "above" if caption.kind == "figure" else "below"
    other_caps = [c for c in all_captions if c is not caption]

    candidates = []
    for cl in info.clusters:
        for direction in ("above", "below"):
            eff = _effective_rect(cl, caption, direction)
            if eff is None or _area(eff) <= 0:
                continue
            if direction == "above":
                gap = caption.rect.y0 - eff.y1
            else:
                gap = eff.y0 - caption.rect.y1
            if gap < -2.0 or gap > max_gap:
                continue
            col = _col_score(cl, caption, layout, page_rect)
            if col < 0.30:
                continue
            if _gap_has_body_text(caption, eff, direction, info.blocks, body_size):
                continue
            proximity = math.exp(-max(0.0, gap) / 34.0)
            area_score = min(1.0, _area(eff) / (0.30 * page_area))
            prior = 0.35 if direction == prior_dir else 0.0
            score = 2.4 * proximity + 1.5 * area_score + 0.7 * col + prior
            candidates.append({
                "cluster": cl, "direction": direction, "eff": eff,
                "gap": gap, "score": score, "col": col, "area": _area(eff),
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    chosen = candidates[0] if candidates else None
    if chosen is not None and chosen["score"] < 1.05:
        chosen = None

    if chosen is not None:
        direction = chosen["direction"]
        caption.direction = direction
        caption.gap = chosen["gap"]
        used = {id(chosen["cluster"])}
        region = _extend_region(fitz.Rect(chosen["eff"]), info.clusters, used,
                                caption, direction, layout, other_caps, page_rect)
        region = _refine_with_text(region, caption, info.blocks, body_size, direction)
        region = _clamp_rect(region, page_rect)
        caption.region = region
        # report the gap that actually remains after region refinement
        if direction == "above":
            caption.gap = caption.rect.y0 - region.y1
        else:
            caption.gap = region.y0 - caption.rect.y1
        n_img = sum(1 for it in chosen["cluster"].items if it.kind == "image")
        n_draw = sum(1 for it in chosen["cluster"].items if it.kind == "draw")
        caption.n_img, caption.n_draw = n_img, n_draw
        if caption.gap > 45:
            caption.warnings.append(
                "figure content is %.0fpt away from the caption; verify the crop" % caption.gap)
        if caption.gap > 90:
            caption.manual = True
    else:
        # ---------------- fallbacks -------------------------------------
        caption.direction = prior_dir
        caption.gap = -1.0
        fallback = _fallback_region(caption, info, body_size)
        caption.region = fallback
        caption.manual = True
        if fallback is not None and _area(fallback) > 0:
            caption.warnings.append(
                "no figure artwork matched near the caption; crop may be incomplete - "
                "verify debug/contact-sheet.png and override with --bbox")
        else:
            caption.region = fitz.Rect(caption.rect)
            caption.warnings.append(
                "no figure artwork found near caption (caption-only listing?); "
                "override with --bbox or drop this entry")

    region = caption.region
    if region is None or _area(region) < 100:
        caption.manual = True
        caption.warnings.append("detected region is tiny; crop will be unreliable")
        if region is None:
            caption.region = fitz.Rect(caption.rect)
            region = caption.region

    # body-text overlap check -------------------------------------------
    caption_block_ids = {id(x) for x in caption.blocks}
    for b in info.blocks:
        if b.is_caption or id(b) in caption_block_ids:
            continue
        if not _body_like(b, body_size):
            continue
        inter = _intersection_area(b.rect, region)
        if inter > 0.20 * _area(b.rect) and inter > 0.02 * _area(region):
            caption.warnings.append(
                "detected region overlaps body text; override with --bbox")
            caption.manual = True
            break

    # composition / confidence ------------------------------------------
    if caption.manual:
        caption.detect = "manual"
    elif caption.n_img > 0 and caption.n_draw > 0:
        caption.detect = "mixed"
    elif caption.n_img > 0:
        caption.detect = "image"
    else:
        caption.detect = "vector"


def _fallback_region(caption: Caption, info: PageInfo, body_size: float) -> Optional["fitz.Rect"]:
    """Build a best-effort region when clustering failed (e.g. text-only tables)."""
    page_rect = info.rect
    region = fitz.Rect(caption.rect)
    if caption.kind == "table":
        direction = "below"
    else:
        direction = "above"
    caption_ids = {id(b) for b in caption.blocks}
    for _ in range(6):
        changed = False
        for b in info.blocks:
            if id(b) in caption_ids:
                continue
            if b.rect.intersects(caption.rect):
                continue
            if direction == "above":
                if b.rect.y1 > caption.rect.y0 + 1 or b.rect.y0 < region.y0 - 40:
                    continue
            else:
                if b.rect.y0 < caption.rect.y1 - 1:
                    continue
            if _x_overlap(b.rect, region) < 0.35 * min(b.rect.width, region.width):
                continue
            gap = max(b.rect.y0 - region.y1, region.y0 - b.rect.y1)
            if gap > 30:
                continue
            if direction == "below" and _body_like(b, body_size) and b.n_lines > 4:
                continue
            region |= b.rect
            changed = True
        region |= fitz.Rect(caption.rect)
        if not changed:
            break
    if _area(region) <= _area(caption.rect):
        return None
    return region


# --------------------------------------------------------------------------
# Clip / crop geometry
# --------------------------------------------------------------------------
def finalize_clip(caption: Caption, page_rect: "fitz.Rect", with_caption: bool) -> "fitz.Rect":
    region = caption.region if caption.region is not None else fitz.Rect(caption.rect)
    pad = CROP_PAD
    clip = fitz.Rect(region.x0 - pad, region.y0 - pad, region.x1 + pad, region.y1 + pad)
    clip = _clamp_rect(clip, page_rect)
    cap = caption.rect
    if with_caption:
        clip = _clamp_rect(clip | fitz.Rect(cap.x0 - 1, cap.y0 - 1, cap.x1 + 1, cap.y1 + 1),
                           page_rect)
        return clip
    if _intersection_area(clip, cap) > 0:
        # trim on the caption side
        if cap.y0 >= region.y1 - 3 and cap.y0 > clip.y0:
            clip.y1 = min(clip.y1, cap.y0 - CAPTION_GAP_TRIM)
        elif cap.y1 <= region.y0 + 3 and cap.y1 < clip.y1:
            clip.y0 = max(clip.y0, cap.y1 + CAPTION_GAP_TRIM)
        else:
            # caption overlaps the region itself: cut the smaller overlap side
            if _area(fitz.Rect(clip.x0, cap.y1, clip.x1, clip.y1)) >= \
               _area(fitz.Rect(clip.x0, clip.y0, clip.x1, cap.y0)):
                clip.y1 = min(clip.y1, cap.y0 - CAPTION_GAP_TRIM)
            else:
                clip.y0 = max(clip.y0, cap.y1 + CAPTION_GAP_TRIM)
    if clip.width < 12 or clip.height < 12:
        clip = _clamp_rect(fitz.Rect(region), page_rect)
    return clip


def render_crop(page: "fitz.Page", clip: "fitz.Rect", dpi: int, max_width: int,
                out_path: str) -> tuple:
    dpi_eff = float(dpi)
    if clip.width > 0.1 and clip.height > 0.1:
        dpi_eff = min(dpi_eff, max_width * 72.0 / clip.width,
                      max_width * 72.0 / clip.height)
    # PyMuPDF requires an integer dpi value (float dpi raises xres errors)
    dpi_eff = max(24, int(dpi_eff))
    pix = page.get_pixmap(clip=clip, dpi=dpi_eff, colorspace=fitz.csRGB,
                          alpha=False, annots=False)
    if pix.width == 0 or pix.height == 0:
        pix = page.get_pixmap(clip=clip, colorspace=fitz.csRGB, alpha=False, annots=False)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pix.save(out_path)
    return pix.width, pix.height, dpi_eff


# --------------------------------------------------------------------------
# Debug artifacts (page overlay + contact sheet), drawn with fitz only
# --------------------------------------------------------------------------
def _page_pixmap(page: "fitz.Page", dpi: float) -> "fitz.Pixmap":
    return page.get_pixmap(dpi=max(1, int(dpi)), colorspace=fitz.csRGB,
                           alpha=False, annots=False)


def write_overlay(page: "fitz.Page", caption: Caption, clip: "fitz.Rect",
                  out_path: str, page_rect: "fitz.Rect") -> None:
    dpi = 120.0
    pix = _page_pixmap(page, dpi)
    tmp = fitz.open()
    tp = tmp.new_page(width=page_rect.width, height=page_rect.height)
    tp.insert_image(tp.rect, pixmap=pix)
    red = (0.85, 0.05, 0.05)
    blue = (0.05, 0.30, 0.85)
    tp.draw_rect(clip, color=red, width=1.8)
    tp.draw_rect(caption.rect, color=blue, width=1.2)
    label = "%s  p.%d" % (caption.id or caption.label, caption.page_no)
    tx, ty = clip.x0, max(11.0, clip.y0 - 4.0)
    if ty >= clip.y0 - 1:
        ty = min(page_rect.height - 3, clip.y1 + 10.0)
    tp.insert_text((tx, ty), label, fontsize=9, fontname="helv", color=red,
                   render_mode=0)
    out = tp.get_pixmap(dpi=max(1, int(min(dpi, 2600.0 * 72.0 / page_rect.width))),
                        colorspace=fitz.csRGB, alpha=False, annots=False)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    out.save(out_path)
    tmp.close()


def write_contact_sheet(entries: list, out_path: str) -> None:
    entries = [e for e in entries if e.get("_png") and os.path.exists(e["_png"])]
    if not entries:
        return
    cols = 3 if len(entries) > 2 else max(1, len(entries))
    rows = int(math.ceil(len(entries) / float(cols)))
    cell_w, cell_h = 660.0, 500.0
    margin = 16.0
    label_h = 26.0
    page_w, page_h = cols * cell_w, rows * cell_h
    doc = fitz.open()
    page = doc.new_page(width=page_w, height=page_h)
    for idx, e in enumerate(entries):
        cx = (idx % cols) * cell_w
        cy = (idx // cols) * cell_h
        box = fitz.Rect(cx + margin, cy + margin + label_h,
                        cx + cell_w - margin, cy + cell_h - margin)
        label = "%s  %s  p.%d" % (e.get("id", "?"), e.get("label", ""), e.get("page", 0))
        page.insert_text((cx + margin, cy + margin + 16), label, fontsize=13,
                         fontname="helv", color=(0.05, 0.05, 0.05))
        try:
            page.insert_image(box, filename=e["_png"], keep_proportion=True)
        except Exception:
            pass
        page.draw_rect(box, color=(0.75, 0.75, 0.75), width=0.6)
    dpi = max(1, int(min(110.0, 3000.0 * 72.0 / page_w)))
    pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False, annots=False)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pix.save(out_path)
    doc.close()


# --------------------------------------------------------------------------
# Text / meta extraction
# --------------------------------------------------------------------------
def _unit_rect(unit) -> "fitz.Rect":
    if isinstance(unit, Caption):
        return unit.rect
    return unit.rect


def _is_full_width_unit(unit, layout: Layout, page_rect: "fitz.Rect") -> bool:
    r = _unit_rect(unit)
    if isinstance(unit, Caption) and len(unit.blocks) > 1:
        return True
    if r.width > 0.72 * page_rect.width:
        return True
    if layout.mode == "two" and r.x0 < layout.gutter - 2 and r.x1 > layout.gutter + 2:
        return True
    return False


def order_page_units(blocks: list, captions: list, layout: Layout,
                     page_rect: "fitz.Rect") -> list:
    """Reading order for one page: column-major, full-width blocks as separators."""
    cap_block_ids = set()
    for cap in captions:
        for b in cap.blocks:
            cap_block_ids.add(id(b))
    units = [b for b in blocks if id(b) not in cap_block_ids]
    units.extend(captions)
    if layout.mode != "two":
        return sorted(units, key=lambda u: (_unit_rect(u).y0, _unit_rect(u).x0))

    full = [u for u in units if _is_full_width_unit(u, layout, page_rect)]
    col = [u for u in units if not _is_full_width_unit(u, layout, page_rect)]
    full.sort(key=lambda u: (_unit_rect(u).y0, _unit_rect(u).x0))
    out = []
    cur_bottom = -1e9
    for f in full:
        fr = _unit_rect(f)
        seg = [u for u in col if cur_bottom <= ((_unit_rect(u).y0 + _unit_rect(u).y1) / 2.0) < fr.y0]
        out.extend(_order_column_units(seg, layout, page_rect))
        out.append(f)
        cur_bottom = max(cur_bottom, fr.y1)
    out.extend(_order_column_units([u for u in col if ((_unit_rect(u).y0 + _unit_rect(u).y1) / 2.0) >= cur_bottom],
                                   layout, page_rect))
    return out


def _order_column_units(units: list, layout: Layout, page_rect: "fitz.Rect") -> list:
    def rank(u):
        r = _unit_rect(u)
        return 0 if ((r.x0 + r.x1) / 2.0) < layout.gutter else 1
    return sorted(units, key=lambda u: (rank(u), _unit_rect(u).y0, _unit_rect(u).x0))


def build_text_md(doc: "fitz.Document", pages: dict) -> str:
    chunks = []
    for pno in sorted(pages):
        info = pages[pno]
        units = order_page_units(info.blocks, info.captions, info.layout, info.rect)
        chunks.append("<!-- page %d -->" % pno)
        for u in units:
            if isinstance(u, Caption):
                text = u.text.strip()
                if text:
                    chunks.append(text)
                continue
            b = u
            if _in_furniture(b.rect, info.rect):
                continue
            if b.rect.width < 0.06 * info.rect.width and b.rect.height > 0.4 * info.rect.height:
                continue
            if b.max_size < 6.0:                    # marginal decoration glyphs
                continue
            lines = [_norm_text(ln).strip() for ln in (b.lines or [b.text])]
            lines = [ln for ln in lines if ln]
            kept = [ln for ln in lines if not NOISE_LINE_RE.match(ln)]
            text = _join_lines(kept).strip() if kept else ""
            if text:
                chunks.append(text)
        chunks.append("")
    return "\n\n".join(chunks).strip() + "\n"


def _page1_texts(page: "fitz.Page") -> list:
    try:
        data = page.get_text("dict", flags=fitz.TEXTFLAGS_TEXT)
    except Exception:
        return []
    out = []
    for b in data.get("blocks", []):
        if b.get("type", 0) != 0:
            continue
        for ln in b.get("lines", []):
            spans = ln.get("spans", [])
            if not spans:
                continue
            text = "".join(sp.get("text", "") for sp in spans).strip()
            if not text:
                continue
            size = max(float(sp.get("size", 0)) for sp in spans)
            out.append({"text": text, "size": size, "bbox": fitz.Rect(ln["bbox"])})
    return out


def _sane_title(text: str) -> bool:
    if not text:
        return False
    t = text.strip()
    if len(t) < 10 or len(t) > 400:
        return False
    low = t.lower()
    if low in ("untitled", "microsoft word", "article", "research article"):
        return False
    if re.search(r"\.(pdf|docx?|tex)$", low):
        return False
    if re.search(r"\b1\.\.\d+$", t):          # "deb_pone.0068988 1..9" style junk
        return False
    if len(re.findall(r"[A-Za-z]", t)) < 0.55 * len(t):
        return False
    return True


_AFFIL_RE = re.compile(
    r"\b(university|department|departments|institute|institution|laboratory|"
    r"school|college|faculty|hospital|centre|center|correspondence|e-?mail|"
    r"received|accepted|published|revised|edited|reviewed|copyright|funding|"
    r"competing|subject|keywords|citation|doi|abstract|summary|supplementary|"
    r"author contributions|equally contributed|current address|"
    r"nature communications|plos one|vol\.|issue)\b",
    re.IGNORECASE,
)
_NAME_RE = re.compile(
    r"^[A-Z][A-Za-z'\u2019.\-]+(?:\s+(?:[A-Z]\.?|[A-Z][A-Za-z'\u2019.\-]+)){1,4}$"
)


def _name_tokens(text: str) -> tuple:
    """Split a candidate author line into plausible person names -> (good, total)."""
    toks = re.split(r",|;|&|\band\b", text)
    good = 0
    total = 0
    for tok in toks:
        tok = re.sub(r"[\d\u00b9\u00b2\u00b3\u2070-\u209f\u2020\u2021\u00a7\u00b6*]+", "", tok)
        tok = re.sub(r"\s+", " ", tok).strip(" .,;:-\u2020\u2021\u00a7&")
        if len(tok.split()) < 2:
            continue
        total += 1
        if _NAME_RE.match(tok):
            good += 1
    return good, total


def _extract_page1_authors(doc: "fitz.Document") -> list:
    """Best-effort author list from page 1.

    Spans are used instead of lines: superscript affiliation digits are smaller
    spans and are dropped, then name spans are re-assembled row by row so that
    interleaved baselines do not scramble the author order.
    """
    if doc.page_count == 0:
        return []
    try:
        raw = _raw_blocks(doc[0])
    except Exception:
        return []
    if not raw:
        return []
    lines = []
    for rb in raw:
        for ln in rb["lines"]:
            spans = [sp for sp in ln.get("spans", []) if sp.get("text", "").strip()]
            if not spans:
                continue
            sizes = [float(sp.get("size", 0.0)) for sp in spans]
            lines.append({
                "rect": fitz.Rect(ln["bbox"]),
                "max_size": max(sizes),
                "text": "".join(sp.get("text", "") for sp in spans),
                "spans": spans,
            })
    if not lines:
        return []
    title_size = max(ln["max_size"] for ln in lines)
    if title_size < 11.0:
        return []
    title_bottom = max((ln["rect"].y1 for ln in lines
                        if ln["max_size"] >= title_size - 0.6), default=0.0)
    limit_y = title_bottom + 150.0

    spans_out = []
    for ln in lines:
        if not (title_bottom + 2 < ln["rect"].y0 <= limit_y):
            continue
        size = ln["max_size"]
        if not (8.0 <= size <= title_size - 2.0):
            continue
        text = ln["text"].strip()
        if not text:
            continue
        if re.match(r"^(abstract|summary|keywords|introduction)\b", text, re.IGNORECASE):
            break
        if _AFFIL_RE.search(text):
            continue
        keep = [sp for sp in ln["spans"]
                if float(sp.get("size", 0.0)) >= 0.88 * size and sp.get("text", "").strip()]
        if not keep:
            continue
        clean = "".join(sp.get("text", "") for sp in keep)
        clean = re.sub(r"\s+", " ", clean).strip()
        if not clean or len(clean) > 160:
            continue
        if re.match(r"^[,;&.\u2013\u2014-]+$", clean):
            # punctuation-only line (e.g. a comma split off by superscripts)
            pass
        else:
            good, total = _name_tokens(clean)
            if good == 0 or (total > 0 and good < 0.5 * total):
                continue
        for sp in keep:
            spans_out.append((ln["rect"].y1, sp["bbox"][0], sp.get("text", "")))
    if not spans_out:
        return []
    spans_out.sort(key=lambda s: (s[0], s[1]))
    rows = []
    for y1, x0, text in spans_out:
        if rows and abs(y1 - rows[-1][0]) <= 2.5:
            rows[-1][1].append((x0, text))
        else:
            rows.append((y1, [(x0, text)]))
    row_texts = []
    for _y1, parts in rows:
        parts.sort(key=lambda p: p[0])
        row_texts.append(re.sub(r"\s+", " ", "".join(t for _x, t in parts)).strip())
    joined = " ".join(t for t in row_texts if t)
    names = re.split(r",|;|&|\band\b", joined)
    out = []
    for name in names:
        name = re.sub(r"[\d\u00b9\u00b2\u00b3\u2070-\u209f\u2020\u2021\u00a7\u00b6*]+", "", name)
        name = re.sub(r"\s+", " ", name).strip(" .,;:-\u2020\u2021\u00a7&")
        if not name or len(name) < 4 or len(name) > 60:
            continue
        if _AFFIL_RE.search(name):
            continue
        if len(name.split()) < 2:
            continue
        if not _NAME_RE.match(name):
            continue
        out.append(name)
    return out[:40]


def extract_meta(doc: "fitz.Document", path: str, pages: dict) -> dict:
    md = doc.metadata or {}
    p1 = doc[0] if doc.page_count else None
    lines = _page1_texts(p1) if p1 is not None else []
    page1_text = " ".join(x["text"] for x in lines)

    # ---- title ---------------------------------------------------------
    title = (md.get("title") or "").strip()
    if not _sane_title(title):
        title = ""
    if not title and lines:
        max_size = max(x["size"] for x in lines)
        title_lines = [x["text"] for x in lines if x["size"] >= max_size - 0.6
                       and not _in_furniture(x["bbox"], p1.rect)]
        cand = re.sub(r"\s+", " ", " ".join(title_lines)).strip()
        if _sane_title(cand):
            title = cand
    if not title:
        # largest font block on page 1 but not a banner/journal wordmark
        for x in sorted(lines, key=lambda x: -x["size"])[:12]:
            if x["size"] < 12:
                break
            if _sane_title(x["text"]):
                title = x["text"]
                break

    # ---- authors -------------------------------------------------------
    authors = []
    author_meta = (md.get("author") or "").strip()
    if author_meta and re.search(r"[A-Za-z]", author_meta):
        sep = r";" if ";" in author_meta else r","
        authors = [a.strip() for a in re.split(sep, author_meta) if a.strip()]
    page_authors = _extract_page1_authors(doc)
    if page_authors and (not authors or len(page_authors) > len(authors)):
        authors = page_authors
    authors = [re.sub(r"\s+", " ", a).strip(" ,;*") for a in authors if a.strip()]
    authors = [a for a in authors if len(a) >= 3][:40]

    # ---- journal / year / doi -----------------------------------------
    journal = ""
    subject = md.get("subject") or ""
    for name in JOURNALS:
        if re.search(r"\b" + re.escape(name) + r"\b", page1_text, re.IGNORECASE) or \
           re.search(r"\b" + re.escape(name) + r"\b", subject, re.IGNORECASE):
            journal = "PLOS ONE" if name in ("PLoS ONE", "PLOS ONE") else name
            break
    year = ""
    m = re.search(r"D:(\d{4})", md.get("creationDate") or "")
    if m:
        year = m.group(1)
    else:
        m2 = YEAR_RE.search(page1_text)
        if m2:
            year = m2.group(1)

    doi = ""
    for cand_text in (subject, page1_text):
        for m in DOI_RE.finditer(cand_text or ""):
            doi = m.group(0).rstrip(".,;)]}")
            if len(doi) > 10:
                break
        if doi:
            break
    if not doi and doc.page_count:
        try:
            for lk in doc[0].get_links():
                uri = lk.get("uri") or ""
                m = DOI_RE.search(uri)
                if m:
                    doi = m.group(0)
                    break
        except Exception:
            pass

    sha = ""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        sha = h.hexdigest()
    except Exception:
        pass

    return {
        "title": title,
        "authors": authors,
        "journal": journal,
        "year": year,
        "doi": doi,
        "n_pages": doc.page_count,
        "pdf_sha256": sha,
        "source_path": os.path.abspath(path),
    }


# --------------------------------------------------------------------------
# Tables
# --------------------------------------------------------------------------
def _rows_to_md(rows: list) -> str:
    if not rows:
        return ""
    ncols = max(len(r) for r in rows)
    norm = []
    for r in rows:
        cells = ["" if c is None else re.sub(r"\s+", " ", str(c)).strip() for c in r]
        cells += [""] * (ncols - len(cells))
        norm.append(cells)
    lines = ["| " + " | ".join(c.replace("|", "\\|") for c in norm[0]) + " |",
             "|" + "|".join("---" for _ in norm[0]) + "|"]
    for r in norm[1:]:
        lines.append("| " + " | ".join(c.replace("|", "\\|") for c in r) + " |")
    return "\n".join(lines)


def _find_page_tables(page: "fitz.Page") -> list:
    """find_tables() wrapped: silences its stdout hint and falls back to text mode."""
    import contextlib
    import io
    for strategy in ("lines", "text"):
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                tabs = page.find_tables(strategy=strategy)
            found = list(getattr(tabs, "tables", []))
        except Exception:
            found = []
        if found:
            return found
    return []


def _clean_table_rows(rows: list, caption: Caption) -> list:
    """Drop empty rows/columns and the caption row that find_tables may swallow."""
    norm = []
    for r in rows:
        cells = ["" if c is None else str(c) for c in r]
        if any(c.strip() for c in cells):
            norm.append(cells)
    if not norm:
        return []
    ncols = max(len(r) for r in norm)
    norm = [r + [""] * (ncols - len(r)) for r in norm]
    keep = [j for j in range(ncols) if any(r[j].strip() for r in norm)]
    norm = [[r[j] for j in keep] for r in norm]
    cap_low = caption.text.strip().lower()
    label_low = caption.label.strip().lower()
    out = []
    for r in norm:
        nonempty = [c for c in r if c.strip()]
        if len(nonempty) == 1:
            cell = re.sub(r"\s+", " ", nonempty[0]).strip()
            low = cell.lower()
            if low.startswith(label_low) or (len(cell) > 40 and cell[:48].lower() in cap_low):
                continue
        out.append(r)
    return out


def extract_tables(doc: "fitz.Document", pages: dict, out_entries: list) -> str:
    parts = ["# Extracted tables", ""]
    table_pages = {}
    for e in out_entries:
        if e["kind"] == "table":
            table_pages.setdefault(e["_page_no"], []).append(e)
    if not table_pages:
        parts.append("_No table captions detected._")
        return "\n".join(parts) + "\n"

    for pno in sorted(table_pages):
        info = pages[pno]
        parts.append("<!-- page %d -->" % pno)
        page = info.page
        found_tables = _find_page_tables(page)
        for e in table_pages[pno]:
            cap = e["_caption"]
            parts.append("### %s (p. %d)" % (e["label"], pno))
            parts.append("")
            if e.get("caption"):
                parts.append("> " + e["caption"])
                parts.append("")
            region = fitz.Rect(cap.region) if cap.region is not None else fitz.Rect(cap.rect)
            best = None
            best_frac = 0.0
            for t in found_tables:
                try:
                    tb = fitz.Rect(t.bbox)
                    rows = t.extract()
                except Exception:
                    continue
                if not rows:
                    continue
                inter = _intersection_area(tb, region)
                frac = inter / max(1.0, _area(tb))
                if inter > 0 and frac > best_frac:
                    best, best_frac = (tb, rows), frac
            if best is not None and best_frac > 0.10:
                tb, rows = best
                rows = _clean_table_rows(rows, cap)
                if rows:
                    e["table_md"] = _rows_to_md(rows)
                    parts.append(e["table_md"])
                # grow the detected region with the table area, but never with
                # the caption area (find_tables tends to include it)
                tb_use = fitz.Rect(tb)
                if tb_use.intersects(cap.rect):
                    if cap.direction == "above" and cap.rect.y1 <= tb_use.y0 + 4:
                        tb_use.y0 = max(tb_use.y0, cap.rect.y1 + 1.5)
                    elif cap.rect.y0 >= tb_use.y1 - 4:
                        tb_use.y1 = min(tb_use.y1, cap.rect.y0 - 1.5)
                if not cap.manual and _intersection_area(tb_use, region) > 0.10 * _area(tb_use):
                    new_region = region | tb_use
                    if cap.direction == "below":
                        new_region.y0 = max(new_region.y0, cap.rect.y1 + 1.5)
                    elif cap.direction == "above":
                        new_region.y1 = min(new_region.y1, cap.rect.y0 - 1.5)
                    cap.region = new_region
                if not rows:
                    parts.append("_Table found but cells could not be parsed._")
            else:
                # fall back to raw text rows inside the detected region
                raw_rows = []
                blk_ids = {id(x) for x in e.get("_blocks", [])}
                for b in info.blocks:
                    if id(b) in blk_ids or b.is_caption:
                        continue
                    if _intersection_area(b.rect, region) > 0.5 * _area(b.rect):
                        raw_rows.append(b.text)
                if raw_rows:
                    parts.append("```")
                    parts.extend(raw_rows)
                    parts.append("```")
                else:
                    parts.append("_Table artwork not located; see debug overlay._")
            parts.append("")
    return "\n".join(parts).strip() + "\n"


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def parse_pages(spec: str, n_pages: int) -> list:
    if not spec:
        return list(range(1, n_pages + 1))
    pages = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(r"^(\d+)\s*-\s*(\d+)$", chunk)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if a > b:
                a, b = b, a
            pages.extend(range(a, b + 1))
        else:
            try:
                pages.append(int(chunk))
            except ValueError:
                raise ValueError("bad --pages element: %r" % chunk)
    return sorted({p for p in pages if 1 <= p <= n_pages})


def parse_bbox_overrides(specs: list) -> dict:
    out = {}
    for spec in specs or []:
        if not spec:
            continue
        if "=" not in spec:
            raise ValueError("--bbox must look like fig2=x0,y0,x1,y1 (got %r)" % spec)
        key, val = spec.split("=", 1)
        key = key.strip()
        nums = [p for p in re.split(r"[\s,;]+", val.strip()) if p]
        if len(nums) != 4:
            raise ValueError("--bbox %s needs four numbers (got %r)" % (key, val))
        try:
            x0, y0, x1, y1 = [float(n) for n in nums]
        except ValueError:
            raise ValueError("--bbox %s has a non-numeric coordinate" % key)
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        out[key] = fitz.Rect(x0, y0, x1, y1)
    return out


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="paper_ingest.py",
        description="Extract text, figure/table captions and high-fidelity crops from a paper PDF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("pdf", help="input PDF")
    p.add_argument("--out", required=True, help="output directory")
    p.add_argument("--dpi", type=int, default=220, help="crop render resolution (default 220)")
    p.add_argument("--max-width", type=int, default=1600,
                   help="cap for max(width,height) of a crop in pixels (default 1600)")
    p.add_argument("--pages", default="", help="page spec, e.g. '1-13' or '1,3,5'")
    p.add_argument("--list", action="store_true", help="print caption table and exit")
    p.add_argument("--only", default="", help="comma separated ids to emit, e.g. fig1,fig3")
    p.add_argument("--bbox", action="append", default=[], metavar="ID=X0,Y0,X1,Y1",
                   help="override detected region for an id (repeatable)")
    p.add_argument("--debug", action="store_true", help="verbose detection diagnostics")
    p.add_argument("--no-crop", action="store_true", help="skip PNG rendering")
    p.add_argument("--with-caption", action="store_true", help="include captions in crops")
    return p


def _debug(msg: str, enabled: bool) -> None:
    if enabled:
        sys.stderr.write(msg + "\n")


def _analyze_page(doc: "fitz.Document", pno: int, body_size: float) -> PageInfo:
    page = doc[pno - 1]
    raw = _raw_blocks(page)
    blocks = _make_blocks(raw, page.rect)
    layout = infer_columns(page.rect, blocks)
    captions = find_captions(pno, blocks, layout, page.rect, body_size)
    captions = [c for c in captions if not _is_si_listing(c, blocks)]
    items = collect_items(page, page.rect, layout)
    clusters, n_small = cluster_items(items, layout)
    return PageInfo(page=page, page_no=pno, rect=page.rect, blocks=blocks,
                    layout=layout, clusters=clusters, body_size=body_size,
                    captions=captions)


def _estimate_body_size(doc: "fitz.Document", page_numbers: list) -> float:
    sizes = {}
    sample = page_numbers[: min(len(page_numbers), 25)]
    for pno in sample:
        try:
            raw = _raw_blocks(doc[pno - 1])
        except Exception:
            continue
        for rb in raw:
            if len(rb["lines"]) < 2:
                continue
            size, _ = _block_size(rb)
            if 5.0 <= size <= 16.0:
                n = len(rb["lines"])
                sizes[round(size * 2) / 2.0] = sizes.get(round(size * 2) / 2.0, 0) + n
    if not sizes:
        return 9.0
    return max(sizes.items(), key=lambda kv: kv[1])[0]


def _assign_ids(pages: dict) -> None:
    fig_n = 0
    tab_n = 0
    for pno in sorted(pages):
        info = pages[pno]
        units = order_page_units(info.blocks, info.captions, info.layout, info.rect)
        for u in units:
            if not isinstance(u, Caption):
                continue
            if u.kind == "table":
                tab_n += 1
                u.id = "tab%d" % tab_n
            else:
                fig_n += 1
                u.id = "fig%d" % fig_n


def _print_caption_table(captions: list, out=sys.stdout) -> None:
    if not captions:
        out.write("No figure/table captions detected.\n")
        return
    header = ("ID", "KIND", "PAGE", "LABEL", "CAPTION")
    rows = []
    for c in captions:
        snippet = c.text
        if len(snippet) > 88:
            snippet = snippet[:85].rstrip() + "..."
        rows.append((c.id, c.kind, str(c.page_no), c.label, snippet))
    widths = [max(len(h), max((len(r[i]) for r in rows), default=0))
              for i, h in enumerate(header)]
    fmt = "  ".join("%%-%ds" % w for w in widths)
    out.write(fmt % header + "\n")
    out.write(fmt % tuple("-" * w for w in widths) + "\n")
    for r in rows:
        out.write(fmt % r + "\n")


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    t0 = time.time()

    if not os.path.exists(args.pdf):
        sys.stderr.write("error: PDF not found: %s\n" % args.pdf)
        return 2
    try:
        doc = fitz.open(args.pdf)
    except Exception as exc:
        sys.stderr.write("error: cannot open PDF (%s): %s\n" % (args.pdf, exc))
        return 2
    if doc.page_count == 0:
        sys.stderr.write("error: PDF has no pages: %s\n" % args.pdf)
        return 2

    try:
        page_numbers = parse_pages(args.pages, doc.page_count)
    except ValueError as exc:
        sys.stderr.write("error: %s\n" % exc)
        return 2
    if not page_numbers:
        sys.stderr.write("error: --pages selected no pages\n")
        return 2

    body_size = _estimate_body_size(doc, page_numbers)
    _debug("[paper_ingest] body font size ~ %.1fpt" % body_size, args.debug)

    # ---------------- scan pages ---------------------------------------
    pages = {}
    captions = []
    problems = []
    for pno in page_numbers:
        try:
            info = _analyze_page(doc, pno, body_size)
        except Exception as exc:                  # one bad page must not kill the run
            problems.append((pno, str(exc)))
            sys.stderr.write("warning: page %d skipped (%s)\n" % (pno, exc))
            continue
        pages[pno] = info
        captions.extend(info.captions)

    _assign_ids(pages)
    captions.sort(key=lambda c: (c.page_no, round(c.rect.y0, 1), c.rect.x0))

    if args.list:
        _print_caption_table(captions)
        sys.stderr.write("[paper_ingest] %d caption(s) on %d page(s) in %.1fs\n"
                         % (len(captions), len(pages), time.time() - t0))
        return 0

    # ---------------- region detection ---------------------------------
    for pno in sorted(pages):
        info = pages[pno]
        for cap in info.captions:
            try:
                detect_region(cap, info, info.captions, doc)
            except Exception as exc:
                cap.manual = True
                cap.detect = "manual"
                cap.region = fitz.Rect(cap.rect)
                cap.warnings.append("region detection crashed (%s); override with --bbox" % exc)
                _debug("  page %d %s: region detection failed: %s" % (pno, cap.id, exc),
                       args.debug)
            _debug("  %s p%d %s kind=%s dir=%s gap=%.1f clusters=%d -> %s %s"
                   % (cap.id, pno, cap.label, cap.kind, cap.direction, cap.gap,
                      len(info.clusters),
                      _r(cap.region) if cap.region is not None else None,
                      cap.warnings), args.debug)

    # ---------------- bbox overrides -----------------------------------
    try:
        overrides = parse_bbox_overrides(args.bbox)
    except ValueError as exc:
        sys.stderr.write("error: %s\n" % exc)
        return 2
    if overrides:
        by_id = {c.id: c for c in captions}
        for key, rect in overrides.items():
            cap = by_id.get(key)
            if cap is None:
                sys.stderr.write("warning: --bbox %s did not match a detected id; ignored\n" % key)
                continue
            page_rect = pages[cap.page_no].rect
            cap.region = _clamp_rect(rect, page_rect)
            cap.detect = "manual"
            cap.manual = True
            cap.warnings.append("region overridden by --bbox")

    # ---------------- --only filter ------------------------------------
    only_ids = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else []
    if only_ids:
        wanted = set(only_ids)
        known = {c.id for c in captions}
        for missing in sorted(wanted - known):
            sys.stderr.write("warning: --only id %s not detected; ignored\n" % missing)
        captions = [c for c in captions if c.id in wanted]
    captions.sort(key=lambda c: (c.page_no, round(c.rect.y0, 1), c.rect.x0))

    # ---------------- output dirs --------------------------------------
    out_dir = args.out
    assets_dir = os.path.join(out_dir, "assets")
    debug_dir = os.path.join(out_dir, "debug")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)
    # idempotency: remove stale generated images from a previous run
    for name in os.listdir(assets_dir):
        if re.match(r"^(fig|tab)\d+\.png$", name):
            try:
                os.remove(os.path.join(assets_dir, name))
            except OSError:
                pass
    if os.path.isdir(debug_dir):
        for name in os.listdir(debug_dir):
            if re.match(r"^(fig|tab)\d+-overlay\.png$", name) or name == "contact-sheet.png":
                try:
                    os.remove(os.path.join(debug_dir, name))
                except OSError:
                    pass

    # ---------------- entries (clips computed after table refinement) --
    entries = []
    for cap in captions:
        entry = {
            "id": cap.id,
            "label": cap.label,
            "kind": cap.kind,
            "page": cap.page_no,
            "caption": cap.text,
            "bbox": None,
            "crop": "assets/%s.png" % cap.id,
            "width": None,
            "height": None,
            "detect": cap.detect,
            "warnings": list(cap.warnings),
            "_png": os.path.join(assets_dir, "%s.png" % cap.id),
            "_page_no": cap.page_no,
            "_blocks": cap.blocks,
            "_caption": cap,
        }
        entries.append(entry)

    # ---------------- tables (may refine table regions) -----------------
    tables_md = extract_tables(doc, pages, entries)

    # ---------------- clips + crops ------------------------------------
    for entry in entries:
        cap = entry["_caption"]
        info = pages[cap.page_no]
        clip = finalize_clip(cap, info.rect, args.with_caption)
        cap.clip = clip
        entry["bbox"] = _r(clip)

    if not args.no_crop:
        for entry in entries:
            cap = entry["_caption"]
            page = pages[cap.page_no].page
            try:
                w, h, dpi_eff = render_crop(page, cap.clip, args.dpi, args.max_width,
                                            entry["_png"])
                entry["width"], entry["height"] = w, h
                _debug("  crop %s: %dx%d px (%.0f dpi) clip=%s"
                       % (cap.id, w, h, dpi_eff, _r(cap.clip)), args.debug)
            except Exception as exc:
                sys.stderr.write("warning: crop %s failed (%s)\n" % (cap.id, exc))
                entry["_png"] = None
                entry["warnings"].append("crop rendering failed")

    # ---------------- debug artifacts ----------------------------------
    if not args.no_crop and entries:
        try:
            for entry in entries:
                cap = entry["_caption"]
                if not entry["_png"]:
                    continue
                page = pages[cap.page_no].page
                write_overlay(page, cap, cap.clip,
                              os.path.join(debug_dir, "%s-overlay.png" % cap.id),
                              pages[cap.page_no].rect)
            write_contact_sheet(entries, os.path.join(debug_dir, "contact-sheet.png"))
        except Exception as exc:
            sys.stderr.write("warning: debug artifacts failed (%s)\n" % exc)
        if args.debug:
            try:
                dump = {}
                for pno in sorted(pages):
                    info = pages[pno]
                    dump["page%d" % pno] = {
                        "layout": {"mode": info.layout.mode,
                                   "gutter": round(info.layout.gutter, 2)},
                        "clusters": [{"bbox": _r(c.rect), "band": c.band,
                                      "n_img": c.n_img, "n_draw": c.n_draw}
                                     for c in info.clusters],
                        "captions": [{
                            "id": c.id, "label": c.label, "bbox": _r(c.rect),
                            "region": _r(c.region) if c.region is not None else None,
                            "clip": _r(c.clip) if c.clip is not None else None,
                            "direction": c.direction, "gap": round(c.gap, 1),
                            "detect": c.detect, "warnings": c.warnings,
                        } for c in info.captions],
                    }
                os.makedirs(debug_dir, exist_ok=True)
                with open(os.path.join(debug_dir, "detect.json"), "w", encoding="utf-8") as fh:
                    json.dump(dump, fh, indent=1, ensure_ascii=False)
            except Exception as exc:
                sys.stderr.write("warning: could not write detect.json (%s)\n" % exc)

    # ---------------- write text/meta/captions -------------------------
    text_md = build_text_md(doc, pages)
    with open(os.path.join(out_dir, "text.md"), "w", encoding="utf-8") as fh:
        fh.write(text_md)

    meta = extract_meta(doc, args.pdf, pages)
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, ensure_ascii=False)

    with open(os.path.join(out_dir, "tables.md"), "w", encoding="utf-8") as fh:
        fh.write(tables_md)

    cap_lines = []
    for c in captions:
        cap_lines.append("%s\tp.%d\t%s\t%s" % (c.id, c.page_no, c.label,
                                              re.sub(r"\s+", " ", c.text)))
    with open(os.path.join(out_dir, "captions.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(cap_lines) + ("\n" if cap_lines else ""))

    public_entries = []
    for e in entries:
        public_entries.append({k: v for k, v in e.items() if not k.startswith("_")})
    with open(os.path.join(out_dir, "figures.json"), "w", encoding="utf-8") as fh:
        json.dump(public_entries, fh, indent=1, ensure_ascii=False)
        fh.write("\n")

    # ---------------- summary ------------------------------------------
    n_fig = sum(1 for e in entries if e["kind"] == "figure")
    n_tab = sum(1 for e in entries if e["kind"] == "table")
    n_manual = sum(1 for e in entries if e["detect"] == "manual")
    rel = os.path.relpath(out_dir)
    print("[paper_ingest] %s -> %s" % (args.pdf, rel))
    print("  pages scanned: %d/%d  figures: %d  tables: %d  crops: %d%s"
          % (len(pages), doc.page_count, n_fig, n_tab,
             sum(1 for e in entries if e["_png"]),
             "  (no-crop)" if args.no_crop else ""))
    for e in entries:
        warn = ""
        if e["warnings"]:
            warn = "  ! " + "; ".join(e["warnings"][:2])
        size = ("%dx%d" % (e["width"], e["height"])) if e["width"] else "-"
        print("  %-5s p%-3d %-28s %-8s bbox=%s %s%s"
              % (e["id"], e["page"], e["label"][:28], e["detect"],
                 e["bbox"], size, warn))
    if n_manual:
        print("  note: %d crop(s) flagged manual/uncertain - inspect debug/contact-sheet.png"
              % n_manual)
    if problems:
        print("  note: %d page(s) skipped due to errors" % len(problems))
    print("  debug: %s  (%.1fs)" % (os.path.join(rel, "debug") if not args.no_crop else "skipped",
                                    time.time() - t0))
    doc.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
