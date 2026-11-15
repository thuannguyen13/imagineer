# Imagineer Skillset — Proposal

**Goal:** help people who build by prompting, and engineers, ground a product the way an experienced engineer would.
**Status:** superseded on 2026-11-05 as the plugin's entry points by [inspect-and-build.md](../proposals/inspect-and-build.md); the failure research in §1 still applies. Was: target design, decided 2026-10-28 (`plan/decisions.md`). `README.md` describes what exists today; work order is in `plan/now.md`.

---

## 1. What goes wrong without an engineer

| Failure | Evidence | What an engineer would have done |
|---|---|---|
| Data readable by anyone: database access rules (row-level security) off, public key gives full access | CVE-2025-48757: 170+ Lovable-built apps exposed user data. Wiz found risks in ~20% of vibe-coded apps reviewed, including secrets in client code. | Deny by default; access rule per table; only publishable keys in the browser |
| Insecure code by default | Veracode 2025: AI-generated code introduced a known weakness in 45% of tasks | Security checks in CI; permission table tested |
| Agent destroys production data | Replit, July 2025: agent deleted a production database during a code freeze; one database served preview, test and production; recovery status was misreported | Separate dev and prod; agent never holds prod write access; backups restored at least once, independently of the agent |
| Only the described case works | Practitioner reports: generated code handles the case described, not the cases not described; duplication rises, refactoring falls | Ask "what must remain true?"; examples include refusals and boundaries |
| Can build, cannot maintain | Mälardalen thesis 2026: vibe coding lowers the entry barrier, but modifying, deploying and maintaining still needs technical expertise | Written decisions, data model and rules that later sessions read |

The builder does not know which questions to ask, cannot judge the code, and cannot tell a claim from a proof. An experienced engineer adds **the right questions at the right time, foundations that are expensive to change later, and proof instead of claims.**

---

## 2. Rules every skill follows

The design principles in `README.md`. Rules with no exceptions become hooks, not instructions.

---

## 3. Skills

Three skills, split by what the action covers. Each has one reason to exist.

| Skill | Scope | Action | Starts | Context cost when idle |
|---|---|---|---|---|
| **guard** | One change | Make any code change safely | Automatically; `/guard` also works | Name and description |
| **forge** | One feature | Build a consequential feature end to end with proof per requirement, or verify, fix and repeat on existing code | `/forge <request>`, `/forge --verify <branch\|PR>`, `/forge` to resume | None |
| **ground** | Whole product | New repo: set up foundations. Existing repo: check them, fix what the user approves, re-check | `/ground`, `/ground release` | None |

### guard (base)
- Owns risk triage (Low / Medium / High) and the rules for making one change. Forge and ground use those rules, so guard is installed with them.
- Reads the grounding docs before code; escalates in product terms.
- Points to `/forge` for High-risk feature work with no plan, and to `/ground` when foundations or docs are missing. Only the user starts them.

### forge
- Plan as a contract: each requirement is a rule with examples, a risk tier and a proof method. Then build, then verify → fix → repeat until the exit criteria are met. The PR leads with requirement → evidence.
- `--verify <branch|PR>` skips plan and build: requirements are drafted from the issue or PR and the diff, the user confirms them, then the same rounds run.
- Design detail: `docs/archive/feature-review-loop/FEATURE_REVIEW_LOOP_RESEARCH.md` and `FEATURE_REVIEW_LOOP_VERIFICATION.md`.

### ground
- **Set up** (no app code yet): product questions → brief, who-can-do-what table, data model, environments, secrets, backups, CI checks, CLAUDE.md commands.
- **Check** (app code exists): the checklist against what exists, ranked by each item's consequence. The user picks what to fix; ground fixes it under guard's rules and re-checks those items. Result: go / no-go. `release` adds launch items.
- Offers to install hooks: block destructive commands and prod access; a Stop hook that runs the project's checks before any session finishes.

Checklist, ordered by the evidence in §1:
1. Every table has an access rule; default deny; tested per role.
2. No secret in client code or git history.
3. Dev and prod separate; the agent holds no prod write credentials.
4. Backups exist and one restore has been done.
5. Destructive commands need approval, enforced by hook.
6. Checks run in CI.
7. Grounding docs match the code.
8. Release only: error tracking, uptime alert, tested rollback, rate and cost limits, user data export and deletion.

---

## 4. One owner per concern

| Concern | Owner | Others |
|---|---|---|
| Risk tiers, single-change rules | guard | forge and ground read them |
| Verify → fix → repeat on feature requirements | forge | — |
| Requirements contract, severity scale | forge | ground ranks by its checklist's fixed consequences instead |
| Product checklist and its re-check | ground | — |
| Checks pass before a session finishes | Stop hook installed by ground | no skill restates it |

Skills never call each other. They hand off through project docs, which people also read:

| Project doc | Written by | Read by |
|---|---|---|
| `docs/product.md`: who, problem, core flows, out of scope | ground | all |
| `docs/permissions.md`: who can do what, as a table | ground | all |
| `docs/data-model.md` | ground | guard, forge |
| `docs/decisions.md`: dated, with reasons | all | all |
| `docs/glossary.md` | ground | all |
| CLAUDE.md: commands, environments, pointers | ground | all |

---

## 5. Install

The repository is a Claude Code plugin, `imagineer`. It ships the three skills, forge's agents in `agents/` (model, tools, turn limit and worktree isolation per role) and one plugin hook. Agents shipped in a plugin ignore their own `hooks`, so the reviewer guard is a plugin-level `PreToolUse` hook that acts only when `agent_type` names a forge review agent. Ground's hooks are not plugin hooks: they change what every session in a project may do, so ground installs them only with the user's approval.

Copying folders still works: `skills/<name>/` into `.claude/skills/`, and for forge also `agents/` into `.claude/agents/` and the reviewer hook into the project's settings. Guard also works in Codex (`.agents/skills/`); forge and ground rely on Claude Code subagents and hooks.

---

## 6. Risks

1. **Becoming the ceremony the README warns against.** Only guard is automatic; no skill has to run before another.
2. **Two audiences.** Writing for both risks fitting neither. "Say what happens to users first, how it works second" is the principle that has to hold.
3. **Discoverability of `/forge --verify`.** A builder who wrote a feature by chatting may not look for it under forge. Revisit if the bench or real runs show verifying existing code is the main use.
4. **No evidence yet that these skills change outcomes.** None is validated; see `plan/decisions.md`.
5. **Platform scope.** Hosted builders (Lovable, Replit, Bolt) are out of scope.
6. **Trademark.** "Imagineering" is, to my knowledge, a Walt Disney trademark, and "Imagineer" may be too (not verified). Check before publishing or marketing the skillset under that name.

Names and the reasons for them: `plan/decisions.md`.

## Sources

- CVE-2025-48757 / Lovable access-rule exposure — https://www.desplega.ai/blog/vibe-break-chapter-iv-the-lovable-inadvertence
- Wiz, common security risks in vibe-coded apps — https://www.wiz.io/blog/common-security-risks-in-vibe-coded-apps
- Cloud Security Alliance, vibe coding security debt — https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/04/CSA_research_note_ai_codegen_vulnerability_debt_20260406-csa-styled.pdf
- Veracode 2025 GenAI Code Security Report — https://www.veracode.com/press-release/ai-generated-code-poses-major-security-risks-in-nearly-half-of-all-development-tasks-veracode-research-reveals/
- Replit production database deletion — https://www.theregister.com/2025/07/22/replit_saastr_response/ ; https://www.eweek.com/news/replit-ai-coding-assistant-failure/
- Vibe coding and technical debt (Mälardalen thesis) — https://mdu.diva-portal.org/smash/get/diva2:2068035/FULLTEXT01.pdf ; vibe coding in practice — https://arxiv.org/pdf/2512.11922
- Production readiness reviews — https://oneuptime.com/blog/post/2026-08-06-production-readiness-review-evidence-owners-launch-gates/view ; https://www.blameless.com/blog/4-things-you-need-to-know-about-writing-better-production-readiness-checklists
- Claude Code skills — https://code.claude.com/docs/en/skills ; subagents — https://code.claude.com/docs/en/subagents ; hooks — https://code.claude.com/docs/en/hooks
