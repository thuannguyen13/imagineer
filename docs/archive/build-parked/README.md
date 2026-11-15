# Build, turned off

Build (`/imagineer:build`) is turned off from 0.4.0 while Inspect's foundations are made solid enough for an agent to build on: reading any project's layout ([#29](https://github.com/thuannguyen13/imagineer/issues/29)) and a test strength check that measures the right code in reasonable time ([#28](https://github.com/thuannguyen13/imagineer/issues/28)). Without them, Build cannot prove its work is done on repositories like the sales portal. The decision is in [docs/decisions.md](../../decisions.md).

What is here is not installed with the plugin:

- `SKILL.md`: the command, from `plugin/skills/build/SKILL.md`.
- `agents/architect.md`, `agents/dev.md`, `agents/qa.md`: Build's agents, from `plugin/agents/`.

Still in the plugin, because Inspect uses them: `plugin/skills/build/scripts/build.mjs` (the model choice, which also sets Inspect's attacker) and the role guard in `plugin/hooks/role-guard.mjs`.

To turn Build back on, move the files back to where they came from:

```
git mv docs/archive/build-parked/SKILL.md plugin/skills/build/SKILL.md
git mv docs/archive/build-parked/agents/*.md plugin/agents/
```

Then add `build` back to the list in `plugin/skills/inspect/scripts/skill.test.mjs`, point `build.test.mjs` at `plugin/agents/architect.md` again, and bring Build back into the README and the changelog.
