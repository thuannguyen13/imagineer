# Changelog

Imagineer's releases, newest first. Below 1.0, the middle number goes up only when how you use Imagineer changes, or a command is added; those changes are listed first under **Changes you need to know**. Everything else is a patch (`0.2.1`). See [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md#versioning).

## 0.3.0 — 2026-11-07

Questions asked blind, a grade pane that fills in while Inspect runs, and a safer, leaner Inspect. Includes what was planned as 0.2.1, which was not released on its own.

### Changes you need to know

- Inspect no longer tells you what you seem to want, or what the app does, before you answer. It describes a situation and asks what should happen; one of the options is what the app does today, unmarked. Only if your answer differs does it show you what happens today, and ask whether to fix it or keep it as it is.
- The question format changes. A question about what the app does is a **check**: a point, an example, possible outcomes, which one the app does today (never shown) and what a person sees today (shown only on a difference). The big picture and design decisions are a **choice**: suggestions, the recommended one first. `questions.mjs add` refuses the old format (`expectation` and `suggestions` on a check), and outcomes that give the answer away ("recommended", "today", "keep it as it is"). Questions still open from 0.2 are asked in their old layout.
- A check's answer is recorded with `questions.mjs pick` (and `decide` for a gap), not `answer`.

### New

- The Structure area is called **Code quality**, as readability becomes a main focus. Its id in the results file stays `structure`.
- Inspect, Build and Feedback run their own scripts without asking you each time during a run (only `node` running Imagineer's scripts, and only for that run).
- A run on a commit Inspect has already measured, with the same versions, reuses the earlier checks, structure, security scan and test strength instead of measuring again (the test strength check alone took 18 minutes on a real project), and says so. Ask to measure again to force it.
- Each attack round records the parts of the app it did not reach. Security and Data safety list them as "Not attacked yet" and count them as gaps, never as safe, and the next round aims at them first.
- Questions raised by attacks are asked before the run ends, instead of waiting for the next run.
- Inspect's instructions are a short core plus references read only when a step starts (questions, proofs, attacks, repos with no docs), so each run loads less and the steps cannot contradict each other.
- **Set your own test-strength thresholds per project:** say "use 65% for tests", or run `/imagineer:inspect --tests 65 --critical 85`. Inspect and Build keep them for that project, the grade bands follow them, and the pane says "the thresholds you set". Without them, Imagineer suggests 80% and 80%, now with what that number rests on written down.
- The grade's worst state is called **At risk** instead of Failing: something that matters is known to be wrong or unprotected. The results file still says `failing`, so older results read the same.
- "Matches your intent" counts what the questions found: answers that matched what the app does, gaps you want fixed, and gaps you chose to keep. A gap you want fixed counts against it at once, as Failing when it is about data, money or permissions.
- Gaps are asked first, and the report lists each one: what you said, what the app does today, and whether you want it fixed.
- Build's Architect writes choices for what is new, and checks, asked blind, for what the app already does.
- The pane is drawn by one layout in every app: each area is one row of aligned columns (icon, name, state, its number and what it counts) with a › that opens its evidence, in the terminal and in Desktop alike.
- The pane's two tabs each have a job. **Overview** (was Grade) shows how your project is doing, and says when questions wait for you, with a line that opens them. **Questions** shows what is waiting, gaps first, then **Your answers**: each question you resolved and what came of it ("Matches what the app does", "Differs from the app: you want it fixed", "Settled from the docs or code"), and whether a test proves it.
- The grade pane fills in while Inspect runs. It opens as soon as Inspect starts, even on a project's first run, and each area appears as soon as it is measured; areas not reached yet show as **◌ Coming up**. The header and the line above the prompt say what Inspect is doing now, for example "Measuring test strength (about 18 minutes, until 14:30)". On the main screen, where a pane would cover the conversation, the **Details** button above the prompt opens it.
- Choosing to skip the test-strength check shows it as not checked, with your reason, instead of waiting for it.
- The model choice (Recommended, Budget, Maximum) now covers Inspect's attacker too. On Budget, Inspect's attacks run on the faster model instead of always on the strongest. Inspect asks once if you have not chosen yet.

### Fixed

- **Your project's tests could run with your credentials.** Inspect and Build ran the project's install, tests, mutation testing, proofs and attacks with your whole environment, so a test could reach a real database or service with your keys. They now get only what tools need (paths, locale, proxies); the run records the names left out, never their values. Network access is not blocked.
- **A stopped test-strength check could leave its workers running.** Stopping Inspect while mutation testing ran left Stryker's processes working in the background. They now run as one group that stops with Inspect.
- An Inspect run that was stopped before it finished left its throwaway copy, installed packages and all, in the temp folder. The next run removes copies earlier runs left behind.
- Imagineer no longer writes to your repository's `.git/info/exclude`. Its folders keep themselves out of git with a `.gitignore` inside them. An entry an earlier version added stays until you remove it.
- In the Desktop app, VS Code and on mobile, the pane's area rows were one flat line each, without colours or columns, because those apps draw a button as its plain label.
- The self-check said "done bar" about a Build stuck at its round limit; it now says "done thresholds".

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
