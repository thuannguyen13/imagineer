# Imagineer

Engineering judgment for AI coding agents, for people who build by prompting and for engineers alike. Imagineer helps an agent ask the questions an experienced engineer would, protect what must stay true, and prove that a change works, without slowing down routine work.

## Skills

| Skill | Covers | What it does | How it starts | Status |
| --- | --- | --- | --- | --- |
| [guard](skills/guard/SKILL.md) | One change | Judges how risky a change is, keeps what must stay true working, and reuses what already exists | On its own whenever code changes | In use, not yet validated |
| [feature-review-loop](skills/feature-review-loop/SKILL.md) | One feature | Plans, builds and reviews an important feature end to end, then opens a pull request | You type `/feature-review-loop <what to build>` | In use, not yet validated; becoming **forge** |
| ground | Whole product | Sets up a new product's foundations, or checks an existing one before release | — | Planned |

Where this is going (three skills: guard, forge, ground) and why: [docs/proposals/skillset.md](docs/proposals/skillset.md).

## Install guard

For Claude Code, copy `skills/guard/` to your project's `.claude/skills/guard/`. For Codex, copy it to `.agents/skills/guard/`. Ask your agent to confirm where it looks for skills before you copy.

The skill is general-purpose. Your project's own rules (architecture, wording, design system, deployment) stay in your project's documentation. Do not replace them with this repository.

## Install feature-review-loop

Claude Code only: it runs several helper agents, each working in its own copy of your repository. Copy `skills/feature-review-loop/` to `.claude/skills/feature-review-loop/`. Then add the values its **Project setup** table lists (how to run your checks, the test server and port, your issue board, a name prefix for test records) to your project's CLAUDE.md. The skill asks for any that are missing.

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
