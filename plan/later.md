# Later

These are **candidates**, not commitments.

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

## Destructive-command guard with buttons

**Trigger:** users of Inspect or Build ask for protection against destructive commands (`rm -rf`, force pushes, database drops) in their own sessions.

A mod that holds such a command and shows what it would change, with Proceed and Cancel, as Anthropic's `blast-radius` sample does. It would be the plugin's first mod that changes tool calls, so it needs its own on/off switch and stays out of the read-only grade mod.
