#!/usr/bin/env bash
set -euo pipefail

STREETSHIFT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STREETSHIFT_PYTHON="${PYTHON_BIN:-python3}"

if ! command -v "$STREETSHIFT_PYTHON" >/dev/null 2>&1; then
  echo "Python was not found. Set PYTHON_BIN to a Python 3.10+ executable." >&2
  exit 1
fi

"$STREETSHIFT_PYTHON" -m venv "$STREETSHIFT_ROOT/.venv"
"$STREETSHIFT_ROOT/.venv/bin/python" -m pip install -r "$STREETSHIFT_ROOT/requirements.txt"

STREETSHIFT_PNPM="$(command -v pnpm || true)"
if [[ -z "$STREETSHIFT_PNPM" ]]; then
  echo "pnpm was not found. Install pnpm or add it to PATH." >&2
  exit 1
fi

cd "$STREETSHIFT_ROOT/web"
"$STREETSHIFT_PNPM" install

echo "Setup complete. Run ./scripts/dev.sh"
