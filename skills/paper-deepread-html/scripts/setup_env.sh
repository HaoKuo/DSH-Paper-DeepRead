#!/usr/bin/env bash
# Resolve (and if necessary create) a Python interpreter that has PyMuPDF.
# Prints the interpreter path on stdout; diagnostics go to stderr.
#
# Resolution order:
#   1. $PAPER_READ_PY if set and importable
#   2. cached venv at ${XDG_CACHE_HOME:-$HOME/.cache}/paper-deepread/venv
#   3. any python3 on PATH that already imports fitz
#   4. create the cached venv and pip-install pymupdf (needs network once)
set -euo pipefail

CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/paper-deepread"
VENV="$CACHE_DIR/venv"
VENV_PY="$VENV/bin/python"

ok() { "$1" -c "import fitz" >/dev/null 2>&1; }

if [ -n "${PAPER_READ_PY:-}" ] && ok "$PAPER_READ_PY"; then
  echo "$PAPER_READ_PY"; exit 0
fi
if [ -x "$VENV_PY" ] && ok "$VENV_PY"; then
  echo "$VENV_PY"; exit 0
fi
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && ok "$(command -v "$cand")"; then
    command -v "$cand"; exit 0
  fi
done

BASE_PY="${PAPER_READ_BASE_PY:-$(command -v python3 || true)}"
[ -n "$BASE_PY" ] || { echo "ERROR: python3 not found" >&2; exit 1; }
echo "[setup_env] creating venv at $VENV (base: $BASE_PY)" >&2
mkdir -p "$CACHE_DIR"
"$BASE_PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check --upgrade pip >&2 || true
# Prefer uv when available: it is much faster and honours PEP-723. Fall back to pip.
if command -v uv >/dev/null 2>&1; then
  echo "[setup_env] installing pymupdf via uv" >&2
  if ! uv pip install --python "$VENV_PY" pymupdf >&2; then
    echo "[setup_env] uv failed, falling back to pip" >&2
    "$VENV/bin/python" -m pip install --disable-pip-version-check pymupdf >&2
  fi
else
  echo "[setup_env] installing pymupdf via pip" >&2
  "$VENV/bin/python" -m pip install --disable-pip-version-check pymupdf >&2
fi

ok "$VENV_PY" || { echo "ERROR: pymupdf install failed" >&2; exit 1; }
echo "$VENV_PY"
