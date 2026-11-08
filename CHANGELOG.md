# Changelog

## 0.4.0 — unreleased

### Changes you need to know

- **Build turned off:** `/imagineer:build` is no longer available while Inspect learns to read any project's layout and to measure test strength reliably; on some projects Build could not prove its work was done. Unfinished Build runs stay in `.claude/imagineer/build/` and can be resumed once Build is back. ([#28](https://github.com/thuannguyen13/imagineer/issues/28), [#29](https://github.com/thuannguyen13/imagineer/issues/29))

### Improvements

- **Version in the pane:** The grade pane shows Imagineer's version on the right of its tabs.

### Bug Fixes

- **Test strength check that couldn't run:** When the check failed at its first test run, the pane said "not measured" and nothing was flagged. It now says "could not run", why, and which tests failed, the self-check flags it, and a failure is never recorded as your choice to skip. ([#28](https://github.com/thuannguyen13/imagineer/issues/28))
- **Skipped test strength check:** The self-check no longer blames Imagineer when you skip the test strength check or there is nothing to test. When the check really fails, the flag says why, for example "Could not find a test runner".

## 0.3.0 — 2026-11-07

Questions asked blind, a grade pane that fills in while Inspect runs, and a safer, faster Inspect. Includes what was planned as 0.2.1.

### Changes you need to know

- **Questions asked blind:** Inspect describes a situation and asks what should happen, without first saying what the app does or what you seem to want. Only when your answer differs does it show what happens today and ask whether to fix it or keep it. Build asks about what the app already does the same way. Questions left open from 0.2 keep their old layout. ([#24](https://github.com/thuannguyen13/imagineer/pull/24), [#25](https://github.com/thuannguyen13/imagineer/pull/25))

### New Features

- **Live grade pane:** The pane opens as soon as Inspect starts, even on a first run, and fills in each area as it is measured. The header says what Inspect is doing, for example "Measuring test strength (about 18 minutes, until 14:30)". On the main screen, the **Details** button above the prompt opens it. ([#23](https://github.com/thuannguyen13/imagineer/pull/23))
- **Your own thresholds:** Set test strength thresholds per project by saying "use 65% for tests" or running `/imagineer:inspect --tests 65 --critical 85`. Inspect and Build keep them for that project. Without them, Imagineer suggests 80% for both. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Your answers:** The Questions tab lists every question you resolved, what came of it ("Differs from the app: you want it fixed") and whether a test proves it. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Unattacked areas:** Security and Data safety list the parts of the app the attacks have not reached as "Not attacked yet", count them as gaps rather than safe, and target them first in the next round. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))

### Improvements

- **Faster repeat runs:** Running Inspect again on the same commit reuses the earlier measurements instead of repeating them; the test strength check alone can take 18 minutes. Ask to measure again for a fresh run. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Gaps first:** Gaps you need to decide on are asked first, and the report lists each one with what you said, what the app does today and whether you want it fixed. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Attack findings in the same run:** Questions raised by attacks are asked before the run ends, not in the next run. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Matches your intent:** This area now reflects your answers: what matched, gaps you want fixed and gaps you chose to keep. A gap you want fixed in data, money or permissions marks it **At risk**. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Pane tabs:** **Overview** (formerly Grade) shows how your project is doing and when questions are waiting. **Questions** lists what is waiting, gaps first, followed by your answers. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Renamed grades:** The worst state is now **At risk** instead of Failing, and Structure is now **Code quality**, with readability as a main focus. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Skipping test strength:** A skipped test strength check shows as **Not checked** with your reason. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Fewer permission prompts:** Inspect, Build and Feedback run Imagineer's own scripts without asking each time during a run. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Budget model choice:** The model choice now covers Inspect's attacks too, so Budget runs them on the faster model. Inspect asks once if you have not chosen yet. ([#24](https://github.com/thuannguyen13/imagineer/pull/24))
- **Consistent pane layout:** Each area is one aligned row in the terminal and in Desktop alike. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))

### Bug Fixes

- **Your credentials reached project tests:** Inspect and Build ran your project's install and tests with your whole environment, so a test could reach a real database or service with your keys. They now pass only what the tools need. Network access is still open. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Test workers kept running:** Stopping Inspect during the test strength check no longer leaves test workers running in the background. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Leftover copies:** A stopped Inspect run no longer leaves its throwaway copy in the temp folder; the next run removes old ones. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Git exclude file:** Imagineer no longer writes to your repository's `.git/info/exclude`. An entry added by an earlier version stays until you remove it. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))
- **Flat pane rows:** In the Desktop app, VS Code and on mobile, the pane's rows show their colours and columns instead of one plain line. ([#25](https://github.com/thuannguyen13/imagineer/pull/25))

## 0.2.0 — 2026-11-06

Two commands replace the earlier skills: Inspect checks an existing project, Build makes new features, and a pane shows the grade.

### Changes you need to know

- **guard, forge and ground removed:** Inspect and Build replace them. To keep using them, install 0.1.0 with `/plugin marketplace add thuannguyen13/imagineer#v0.1.0`. ([#10](https://github.com/thuannguyen13/imagineer/pull/10))
- **Smaller install:** Installing Imagineer downloads only the plugin, not the bench app, docs and plans. ([#9](https://github.com/thuannguyen13/imagineer/pull/9))

### New Features

- **Inspect (`/imagineer:inspect`):** Checks a JavaScript or TypeScript project in a throwaway copy of your last commit, so your project is never changed. ([#11](https://github.com/thuannguyen13/imagineer/pull/11), [#13](https://github.com/thuannguyen13/imagineer/pull/13), [#19](https://github.com/thuannguyen13/imagineer/pull/19))
  - Measures test strength, code structure, the basics (install, typecheck, tests, CI) and known security issues, and asks before long runs.
  - Asks in plain language what the app should do, skipping anything your docs or tests already settle, and never asks the same thing twice.
  - Proves your answers with tests and tries to break the app, for example a role seeing data it should not. Each break comes back to you as a question.
  - With your agreement, adds the proven tests and docs from your answers as new files for you to review. It never fixes or commits anything.
- **Build (`/imagineer:build <what to build>`):** Turns your request into requirements you approve, then has QA write the tests before Dev writes the code. Each agent is kept to its role. Work happens on its own branch and ends with a pull request you review; Build asks before pushing and never merges. ([#17](https://github.com/thuannguyen13/imagineer/pull/17))
- **Model choice:** Choose Recommended, Budget, Maximum or your own mix once. ([#17](https://github.com/thuannguyen13/imagineer/pull/17))
- **Grade pane (`/imagineer:status`):** Opens beside the chat instantly and at no cost, with one row per area, its state and its evidence. The overall grade is the weakest area that matters, never an average, and is marked stale once your project moves past the tested commit. Needs Claude Code 2.1.287 or later; older versions show the grade as text. ([#9](https://github.com/thuannguyen13/imagineer/pull/9), [#15](https://github.com/thuannguyen13/imagineer/pull/15), [#21](https://github.com/thuannguyen13/imagineer/pull/21))
- **Feedback (`/imagineer:feedback`):** Records what Imagineer did and what actually happened, never your code. Open a pre-filled GitHub issue, save it as a file or keep it private. Each run also ends with a short self-check. ([#17](https://github.com/thuannguyen13/imagineer/pull/17))

## 0.1.0

The three-skill plugin: guard, forge and ground, with forge's agents, its reviewer hook and the bench. Tagged as the baseline later versions are compared against.
