# B6 dry run: the sales portal, users and access

**What:** Imagineer's first run on a real project, the owner's sales portal (Next.js, TypeScript, vitest, 320 source files, 1,714 tests), scoped by the owner to one feature: users and access. A dry run: the owner's checkout was never changed. Everything ran on a local clone of `main` (commit `e367d330`) and throwaway copies of it, all removed afterwards.

**How:** Inspect's steps by hand in a Claude Code session, with the owner answering every question: measure, ask, prove, attack. Plugin 0.8.0 at the start; its question format and three measuring bugs were fixed during the run (0.9.0).

## The grade

**✕ Failing.** Stop bar not met: test strength below the bar, structure findings open. The attack part of the bar is met (rounds 3 and 4 clean).

| Dimension | State | Evidence |
|---|---|---|
| Test strength | ✕ Failing | 48 of 51 breaks caught (94%) in Own scope, the dev sign-in switch and Microsoft identity. Own scope 50% (3 of 6), all in the co-seller lookup, whose test needs a database: 43 test files run only with a database, so this is likely lower than in CI. `lib/permissions.ts` (627 breaks) not measured: about 3.5 hours at a safe speed. |
| Matches your intent | ✕ Failing | 6 questions: 4 answered by the owner, 2 settled from the docs and code. The code does not do what was answered for Q4 and Q5 (proof tests fail on today's code); Q6 is answered and not yet proven. |
| Security and permissions | ✕ Failing | 24 attacks in 4 rounds: 22 held, 2 broke through (Q4, Q5). `npm audit`: 1 critical (Next.js 16.3.5; the affected `next/og` is not used) and 6 high in shipped dependencies. Fallow's 7 security candidates were verified as false alarms. |
| Data safety | ! Weak | 5 data attacks held (amounts, commission shares, Activity). Backup restore not drilled. |
| Structure | ! Weak | Fallow 87.5 (A); 7 unused exports and 76 overly complex functions, not reviewed with the owner. |
| Foundations | ✓ Strong | Lockfile, install, typecheck (9 s), tests (27 s), CI runs the tests, env vars documented. |

## Gaps the owner confirmed, for the portal

1. **Deal notes after losing Pipeline access (Q4, attack A1).** Someone still on a deal reads its notes on the prospect page after their role loses Pipeline View. The docs say notes follow Pipeline View. Owner: must not happen.
2. **Settings lockout by one Undo (Q5, attack A7).** An Undo of the Settings Delete row, sent with nothing held, removes the admin's own Settings View; the guard checks only Settings Edit. Owner: must never happen.
3. **Test admin reachable by Microsoft sign-in on staging (Q6, round 4 lead).** A Microsoft sign-in whose email matches an unlinked test account is linked to it and signed in, Dev Admin included. Owner: must not happen.

Not raised with the owner: the dependency upgrade (Next.js 16.4.1 or later), and a deployment created without a client id letting any member of the hosting tenant sign in (documented in the README).

## What the run found wrong with Imagineer

| Problem | Effect | Fixed in |
|---|---|---|
| Questions read like code review: file paths, function names, a "which files are critical" question | A non-technical user could not answer them | 0.9.0: plain language enforced, the point first, options that say what they mean, Not sure, product parts instead of files |
| Stryker installed into the copy's `node_modules` | npm dropped the project's test-runner binary; the dry run failed | 0.9.0: Stryker in its own tools folder |
| Eight full test suites at once, and timeouts counted as caught | 728 of 729 breaks timed out: a **false 100%**; a planted break passed the whole suite | 0.9.0: never Strong when most breaks time out; a quarter of the cores at a time; a time limit from the suite's own duration |
| Test files inside the `--mutate` scope | A test file was mutated | 0.9.0: tests always excluded |
| Attack and proof tests left in the copy | Every later measurement of the copy failed | 0.9.0: removed after each run |
| CI and env detection | False Foundations findings (`npx vitest` in CI, `.env.local.example`, platform variables) | 0.9.0 |
| Tests that need a database skipped silently | Test strength understated with no warning | This change: the summary says how many test files did not run |
| The self-check missed the timed-out run | "No signs that Imagineer went wrong" after a false 100% | This change: flagged as tool trouble |

## Cost and time

About 4.5 hours of wall time, most of it the first mutation run (143 minutes, invalid) and its corrected re-run (18 minutes). Four attacker rounds on Opus. The owner answered 4 questions and approved 2 more attack rounds.

## What this means for 1.0

The run shows Inspect finds real gaps a careful team missed (two of them contradicting the project's own docs), and that its grade can be trusted only after these fixes. Before calling Inspect validated, it needs: a run with the database the tests expect, so test strength matches CI; `lib/permissions.ts` measured (a faster test runner per mutant, such as Stryker's vitest runner, would make that practical); and a run where the owner launches `/imagineer:inspect` themselves.
