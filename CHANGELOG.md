# Changelog

Imagineer's releases, newest first. Below 1.0, a `0.y.0` release may change how Imagineer is used; such changes are listed first under **Changes you need to know**. See [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md#versioning).

## 0.3.0 — unreleased

The first slice of Inspect: a real grade from measurements.

### New

- `/imagineer:inspect` measures a JavaScript or TypeScript repository in a throwaway copy of its last commit, so the repository is never changed:
  - **Test strength** with Stryker mutation testing: how many deliberate breaks the tests notice, and the weakest files. Long runs are estimated first and asked about.
  - **Structure** with Fallow: health score, unused files and exports, overly complex functions, duplication.
  - **Foundations**: lockfile, install, typecheck, tests, CI running the tests, and environment variables documented in `.env.example`.
- The repository's own Fallow and Stryker setup is used when it has one; otherwise pinned versions run once, without installing anything in the repository.
- A script computes the grade from that evidence, by the rules in the design: the weakest link sets the overall grade. "Matches your intent", "Security and permissions" and "Data safety" show as not checked until later slices.
- Results go to `.claude/imagineer/`, kept out of git.

## 0.2.0 — 2026-11-05

The first step of the two-command design: a grade you can see.

### Changes you need to know

- guard, forge and ground, and forge's eight agents and reviewer hook, are removed. `/imagineer:inspect` and `/imagineer:build` replace them in coming releases and reuse their useful parts. To keep using them meanwhile, install 0.1.0: `/plugin marketplace add thuannguyen13/imagineer#v0.1.0`.
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
