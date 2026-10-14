---
name: guard
description: Use for changes to application code to identify consequential omissions, preserve existing architecture and patterns, and verify affected invariants. Scale review to risk; routine UI edits stay lightweight.
---

# Guard

Protect the system while delivering the smallest complete change. Use existing project rules as the authority; this skill is not a replacement for them.

## Triage

- **Low:** Copy, styling, presentation with no behavior or data impact. Find the nearby pattern, change it, run an appropriate check. No plan.
- **Medium:** Forms, workflows, validation, business behavior. Inspect the owning feature, dependencies, relevant rules and tests; implement and verify.
- **High:** Schema, deletion, authorization, authentication, shared contracts, migration, deployment, recovery. Identify invariants and risks first. Present a concise approach and request approval for destructive, security-sensitive, or difficult-to-reverse decisions.

If a seemingly small change crosses a high-risk boundary, treat it as high risk.

## Before code

1. Inspect only relevant implementation, tests and project documentation. Prefer existing components, terminology, helpers and write paths.
2. Ask: **What must remain true after this change? What requirement might be missing?**
3. Check applicable concerns: data integrity and lifecycle; audit and history; permissions and sensitive data; concurrency and cross-feature effects; UI consistency; tests, release and recovery.
4. Separate verified defects from plausible risks and optional improvements. Challenge a documented design when evidence reveals an important omission.
5. Choose the simplest maintainable approach. Decide routine technical details autonomously; escalate meaningful business or safety tradeoffs.

## After code

- Verify affected behavior and invariants with targeted checks; do not claim unrun checks passed.
- Check for unnecessary duplication or drift from established components, copy and architecture.
- For recurring failures, prefer a regression test, constraint, or focused project-document update over adding generic instructions.
- Report briefly: changes, checks actually run, and material remaining risks.

## Limits

- No repository-wide audit, extensive planning, or multi-agent ceremony by default.
- Do not duplicate project-specific rules or specialized skills.
- Do not change unrelated code simply because it can be improved.
- An instruction is not an enforcement mechanism: critical guarantees belong in tests, constraints and CI.
