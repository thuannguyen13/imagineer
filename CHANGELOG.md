# Changelog

Imagineer's releases, newest first. Below 1.0, the middle number goes up only when how you use Imagineer changes, or a command is added; those changes are listed first under **Changes you need to know**. Everything else is a patch (`0.2.1`). See [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md#versioning).

## 0.2.0 — 2026-11-06

The baseline of the two-command design: Inspect checks an existing project, Build makes new features, and a pane shows the grade. Earlier 0.2.0 to 0.8.0 releases were folded into this one; their step-by-step history is in the merged pull requests.

### Changes you need to know

- guard, forge and ground, forge's agents and its reviewer hook are removed; Inspect and Build replace them. To keep using them, install 0.1.0: `/plugin marketplace add thuannguyen13/imagineer#v0.1.0`.
- The plugin lives in `plugin/`, and the marketplace points there. Installing Imagineer no longer downloads the bench app, docs and plans.

### Inspect: `/imagineer:inspect`

- Works in a throwaway copy of your last commit, so your project is never changed. JavaScript and TypeScript projects in git.
- **Measures** test strength with Stryker (how many deliberate breaks your tests notice), structure with Fallow, the foundations (lockfile, install, typecheck, tests, CI, documented environment variables) and a security scan, including known vulnerabilities in your dependencies. Your project's own Fallow and Stryker setup is used when it has one; otherwise pinned versions run without installing anything in it. Long runs are estimated first and asked about.
- **Asks you** what the app should do, in plain language: the point first, then what you'd expect, what happens today and an example, with suggested answers that each say what they mean, your own words, or **Not sure**. Big-picture questions come first; then the findings that matter, most consequential first. What your docs or tests already settle is recorded, not asked, and nothing is asked twice. No file names or code in the question; engineers see those details in a separate line.
- **Proves your answers** with tests that pass on the code as it is and fail when the code behind the answer is broken, covering every case you would count as the same answer. A test that fails on the code as it is is reported as a gap; Inspect fixes nothing.
- **Attacks**: an attacker agent tries to make the app do what it must not (a role seeing or changing what it should not, data mixed up or lost). Each break comes back to you as a question.
- With your agreement, adds the proven tests, and docs written from your answers when the project had none, as new files for you to review. Never commits them.
- Says whether it is finished, by the thresholds Imagineer suggests: tests catch at least 80% of deliberate breaks, every break in critical code is caught or explained, and two attack rounds in a row find nothing new.

### Build: `/imagineer:build <what to build>`

- An **Architect** turns your request, the docs and the code into requirements you approve, then a design. **QA** writes the tests from that design before any code exists, and they must fail first. **Dev** writes the code until they pass. Each round is measured like Inspect does, then reviewed by the Architect.
- Roles are enforced, not just asked for: Dev cannot write tests, QA cannot write code, and only the Lead pushes.
- Choose the models once: Recommended, Budget, Maximum or your own mix.
- Works in its own branch and worktree, and ends with a pull request body that leads with each requirement and its evidence. Never pushes or opens a pull request without your yes, and never merges.

### The grade: `/imagineer:status`

- A pane beside the chat, opened instantly at no cost, and on its own while Inspect or Build runs. Where nothing can be drawn, the grade comes as text.
- One row per area (test strength, structure, foundations, matches your intent, security and permissions, data safety), each **✓ Strong**, **! Weak**, **✕ Failing** or **? Not checked**, with its measured number (48/51 breaks caught). Select a row to see its evidence. The overall grade is the weakest area that matters, never an average.
- The header shows the verdict, the commit and when it was tested; the grade is marked stale once the project moves past that commit. A **Questions** tab lists what is waiting for you.
- The pane only reads files and draws: it writes nothing, runs no commands and calls no models. Needs Claude Code 2.1.287 or later.

### Feedback: `/imagineer:feedback`

- Records what Imagineer said or did and what actually happened, never your code, on your machine. Open a pre-filled GitHub issue yourself, save it as a file, or keep it private.
- Each run ends with a self-check (an agent stepping outside its role, a tool that did not run, a measurement where most breaks timed out) and two optional questions about what was not worth your time and what was missed.

## 0.1.0

The three-skill plugin: guard, forge and ground, forge's agents and reviewer hook, and the bench. Tagged as the baseline later versions are compared against.
