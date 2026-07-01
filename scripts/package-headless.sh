#!/usr/bin/env bash
# Package headless Agent Desktop as a standalone distribution.
# Output: dist-headless/ — deployable on any Node 18+ machine without Electron.
#
# Usage:
#   ./scripts/package-headless.sh            # build + package
#   ./scripts/package-headless.sh --skip-build  # package only (assumes out/ is fresh)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist-headless"
OUT="$ROOT/out"

# ─── Options ─────────────────────────────────────

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

# ─── Build if needed ─────────────────────────────

if [ "$SKIP_BUILD" = false ]; then
  echo "[package-headless] Building electron-vite (renderer)..."
  npm run build --prefix "$ROOT"

  echo "[package-headless] Building headless bundle (esbuild)..."
  npm run build:headless --prefix "$ROOT"
fi

# Verify artifacts exist
for f in "$OUT/headless/index.js" "$OUT/headless/sql-wasm.wasm" "$OUT/renderer/index.html"; do
  if [ ! -f "$f" ]; then
    echo "[package-headless] ERROR: missing $f — run without --skip-build"
    exit 1
  fi
done

# ─── Assemble dist ───────────────────────────────

rm -rf "$DIST"
mkdir -p "$DIST/renderer"

# Core bundle + WASM
cp "$OUT/headless/index.js" "$DIST/"
cp "$OUT/headless/sql-wasm.wasm" "$DIST/"

# Renderer static files (for --server mode)
cp -r "$OUT/renderer/." "$DIST/renderer/"

# Read version from source package.json
VERSION=$(node -p "require('$ROOT/package.json').version")

# Minimal package.json with only runtime externals
cat > "$DIST/package.json" << PKGJSON
{
  "name": "agent-desktop-headless",
  "version": "$VERSION",
  "description": "Headless Agent Desktop — web server + Discord bot, no Electron required.",
  "main": "index.js",
  "scripts": {
    "start:server": "node index.js --server",
    "start:discord": "node index.js --discord",
    "start": "node index.js --server --discord"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.37"
  },
  "optionalDependencies": {
    "sherpa-onnx-node": "^1.13.2",
    "bufferutil": "^4.0.8",
    "utf-8-validate": "^6.0.3"
  },
  "engines": {
    "node": ">=18"
  }
}
PKGJSON

# ─── Summary ─────────────────────────────────────

TOTAL=$(du -sh "$DIST" | cut -f1)
echo ""
echo "[package-headless] Standalone headless packaged → dist-headless/ ($TOTAL)"
echo ""
echo "  Deploy:"
echo "    cd dist-headless && npm install"
echo "    node index.js --server                    # web UI"
echo "    node index.js --discord                   # Discord bot"
echo "    node index.js --server --discord           # both"
echo "    node index.js --server --port 8080         # custom port"
echo "    node index.js --tick                       # run scheduled tasks"
echo ""
echo "  Env vars:"
echo "    AGENT_DB_PATH     — SQLite DB path (default: ~/.config/agent-desktop/agent.db)"
echo "    AGENT_THEMES_DIR  — themes dir (default: ~/.agent-desktop/themes)"
echo "    DISCORD_TOKEN     — Discord bot token (for --discord)"
