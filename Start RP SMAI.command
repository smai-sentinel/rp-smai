#!/bin/bash
set -e
cd "$(dirname "$0")"
runtime_root="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if ! command -v node >/dev/null 2>&1 && [ -x "$runtime_root/node/bin/node" ]; then
  export PATH="$runtime_root/node/bin:$runtime_root/bin/fallback:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.12 or newer, then run this launcher again."
  read -r -p "Press Enter to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile
  else
    npm install
  fi
fi
node node_modules/vite/bin/vite.js build
echo "RP SMAI: http://localhost:3000 — keep this window open while playing."
echo "Press Ctrl+C to stop the server."
if command -v open >/dev/null 2>&1; then
  (sleep 2; open http://localhost:3000) &
fi
node --env-file-if-exists=.env server/index.js
