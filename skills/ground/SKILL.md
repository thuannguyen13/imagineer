---
name: ground
description: Ground a whole product the way an experienced engineer would. In a new repository, set up its foundations; in an existing one, check them, fix what the user approves, and check again. Covers who can do what, data access rules, secrets, separate development and production, backups, automatic checks, and the docs every session reads. /ground release adds launch readiness.
argument-hint: [release]
disable-model-invocation: true
---

Input: $ARGUMENTS

You ground the whole product. Ask product questions and decide technical ones, recording each decision with a one-line reason. Every change you make follows guard. Describe each item, finding and hook by what it means for the product's users; keep technical detail to the evidence line.

**Mode.** **Set up** when the repository has no product code yet (empty, or only a framework's starter files). Otherwise **check**. If unsure, ask. `release` adds checklist item 8 in check; after a set up, run `/ground release` before launch.

## Project docs

Write them in set up; check them in check. If the project already keeps the same content under other names, use those instead of creating duplicates.

| Doc | Holds |
|---|---|
| `docs/product.md` | Who it is for, the problem, the core flows, what is out of scope |
| `docs/permissions.md` | Who can do what, as a table of roles × actions |
| `docs/data-model.md` | What is stored, who owns it, which access rule protects it |
| `docs/decisions.md` | Dated decisions with one-line reasons |
| `docs/glossary.md` | The product's words, one meaning each |
| `CLAUDE.md` | Commands (tests, typecheck, the fast checks to run before finishing, dependency setup), environments, where secrets live, pointers to the docs above |

## Checklist

Each item has a fixed consequence. Rank findings with blocking items first, then in table order.

| # | Item | Evidence | If it fails | Blocks go |
|---|---|---|---|---|
| 1 | Every table or collection with user data has an access rule, denied by default | Rules switched on, not only written; a test per role | People can read or change other people's data | yes |
| 2 | No secret reaches the browser or git history; only keys meant to be public do | Code and config the browser receives; `git log -p` for key patterns | Anyone can use the product's paid services or data as the owner | yes |
| 3 | Development and production are separate, and agents hold no production write access | Configuration points each environment at its own data; no production credentials in the repository or this session's environment | Local work or an agent mistake changes or deletes real data | yes |
| 4 | A backup procedure exists, and at least one restore was done and logged | The procedure, and a restore log entry | A data loss becomes permanent | yes |
| 5 | Destructive commands need the user's approval | The hook below is installed | One wrong command destroys data or history | no |
| 6 | Tests and typecheck run automatically on every pushed change | CI configuration, or the equivalent | Broken changes reach users unnoticed | no |
| 7 | The project docs exist and match the code | The docs above, compared with the code | Every session rediscovers, or contradicts, the product's rules | no |
| 8 | Release only: error tracking, an uptime alert, a tested rollback, rate and cost limits, a way for users to export and delete their data | Each one's configuration or log | Problems reach users before anyone knows, cannot be undone, or run up costs; user data requests cannot be met | yes |

Each item gets **PASS**, **FAIL** or **NOT_PROVEN** (could not be checked), never PASS without evidence.

## Set up

1. Ask the product questions in one message: who it is for, the problem, the core flows, the roles and what each may do (offer a draft table), what must never happen, and what is out of scope.
2. Write `product.md`, `permissions.md` and `glossary.md` from the answers.
3. Choose the stack, data model, environments, secret handling, backups and automatic checks. Record each in `decisions.md`. Ask only when a choice changes cost, lock-in, or who can see data.
4. Build the foundations, write `data-model.md` and `CLAUDE.md`, and offer the hooks.
5. Report the checklist with evidence. An item the user chose not to have stays FAIL and is listed, not hidden.

## Check

1. Read the project docs, CLAUDE.md, the schema or migrations, the sign-in and permission code, environment configuration, what the browser receives, the automatic checks, and backup notes.
2. Check every item without changing anything and without connecting to production. Running the project's own tests is allowed once you have confirmed they use their own database.
3. Report each finding as what can happen to users, why (file:line), and the fix. Then **go**, or **no-go** while any blocking item is FAIL or NOT_PROVEN.
4. Ask in one message which findings to fix. Fix each approved one, re-check only those items, and report the new go or no-go.

Never do these yourself; give the user the steps instead: replace a leaked key with a new one (deleting it from the code is not enough), change production, restore a backup (a test restore goes to a scratch location), or rewrite git history.

## Hooks

Offer them in set up, and in check when they are not installed. Install only what the user approves: copy `block-destructive.py` and `check-before-stop.py` from `${CLAUDE_SKILL_DIR}/hooks/` to `.claude/hooks/` and merge this into `.claude/settings.json`:

```json
{"hooks": {
  "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command",
    "command": "python3 -I \"$CLAUDE_PROJECT_DIR/.claude/hooks/block-destructive.py\""}]}],
  "Stop": [{"hooks": [{"type": "command",
    "command": "python3 -I \"$CLAUDE_PROJECT_DIR/.claude/hooks/check-before-stop.py\""}]}]
}}
```

- **Approval before destructive commands** (item 5): Claude must ask before deleting data, files that cannot be rebuilt, or shared history. Write `.claude/hooks/production-patterns.txt` with this project's production markers (database host, deploy commands, environment flags), one regular expression per line. Database tools connected other than through the shell need their own write access turned off.
- **Checks before finishing**: Claude cannot finish with failing fast checks. Write the fast checks command as the first line of `.claude/hooks/fast-checks.txt`.
