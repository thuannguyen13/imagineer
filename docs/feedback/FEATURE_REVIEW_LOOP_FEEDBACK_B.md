# Imagineer — Feature Review Loop Feedback (B)

**Target:** `skills/feature-review-loop/SKILL.md` (227 lines, commit on `main` as of 2026-10-28)
**Companion:** `FEATURE_REVIEW_LOOP_FEEDBACK.md` (review A). This document covers what A does not: internal contradictions in the current text, enforcement, and a proposed architecture. Where both agree, A's wording stands.

---

## 1. Defects in the current skill

### 1.1 Logic that prevents shipping

| # | Lines | Problem |
|---|---|---|
| D1 | 28, 124 | A requirement only a skipped check can prove stays NOT_PROVEN; pass condition 3 requires zero NOT_PROVEN. Projects without UI or DB can never pass a round and burn all `--max-rounds`. |
| D2 | 36, 128–130 | Two consecutive passes on an unchanged sha is a re-roll: nothing changed, four to five agents re-review the same code, and non-deterministic findings make round 2 as likely to invent a Major as confirm round 1. |
| D3 | 128, 186 | Any base-branch merge resets the streak, and the implementer must merge whenever the target moves. On an active repo the streak may never reach 2 inside the budget. |
| D4 | 138, 215 | "Same ID open two consecutive rounds → escalate" cannot fire: finding IDs embed the round number (`B<N>-<angle><k>`), so the same bug gets a new ID every round. |

### 1.2 Internal contradictions

| # | Lines | Problem |
|---|---|---|
| C1 | 158 vs 165 | Tester c must "check the database result after each flow" and is also told "No SQL". No permitted way to check. |
| C2 | 159 | Tester d exists to avoid a "same-model blind spot" but runs on Opus, same as reviewers a and b. Fresh context ≠ different model. |
| C3 | 159 vs 167 | Tester d must see "plan and diff only", but every tester re-runs regression files produced by earlier rounds. It inherits prior output. |
| C4 | 9 vs 13, 43, 94 | "Ask the user only the spec questions from section 1", but the skill also asks in §0 (setup, inputs, merge) and §2 (reviewer questions). |
| C5 | 123, 138, 176 | UNSURE → NOT_PROVEN, but pass condition 2 counts only Critical/Major; the stop table does count NOT_PROVEN IDs. Unclear whether an UNSURE Critical blocks. |

### 1.3 Limits nobody enforces

| # | Lines | Problem |
|---|---|---|
| E1 | 80, 91, 99, 156–159, 171 | Tool-call caps (25/30/40/60/80) rely on each agent counting its own calls. Nothing enforces them. |
| E2 | 158 | Tester c (Sonnet, 60 calls) must start a server, sign in per role, walk every flow, verify DB after each, test double-submit, cancel mid-save, server errors, server-side refusal, and clean up. Does not fit; will mostly return NOT_PROVEN and block the round. |
| E3 | 140 | Runaway guard trips at >8 spawns per round. A normal round is 4 reviewers + validator + fix implementer = 6, plus confirmer(s). Routine rounds sit near the cap. |

### 1.4 Smaller issues

| # | Lines | Problem |
|---|---|---|
| S1 | 58, 152 | `deps` setup (node_modules, env) runs only in the implementer worktree. Reviewer worktrees never get it, so checks and the QA server fail exactly where they are needed. |
| S2 | 82, 150 | Drift flags every changed file not in the Where-it-applies table, including tests, docs, lockfiles, migrations. |
| S3 | 85–87 | "No new permission" and "Refine, do not add" are one project's rules written as universal hard requirements. A feature that needs a new role cannot be built. |
| S4 | 203 | "Starting roles" is never defined. |
| S5 | whole | Worst case ≈ 40 spawns, mostly Opus, per feature; flat regardless of risk. Contradicts README: "Review depth follows consequences, not file count." |
| S6 | whole | 227 lines of prose for a state machine; README says "Prefer tests and enforceable constraints over more instruction text." |

### 1.5 What is sound and must survive the refactor

- NOT_PROVEN is never PASS.
- Stable R-IDs per brief requirement, each needing cited evidence.
- Mechanical drift check that needs no agent.
- Validator that tries to reproduce Critical/Major with a failing test.
- Resume from `state.json`.
- Review bound to an exact sha; final passing round reviews the sha that ships.

---

## 2. Point fixes (if refactoring in place, not re-architecting)

Grouped by section of the current SKILL.md.

**Front matter / intro**
- Add `disable-model-invocation: true` (from A).
- Line 9: "Ask the user only at three points: missing setup (§0), spec questions (§1), reviewer-raised spec questions (§2)."

**Project setup**
- Add `constraints` key (project rules such as "no new permission"), `drift-ignore` (globs), `qa-isolation` (how to prove the QA DB/app is disposable), `risk-rules` (path/keyword → tier).
- Line 28: requirement provable only by a skipped check → **SKIPPED**, listed on the PR, confirmed at plan review, does not block shipping.

**§0**
- `--consecutive` default 1. Rounds are triggered (see §4), not counted.
- Run `deps` in every worktree the run creates.
- `state.json`: add `findings: {}` keyed by stable `F<k>` with status, first/last round seen; add `lifecycle` field (A's states).
- `--dry-run` runs before any write (A P0.2). Add expected spawns × model, best/typical/worst.

**§1**
- Replace the two project-specific hard requirements with "apply `constraints`".
- Every R-ID names its proof method (unit / server-refusal / e2e / reading) and risk tier. Method unavailable → SKIPPED now.

**§2**
- Reviewer also checks every R-ID has a proof method that runs in this project.

**§3**
- Tool-call cap becomes guidance. Time budget is the only enforced limit.

**§4**
- Verdicts: add SKIPPED.
- Pass condition 3: "(SKIPPED excluded)". State plainly: UNSURE on Critical/Major blocks; on Minor does not.
- Streak/rounds: a new round runs only if sha changed, findings remain open, base merge touched plan files, or tier High has no independent evidence yet. Unchanged sha is never re-reviewed.
- Base merge resets only if it touched Where-it-applies files; otherwise run `fast-checks` on the merged sha and keep state.
- Escalation rule references `F<k>` IDs.
- Spawn cap → 10, or count only unplanned spawns.
- Drift skips `drift-ignore`.
- Tester c: split per role, or narrow to main path + server-side refusal; move double-submit / cancel-mid-save into reviewer a's unit tests. Resolve C1: either read-only `select` allowed, or verify through app/API only.
- Tester d: Sonnet, or drop the blind-spot claim. Exempt from regression re-runs.
- Validation: orchestrator maps every validated finding to an existing or new `F<k>` before recording.
- Promote tests written in reviewer worktrees into the implementation branch (`frl promote`), re-run there, commit (A P1.7).

**§5**
- Done / `shipped` only on confirmed merge (A P0.3). List SKIPPED on the PR.

**BASELINE METHOD**
- Critical: "starting roles" → "any default role". Custom-role leaks classified by impact, not rarity (A P0.6).
- Report template: "Previous items" uses `F<k>`.

---

## 3. Proposed architecture (v2)

Organizing idea: the skill becomes a thin method layer over a small engine, and every rule that currently depends on an agent remembering it moves into something that can refuse.

### 3.1 Layout

```
skills/<name>/
  SKILL.md              # method, ~80 lines; frontmatter disable-model-invocation: true
  bin/frl               # engine CLI, no external deps (node or python)
  hooks/                # PreToolUse guards for reviewer / QA sessions
  prompts/              # one file per agent role
  reference/            # severity table, report templates, setup keys (loaded on demand)
```

Project supplies `.claude/frl.json`: the setup table as a file, plus `qa-isolation`, `constraints`, `drift-ignore`, `risk-rules`.

### 3.2 Layers

**Spec layer (plan)**
- Explore agent → facts with file:line.
- Planner → R-IDs, each with acceptance criterion, proof method, risk tier, expected files/globs.
- Risk tier assigned by `risk-rules` (e.g. `auth/**`, `migrations/**`, "permission", "payment" → High). Planner may raise a tier, never lower.
- High R-IDs get a failing acceptance test written before implementation. Medium get a test spec. Low get a reading criterion.
- R-IDs with no available proof method → SKIPPED, user-confirmed, listed on PR.
- One Opus plan review → zero Critical/Major, or stop.

**Build layer**
- One implementer, one worktree, makes acceptance tests green, commits per step, no attribution. `frl record <sha>` after each step.

**Verification layer (per round)**
Spawn set is a function of the highest open risk tier:

| Tier | Mechanical | Agents |
|---|---|---|
| Low | checks + acceptance tests | none |
| Medium | + drift, regression | 1 independent reviewer (fresh context; plan + diff only) |
| High | + permission-matrix tests | reviewer + red-team + isolated real-app QA |

- Red-team reviewer's only valid output is a test that fails on the bug. No test, no finding.
- Real-app QA runs only if `qa-isolation` resolves (engine checks: separate DB, side effects stubbed). Otherwise read-only checks; write-dependent R-IDs → NOT_PROVEN. Never silently use a shared environment (A P0.4).
- Evidence ledger: every PASS = `{rid, method, artifact, sha}`. `frl gate` re-runs cited tests before accepting. Reports are inputs; the ledger is the truth.
- Findings get stable `F<k>` at validation; engine owns the table.
- `frl promote` moves useful reviewer tests into the implementation branch.

**Control layer (engine)**
- `frl gate` reads state + ledger → `SHIP | CONTINUE | STOP <reason>`. Pass = checks green at sha, zero validated Critical/Major, zero FAIL/NOT_PROVEN R-IDs (SKIPPED excluded), regression green.
- Round trigger, not streak (see §2 §4 above).
- Lifecycle: `planning → implementing → reviewing → ready_for_pr → awaiting_merge → merged | stopped | failed`.
- `--dry-run` never reaches `frl init`.
- Hooks: reviewer sessions cannot write outside their worktree, run SQL writes, or call `gh` mutations; QA sessions can only create `test-prefix` records. Tool-call caps dropped; wall-clock budget checked by engine between batches.
- Cross-run memory: `.frl/baselines.md` per project (false-positive patterns, learned drift-ignore, reviewer precision per angle).

### 3.3 Cost model

Current: ≈ 40 spawns worst case, flat per feature. v2: Low ≈ 1 agent, Medium ≈ 3, High ≈ 6–8 per round, rounds only when triggered.

### 3.4 Relationship to guard

Guard stays the default. This skill = guard + spec layer + engine, explicitly invoked. Shared `reference/` for severity and evidence rules. Forge/Pact stay unbuilt (A boundaries).

---

## 4. Acceptance criteria for the refactor

Take A's "Definition of done" list in full, plus:

- [ ] A project with no UI or DB can ship (SKIPPED path works end to end).
- [ ] An unchanged sha is never reviewed twice.
- [ ] A base-branch merge that touches no plan files does not reset state.
- [ ] The same defect open in two consecutive rounds triggers escalation (stable `F<k>`).
- [ ] Tester c / QA agent has exactly one permitted way to verify DB state, and it is documented.
- [ ] The "fresh context" reviewer receives nothing produced by other reviewers, including regression files.
- [ ] Every worktree the run creates has `deps` applied.
- [ ] Drift ignores configured paths; tests/docs/lockfiles do not count as drift by default.
- [ ] Project-specific constraints live in `frl.json`, not in the skill text.
- [ ] Reviewer rules are enforced by hooks; removing the prose does not remove the protection.
- [ ] `frl gate` has its own unit tests covering every pass/stop condition.

## 5. Validation

Use A's eight seeded scenarios. Add:

9. **No-UI project:** backend-only repo; confirm SKIPPED path ships without burning rounds.
10. **Hook enforcement:** reviewer prompt instructed to `git push`; confirm the hook blocks it.
11. **Stable IDs:** same seeded defect left unfixed two rounds; confirm escalation fires.

Compare against current skill and guard-only on: confirmed defects caught, missed, false positives, elapsed time, spawns, reported tokens.

## 6. Open: name

Current `feature-review-loop` is accurate but long. Candidates discussed, all plain English or sci-fi, same length as `guard`: `ship`, `verify`, `launch`, `autopilot`. Trade-off: `verify` names one phase of four; `launch` covers plan→build→check→go; `autopilot` emphasizes autonomy but implies fewer stops than v2 actually has. Decide before renaming paths and the `frl` CLI.
