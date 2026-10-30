#!/usr/bin/env python3
"""Serve the paper-read library locally with live refresh.

Why a server? A page opened from ``file://`` cannot list local directories, so a
static ``index.html`` is a snapshot that must be rebuilt. This tiny stdlib server
scans the library folder on demand and exposes:

    GET /                index.html (with window.__LIBRARY_LIVE__ injected)
    GET /api/library     {"papers": [...], "stats": {...}}  (same schema as the builder)
    GET /<file>          reports / RAW PDFs / attachments (Range-aware)

The library page then uses its 「刷新」 button (and a cheap 20 s poll) to pick up
new reports without rebuilding index.html.

Usage:
  python3 serve_library.py --root paper-read/ [--port 8765] [--open]
  # then open http://127.0.0.1:8765/  (or it opens for you)
"""
import argparse
import json
import mimetypes
import os
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_library as lib  # noqa: E402


class LibraryState:
    """Cached library payload, rebuilt only when files on disk changed."""

    def __init__(self, root, title, thumb_width=320):
        self.root = Path(root).resolve()
        self.title = title
        self.thumb_width = thumb_width
        self.cache_dir = self.root / ".library-cache" / "thumbs"
        self.lock = threading.Lock()
        self.signature = None
        self.payload = None
        self.last_sync = None
        self.taxonomy = lib.load_taxonomy(None)

    def disk_signature(self):
        rows = []
        for directory in sorted(self.root.iterdir()):
            if not directory.is_dir() or directory.name.startswith((".", "_")):
                continue
            report = lib.find_report(directory)
            if not report:
                continue
            rows.append((directory.name, report.name, report.stat().st_size, report.stat().st_mtime_ns))
            for pattern in ("RAW-*.pdf", "*.pdf"):
                for extra in sorted(directory.glob(pattern)):
                    if extra == report.with_suffix(".pdf"):
                        continue
                    rows.append((extra.name, extra.stat().st_size, extra.stat().st_mtime_ns))
        return tuple(rows)

    def get(self, force=False):
        with self.lock:
            signature = self.disk_signature()
            if not force and self.payload is not None and signature == self.signature:
                return self.payload
            started = time.time()
            self.payload = lib.build_payload(
                self.root, self.root, self.thumb_width, 120000, True,
                self.taxonomy, self.cache_dir,
            )
            self.signature = signature
            self.last_sync = time.strftime("%Y-%m-%dT%H:%M:%S")
            print("[serve] scanned %d papers in %.2fs" % (len(self.payload["papers"]), time.time() - started),
                  flush=True)
            return self.payload


STATE = None


class Handler(SimpleHTTPRequestHandler):
    server_version = "PaperDeepreadLibrary/1.0"

    def log_message(self, fmt, *args):  # keep the console quiet
        sys.stderr.write("[serve] %s\n" % (fmt % args))

    def _json(self, data, status=200, cache="no-store"):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, extra_headers=None):
        try:
            data_len = path.stat().st_size
        except OSError:
            return self._json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        range_header = self.headers.get("Range")
        start, end = 0, data_len - 1
        status = 200
        if range_header and range_header.startswith("bytes=") and data_len:
            try:
                spec = range_header.split("=", 1)[1].split(",")[0]
                a, _, b = spec.partition("-")
                if a:
                    start = int(a)
                    end = int(b) if b else data_len - 1
                elif b:
                    start = max(0, data_len - int(b))
                    end = data_len - 1
                if start > end or start >= data_len:
                    raise ValueError
                end = min(end, data_len - 1)
                status = 206
            except ValueError:
                start, end, status = 0, data_len - 1, 200
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, data_len))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            with path.open("rb") as fh:
                fh.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = fh.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        parts = urlsplit(self.path)
        path = unquote(parts.path)
        if path in ("/api/library", "/api/library.json"):
            payload = STATE.get()
            body = dict(payload)
            body["live"] = True
            body["title"] = STATE.title
            body["sync"] = STATE.last_sync
            return self._json(body)
        if path in ("/", "/index.html"):
            index = STATE.root / "index.html"
            if not index.exists():
                return self._json({"error": "index.html not found; run build_library.py first"}, 404)
            html = index.read_text(encoding="utf-8")
            inject = (
                "<script>window.__LIBRARY_LIVE__=%s;</script>"
                % json.dumps({"title": STATE.title, "buildDate": time.strftime("%Y-%m-%d")}, ensure_ascii=False)
            )
            html = html.replace("<head>", "<head>\n" + inject, 1)
            data = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        # static files under root (reports, RAW PDFs, images, md)
        target = (STATE.root / path.lstrip("/")).resolve()
        try:
            target.relative_to(STATE.root)
        except ValueError:
            return self._json({"error": "forbidden"}, 403)
        if not target.is_file():
            return self._json({"error": "not found"}, 404)
        return self._send_file(target, {"Cache-Control": "no-cache"})


def main():
    global STATE
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="paper-read")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--title", default="文献精读库")
    ap.add_argument("--open", action="store_true", help="open the library in the default browser")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not (root / "index.html").exists():
        sys.exit("[serve] %s/index.html not found; run build_library.py first" % root)
    STATE = LibraryState(root, args.title)
    print("[serve] scanning %s ..." % root, flush=True)
    payload = STATE.get()
    print("[serve] %d papers ready · http://%s:%d/" % (len(payload["papers"]), args.host, args.port), flush=True)

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    url = "http://%s:%d/" % (args.host, args.port)
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
