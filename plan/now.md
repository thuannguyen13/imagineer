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

- [ ] Versioning (`0.y.z` until B6): tag today's `main` as `v0.1.0`, the bench baseline; `CHANGELOG.md`; a check that fails a pull request changing plugin files without a version bump and changelog entry; release `v0.2.0` when B1 merges.

- [ ] `skills/inspect`, `skills/build`, `skills/status`; Inspect and Build not model-invocable.
- [ ] Results file format in the run folder: tool results, questions and answers, findings, grade inputs.
- [ ] The mod: answers `/imagineer:status` with the grade pane; opens the pane and band on `/imagineer:inspect` and `/imagineer:build`; text reply where it cannot draw; quiet in repos with no results file.
- [ ] `claude plugin validate` shows the mod only reads files and draws; `claude plugin test` covers the pane from a sample results file.

## B2 — Inspect on the bench app

- [ ] Tool detection: the repo's own Fallow and Stryker version and config when present; otherwise `npx fallow` and Stryker in a throwaway copy.
- [ ] Questions in the YOUR EXPECTATION / ACTUAL IMPLEMENTATION / EXAMPLE / SUGGESTIONS format, ranked by consequence, a few per round; each confirmed answer becomes a test.
- [ ] Attack rounds; stop at the bar.
- [ ] No-docs path: big-picture interview first, code reconstructed and marked inferred until confirmed, confirmed answers saved as docs with the user's agreement. Evidence: a run on a copy of `bench/app` with its `docs/`, `CLAUDE.md` and README removed.
- [ ] Evidence: on `bench/app`, Inspect raises the gaps Stryker found on 2026-11-05 (dev-only sign-in, prod/dev data folder, double-submit race, owner check, empty description, untested HTTP layer), and the bench app's kill rate rises to the bar. The bench app stays unchanged; Inspect runs on a copy.

## B3 — Grade

- [ ] Grade computed from the results file only, per the chosen scale.
- [ ] Pane shows the overall grade, each dimension with how it was measured, and open questions.
- [ ] The same grade goes into the final report and the pull request.

## B4 — Build

- [ ] Agents: architect, dev, qa, each with its default model; the user's preset (Recommended, Budget, Maximum, or their own) saved per user and passed at spawn.
- [ ] QA writes tests from the Architect's spec before or apart from Dev's code; Dev runs them and never edits tests.
- [ ] Done when QA's tests pass and the change meets Inspect's bar.
- [ ] Reuse from forge: run folder, state file and resume, finding IDs, reviewer hook.
- [ ] Evidence: Build catches at least what forge's baseline catches on the forge bench scenarios.

## B5 — Retire the old entry points

- [ ] Guard's rules in Dev's practices, ground's checklist in Inspect; old skills and agents removed.
- [ ] Decide whether the mod replaces the Python reviewer hook and gives ground's destructive-command guard buttons.
- [ ] README rewritten around the three commands.

## B5.5 — Learning from runs

- [ ] Self-check in the mod: rule broken, stuck, tool trouble, grade contradiction, poor questions, mod fault, cost.
- [ ] `/imagineer:feedback` and the end-of-run retro write feedback records with a fingerprint to a local log.
- [ ] Sharing: the user reviews the record, then a pre-filled GitHub issue or a saved file.
- [ ] Owner-side triage and learn skills in the Imagineer repo (not in the plugin): label, group, rank, decide, turn an accepted issue into a bench scenario with an oracle.
- [ ] Evidence: one real miss turned into a scenario that fails before the fix and passes after; one self-check flag raised on purpose in a test.

## B6 — Real project

- [ ] `/imagineer:inspect` on one of the owner's real projects, starting from the incident of 2026-11-05.
- [ ] Marked validated only after that run.

## Still open from before

- [ ] Choose a license before submitting to a plugin directory.
- [ ] Decide what happens to `plan/guard-low-risk-test` (unpushed guard test notes) and `forge/p5` (Bench v4).
