#!/usr/bin/env bash
# Fails when a change to what users install does not bump the plugin version
# and add a changelog entry for it.
#
#   scripts/check-version.sh [base]    base defaults to origin/main
set -euo pipefail

base="${1:-origin/main}"
manifest=".claude-plugin/plugin.json"
shipped='^(skills/|agents/|hooks/|types/|\.claude-plugin/plugin\.json$)'

version_at() {
  git show "$1:$manifest" | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["version"])'
}

changed=$(git diff --name-only "$base"...HEAD | grep -E "$shipped" || true)
if [ -z "$changed" ]; then
  echo "No plugin files changed; no version bump needed."
  exit 0
fi

old=$(version_at "$base")
new=$(version_at HEAD)

if [ "$old" = "$new" ]; then
  echo "Plugin files changed but the version is still $new. Bump \"version\" in $manifest:"
  echo "$changed" | sed 's/^/  /'
  exit 1
fi

if ! grep -qE "^## ${new//./\\.}( |$)" CHANGELOG.md; then
  echo "Version is $new but CHANGELOG.md has no \"## $new\" entry."
  exit 1
fi

echo "Version $old -> $new, with a changelog entry."
