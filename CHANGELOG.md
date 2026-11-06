# Changelog

Imagineer's releases, newest first. Below 1.0, a `0.y.0` release may change how Imagineer is used; such changes are listed first under **Changes you need to know**. See [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md#versioning).

## 0.5.0 — unreleased

Inspect proves your answers and tries to break the app.

### New

- Each answer you give is proven with a test, written in the repository's own style and run in the throwaway copy. A test counts only when it passes on the code as it is **and** fails when the code behind your answer is broken, using the same breaks Stryker found no test noticed. Breaks no one could ever observe, such as an error message's wording, are recorded with a reason instead.
- A test that fails on the code as it is shows the code does not do what you said. Inspect reports it as a gap and changes nothing.
- "Matches your intent" becomes Strong once every answer is proven, and Failing while the code contradicts an answer about data, money or permissions.
- Proven tests can be added to the repository as new files, if you agree. They are never committed for you.
- **Attack rounds**: an attacker agent writes tests that try to make the app do what it must not (a role seeing or changing what it should not, data mixed up or lost) and runs them in the throwaway copy. Each break becomes a question for you; Inspect fixes nothing.
- A security scan: Fallow's possible weaknesses, verified in the code or asked about, and known vulnerabilities in the dependencies the app ships with (`npm audit`).
- "Security and permissions" and "Data safety" are graded from these. They reach Weak at best until secret scanning and backup restore drills arrive.
- Inspect's stop bar: test strength meets the bar, no open structure findings, and 2 attack rounds in a row find nothing new. The report says what is missing.
- When the repository has no docs, every guess is marked as one, and with your agreement the answers you confirmed are saved as short docs, with a pointer in `CLAUDE.md`.

## 0.4.0 — unreleased

Inspect asks you what the code should do.

### New

- After measuring, `/imagineer:inspect` asks plain-language questions: first the big picture (what the app is for, who uses it, what is sensitive, which code handles money, personal data or permissions), then the findings that matter, most consequential first. Each question shows what you seem to expect, what the code actually does, a concrete example, and suggested answers, with room for your own.
- Answers are kept in `.claude/imagineer/questions.json`, so nothing is asked twice. What the repository's docs or tests already settle is recorded with the file it cites, not asked.
- The grade uses the answers:
  - "Matches your intent" is Failing while a question about data, money or permissions is open, and Weak until answers are backed by tests (next release).
  - Code you mark as critical must meet the test-strength bar on its own, with every break no test noticed there explained.
  - Structure findings you resolve no longer count against it.
- Without a user to answer (`claude -p`, a scheduled run), Inspect records the questions, marks the run as waiting, and lists them.

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
