# Proving answers

Read at the proving step. Paths: `$S` is `${CLAUDE_SKILL_DIR}/scripts`, `$R` the repository's absolute path, `$O` the run folder.


An answer counts only when a test enforces it: the test passes on the code as it is, and fails when the code behind the answer is broken. The breaks are the ones Stryker found no test noticed, on the lines the question is `about`.

For each question with `status: answered` whose `about` lists `mutant:` keys and that has no proven test yet, except a gap the user wants fixed (`decision: fix`: the code does not do it yet, and that is already a finding):

1. **Write one test** for the answer, in the repository's own test style and folder (look at its existing tests), under `$O/tests/<path>`, where `<path>` is where it would live in the repository, for example `test/q8-description-required.test.ts`. Name the test after the question: `Q8: an expense needs a description`. Test behaviour a person sees (what is refused, what is saved), not implementation details.
   - **Cover every case the user would count as the same answer**, not only the obvious one. For "required" or "empty": also spaces, tabs, line breaks and characters no one can see, such as a zero-width space (`\u200B`) or a non-breaking space. For amounts: zero, negative, fractions, very large. For text: very long. For a refusal: each role it applies to. If you are unsure whether a case is part of the answer, ask the user before writing the test.
2. **Prove it:** `node $S/prove.mjs --repo $R --out $O --id Q8 --file <path> --run "<command that runs only that test, from the repository root>"`.
3. **Read the result:**
   - **Fails on every break:** proven. Nothing more to do.
   - **Some breaks not caught:** for each `not caught` line, look at the change. If no person could ever observe it (only an error message's text, a log line), record it: `node $S/questions.mjs equivalent --repo $R --mutant <file>#<id> --reason "<why no one could tell>"`. Otherwise strengthen the test so it notices, and prove again. Never record a break as unobservable to make a test pass.
   - **The test fails on the code as it is:** the code does not do what the user answered. That is a finding, not a test to fix: keep the test as written, and report it as a gap in plain words ("You said X; today the app does Y").
4. After all proofs, if any test is proven, ask once whether to add the proven tests to the repository as new files the user can review and commit. If yes, copy them from `$O/tests/` to the same paths in `$R`. Never commit them.

Without a user, prove what you can from answers already in the ledger and list the rest.
