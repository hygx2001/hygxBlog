#!/usr/bin/env bash
set -euo pipefail

BLOG_DIR="$(cd "$(dirname "$0")" && pwd)"
EDITOR_DIR="$(cd "$(dirname "$0")/hygx-editor" && pwd)"
BLOG_PORT=4321
EDITOR_PORT=7878

BLOG_PID=""
EDITOR_PID=""

cleanup() {
  echo ""
  echo "Stopping blog (PID $BLOG_PID) and editor (PID $EDITOR_PID) ..."
  [ -n "$BLOG_PID" ] && kill "$BLOG_PID" 2>/dev/null || true
  [ -n "$EDITOR_PID" ] && kill "$EDITOR_PID" 2>/dev/null || true
  wait "$BLOG_PID" 2>/dev/null || true
  wait "$EDITOR_PID" 2>/dev/null || true
  exit 0
}

trap cleanup INT TERM EXIT

ensure_deps() {
  local dir="$1"
  if [ ! -d "$dir/node_modules" ]; then
    echo "==> Installing dependencies in $dir ..."
    (cd "$dir" && npm install)
  else
    echo "==> Dependencies already installed in $dir"
  fi
}

echo "==> Preparing dependencies"
ensure_deps "$BLOG_DIR"
ensure_deps "$EDITOR_DIR"

echo ""
echo "==> Starting blog dev server at http://localhost:$BLOG_PORT"
(cd "$BLOG_DIR" && npm run dev) &
BLOG_PID=$!

echo "==> Starting editor at http://localhost:$EDITOR_PORT"
(cd "$EDITOR_DIR" && npm start) &
EDITOR_PID=$!

echo ""
echo "------------------------------------------------------------"
echo "  Blog  : http://localhost:$BLOG_PORT"
echo "  Editor: http://localhost:$EDITOR_PORT"
echo "  Press Ctrl+C to stop both"
echo "------------------------------------------------------------"
echo ""

wait "$BLOG_PID"
wait "$EDITOR_PID"
