# Imagineer

Engineering judgment for AI coding agents, for people who build by prompting and for engineers alike. Imagineer helps an agent ask the questions an experienced engineer would, protect what must stay true, and prove that a change works, without slowing down routine work.

## Skills

| Skill | Covers | What it does | How it starts | Status |
| --- | --- | --- | --- | --- |
| [guard](skills/guard/SKILL.md) | One change | Judges how risky a change is, keeps what must stay true working, and reuses what already exists | On its own whenever code changes | In use, not yet validated |
| [forge](skills/forge/SKILL.md) | One feature | Plans, builds and reviews an important feature end to end, then opens a pull request | You type `/forge <what to build>`; `/forge` alone resumes an unfinished run | In use, not yet validated |
| [ground](skills/ground/SKILL.md) | Whole product | Sets up a new product's foundations, or checks an existing one, fixes what you approve, and checks again | You type `/ground`; `/ground release` before launch | In use, not yet validated |

Where this is going (three skills: guard, forge, ground) and why: [docs/proposals/skillset.md](docs/proposals/skillset.md).

## Install guard

For Claude Code, copy `skills/guard/` to your project's `.claude/skills/guard/`. For Codex, copy it to `.agents/skills/guard/`. Ask your agent to confirm where it looks for skills before you copy.

The skill is general-purpose. Your project's own rules (architecture, wording, design system, deployment) stay in your project's documentation. Do not replace them with this repository.

## Install ground

Claude Code only. Copy `skills/ground/` to `.claude/skills/ground/`, with guard installed too. Its optional safety hooks need Python 3; ground installs them only if you agree.

## Install forge

Claude Code only: it runs several helper agents; the ones that build or test work in their own copy of your repository. It keeps its run files in `.claude/forge/` in your project, hidden from git. Copy `skills/forge/` to `.claude/skills/forge/`. If you installed it under its old name, delete `.claude/skills/feature-review-loop/`. Then add the values its **Project setup** table lists (how to run your checks, the test server and port, your issue board, a name prefix for test records) to your project's CLAUDE.md. The skill asks for any that are missing.

It is costly by design: several large-model agents per review round. Use it for features where a missed rule or permission is expensive, not for routine work.

## Planning

See [plan/](plan/) for current work, future candidates, and decisions.

## Design principles

- Small changes stay fast.
- Review depth follows consequences, not file count.
- Inspect code and established rules before inventing patterns.
- Read the project's own docs first; update them in the same change.
- Ask product questions; decide technical ones and record why.
- Show proof the user can check without reading code.
- Say what happens to users first, how it works second.
- Prefer tests and enforceable constraints over more instruction text.
- Report actual verification; distinguish evidence from assumptions.
