# Later

These are **candidates**, not commitments.

## Not planned

- A pipeline where one skill must run before another.
- Full architecture review on each change.
- Copying each application's architecture into this repository.

## Health checks for Imagineer itself

**Trigger:** met. Problems in Imagineer's own behaviour keep being found by the owner reading logs and by independent reviews, never by its own checks ([research](../docs/research/self-health.md), 2026-11-14).

A regression suite for Inspect on the bench, vitals from every run, a wider self-check, and review as a rule with an end. Proposed in the design doc ([Health](../docs/proposals/inspect-and-build.md#health-proposed-2026-11-14)); it moves to Now when the owner has decided the budget, the models and where it runs.

## Destructive-command guard with buttons

**Trigger:** users of Imagineer ask for protection against destructive commands (`rm -rf`, force pushes, database drops) in their own sessions.

A mod that holds such a command and shows what it would change, with Proceed and Cancel, as Anthropic's `blast-radius` sample does. It would be the plugin's first mod that changes tool calls, so it needs its own on/off switch and stays out of the read-only grade mod.

## A throwaway database for tests that need one

**Trigger:** a project whose tests skip themselves without a database, as the sales portal's 43 test files do.

Inspect would start a disposable database (Postgres in Docker, or PGlite where it fits), apply the project's migrations as its CI does, and set the variable the tests read, so mutation testing sees the same tests CI runs.

## Going public

**Trigger:** the owner decides Imagineer is ready for people outside the repository, such as a team without GitHub accounts. Decided 2026-11-07: stay private until then.

Installing from a marketplace with git auto-update, without a GitHub account, needs a public repository. The plan:

- **A separate public repository, `imagineer-plugin`,** holding only what gets installed: the plugin and its marketplace file. Plans, research, design docs and the bench app stay private in `imagineer`.
- **Publishing as part of each release:** a script copies the released plugin there. Users turn on auto-update once (`/plugin` → Marketplaces → Enable auto-update) and get each release by its `version`.
- **Install in one line:** `/plugin install imagineer --marketplace thuannguyen13/imagineer-plugin` (Claude Code 2.1.275 or later).
- **Feedback** goes to that public repository's issues, from anyone with a GitHub account; Save as file for the rest. The triage loop watches it.

**Before it goes public:**

- Imagineer has been run end to end on a few real projects by people other than the owner, and the grade, the questions and the pane hold up.
- A license is chosen (the plugin has none; see the 2026-11-05 decision).
- Everything in `plugin/` is read for what should not be public: keys, internal URLs, names or data from the owner's projects, the sales portal included. A secret scan of the plugin's files and of what will be published.
- The README and an install guide describe the public install, and the feedback link points at the public repository.
