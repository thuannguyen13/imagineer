# Imagineer

## Git

- Never credit Claude in git. No `Co-Authored-By: Claude …` trailers in commit messages, and no "Generated with Claude Code" (or similar) lines in pull requests, issues or comments.
- This rule is also enforced by `.claude/settings.json` (`attribution` set to empty), so it applies to cloud sessions that do not see the owner's personal settings.

## Changelog

- Write `CHANGELOG.md` entries with the `release-notes` skill: for users, not developers. Under each version, list changes users must act on first (**Changes you need to know**), then **New Features**, **Improvements** and **Bug Fixes**. Each entry is a short bold label and one plain sentence. Leave out internal changes such as script formats, file ids and refactors. End each entry with links to its related issue, or the pull request that made the change when there is no issue, for example `([#25](https://github.com/thuannguyen13/imagineer/pull/25))`, so technical readers can dig in. The entry text itself stays user-facing.
- Keep the `## X.Y.Z` headings; `scripts/check-version.sh` looks for them.
