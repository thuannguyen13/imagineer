# Imagineer

Make AI-built software trustworthy without having to trust the AI. Imagineer is a Claude Code plugin for people who build by prompting, and for engineers too. It asks you the questions an experienced engineer would, tries to break what was built, and shows a grade backed by evidence you can check.

Works on JavaScript and TypeScript projects in git.

## Install

In Claude Code:

```
/plugin install imagineer --marketplace thuannguyen13/imagineer
```

On Claude Code before 2.1.275, run `/plugin marketplace add thuannguyen13/imagineer`, then `/plugin install imagineer@imagineer`.

The grade pane needs Claude Code 2.1.287 or later. On older versions, `/imagineer:status` answers in the chat instead.

To update: `/plugin update imagineer`, then `/reload-plugins`.

## What's included

| Command | What it does |
| --- | --- |
| `/imagineer:inspect` | Checks an existing project: asks you in plain words what the app should do, proves your answers with tests, tries to break it, and grades it |
| `/imagineer:build <what to build>` | Builds a new feature with an Architect, a Dev and a QA agent, and ends with a pull request you review |
| `/imagineer:status` | Opens the grade pane beside the chat, instantly and at no cost |
| `/imagineer:feedback` | Tells Imagineer it got something wrong, or right, so it can improve |

## How to use it

### 1. Inspect your project

Open Claude Code in your project and run `/imagineer:inspect`.

Inspect works in a throwaway copy of your last commit, so your project's files and git history are never changed. Uncommitted changes are not included. It:

- **Measures** how well your tests catch deliberate breaks, how the code is structured, and the basics (tests, typecheck, CI, docs). If the test check would take more than 20 minutes, it asks first.
- **Asks you questions** about what the app should do, in plain language. It describes a situation and asks what should happen, without telling you what the app does, so your answer is your own. Pick an option, write your own, or choose "Not sure". Only if your answer differs from what the app does does it show you what happens today, and ask whether to fix it or keep it.
- **Proves your answers** with tests, and **tries to break the app** (for example, a user seeing another team's data). Anything that breaks through comes back to you as a question. Before the first attack, it asks once which models to use (see Build below); the choice is shared.

It never fixes your code. When it finds a gap, it tells you in plain words. It offers to add the tests it proved, or docs from your answers, as new files for you to review. Nothing is added without your yes, and nothing is committed.

### 2. Read the grade

The pane opens on its own during Inspect, and `/imagineer:status` reopens it at any time, even after you restart Claude Code.

Each area gets one state: **✓ Strong**, **! Weak**, **✕ Failing** or **? Not checked**. The areas are test strength, structure, foundations, matches your intent, security and permissions, and data safety. The overall grade is the weakest area that matters most, not an average. Select a row to see its evidence. The **Questions** tab lists what is waiting for your answer.

The pane also says whether Inspect is finished, by the thresholds Imagineer suggests: tests that catch at least 80% of deliberate breaks, every break in critical code caught or explained, and two attack rounds in a row that find nothing new. If not, it says what is still needed. Run `/imagineer:inspect` again to continue; questions you already answered are not asked again.

### 3. Build something new

Run `/imagineer:build` followed by what you want, for example `/imagineer:build let managers approve expenses over $500`.

- The first time, it asks which models to use, unless Inspect already did: **Recommended**, **Budget** or **Maximum**, a trade-off between cost and how many blind spots the agents share.
- The Architect turns your request into requirements in plain words. Nothing is built until you approve them.
- QA writes the tests first, from the requirements. Dev writes the code until those tests pass. Each agent is kept to its role: QA never writes code, Dev never writes tests.
- The work happens in its own branch, apart from your checkout. At the end you see what was built per requirement, and it asks before pushing or opening a pull request. It never merges.

Run `/imagineer:build` with nothing after it to pick up an unfinished build.

### 4. Tell Imagineer when it got something wrong

Run `/imagineer:feedback`, optionally with what happened in your own words. It records what Imagineer said or did and what actually happened, never your code. The record stays on your machine. You choose whether to open a pre-filled GitHub issue, save it as a file, or keep it private.

## What Imagineer keeps in your project

Results, your answers and run records are saved in `.claude/imagineer/` in your project. Imagineer keeps that folder out of git for you, so it is never committed or shared. Delete it to start over.

## Changes

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
