# Working on Imagineer

For people changing Imagineer itself. Using it: see [README.md](README.md).

## Repository

Three folders, and four files beside them.

- `plugin/`: what users install: skills, agents, the mod that draws the grade, and their tests.
- `bench/`: practice projects with planted defects, used to prove each change catches at least as much as before, and to check Inspect itself before a release.
- `docs/`: everything written about Imagineer. [docs/README.md](docs/README.md) says what is where; the design is [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md), and each decision, dated, with why, is in [docs/decisions.md](docs/decisions.md).
- `README.md` for users, this file, `CHANGELOG.md` (what changed in each release) and `CLAUDE.md` (rules for Claude sessions).
- Current work and candidate ideas: GitHub issues, tracked on the Imagineer project board (Project #12). Ideas waiting on a trigger are Low-priority Backlog issues with no sprint, and their body names the trigger.

To try a local checkout, run `claude --plugin-dir <path to this repository>/plugin`.

A change to anything under `plugin/` goes into the changelog entry of the next, untagged version. Only the first change after a release bumps `version` in `plugin/.claude-plugin/plugin.json`: a patch (`0.2.1`) by default, the middle number (`0.3.0`) only when how Imagineer is used changes or a command is added. Releases are batched. CI checks this with `.github/scripts/check-version.sh`. The full policy: [Versioning](docs/proposals/inspect-and-build.md#versioning).

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
