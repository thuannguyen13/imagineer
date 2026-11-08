# Results file

Inspect and Build write what they found to `.claude/imagineer/results.json` in the repository they inspect. The mod, `/imagineer:status` and the final report read it. Nothing else decides the grade shown to the user.

This page is format `1`. A reader that meets another format says so and asks for a new run; it never guesses.

## Where it lives

- `.claude/imagineer/results.json`, at the repository root.
- `.claude/imagineer/` keeps itself out of git with a `.gitignore` inside it (since 0.3.0; earlier versions added it to `.git/info/exclude`), so the file is never committed unless the user chooses to. Nothing in `.git` is written.

## Format 1

```json
{
  "schema": 1,
  "imagineer": "0.2.0",
  "scale": 1,
  "run": { "command": "inspect", "status": "waiting", "round": 2, "commit": "abc1234" },
  "overall": { "state": "failing", "reason": "Test strength and data safety are failing." },
  "dimensions": [
    {
      "id": "test-strength",
      "name": "Test strength",
      "group": "trust",
      "state": "failing",
      "measured": "default",
      "summary": "Tests catch 30% of deliberate breaks.",
      "stale": false,
      "claimed": false
    }
  ],
  "questions": { "waiting": 3, "resolved": 5 }
}
```

| Field | Meaning |
|---|---|
| `schema` | The format of this file. `1` here |
| `imagineer` | The Imagineer version that wrote it |
| `scale` | The grade scale version, so a change to the scale is not read as the repo changing |
| `run.command` | `inspect` or `build` |
| `run.status` | `running`, `waiting` (on the user's answers), `done` or `stopped`. The band above the prompt shows only while `running` or `waiting` |
| `run.round` | The current round, from 1 |
| `run.commit` | The commit the grade was measured at |
| `run.at` | Optional. When the code was measured, as an ISO time |
| `run.step` | Optional. While `running` or `waiting`: what the run is doing now, in plain words, for example "Measuring test strength (about 18 minutes, until 14:30)". The pane shows it in place of the verdict while `running` |
| `run.bar` | Optional. Inspect's finish thresholds, Imagineer's suggestion: `{ "met": false, "missing": ["two attack rounds in a row that find nothing new"] }`, each missing item in plain words. From 0.3.0 also `progress`: one entry per threshold, `{ "label": "Tests catch breaks", "done": 61, "total": 80, "met": false, "text": "61% of 80%" }`, which the pane draws as a bar |
| `overall.state` | `strong`, `weak`, `failing`, `unchecked` or `not-proven` |
| `overall.reason` | One plain sentence: why the overall grade is what it is |
| `dimensions[].id`, `name` | A stable id and the name shown to the user |
| `dimensions[].group` | `trust` or `care` |
| `dimensions[].state` | `strong`, `weak`, `failing` or `unchecked` |
| `dimensions[].measured` | `repo` (the repo's own tool setup), `default` (Imagineer's defaults) or `none` |
| `dimensions[].summary` | One plain sentence of evidence, for example "Tests catch 30% of deliberate breaks." |
| `dimensions[].stale` | True once the code changed after this dimension was measured |
| `dimensions[].claimed` | True when the evidence is a human claim Imagineer has not re-run |
| `dimensions[].pending` | Optional. True while `running` when the run has not reached this area yet. Its `state` stays `unchecked`; the pane shows it as coming up |
| `questions.waiting`, `resolved` | How many questions are waiting for the user, and how many are resolved |

Readers are strict about meaning and lenient about form: a dimension state they do not recognise is shown as not checked, never as a pass, and a missing field falls back to its empty value.

## Later formats

B3 adds the evidence each state is computed from; B5.5 adds the signals for the reflection loop. Each is a new format number, listed here with what changed.
