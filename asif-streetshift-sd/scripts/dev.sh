#!/usr/bin/env bash
set -euo pipefail

STREETSHIFT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STREETSHIFT_PYTHON="$STREETSHIFT_ROOT/.venv/bin/python"

if [[ ! -x "$STREETSHIFT_PYTHON" ]]; then
  echo "Python environment missing. Run ./scripts/setup.sh first." >&2
  exit 1
fi

STREETSHIFT_PNPM="$(command -v pnpm || true)"
if [[ -z "$STREETSHIFT_PNPM" ]]; then
  echo "pnpm was not found. Run ./scripts/setup.sh after installing pnpm." >&2
  exit 1
fi

STREETSHIFT_API_PID=""
STREETSHIFT_WEB_PID=""

cleanup() {
  if [[ -n "$STREETSHIFT_API_PID" ]]; then
    kill "$STREETSHIFT_API_PID" 2>/dev/null || true
  fi
  if [[ -n "$STREETSHIFT_WEB_PID" ]]; then
    kill "$STREETSHIFT_WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$STREETSHIFT_ROOT"
"$STREETSHIFT_PYTHON" -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 &
STREETSHIFT_API_PID=$!

cd "$STREETSHIFT_ROOT/web"
"$STREETSHIFT_PNPM" dev --host 127.0.0.1 &
STREETSHIFT_WEB_PID=$!

echo "StreetShift: http://127.0.0.1:5173"
echo "API docs:  http://127.0.0.1:8000/docs"
wait
