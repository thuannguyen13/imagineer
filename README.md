# Imagineer

Make AI-built software trustworthy without having to trust the AI. Imagineer is a Claude Code plugin for people who build by prompting and for engineers alike: it asks the questions an experienced engineer would, tries to break what was built, and shows a grade backed by evidence you can check, never by an agent's word.

## Commands

| Command | What it does | Status |
| --- | --- | --- |
| `/imagineer:inspect` | Researches an existing repo, asks you plain-language questions about what it should do, and tries to break it until it can't, using tools like Fallow and Stryker | Coming in B2 |
| `/imagineer:build` | Builds new work with an Architect, Dev and QA agents, to the same bar as Inspect | Coming in B4 |
| `/imagineer:status` | Shows the repo's grade in a pane beside the chat, at once and at no cost | Available (0.2.0) |
| `/imagineer:feedback` | Tells Imagineer it got something wrong, so it can improve | Coming in B5.5 |

The design, and why: [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md). Work in progress: [plan/now.md](plan/now.md).

## Install

```
/plugin install imagineer --marketplace thuannguyen13/imagineer
```

On Claude Code before 2.1.275, run `/plugin marketplace add thuannguyen13/imagineer`, then `/plugin install imagineer@imagineer`. The grade pane needs Claude Code 2.1.287 or later. To try a local checkout, run `claude --plugin-dir <path to this repository>/plugin`.

### The earlier skills

Versions up to 0.1.0 shipped three skills, guard, forge and ground. They were removed in 0.2.0; their useful parts move into Inspect and Build. To keep using them, install that release: `/plugin marketplace add thuannguyen13/imagineer#v0.1.0`, then `/plugin install imagineer@imagineer`.

## Repository

- `plugin/`: what users install: skills, the mod that draws the grade, and its tests.
- `bench/`: a fixture app with planted defects, used to prove each change catches at least as much as before.
- `docs/`: the design, the grading research and the results file format.
- `plan/`: current work, later candidates and decisions.
- `CHANGELOG.md`: what changed in each release.

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
