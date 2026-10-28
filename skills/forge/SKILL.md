---
name: forge
description: Plan, build and review one consequential feature end to end as its product owner: a reviewed plan, an Opus implementer, and validated review rounds covering business logic, authorization, data and code quality, then a pull request. Heavyweight; routine changes use guard. /forge alone resumes an unfinished run.
argument-hint: <feature request> [--consecutive=N] [--max-rounds=N] [--max-plan-passes=N] [--merge=auto|wait] [--budget-min=N] [--dry-run]
disable-model-invocation: true
---

Input: $ARGUMENTS

You are the product owner for this feature. Ship it to the brief, reuse existing shared code, and keep changes within the plan's scope. Work through the review rounds until the ship condition is met or a stop condition applies. Decide routine questions yourself and log them in the plan. Ask the user only at the points this skill names: missing setup or inputs (section 0), spec questions (sections 1 and 2), and stop decisions (sections 2 and 4).

## Project setup

This skill describes the method. The consuming project supplies its own commands and conventions, normally in CLAUDE.md, AGENTS.md or its docs. Before the preflight, find each value below. Ask for any that are missing in the one batched message from section 0. Never guess a value.

| Key | Meaning | Example |
|---|---|---|
| `checks` | Unit test, typecheck, lint and format commands | `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` |
| `fast-checks` | The subset the orchestrator runs once per round | unit tests and typecheck |
| `deps` | How a worktree gets dependencies and env files | symlink `node_modules`, copy `.env.local` |
| `framework-docs` | Version-matched framework docs to read, if any | `node_modules/next/dist/docs` |
| `constraints` | Project rules every plan must follow | no new permission; shared code imports no feature; refine, do not add |
| `db-check` | A read-only query that proves the local database responds | `select 1` |
| `qa-server` | Dev server command and a port no one else uses | `npx next dev -p 3100 --webpack` |
| `qa-driver` | Where the end-to-end driver and its browsers live | Playwright in `qa-driver/` |
| `qa-sign-in` | How a tester signs in as each role | dev sign-in route per role |
| `board` | Issue tracker project and its Ready, Done and Backlog states | GitHub project 7 |
| `test-prefix` | Name prefix for every record a tester creates | `zz-<feature>-` |

If the project has no database, no UI or no roles, mark the matching keys `n/a` in the plan, skip the checks that need them, and list them as skipped in the review record. A brief requirement that only a skipped check could prove stays NOT_PROVEN, never PASS.

## 0. Parse options, check state, set up

**Options.** Strip these flags from $ARGUMENTS. The remaining text is the feature request.

| Flag | Default | Range | Meaning |
|---|---|---|---|
| `--consecutive=N` | 2 | 1–5 | Passing review rounds in a row needed to ship |
| `--max-rounds=N` | 5 | 1–10 | Total review rounds before stopping |
| `--max-plan-passes=N` | 3 | 1–5 | Plan review passes before stopping |
| `--merge=auto\|wait` | wait | — | Merge after the PR's checks pass, or wait for the user |
| `--budget-min=N` | 240 | 30–1440 | Wall-clock minutes for the whole run |
| `--dry-run` | off | — | Report the preflight, a plan outline and the spawn schedule, then stop. Create nothing |

If a value is out of range or not a number, use the default and say so in the first update.

**Run folder.** Every file this run keeps (plan, `state.json`, `baselines.md`, regression tests) lives in `.claude/forge/<name>/` in the main checkout, where `<name>` is the worktree name. Only the orchestrator writes there, starting at the State step: it then adds `.claude/forge/` to `.git/info/exclude` if it is not ignored. These are the only files the run writes in the main checkout.

**Resume check (always first).** Look for `.claude/forge/*/state.json` with `status` `running`, `stopped` or `awaiting_merge`. If the feature request is empty and one exists, resume it; if several exist, ask which. If one matches the request, resume it. Print a short status before anything else: status, phase, plan_pass, round, streak, open Critical/Major `F<k>` IDs and NOT_PROVEN R-IDs, minutes used of budget, and spawns so far. Then continue from that point; for a `stopped` run, repeat its `stop_question` and continue with the answer. Do not restart from zero. If the request is empty and nothing is unfinished, ask for the feature request. With `--dry-run`, report unfinished runs but do not resume them.

If the feature request, its inputs (design doc, brief, issues), or the merge preference is missing and cannot be inferred, ask once with one batched message, then start.

**Fresh look.** Read CLAUDE.md and AGENTS.md (and `framework-docs`, if set). Read only the `docs/` files that touch the feature's areas. Check git state, open PRs, and other sessions (ListAgents).

**Preflight.** Read-only. Run these checks in order and stop at the first failure. Report the failed check and what to fix. Do not continue past a failure.

1. The base branch exists, and the current checkout is clean.
2. Dependencies and env files are available as `deps` describes.
3. `db-check` succeeds. No writes.
4. The `qa-server` port is free.
5. The `qa-driver` and its browsers are installed.
6. Every `checks` command runs without a setup error.

**Dry run.** If `--dry-run` is set: report the preflight result, a plan outline from the fresh look, the agents each phase would spawn with their models, and the best- and worst-case spawn counts. Then stop. Create no worktree, branch, issue, run folder or state file, and spawn no agent.

**Worktree.** Create `.claude/worktrees/<name>` on a new branch from the correct base. Set up dependencies and env files as `deps` describes. Never change code in the main checkout or another session's branch.

**Issue.** Create the issue on `board` (problem and proposal, no file names) and move it to Ready. Only Ready issues get built.

**State.** Create `state.json` in the run folder:

```json
{"status": "running", "phase": "plan", "plan_pass": 0, "round": 0, "streak": 0,
 "sha": null, "base": null, "issue": null, "pr": null, "started_at": "<ISO time>",
 "budget_min": 240, "spawns": 0, "tokens_reported": false, "findings": {}, "rounds": []}
```

`status` is one of `running`, `stopped`, `awaiting_merge`, `merged`, `abandoned`. A stopped run also records `stop_reason` and `stop_question`. `findings` maps each `F<k>` to its severity, R-ID or category, the behaviour (role, action, actual vs expected), file and function, `open` or `closed`, and first and last round seen.

Update it after every spawn batch and every round. Append to `rounds` one entry per round:

`{round, sha, verdict, critical, major, not_proven, drift_files, drift_findings, dropped_false_positives, spawns, models, tokens}`

Set `tokens` to the reported total when the harness exposes usage, or to `null` when it does not. Never estimate tokens.

**Agent names.** Give every spawned agent a `name`: `<name>-<role>`, with `-r<N>` in review rounds (for example `checkout-r2-authz`), so the user can follow and message it.

## 1. Audit and plan

- Spawn a read-only Explore agent (`model: "sonnet"`) to list every component, form, action, permission, and test the feature touches, with file:line and facts only. Limit it to 25 tool calls. If it reaches the limit, record what it did not cover in the plan's Open questions.
- Ask at most 4 spec questions in one message, recommended option first. Decide everything else and state each decision in the plan.
- Write the plan to the run folder with these sections: **Outcome**, **Facts verified (file:line)**, **Where it applies** (included rows, excluded rows with reasons), **Shared mechanism** (each piece defined once, and what it replaces), **Behaviour rules**, **Docs** (per the project's documentation rules), **Tests** (unit, server-refusal, real-app flows), **Order of work**, **Open questions**. Each brief requirement gets a stable ID (R1, R2, …) so testers can mark it PASS, FAIL, or NOT_PROVEN. The **Where it applies** table must list the files each included row is expected to touch, because the drift check uses it.
- Hard requirements:
  - Maximize reuse. No copied validation, authorization, or insert logic.
  - Each control is offered exactly when its server-side handler would accept it.
  - Follow every rule in `constraints`.

## 2. Plan review

Pass condition: **zero Critical and zero Major findings** from an Opus reviewer (`model: "opus"`) using the BASELINE METHOD. The reviewer has a limit of 30 tool calls. If it reaches the limit, its unverified facts are reported as NOT_PROVEN.

- The reviewer verifies every fact against the code and checks completeness against the brief, the permissions model, business rules, framework mechanics, reuse, `constraints`, and the docs rules.
- Fold every finding into the plan. Ask the user only the spec questions the reviewer raises, in one batched message.
- Increment `plan_pass` in state.json. If `plan_pass` reaches `--max-plan-passes` with Critical or Major findings still open, stop with status `stopped`. Report the open findings and ask, recording the question as `stop_question`: narrow the scope, accept the risk, or abandon.

## 3. Implement

Spawn an Opus implementer (`model: "opus"`) in the existing worktree with the final plan. It has a limit of 80 tool calls for each feature step. If it reaches the limit, it must commit what passes, report what remains, and stop. It must:

- Commit in coherent steps, in repo style, with no AI attribution.
- End the last commit with `Closes #N`.
- Update docs in the same commits as the code.
- Pass every `checks` command before every commit.

It reports: commits, a row-by-row checklist against the plan (by R-ID), deviations with reasons, and what QA should check first. Record the sha in state.json.

## 4. Review rounds

### Verdicts

Each brief requirement and each finding gets one verdict:

- **PASS:** verified by a test, a run, or a reading that cites file:line.
- **FAIL:** verified as broken.
- **NOT_PROVEN:** could not be verified. Examples: the test could not run, the spec is ambiguous, or the agent hit its tool-call or scope limit. NOT_PROVEN is never reported as PASS.

### Pass condition (per round)

A round **PASSES** only if all four are true:

1. Every `checks` command is green at the reviewed sha. The orchestrator runs the full `checks` before marking a round PASS.
2. Zero Critical and zero Major findings remain after validation and dedupe, including any marked UNSURE.
3. Zero brief requirements are FAIL or NOT_PROVEN.
4. All regression test files from earlier rounds pass.

**Streak:** consecutive PASS rounds. Any FAIL resets it to 0. A base-branch merge also resets it, because the reviewed code has changed.

**Ship** when `streak >= --consecutive`.

### Stop conditions

Every "Stop" below sets status `stopped` and records `stop_reason` and `stop_question`: the choice the user must make to continue, always including "abandon". If the user abandons, set status `abandoned`, remove the run's worktrees, and keep its branch.

| Condition | Action |
|---|---|
| Streak reaches `--consecutive` | Ship (step 5) |
| `round` reaches `--max-rounds` without meeting the streak | Stop. Do not merge. Report open findings. Ask: extend by N rounds, ship the listed minors with explicit approval, or abandon |
| The same Critical or Major `F<k>`, or the same NOT_PROVEN R-ID, is still open after a fix attempt, in two consecutive rounds | Stop and escalate. Do not run another fix cycle. Ask: try a different fix the user describes, accept the risk, or abandon |
| Elapsed time exceeds `budget_min` (checked before each spawn batch) | Stop. Report the rounds completed and the open items. Ask: extend the budget by N minutes, or abandon |
| Spawns in one round exceed 8 | Stop and report. This indicates a runaway fan-out. Ask: continue the round, or abandon |
| Any tester reports a write to a record not named with `test-prefix`, or a change to an existing record or role | Stop all testing immediately. Report it. Clean up only through the app. Ask: continue once the user confirms the data is restored, or abandon |
| Local database lacks a migration the code needs | Stop and report. Ask: continue once the migration is applied, or abandon |

The budget is a soft limit. The Agent tool does not enforce a hard timeout, so each agent's prompt carries its own tool-call or scope limit, and the orchestrator checks elapsed time between spawn batches.

### Each round

**1. Mechanical checks.** The orchestrator runs `fast-checks` once at the sha and shares the output. Testers do not repeat them.

**2. Mechanical drift check.** The orchestrator runs `git diff --name-only <base>..<sha>` and compares the file list with the files named in the plan's Where-it-applies table. Each changed file outside that list is a DRIFT finding. No agent is needed for this step. Record the count in `drift_files`.

**3. Parallel review.** Spawn these in one batch, each with `isolation: "worktree"`, checked out with `git checkout --detach <sha>`, and set up as `deps` describes:

| Reviewer | Angle | Model | Input | Scope and limit |
|---|---|---|---|---|
| a | Business logic and authorization | opus | Plan and code | Check order in every server-side handler (permission, then record scope, then business rule, under lock). Races. Business rule edge cases (limits, state transitions, duplicates, rounding, time zones). Leaks and payload over-exposure. Role × control matrix as unit test files. Database results as integration tests. Limit: 60 tool calls |
| b | Data, docs, reuse, and drift | opus | Plan and code | Duplication and layering. Regressions in standalone flows. Data integrity (migrations, constraints, cascades) as integration tests. Docs against code and the project's documentation rules. Do the tests prove what they claim? Review the content of in-scope changes for drift the file list cannot show. Limit: 60 tool calls |
| c | Real-app functional flows | sonnet | Plan and running app | Start `qa-server` (never the developer's usual port). Drive it with `qa-driver`. Sign in per role with `qa-sign-in`. Walk every brief flow to its end state and confirm the result through the app, as each role sees it. Also check: double submit creates one record, cancel mid-save leaves no partial record, server errors surface and do not silently succeed, and a refused action is refused on the server, not only hidden in the UI. Save screenshots only as evidence that a check ran. Limit: 60 tool calls |
| d | Diff review, fresh context | opus | Plan and `git diff <base>..<sha>` only | Does not receive any tester report, prior round, baseline, or regression file. Looks for business-logic and code-quality defects without having seen how the code was written or what other reviewers think. Limit: 40 tool calls |

If tester c reports a suspected Critical it cannot confirm, the orchestrator spawns one fresh Opus confirmer (`model: "opus"`, `isolation: "worktree"` at the same sha, set up as `deps` describes) for that single finding. Do not rerun the whole tester.

Tester c database rules: create only records named with `test-prefix`. Never change existing records or roles. No SQL, migrations, or seeds; database state is proven by reviewers a and b, not by tester c. Clean up through the app in dependency order.

The orchestrator copies the run folder's `regression/` files into the worktrees of testers a, b and c. They re-run them, adapt them only where an API legitimately changed, and list the files they changed or added; the orchestrator copies those back to the run folder. Tester d receives none of them.

Each reviewer ends its report with a **Not reached** section. Any brief requirement it did not reach is NOT_PROVEN, not PASS.

**4. Validation.** The orchestrator merges the four reports and the drift check output, and dedupes them. Then it spawns one Sonnet validator (`model: "sonnet"`, `isolation: "worktree"` at the same sha, set up as `deps` describes) with the full list of findings. The validator does not see the reviewers' reasoning. For each Critical and Major finding, it first tries to reproduce the problem with a failing test. For each finding it returns:

- **CONFIRMED-BY-TEST:** a failing test reproduces the problem.
- **CONFIRMED-BY-READING:** the code at file:line shows the problem, but no test was written.
- **FALSE POSITIVE:** with a one-line reason.
- **UNSURE:** could not be confirmed or disproved. An UNSURE Critical or Major blocks the round as if confirmed; an UNSURE Minor is listed with the known minors.

Drop false positives and record each one with its reason in `baselines.md`. Spot-check every Critical and Major finding confirmed by reading only, before acting on it. Findings confirmed by test need no further check.

Then give each remaining finding a stable `F<k>`: reuse the ID of an open finding that describes the same behaviour (same R-ID or category, same role and action, same actual vs expected), even if the code moved; otherwise assign the next number. Close an `F<k>` when a reviewer reports it FIXED at the new sha with a cited test, run or reading and the validator does not dispute it. Record both in `findings`.

**5. Record.** Append `## Baseline N: <sha> — PASS/FAIL (streak k of --consecutive)` to `baselines.md`. Update state.json, including the spawn count, models used, and tokens (or `null`).

**6. Notify the user after every round:** verdict, Critical, Major, and NOT_PROVEN counts, DRIFT count, false positives dropped, streak, rounds left, minutes used of budget, spawns so far, and the next step.

**7. On FAIL,** send the implementer ONE fix list (`F<k>`, file:line, scenario, fix) and a DON'T CHANGE list (accepted findings and open spec questions). Then start the next round.

If the target branch moves, the implementer merges it in (merge commit, not rebase) before the next round. The final passing round must review the exact sha that ships.

## 5. Ship

- Confirm no NOT_PROVEN requirements remain in the last passing round.
- Push and open the PR: summary, review record, known minors, deploy notes, and the rounds table from state.json, including the cost columns. Record `pr` in state.json. Remove reviewer worktrees.
- `--merge=auto`: merge after the PR's checks pass. `--merge=wait`: set status `awaiting_merge`, report, and stop; merge when the user says so, or on resume if the PR was merged meanwhile.
- After the merge is confirmed: set status `merged`. `Closes #N` closes the issue; if `board` does not move closed issues to Done on its own, move it now. Never move it before the merge. File leftover minors as one Backlog issue.
- Notify the user with the PR link, its merge state, and the round history.

## BASELINE METHOD (reviewers, testers, validator)

**Scope:** business logic, authorization, data integrity, and code quality only. Do not review visual design, layout, copy wording, accessibility, or responsive behavior. Those belong to a separate review.

**Severity.** Classify by what can happen and to whom. How rare the role or path is can lower priority within a class, never the class.

- **Critical:** data loss on any path; or access a permission or rule forbids, reachable by a signed-out user or a role the product ships by default.
- **Major:** access a permission or rule forbids, reachable only through a custom role or unusual configuration; a record leak; a broken core business flow; a brief requirement missed without reason; a regression that blocks a common path; a reuse violation (duplicated logic, entity knowledge in shared code, wiring by hand); a broken `constraints` rule; DRIFT that adds scope the brief excluded.
- **Minor:** a defect with no data, access or core-flow impact, or DRIFT that stays within the brief.
- **Cosmetic:** naming, comments, formatting.

**Report template (reviewers and testers)**

```
## <Angle> review of <sha> (base <base>)
Checks: <each checks command> X/Y, regression X/Y (testers a–c)
Brief requirements: R1 PASS (file:line), R2 NOT_PROVEN (reason), ...
Previous items: F<k>: FIXED / PARTLY / STILL PRESENT / REGRESSED (file:line)
New findings: <angle><k> (the orchestrator assigns F<k> after validation)
  - file:line and function
  - role, permissions, state, action
  - actual vs expected
  - confirmed by: test / run / reading
  - one-line fix
Checked and sound: ...
Not reached: ... (each brief requirement here is NOT_PROVEN)
```

**Validator output:** one line per finding: ID, CONFIRMED-BY-TEST / CONFIRMED-BY-READING / FALSE POSITIVE / UNSURE, file:line, and the reason.

**Reviewer rules:** never edit or check out anything in the main checkout or the implementer's worktree. No commits, pushes, or GitHub writes. Touch the database only through the project's test commands. No app server, except tester c. Never report a requirement as PASS without a cited test, run, or reading. Tester d receives no other reviewer's output.
