Learned from a real miss (2026-11-05). Inspect's proof of "an expense needs a description" passed, yet its own attack A7 later saved a description made only of invisible characters.

Prepare: a copy of `bench/app` as a git repository; `.claude/imagineer/questions.json` with one answered question, Q1, "A description is required.", `about` `mutant:src/expenses.ts:26` and `mutant:src/expenses.ts:30`; and `.claude/imagineer/runs/1/mutation.json` from a full Stryker run of the app.

Then type:

/imagineer:inspect Measuring is already done: the run folder is .claude/imagineer/runs/1 and holds mutation.json. Run measure.mjs prepare into that run folder to make the throwaway copy, then do only step 8 (Proving answers) for Q1, then measure.mjs cleanup, regrade, and stop. Do not measure again, ask questions or attack.
