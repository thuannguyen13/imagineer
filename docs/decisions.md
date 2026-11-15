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

Guard is the base: it owns risk tiers and single-change rules, and forge and ground use them, so guard is installed with either. Skills never call each other; they hand off through project docs that people also read. Each concern has one owner; both lists are in `docs/archive/skillset.md` §4.

## 2026-10-28 — Names

Feature-review-loop becomes **forge**; the planned Forge job (reuse existing code) is already guard's "Before code". **Pact** is retired: it clashes with the Pact contract-testing tool, and its planned job becomes forge's verification reference. **Ground** is the new product-wide skill. One-word names, no clash with Claude Code built-ins such as `/verify`.

## 2026-10-28 — One owner for verify, fix, repeat

Forge owns the loop, for features it builds and, with `--verify <branch|PR>`, for existing code. A separate loop skill would either duplicate the loop inside forge or split forge into two commands with a handoff. Ground fixes only the checklist items the user approves and re-checks those items. Routine changes stay single-pass; a Stop hook that ground installs keeps sessions from finishing with failing checks.

## 2026-10-28 — Two audiences

Write for people who build by prompting and for engineers equally. The wording rules are the design principles in CONTRIBUTING.md.

## 2026-10-28 — Validated status

A skill is either **in use**, **validated**, or **planned**. It is marked validated only after it passes its seeded-defect scenarios on the bench fixture app and one run on a real project. Reviewer agreement and drafted text are not evidence. Guard and feature-review-loop stay in use, not validated, until then.

## 2026-10-28 — Clean bar

Every phase of skill work ends with these checks before its pull request:

- Each rule has one owner; other files link to it.
- No instruction text for what a hook, agent limit or test already enforces.
- No contradictions, checked by a reviewer that has not seen the work.
- Each section stays only if removing it changes a scenario result.
- The same words for the same thing.
- User-facing text follows the design principles in CONTRIBUTING.md.
- Code also passes typecheck, lint, tests, `/simplify` and `/code-review`; hook scripts have tests that they block a seeded command and allow a harmless one.

The pull request lists what was removed and the bench results before and after.

## 2026-11-03 — Plugin packaging, with forge's roles as agents

Package the repository as one Claude Code plugin, after a proposed "PO, Architect, Dev, QA" pipeline plugin. Its useful parts map onto what exists: PO is forge's orchestrator, Architect is `forge-scout` and `forge-plan-reviewer`, Dev is `forge-implementer` (preloads guard), QA is reviewers a–d and `forge-validator`. Role limits move from prose into agent frontmatter (`model`, `tools`, `maxTurns`, `isolation`), and the reviewer rule against commits, pushes and GitHub calls becomes a plugin hook keyed on `agent_type`, which works even though plugin agents ignore their own `hooks`. Supersedes "No plugin yet" in `docs/archive/skillset.md` §5.

Not adopted from that proposal: routing every change through the pipeline, and a lead that never edits code (routine work stays with guard, and no skill must run before another); `PROJECT_CONTEXT.md` (ground's project docs already hold it); `commands/` (skills supersede them); a handoff log hook (forge's `state.json` already records each spawn and round). Ground's hooks stay opt-in per project rather than plugin hooks, because they change what every session may do.

## 2026-11-05 — Two commands: Inspect and Build

Supersedes "Three skills, split by scope" and the forge redesign entries of 2026-11-03 as the plugin's entry points. The owner could not tell where to start with three skills and many agents. Imagineer now has two jobs, each one command: `/imagineer:inspect` makes an existing repo hard to break, and `/imagineer:build` builds new work to the same bar. A third command, `/imagineer:status`, shows the grade. Design: [docs/proposals/inspect-and-build.md](proposals/inspect-and-build.md).

Decided by the owner: the audience includes people with little or no technical knowledge, so every question goes to the user in plain language with suggestions and a type-your-own option; the Architect designs ahead but Dev builds only what is needed now; Inspect stops at a measured bar; JS/TS first; agent models are a per-user choice with a recommended default (Architect and QA on Opus, Dev on Sonnet); the grade is shown in a mod. Guard, forge and ground stop being entry points; their useful parts move into the two commands. The unmerged four-agent forge pipeline (`claude/serene-carson-pihsu8`) is input to Build, not merged as is.

## 2026-11-05 — Old skills removed before their replacements

The owner found guard, forge and ground still shipping after the move to Inspect and Build, and chose to remove them in 0.2.0 rather than at B5. The plugin then shows only the new design, at the cost of no working forge until Build exists. Their text stays at tag `v0.1.0`, which users can still install and which the bench prepares by default, so the baseline is unchanged.

## 2026-11-05 — Stop bar, license, first real project

The owner confirmed Inspect's stop bar at the proposed numbers: Stryker catches 80% of breaks in the inspected code, and 2 attack rounds in a row find nothing new. No license: the plugin stays private, for the owner, and the question returns before any plugin directory submission. B6's first real project is the owner's sales portal, as a dry run scoped to one feature.

## 2026-11-06 — The thresholds are Imagineer's suggestion

The owner asked whether Imagineer should list findings without judging them against its own numbers, since 80% is not a standard and Imagineer is not yet validated. Weighed against that: users without technical knowledge cannot read a raw number, and Inspect and Build need a point at which they stop. The owner chose to keep the thresholds, labelled everywhere as Imagineer's suggestion ("By the thresholds Imagineer suggests…"), not as a standard, and to call them thresholds rather than a "bar", which read as unclear. Thresholds the user sets per repository remain a candidate if the suggestion does not fit their projects.

## 2026-11-06 — Slower versions, and 0.2.0 as the baseline

The owner found the version moved too fast: 0.2.0 to 0.10.0 in two days, because every new check or option raised the middle number and every merged pull request was released on its own. Since only the owner uses Imagineer, the owner chose to fold everything since 0.1.0 into one baseline, 0.2.0: the GitHub releases and tags v0.2.0 to v0.8.0 were deleted (the commits stay), the changelog has one 0.2.0 entry, and v0.2.0 is tagged again on the merge that made it. v0.1.0 stays, since the bench compares against it and it is how the earlier skills are pinned. From now on the middle number goes up only for something users must know about (a change to how Imagineer is used, or a new command); everything else is a patch. Pull requests add to the next untagged version, and the owner releases a batch when it is ready.

## 2026-11-06 — Questions asked blind

The owner found the question format led the user: showing "You'd expect" (Inspect's guess) and "Today" (the code) before the answer invites agreement, and leaves a non-engineer to spot the difference between two similar sentences. An empty box asking for their expectation first was weighed and set aside: typing an expectation from scratch is hard without technical knowledge, and vague answers cannot be proven by a test. Chosen: predict, then reveal. A check describes a situation and offers possible outcomes, one of them what the app does today, unmarked and in an order that does not give it away. A match is confirmed in one step; a difference becomes a gap, and only then is today's behaviour shown, with "Fix it" or "Keep it as it is". The big picture and design decisions, where there is nothing to compare with, stay choices with a recommended suggestion. Released as 0.3.0, since the question format and how answers are recorded change.

## 2026-11-06 — What Inspect checks, per area

The owner restated Inspect's goal: keep trying to break the system and turn what it finds into a grade that shows where the codebase needs to improve, for people who dream up software with little technical knowledge. The design doc's "What Inspect checks" section now says, per area, what Inspect does today and what is planned, with a roadmap: secret scanning; intent asked from more than one angle and a scaffold for repos with no docs; a readability review agent and property-based tests in proofs; then data safety and foundations additions. Three choices settled:

- **Secret scanning uses gitleaks**, which also searches the git history, where a deleted key still leaks. No weaker fallback: a pinned release is downloaded into Imagineer's tools folder (outside the repo, checksum checked, as Stryker is installed), and if that fails the scan shows as not checked with the reason.
- **Structure is renamed Code quality**, since readability becomes a main focus. The area's id stays `structure`, so earlier results still load.
- **A second angle only for answers about data, money and permissions**, where a wrong guess costs most; other answers keep one question, so the user is not asked everything twice.

## 2026-11-06 — The owner's intention check

Inspect's own method was run on the owner: blind questions about what Imagineer should do, then each again from a second angle. Settled:

- **Fixing:** Inspect reports, then offers to start Build for the holes the user picks; Build fixes them on a branch with a pull request. The owner's first two answers disagreed (fix on a branch; report only), and asking once more with both side by side gave this third answer. That disagreement is the case the second angle exists for.
- **Finish line:** 80% of planted bugs caught holds for every app, asked twice (once for a small personal tool). Thresholds set per repository are not wanted for now.
- **Secrets:** nothing about a found secret in the pane, which may be on a shared screen. Security shows At risk, its evidence points to Inspect's report, and only the report says where and what kind, never the secret.
- **File names:** visible but secondary, in a dim line for whoever helps the user. Matches the design.

## 2026-11-07 — 80% stays, but it is the user's to change

The owner found the 80% test-strength threshold lacked a good backing reason. Research found no standard: real projects range from about 12% to 95%, studies avoid fixed cutoffs, and practitioner convention is 60–70% as a general gate and about 80% for critical code (docs/research/grading.md, 2.1b). The owner kept 80% for all code and for critical code, to see how real projects measure against it before adjusting, and asked for it to be adjustable: per repository, in words or with `--tests` and `--critical`, kept in `.claude/imagineer/settings.json`, used by Inspect and Build, and named "the thresholds you set" wherever they show. This replaces the intention check's "80% for every app": asked again with the research in hand, the owner wanted it adjustable.

## 2026-11-07 — Findings approved

The owner approved the Findings design as proposed: one list of everything Inspect found, each with a status (suspected, measured, confirmed, proven safe, decided, not checked) and a severity, set only by `grade.mjs`. The pane lists open findings and counts closed ones; findings group by behaviour once a question is about them, by file until then. Findings come first on the roadmap, ahead of secret scanning, so every later check adds to one list. The remaining mentions of the Structure area are now Code quality.

## 2026-11-07 — Read the project; never assume it

Inspect run 3 on the sales portal measured test strength on 26 helper files in `lib/` and none of `features/` or `app/`, because Stryker fell back to its own default folders (#28). A sweep of Inspect and Build then found 17 more places that act on a fixed folder, file name or tool instead of on what the project has: the file walk, a single `package.json` at the root, source and test file patterns, env access, CI, script names, package managers, the audit, the docs location and Build's role guard (#29). They held only because Imagineer had been tried on two repositories with the same layout. The owner set the principle: Imagineer must work on any project in its stacks, so every run starts from a structure scan that the later steps plan from. Discussed and refined: defaults cannot be avoided entirely, so the rule is that none is applied silently. Imagineer reads the project, asks once when it cannot tell, and shows any default as a default. Supporting stacks beyond JavaScript and TypeScript stays a roadmap decision.

## 2026-11-07 — Scope: JavaScript and TypeScript web, hosted backends included

The owner confirmed the scope as JavaScript and TypeScript web apps and asked whether that covers enough. It covers the stack most apps built by prompting use, but permissions in those apps often live in a hosted backend (Supabase row-level security, Firebase security rules), where Inspect would grade the front end and miss the real rules. The owner added hosted backends to the scope, as the first extension ahead of any other language, attacked only against a local copy of the backend. Any part of a repository outside the stack is reported as not checked, by name, so the grade never reads as covering it. Other languages and JavaScript mobile apps stay for later.

## 2026-11-08 — Build turned off until Inspect's foundations hold

The owner asked whether shipping Build was premature, since Inspect cannot yet learn enough about a repository for an agent to build on it. Build's done check depends on Inspect's test strength check: on the sales portal that check cannot run, so every Build round would end "mutation testing skipped" until the round limit, and each round would run the whole test suite per planted bug. Build also carries its own layout assumptions (#29). The owner turned Build off for 0.4.0 rather than gating it. Its command and agents are parked in `parked/build/`, outside the plugin; `build.mjs` stays because Inspect's attacker uses its model choice. Build returns when Inspect fully measures several projects with different layouts with no layout assumptions left (#28 part 2, #29).

## 2026-11-09 — Feedback is sent from inside Imagineer

Feedback only reached the owner from people invited to the private repository; everyone else could only save a file, which rarely arrives (#39). Making the repository public was weighed and rejected: it does nothing for people without a GitHub account, publishes the history (including a real project's security gaps), and would make every feedback issue public, although feedback from attacks can describe how a user's app can be broken. Claude Code's split (an in-product command, a public issues repository, a private security channel) was the precedent. The owner chose in-product sending: the user sees the record and sends it with one click, from the pane's Send button or from `/imagineer:feedback`, through a small relay that files it as a labelled issue. This replaces "No server" with "No background upload; a relay only forwards what the user sent". Sensitive feedback only goes through this private channel. Open: how the pane's button sends while the mod stays read-only, and where the relay runs.

## 2026-11-14 — Health checks for Imagineer itself

The owner asked whether Imagineer has a proper way to check its own health and improve. It had a loop for learning from reported problems, a third of it built, and nothing that says before a release whether Imagineer still does its job: the serious problems so far were found by the owner reading logs and by independent reviews ([research](research/self-health.md)). The owner approved starting the regression suite for Inspect on the bench, with the first two scenarios, the clean project and the tripwire env file (`bench/inspect.mjs`; the rest are listed in the design doc, [Health](proposals/inspect-and-build.md#health-proposed-2026-11-14), and tracked on the board). Settled: the suite runs on the Recommended models, on the owner's machine, and a release waits for it. Claude Code's own plugin test runner was tried and set aside for the suite: its sandbox has no working git and no network on the owner's machine. Still open: whether a run's vitals can be shared as feedback records are.
