# Imagineer — Feature Review Loop v2 Feedback

**Target:** `skills/feature-review-loop/SKILL.md`  
**Review scope:** Workflow design, execution safety, verification quality, and efficiency.  
**Objective:** Preserve end-to-end feature ownership while replacing mandatory multi-agent ceremony with risk-based, evidence-backed review.

## Overall assessment

The current skill has a strong foundation: requirements are tracked by IDs; reviewers distinguish PASS, FAIL, and NOT_PROVEN; reviews target a particular commit SHA; findings are validated; and the workflow has explicit stop and resume behavior.

Its main weakness is that it equates **more review rounds and more agents** with **greater confidence**. Multiple reviewers can share the same blind spots, and repeated approvals are not a substitute for executable evidence. The skill also has several operational safety and lifecycle ambiguities.

**Recommendation:** Refactor the existing skill, not the repository architecture. Keep it opt-in and capable of rigorous review, but make verification proportional to risk and stop when the evidence is sufficient—not after a fixed number of approvals.

## P0 — Correctness and safety fixes

1. **Enforce manual invocation.** Add `disable-model-invocation: true` to the skill frontmatter. The existing description says opt-in, but a description alone does not enforce that behavior. Confirm the syntax against the installed Claude Code version.
2. **Make `--dry-run` genuinely side-effect-free.** Parse options and perform read-only checks before creating a worktree, issue, branch, state file, PR, or modifying project files. Show the intended plan, readiness checks, and expected agent schedule without making writes. If complete planning requires agents, distinguish an inspection-only preview from actual execution.
3. **Separate PR creation from successful shipment.** Define distinct lifecycle states such as `planning`, `implementing`, `reviewing`, `ready_for_pr`, `awaiting_merge`, `merged`, `stopped`, and `failed`. Under `--merge=wait`, do not mark the issue Done or record `shipped` when the PR is merely opened. Handle a declined or failed merge explicitly.
4. **Isolate write-based functional QA.** A record-name prefix is not a safety boundary. Require an isolated disposable database/application environment before automated writes, role changes, or destructive scenarios. Confirm that external side effects (emails, webhooks, third-party integrations) are disabled or sandboxed. Without isolation, perform only safe read-only checks and mark unverified write-dependent requirements NOT_PROVEN. Do not silently fall back to a shared environment.
5. **Make verdict calculation unambiguous.** A round should use *validated and deduplicated findings*, not raw reviewer findings, when deciding whether it passes. Explicitly track which brief requirements remain FAIL or NOT_PROVEN. A false-positive Major finding should not independently force a failed round once disproved.
6. **Correct security severity rules.** Unauthorized access or sensitive-record exposure may be Critical/Major even when reachable only through a custom role. Classify impact by what can happen, to whom, and how reversible it is—not whether a role or path is common.

## P1 — Simplify the workflow

1. **Remove mandatory consecutive passing rounds.** Default to one independent review after implementation. Start another review only when code changes, findings remain unresolved, verification coverage is insufficient, the base changes, or the risk warrants additional independent evidence. Retain a configurable escalation option if desired, but not a compulsory PASS streak.
2. **Choose agents based on risk.** Low-risk changes may need only the implementer and targeted checks. Medium-risk features receive an independent reviewer. High-risk changes may justify specialist security/data review and real-app QA. Avoid spawning four reviewers and a validator for every round.
3. **Treat model diversity as secondary to evidence diversity.** Prefer test execution, permission-matrix assertions, database constraints, migration checks, and isolated functional flows over multiple models reading the same diff. Reviewer agreement alone is not verification.
4. **Replace rigid architectural prohibitions with justified exceptions.** “No new permission,” “shared code imports no feature,” and “refine, do not add” are useful defaults, not universal requirements. Allow documented, requirement-driven exceptions; escalate meaningful business/security tradeoffs.
5. **Treat drift as a signal, not a verdict.** Compare changed files with the plan, but allow discovered legitimate dependencies when documented. Also review unexpected behavior *within* planned files. Do not make an initially predicted file list a hard boundary.
6. **Simplify setup without sacrificing safety.** Discover commands and environment capabilities from project docs first. Require only the setup relevant to the feature: UI QA should not block a backend-only change, for example. Missing mandatory verification remains NOT_PROVEN, not PASS.
7. **Make review artifact ownership explicit.** Define where `state.json`, requirements, findings, regression tests, and evidence live. Reviewers should not accidentally leave tests only in ephemeral worktrees. Specify how useful tests are promoted into the implementation branch, verified, and committed.
8. **Do not confuse prompt limits with hard enforcement.** Requested tool-call caps and time budgets are soft unless the Claude Code runtime explicitly enforces them. Use supported runtime controls where available and report actual limits and usage honestly.

## Proposed v2 flow

### 1. Understand and plan
- Read project rules and inspect the affected implementation, existing rule owners, write paths, consumers, and relevant tests.
- Define brief requirements as stable `R1`, `R2`, etc., with acceptance criteria and verification methods.
- Record facts, assumptions, downstream effects, and decisions. Ask the user only about materially unresolved business choices.
- Require explicit approval only for consequential or difficult-to-reverse choices, not routine engineering details.

### 2. Implement
- Implement within the agreed feature boundary, reusing existing mechanisms where appropriate.
- Add targeted regression tests and document significant deviations from the plan.
- Run applicable checks; preserve meaningful intermediate commits and the exact tested SHA.

### 3. Verify based on risk
- **Low:** Targeted checks and local inspection; no separate reviewer by default.
- **Medium:** Independent review of requirements, behavior, and change impact; applicable tests.
- **High:** Independent specialist review plus tests of authorization, data integrity, state transitions, rollback behavior, and isolated real-app flows as applicable.
- For every requirement, record `PASS`, `FAIL`, or `NOT_PROVEN` with concrete evidence. A successful build or lint run does not prove business correctness.

### 4. Fix and recheck
- Deduplicate and validate consequential findings; retain evidence for rejected false positives.
- Issue one prioritized fix list to the implementer, then rerun affected checks and review changed code.
- Escalate persistent critical issues or unresolved assumptions. Stop at configured budget/iteration boundaries without claiming success.

### 5. Deliver
- Open a PR containing implementation summary, requirement evidence, checks run, known minors, remaining NOT_PROVEN items, and deployment/rollback notes when relevant.
- Default to human merge approval. If an explicit `--merge=auto` mode is supported, merge only when the specified checks, policies, and authorization are satisfied.
- Mark merged/Done only after merge is confirmed. Clean up isolated resources safely.

## Definition of done for the skill refactor

- [ ] The skill cannot be model-invoked automatically.
- [ ] Dry-run creates no branches, worktrees, issues, state files, PRs, or other side effects.
- [ ] An unmerged PR is never reported as shipped or moved to Done.
- [ ] Shared/non-isolated QA environments cannot be used for automated write tests.
- [ ] PASS depends on validated findings and requirement evidence, not raw reviewer opinions.
- [ ] A custom-role authorization leak is evaluated by impact, not downgraded due to role type.
- [ ] A clean medium-risk implementation can complete after one adequately evidenced review.
- [ ] New review rounds have explicit triggers; repeated reviews of unchanged code are not mandatory.
- [ ] Unexpected but legitimate file changes can be justified without being automatically treated as defects.
- [ ] The implementation preserves stable requirement IDs, SHA-bound evidence, NOT_PROVEN, resume/stop controls, and honest verification reporting.
- [ ] The README and skill docs agree on invocation, QA safety, cost, and merge behavior.

## Validation scenarios

Run a small benchmark against the current skill and a Guard-only baseline. Use representative tasks and seeded defects:

1. **Low risk:** Edit UI copy; confirm no unnecessary review fan-out or planning ceremony.
2. **Medium risk:** Add form validation; confirm one focused review checks server behavior, not only client presentation.
3. **High risk:** Change a role-dependent application transition; confirm checks cover unauthorized server calls, record scope, lifecycle effects, and data integrity.
4. **QA safety:** Point at a shared database; confirm the workflow refuses write-based QA rather than attempting it.
5. **Dry-run:** Confirm no side effects by comparing repository and issue-board state before and after.
6. **Merge-wait:** Confirm an open PR remains awaiting approval and the issue is not Done.
7. **False positive:** Introduce a reviewer finding that the validator disproves; confirm it does not block the round.
8. **Interrupted session:** Resume from recorded state without duplicating branches, issues, or completed work.

Compare confirmed defects caught, missed defects, false positives, elapsed time, agent invocations, and actual reported token usage. Do not claim an improvement without comparative evidence.

## Boundaries for the implementation

- **Refactor the existing `feature-review-loop`; do not create Forge, Pact, or extra permanent agents.**
- Keep Guard as the lightweight default. Feature Review Loop remains explicitly invoked for meaningful end-to-end work.
- Preserve substantive safeguards while reducing duplicated instructions and unnecessary orchestration.
- Do not introduce a strict word/KB target at the expense of clarity or safety.
- Do not perform real deployments or merge this repository merely because the feedback asks for an implementation.

**Success criterion:** Feature Review Loop should increase the probability of catching consequential defects **without making every feature pay the cost of a full multi-agent audit**.

## References

- Existing skill: https://github.com/thuannguyen13/imagineer/blob/main/skills/feature-review-loop/SKILL.md
- Guard: https://github.com/thuannguyen13/imagineer/blob/main/skills/guard/SKILL.md
- Claude Code skills documentation: https://code.claude.com/docs/en/skills
