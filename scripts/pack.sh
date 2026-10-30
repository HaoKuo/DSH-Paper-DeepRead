#!/usr/bin/env bash
# Build the installable DSH-Paper-DeepRead package.
#
# Validates every shipped JavaScript file with `node --check`, packs the
# tarball into dist/ with npm, writes dist/SHA256SUMS, and prints the tarball
# size. The library/ directory (56 MB of reports and PDFs) is intentionally
# part of the package, so the tarball is large.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TARBALL="dist/dsh-paper-deepread-${VERSION}.tgz"

echo "==> Checking JavaScript syntax"
node --check src/index.js
node --check src/library.js
node --check src/route.js
node --check src/skill.js
node --check lib/client.js
echo "    ok: src/index.js src/library.js src/route.js src/skill.js lib/client.js"

echo "==> Packing dsh-paper-deepread@${VERSION}"
mkdir -p dist
rm -f "${TARBALL}"
npm pack --pack-destination dist

if [ ! -f "${TARBALL}" ]; then
  echo "error: npm pack did not produce ${TARBALL}" >&2
  exit 1
fi

echo "==> Writing dist/SHA256SUMS"
(
  cd dist
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "dsh-paper-deepread-${VERSION}.tgz" > SHA256SUMS
  else
    shasum -a 256 "dsh-paper-deepread-${VERSION}.tgz" > SHA256SUMS
  fi
  cat SHA256SUMS
)

echo "==> Tarball"
ls -lh "${TARBALL}"
echo "    files: $(tar -tzf "${TARBALL}" | wc -l | tr -d ' ')"
echo "    sha256: $(awk '{print $1}' dist/SHA256SUMS)"
