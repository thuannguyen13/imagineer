# Imagineer: Inspect and Build

**Status:** direction set by the owner on 2026-11-05. What Inspect checks in each area set on 2026-11-06 ([What Inspect checks](#what-inspect-checks)); parts marked *Planned* are not built yet. Supersedes the three-skill entry points in [skillset.md](../archive/skillset.md): guard, forge and ground become parts of these two commands. The failure research in skillset.md §1 still applies.

## Purpose

**Mission:** help people who dream up software turn it into real work they can trust, even with little or no technical knowledge.

Imagineer makes AI-built software trustworthy without the user having to trust the AI. It does two things:

1. **`/inspect`** an existing repo until it is hard to break.
2. **`/build`** new work in a new or ongoing repo, to the same quality thresholds.

**Audience:** people with little or no technical knowledge, and the owner (technical). Used by the owner only, for now.
**Stack:** JavaScript and TypeScript web apps, in any layout and framework (see [Principles](#principles)).

- **Hosted backends are in scope.** Many apps built by prompting are a front end on Supabase or Firebase, where who may see or change what is set by the backend's own rules (Supabase row-level security policies in SQL, Firebase security rules), not by the app's code. Inspect checks and attacks those rules too, or Security and Data safety would grade the front end while the real permissions go unchecked. *Planned* ([Roadmap](#roadmap)).
- **What is not covered is said, never left out.** A part of the repository outside the stack, such as a Python back end beside a React front end, is reported as not checked, by name, in the pane and the report. The grade never reads as covering code Inspect did not look at.
- **Later, each with its own tools:** other languages (Python, Ruby, PHP, Go), added when real users bring those projects; mobile apps in JavaScript (React Native, Expo), whose attacks and checks need more than a server and a browser.

## How each part is started

The user types four commands. Everything else is internal.

| Part | Started by | How |
|---|---|---|
| Skills: `inspect`, `build`, `status`, `feedback` | The user | `/imagineer:inspect`, `/imagineer:build`, `/imagineer:status`, `/imagineer:feedback`. Inspect and Build set `disable-model-invocation: true`, so they run only when asked |
| Agents: `architect`, `dev`, `qa`, Inspect's researchers | The Lead | The skill tells the Lead when to spawn each one. The user sees their results, never calls them |
| The mod | Claude Code, at session start | Always on while the plugin is installed. It reacts to events and the user uses what it draws |

When a command runs, Claude Code fires a `command.run` event before the skill does anything. The mod uses it in two ways:

| Command | The mod | The skill reaches Claude |
|---|---|---|
| `/imagineer:status` | Answers it: opens the grade pane | No: no turn, no cost |
| `/imagineer:inspect`, `/imagineer:build` | Watches it: opens the pane and the band, then passes the command on | Yes |

## Principles

- **Evidence over claims.** A report written by an agent is not proof. Tests that are seen failing and then passing, tool results, and the user's answers are.
- **Separation of duties.** Whoever writes code does not write its tests, and whoever writes tests does not write code.
- **The user decides intent.** Agents never guess what the user meant when they can ask.
- **Read the project; never assume it.** Imagineer works on any project in its stacks, whatever its layout, framework, package manager or CI. Every run starts from a scan of the project's structure, and each later step plans from what the scan found, never from a fixed folder, file name or tool. Where the scan cannot tell, Imagineer asks the user once and keeps the answer for that project. A default is used only when it is shown to the user as a default (like the 80% thresholds); it is never applied silently. *Planned:* the scan records a layout and every step reads it ([#29](https://github.com/thuannguyen13/imagineer/issues/29)).
- **Leave no trace unless asked.** Inspect does not add files, dependencies or config to the user's repo, and never writes in its `.git`. Its own files live under `.claude/imagineer/`, kept out of git by a `.gitignore` inside that folder.
- **The project's code runs without the user's credentials.** Inspect and Build run the project's install, tests and attacks with only what tools need from the environment, so a test cannot reach a real database or service with the user's keys. Network access is not blocked: that would need a container, a heavier dependency than the risk calls for today.

## `/inspect`

**Goal:** keep trying to break the system, in every way Inspect knows, and turn what it finds into a grade that shows the owner where the codebase needs to improve. Along the way it asks the user what the app should do, until no question is left unresolved, because only the user can say whether a behaviour is a bug. The outcome is a stronger system with fewer hidden breaks, leaks and needlessly complex code, and a record of what the user wants that the next round, and Build, start from.

### Steps

1. **Research.** Scan the project's structure first: where its packages, source, tests, docs and agent instructions are, and which test runner, scripts and CI it uses. Every later step starts from that scan. Then read the docs and the code, and run the tools (below).
2. **Ask.** Turn every gap between what the code does and what it seems meant to do into a question for the user (format below).
3. **Attack.** Try to break the system: permissions, data integrity, double submits, partial saves, errors, inputs. Every break that gets through becomes a question for the user and, once confirmed, a test that fails until it is fixed.
4. **Repeat** from 2 until the finish thresholds are met.
5. **Report, then offer Build.** Inspect never changes the code. At the end it lists the holes worth fixing and offers to start `/imagineer:build` for the ones the user picks; Build fixes them on a branch, with a pull request the user reviews. *Planned.*

### Tools

| Tool | Finds |
|---|---|
| Fallow | Duplicate code, dead code, complexity, circular dependencies |
| Stryker | Mutation testing: code where a deliberate break is not caught by any test |
| `npm audit` | Known-vulnerable packages the app ships with |
| *Planned:* gitleaks | Secrets in the files and in the git history: API keys, tokens, private keys, passwords. A pinned release, downloaded once into Imagineer's tools folder outside the repo and checked against its checksum, like Stryker |
| *Planned:* fast-check | Property-based tests: many generated inputs, to prove an answer holds for every case, not a few picked ones |
| *Planned:* c8 (Node's own coverage) | Code no test runs at all, as a second number beside test strength |
| *Planned:* ESLint with sonarjs rules | A second opinion on cognitive complexity, from a throwaway config |
| *Planned:* a code-review agent | What tools cannot judge: abstractions nobody needs (YAGNI), unclear names, code hard for a person to follow |

**Detection.** During research, check whether the repo already uses each tool:

| Tool | Signs it is set up |
|---|---|
| Fallow | `fallow` in `package.json`; `.fallowrc.json(c)` or `fallow.toml`; a `fallow` script or CI step |
| Stryker | `@stryker-mutator/*` in `package.json`; `stryker.config.*` or `stryker.conf.*`; a `stryker` script or CI step |
| Similar | knip, jscpd, coverage settings in vitest or jest: used as extra evidence |

- **Set up:** use the repo's own version and config. Its config holds decisions already made (ignored files, entry points, thresholds).
- **Not set up:** run once without installing: `npx fallow`, and Stryker in a throwaway copy of the repo.
- **Stryker always runs in a throwaway copy**, because it writes a sandbox and reports where it runs.
- **Thresholds:** if the repo's are stricter than Inspect's thresholds, the stricter one wins. If looser, report both.
- **The report says which run it was**, for example "repo's Fallow 3.38 with its config" or "one-off Fallow 3.40, default settings".

Tool results need judgment. On the bench app, Fallow reports `public/app.js` as unused, but the HTML page loads it. Inspect checks a finding before acting on it, and asks the user when the code cannot settle it.

### What Inspect checks

One section per area of the grade. *Today* is what Inspect does in 0.3.0; *Planned* is decided but not built. Each planned part ships as its own release, in the order of the [roadmap](#roadmap).

**Test: would the tests notice if something broke?**

- *Today:* mutation testing with Stryker. Inspect plants small bugs in a throwaway copy (`>` becomes `>=`, a line is removed) and counts how many the tests catch. Coverage alone is not enough: a test can run every line and check nothing, which AI-written tests often do. Each user answer is proven by a test that must catch the planted bugs on the lines it is about.
- *Planned:* property-based tests (fast-check) when proving answers, so "an expense needs a description" is tested against every kind of blank, not only `""`. Coverage (c8) as a second number that explains a low score: code no test even runs. Stryker's incremental mode, so a later run re-tests only what changed (the sales portal's run took 18 minutes).

**Intention: does it do what the user meant?**

- *Today:* a big-picture interview of up to 5 questions, then a question for each finding that matters, asked blind: the user says what should happen before seeing what the app does, and only a difference becomes "fix it or keep it?". Answers are kept, proven by tests, used by the attacks, and saved as docs when the repo has none.
- *Planned:* **ask from more than one angle**, for answers about data, money and permissions, where a wrong guess costs most. The same intent is asked again later, from another side (another role, another example, the opposite case), to tell what the user really wants from an answer given in passing. Wording and general behaviour keep one question, so the user is not asked everything twice. Answers that disagree mark the intent as unclear: Inspect says so, asks once more, and writes no test on a guess until it is settled.
- *Planned:* **a scaffold for repos with no docs**, filled in layer by layer (see [When the repo has no docs](#when-the-repo-has-no-docs)). Each round fills the gaps the last one left, and the confirmed picture is the foundation the next round of inspection, and Build, start from.

**Security: can someone see or do what they shouldn't, or find what should stay secret?**

- *Today:* Fallow's possible weaknesses, checked in the code or asked about; `npm audit`; attacks on permissions (a role doing what it must not, refusals that exist only in the interface).
- *Planned:* **secret scanning**, of the files and of the git history, since a key deleted last month is still in the history and still leaked. With gitleaks, run from Imagineer's tools folder, so nothing is installed in the repo or asked of the user; if it cannot be downloaded, the secret scan shows as not checked, with the reason, rather than a weaker scan. Also what those tools miss: committed `.env` files, secret-looking values in variables shipped to the browser (`NEXT_PUBLIC_`, `VITE_`), tokens written to logs, real credentials in test fixtures. Whether exposed on purpose or by accident, a found secret never appears in the pane, since the pane may be on a shared screen: the Security area shows At risk, and its evidence says only that a secret was found and to see Inspect's report. The report gives the file, the line and the kind of key, never the secret itself. Until this exists, Security reaches Weak at best.

**Data safety: could the user lose or mix up their data?**

- *Today:* attacks on data (production and development data mixed up, a partial save after a failure, a double submit, a value stored that must not be), and the user's answers about data.
- *Planned:* migrations that destroy data or cannot be rolled back; several writes that should be one transaction; missing uniqueness or idempotency where a double submit is possible; input not validated where it enters the system; personal data that is stored, logged or never deleted. Backups and restores cannot be seen in the code, so they become a question for the user, and stay "claimed" until Imagineer can restore one in a throwaway copy.

**Code quality: is the code easy to change safely, and easy for a person to read?** (called Structure before 0.3.0)

- *Today:* Fallow as one tool among several: dead code (unused files and exports, part of YAGNI), duplication (DRY), complexity, and its health score. Each finding is reviewed with the user or settled from the docs.
- *Planned:* **readability as a main focus.** A code-review agent reads what tools cannot judge and explains each finding in plain words with a simpler shape: functions too long or too deeply nested, unclear names, clever code, abstractions with a single use, parameters never passed, options that never vary (the rest of YAGNI). ESLint's sonarjs rules give a second opinion on complexity. Inspect still changes no code: it reports, and the user, or Build, makes the change.

**Foundations: can someone else run and check it?**

- *Today:* lockfile, install, typecheck, tests, CI running the tests, documented environment variables.
- *Planned:* a lint setup that passes; the build succeeds; the Node version is pinned; unused and badly outdated dependencies; a README that says how to run the app; CI that also runs the typecheck and lint.

### Questions

Every question goes to the user in plain language, about people and features, never files or code.

**Asked blind.** Inspect never tells the user what they seem to want, or what the app does, before they answer. A reasonable sentence put in front of someone gets agreement, and the code it describes may be wrong. So a question about what the app already does (a **check**) describes a situation and asks what should happen. One of the outcomes offered is what the app does today, unmarked, in an order that does not give it away:

```
<the point: what should happen, in one sentence>

For example: a concrete situation with names and values

What should happen?
  ○ <outcome>    what it means for people or data
  ○ <outcome>    …
  ○ Not sure     explain it another way, with a new example
  ○ Other        type your own answer
```

If the user's answer is what the app does, it is confirmed, and proven with a test next. If not, it is a **gap**, and only then are they shown what happens today:

```
<the point>

You said: <their answer>
Today:    what happens now, as something a person sees

Fix it, or keep it as it is?
  ○ Fix it (recommended)   what they said
  ○ Keep it as it is       what the app does today
  ○ Not sure               leave it undecided; it stays listed as a gap
```

For example, from the sales portal:

```
What should happen to deal notes when someone loses pipeline access?

For example: Bo is on the Acme renewal. An admin moves Bo to a Marketing
role with no pipeline access. Bo opens Acme.

  ○ Bo keeps reading them       Anyone still on a deal reads its notes.
  ○ Bo can no longer read them  Notes follow pipeline access.
  ○ Not sure                    Explain it another way, with a new example.
```

Bo picks "can no longer read them"; the app lets Bo read them, so the next dialog says "Today: Bo still opens Acme and reads every note on the deal. Fix it, or keep it as it is?"

Where there is nothing to compare with (the big picture, or a design decision for something new), a **choice** offers suggestions, the recommended one first.

- **Plain language is enforced.** The question script refuses a question whose user-facing text holds a file name, a function call, a code name or a line number. Those go in the question's `detail`, which the grade pane shows engineers in a dim line above the dialog.
- **Ask about the product, not the code.** Which code is critical is asked as parts of the product a person knows (sign-in, roles, amounts); Inspect maps the answer to files itself.
- **The point comes first**: one sentence of at most 100 characters.
- **Every option says what it means** for the user's people or data. A check's outcomes are never marked as recommended or current; a choice's suggestions put the recommended one first.
- **Not sure is always offered.** It keeps the question open and asks again with a new example from another angle; after two, the question is deferred with that reason.
- **The script lays out every dialog the same way** (`questions.mjs ask`), so the format does not depend on the Lead's wording.
- Most consequential first: data, money, permissions, then behaviour, then wording; a few per round; nothing a test, doc or recorded decision already answers.
- *Planned:* **the same intent from more than one angle.** An answer about data, money or permissions is checked by a second question from another side, in a later round, never back to back. Agreement makes it settled; disagreement makes it unclear, and Inspect asks once more with both answers side by side before writing any test.
- Every confirmed answer becomes a test named after the question, so it is checked from then on.

### When the repo has no docs

Many repos built by prompting have no README, no CLAUDE.md and no docs. Then the user is the only source of intent, and the docs become something Inspect produces, not something it reads.

1. **Detect.** During research, classify the docs as none, thin (a README with setup only) or present. Report it under Foundations.
2. **Ask the big picture first.** Before any line-level question, a short interview of at most 5 questions, with suggestions drawn from the code: what the app is for, who uses it and in which roles, what is sensitive (money, personal data), and what must never happen. These answers rank every later question.
   *Planned:* a scaffold, filled in a layer per round, each layer asked only once the one above it is settled: what the app is for → who uses it, in which roles → what data it keeps and what is sensitive → the main flows, step by step → the rules (who may do what, what must never happen). The pane shows which layers are confirmed.
3. **Reconstruct from the code.** Agents draft what the app seems to do: features, roles and permissions, the data and its lifecycle, outside services. Every statement is marked *inferred from code* until the user confirms it.
4. **Never treat the code as intent.** Code written by prompting can be wrong, so documenting current behaviour as intended would bake in its bugs. Checks are asked blind for this reason: the user says what should happen before seeing what the code does.
5. **Save what was confirmed.** With the user's agreement, asked once, Inspect writes the confirmed answers as short, plain docs in the repo: what the app is for, roles and permissions, the data model, and decisions. It adds a pointer in CLAUDE.md so later AI sessions read them. Anything not confirmed stays marked as inferred.

The grade shows it: Matches your intent starts at ? Not checked, and Foundations is Weak until the docs exist. The docs Inspect writes are also what Build's Architect reads later.

### Finish thresholds

Inspect is finished when all of these hold. They are Imagineer's suggestion, not a standard, and the pane says so:

- Fallow reports no unresolved findings.
- Stryker catches at least **80%** of breaks in the inspected code (the bench app is at 33%). 80% is a starting point, not a standard ([what it rests on](../research/grading.md#21b-what-the-80-rests-on-2026-11-07)): the user can set their own per repository, in words or with `--tests` and `--critical`, kept in `.claude/imagineer/settings.json` for Inspect and Build. The pane then says "the thresholds you set".
- **2** attack rounds in a row find nothing new.
- In code the user confirms as critical (money, data, permissions), every surviving mutant is killed by a test or explained in a recorded answer.

### Roadmap

Each step is its own release, measured on the bench app before and after, and kept only if it finds at least as much at no more cost.

1. **Findings: one list, one shape, a status each** ([Findings](#findings-planned-approved-2026-11-07)). Every later step adds findings, so they share one place from the start.
2. **Secret scanning.** The biggest risk with no cover today, and the tools exist.
3. **Intent from more than one angle, and the no-docs scaffold.** What sets Imagineer apart from a scanner: it finds out what the user wants, not only what the code does.
4. **The readability review agent, and property-based tests in proofs.**
5. **The data safety and foundations additions.**
6. **Hosted backends.** Read Supabase's row-level security policies and Firebase's security rules, ask about them like any other permission, and attack them against a local copy of the backend (the Supabase CLI's local stack, the Firebase emulator), never the user's live project. The first scope extension, ahead of any other language. Its place among the steps above is the owner's call.

### Validation

Imagineer is not marked validated until all of these hold, each with dated evidence (a test, a bench run or a real-project run) in its issue or pull request:

- Test strength measured on the sales portal: a real number, on its business-rule code, in reasonable time ([#28](https://github.com/thuannguyen13/imagineer/issues/28)).
- A run with the database the project's tests expect, so test strength matches CI ([#32](https://github.com/thuannguyen13/imagineer/issues/32)).
- A run the owner starts with `/imagineer:inspect` in their own project, from the released version.
- Inspect fully measures several projects with different layouts, with no layout assumptions left ([#29](https://github.com/thuannguyen13/imagineer/issues/29)). This is also the condition for turning Build back on.
- The pane and band seen drawn in an interactive session in the Desktop app.

### Not planned

- A pipeline where one command must run before another.
- A full architecture review on each change.
- Copying each application's architecture into this repository.

## `/build`

**Status:** turned off from 0.4.0 (decided 2026-11-08). Build stands on Inspect: it reads the project through Inspect's scan, learns intent from Inspect's questions and proves "done" with Inspect's test strength check. Until the scan reads any layout ([#29](https://github.com/thuannguyen13/imagineer/issues/29)) and test strength measures the right code in reasonable time ([#28](https://github.com/thuannguyen13/imagineer/issues/28)), Build cannot prove its work on projects like the sales portal. Its command and agents are kept in `parked/build/`, not installed; its script stays, because Inspect's attacker uses its model choice. Build comes back when Inspect fully measures several projects with different layouts (the bench app, the sales portal, a Vue or Svelte app, a monorepo) with no layout assumptions left.

**Goal:** new or ongoing work that meets Inspect's thresholds from the start.

| Role | Does | Never |
|---|---|---|
| **Lead** (the main session) | Talks to the user, runs the pipeline, keeps the records | Writes code or tests |
| **Architect** | Reads the docs, the user's goal and the code. Designs ahead (data model, permissions, module boundaries) and specifies exact interfaces: names, routes, error codes | Asks Dev to build what is not needed yet |
| **Dev** (one or more) | Implements to the Architect's spec, following known practice (no duplication, reuse shared code). Runs QA's tests | Writes or edits tests |
| **QA** (one or more) | Writes tests from the Architect's spec, aiming to make Dev fail | Writes implementation code |

### Models

Claude only, for now. Each agent file sets its model with an alias (`opus`, `sonnet`), not an exact model ID, so agents move to new Claude releases without edits.

| Role | Model | Why |
|---|---|---|
| Lead | The user's session | It is the main session, so no agent file sets it |
| Architect | Opus | Its mistakes carry into every later step |
| Dev | Sonnet; Opus for changes to data, money or permissions | Follows an exact spec; cheaper and faster when several run at once |
| QA | Opus | The adversary: finding breaks takes the most reasoning |

- **Dev and QA use different models**, so they share fewer blind spots.
- **The report lists the model each agent used**, so runs can be compared on cost and quality.

**The user chooses.** Cost depends on the user's Claude plan, so the table above is the default, not a rule. On the first `/build`, the Lead asks once, in plain language:

```
Which mix of models should Build use? You can change this any time.
  1. Recommended: strongest models where mistakes cost the most (planning
     and testing), a faster one for coding. Medium cost.
  2. Budget: the faster model for every role. Lowest cost; the coder and
     the tester share more blind spots, so expect more misses.
  3. Maximum: the strongest model for every role. Highest cost and slowest.
  Other: type your own, for example "Opus for planning, Sonnet for the rest".
```

| Preset | Architect | Dev | QA |
|---|---|---|---|
| Recommended | Opus | Sonnet (Opus for data, money, permissions) | Opus |
| Budget | Sonnet | Sonnet | Sonnet |
| Maximum | Opus | Opus | Opus |

- The choice is saved **per user**, not per repo, because it follows the user's plan: a plugin user setting. A repo may suggest a preset, but the user's choice wins.
- The Lead passes the chosen model when it spawns each agent; the agent files keep the Recommended model as their default.
- If a chosen model is not available on the user's plan, the Lead uses the session's model for that role and says so in the report.

### Rules

- **Design ahead, build now.** The Architect shapes the parts that are expensive to change later, so future needs are easy to add; Dev builds only what is needed today.
- **QA works from the spec, not the code**, so its tests cannot mirror the implementation. This needs the Architect's interfaces to be exact.
- **Done** when QA's tests pass and the change meets Inspect's thresholds.
- **No docs to read.** The Architect needs the user's intent. When the repo has no docs, Build first runs Inspect's big-picture interview and saves the answers, then plans. For a brand-new repo, that interview is the first step, and the Architect writes its decisions into the docs as it goes.
- To keep the thresholds on every change, Build may offer to add the tools to the repo (dependency, config, CI check). Only with the user's agreement.

## Grade

The user needs to see at a glance how trustworthy the repo is, and how that changes as Inspect and Build work. Imagineer shows it with a [mod](https://code.claude.com/docs/en/plugins/mods/overview): JavaScript in the plugin that Claude Code runs in its own process and that can draw in the interface.

### The mod

- **A pane beside the transcript** with two tabs, each with its own job. **Overview**: how the project is doing, the verdict and one row per area that opens to its evidence, plus a line when questions wait. **Questions**: what Imagineer still needs from the user (gaps first), and the record of their answers and what came of each. Readable without technical knowledge.
- **A band above the prompt** with the one-line status while Inspect or Build runs, for example "Inspecting · round 2 · 3 questions waiting".
- **`/imagineer:status`** opens the pane at once, with no Claude turn and no usage spent. Mod command names cannot contain `:`, so the name comes from a small `status` skill in the plugin, and the mod answers that command before the skill reaches Claude (tested 2026-11-05: 0 turns, no cost). Where the mod cannot draw, such as a cloud session, it answers with the grade as text. If mods are turned off, the skill runs instead and reads the same results file.
- **Data from a file, not from the agents' words.** Inspect and Build write each tool result and answer to a results file in the run folder; the mod reads that file and redraws. The mod never computes or invents a grade itself.
- **Questions drawn properly.** A mod can restyle the dialog Claude asks questions in, so Imagineer's questions get their own calm line and the engineers' detail above the dialog, with the type-your-own field kept.
- **Read only.** The mod reads files and draws. It does not approve tool calls, run processes or call models, so what it does can be checked with `claude plugin validate` before installing.

**Where it shows.** Mods draw in the terminal, the Desktop app's Code tab and the VS Code extension (Claude Code 2.1.287 or later). They do not draw in cloud sessions or `claude -p`, so the same grade also goes into the final report and the pull request.

### The scale

Decided 2026-11-05 from the research in [docs/research/grading.md](../research/grading.md).

**Why not one number.** Fallow gives the bench app 81 (B), yet Stryker shows its tests catch 30% of deliberate breaks and dev-only sign-in has no test. A single score or letter reads as "fine".

**Six dimensions in two groups.**

| Group | Dimension | Plain question | Main evidence |
|---|---|---|---|
| Trust | Test strength | Would the tests notice if something broke? | Stryker kill rate; coverage beside it (planned) |
| Trust | Matches your intent | Does it do what you meant? | Questions resolved; each answer backed by a test seen failing, then passing |
| Trust | Security and permissions | Can someone see or do what they shouldn't, or find a secret? | Role × action tests, refusals checked on the server, known-vulnerable packages, secret scanning of files and history (planned) |
| Trust | Data safety | Could you lose or mix up your data? | Data attacks, prod and dev kept apart, safe migrations and transactions (planned), backups restored in a throwaway copy |
| Care | Code quality | Is the code easy to change safely, and easy to read? | Fallow, a readability review (planned) |
| Care | Foundations | Can someone else run and check it? | Lockfile, typecheck, CI runs the tests, README commands work, env vars documented |

**Four states**, each always shown with an icon, a word and a colour, so it reads without colour too:

| State | Meaning |
|---|---|
| ✓ Strong | Meets the threshold, with evidence |
| ! Weak | Below the threshold, or only claimed |
| ✕ At risk (`failing` in the results file; called Failing before 0.3.0) | A known break or gap that matters |
| ? Not checked | Not measured yet; shows the reason and the next step |

No headline number or letter. Numbers are one click down, for the owner.

**Overall: the weakest link, never an average.**

- Any trust dimension At risk makes the overall At risk.
- Any trust dimension Not checked makes the overall "Not proven yet"; it cannot be Strong.
- Code quality and Foundations can pull the overall down to Weak, never to At risk.

**Evidence rules.**

- A script computes every state from the evidence in the results file. Agents add evidence; they never set a state.
- A human claim that Imagineer did not re-run, such as a backup-restore log, shows as "Claimed" and is Weak at best, until Imagineer re-runs it in a throwaway copy.
- N/A is allowed only with a reason the user recorded.
- Each dimension shows how it was measured: ● the repo's own tool config, ◐ Imagineer's defaults, ○ not measured. It records the commit it measured and shows ⟳ stale once the code changes.
- Test strength uses Stryker. Fallow's own mutation command skips code that touches the database or files by default (82 of 139 mutants on the bench app, per the research), which is where data and permission bugs live.

**Critical code.** For code the user confirms as critical (money, data, permissions), every surviving mutant must be killed by a test or explained in a recorded answer. Elsewhere the threshold is the Stryker percentage in the finish thresholds.

**Bench app today: ✕ At risk.** Test strength ✕ (30.5%), Data safety ✕ (prod/dev split untested, restore only claimed), Security ! , Intent ?, Code quality ! (Fallow 81).

### Findings (planned; approved 2026-11-07)

Today each area carries a summary sentence and a few loose lines of evidence, written differently by each part of Inspect. Findings replace those lines with **one list of everything Inspect found**, each finding in one shape with a status, so the pane, the report, Build and the self-check all read the same thing, and nothing found is lost between them.

**What a finding is.** One problem, in plain words, grouped by behaviour rather than by line: twenty planted bugs that slip through the deal-scoping code are one finding, not twenty.

```json
{
  "id": "F7",
  "key": "untested:lib/deal-scope.ts",
  "area": "test-strength",
  "title": "Deal scoping can break without any test noticing",
  "impact": "A sales rep could start seeing another team's deals, and nothing would warn you.",
  "severity": "high",
  "status": "measured",
  "evidence": { "source": "Stryker 9.6.1", "detail": "20 of 40 breaks not caught, lines 12-48", "files": ["lib/deal-scope.ts"] },
  "question": "Q7",
  "test": null,
  "firstSeen": "3",
  "lastSeen": "5"
}
```

- `title` is what the pane shows: plain words, no code (the same rule questions follow). `impact` says what it means for the user's people, data or money. File names and tool output go in `evidence`, for engineers.
- `key` is the finding's identity across runs, the same keys Inspect already uses to dismiss findings, so a finding keeps its `id` from run to run.
- `area` is one of the six areas; a finding belongs to exactly one.

**Status: how sure Imagineer is, and whether it still matters.** One of these, and only `grade.mjs` sets it, from the evidence:

| Status | Means | Example |
|---|---|---|
| **Suspected** | A tool or agent flagged it; not verified yet | Fallow says a file is unused, but a web page may load it |
| **Measured** | A tool measured it directly | 20 planted bugs not caught; the typecheck fails; a package with a known vulnerability |
| **Confirmed** | Verified as a real problem: an attack broke through with a test that shows it, or the user said the app should behave differently and wants it fixed | "A sales rep opened another team's deal by its link" |
| **Proven safe** | A test now enforces the behaviour the user wants, seen failing and then passing | Q8 is proven: an expense needs a description |
| **Decided** | Settled as not a problem, by the user or the docs, with the reason kept | "The old import page is kept on purpose" |
| **Not checked** | Inspect did not reach it, and says why | "Not attacked yet: the admin settings page"; test strength skipped this time |

Suspected, measured and confirmed are **open**; proven safe and decided are **closed**. A finding that a later run on newer code no longer finds is **gone**, with the run it disappeared in. Missing evidence is never a pass: what was not measured is "not checked", never closed.

**Severity**, set by the same script, so the most consequential come first:

- **High:** in a trust area and touching data, money, permissions or code the user marked critical; any attack that broke through; any secret; a known vulnerability rated high or critical.
- **Medium:** any other trust-area finding.
- **Low:** code quality and foundations.

**Where they live.** `grade.mjs` writes them on every regrade into `results.json` as a new optional `findings` list (results format 1 stays readable), and keeps their history in `.claude/imagineer/findings.json` beside the question ledger, so ids, first and last seen, and gone findings last across runs. Each area keeps its state and number; its summary is written from its findings.

**Grouping.** By behaviour once a question is about a finding (its `about` keys), and by file until then, so planted bugs never arrive as one line each.

**Who reads them.**

- **The pane:** each area's row says how many open findings it has ("3 findings"); opening it lists the open ones, most severe first, each with its status word (✕ Confirmed, ! Measured, ? Suspected) and title, and counts the closed ones ("and 4 closed") rather than listing them.
- **The report:** confirmed problems first, then measured, then suspected, then what needs a decision, each with its impact and evidence; then what was not checked.
- **Build:** "report, then offer Build" offers to fix the open high and medium findings the user picks.
- **The self-check:** a finding closed as proven that an attack later breaks is the grade contradiction it already looks for.

**Secrets** follow the earlier decision: a secret is a finding like any other, but its title in the pane is only "A secret was found: see Inspect's report", and only the report names the file and the kind of key, never the secret.

## Improving Imagineer

Imagineer learns from its own runs, but never changes itself without review. Everything here is about Imagineer's own behaviour, never about the user's code.

### Health (proposed 2026-11-14)

*Proposed 2026-11-14; the owner approved starting the regression suite the same day ([decisions](../decisions.md)). The rest is proposed.* The parts below learn from a problem after someone reports it. Health asks the earlier question: is Imagineer itself still doing its job, before a release and over time? Research, evidence and a trial of Claude Code's own plugin test runner: [self-health.md](../research/self-health.md).

**Why.** So far the serious problems were found by the owner reading a run's log and by independent reviews, never by the self-check, the tests or the bench: attacks that ran against a real database ([#26](https://github.com/thuannguyen13/imagineer/issues/26)), a false 100% test strength, and about forty defects in the fix for #26 that its own tests passed. Imagineer's checks see only what Imagineer writes down about itself.

**What, in this order:**

1. **A regression suite for Inspect.** The bench, pointed at Inspect: small projects with one planted condition each (a clean one as the trap for false alarms, a permission hole, no tests, a tripwire env file, tests that skip without a database, another layout), run without a user before each release, each judged by a hidden check written as code that reads the run's results. A run that could not start is an error, never a result. It comes first: without it, neither the owner nor the improver below can show that a change is an improvement.
2. **Vitals from every run.** A small record beside the results: time per step, attacker rounds and turns, attacks held, broken, not run and set aside, refusals, how questions were answered. A scorecard across runs answers, weakest first: does it run, is it honest, is it useful, is it affordable?
3. **A wider self-check**, one flag for each failure already seen: every attack broke through; no attack ran; an agent ended without its report; nothing proven, or test strength not run, after several runs; most of an agent's turns refused.
4. **Review as a rule, with an end.** A change to anything that guards the user's data or files is reviewed by a reviewer that has not seen the work, before it merges; stop after two rounds in a row with no finding about ordinary behaviour. At each release, read a sample of real transcripts, note the first failure in each, and turn a new kind of failure into a flag or a scenario.

Claude Code's plugin test runner (`claude plugin eval`) started Inspect in a trial, but its sandbox has no working `git` and no network on the owner's machine, so it is not where the suite runs today. It may suit small checks later.

**Decided for the suite (2026-11-14):** it runs on the Recommended models, on the owner's machine, and a release waits for it; about $15 to $25 for the scenarios above, by the cost of real runs so far. **Still for the owner to decide:** whether vitals can be shared as feedback records are, by the user's own hand.

### Self-check

The mod watches each run and flags signs that Imagineer itself went wrong. It detects them from events and the results file, not from an agent's opinion:

| Kind | Detected when |
|---|---|
| Rule broken | Dev writes a test file, QA writes implementation code, or a review agent tries to commit or push |
| Stuck | The round limit is reached without progress, or the same finding is reopened twice |
| Tool trouble | Fallow or Stryker fails to run, or defaults were used although the repo has its own config |
| Grade contradiction | A dimension was Strong, then a later test in that area fails |
| Poor questions | The user types their own answer to more than half the questions in a round, or the same question comes back |
| Mod fault | A pane fails to draw, or a hook times out |
| Cost | A run costs more than twice the median of past runs on the same repo |

When something is flagged, the band says so in plain words between questions, never in the middle of one: "Imagineer may have gone wrong on its side: it asked you the same question twice. [Review and send] [Dismiss]".

### `/imagineer:feedback`

The user's way to tell Imagineer it got something wrong: a missed problem, a question not worth their time, a false alarm, or something that worked well. The end-of-run retro offers the same two questions: "Was anything asked that wasn't worth your time?" and "Did we miss anything you know about?".

Either way, the Lead writes a feedback record:

- the kind (from the table above, or miss, false alarm, praise) and the area (Inspect, Build, grade, mod)
- what Imagineer said or did, and what actually happened, as behaviour, never the user's code
- Imagineer's version, and a fingerprint (kind, area and rule) so repeats of the same problem can be grouped

Records go to a feedback log on the user's machine, outside their repo.

### Sharing

The user sees the full record and can edit or delete any of it. Then:

- **Report to Imagineer** opens a pre-filled GitHub issue on the Imagineer repository in their browser; they press Submit themselves. A mod's link holds about 2 KB, so the record is kept short.
- **Save as file**, for users without a GitHub account, or who cannot file issues on the repository (it is private, so only people the owner invites can).

No background upload, and nothing sent without the user seeing it.

*Planned (decided 2026-11-09, [#39](https://github.com/thuannguyen13/imagineer/issues/39)):* **send from inside Imagineer.** The repository is private, so a pre-filled issue only works for people the owner invites, and a saved file rarely reaches the owner. Instead:

- **One click to send.** The user sees the exact record, can edit it, and presses **Send**. That is the pane's Send button, or a confirmation in `/imagineer:feedback`. No GitHub account is needed.
- **A small relay** receives it and files it as an issue in this repository, with the `feedback` label and its fingerprint, so triage works as before. The relay only forwards what the user sent. It holds the repository key itself, so nothing secret ships in the plugin, and it limits how much one sender can file.
- **Private by default.** Feedback from attacks, or about permissions, data, money or secrets, can describe how a user's app can be broken. It only ever goes through this private channel. Records stay generic where they can: kind, area, rule and what Imagineer did.
- **Save as file** stays as the fallback when the relay cannot be reached.
- Open: how the pane's button sends while the mod stays read-only (a network call allowed to the mod for this one action, or handing the send to `feedback.mjs`); and where the relay runs.

*Planned:* **each flag as a card in the pane**, with one click for each next step:

- **Send:** shows exactly what goes (the flag, the run, Imagineer's version and the user's note), with the line "Never includes your code", and sends it with one click through the relay above.
- **Add a note:** a text box in the pane, "What happened, in your words?", sent with the report. The same draft can be started from the CLI with `/imagineer:feedback`.
- **Not a problem:** hides the flag, remembered in the mod's own storage, never in the user's project.
- **Try again:** where there is a clear next step, puts the command (such as `/imagineer:inspect`) in the prompt box, ready for Enter; the mod runs nothing itself.
- A flag says in plain words what went wrong and what it means for the user, counts repeats ("seen in 3 runs") instead of listing them, and shows "Reported Nov 7" once sent, so it is not raised again.
- **This was useful**, one click on a finished result, sends praise the same way; good results are evidence too.

### Triage and improvement (planned: automatic)

*Waits for the regression suite in [Health](#health-proposed-2026-11-14):* the improver proves a change on the bench, and the bench has one Inspect scenario today.

For the owner, in the Imagineer repository, not shipped in the plugin, so users never see it. It runs on its own as scheduled cloud agents (Claude Code routines), so it works while the owner's machine is off, and stops at two decisions that stay the owner's: which issues to act on, and which changes to merge.

```
Report ──▶ Issue ──▶ Triage agent ──▶ Owner: accept? ──▶ Improver agent ──▶ Branch with proof ──▶ Owner: merge
          labelled    daily summary     one reply          per issue         bench before/after     next release
```

1. **Intake (automatic).** A report from the pane, the CLI or the self-check becomes a GitHub issue carrying its fingerprint (kind, area, rule), so repeats are recognised.
2. **Triage (a scheduled agent, daily):**
   - **labels** each new issue: source (user or self-check), kind, area;
   - **groups** issues with the same fingerprint into one and counts them ("reported 4 times");
   - **reproduces** each on the bench app where it can, so a real problem is told apart from a false alarm or a one-off;
   - **ranks** them: misses and broken rules first, then false alarms, poor questions, cost;
   - **sends the owner one short summary**: "3 new: 1 real (the test strength estimate runs 20% low), 1 duplicate, 1 needs information".
3. **The owner decides.** One reply accepts, declines or asks for more ("accept 1", "accept all real"). Triage is automatic; what Imagineer should become is the owner's call.
4. **Improve (an agent per accepted issue):** plant the same kind of defect in the bench app (never anyone's code), add an oracle test that fails while it is present, change the skill, agent or script, and run the bench before and after. Keep the change only if it catches at least as much at no more cost; otherwise report why it was dropped.
5. **Review.** The result is a branch with its evidence: the reproduction, the bench before and after, and the diff. Following the owner's standing rule, the routine opens no pull request; it reports the branch ready, and the owner opens it or merges. Changes collect into the next release.

**Guardrails.**

- **Issue text is untrusted.** Anyone who can file an issue can write instructions into it. The triage and improver agents read issue text as data, never as orders.
- **What they may touch:** only the plugin and the bench app, on their own branches. Never `main`, CI, releases, settings or secrets.
- **Never in place:** Imagineer never edits its own skills or agents where they run; every change is a branch the owner reviews.
- **A cap per day**, for example 3 improvements, so a flood of issues cannot spend the owner's usage.
- **Every decision is logged**: why an issue was grouped, declined or accepted, and what the bench showed.

**Built in pieces:** flag cards with Send (intake); then the triage routine; then the improver.

## Versioning

### Why it matters now

Claude Code decides whether an installed plugin has an update from its version: the `version` in `plugin.json` first, then the marketplace entry's, then the git commit. `plugin.json` pins `0.1.0`, so anyone who installs Imagineer stays on that cached copy, however many commits are pushed, until the version string changes ([plugin loading reference](https://code.claude.com/docs/en/plugins/loading#versions-and-updates)).

### The plugin version

Semantic versioning in `plugin.json`, bumped in the pull request that changes what users get. The repo is new, so it stays at `0.y.z` until it is validated.

**Now: `0.y.z`.**

| Bump | When |
|---|---|
| `y` (0.**2**.0) | Something users must know about: a change to how Imagineer is used (a command, question or file format works differently, or something is removed), or a new command. Listed under **Changes you need to know** |
| `z` (0.2.**1**) | Everything else: fixes, wording, new checks and options, pane improvements |

At first every new check or option raised `y` and every merged pull request was released on its own, so the version reached 0.10.0 in two days. Those releases were folded into one baseline, `0.2.0` (2026-11-06), and the rules above apply from there, with releases batched (below).

- `v0.1.0` is the three-skill plugin as it is on `main` today: tagged once, as the baseline the bench compares against.
- `v0.2.0` is the baseline of the two-command design: Inspect, Build, the grade pane and Feedback, as validated by the first dry run (B6).

**From `1.0.0`**, after B6 validates Inspect and Build on a real project, the usual rules apply:

| Bump | When |
|---|---|
| MAJOR | A command, skill or agent is renamed or removed; the results file or grade can no longer be read the old way; the grade scale changes meaning |
| MINOR | A new command, dimension, check or option |
| PATCH | Fixes and wording |

### Releases

- `CHANGELOG.md` gets one entry per version, in plain language, with what changes for users and any breaking change first.
- Each release is a git tag `vX.Y.Z` and a GitHub release with the changelog entry. Users can pin a version with `/plugin marketplace add thuannguyen13/imagineer#vX.Y.Z`.
- **Releases are batched.** A pull request that changes anything under `plugin/` adds to the changelog entry of the next, untagged version; only the first one after a release bumps the version. The owner tags a release when a set of work is ready, not after every pull request.
- A check fails a pull request that changes anything under `plugin/` while the version is already tagged, or without a changelog entry for it.
- Releases are made by the owner, never by the plugin itself.

### What else carries a version

| What | Why |
|---|---|
| The results file (`schema` field) | The mod and `/imagineer:status` read old runs, or say the run must be redone |
| The grade (`scale` field, starting at 1) | A change to the scale does not look like the repo getting better or worse |
| Feedback records | Triage knows which release a report is about |
| Bench results | Before-and-after comparisons name the Imagineer version, the Claude Code version and the models |

The mod needs Claude Code 2.1.287 or later. It checks the running version and, on an older one, falls back to text replies and says why.

## Open

- Health for Imagineer itself: proposed in [Improving Imagineer](#health-proposed-2026-11-14), with four decisions for the owner.

- Who reviews Dev's code for design and duplication beyond Fallow. Proposed: the Architect reviews each round's diff against its own design, in a fresh spawn.
- What decides when Dev runs on Opus. Proposed: the Architect marks each task that touches data, money or permissions.
- How existing parts fold in. Proposed: forge's run folder, state file, finding IDs and reviewer hook into Build; ground's checklist and the Inspector idea into Inspect; guard's rules into Dev's practices. The old skills and agents were removed in 0.2.0; their text stays at tag `v0.1.0` for these phases to draw on.
- When Build brings review agents back, a mod `tool.call` hook could replace the Python settings hook forge used up to 0.1.0 (`forge-reviewer-guard.py`, run on every Bash call), and give a destructive-command guard proceed and cancel buttons. A mod loads in every session once the plugin is installed, so an opt-in guard needs its own switch.
