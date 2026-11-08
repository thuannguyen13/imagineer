# Bench

Seeded-defect scenarios that decide whether a skill is **validated** (`docs/decisions.md`). A skill change is kept only if the bench shows it catches at least as much as before.

## Layout

- `app/`: the fixture product. Expenses with three roles (member, approver, admin), two teams, a draft → submitted → approved | rejected lifecycle, server-side checks, Postgres row-level security (PGlite, in process), grounding docs, backups, CI.
- `scenarios/<id>/`: what to seed and how to judge it.
  - `setup.patch`: folded into the app's only commit, so the product simply is that way.
  - `feature.patch`: an approvals feature already built on a branch; forge picks it up at its first review round.
  - `run.md`: what to type. `expected.md`: the scoring key. Never show `expected.md` or `oracles/` to the session under test.
- `scenarios/_forge/plan.md`: the plan forge reviews against (R1–R6).
- `oracles/`: hidden tests. Each passes on the clean feature and fails on exactly its seeded defect.
- `results/`: one file per bench run.

| Skill | Scenarios |
|---|---|
| forge | F1 record scope, F2 rule checked after the write, F4 data leak, F5 invalid transition, F6 clean (false-positive trap), F8 resume, F9 dry run, F10 merge wait (manual, needs a disposable GitHub repo) |
| ground | G1 access rules off, G2 secret in the browser, G3 dev on prod data, G4 backups never restored, G5 clean |
| guard | guard-low, guard-medium, guard-high |
| inspect (learned) | L1 a proof that misses invisible characters |

G1–G5 need the ground skill. F3 (race) and F7 (unprovable requirement) were retired: PGlite runs one transaction at a time, so a race cannot happen in this app, and R6 in every forge scenario already tests how a requirement without a QA driver is handled.

## Run a scenario

```
bench/prepare.sh F1 /tmp/bench-F1
```

It copies the app into the empty directory as a fresh git repo, applies the scenario, gives it its own QA port, installs the skills, agents and hooks of `IMAGINEER_REF` (default `v0.1.0`, the last release with guard, forge and ground) into `.claude/`, with ground's hooks when ground is present, and prints `run.md`. Open that directory in Claude Code and follow it. Score against `expected.md` in a results file.

`bench/check-seeds.sh` proves the bench itself: every scenario prepares, the app's own tests and typecheck pass, and each oracle fails only for its own seed. Run it after changing `app/`, a patch or an oracle.

## Scoring sheet

Copy into `results/<date>-<skill>-<label>.md`, one row per scenario:

| Scenario | Skill version (commit) | Caught (yes / partly / no) | Severity right | False positives | Agents spawned | Minutes | Reported tokens | Notes |
|---|---|---|---|---|---|---|---|---|

Record tokens only when the harness reports them; never estimate.

## Cost

A forge review scenario spawns about five agents, most on the largest model. Running the six forge review scenarios once is roughly 30 agent runs. Run the bench deliberately: after a skill change, before marking a skill validated.
