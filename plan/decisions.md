# Decisions

## 2026-10-13 — One active skill first

Begin with Guard. Forge and Pact are potential separate skills only if evidence reveals a gap. This avoids token overhead and overlapping responsibilities.

## 2026-10-13 — Progressive review

Low-risk work proceeds directly; medium-risk work gets targeted inspection; high-risk work requires explicit impact assessment and approval for consequential actions.

## 2026-10-13 — Project documents remain authoritative

Imagineer describes the review method. A consuming project's architecture, business specifications, design-system rules, and tests define its actual invariants.

## 2026-10-13 — Enforcement over reminders

When an issue recurs, first consider automated checks, tests, constraints, or improved code ownership. Only add more skill text if it solves a verified gap.

## 2026-10-28 — Feature-review-loop as an opt-in exception

Add feature-review-loop despite "no multi-agent ceremony by default". It is used in practice for end-to-end feature work, and it runs only on explicit request, so routine work keeps Guard's cost. App-specific values (commands, ports, board, test prefix) moved out of the skill into a Project setup table that each consuming project fills in.

## 2026-10-28 — Three skills, split by scope

Guard (one change, automatic), forge (one feature, `/forge`), ground (whole product, `/ground`). Each has one action and one reason to exist. Stage-per-skill sets (charter, ground, guard, forge, gate, tend) were rejected: five or six skills read as a pipeline, and their jobs fold into these three. Supersedes the 2026-10-13 plan for separate Forge and Pact skills.

Guard is the base: it owns risk tiers and single-change rules, and forge and ground use them, so guard is installed with either. Skills never call each other; they hand off through project docs that people also read. Each concern has one owner; both lists are in `docs/proposals/skillset.md` §4.

## 2026-10-28 — Names

Feature-review-loop becomes **forge**; the planned Forge job (reuse existing code) is already guard's "Before code". **Pact** is retired: it clashes with the Pact contract-testing tool, and its planned job becomes forge's verification reference. **Ground** is the new product-wide skill. One-word names, no clash with Claude Code built-ins such as `/verify`.

## 2026-10-28 — One owner for verify, fix, repeat

Forge owns the loop, for features it builds and, with `--verify <branch|PR>`, for existing code. A separate loop skill would either duplicate the loop inside forge or split forge into two commands with a handoff. Ground fixes only the checklist items the user approves and re-checks those items. Routine changes stay single-pass; a Stop hook that ground installs keeps sessions from finishing with failing checks.

## 2026-10-28 — Two audiences

Write for people who build by prompting and for engineers equally. The wording rules are the README's design principles.

## 2026-10-28 — Validated status

A skill is either **in use**, **validated**, or **planned**. It is marked validated only after it passes its seeded-defect scenarios on the bench fixture app and one run on a real project. Reviewer agreement and drafted text are not evidence. Guard and feature-review-loop stay in use, not validated, until then.

## 2026-10-28 — Clean bar

Every phase of skill work ends with these checks before its pull request:

- Each rule has one owner; other files link to it.
- No instruction text for what a hook, agent limit or test already enforces.
- No contradictions, checked by a reviewer that has not seen the work.
- Each section stays only if removing it changes a scenario result.
- The same words for the same thing.
- User-facing text follows the README's design principles.
- Code also passes typecheck, lint, tests, `/simplify` and `/code-review`; hook scripts have tests that they block a seeded command and allow a harmless one.

The pull request lists what was removed and the bench results before and after.

## 2026-11-03 — Plugin packaging, with forge's roles as agents

Package the repository as one Claude Code plugin, after a proposed "PO, Architect, Dev, QA" pipeline plugin. Its useful parts map onto what exists: PO is forge's orchestrator, Architect is `forge-scout` and `forge-plan-reviewer`, Dev is `forge-implementer` (preloads guard), QA is reviewers a–d and `forge-validator`. Role limits move from prose into agent frontmatter (`model`, `tools`, `maxTurns`, `isolation`), and the reviewer rule against commits, pushes and GitHub calls becomes a plugin hook keyed on `agent_type`, which works even though plugin agents ignore their own `hooks`. Supersedes "No plugin yet" in `docs/proposals/skillset.md` §5.

Not adopted from that proposal: routing every change through the pipeline, and a lead that never edits code (routine work stays with guard, and no skill must run before another); `PROJECT_CONTEXT.md` (ground's project docs already hold it); `commands/` (skills supersede them); a handoff log hook (forge's `state.json` already records each spawn and round). Ground's hooks stay opt-in per project rather than plugin hooks, because they change what every session may do.
