# Imagineer

Make AI-built software trustworthy without having to trust the AI. Imagineer is a Claude Code plugin for people who build by prompting, and for engineers too. It asks you the questions an experienced engineer would, tries to break what was built, and shows a grade backed by evidence you can check.

Works on JavaScript and TypeScript projects in git.

## Install

In Claude Code:

```
/plugin install imagineer --marketplace thuannguyen13/imagineer
```
## Installation Requirement:
- Plugin needs Claude Code 2.1.287 or later. For lower Claude Code version, some features will be display via the conversation instead.
- To update: `/plugin update imagineer`, then `/reload-plugins`. It's recommened to turn on auto-update to always get latest version.

## Commands

| Command | Use it when |
| --- | --- |
| `/imagineer:inspect` | You have a project and want to know whether it does what you meant, and how safe it is |
| `/imagineer:status` | You want to see your project's grade and any questions waiting for you |
| `/imagineer:feedback` | Imagineer got something wrong, or right, and you want to say so |

Build, which made new features with tests, is turned off for now while Inspect learns to read any project reliably.

### Inspect: check what you have

Run `/imagineer:inspect` in your project, ideally first, and again after big changes.

It asks you, in plain words, what the app should do, checks your answers against what the app actually does, and tries to break it, for example by letting one user see another's data. When something doesn't match, it tells you and asks whether to fix it or keep it.

It never changes your code or your git history. It can offer tests and docs as new files, but nothing is added without your yes. Run it again to continue where you left off.

### Status: see the grade

Run `/imagineer:status` at any time. It opens a pane beside the chat, instantly and at no cost.

The pane grades your project area by area (tests, code quality, security, data safety and more) as **Strong**, **Weak**, **At risk** or **Not checked**, with evidence behind each. It also lists the questions Imagineer still needs you to answer and says whether Inspect is finished.

### Feedback: help Imagineer improve

Run `/imagineer:feedback`, optionally with what happened in your own words. It records what Imagineer did, never your code. You choose whether to send it as a GitHub issue, save it as a file, or keep it private.

## Your data

Imagineer keeps its results and your answers in `.claude/imagineer/` in your project, out of git, so they are never committed or shared. Delete that folder to start over.

## Changes

See [CHANGELOG.md](CHANGELOG.md) for what changed in each release.
