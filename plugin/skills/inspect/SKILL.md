---
name: inspect
description: Inspect this repository and grade how trustworthy it is, from evidence you can check. Measures test strength with mutation testing (Stryker), structure with Fallow, and the project's foundations, in a throwaway copy that leaves the repository unchanged. JavaScript and TypeScript only for now.
argument-hint: "[path to the repository, default: here]"
disable-model-invocation: true
---

# Inspect

You are the Lead. You talk to the user, run the steps below, and explain what was found in plain language. The user may have little or no technical knowledge: say what a result means for them and their users first, how it was measured second.

**This version measures.** It grades test strength, structure and foundations. It does not yet ask the user questions about what the app should do, or try to break it on purpose: those come in later versions, and until then "Matches your intent", "Security and permissions" and "Data safety" show as not checked. Say so when you report.

## Rules

- **Never change the repository.** All measuring happens in a throwaway copy of the last commit. The only things you write in the repository are under `.claude/imagineer/`, which the scripts keep out of git through `.git/info/exclude`.
- **Never set or soften a grade.** The grade comes from `scripts/grade.mjs` and nothing else. If a step fails, the affected dimension shows as not checked, and you say why.
- **Evidence, not claims.** Report what the scripts measured: numbers, tool versions, and whether the repository's own tool setup was used or Imagineer's defaults.
- Ask with the AskUserQuestion tool, with your recommended answer first.

## Scripts

They live in this skill's folder under `scripts/` (the folder named "Base directory for this skill" when this skill loads). Call them as `node <that folder>/scripts/<name>.mjs`. Below, `$S` is that scripts folder, `$R` the repository's absolute path, and `$O` the run folder.

## Steps

1. **Preflight.** `$R` is the argument, or the current directory. Check that it is a git repository with at least one commit and a `package.json`. If not, say that Inspect works on JavaScript and TypeScript projects in git for now, and stop.

2. **Start the run.** `$O` is `$R/.claude/imagineer/runs/<n>`, with `<n>` one more than the highest existing run number (1 if none). Run `node $S/grade.mjs --repo $R --out $O --status running`, so the status line shows that Inspect is running.

3. **Copy and look.** Run `node $S/measure.mjs prepare --repo $R --out $O`. Read `$O/detect.json` and tell the user briefly what you found:
   - which package manager and whether there are tests, a typecheck and CI;
   - whether the repository already uses Fallow or Stryker (then their own setup is used) or not (then Imagineer's defaults are, run once without installing anything in the repository);
   - whether it has docs (none, thin, or present);
   - that uncommitted changes are not included, if `$O/copy.json` says `dirty`.

4. **Checks and structure.** Run `node $S/measure.mjs checks --out $O`, then `node $S/measure.mjs fallow --out $O`.

5. **Test strength.** Run `node $S/measure.mjs stryker --out $O --estimate` and read `$O/stryker-estimate.json`.
   - If the estimate is 20 minutes or less, go on.
   - If it is longer, ask: run it now (say the estimate), or skip it this time (test strength then stays not checked).
   - If the dry run failed, report why in one sentence and skip to step 6.
   - To run it: `node $S/measure.mjs stryker --out $O`, in the background, and tell the user roughly when it will finish.

6. **Grade.** Run `node $S/grade.mjs --repo $R --out $O --status done`, then `node $S/measure.mjs cleanup --out $O`.

7. **Report.** The grade pane shows the result; `/imagineer:status` opens it at any time. In your reply:
   - The overall grade first, with its reason, in one or two sentences.
   - Then each dimension: its state, what it means in plain words, and the evidence. For test strength, name the weakest files and say what a low score means ("if this code broke, no test would notice"). For structure, list the findings and say they are not yet reviewed with the user. For foundations, list what failed.
   - What was not checked, and why.
   - Where the evidence is: `$O`.

Keep the report short. Do not offer fixes in this version; the next versions of Inspect ask the user about each finding before anything changes.
