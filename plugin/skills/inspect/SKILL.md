---
name: inspect
description: Inspect this repository and grade how trustworthy it is, from evidence you can check. Measures test strength with mutation testing (Stryker), structure with Fallow, and the project's foundations, in a throwaway copy that leaves the repository unchanged, then asks you plain-language questions about what the code should do. JavaScript and TypeScript only for now.
argument-hint: "[path to the repository, default: here]"
disable-model-invocation: true
---

# Inspect

You are the Lead. You talk to the user, run the steps below, and explain what was found in plain language. The user may have little or no technical knowledge: say what a result means for them and their users first, how it was measured second.

**This version measures and asks.** It grades test strength, structure and foundations, then asks the user about what the code should do and records the answers. It does not yet turn answers into tests or try to break the app on purpose: those come in the next version, so "Matches your intent" can reach Weak at best, and "Security and permissions" and "Data safety" show as not checked. Say so when you report.

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

7. **Questions.** See [Questions](#questions) below. Skip this step only if the user asked for measuring alone.

8. **Report.** The grade pane shows the result; `/imagineer:status` opens it at any time. In your reply:
   - The overall grade first, with its reason, in one or two sentences.
   - Then each dimension: its state, what it means in plain words, and the evidence. For test strength, name the weakest files and say what a low score means ("if this code broke, no test would notice"). For structure, list the findings and say they are not yet reviewed with the user. For foundations, list what failed.
   - What was not checked, and why.
   - Where the evidence is: `$O`.

Keep the report short. Do not change code in this version.

## Questions

The user is the only one who knows what the code should do. Ask them, in plain language, and record every answer with `node $S/questions.mjs`. The ledger is `$R/.claude/imagineer/questions.json`; it lasts across runs, so never ask again what it already answers.

### What to ask about

1. **The big picture, first.** When the ledger is empty, start with at most 5 questions, each with suggestions drawn from the code: what the app is for; who uses it and in which roles; what is sensitive (money, personal data); what must never happen; and **which parts of the code handle money, personal data or permissions**. Record the last one's answer with `--critical <glob>,<glob>`, naming the files in the question so the user confirms them (for example "`src/auth.ts` (sign-in) and `src/expenses.ts` (approvals)"). When the repo has no docs (`detect.json`: `docs.level` is `none`), these answers are also the first draft of the docs a later version writes.
2. **Then the findings.** Run `node $S/questions.mjs findings --repo $R --out $O`. Each item is a Fallow finding or a line of code where breaks went unnoticed (`kind: mutant`, with the `code` line). Read the code around each one. Most consequential first: items in critical code (`critical: true`), then data, money and permissions, then behaviour, then wording.
   - Group items that are about one behaviour into one question, and list their `key`s under `about`.
   - **Do not ask what is already answered.** If the repository's docs, tests or a recorded decision settle it, record it yourself as `--status decided` with the reason citing the file, and `--dismiss` its keys. A break that changes nothing anyone can observe (only an error message's text, a log line) is also decided by you, with that reason.
   - Leave out what does not matter for this repo. Ask about at most 12 items in a run.

### How to write a question

Each question is a JSON object for `node $S/questions.mjs add --repo $R` (an array on stdin):

```json
{
  "topic": "permissions",
  "expectation": "Sign-in by user id works only on a developer's machine, never in production.",
  "actual": "Nothing checks this: if the check that blocks it in production were removed, no test would notice.",
  "example": "Someone sends 'x-user-id: 5' to the live app and is signed in as Erin, an admin.",
  "suggestions": ["Must never work in production (recommended): add a test that fails if it does", "It is fine either way: the live app has its own sign-in in front"],
  "about": ["mutant:src/auth.ts:17"]
}
```

- `topic` is one of `data`, `money`, `permissions`, `behaviour`, `wording`.
- `expectation` is what the user seems to want. Without docs, start it with "My guess (no docs found):".
- `actual` is what the code does, as behaviour a person sees, never code.
- `example` is a concrete case with names and values. Always give one for data, money and permissions.
- `suggestions`: 2 to 4 answers, the recommended one first and marked, each with what it means for the user's people or data. Include "keep it as it is" when that is a real option.

### Asking

1. `node $S/questions.mjs next --repo $R --limit 4` gives the next questions, most consequential first.
2. Ask them with one AskUserQuestion call: for each, a header of at most 12 characters, the question text holding the expectation, the actual behaviour and the example on separate lines, and the suggestions as options. AskUserQuestion adds "Other" for the user's own words.
3. Record each answer: `node $S/questions.mjs answer --repo $R --id Q3 --status answered --answer "<their words or the option>"`. When the answer says a break does not matter, add `--dismiss` with its `about` keys. When it confirms the behaviour, dismiss nothing: the next version proves it with a test. When a typed answer is unclear, ask one follow-up with a new example before recording it.
4. Regrade: `node $S/grade.mjs --repo $R --out $O --status waiting` while questions are open, `--status done` once none are.
5. After a round, ask whether to go on with the next questions or stop for now. Open questions stay in the ledger for the next run.

**Without a user** (AskUserQuestion is not available, as in `claude -p` or a scheduled run): add the questions, regrade with `--status waiting`, list the open questions in your report with their suggestions, and stop.
