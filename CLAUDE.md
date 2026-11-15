# Imagineer

## Where things are

One place for each question. When the owner asks where things stand, answer from the board first, in plain words: what is waiting on them, what is in progress, what comes next.

- **What is going on, and what is next:** the project board, GitHub Project #12 (`gh project item-list 12 --owner thuannguyen13`). Current work, work waiting for the owner's review and ideas for later are issues there. Never keep a plan, a to-do list or a status page in this repository.
- **What Imagineer is and where it is going:** [docs/proposals/inspect-and-build.md](docs/proposals/inspect-and-build.md).
- **Why it is the way it is:** [docs/decisions.md](docs/decisions.md), one dated entry per decision.
- **What users got in each release:** [CHANGELOG.md](CHANGELOG.md).
- **Everything else written about it:** [docs/README.md](docs/README.md) says what is where.
- **How to work on it:** [CONTRIBUTING.md](CONTRIBUTING.md).

## Git

- Never credit Claude in git. No `Co-Authored-By: Claude …` trailers in commit messages, and no "Generated with Claude Code" (or similar) lines in pull requests, issues or comments.
- This rule is also enforced by `.claude/settings.json` (`attribution` set to empty), so it applies to cloud sessions that do not see the owner's personal settings.

## Changelog

- Write `CHANGELOG.md` entries with the `release-notes` skill: for users, not developers. Under each version, list changes users must act on first (**Changes you need to know**), then **New Features**, **Improvements** and **Bug Fixes**. Each entry is a short bold label and one plain sentence. Leave out internal changes such as script formats, file ids and refactors. End each entry with links to its related issue, or the pull request that made the change when there is no issue, for example `([#25](https://github.com/thuannguyen13/imagineer/pull/25))`, so technical readers can dig in. The entry text itself stays user-facing.
- Keep the `## X.Y.Z` headings; `.github/scripts/check-version.sh` looks for them.
