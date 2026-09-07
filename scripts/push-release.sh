#!/usr/bin/env bash
# Push CorpusMind Voice and trigger the v1.0.0 desktop-build release.
#
# The CI pipeline (.github/workflows/build.yml) reacts to the v1.0.0 tag:
#   web build → desktop builds (win-x64, linux-x64, mac-arm64, mac-x64)
#   → release job: deletes every other release/tag (single-release policy)
#     and publishes exactly ONE release — v1.0.0 — with all installers.
#
# Usage:
#   GITHUB_TOKEN=ghp_xxx REPO=waleedmandour/CorpusMindVoice bash scripts/push-release.sh
#
# REPO defaults to waleedmandour/CorpusMindVoice — override if the repo
# is named differently on GitHub.
set -euo pipefail

: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a fresh token (the old one was revoked)}"
: "${REPO:=waleedmandour/CorpusMind-Voice}"

cd "$(dirname "$0")/.."

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "→ pushing main …"
git push origin main

echo "→ pushing tag v1.0.0 (triggers desktop builds + release) …"
git push origin v1.0.0

# belt & suspenders: the release job also cleans old releases/tags on the
# remote, but tidy up now so the repo is clean even before CI finishes.
echo "→ removing old remote releases and v* tags (keep only v1.0.0) …"
api="https://api.github.com/repos/${REPO}"
for rid in $(curl -sS -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api/releases?per_page=100" \
             | python3 -c "import json,sys; [print(r['id']) for r in json.load(sys.stdin) if r.get('tag_name')!='v1.0.0']" 2>/dev/null || true); do
  echo "   delete release id=$rid"
  curl -sS -X DELETE -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api/releases/$rid" || true
done
for t in $(curl -sS -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api/tags?per_page=100" \
           | python3 -c "import json,sys; [print(t['name']) for t in json.load(sys.stdin) if t.get('name','').startswith('v') and t['name']!='v1.0.0']" 2>/dev/null || true); do
  echo "   delete tag $t"
  curl -sS -X DELETE -H "Authorization: Bearer ${GITHUB_TOKEN}" "$api/git/refs/tags/$t" || true
done

echo
echo "✓ Pushed. Watch the builds: https://github.com/${REPO}/actions"
echo "✓ Single release will appear at: https://github.com/${REPO}/releases/tag/v1.0.0"
echo "⚠ Remember: this token was used in a shell command — revoke and rotate it afterwards."
