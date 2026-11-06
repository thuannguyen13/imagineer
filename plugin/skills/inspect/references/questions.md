# Questions

Read when Inspect reaches its questions step, and again for the questions attacks raise. Paths: `$S` is `${CLAUDE_SKILL_DIR}/scripts`, `$R` the repository's absolute path, `$O` the run folder.


The user is the only one who knows what the code should do. Ask them, and record every answer with `node $S/questions.mjs`. The ledger is `$R/.claude/imagineer/questions.json`; it lasts across runs, so never ask again what it already answers.

**Write for someone who has never read code.** Questions name people, features and what happens to them, never files, functions or line numbers. `questions.mjs add` refuses a question whose user-facing text holds a file name, a function call, a code name or a line number; that belongs in `detail`, which only engineers see.

## What to ask about

1. **The big picture, first.** When the ledger is empty, ask at most 5 questions as **choices** (below), each with suggestions drawn from the code: what the app is for; who uses it and in which roles; what is sensitive (money, personal data); what must never happen; and **which parts of the product handle money, personal data or who may do what**. Ask that last one about parts of the product a person knows ("Sign-in", "Roles and permissions", "Amounts and commission"), as a multiple choice (`"multi": true`), never about files. You map the answer to the code: record it with `--critical <glob>,<glob>`, and put which files each part means in the question's `detail`. When the repo has no docs (`detect.json`: `docs.level` is `none`), these answers are also what the docs step saves (see [no-docs.md](no-docs.md)).
2. **Then the findings, as checks.** Run `node $S/questions.mjs findings --repo $R --out $O`. Each item is a Fallow finding, a line of code where breaks went unnoticed (`kind: mutant`, with the `code` line), or a possible security weakness (`kind: security`). Read the code around each one. Most consequential first: items in critical code (`critical: true`), then data, money and permissions, then behaviour, then wording.
   - Group items about one behaviour into one question, and list their `key`s under `about`.
   - **Do not ask what is already answered.** If the repository's docs, tests or a recorded decision settle it, add it all the same as a check, then record it yourself with `answer --status decided`, the reason citing the file, and `--dismiss` its keys. A break no one could observe (only an error message's text, a log line) is also decided by you, with that reason.
   - Leave out what does not matter for this repo. Ask about at most 12 items in a run.

## How to write a question

**Ask blind.** Never tell the user what they seem to want, or what the app does, before they answer: people agree with a reasonable sentence put in front of them, and the code may be wrong. Describe a situation and let them say what should happen. Only when their answer differs from what the app does are they shown what happens today, and asked whether to fix it.

There are two kinds, each a JSON object for `node $S/questions.mjs add --repo $R` (an array on stdin).

**A check** is about something the app already does: every finding, and anything the code decides that the user should confirm.

```json
{
  "kind": "check",
  "topic": "permissions",
  "point": "What should happen to deal notes when someone loses pipeline access?",
  "example": "Bo is on the Acme renewal. An admin moves Bo to a Marketing role with no pipeline access. Bo opens Acme.",
  "outcomes": [
    { "label": "Bo can no longer read them", "means": "Notes follow pipeline access: Bo loses them the moment the role changes." },
    { "label": "Bo keeps reading them", "means": "Anyone still listed on a deal reads its notes, whatever their role." }
  ],
  "today": "Bo keeps reading them",
  "actual": "Bo still opens Acme and reads every note on the deal.",
  "detail": "The notes rule checks only that the person is on the deal, not that their role has Pipeline View (features/notes/rules.ts:14).",
  "about": []
}
```

- `point`: the question, in one sentence of at most 100 characters, asking what should happen. It is what the user reads first.
- `example`: a concrete situation with names and values, stopping before what happens. Always give one.
- `outcomes`: two or three things that could happen, each a short `label` (at most 40 characters) and `means`: what it means for the user's people or data. One of them is what the app does today. None is marked as recommended or current, and none says "keep it as it is": `add` refuses outcomes that give the answer away. They are shown in an order that does not reveal which is today's. "Not sure" is added for you.
- `today`: the label of the outcome the app does now. Never shown.
- `actual`: what a person sees today, in one sentence. Shown only when the user's answer differs.
- `detail`: optional, for engineers: the files, functions and lines behind it. Never shown in the question; the grade pane shows it in a dim line above the dialog.

**A choice** is for when there is nothing to compare with: the big-picture questions, and decisions about something new. It has `"kind": "choice"`, a `point`, an optional `example`, and two or three `suggestions` (the same `label` and `means`), your recommended one first. `"multi": true` lets the user pick several.

## Asking

1. Run `node $S/questions.mjs ask --repo $R --limit 4` and pass its output **as it is** to AskUserQuestion: its `questions` and `metadata`. A check shows the point, the example and the outcomes; a gap (below) shows what the user said, what happens today, and "Fix it" or "Keep it as it is"; a choice shows the point and the suggestions. The `metadata` marks the dialog as Imagineer's, so the grade pane draws its line and the engineers' detail above it.
2. Record each answer:
   - **A check, an outcome picked:** `node $S/questions.mjs pick --repo $R --id Q3 --choice "<the label>"`. If it is what the app does today, the question is answered, and its behaviour is proven with a test next. If not, it becomes a **gap**: the next `ask` puts it first, now showing what happens today.
   - **A check, their own words** (Other): judge honestly whether they describe what the app does today, then `pick --choice "<their words>" --own --matches yes|no`. If their words are unclear, treat it as Not sure.
   - **A gap:** `node $S/questions.mjs decide --repo $R --id Q3 --decision fix` or `--decision keep`. A gap to fix is reported as a gap in the code; Inspect fixes nothing. A gap kept is answered as the app does it, and proven like a match.
   - **A choice:** `node $S/questions.mjs answer --repo $R --id Q3 --status answered --answer "<the option and what it means>"`, with `--own` for their own words.
   - **Not sure** on a check or a choice: do not record an answer. Write a new example, from another angle, and if it helps say the point another way: `node $S/questions.mjs not-sure --repo $R --id Q3 --example "<new example>" [--point "<said another way>"]`. It stays open and comes back in the next ask. After two Not sures, defer it with `answer --status deferred` and the reason "Not sure after two examples", or settle it from the docs if they answer it.
   - **Not sure** on a gap: defer it with `answer --status deferred --reason "Not sure whether to fix it"`. It stays listed as a gap in the report.
3. Regrade: `node $S/grade.mjs --repo $R --out $O --status waiting` while questions are open (gaps count as open); once none are, `--status running --step "Proving your answers with tests"`.
4. After a round, ask whether to go on with the next questions or stop for now. Open questions stay in the ledger for the next run.

**Without a user** (AskUserQuestion is not available, as in `claude -p` or a scheduled run): add the questions, regrade with `--status waiting`, list the open questions in your report by their point, and stop. Never record a pick on the user's behalf.
