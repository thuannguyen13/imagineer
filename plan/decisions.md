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
