#!/usr/bin/env bash
# Optional browser smoke test (not in CI). Starts an isolated backend (temporary SQLite DB) and Vite,
# runs smoke.mjs in headless Chrome, then stops both. The development database is never used.
# Needs: backend venv active, `npm ci` in frontend/ and here, Google Chrome (or set CHROME_PATH).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
API_PORT=${API_PORT:-8100}
APP_PORT=${APP_PORT:-5273}
TMP=$(mktemp -d)
BACK="" FRONT=""
cleanup() { kill $BACK $FRONT 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

for port in "$API_PORT" "$APP_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:$port"; then echo "Port $port is already in use." >&2; exit 1; fi
done

(cd "$ROOT/backend" && exec python3 -c "
import pathlib, sys, uvicorn, db
db.DB_PATH = pathlib.Path(sys.argv[1])
from main import app
uvicorn.run(app, host='127.0.0.1', port=int(sys.argv[2]), log_level='warning')" "$TMP/smoke.db" "$API_PORT") &
BACK=$!
(cd "$ROOT/frontend" && API_TARGET="http://127.0.0.1:$API_PORT" exec ./node_modules/.bin/vite \
  --port "$APP_PORT" --strictPort >"$TMP/vite.log" 2>&1) &
FRONT=$!

for url in "http://127.0.0.1:$API_PORT/ready" "http://localhost:$APP_PORT/"; do
  for _ in $(seq 60); do curl -sf -o /dev/null "$url" && break; sleep 0.5; done
  curl -sf -o /dev/null "$url" || { echo "Not reachable: $url" >&2; exit 1; }
done

APP_URL="http://localhost:$APP_PORT/" API_URL="http://127.0.0.1:$API_PORT" DB="$TMP/smoke.db" \
  node "$ROOT/scripts/browser-smoke/smoke.mjs"
