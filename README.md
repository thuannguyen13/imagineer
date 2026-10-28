# Imagineer

Lightweight engineering judgment for AI coding agents. Imagineer helps agents catch missing requirements, preserve established architecture, and verify consequential changes without slowing down routine work.

## Skills

| Skill | Status | Purpose |
| --- | --- | --- |
| [guard](skills/guard/SKILL.md) | Active | Risk-based review before and after implementation |
| [feature-review-loop](skills/feature-review-loop/SKILL.md) | Active, opt-in | End-to-end plan, build and multi-agent review of one feature, on explicit request |
| forge | Planned, conditional | Implementation guidance if existing agent behavior proves insufficient |
| pact | Planned, conditional | Focused invariant verification if existing tests and CI are insufficient |

Start with **guard**. The other skills are hypotheses, not a required pipeline.

## Install guard

For Claude Code, copy `skills/guard/` to your project's `.claude/skills/guard/`. For Codex, copy it to `.agents/skills/guard/`. Have the local agent verify its supported skill discovery path before installation.

The skill is general-purpose. Project-specific architecture, copy standards, design system, and deployment rules remain in the project's own documentation. Do not replace them with this repository.

## Install feature-review-loop

Claude Code only: it relies on subagents with per-agent models and worktree isolation. Copy `skills/feature-review-loop/` to `.claude/skills/feature-review-loop/`. Then record the values its **Project setup** table lists (check commands, QA server and port, issue board, test record prefix) in your project's CLAUDE.md. The skill asks for any that are missing.

It is costly by design: several Opus and Sonnet agents per review round. Use it for features where a missed rule or permission is expensive, not for routine work.

## Planning

See [plan/](plan/) for active work, future candidates, and decisions. Do not implement a planned skill without first demonstrating a distinct need.

## Design principles

- Small changes stay fast.
- Review depth follows consequences, not file count.
- Inspect code and established rules before inventing patterns.
- Prefer tests and enforceable constraints over more instruction text.
- Report actual verification; distinguish evidence from assumptions.
