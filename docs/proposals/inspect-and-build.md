# Imagineer: Inspect and Build

**Status:** direction set by the owner on 2026-11-05. Supersedes the three-skill entry points in [skillset.md](skillset.md): guard, forge and ground become parts of these two commands. The failure research in skillset.md §1 still applies.

## Purpose

Imagineer makes AI-built software trustworthy without the user having to trust the AI. It does two things:

1. **`/inspect`** an existing repo until it is hard to break.
2. **`/build`** new work in a new or ongoing repo, to the same quality thresholds.

**Audience:** people with little or no technical knowledge, and the owner (technical). Used by the owner only, for now.
**Stack:** JavaScript and TypeScript first. Other stacks later, each with its own tools.

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
- **Leave no trace unless asked.** Inspect does not add files, dependencies or config to the user's repo.

## `/inspect`

**Goal:** research, review and re-validate with the user, asking until no question is left unresolved, and try to break the system until it cannot be broken any more. The outcome is a stronger system with less duplicate, dead and needlessly complex code.

### Steps

1. **Research.** Read the docs and the code. At the same time, run the tools (below).
2. **Ask.** Turn every gap between what the code does and what it seems meant to do into a question for the user (format below).
3. **Attack.** Try to break the system: permissions, data integrity, double submits, partial saves, errors, inputs. Every break that gets through becomes a test; every "that's not what I meant" becomes a fix.
4. **Repeat** from 2 until the finish thresholds are met.

### Tools

| Tool | Finds |
|---|---|
| Fallow | Duplicate code, dead code, complexity, circular dependencies |
| Stryker | Mutation testing: code where a deliberate break is not caught by any test |

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

### Questions

Every question goes to the user in plain language, about people and features, never files or code.

```
<the point, in one sentence>

You'd expect: what the user seems to want
Today:        what happens now, as something a person sees
For example:  a concrete case with names and values

What should happen?
  ○ <suggestion>   what choosing it means for people or data
  ○ <suggestion>   …
  ○ Not sure       explain it another way, with a new example
  ○ Other          type your own answer
```

For example, from the sales portal:

```
Someone who loses access to the pipeline can still read its deal notes.

You'd expect: Only people who can open a deal read the notes written on it.
Today:        A person still listed on a deal keeps reading its notes after
              their role loses the pipeline.
For example:  Bo is on the Acme renewal. An admin moves Bo to a Marketing role
              with no pipeline access. Bo opens Acme and reads every note.

  ○ Must not happen   Bo stops seeing the deal's notes when the role changes.
  ○ Fine as it is     Anyone still listed on a deal keeps reading its notes.
  ○ Not sure          Explain it another way, with a new example.
```

- **Plain language is enforced.** The question script refuses a question whose user-facing text holds a file name, a function call, a code name or a line number. Those go in the question's `detail`, which the grade pane shows engineers in a dim line above the dialog.
- **Ask about the product, not the code.** Which code is critical is asked as parts of the product a person knows (sign-in, roles, amounts); Inspect maps the answer to files itself.
- **The point comes first**: one sentence of at most 100 characters.
- **Every suggestion says what it means** for the user's people or data, the recommended one first.
- **Not sure is always offered.** It keeps the question open and asks again with a new example from another angle; after two, the question is deferred with that reason.
- **The script lays out every dialog the same way** (`questions.mjs ask`), so the format does not depend on the Lead's wording.
- Most consequential first: data, money, permissions, then behaviour, then wording; a few per round; nothing a test, doc or recorded decision already answers.
- Every confirmed answer becomes a test named after the question, so it is checked from then on.

### When the repo has no docs

Many repos built by prompting have no README, no CLAUDE.md and no docs. Then the user is the only source of intent, and the docs become something Inspect produces, not something it reads.

1. **Detect.** During research, classify the docs as none, thin (a README with setup only) or present. Report it under Foundations.
2. **Ask the big picture first.** Before any line-level question, a short interview of at most 5 questions, with suggestions drawn from the code: what the app is for, who uses it and in which roles, what is sensitive (money, personal data), and what must never happen. These answers rank every later question.
3. **Reconstruct from the code.** Agents draft what the app seems to do: features, roles and permissions, the data and its lifecycle, outside services. Every statement is marked *inferred from code* until the user confirms it.
4. **Never treat the code as intent.** Code written by prompting can be wrong, so documenting current behaviour as intended would bake in its bugs. Without docs, the YOUR EXPECTATION line says it is a guess: "My guess (no docs found): …".
5. **Save what was confirmed.** With the user's agreement, asked once, Inspect writes the confirmed answers as short, plain docs in the repo: what the app is for, roles and permissions, the data model, and decisions. It adds a pointer in CLAUDE.md so later AI sessions read them. Anything not confirmed stays marked as inferred.

The grade shows it: Matches your intent starts at ? Not checked, and Foundations is Weak until the docs exist. The docs Inspect writes are also what Build's Architect reads later.

### Finish thresholds

Inspect is finished when all of these hold. They are Imagineer's suggestion, not a standard, and the pane says so:

- Fallow reports no unresolved findings.
- Stryker catches at least **80%** of breaks in the inspected code (the bench app is at 30%).
- **2** attack rounds in a row find nothing new.
- In code the user confirms as critical (money, data, permissions), every surviving mutant is killed by a test or explained in a recorded answer.

## `/build`

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

- **A pane beside the transcript** with tabs: the overall grade first, then each dimension, then open questions. Readable without technical knowledge; the owner opens a dimension for its evidence.
- **A band above the prompt** with the one-line status while Inspect or Build runs, for example "Inspecting · round 2 · 3 questions waiting".
- **`/imagineer:status`** opens the pane at once, with no Claude turn and no usage spent. Mod command names cannot contain `:`, so the name comes from a small `status` skill in the plugin, and the mod answers that command before the skill reaches Claude (tested 2026-11-05: 0 turns, no cost). Where the mod cannot draw, such as a cloud session, it answers with the grade as text. If mods are turned off, the skill runs instead and reads the same results file.
- **Data from a file, not from the agents' words.** Inspect and Build write each tool result and answer to a results file in the run folder; the mod reads that file and redraws. The mod never computes or invents a grade itself.
- **Questions drawn properly.** A mod can restyle the dialog Claude asks questions in, so the YOUR EXPECTATION / ACTUAL IMPLEMENTATION / EXAMPLE / SUGGESTIONS format can be laid out clearly, with the type-your-own field kept.
- **Read only.** The mod reads files and draws. It does not approve tool calls, run processes or call models, so what it does can be checked with `claude plugin validate` before installing.

**Where it shows.** Mods draw in the terminal, the Desktop app's Code tab and the VS Code extension (Claude Code 2.1.287 or later). They do not draw in cloud sessions or `claude -p`, so the same grade also goes into the final report and the pull request.

### The scale

Decided 2026-11-05 from the research in [docs/research/grading.md](../research/grading.md).

**Why not one number.** Fallow gives the bench app 81 (B), yet Stryker shows its tests catch 30% of deliberate breaks and dev-only sign-in has no test. A single score or letter reads as "fine".

**Six dimensions in two groups.**

| Group | Dimension | Plain question | Main evidence |
|---|---|---|---|
| Trust | Test strength | Would the tests notice if something broke? | Stryker kill rate |
| Trust | Matches your intent | Does it do what you meant? | Questions resolved; each answer backed by a test seen failing, then passing |
| Trust | Security and permissions | Can someone see or do what they shouldn't? | Role × action tests, refusals checked on the server |
| Trust | Data safety | Could you lose or mix up your data? | Prod and dev kept apart, backups restored in a throwaway copy |
| Care | Structure | Is the code tidy enough to change safely? | Fallow |
| Care | Foundations | Can someone else run and check it? | Lockfile, typecheck, CI runs the tests, README commands work, env vars documented |

**Four states**, each always shown with an icon, a word and a colour, so it reads without colour too:

| State | Meaning |
|---|---|
| ✓ Strong | Meets the threshold, with evidence |
| ! Weak | Below the threshold, or only claimed |
| ✕ Failing | A known break or gap that matters |
| ? Not checked | Not measured yet; shows the reason and the next step |

No headline number or letter. Numbers are one click down, for the owner.

**Overall: the weakest link, never an average.**

- Any trust dimension Failing makes the overall Failing.
- Any trust dimension Not checked makes the overall "Not proven yet"; it cannot be Strong.
- Structure and Foundations can pull the overall down to Weak, never to Failing.

**Evidence rules.**

- A script computes every state from the evidence in the results file. Agents add evidence; they never set a state.
- A human claim that Imagineer did not re-run, such as a backup-restore log, shows as "Claimed" and is Weak at best, until Imagineer re-runs it in a throwaway copy.
- N/A is allowed only with a reason the user recorded.
- Each dimension shows how it was measured: ● the repo's own tool config, ◐ Imagineer's defaults, ○ not measured. It records the commit it measured and shows ⟳ stale once the code changes.
- Test strength uses Stryker. Fallow's own mutation command skips code that touches the database or files by default (82 of 139 mutants on the bench app, per the research), which is where data and permission bugs live.

**Critical code.** For code the user confirms as critical (money, data, permissions), every surviving mutant must be killed by a test or explained in a recorded answer. Elsewhere the threshold is the Stryker percentage in the finish thresholds.

**Bench app today: ✕ Failing.** Test strength ✕ (30.5%), Data safety ✕ (prod/dev split untested, restore only claimed), Security ! , Intent ?, Structure ! (Fallow 81).

## Improving Imagineer

Imagineer learns from its own runs, but never changes itself without review. Everything here is about Imagineer's own behaviour, never about the user's code.

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
- **Save as file**, for users without a GitHub account.

No server, no background upload, nothing sent without the user seeing it.

### Triage

For the owner, in the Imagineer repository, not shipped in the plugin, so users never see it:

1. **Label** each issue: source (user or self-check), kind, area.
2. **Group** issues with the same fingerprint into one, and count them.
3. **Rank** by kind and count: misses and broken rules first, then false alarms, poor questions, cost.
4. **Decide**: duplicate, needs more information, or accepted.
5. **Learn** from an accepted issue: plant the same kind of defect in the bench app (never the user's code), add an oracle test that fails while it is present, change the skill or agent, and compare bench results before and after. Keep the change only if it catches at least as much at no more cost.

Triage runs on request or on a schedule. The plugin never edits its own skills or agents in place; every change is a pull request the owner reviews.

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

- Who reviews Dev's code for design and duplication beyond Fallow. Proposed: the Architect reviews each round's diff against its own design, in a fresh spawn.
- What decides when Dev runs on Opus. Proposed: the Architect marks each task that touches data, money or permissions.
- How existing parts fold in. Proposed: forge's run folder, state file, finding IDs and reviewer hook into Build; ground's checklist and the Inspector idea into Inspect; guard's rules into Dev's practices. The old skills and agents were removed in 0.2.0; their text stays at tag `v0.1.0` for these phases to draw on.
- When Build brings review agents back, a mod `tool.call` hook could replace the Python settings hook forge used up to 0.1.0 (`forge-reviewer-guard.py`, run on every Bash call), and give a destructive-command guard proceed and cancel buttons. A mod loads in every session once the plugin is installed, so an opt-in guard needs its own switch.
- Re-plan `plan/now.md` around these two commands; the bench stays the way each command is proven.
