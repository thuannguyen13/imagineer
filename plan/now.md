# Now

Imagineer v2: three skills (guard, forge, ground). Design: [docs/proposals/skillset.md](../docs/proposals/skillset.md). One branch and PR per phase.

Every phase ends with the clean bar and follows the validated-status rule, both in [decisions.md](decisions.md).

## P0 — Decisions and docs

- [x] Record decisions, README, plan, proposal (2026-10-28, branch `plan/skillset-v2`).

## P1 — forge: rename and fix defects (same design) — done 2026-10-28

- [x] Rename `skills/feature-review-loop/` to `skills/forge/`; `disable-model-invocation: true`.
- [x] Dry run exits before any worktree, issue or state file is created.
- [x] Lifecycle `awaiting_merge` → `merged`; the merge closes the issue.
- [x] Severity by impact; define default roles; custom-role leaks no longer Minor.
- [x] Stable `F<k>` finding IDs; escalation uses them; pass condition uses validated findings.
- [x] `deps` in every worktree; tester c verifies through the app only; drop tester d's blind-spot claim.
- [x] Project-specific hard rules move to a `constraints` setup key; "plan review gate" → "plan review".
- [x] Run state moves from the session scratchpad into the repo so a new session can resume; worktree agents are named.

## P2 — Bench fixture and baseline — fixture done 2026-10-28

- [x] `bench/app/`: small TypeScript app, 3 roles, one record lifecycle, server-side permission checks, Postgres.
- [x] Seeded scenarios with expected findings: ground G1–G5, forge F1, F2, F4, F5, F6, F8, F9, F10, guard low / medium / high (F3 and F7 retired; see `bench/README.md`).
- [ ] Baseline results for the P1 forge and current guard. Deferred by the user to before P5 (2026-10-28).

## P3 — ground — skill done 2026-10-28

- [x] Set up and check modes; checklist owned by ground; check → user approves → fix → re-check; `release` adds launch items.
- [x] Opt-in hooks: destructive commands, prod access, Stop hook running the project's checks; hook scripts tested.
- [ ] Passes G1–G5 and one real-project run; marked validated.

## P4 — guard

- [ ] Reads grounding docs; escalates consequence first; points to `/forge` and `/ground`.
- [ ] Passes the low / medium / high scenarios: no planning on low-risk changes, relevant patterns found on medium, missing lifecycle or security requirements raised before coding on high.
- [ ] One real-project run; marked validated.

## P5 — forge redesign

- [ ] Requirements contract, risk tiers, permission and state tables, proof seen failing, re-run evidence, traceability, exit criteria, tiered reviewers, `--verify <branch|PR>`.
- [ ] Each change kept only if the forge bench scenarios catch at least the baseline with fewer spawns.
- [ ] One real-project run; marked validated.

## P6 — Cross-skill cleanup

- [ ] Clean bar across all three skills together; every scenario re-run and no worse than P5.
