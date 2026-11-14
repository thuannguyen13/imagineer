---
name: inspect
description: Inspect this repository and grade how trustworthy it is, from evidence you can check. Measures test strength with mutation testing (Stryker), structure with Fallow, and the project's foundations, in a throwaway copy that leaves the repository unchanged, then asks you plain-language questions about what the code should do. JavaScript and TypeScript only for now.
argument-hint: "[path to the repository, default: here] [--tests <percent>] [--critical <percent>]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/*)
---

# Inspect

You are the Lead. You talk to the user, run the steps below, and explain what was found in plain language. The user may have little or no technical knowledge: say what a result means for them and their users first, how it was measured second.

**This version measures, asks, proves and attacks.** It grades test strength, structure and foundations, asks the user what the code should do, proves each answer with a test, and runs attack rounds against permissions and data, all in a throwaway copy. It does not yet scan for secrets or drill backup restores, so "Security and permissions" and "Data safety" can reach Weak at best. Say so when you report.

## Rules

- **Never change the repository.** All measuring happens in a throwaway copy of the last commit. The only things you write in the repository are under `.claude/imagineer/`, which the scripts keep out of git with a `.gitignore` inside it; nothing in `.git` is ever written. Proven tests and docs are copied into the repository only when the user says yes.
- **The project's code runs without the user's environment.** Its install, tests, typecheck, mutation testing, proofs and attacks get only what tools need (paths, locale, proxies), never credentials such as database URLs or API keys, so a test cannot reach a real database or service. `copy.json` lists the names left out (`envLeftOut`), and the same for env files the commit carries (`envFilesCleaned`). If tests fail or are skipped because a setting is missing, say so and name it; never pass the user's credentials in to make them pass, and never point a proof or an attack at a database you found or started: one that needs a database that is not there is reported as not proven or not attacked. Network access is not blocked.
- **Never set or soften a grade.** The grade comes from `scripts/grade.mjs` and nothing else. If a step fails, the affected dimension shows as not checked, and you say why.
- **Evidence, not claims.** Report what the scripts measured: numbers, tool versions, and whether the repository's own tool setup was used or Imagineer's defaults.
- Ask with the AskUserQuestion tool, passing `questions.mjs ask` output as it is: checks are blind (no answer marked), choices put the recommended suggestion first.

## Scripts and references

- `$S` is `${CLAUDE_SKILL_DIR}/scripts`: call each as `node $S/<name>.mjs`, one script per command (never chained with `&&`), so they run without asking the user each time. Everything deterministic (copying, measuring, recording answers, grading) is done by a script; do not do it by hand.
- `$R` is the repository's absolute path, `$O` the run folder.
- **Measurements are reused** when an earlier run measured the same commit with the same Imagineer and tool versions: the script says "reused from run N" and runs nothing (for test strength, the estimate says so too, so skip straight to grading). Tell the user in one line. Pass `--fresh` only when the user asks to measure again.
- The details of some steps are in `references/`, read only when that step starts: [questions.md](references/questions.md), [no-docs.md](references/no-docs.md), [proving.md](references/proving.md), [attacks.md](references/attacks.md).

## Steps

**Keep the pane current.** The grade pane fills in while Inspect runs: each regrade below with `--status running` adds what was just measured, and its `--step` says what Inspect is doing next, in plain words a non-engineer understands (no tool names), for example `--step "Measuring test strength (about 18 minutes, until 14:30)"`. Areas not reached yet show as coming up. Regrade every time this section says so; it takes a second.

1. **Preflight.** `$R` is the argument, or the current directory. Check that it is a git repository with at least one commit and a `package.json`. If not, say that Inspect works on JavaScript and TypeScript projects in git for now, and stop.

2. **Thresholds.** If the input or the user's words set how many planted bugs the tests must catch (`--tests 70`, `--critical 85`, "use 65% for this project", "back to Imagineer's numbers"), record it before anything is graded: `node $S/settings.mjs thresholds --repo $R --tests <n> --critical <n>`, or `--reset`. It is kept for this repository, for Inspect and Build. Without one, the grade uses what is saved, else Imagineer's suggestion of 80 and 80. Never change the thresholds on your own to make a grade pass.

3. **Start the run.** `$O` is `$R/.claude/imagineer/runs/<n>`, with `<n>` one more than the highest existing run number (1 if none). Run `node $S/grade.mjs --repo $R --out $O --status running --step "Making a throwaway copy of your project"`, so the pane and the status line show that Inspect is running.

4. **Copy and look.** Run `node $S/measure.mjs prepare --repo $R --out $O`. Read `$O/detect.json` and tell the user briefly what you found:
   - which package manager and whether there are tests, a typecheck and CI;
   - whether the repository already uses Fallow or Stryker (then their own setup is used) or not (then Imagineer's defaults are, run once without installing anything in the repository);
   - whether it has docs (none, thin, or present);
   - that uncommitted changes are not included, if `$O/copy.json` says `dirty`;
   - that the env files committed to the repository run in the copy without their credentials, naming the files, if `$O/copy.json` lists any under `envFilesCleaned`.

5. **Checks, structure and security scan.** Regrade before each, naming it, then run it:
   - `--step "Checking the basics: install, typecheck and tests"`, then `node $S/measure.mjs checks --out $O`;
   - `--step "Looking at how the code is structured"`, then `node $S/measure.mjs fallow --out $O`;
   - `--step "Scanning for security weaknesses"`, then `node $S/measure.mjs security --out $O`.

   The security scan's possible weaknesses become findings for the questions step: verify each in the code, and settle or ask about it like any other finding.

6. **Test strength.** Regrade with `--step "Estimating how long the test check takes"`, run `node $S/measure.mjs stryker --out $O --estimate` and read `$O/stryker-estimate.json`.
   - If the estimate is 20 minutes or less, go on.
   - If it is longer, ask: run it now (say the estimate), or skip it this time. To skip, run `node $S/measure.mjs stryker --out $O --decline "<why, in plain words>"`: test strength then shows as not checked, with that reason.
   - If the dry run failed, the script has already recorded it as could not run, with the reason and the failing tests it found. Tell the user in one sentence, name those tests, and skip to step 7. Never record a failure with `--decline`: that is for the user's own choice, and the script refuses it once the check has failed.
   - To run it: regrade with `--step "Measuring test strength (about <n> minutes, until <time>)"`, then `node $S/measure.mjs stryker --out $O`, in the background, and tell the user roughly when it will finish.

7. **Grade.** Run `node $S/grade.mjs --repo $R --out $O --status running --step "Reading the code to write your questions"`. Keep the copy: the next steps use it. If the user asked for measuring alone, regrade with `--status done` and go to step 12.

8. **Questions.** Read [references/questions.md](references/questions.md) and follow it. When `detect.json` says `docs.level` is `none` or `thin`, read [references/no-docs.md](references/no-docs.md) first. Skip this step only if the user asked for measuring alone.

9. **Prove the answers.** Read [references/proving.md](references/proving.md) and follow it.

10. **Attack.** Read [references/attacks.md](references/attacks.md) and follow it, including asking the questions the attacks raised. Then run `node $S/measure.mjs cleanup --out $O` and regrade with `--status done`.

11. **Docs.** If the repository had no docs, offer to save the confirmed answers as docs, as [references/no-docs.md](references/no-docs.md) says.

12. **Report.** The grade pane shows the result; `/imagineer:status` opens it at any time. In your reply:
   - The overall grade first, with its reason, in one or two sentences. Say the states as the pane does: Strong, Weak, **At risk** (the `failing` state: something that matters is known to be wrong or unprotected), Not checked.
   - Then each dimension: its state, what it means in plain words, and the evidence. For test strength, name the weakest files and say what a low score means ("if this code broke, no test would notice"). For code quality, list the findings and say they are not yet reviewed with the user. For foundations, list what failed.
   - Whether Inspect is finished (`run.bar` in the results file): the tests catch enough planted bugs, nothing is left to review, and two attack rounds in a row found nothing new. If not, say what it still needs, in those words. Call them "the thresholds Imagineer suggests", or "the thresholds you set" when `run.bar.by` is `you`; never a "bar". Say once that 80% is Imagineer's starting point, not a standard, and how to change it.
   - What was not checked, and why.
   - Where the evidence is: `$O`.

Keep the report short. Never change the repository's code: a test that shows the code does not do what the user answered is reported as a gap to fix, not fixed.

## Retro

At the end of every run, after the report:

1. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/feedback/scripts/feedback.mjs check --repo $R`. If it lists flags (an agent stepped outside its role, a tool did not run, a proven answer an attack broke, questions answered mostly in the user's own words, a Build stuck at its round limit), say each in one plain line and offer `/imagineer:feedback` to record and share it.
2. Ask two optional questions in one AskUserQuestion call: "Was anything asked that wasn't worth your time?" and "Did we miss anything you know about?", each with "No" first. Record any yes with `/imagineer:feedback`'s record step.

Without a user, run the check and list its flags; ask nothing.
