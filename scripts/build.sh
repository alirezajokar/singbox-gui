#!/usr/bin/env bash
# Build the app into ./dist (a runnable folder). Uses `tinyjs` from PATH or ./.tinyjs.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v tinyjs >/dev/null 2>&1; then
  TINYJS=tinyjs
else
  [ -x .tinyjs/tinyjs ] || scripts/install-tinyjs.sh
  TINYJS=.tinyjs/tinyjs
fi

"$TINYJS" build
