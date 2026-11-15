# Now

Imagineer today: `/imagineer:inspect`, `/imagineer:status` and `/imagineer:feedback`. Build is turned off from 0.4.0 until Inspect's foundations hold ([decisions.md](decisions.md), 2026-11-08). Design: [docs/proposals/inspect-and-build.md](../docs/proposals/inspect-and-build.md). Issues: GitHub Project #12. The B0 to B6 build plan, with its dated evidence, is in [archive/now-b0-to-b6.md](archive/now-b0-to-b6.md).

A step is done only with evidence: a test, a bench run or a real-project run, named here with its date.

## Release 0.4.0

- [x] Build turned off; a test strength check that could not run says so and is flagged; the version in the pane; README and changelog for users (branch `release/0.4.0`, 2026-11-08).
- [ ] Pull request merged into `main`, tagged `v0.4.0`.

## Safety

- [x] [#26](https://github.com/thuannguyen13/imagineer/issues/26): the attacker read the database URL from the project's local env file and attacked the user's own local database. Attacks must never reach a database the user did not set up for them. The attacker runs only `attack.mjs` (which also lists and searches the copy for it) and reads only the copy, its run folder and Imagineer's scripts; a proof or an attack starts a test runner with no shell, in the run's own copy, from a test file of its own, with every path in the copy, and is refused when its command or test names a database or the repository; env files run in the copy with their database settings pointed nowhere; a run where no test ran or failed is neither held nor a break, and its round is never clean (branch `fix/attacks-never-reach-real-database`, 2026-11-14: `attack.test.mjs`, `role-guard.test.mjs`, `lib.test.mjs`, `measure.test.mjs`, `prove.test.mjs`, and four `/code-review` rounds whose findings were each reproduced, fixed and checked again). Each round still found about ten things: these are checks on text, and text can always be written another way. Not shown yet: an attacker working this way in a real run. Not closed by this, and not closable by reading text: a test that builds a path to the repository as it runs, code that falls back to a database of its own when a setting is absent, or a database on this machine that asks for no sign-in, reached by host and port. All need the project's code run with the file system and the network closed.
- [ ] Attacks on a project whose tests need a database show as not attacked until Inspect starts its own throwaway database ([#32](https://github.com/thuannguyen13/imagineer/issues/32)). On the sales portal this is most attacks.
- [ ] [#27](https://github.com/thuannguyen13/imagineer/issues/27): the attacker stops at its turn limit mid-round, without a report.

## Foundations: read the project, measure the right code

- [ ] [#29](https://github.com/thuannguyen13/imagineer/issues/29): the structure scan records a layout (from tracked files: packages, source, tests, docs, agent files, scripts, CI) and every step plans from it; asks when it cannot tell; names parts outside the stack as not checked.
- [ ] [#28](https://github.com/thuannguyen13/imagineer/issues/28) part 2: test strength through Stryker's Vitest plugin (only the tests that cover each break), a scope sized to the time allowed and shown in the pane, and tests that fail only under the tool left out by name.
- [ ] Bench fixtures with layouts Imagineer has not seen: a monorepo, a Vue or Svelte app, an app in a subfolder, GitLab CI, `import.meta.env`.

## Validation

Imagineer is not marked validated until all of these hold:

- [ ] Test strength measured on the sales portal: a real number, on its business-rule code, in reasonable time.
- [ ] A run with the database the project's tests expect, so test strength matches CI (see [later.md](later.md#a-throwaway-database-for-tests-that-need-one)).
- [ ] A run the owner starts with `/imagineer:inspect` in their own project, from the released version.
- [ ] Inspect fully measures several projects with different layouts, with no layout assumptions left. This is also the condition for turning Build back on.

## Open

- [ ] Seen in an interactive session: the pane and band drawn in the Desktop app.
