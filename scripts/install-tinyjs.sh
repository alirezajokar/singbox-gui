#!/usr/bin/env bash
# Download a pinned TinyJS release into ./.tinyjs (nothing is installed system-wide).
#   scripts/install-tinyjs.sh            # uses TINYJS_VERSION or the default below
# Afterwards put ./.tinyjs on PATH, or just run scripts/build.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${TINYJS_VERSION:-v0.56.0}"
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x86_64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

BASE="https://github.com/tarwin/tinyjsapp/releases/download/${VERSION}"
FILE="tinyjs-linux-${ARCH}.tar.gz"
DEST=".tinyjs"

if [ -x "$DEST/tinyjs" ] && [ "$(cat "$DEST/VERSION" 2>/dev/null || true)" = "$VERSION" ]; then
  echo "TinyJS $VERSION already present in $DEST"
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading TinyJS $VERSION ($ARCH)…"
curl -fsSL --retry 3 -o "$tmp/$FILE" "$BASE/$FILE"

# Verify against the checksums published with the release.
if curl -fsSL --retry 3 -o "$tmp/checksums.txt" "$BASE/checksums.txt"; then
  (cd "$tmp" && grep " $FILE\$" checksums.txt | sha256sum -c -)
else
  echo "warning: checksums.txt not available, skipping verification" >&2
fi

rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$tmp/$FILE" -C "$DEST" --strip-components=1
echo "TinyJS $("$DEST/tinyjs" version) ready in $DEST"
