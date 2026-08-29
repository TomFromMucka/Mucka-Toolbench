#!/usr/bin/env bash
#
# End-of-day update for the installed Mucka Toolbench app.
# - Builds a fresh production bundle + .app
# - Quits the running installed app (graceful)
# - Replaces /Applications/Mucka Toolbench.app
#
# Dev mode (`npm run dev`) uses a separate userData folder, so this
# only touches the installed app's own state.
#
# Usage:  npm run install:mac

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="/Applications/Mucka Toolbench.app"

cd "$PROJECT_DIR"

echo "→ Building…"
npm run build:mac

# Locate the built .app — electron-builder names the arch folder
# `mac-arm64` on Apple Silicon, `mac` on Intel.
BUILT_APP="$(find "$PROJECT_DIR/dist" -maxdepth 2 -name "Mucka Toolbench.app" -type d | head -1)"
if [[ -z "$BUILT_APP" || ! -d "$BUILT_APP" ]]; then
  echo "  Build did not produce a Mucka Toolbench.app under dist/" >&2
  exit 1
fi
echo "  Built: $BUILT_APP"

# Without this file electron-updater throws at startup —
#   ENOENT ... Contents/Resources/app-update.yml
# — and the in-app update button can't even reach GitHub to check. It is
# seeded by `extraResources` in electron-builder.yml, because electron-builder
# itself only generates it on a run that publishes and `build:mac` doesn't.
# Fail here rather than silently installing an app that can never update
# itself, which is how 0.5.0 sat un-updatable for twelve days.
if [[ ! -f "$BUILT_APP/Contents/Resources/app-update.yml" ]]; then
  echo "  Built app has no Contents/Resources/app-update.yml." >&2
  echo "  The installed app would be unable to check for updates." >&2
  echo "  Check the extraResources block in electron-builder.yml." >&2
  exit 1
fi

# Graceful quit if the installed app is running.
if pgrep -f "Mucka Toolbench.app/Contents/MacOS" >/dev/null; then
  echo "→ Quitting running app…"
  osascript -e 'tell application "Mucka Toolbench" to quit' || true
  for _ in $(seq 1 20); do
    if ! pgrep -f "Mucka Toolbench.app/Contents/MacOS" >/dev/null; then
      break
    fi
    sleep 0.5
  done
  if pgrep -f "Mucka Toolbench.app/Contents/MacOS" >/dev/null; then
    echo "  App didn't quit cleanly — close it manually and rerun." >&2
    exit 1
  fi
fi

echo "→ Replacing ${APP_PATH}…"
rm -rf "$APP_PATH"
ditto "$BUILT_APP" "$APP_PATH"

echo "✓ Installed. Launch from Spotlight / Launchpad."
