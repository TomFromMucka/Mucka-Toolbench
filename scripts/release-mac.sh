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

# Token resolution — first source wins:
#   1. GH_TOKEN already set in the shell (manual override / CI)
#   2. `gh auth token` if the gh CLI is installed and logged in (the
#      preferred path on Tom's machine — gh's token has the broad `repo`
#      scope that the fine-grained PATs in .env tend to miss)
#   3. GITHUB_TOKEN / GH_TOKEN from .env (legacy fallback)
TOKEN_SOURCE=""
if [[ -n "${GH_TOKEN:-}" ]]; then
  TOKEN_SOURCE="shell env"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  GH_TOKEN="$(gh auth token)"
  export GH_TOKEN
  TOKEN_SOURCE="gh CLI"
elif [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
  if [[ -z "${GH_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
    export GH_TOKEN="$GITHUB_TOKEN"
    TOKEN_SOURCE=".env (GITHUB_TOKEN)"
  elif [[ -n "${GH_TOKEN:-}" ]]; then
    TOKEN_SOURCE=".env (GH_TOKEN)"
  fi
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "  No GitHub token found. Options:" >&2
  echo "    - run \`gh auth login\` (recommended, broad scope auto-set)" >&2
  echo "    - or set GITHUB_TOKEN / GH_TOKEN in .env with Contents:write scope" >&2
  exit 1
fi

# Mirror to GITHUB_TOKEN for any tool that reads that name.
export GITHUB_TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"

echo "→ Using GitHub token from: $TOKEN_SOURCE"

echo "→ Building + publishing…"
npx electron-vite build
npx electron-builder --mac --publish always

echo "✓ Release published. Check https://github.com/TomFromMucka/Mucka-Toolbench/releases"
