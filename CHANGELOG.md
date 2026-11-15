# Changelog

## 0.5.0

### Changes you need to know

- **Choose how much a run does:** On your first run, Inspect asks for a size, kept for every project: **Standard** (two attack rounds of four, on a faster, cheaper model), **Quick check** (measures and asks, no attacks, the least Claude usage) or **Thorough** (up to four rounds of six on the strongest model, as every run did before).
- **Build removed:** `/imagineer:build`, off since 0.4.0, is gone; Imagineer reports what to fix and leaves the changes to you. Unfinished Build runs in `.claude/imagineer/build/` can no longer be resumed, and the folder can be deleted. ([#38](https://github.com/thuannguyen13/imagineer/issues/38))
- **Test strength measures your app's own code:** Inspect plants bugs in the folders that hold your app's code, read from your project, instead of only `src/` and `lib/`, so a score can differ from an earlier run; the report and the pane name the folders measured. ([#28](https://github.com/thuannguyen13/imagineer/issues/28), [#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Inspect asks which folder is your app:** In a monorepo, or a repository holding several projects, Inspect asks once which one to inspect and keeps your answer for that repository. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))

### New Features

- **Projects with no tests:** Test strength now measures a project that has no tests (none of its planted bugs is caught), and your answers can still be proven, with Node's own test runner.
- **Orders to AI tools found and reported:** Text in your project that tells AI tools or reviewers to skip code, ignore their instructions or call the code already verified secure is listed under Security and permissions and asked about, and Inspect and its attacker never follow it.
- **Findings checked before you are asked:** A separate verifier checks each possible security weakness and each attack that broke through against your code, citing the lines it read; false alarms are set aside with the reason, and only confirmed ones become your questions.
- **Changes to your repository during a run are asked first:** While Inspect runs, any change Claude is about to make to your repository's files or git history, outside Imagineer's own folder, asks you before it happens, including adding the proven tests you agreed to.
- **Every way into your server is counted:** Inspect lists your app's API routes, route handlers and server actions from its code, and Security and permissions names each one no attack has reached yet, instead of trusting the attacker's own account.
- **Correct what Inspect read:** Tell Inspect during a run which folder is your app, which of its folders hold your own code, or where your docs go, and it keeps that for the repository. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))

### Improvements

- **Less of your Claude usage per run:** The attacker is told how to run a test in your project instead of working it out, a setup that worked is reused by later rounds and proofs, and a later run attacks first what changed since the last one or was never reached.
- **Questions between attack rounds:** The questions an attack round raises are asked right after it, while you are there, and your answers aim the next round.
- **Breaks you chose to keep:** An attack that tried what you already answered is tied to your answer: one you chose to keep no longer counts against Data safety or Security and permissions, and one you want fixed is counted once, not twice.
- **Finishing out of reach said plainly:** When the rounds left in a run can no longer give two clean rounds in a row, Inspect says so and suggests stopping, rather than offering a round that cannot finish.
- **Vulnerable packages named:** Security and permissions names the packages behind known vulnerabilities, worst first.
- **A starter README is not docs:** A README left as a framework's starter wrote it no longer counts as documentation about your app.
- **Your own words decide:** When your answer in your own words already says to fix or keep something, Inspect records that and tells you, without asking again.
- **Feedback kept by itself:** At the end of a run, signs that Imagineer went wrong are recorded on your machine without you typing anything, and you choose whether to send them.
- **Finishing shown as conditions, not progress:** The pane lists what Inspect needs to finish, each marked met, not yet, or can't be measured (with the reason): test strength as a bar with the 80% line marked, code quality as findings left to review, and attack rounds as two dots for two clean rounds in a row.
- **Questions from how your code handles failure and the rules in its comments:** Inspect finds errors your app drops or only logs, and rules written only in comments ("only owners can invite members"), and asks you what should happen, without quoting the code.
- **Big-picture questions sooner:** Inspect asks what your app is for, who uses it and what matters most while test strength is still measuring, rather than after.
- **Attack rounds always say what they missed:** The attacker cannot end a round without recording which parts it did not reach, or that it reached them all.
- **Sharper attacks on permissions:** The attacker checks every action that takes a record's ID, not only viewing it, compares each handler with its neighbours for a missing check, and tries fields and IDs the caller must not choose.
- **More project layouts:** Inspect works on an app in a subfolder, on pnpm and Yarn workspaces, and on Vue and Svelte components; Astro files are read but not measured for test strength. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Scripts under other names:** Typecheck and test scripts such as `type-check`, `check-types`, `test:unit` or `svelte-check` are found and run, instead of counting as missing. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Tests under other names:** Tests in `__tests__` folders and Cypress `.cy` files count as tests and are never mutated. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Settings read in more ways:** Foundations checks settings your code reads through `import.meta.env`, SvelteKit's `$env` and `Bun.env` against your example env file, not only `process.env`. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **CI beyond GitHub Actions:** GitLab CI, CircleCI, Bitbucket Pipelines, Azure Pipelines, Jenkins and others count as CI that runs your tests. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Docs wherever they are:** Docs in `doc/`, `documentation/` or decision folders, MDX files and agent files such as `AGENTS.md` count as docs, and answers Inspect saves as docs go into your docs folder and the agent file you already use. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Dependency audit for pnpm, Yarn and Bun:** Inspect counts known vulnerabilities with your own package manager, not npm only, for Security and permissions; Bun's audit also counts development tools. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))
- **Committed build output left out:** Built files committed to the repository are no longer measured as your code, and a source folder named `build` is no longer skipped. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))

### Bug Fixes

- **Your own agents held to Imagineer's rules:** An agent of yours, or of another plugin, named like one of Imagineer's (`attacker`, `dev`, `qa`) was held to Imagineer's limits; only Imagineer's own agents are now. ([#38](https://github.com/thuannguyen13/imagineer/issues/38))
- **Code quality marked down for security findings:** Possible security weaknesses also lowered Code quality, without saying why; they now count under Security and permissions only.
- **Yarn 2 and later:** Installing these projects in Inspect's copy failed because of an option those versions removed. ([#29](https://github.com/thuannguyen13/imagineer/issues/29))

## 0.4.1 — 2026-11-15

### Changes you need to know

- **Grade pane opens when you ask:** Inspect no longer opens the grade pane on its own. Open it with **Details** above the prompt or `/imagineer:status`, or turn on **Open the pane when Inspect or Build runs** in `/config` to have it open with each run.
- **Attacks that need a database:** On a project whose tests need a database, those attacks now show as **Not attacked yet** instead of running, until Inspect can start a throwaway database of its own. ([#26](https://github.com/thuannguyen13/imagineer/issues/26), [#32](https://github.com/thuannguyen13/imagineer/issues/32))
- **Database settings in env files:** In Inspect's throwaway copy, the database settings in your project's env files point nowhere, except a database in memory or in a file of the project, so tests that need a database server fail there; Inspect names the files and settings. ([#26](https://github.com/thuannguyen13/imagineer/issues/26))

### Bug Fixes

- **Attacks reached a real database:** Inspect's attacker could take a database address from your local env file and attack that database; it now runs your app's code only in the throwaway copy and reads nothing outside it, and any attempt is flagged at the end of the run. ([#26](https://github.com/thuannguyen13/imagineer/issues/26))
- **Skipped attacks counted as held:** An attack whose test was skipped, most often for want of a database, was counted as the app holding; it is now listed as **Not attacked yet**, and a round with such an attack no longer counts toward finishing. ([#26](https://github.com/thuannguyen13/imagineer/issues/26))
- **Install folders with a space or a link:** When the folder Claude Code keeps plugins in had a space, a non-English letter or a link in its path, Imagineer's scripts did nothing and its role guard let everything through; both now work there. ([#26](https://github.com/thuannguyen13/imagineer/issues/26))

## 0.4.0 — 2026-11-08

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
