#!/usr/bin/env bash
#
# Build + publish the Mac DMG to GitHub Releases.
#
# Loads `.env` so electron-builder picks up GITHUB_TOKEN (which we also
# export as GH_TOKEN — the name electron-publish actually looks at).
# Without this, the publish step fails with:
#   Error: GitHub Personal Access Token is not set …
# because `.env` is only loaded inside the Electron app's main process,
# not in the shell where electron-builder runs.
#
# Usage:  npm run release:mac

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [[ ! -f .env ]]; then
  echo "  .env not found at $PROJECT_DIR/.env — release needs GITHUB_TOKEN." >&2
  exit 1
fi

# Export every KEY=VALUE in .env to this shell. `allexport` makes every
# subsequent assignment exported; the trailing `+a` switches it back off.
set -a
# shellcheck disable=SC1091
. .env
set +a

# electron-publish reads GH_TOKEN; the rest of the cockpit's GitHub
# integration reads GITHUB_TOKEN. Mirror them so either is enough.
if [[ -z "${GH_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi
if [[ -z "${GITHUB_TOKEN:-}" && -n "${GH_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="$GH_TOKEN"
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "  Neither GH_TOKEN nor GITHUB_TOKEN is set in .env. Add a PAT" >&2
  echo "  with public_repo write scope and try again." >&2
  exit 1
fi

echo "→ Building + publishing…"
npx electron-vite build
npx electron-builder --mac --publish always

echo "✓ Release published. Check https://github.com/TomFromMucka/Mucka-Toolbench/releases"
