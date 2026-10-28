#!/usr/bin/env bash
# Prepare a bench scenario in a fresh directory.
# Usage: bench/prepare.sh <scenario-id> <empty-target-dir>
set -euo pipefail

id=$1
target=$2
bench=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$bench/.." && pwd)
scenario=$bench/scenarios/$id

[ -d "$scenario" ] || { echo "Unknown scenario: $id" >&2; exit 1; }
mkdir -p "$target"
[ -z "$(ls -A "$target")" ] || { echo "Target must be empty: $target" >&2; exit 1; }
target=$(cd "$target" && pwd)

# The committed app, plus the scenario's setup, as the only commit on main.
git -C "$repo" archive HEAD:bench/app | tar -x -C "$target"
cd "$target"
[ -f "$scenario/setup.patch" ] && git apply "$scenario/setup.patch"
git init -q -b main
git add -A
commit() { git -c user.name=dev -c user.email=dev@example.test commit -qm "$1"; }
commit "Expenses app"

# Skills under test: whatever this repository has checked out.
mkdir -p .claude/skills
cp -R "$repo/skills/." .claude/skills/
printf '.claude/\nnode_modules/\n' >> .git/info/exclude
npm install --silent

# Forge review scenarios: the feature is built on a branch and a run waits at its review round.
if [ -f "$scenario/feature.patch" ]; then
  base=$(git rev-parse HEAD)
  git checkout -q -b feature/approvals
  git apply "$scenario/feature.patch"
  git add -A
  commit "Add expense approvals"
  sha=$(git rev-parse HEAD)
  git checkout -q main
  git worktree add -q .claude/worktrees/approvals feature/approvals
  (cd .claude/worktrees/approvals && npm install --silent)
  run=.claude/forge/approvals
  mkdir -p "$run/regression"
  cp "$bench/scenarios/_forge/plan.md" "$run/plan.md"
  SEED=$scenario/state.json SHA=$sha BASE=$base STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ) node -e '
    const fs = require("fs");
    const { SEED, SHA, BASE, STARTED } = process.env;
    const seed = fs.existsSync(SEED) ? JSON.parse(fs.readFileSync(SEED, "utf8")) : { round: 0, streak: 0, rounds: [] };
    const rounds = seed.rounds.map((r) => ({ ...r, sha: SHA }));
    const spawns = 3 + rounds.reduce((n, r) => n + r.spawns, 0);
    const state = { status: "running", phase: "review", plan_pass: 1, round: seed.round, streak: seed.streak,
      sha: SHA, base: BASE, issue: null, pr: null, started_at: STARTED, budget_min: 240, spawns,
      tokens_reported: false, findings: {}, rounds };
    fs.writeFileSync(".claude/forge/approvals/state.json", JSON.stringify(state, null, 1) + "\n");
    const log = rounds.map((r) => `## Baseline ${r.round}: ${SHA} — ${r.verdict} (streak ${seed.streak} of 2)\n`).join("\n");
    fs.writeFileSync(".claude/forge/approvals/baselines.md", log);
  '
fi

echo "Prepared $id in $target"
[ -f "$scenario/run.md" ] && cat "$scenario/run.md"
exit 0
