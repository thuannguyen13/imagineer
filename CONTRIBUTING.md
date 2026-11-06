# Working on Imagineer

For people changing Imagineer itself. Using it: see [README.md](README.md).

## Repository

- `plugin/`: what users install: skills, agents, the mod that draws the grade, and their tests.
- `bench/`: a fixture app with planted defects, used to prove each change catches at least as much as before.
- `docs/`: the design ([docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md)), the grading research and the results file format.
- `plan/`: current work ([plan/now.md](plan/now.md)), later candidates and decisions.
- `CHANGELOG.md`: what changed in each release.

To try a local checkout, run `claude --plugin-dir <path to this repository>/plugin`.

A change to anything under `plugin/` needs a version bump in `plugin/.claude-plugin/plugin.json` and a `CHANGELOG.md` entry, unless that version is not released yet. CI checks this with `scripts/check-version.sh`.

## The earlier skills

Versions up to 0.1.0 shipped three skills, guard, forge and ground. They were removed in 0.2.0; their useful parts moved into Inspect and Build. To use them, install that release: `/plugin marketplace add thuannguyen13/imagineer#v0.1.0`, then `/plugin install imagineer@imagineer`.

## Design principles

- Small changes stay fast.
- Review depth follows consequences, not file count.
- Inspect code and established rules before inventing patterns.
- Read the project's own docs first; update them in the same change.
- Ask about intent in plain language; decide technical details and record why.
- Show proof the user can check without reading code.
- Say what happens to users first, how it works second.
- Prefer tests and enforceable constraints over more instruction text.
- Report actual verification; distinguish evidence from assumptions.
