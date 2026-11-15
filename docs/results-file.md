# Results file

Inspect writes what it found to `.claude/imagineer/results.json` in the repository they inspect. The mod, `/imagineer:status` and the final report read it. Nothing else decides the grade shown to the user.

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
      "summary": "Tests catch 30% of planted bugs.",
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
| `run.command` | `inspect` (Build, removed in 0.5.0, wrote `build`; the mod now reads any run as Inspect's) |
| `run.status` | `running`, `waiting` (on the user's answers), `done` or `stopped`. The band above the prompt shows only while `running` or `waiting` |
| `run.round` | The current round, from 1 |
| `run.commit` | The commit the grade was measured at |
| `run.at` | Optional. When the code was measured, as an ISO time |
| `run.layout` | Optional, from 0.5.0. The layout Inspect worked from, in one line: the app's folder when it is not the root, the code test strength measured, and any default used, for example "App in web/ · test strength on src/". The pane shows it under the commit |
| `run.step` | Optional. While `running` or `waiting`: what the run is doing now, in plain words, for example "Measuring test strength (about 18 minutes, until 14:30)". The pane shows it in place of the verdict while `running` |
| `run.bar` | Optional. Inspect's finish thresholds, Imagineer's suggestion: `{ "met": false, "missing": ["two attack rounds in a row that find nothing new"] }`, each missing item in plain words. From 0.3.0 also `progress`: one entry per threshold, `{ "label": "Planted bugs caught", "done": 61, "total": 80, "met": false, "text": "61% of 80%" }`, which the pane draws as a bar. From 0.5.0 each entry is also a condition: `kind` (`threshold`, `countdown` or `streak`), `state` (`met`, `open`, `blocked` with the reason in `note`, or `pending`), `goal` in words ("Tests catch 80% of planted bugs"), `value` and `target` (61 and 80; findings left and found; clean rounds in a row and how many are needed) and `note` ("61% now", "2 left of 14", "1 of 2 in a row"). The pane draws a threshold as a bar with the target marked, a countdown as a count, a streak as dots, and a blocked condition as its reason with no picture |
| `overall.state` | `strong`, `weak`, `failing`, `unchecked` or `not-proven` |
| `overall.reason` | One plain sentence: why the overall grade is what it is |
| `dimensions[].id`, `name` | A stable id and the name shown to the user |
| `dimensions[].group` | `trust` or `care` |
| `dimensions[].state` | `strong`, `weak`, `failing` or `unchecked` |
| `dimensions[].measured` | `repo` (the repo's own tool setup), `default` (Imagineer's defaults) or `none` |
| `dimensions[].summary` | One plain sentence of evidence, for example "Tests catch 30% of planted bugs." |
| `dimensions[].stale` | True once the code changed after this dimension was measured |
| `dimensions[].claimed` | True when the evidence is a human claim Imagineer has not re-run |
| `dimensions[].pending` | Optional. True while `running` when the run has not reached this area yet. Its `state` stays `unchecked`; the pane shows it as coming up |
| `questions.waiting`, `resolved` | How many questions are waiting for the user, and how many are resolved |

Readers are strict about meaning and lenient about form: a dimension state they do not recognise is shown as not checked, never as a pass, and a missing field falls back to its empty value.

## Later formats

B3 adds the evidence each state is computed from; B5.5 adds the signals for the reflection loop. Each is a new format number, listed here with what changed.
