#!/usr/bin/env bash
# Run the app with hot reload (needs a display). Uses `tinyjs` from PATH or ./.tinyjs.
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v tinyjs >/dev/null 2>&1; then
  TINYJS=tinyjs
else
  [ -x .tinyjs/tinyjs ] || scripts/install-tinyjs.sh
  TINYJS=.tinyjs/tinyjs
fi

# The unprivileged parts work as-is; to try root actions from a checkout the
# app finds packaging/singbox-gui-helper (pkexec will ask for a password each time).
exec "$TINYJS" dev
