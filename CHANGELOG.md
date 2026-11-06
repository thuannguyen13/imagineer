# Changelog

Imagineer's releases, newest first. Below 1.0, a `0.y.0` release may change how Imagineer is used; such changes are listed first under **Changes you need to know**. See [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md#versioning).

## 0.2.0 — unreleased

The first step of the two-command design: a grade you can see.

### Changes you need to know

- The plugin now lives in `plugin/`, and the marketplace points there. Installing Imagineer no longer downloads the bench app, docs and plans. To try a local checkout, use `claude --plugin-dir <repository>/plugin`.

### New

- `/imagineer:status` shows the repo's grade from Imagineer's results file. It answers at once, with no Claude turn and no usage.
- A grade pane beside the transcript and a status line above the prompt while Inspect or Build runs. They show only what the results file says, and stay hidden in repos that do not use Imagineer.
- Where nothing can be drawn (a cloud session, `claude -p`), `/imagineer:status` answers in text. Where mods are turned off, the `status` skill reads the same file instead.
- The results file format is documented in [docs/results-file.md](docs/results-file.md).

### Notes

- The mod only reads files and draws: it does not write files, run commands, call models or approve tool calls. `claude plugin validate .` lists exactly what it calls.
- Needs Claude Code 2.1.287 or later for the pane and status line.

## 0.1.0

The three-skill plugin: guard, forge and ground, forge's agents and reviewer hook, and the bench. Tagged as the baseline later versions are compared against.
