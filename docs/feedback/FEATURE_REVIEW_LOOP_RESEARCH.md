# Feature Review Loop — Research Against Industry Patterns

> **2026-10-28:** feature-review-loop is renamed **forge**. Decisions: `plan/decisions.md`; skillset: `docs/proposals/skillset.md`.

**Target:** `skills/feature-review-loop/SKILL.md` (227 lines, `main` at `cc713c4`).
**Inputs:** reviews A and B in this folder; line references below were checked against the skill text.
**Date:** 2026-10-28.

The installed copy at `~/.claude/skills/feature-review-loop/` is the older Aperia-specific version. The repo copy is the source of truth.

---

## 1. Confidence comes from external evidence, not more opinions

**Patterns**
- Models rarely improve reasoning by self-review without external feedback; performance sometimes degrades. External signals (tools, tests) are what make correction work. (Huang et al., ICLR 2024)
- LLM evaluators recognize and favor their own outputs; self-recognition causally drives the bias. (Panickssery et al., NeurIPS 2024)
- Anthropic's long-running harness: "agents reliably skew positive when grading their own work"; the evaluator "identified legitimate issues, then talk[ed] itself into deciding they weren't a big deal"; it "tended to test superficially, rather than probing edge cases." A separate evaluator tuned to be skeptical was "far more tractable" than a self-critical generator.
- Claude Code best practices: "Handing the same task to a subagent doesn't make the answer any better. A fresh reviewer does help, because it hasn't seen your reasoning." Also: "A reviewer that's asked to find problems will always find *something*. If you fix every finding, you end up with extra abstraction layers and tests for cases that can't happen."

**Implication**
A reviewer contributes two things: fresh context, and evidence that can be re-executed. Count and model of reviewers matter far less. Rank evidence:

1. A test that fails on the defect (or passes on the requirement) at the reviewed sha.
2. A reproducible run in an isolated app.
3. A reading citing file:line, spot-checked by the orchestrator.
4. Opinion. Never moves a verdict.

**Change:** Before shipping, the orchestrator re-runs every test cited as PASS evidence at the ship sha. It is cheap and deterministic, and it removes fabricated or stale PASS claims. B proposed this inside an engine (`frl gate`); it does not need one.

**Verdict on A/B:** Both right. A P1.3 ("reviewer agreement alone is not verification") is the core principle of the refactor.

---

## 2. The consecutive-pass streak measures reviewer noise, not code quality

**Patterns**
- τ-bench `pass^k`: the chance an agent succeeds on all k trials. Re-running a non-deterministic judge on identical input measures the judge's variance.
- Flaky tests: a test that passes and fails on the same code is defined as flaky. Re-running it diagnoses the test, not the code.
- Risk-based exit criteria (ISTQB): stop when planned coverage is achieved, no unresolved critical defects remain, and the remaining risks are accepted by stakeholders. Not when N rounds agree.
- Anthropic's harness later dropped its per-sprint evaluator loop for one end-of-run evaluation when the model improved. "Every component in a harness encodes an assumption about what the model can't do on its own." Remove components one at a time to find which are load-bearing.

**Implication**
A second round on an unchanged sha (`--consecutive=2`, line 36) re-rolls the reviewers. A new Major in that round shows round 1 had low recall, and the right fix is wider evidence within one round, not a repeat. B's D2 and D3 hold: streak resets on any base merge (line 128), and the target branch must be merged in whenever it moves (line 186), so on an active repo the streak may never complete.

**Change:** Replace the streak with **exit criteria** checked against the current sha:

1. `checks` green; regression tests green.
2. Zero validated Critical/Major open.
3. Every R-ID PASS with re-run evidence, or NOT_PROVEN and accepted by the user at plan review (see §5).
4. Every High-tier R-ID covered: no High-tier item under any reviewer's "Not reached".

A new round runs only when a trigger fires: the sha changed (review the delta since the last reviewed sha plus R-IDs it touches), a High-tier item is unreached, or a finding is UNSURE at Critical/Major. A base merge that touches no planned file runs `fast-checks` and keeps state.

**Verdict on A/B:** A P1.1 and B §2 agree. B's "unchanged sha is never re-reviewed" is the right acceptance test.

---

## 3. Depth follows risk, set per requirement

**Patterns**
- ITIL change types: *standard* (pre-approved, low risk, repeatable), *normal* (assessed), *emergency*. A change type is promoted to standard only after evidence from repeated normal runs. Risk scoring can come from data about what the change touches.
- Risk-based testing: risk decides what to test first, how deeply, and what to skip.
- Guard already defines Low/Medium/High with a rule that crossing a high-risk boundary makes the change High.

**Implication**
A feature mixes requirements: copy, validation, and a permission check carry different risk. Tiering the whole feature either over-reviews the copy or under-reviews the permission. Tier **each R-ID**, and spawn by the highest open tier.

| Highest open tier | Mechanical | Agents |
|---|---|---|
| Medium | checks, drift, regression, re-run cited evidence | 1 fresh-context reviewer (plan + diff only), combining angles a, b, d |
| High | + permission-matrix tests, integration tests on a disposable DB | authorization/business reviewer (a), data reviewer (b), isolated real-app QA (c) |

Low-tier R-IDs need checks and a reading criterion, no agent. A request whose R-IDs are all Low does not belong in this skill: say so and hand off to guard. That keeps one owner for routine work.

Tier definitions should come from guard, not be restated. Project `risk-rules` (paths or keywords → minimum tier) set a floor; the planner may raise a tier, never lower it.

**Verdict on A/B:** A's tier table with a Low row conflicts with "routine changes use guard" (skill description, line 3). Redirect instead.

---

## 4. Authorization is specified up front, not discovered by a reviewer

**Patterns**
- OWASP Top 10:2025 A01: 100% of tested applications had some form of broken access control. Deny by default; include functional access-control checks in unit and integration tests; enforce only in trusted server-side code.
- OWASP testing guidance: define rules in an access-control matrix; test with an account per role, attempting every restricted function.
- Severity: OWASP Risk = Likelihood × Impact. CVSS treats Privileges Required as *exploitability*, separate from *impact*.

**Implication**
Today reviewer a writes the role × control matrix as tests during review (line 156), after implementation. Move it into the plan: roles × actions × expected outcome (allow, refuse, hide). The implementer turns it into server-level tests. The reviewer then checks the matrix is complete and the tests prove it, which is cheaper and more reliable than discovering it.

Severity (line 203–205): "custom-role only" → Minor conflates likelihood with impact. Impact sets the class; a rarer role lowers priority within the class, never across it. Unauthorized access to records or data loss is at least Major whatever role reaches it. "Starting roles" (line 203) is undefined: use "roles the product ships by default".

**Verdict on A/B:** A P0.6 correct. The matrix-in-plan change is new.

---

## 5. Requirements are a contract agreed before the build

**Patterns**
- Acceptance test-driven development / specification by example: agree concrete examples, turn them into automated acceptance tests before development, build until they pass.
- Anthropic harness: requirements in a JSON list with a `passes` field; agents may change only `passes`: "It is unacceptable to remove or edit tests." JSON was chosen because "the model is less likely to inappropriately change or overwrite JSON files compared to Markdown files." Its later harness used *sprint contracts*: before building, generator and evaluator agree what done means and how it will be verified.
- Agents marked features complete without end-to-end testing; premature "done" was a named failure mode.
- ISTQB: budget or timeline constraints count as exit criteria only when stakeholders formally accept the risk.

**Implication**
Make `requirements.json` the contract: per R-ID an acceptance criterion, risk tier, proof method (unit, integration on disposable DB, real-app, reading), status, and evidence `{method, artifact, sha}`. Plan review checks that every R-ID's proof method actually runs in this project.

This resolves B's D1 without a new verdict. A requirement whose only proof method is unavailable is flagged at plan review, and the user either accepts it as NOT_PROVEN (listed on the PR) or narrows scope. NOT_PROVEN stays never-PASS; the exit criterion counts only NOT_PROVEN items the user did not accept. B's SKIPPED verdict adds a term and would let unproven requirements ship silently if misapplied.

High-tier R-IDs get their acceptance test written before implementation (B §3.2). The implementer may not edit criteria.

**Verdict on A/B:** Prefer user-accepted NOT_PROVEN over SKIPPED.

---

## 6. Stable finding identity

**Patterns**
- SARIF `partialFingerprints`: match results across runs by a hash of rule, relative location, and code snippet, not by run-specific IDs. Known breakage: line shifts and path differences.

**Implication**
Finding IDs embed the round (`B<N>-<angle><k>`, line 215), so "same ID open two rounds → escalate" (line 138) cannot fire (B D4). The orchestrator assigns `F<k>` at validation and matches new findings to open ones by R-ID or category, file, and enclosing function, not line. A finding confirmed by test is identified by its test name, which survives code movement.

**Verdict on A/B:** B correct.

---

## 7. Enforce zero-exception rules in the harness, keep the rest as prose

**Patterns** (Claude Code docs)
- Prompts, CLAUDE.md and skills are non-deterministic; hooks, deny rules and managed settings are enforced. "If something has to happen every time, make it a hook... `CLAUDE.md` is for guidelines." "Keep the enforced set small... If you ever find yourself at forty of them, most are probably preferences."
- `disable-model-invocation: true` makes a skill start only on `/name`.
- Subagent `maxTurns` stops the subagent and returns partial output, enforced by Claude Code. `tools` / `disallowedTools` restrict a subagent's tools.
- `PreToolUse` hooks block via exit code 2 or `permissionDecision: "deny"`. A timed-out hook does not block unless `onFailure: "block"` is set.
- **Skill-frontmatter hooks stay registered for the rest of the session**, after the skill's turn. Subagent-frontmatter hooks run only while that subagent runs.
- **Plugin subagents ignore `hooks` and `permissionMode`.**
- `isolation: worktree` branches from the default branch, not the parent's HEAD.
- `${CLAUDE_SKILL_DIR}` points bundled scripts at the skill folder.

**Implication**
- Tool-call caps (lines 80, 91, 99, 156–159) become `maxTurns` on each reviewer. That resolves B E1 without counting.
- Reviewer and QA guards (no writes outside own worktree, no `git push`, no `gh` mutations, no SQL writes) belong in **subagent** definitions, not skill frontmatter, or they would keep restricting the user's session after the run.
- If the skill ships as a plugin, its subagent hooks are ignored. Ship the reviewer agents as project `.claude/agents/` files, or scope settings-level hooks by `agent_type`. This decides the install method; check it before building.
- Reviewer worktrees start from the default branch, so `git checkout --detach <sha>` (line 152) is required, and `deps` must be applied there too (B S1).
- B's full engine (`bin/frl`, ledger, cross-run memory) is more machinery than the evidence needs. Enforce three things: invocation (`disable-model-invocation`), agent limits (`maxTurns`, tool lists, a few `PreToolUse` guards), and the gate (orchestrator re-runs cited tests). Revisit a gate script only if the prose gate is shown to be misapplied.

**Verdict on A/B:** B's direction is right; its scope is larger than needed for a first step.

---

## 8. Real-app QA needs a disposable environment

**Patterns**
- Per-run or per-PR database branches (copy-on-write) are the common pattern; a shared preview database lets one test delete data others depend on. Branching isolates the database only: global tables, unscoped background jobs and external calls still escape. (Vendor sources; treat cost claims as unverified.)
- The consuming project's rule (Aperia CLAUDE.md): test locks, filters, cascades and permission checks on rolled-back Postgres.

**Implication**
A name prefix (`test-prefix`, line 26) marks records; it does not isolate them. Add a setup key `qa-isolation`: how to get a disposable database and how external side effects (email, webhooks, payments) are stubbed. Without it, real-app QA is read-only and write-dependent R-IDs are NOT_PROVEN unless accepted.

Database assertions move to integration tests on a rolled-back transaction, where the project already requires them. Real-app QA checks what only a running app shows: main flows end to end, and refusals enforced by the server, not only hidden. This resolves B C1 (check the DB vs "No SQL") and shrinks tester c to what fits (B E2). Double submit and cancel mid-save become integration tests.

**Verdict on A/B:** A P0.4 correct.

---

## 9. Lifecycle and merge

**Patterns**
- GitHub closes an issue when a PR with `Closes #N` merges into the default branch; project boards can move closed issues to Done automatically.
- At Microsoft, review comments were mostly about understanding the change, and defect comments a small share. Understanding is the reviewer's main need. (Bacchelli and Bird, ICSE 2013)

**Implication**
Lines 192–194 move the issue to Done and set `shipped` regardless of `--merge=wait`. Remove the manual move: let the merge close the issue. State becomes `awaiting_merge` until merge is confirmed, then `merged` (A P0.3). Fewer steps, and it can no longer report an unmerged PR as shipped.

The human approving the merge needs to understand what was proven. Lead the PR with the R-ID table: requirement, tier, verdict, evidence at the ship sha, and user-accepted NOT_PROVEN items. The rounds and cost table goes below it.

---

## 10. Dry run, cost, and proving the refactor helps

**Patterns**
- Anthropic harness: solo run 20 min / $9 produced a broken app; full harness 6 h / $200 produced a working one. An evaluator is "worth its cost only when the task is beyond what the model reliably does alone."
- Meta's mutation-guided test generation (ACH): seed realistic faults that current tests miss, then measure whether generated tests catch them.

**Implication**
- Dry run must exit before line 58 (worktree), 60 (issue) and 62 (state). Today the dry-run paragraph (line 76) comes after all three (A P0.2).
- Validate the refactor as mutation analysis of the review process: seed realistic defects (missing record-scope check, permission checked after the write, race on double submit, leak in a payload) into a feature, run the old and new skill, and compare defects caught, false positives, spawns, and time. That is A's benchmark with a defect catalogue that makes results comparable.
- Then remove one component at a time (fresh reviewer, real-app QA, validator) and keep only those that change the outcome.

---

## Not raised by A or B

1. **Skill hooks outlive the skill** (§7). Putting reviewer guards in the skill frontmatter would restrict the user's own session afterwards.
2. **Plugin subagents ignore hooks** (§7). The install method decides whether guards work.
3. **Re-run cited evidence before shipping** (§1). The cheapest guard against a fabricated PASS.
4. **Permission matrix in the plan** (§4). Moves authorization from discovery to specification.
5. **User-accepted NOT_PROVEN** (§5) instead of a SKIPPED verdict.
6. **Incremental re-review** (§2): after a fix, review the delta and affected R-IDs, not the whole feature.
7. **All-Low requests go to guard** (§3).
8. **Let the merge close the issue** (§9).

---

## Decisions to make

| # | Question | Recommendation |
|---|---|---|
| 1 | Replace the streak with exit criteria and triggered rounds? | Yes |
| 2 | Tier per R-ID, tiers sourced from guard, `risk-rules` as floor? | Yes |
| 3 | Unprovable requirements: user-accepted NOT_PROVEN, or B's SKIPPED? | Accepted NOT_PROVEN |
| 4 | Permission matrix as a plan artifact the implementer turns into tests? | Yes |
| 5 | `requirements.json` contract with proof method and evidence? | Yes |
| 6 | Enforcement scope: `disable-model-invocation` + `maxTurns` + subagent guards, no engine yet? | Yes |
| 7 | Install method: project `.claude/agents/` files or plugin (plugin loses hooks)? | Project agents |
| 8 | Real-app QA only with `qa-isolation`; DB assertions in rolled-back integration tests? | Yes |
| 9 | Refactor in place, or v2 alongside? | In place, `main` keeps history |
| 10 | Rename? | After the refactor settles |

Decisions 11–16 (verification techniques) are in [FEATURE_REVIEW_LOOP_VERIFICATION.md](FEATURE_REVIEW_LOOP_VERIFICATION.md).

## Confidence

- Strong: §1 self-correction and self-preference (peer-reviewed); §7 Claude Code behaviour (official docs, read 2026-10-28; recheck plugin and skill-hook scoping against the installed version).
- Moderate: §2 and §3 transfer from testing and change management, not measured on review agents.
- Weak: claims that cross-model panels catch disjoint defects come from preprints and vendor posts; not relied on. §8 database-branching sources are vendors.

## Sources

- Huang et al., *Large Language Models Cannot Self-Correct Reasoning Yet*, ICLR 2024 — https://arxiv.org/abs/2310.01798
- Panickssery, Bowman, Feng, *LLM Evaluators Recognize and Favor Their Own Generations*, NeurIPS 2024 — https://arxiv.org/abs/2404.13076
- Anthropic, *Effective harnesses for long-running agents* — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, *Harness design for long-running application development* — https://www.anthropic.com/engineering/harness-design-long-running-apps
- Claude Code docs: best practices — https://code.claude.com/docs/en/best-practices ; skills — https://code.claude.com/docs/en/skills ; subagents — https://code.claude.com/docs/en/subagents ; hooks — https://code.claude.com/docs/en/hooks
- Yao et al., *τ-bench*, ICLR 2025 — https://arxiv.org/abs/2406.12045
- Google Testing Blog, *Flaky Tests at Google and How We Mitigate Them*, 2016 — https://testing.googleblog.com/2016/05/
- OWASP Top 10:2025 A01 Broken Access Control — https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/
- OWASP Broken Access Control — https://owasp.org/www-community/Broken_Access_Control
- OWASP Risk Rating Methodology — https://owasp.org/www-community/OWASP_Risk_Rating_Methodology
- SARIF result matching (fingerprints) — https://lists.oasis-open.org/archives/sarif/201805/msg00025.html
- Specification by example — https://en.wikipedia.org/wiki/Specification_by_example ; ATDD — https://en.wikipedia.org/wiki/Acceptance_test-driven_development
- ITIL change types — https://www.servicenow.com/docs/r/it-service-management/change-management/change-types.html ; https://www.bcs.org/content-hub/consistency-and-agility
- ISTQB entry and exit criteria — https://trustedinstitute.com/concept/istqb-ctfl/managing-test-activities/entry-exit-criteria/
- Neon, branching for CI previews — https://neon.com/branching/ci-preview-workflows
- Meta, *Mutation-Guided LLM-based Test Generation at Meta*, FSE 2025 — https://arxiv.org/abs/2501.12862
- Bacchelli and Bird, *Expectations, Outcomes, and Challenges of Modern Code Review*, ICSE 2013 — https://www.microsoft.com/en-us/research/?p=164195
