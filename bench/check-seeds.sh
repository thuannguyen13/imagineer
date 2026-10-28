#!/usr/bin/env bash
# Proves the bench is sound: every scenario prepares, the app's own checks pass,
# and each seeded defect fails its oracle and only its oracle.
# Usage: bench/check-seeds.sh [scenario-id ...]
set -uo pipefail

bench=$(cd "$(dirname "$0")" && pwd)
ids=("$@")
[ ${#ids[@]} -gt 0 ] || ids=($(ls "$bench/scenarios" | grep -v '^_'))
dirs=()
trap 'rm -rf "${dirs[@]}"' EXIT
status=0

# Prints "<tests> <fail>" from node --test output.
counts() { awk '/^ℹ tests /{t=$3} /^ℹ fail /{f=$3} END{print t+0, f+0}'; }

for id in "${ids[@]}"; do
  dir=$(mktemp -d); dirs+=("$dir")
  if ! "$bench/prepare.sh" "$id" "$dir" > /dev/null 2>&1; then
    echo "FAIL $id: prepare.sh failed"; status=1; continue
  fi
  code=$dir
  [ -d "$dir/.claude/worktrees/approvals" ] && code=$dir/.claude/worktrees/approvals
  read -r tests fails < <(cd "$code" && npm test 2>&1 | counts)
  own=fail; [ "$tests" -gt 0 ] && [ "$fails" = 0 ] && own=pass
  types=$(cd "$code" && npx tsc --noEmit > /dev/null 2>&1 && echo ok || echo fail)
  failing=-
  if [ -f "$code/src/approvals.ts" ]; then
    failing=
    mkdir -p "$code/oracle" && cp "$bench/oracles/"*.ts "$code/oracle/"
    for oracle in "$code"/oracle/F*.oracle.test.ts; do
      name=$(basename "$oracle" .oracle.test.ts)
      read -r tests fails < <(cd "$code" && node --test "oracle/$name.oracle.test.ts" 2>&1 | counts)
      { [ "$tests" = 0 ] || [ "$fails" != 0 ]; } && failing="$failing$name "
    done
    rm -rf "$code/oracle"
    failing=${failing:-none}
  fi
  expected=none
  [ -f "$bench/oracles/$id.oracle.test.ts" ] && expected="$id "
  verdict=ok
  { [ $own = pass ] && [ "$types" = ok ]; } || verdict=FAIL
  [ "$failing" = - ] || [ "$failing" = "$expected" ] || verdict=FAIL
  [ $verdict = ok ] || status=1
  echo "$verdict $id: own tests $own, typecheck $types, failing oracles: $failing"
done
exit $status
