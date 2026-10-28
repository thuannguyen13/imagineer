# Later

These are **candidates**, not commitments.

## Plugin packaging

**Trigger:** installing skill folders and forge's agent files by hand proves error-prone, and plugin agents can enforce their hooks.

Possible scope: one plugin carrying guard, forge, ground, forge's agents and ground's hooks.

## Run-stage skill

**Trigger:** repeated failures in incidents or upkeep that guard, ground's check and Claude Code's built-in debugging miss.

Possible scope: turn an incident into a regression test and a decision record. Avoid duplicating built-in incident or tech-debt skills.

## Guard improvements

- Examples calibrated from real failures and successful tasks, only if they improve behavior.
- Optional specialized references only when the short skill demonstrably misses recurring domain risks.

## Not planned

- A pipeline where one skill must run before another.
- One skill per development stage (charter, gate, tend): folded into ground and forge.
- A separate verify-fix-repeat skill: forge owns the loop.
- Full architecture review on each change.
- Copying each application's architecture into this repository.
