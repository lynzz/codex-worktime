#!/usr/bin/env bash
# Start the manual timesheet web app.
#
#   ./start.sh            build web if needed, then serve on http://localhost:8787
#   ./start.sh --rebuild  force a fresh web build before serving
#   ./start.sh dev        vite dev server with hot reload
#
# PORT env overrides the serve port (default 8787).
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env.local ]]; then
  echo "warn: .env.local not found; run 'neon link' to write DATABASE_URL" >&2
fi

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

case "${1:-}" in
  dev)
    exec npm run dev:web
    ;;
  --rebuild)
    rebuild=1
    ;;
  "")
    rebuild=0
    ;;
  *)
    echo "usage: $0 [dev|--rebuild]" >&2
    exit 1
    ;;
esac

if [[ "$rebuild" == 1 || ! -f web/.output/server/index.mjs ]]; then
  echo "==> building web"
  npm run build -w @codex-worktime/web
fi

exec npm run serve
