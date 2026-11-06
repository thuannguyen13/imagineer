# Now

Imagineer: two commands, `/imagineer:inspect` and `/imagineer:build`, plus `/imagineer:status` for the grade. Design: [docs/proposals/inspect-and-build.md](../docs/proposals/inspect-and-build.md). Decided 2026-11-05 in [decisions.md](decisions.md). One branch and PR per phase.

Every phase ends with the clean bar and follows the validated-status rule, both in [decisions.md](decisions.md). A phase is done only with evidence: a bench run, a test, or a real-project run, named here with its date.

## Before this plan

The three-skill plan (guard, forge, ground) built: the plugin packaging, the bench fixture app and scenarios, guard, forge and ground skills, forge's agents and reviewer hook, and ground's opt-in hooks (through 2026-11-03, PRs #1–#7). None was marked validated. Those parts are inputs to the phases below; the three skills stop being entry points.

Evidence gathered 2026-11-05: Stryker on `bench/app` kills 30.5% of mutants (`server.ts` and `config.ts` 0%); `npx fallow health` scores it 81 (B). A mod answering `/imagineer-…:status` from a plugin skill ran with 0 turns and no cost.

## B0 — Design

- [ ] Design doc, decisions entry and this plan reviewed by the owner; committed.
- [x] Grading scale researched and chosen (2026-11-05): six dimensions, four states, weakest link, care dimensions capped at Weak, claims never Strong, every survivor in critical code explained. Research: [docs/research/grading.md](../docs/research/grading.md).
- [ ] Stop bar numbers confirmed (proposed: Stryker 80% on inspected code, 2 clean attack rounds).

## B1 — Skeleton and status

- [x] Versioning (`0.y.z` until B6): `v0.1.0` tagged on `79fda05` as the bench baseline (local tag, not pushed yet); `CHANGELOG.md`; `scripts/check-version.sh` and a pull-request workflow that fail when plugin files change without a version bump and changelog entry (checked both ways, 2026-11-05); version `0.2.0`, released when this phase merges.
- [x] `plugin/skills/status`, not model-invocable; its text runs only where mods are off. `skills/inspect` and `skills/build` arrive with B2 and B4; the mod already watches their commands.
- [x] Results file format 1: [docs/results-file.md](../docs/results-file.md).
- [x] The mod (`plugin/hooks/register.tsx`): answers `/imagineer:status` with the grade pane, or text where nothing draws; opens the pane and band on `/imagineer:inspect` and `/imagineer:build`; quiet without a results file. Evidence (2026-11-05): `claude plugin validate .` lists only `fs.exists`, `fs.stat`, `fs.read`, `clock.every`, state and drawing calls; 9 tests pass under `claude plugin test plugin`; headless `/imagineer:status` answered with and without a results file at 0 turns and $0.
- [ ] Seen in an interactive session: the pane and band drawn in the terminal and the Desktop app.
- [x] The plugin moved into `plugin/`, and the marketplace points there, so installs no longer carry `bench/`, `docs/` and `plan/`, and `claude plugin test plugin` runs only the mod's tests (2026-11-05, chosen by the owner). Marketplace and plugin validate, 9 mod tests and both Python hook test suites pass after the move.

## B2 — Inspect on the bench app

Built in slices, each released on its own.

- [x] Slice 1 (0.3.0): research and tools. `/imagineer:inspect` detects the repo's setup, runs checks, Fallow and Stryker in a throwaway copy, and a script grades the evidence into the results file. Evidence (2026-11-05): on a fresh copy of `bench/app`, headless `/imagineer:inspect` ran in 7 turns ($0.41) with no permission prompts beyond `node`, `ls` and `git`, left the repository unchanged and removed its copy; grade ✕ Failing (test strength 31%, 51 of 167, as measured by hand earlier), structure ! Weak (Fallow 81), foundations ✓ Strong, the rest not checked; 9 script tests pass.
- [x] Slice 2 (0.4.0): questions. The big-picture interview, findings turned into ranked questions in the EXPECTATION / ACTUAL / EXAMPLE / SUGGESTIONS format, a ledger that never asks twice, and the grade reading the answers (intent, critical code, resolved findings). Evidence (2026-11-05): headless `/imagineer:inspect` on the bench copy (5 turns, $0.98, repository unchanged) put 14 items in the ledger: 10 settled from the bench docs with citations, 4 open questions listed for the user, one of them a real gap no planted defect covers (`APP_ENV=production` would turn on dev sign-in). 16 script tests pass.
- [x] Slice 3 (0.5.0): proofs, attack rounds, the stop bar and the no-docs path.
  - [x] Answers proven by tests: pass on the code as it is, fail on every break behind the answer, unobservable breaks recorded with a reason. Evidence (2026-11-05): Q8 on the bench copy, 4 of 5 caught, the fifth only empties an error message, then 4 of 4.
  - [x] Attack rounds and the stop bar: an `imagineer:attacker` agent, `attack.mjs`, a security scan, security and data safety graded, `run.bar`. Evidence (2026-11-05): headless run on the bench copy, 16 turns, $2.73, 2 rounds, 12 attacks, 8 held, 4 broke through: `APP_ENV=production` turns on admin sign-in by header (A5), a dev server can open production data (A6), a description of invisible characters passes the "required" rule Q8 proved (A7), production and dev backups share a folder (A12). Repository unchanged; 27 script tests pass.
  - [x] No-docs path. Evidence (2026-11-05): headless run on a bench copy with `docs/` and `CLAUDE.md` removed, 6 turns, $1.13: all 10 questions begin "My guess (no docs found):", the docs it would write are listed and none written without agreement, and it found from the code alone that nothing lets anyone approve an expense. Repository unchanged.

- [ ] Tool detection: the repo's own Fallow and Stryker version and config when present; otherwise `npx fallow` and Stryker in a throwaway copy.
- [ ] Questions in the YOUR EXPECTATION / ACTUAL IMPLEMENTATION / EXAMPLE / SUGGESTIONS format, ranked by consequence, a few per round; each confirmed answer becomes a test.
- [ ] Attack rounds; stop at the bar.
- [ ] No-docs path: big-picture interview first, code reconstructed and marked inferred until confirmed, confirmed answers saved as docs with the user's agreement. Evidence: a run on a copy of `bench/app` with its `docs/`, `CLAUDE.md` and README removed.
- [ ] Evidence: on `bench/app`, Inspect raises the gaps Stryker found on 2026-11-05 (dev-only sign-in, prod/dev data folder, double-submit race, owner check, empty description, untested HTTP layer), and the bench app's kill rate rises to the bar. The bench app stays unchanged; Inspect runs on a copy.

## B3 — Grade

- [x] Grade computed from the results file only, per the chosen scale: `grade.mjs` sets every state from evidence (B2).
- [x] Pane shows the overall grade, each dimension with how it was measured, the stop bar, and the open questions, and marks the grade stale once HEAD moves past the measured commit (0.6.0). Evidence (2026-11-05): 13 mod tests pass; in a real headless session `/imagineer:status` listed the bar and the top 5 open questions at 0 turns, and showed ⟳ stale after a new commit; `claude plugin validate` still lists only file reads, the timer, state and drawing.
- [x] The same grade goes into the pull request Build opens: `build.mjs pr-body` adds the repository's grade as it stood before the change, with the reminder to inspect again after merging.
- [ ] The question dialog restyled by the mod: deferred until Build's dialogs settle, so both use one layout.

## B4 — Build

- [x] Agents: architect, dev, qa, each with its default model; the user's preset (Recommended, Budget, Maximum, or their own) saved per user in `~/.claude/imagineer/preferences.json` and passed at spawn.
- [x] QA writes tests from the Architect's spec before Dev starts, and they must fail first; Dev runs them and never edits tests. Enforced by `hooks/role-guard.mjs` (8 tests).
- [x] Done when QA's tests pass and the change meets the bar: typecheck, Fallow audit against the base, mutation testing of changed code at 80% with critical code fully covered (`build.mjs bar`).
- [x] Reuse from forge: run folder, state file and resume, finding IDs (`F<k>` from the Architect's review), role guard in place of the reviewer hook.
- [ ] Evidence: a headless Build of the bench's approvals feature passes the forge oracles (F1, F2, F4, F5) it was never shown.

## B5 — Retire the old entry points

- [x] guard, forge and ground, forge's agents and its reviewer hook removed from the plugin in 0.2.0 (2026-11-05, chosen by the owner), ahead of B2 and B4, so the plugin shows only the new design. Their text stays at tag `v0.1.0`; B2 takes ground's checklist and hooks from there, B4 forge's run folder, state, finding IDs and reviewer hook, and Dev's practices take guard's rules. `bench/prepare.sh` installs the skills of `IMAGINEER_REF`, default `v0.1.0`, so the existing scenarios still run as the baseline.
- [x] README rewritten around the commands.
- [x] Decided (2026-11-05): role limits stay in a settings hook, `hooks/role-guard.mjs`, in Node like the rest, so the mod stays read-only. A destructive-command guard with buttons is a candidate for `plan/later.md`, not this plan.

## B5.5 — Learning from runs

- [x] Self-check (`feedback.mjs check`): role-guard refusals (logged by the hook), tools that did not run, a proven answer broken by an attack, questions answered mostly in the user's own words or asked twice, a Build stuck at 4 rounds. Shown in the pane and at the end of each run. Cost signals not yet: the run records do not hold cost.
- [x] `/imagineer:feedback` and the end-of-run retro write feedback records with a fingerprint to `~/.claude/imagineer/feedback.jsonl`.
- [x] Sharing: the user reviews the record, then opens a pre-filled GitHub issue and submits it, or saves a file.
- [x] Owner-side triage and learn steps in `.claude/skills/triage-feedback/` (this repository only).
- [x] Evidence (2026-11-05): a self-check flag raised on purpose in tests for each signal, including the role guard writing its refusal and the contradiction the bench run produced (Q8 proven, attack A7 broke it); 46 script tests and 14 mod tests pass.
- [ ] One real miss turned into a bench scenario that fails before the fix and passes after: the first candidate is A7 (invisible characters pass a "description required" proof).

## B6 — Real project

- [ ] `/imagineer:inspect` on one of the owner's real projects, starting from the incident of 2026-11-05.
- [ ] Marked validated only after that run.

## Still open from before

- [ ] Choose a license before submitting to a plugin directory.
- [ ] Decide what happens to `plan/guard-low-risk-test` (unpushed guard test notes) and `forge/p5` (Bench v4).
