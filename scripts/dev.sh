#!/usr/bin/env bash
# CHRONOS 開発サーバー起動: FastAPI (:8000) + Vite (:5173)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -x "$ROOT/backend/.venv/bin/python" ]; then
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  (cd "$ROOT/frontend" && npm install)
fi

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd "$ROOT/backend" && .venv/bin/uvicorn chronos.api:app --host 127.0.0.1 --port 8000) &
(cd "$ROOT/frontend" && npx vite --host 127.0.0.1 --port 5173) &
echo "CHRONOS: http://127.0.0.1:5173  (API: http://127.0.0.1:8000/docs)"
wait
