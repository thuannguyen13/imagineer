# Imagineer Skillset by Stage — Proposal

**Goal:** help someone who builds by prompting ("vibe-coder") ground their product the way an experienced engineer would, at each stage of development.
**Starting point:** guard (active), feature-review-loop (active, opt-in), forge and pact (planned, conditional).
**Date:** 2026-10-28.

---

## 1. What goes wrong without an engineer

| Failure | Evidence | What an engineer would have done |
|---|---|---|
| Data readable by anyone: database access rules (row-level security) off, public key gives full access | CVE-2025-48757: 170+ Lovable-built apps exposed user data. Wiz found risks in ~20% of vibe-coded apps reviewed, including secrets in client code. | Deny by default; access rule per table; only publishable keys in the browser |
| Insecure code by default | Veracode 2025: AI-generated code introduced a known weakness in 45% of tasks | Security checks in CI; permission table tested |
| Agent destroys production data | Replit, July 2025: agent deleted a production database during a code freeze; one database served preview, test and production; recovery status was misreported | Separate dev and prod; agent never holds prod write access; backups restored at least once, independently of the agent |
| Only the described case works | Practitioner reports: generated code handles the case described, not the cases not described; duplication rises, refactoring falls | Ask "what must remain true?"; examples include refusals and boundaries |
| Can build, cannot maintain | Mälardalen thesis 2026: vibe coding lowers the entry barrier, but modifying, deploying and maintaining still needs technical expertise | Written decisions, data model and rules that later sessions read |

The pattern: the vibe-coder does not know which questions to ask, cannot judge the code, and cannot tell a claim from a proof. An experienced engineer adds three things: **the right questions at the right time, foundations that are expensive to change later, and proof instead of claims.**

---

## 2. Rules every skill follows

1. **Ask product questions, decide technical ones.** "Can a teammate see another teammate's invoices?" not "Should we enable RLS?" Make technical choices yourself and record each with a one-line reason.
2. **Show, don't claim.** Every "done" comes with something the user can check without reading code: a who-can-do-what table, steps to see it working, a list of what was proven and what was not.
3. **Enforce what must never happen.** The user will not catch an agent touching production or committing a secret, so those rules are hooks, not instructions.
4. **Ground every session in project docs.** A small set of documents states the product, its rules and its decisions. Every skill reads them; every change updates them in the same commit.
5. **Depth follows consequences.** Guard's Low / Medium / High triage applies everywhere.
6. **No pipeline.** Each skill runs on its own when its moment arrives. Skills share **project documents**, not calls to each other.

---

## 3. Stages and skills

```
 SHAPE ──────► GROUND ──────► BUILD ─────────────────────► LAUNCH ──────► RUN
 shape         ground         guard (every change)         launch         (later)
                              feature-review-loop (deep)
```

| Stage | Skill | When | Produces | Status |
|---|---|---|---|---|
| Shape | **shape** | New product, or a new feature with no brief | Product brief; requirements as rules + examples; open questions; out of scope | New |
| Ground | **ground** | Starting a project, or adopting Imagineer on an existing app | Grounding docs, dev/prod separation, secrets handling, deny-by-default data access, backups, checks in CI, guard hooks. On an existing app: an audit ranked by impact | New |
| Build | **guard** | Every code change (auto) | Smallest complete change, invariants checked, docs updated | Active; small changes |
| Build | **feature-review-loop** | Consequential feature, explicit request | Feature built to its contract, with evidence per requirement | Active; refactor per research docs |
| Launch | **launch** | Before first public release, or a risky release | Readiness report: each item go / no-go with evidence | New |
| Run | — | Incidents, upkeep | — | Candidate only |

### shape
- **Asks:** who it is for, the problem, the 3–5 core flows, who can do what, what must never happen, what is out of scope.
- **Writes:** `docs/product.md` (brief) and, per feature, requirements as rule + 2–4 examples (happy path, boundary, refusal). This is the contract format feature-review-loop already needs ([verification doc §2](../feedback/FEATURE_REVIEW_LOOP_VERIFICATION.md)).
- **Exceeds expectations** by proposing unstated invariants for the user to accept or decline, never by adding features.
- **Not:** a business plan or marketing.

### ground
Two modes, one checklist:
- **Set up** (new project): choose and record stack, data model, roles and permissions, environments, secrets, backups, checks, CI. Write the grounding docs and a CLAUDE.md that points to them and lists commands (this fills feature-review-loop's Project setup table). Install the zero-exception hooks.
- **Audit** (existing app): run the same checklist against what exists and return findings ranked by impact, each with a plain-language consequence and a fix guard can carry out.

Checklist, ordered by the evidence in §1:
1. Every table or collection has an access rule; default is deny. Tested per role.
2. No secret in client code or git history; only publishable keys in the browser.
3. Dev and prod are separate; the agent has no prod write credentials.
4. Backups exist and one restore has been done.
5. Destructive commands (drop, delete-all, force push, prod deploy) need human approval, enforced by hook.
6. Checks (types, lint, tests) run in CI on every change.
7. Grounding docs exist and match the code.

### guard (changes)
- Read the grounding docs before code; update them in the same commit.
- Escalate in product terms: what users would see or lose, not the technical mechanism.
- When a High-risk request has no brief, suggest **shape** first.

### feature-review-loop (changes)
- Reads shape's requirements when present instead of writing its own; one owner for the contract format.
- Uses ground's docs for its Project setup values, so a vibe-coder never fills that table by hand.
- Otherwise as in the research and verification docs.

### launch
Production readiness with evidence, not a ticked list:
- Re-run ground's checklist (it owns the items; launch does not copy them).
- Add what only matters once real users arrive: error tracking, uptime alert, a tested rollback, rate and cost limits, data export and deletion for users, a restore done within the last month.
- Output: go / no-go per item with evidence, and the few items the user must decide (accept risk or fix).

### Run (candidate)
Incident handling, regression tests from incidents, dependency and debt upkeep. Built-in skills (`/debug`, incident response, tech-debt) already cover much of this. Add only if vibe-coders repeatedly fail here in ways those skills miss.

### forge and pact
- **forge** (reuse existing owners, minimise abstractions) becomes part of guard's "Before code". No separate skill.
- **pact** (invariant verification) becomes the shared verification reference used by guard, feature-review-loop and launch.

---

## 4. Shared layer

Skills hand off through project documents, which people also read. That is not a single-use interface.

| Project doc | Written by | Read by |
|---|---|---|
| `docs/product.md`: brief, flows, out of scope | shape | all |
| `docs/permissions.md`: who can do what, as a table | shape, ground | guard, feature-review-loop, launch |
| `docs/data-model.md` | ground | guard, feature-review-loop |
| `docs/decisions.md`: dated, with reasons | all | all |
| `docs/glossary.md` | shape | all |
| CLAUDE.md: commands, environments, pointers | ground | all |

This is the structure the Aperia project already uses. Ground generalises it.

Repository layout, installed as one Claude Code plugin so shared files and hooks travel together:

```
imagineer/
  skills/shape/ ground/ guard/ feature-review-loop/ launch/
  reference/      # verification techniques, severity, plain-language rules
  agents/         # reviewer, validator, QA definitions
  hooks/          # prod-write, secret, destructive-command guards
```

**Check before building:** subagent-frontmatter hooks are ignored for plugin agents ([research doc §7](../feedback/FEATURE_REVIEW_LOOP_RESEARCH.md)). Guards must be plugin-level hooks scoped by `agent_type`, or installed into the project by ground. Verify on the installed Claude Code version.

---

## 5. Risks

1. **Becoming the ceremony the README warns against.** Five skills look like a pipeline. Mitigation: no skill requires another; each scales to risk; guard stays the only automatic one.
2. **Audience shift.** The README targets "AI coding agents" and feature-review-loop assumes an engineer (worktrees, boards, ports). Ground closes part of that gap; feature-review-loop stays the most technical skill.
3. **No evidence yet that these skills change outcomes.** Each new skill must pass seeded scenarios before it is marked active (plan/now.md's rule).
4. **Platform scope.** Many vibe-coders use hosted builders (Lovable, Replit, Bolt). These skills target Claude Code (and Codex for guard); hosted builders are out of scope.

---

## 6. Order of work

1. feature-review-loop defect fixes (no design change; already agreed direction).
2. **ground**, audit mode first: §1 shows most damage in existing apps. Validate on a seeded app with access rules off, a secret in client code, and a shared dev/prod database; it must find all three.
3. **launch**, reusing ground's checklist.
4. **shape**, and feature-review-loop reading its contract.
5. Plugin packaging and hooks.
6. Run: only if evidence appears.

## 7. Names

The repo's names are short, one-word, plain English with a maker's-workshop feel: **guard**, **forge**, **pact**, under **Imagineer** (imagination + engineer). New names follow the same rules: one word, typeable as `/name`, the meaning guessable without docs, no clash with Claude Code's built-in commands (`/verify`, `/run`, `/code-review`, `/init`) or with a well-known developer tool.

| Stage | Working name | Name | Why |
|---|---|---|---|
| Shape | shape | **charter** | A project charter is the founding agreement on purpose, scope and who decides. A guild's founding document fits the workshop theme |
| Ground | ground | **ground** | Already the theme's word, and the stated goal: "ground the product" |
| Build | guard | **guard** | Active and installed in projects; renaming costs more than it gains |
| Build | feature-review-loop | **forge** | Shape, strike, test, temper, repeat: plan, build, review rounds. Takes over the planned name, whose job folds into guard |
| Launch | launch | **gate** | The gate opens to the public, and it is a go / no-go gate. Inside forge, rename "plan review gate" to "plan review" to avoid the clash |
| Run | — | **tend** (reserved) | Keep the forge and the product in working order |

Flow: **charter → ground → guard / forge → gate → tend**.

Rejected:
- **pact** for shape: clashes with Pact, a widely used contract-testing tool, in exactly the projects that would use it. Retire the name; its planned job becomes the shared verification reference.
- **verify**: clashes with the built-in `/verify`.
- **launch**, **ship**: clear, but break the theme, and "ship" suggests merging without the go / no-go decision.
- Theme-park terms (blue sky, show, backstage): `backstage` is a well-known developer portal, and park vocabulary leans on Disney's Imagineering branding.

Renaming feature-review-loop to forge touches the skill folder, README, `plan/`, the docs in `docs/feedback/`, and copies installed in other projects (`~/.claude/skills/feature-review-loop/`). Record the new meanings of forge and the retired pact in `plan/decisions.md` in the same commit.

**Risk to flag:** "Imagineering" is, to my knowledge, a Walt Disney trademark, and "Imagineer" may be too (not verified). Not a problem for a personal repo; check before publishing or marketing the skillset under that name.

## Decisions to make

| # | Question | Recommendation |
|---|---|---|
| S0 | Names: charter, ground, guard, forge, gate, tend (reserved)? | Yes |
| S1 | Reposition Imagineer for vibe-coders (README, principles)? | Yes, keeping engineers as a secondary audience |
| S2 | Stage skills: shape, ground, guard, feature-review-loop, launch; Run deferred? | Yes |
| S3 | Fold forge into guard and pact into a shared reference? | Yes |
| S4 | Skills hand off only through project docs? | Yes |
| S5 | Ship as one plugin? | Yes, after verifying hook behaviour |
| S6 | Build ground (audit mode) first? | Yes |

## Sources

- CVE-2025-48757 / Lovable access-rule exposure — https://www.desplega.ai/blog/vibe-break-chapter-iv-the-lovable-inadvertence
- Wiz, common security risks in vibe-coded apps — https://www.wiz.io/blog/common-security-risks-in-vibe-coded-apps
- Cloud Security Alliance, vibe coding security debt — https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/04/CSA_research_note_ai_codegen_vulnerability_debt_20260406-csa-styled.pdf
- Veracode 2025 GenAI Code Security Report — https://www.veracode.com/press-release/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/
- Replit production database deletion — https://www.theregister.com/2025/07/22/replit_saastr_response/ ; https://www.eweek.com/news/replit-ai-coding-assistant-failure/
- Vibe coding and technical debt (Mälardalen thesis) — https://mdu.diva-portal.org/smash/get/diva2:2068035/FULLTEXT01.pdf ; vibe coding in practice — https://arxiv.org/pdf/2512.11922
- Production readiness reviews — https://oneuptime.com/blog/post/2026-08-06-production-readiness-review-evidence-owners-launch-gates/view ; https://www.blameless.com/blog/4-things-you-need-to-know-about-writing-better-production-readiness-checklists
- Claude Code skills — https://code.claude.com/docs/en/skills
