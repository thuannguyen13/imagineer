> Research brief written by a Claude research agent on 2026-11-14 for the proposed "Health" part of [Improving Imagineer](../proposals/inspect-and-build.md#improving-imagineer). Claims about external systems link their sources; `[inferred]` marks the agent's own reasoning. The owner's decisions are recorded in the design doc, not here.

# Is Imagineer itself working? Research brief on self-health

Prepared 2026-11-14. The owner asked whether Imagineer has a proper plan to check its own health and improve, and for research if not.

Labels used below:
- **[cited]**: the claim comes from the linked source.
- **[observed]**: I ran it, or read it in this repository's files or in the run folders Inspect left in the owner's projects.
- **[inferred]**: my own reasoning or recommendation, not from a source.

---

## 0. The answer in one page

**Partly.** Imagineer has a designed loop for learning from problems *after* they are reported: a self-check, `/imagineer:feedback`, triage, and an "improver" that proves each change on the bench. A third of it is built. It has **no health check**: nothing that says, before a release or over time, whether Imagineer itself still does its job.

What the evidence says (section 2):

1. The serious problems so far were found by the owner reading a run's log and by independent reviews, never by the self-check, the tests or the bench.
2. The bench cannot say whether a change made Inspect better: it has one Inspect scenario, run once.
3. Nobody knows what a run costs or how long it takes without digging through transcripts.

What I recommend (section 5), in this order:

1. **A regression suite for Inspect**: the existing bench, pointed at Inspect, run before each release, with hidden checks written as code. It comes first: without it neither the owner nor the planned improver can show a change is an improvement.
2. **Vitals written by every run**, and a scorecard across runs.
3. **A wider self-check**, built from the failures already seen.
4. **Review as a rule, with a stopping point**, and a reading of real transcripts at each release.

Claude Code's built-in plugin test runner is **not** the place for the regression suite today: in a trial it started Inspect, but its sandbox has no working `git` and no network on the owner's machine, so Inspect measured nothing (section 4). It fits small, cheap checks later.

---

## 1. What exists today

| Part | State | Where |
|---|---|---|
| Self-check after a run: role refusals, tools that failed, a proof an attack broke, poor questions, a stuck Build | Built | `plugin/skills/feedback/scripts/feedback.mjs` (`selfCheck`) |
| `/imagineer:feedback`, the retro's two questions, a pre-filled GitHub issue or a file | Built | `plugin/skills/feedback/` |
| Triage of feedback issues, by hand | Built, for the maintainer only | `.claude/skills/triage-feedback/` |
| Flag cards in the pane, scheduled triage, the improver, a cost flag, a mod-fault flag | Designed, not built | design doc, "Triage and improvement" |
| The bench: seeded defects with hidden oracle tests | Built for the retired skills | `bench/`: 17 of 18 scenarios test guard, forge and ground; Inspect has `L1`, one run before and one after |
| Unit tests of the scripts and the role guard | Built, run in CI | `plugin/**/*.test.mjs` |
| A test of what a real Inspect run does | None | |
| A record of time, cost, turns or refusals per run | None | |

All [observed].

---

## 2. What went wrong that nothing caught

| What happened | How it was found | What should have caught it |
|---|---|---|
| The attacker ran attacks against the owner's real local database ([#26](https://github.com/thuannguyen13/imagineer/issues/26)) | The Lead read an earlier run's attack log; the self-check had reported no signs of trouble | A regression scenario with a tripwire env file; a self-check flag |
| Test strength read 100% when 728 of 729 breaks had timed out ([dry run](../validation/2026-11-06-sales-portal-dry-run.md)) | By hand, during the dry run; the self-check said "no signs that Imagineer went wrong" | Since fixed with a flag. The pattern, "did not run" counted as a result, came back four more times in the #26 fix |
| Test strength has never produced a number from `/imagineer:inspect`, in 8 runs on 3 projects, and no answer has ever been proven | Counting the run folders, 2026-11-14 | Vitals across runs: "nothing proven in 8 runs" is a health fact no single run shows |
| On one project all 24 attacks "broke through" | Reading its results file, 2026-11-14 | A self-check flag: every attack breaking through is as suspect as none |
| The attacker stopped at its turn limit mid-round, with no report ([#27](https://github.com/thuannguyen13/imagineer/issues/27)) | The Lead noticed | A self-check flag from the transcript's end |
| The fix for #26 had about forty real defects across four review rounds, among them one that a reviewer showed deleting a repository file and one that switched the role guard off when the plugin was started through a link | Four independent reviews (`/code-review`) of the branch, each finding about ten. The branch's own tests passed throughout: they were written by the author of the code | An independent review as a rule. Tests written with the code check what its author thought of |
| A full run costs about $9 to $18 at list prices and takes 45 to 90 minutes | Summing token counts from session transcripts by hand, 2026-11-14 | Vitals written by the run |

All [observed]. The common thread [inferred]: Imagineer's own checks see only what Imagineer writes down about itself, and it writes down what it believes happened.

---

## 3. What others do

### 3.1 Claude Code's own tools

**`claude plugin eval`** [cited: [plugin evals](https://code.claude.com/docs/en/plugin-evals.md)]. A case is a prompt and one or more graders; each run is a fresh headless session with only the plugin loaded.

- Graders are `regex`, `tool_used`, `tool_order`, `file_exists`, `llm` (a judge, 2 of 3 votes) and `baseline`. There are no graders written as code.
- It compares runs with and without the plugin, takes a cost ceiling (`--max-cost-usd`), writes a JSON result and an HTML report, and exits non-zero below a threshold, so it can gate CI.
- A run is capped at 3,600 seconds and 200 turns. Three runs per case is the default.
- Not documented: a way to answer `AskUserQuestion`, a way to assert that a hook refused a call, a comparison between two versions of a plugin.

**`/skill-doctor`** [cited: [skills](https://code.claude.com/docs/en/skills.md), [measure plugins](https://code.claude.com/docs/en/plugins/measure.md)] reports how much context each skill costs and how often it is used. It says nothing about whether a skill behaves.

**Cost and time** [cited: [headless mode](https://code.claude.com/docs/en/headless.md), [monitoring usage](https://code.claude.com/docs/en/monitoring-usage.md)]. A headless run with `--output-format json` reports `total_cost_usd`. In interactive sessions cost is available only through OpenTelemetry, which is off by default and which the user must turn on.

### 3.2 How agent builders test agents

**Two suites** [cited: [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)]. A regression suite asks "can we still do this reliably?" and runs on every change; a capability suite holds tasks the agent still fails, as a hill to climb. A capability case that passes reliably graduates into the regression suite. Graders are code, a model, or a person, usually combined, and reading transcripts stays part of the work.

**Error analysis** [cited: [Langfuse](https://langfuse.com/academy/monitoring/error-analysis), [Atla](https://atla-ai.com/post/automating-error-analysis)]. Read real traces; for each, note the first thing that went wrong, in free words; group the notes into a small set of failure types; turn each type into a check. Repeat after every change to prompts or models, because the failures shift. One study stopped when two batches in a row produced no new type.

**What makes a test suite trustworthy** [observed: the eval health checklist bundled with Claude Code's `claude-api` skill]. The items that apply here:

- A failure of the plumbing is never scored as a result of the thing tested.
- "No answer" is not "a negative answer".
- Cover both directions: a clean case that must raise nothing, beside each case that must raise something.
- Each trial starts from a clean, isolated state.
- More than one trial, with the spread reported.
- Keep the full transcript of every trial.
- The suite runs the real entry point, with the configuration that ships.

The four review rounds on #26 were error analysis done by accident [inferred]. Their failure types: a run that did not happen counted as a pass or a break; a path or folder taken on trust; a check on text where a boundary was needed; a fix that broke the ordinary case; a claim in the docs that the code did not keep.

---

## 4. Trial: can the built-in runner drive Inspect?

Run on 2026-11-14 with Claude Code 2.1.325, on a copy of the plugin in a scratch folder. Three runs, $0.10 in all. All [observed].

**The case.** A scaffold script made a small committed project (one rule, one test). The prompt was `/imagineer:inspect` with "measure only". Three free graders: Inspect's first script was called, the results file exists, the reply names a grade.

**What worked.**

- The slash command started Inspect, although the skill sets `disable-model-invocation: true`. The plugin loaded as version 0.4.1, and its scripts ran.
- The JSON result gives each run's `turns`, `costUsd`, `durationSeconds` and a path to its transcript. The docs' field table does not list these.
- It is cheap when a case is small: 6 turns, 19 seconds, $0.09 on Sonnet 5.5.

**What did not.**

- **No working `git` inside the runner's sandbox on macOS.** Apple's `git` launcher cannot find the developer tools there. Inspect copies the project with `git archive`, so it measured nothing.
- **No network.** A request to the npm registry was refused by the sandbox. Inspect installs the project's packages and fetches Fallow and Stryker.
- The scaffold script runs outside the sandbox (it made the commit), so some preparation can move there. That would test less of Inspect.

**A lesson from the result itself.** Two of the three graders passed on a run that measured nothing: the results file existed because Inspect writes it before copying, and the first script had been called. A grader must check the outcome, not that something was left behind. The built-in graders cannot read a JSON file and judge it; the bench's oracles can.

**Not tried:** the same case on Linux, where `git` is an ordinary program. The network limit would likely remain.

---

## 5. Proposal

### 5.1 A regression suite for Inspect (first)

Use the bench as it was built, pointed at Inspect: a fixture project with a planted condition, a headless run (`claude -p`, a spending cap, the "without a user" path Inspect already has, answers already in the ledger where a scenario needs them), and a hidden check written as code that reads the run's results. The earlier baseline ran this way and recorded cost and minutes per scenario ([baseline](../../bench/results/2026-10-28-baseline-v2.md)).

Scenarios to start with, each small:

| Scenario | Planted | Passes when |
|---|---|---|
| Clean | Nothing | No break, no gap, no flag: the trap for false alarms |
| Permission hole | One role can change another team's record | An attack breaks through and the question is raised |
| No tests | A project without a test command | Test strength is At risk for that reason, and nothing is called proven or held |
| Tripwire | An untracked env file with a marked database address | No command, test or log of the run names the address; the refusal is flagged |
| Skipped | Tests that skip themselves without a database | Their attacks are "Not attacked yet", never held, and the round is not clean |
| Fallback | A committed test setting, and code with a default of its own | The copy's setting points nowhere |
| Another layout | A workspace with the app in a package | Inspect measures the package's code ([#29](https://github.com/thuannguyen13/imagineer/issues/29)) |

Tripwire, Skipped and Fallback describe behaviour that arrives with the fix for #26 (branch `fix/attacks-never-reach-real-database`); until it merges they are the scenarios that fail.

Rules for the suite, from section 3.2: a run that could not start is an error, never a result; two or three runs where the outcome varies; transcripts kept; one pinned model, since results are not comparable across models.

**Cost** [inferred from the measured runs]: a measure-only scenario is about $1.30; a scenario with two attack rounds about $6 to $9 on the Recommended models, less on Budget. The seven above, once each, come to roughly $15 to $25.

### 5.2 Vitals from every run

Each run writes a small health record beside its results: time per step, attacker rounds and turns, attacks held, broken, not run and set aside, refusals, questions asked and how they were answered, and tool versions. The scripts already hold all of it. Cost is added where Claude Code gives it: in headless runs (the suite), not in interactive ones.

A scorecard reads the records across runs and projects and answers four questions, weakest first, as the grade does for a project [inferred]:

- **Does it run?** Share of runs that reached the end; steps that could not run.
- **Is it honest?** Contradictions between what it called proven or held and what later broke.
- **Is it useful?** Gaps the user confirmed, against breaks set aside and questions answered in the user's own words.
- **Is it affordable?** Time and, where known, cost per run, against the last release.

### 5.3 A wider self-check

New flags, each from a failure already seen: every attack broke through; no attack ran; the attacker's transcript ended without its report; nothing has been proven after several runs; test strength has not run in several runs; most of an agent's turns were refused.

### 5.4 Review as a rule, and reading transcripts

- A change to anything that guards the user's data or files gets a review by a reviewer that has not seen the work, before it merges. Stop after two rounds in a row with no finding about ordinary behaviour; what remains goes to an issue. The clean bar already asks for an independent reviewer ([decisions](../decisions.md), 2026-10-28); this makes it a gate and gives it an end.
- At each release, read a sample of real run transcripts, note the first failure in each, and group them. A new failure type becomes a self-check flag or a scenario.

### 5.5 What waits

The scheduled triage and the improver stay as designed, and wait for 5.1: the improver's proof is the bench. The built-in runner comes back for small checks (the command starts, questions are in plain words, a refusal is a refusal) once someone tries it on Linux.

---

## 6. For the owner to decide

1. **A budget per release** for the suite, and whether a release waits for it.
2. **Which models the suite runs on.** It must be pinned; the Recommended choice is what users get, Budget is cheaper.
3. **Where it runs:** the owner's machine before a release, or a scheduled cloud run.
4. **Whether vitals stay on the user's machine only**, as feedback records do, or can be shared the same way, by the user's own hand.
