# Imagineer

Engineering judgment for AI coding agents, for people who build by prompting and for engineers alike. Imagineer helps an agent ask the questions an experienced engineer would, protect what must stay true, and prove that a change works, without slowing down routine work.

## Skills

| Skill | Covers | What it does | How it starts | Status |
| --- | --- | --- | --- | --- |
| [guard](skills/guard/SKILL.md) | One change | Judges how risky a change is, keeps what must stay true working, and reuses what already exists | On its own whenever code changes | In use, not yet validated |
| [forge](skills/forge/SKILL.md) | One feature | Plans, builds and reviews an important feature end to end, then opens a pull request | You type `/forge <what to build>` (`/imagineer:forge` as the plugin); `/forge` alone resumes an unfinished run | In use, not yet validated |
| [ground](skills/ground/SKILL.md) | Whole product | Sets up a new product's foundations, or checks an existing one, fixes what you approve, and checks again | You type `/ground` (`/imagineer:ground` as the plugin); `/ground release` before launch | In use, not yet validated |

Where this is going (three skills: guard, forge, ground) and why: [docs/proposals/skillset.md](docs/proposals/skillset.md).

## Install

### As a Claude Code plugin (recommended)

This repository is a Claude Code plugin, `imagineer`: the three skills, forge's agents in `agents/`, and a hook in `hooks/` that stops forge's reviewers from committing, pushing or calling GitHub.

```
/plugin install imagineer --marketplace thuannguyen13/imagineer
```

On Claude Code before 2.1.275, run `/plugin marketplace add thuannguyen13/imagineer`, then `/plugin install imagineer@imagineer`.

Plugin skills carry the plugin's name: type `/imagineer:forge <what to build>` and `/imagineer:ground`. Guard still starts on its own. To try a local checkout, run `claude --plugin-dir <path to this repository>`.

### By copying folders

- **guard**, for Claude Code or Codex: copy `skills/guard/` to your project's `.claude/skills/guard/` (Claude Code) or `.agents/skills/guard/` (Codex). Ask your agent to confirm where it looks for skills before you copy.
- **ground**, Claude Code only: copy `skills/ground/` to `.claude/skills/ground/`, with guard installed too.
- **forge**, Claude Code only: copy `skills/forge/` to `.claude/skills/forge/` and `agents/*.md` to `.claude/agents/`, with guard installed too. Copy `hooks/forge-reviewer-guard.py` to `.claude/hooks/` and add it as a `PreToolUse` hook on `Bash` in `.claude/settings.json`, as `bench/prepare.sh` does. If you installed forge under its old name, delete `.claude/skills/feature-review-loop/`.

### Either way

The skills are general-purpose. Your project's own rules (architecture, wording, design system, deployment) stay in your project's documentation. Do not replace them with this repository.

Ground's own safety hooks need Python 3, and ground installs them in your project only if you agree; the plugin does not turn them on for you.

Forge keeps its run files in `.claude/forge/` in your project, hidden from git. Add the values its **Project setup** table lists (how to run your checks, the test server and port, your issue board, a name prefix for test records) to your project's CLAUDE.md; forge asks for any that are missing. It is costly by design: several large-model agents per review round. Use it for features where a missed rule or permission is expensive, not for routine work.

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
