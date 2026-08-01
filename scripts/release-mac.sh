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

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# Create the release up front.
#
# electron-builder runs one publisher per artifact (zip + blockmap) and they
# race to create the release. One wins; the loser gets
#   422 "Published releases must have a valid tag"
# and aborts the whole run — killing the in-flight 180MB zip upload while the
# small blockmap has already finished. That's how 0.4.0 and 0.4.1 both ended
# up published with their zip and latest-mac.yml missing, which the updater
# can see but can't download. With the release already there, both publishers
# skip creation and just upload.
if gh release view "$TAG" >/dev/null 2>&1; then
  echo "→ Release $TAG already exists — uploading into it."
else
  echo "→ Creating release $TAG…"
  gh release create "$TAG" --title "$VERSION" --generate-notes
fi

echo "→ Building + publishing…"
npx electron-vite build
npx electron-builder --mac --publish always

# electron-builder exits 0 on a partial upload, so confirm the updater has
# everything it needs before calling this a release.
echo "→ Verifying assets…"
missing=""
for want in "latest-mac.yml" "mucka-toolbench-${VERSION}-arm64-mac.zip"; do
  gh release view "$TAG" --json assets --jq '.assets[].name' | grep -qx "$want" || missing="$missing $want"
done
if [ -n "$missing" ]; then
  echo "  Release $TAG is INCOMPLETE — missing:$missing" >&2
  echo "  Delete the partial assets and rerun:" >&2
  echo "    gh release view $TAG --json assets --jq '.assets[].name' | xargs -I{} gh release delete-asset $TAG {} -y" >&2
  exit 1
fi

echo "✓ Release published. Check https://github.com/TomFromMucka/Mucka-Toolbench/releases"
