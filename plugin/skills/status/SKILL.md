---
name: status
description: Show this repo's Imagineer grade. Normally answered instantly by Imagineer's mod without a Claude turn; this text runs only where mods are off.
disable-model-invocation: true
---

# Imagineer status

Imagineer's mod normally answers this command itself and opens the grade pane, so these instructions run only when mods are turned off (safe mode, `disableAllHooks`, or a Claude Code older than 2.1.287).

Read `.claude/imagineer/results.json` in the repository root. Do not run any tool, test or command, and change nothing.

- If the file does not exist, say: "No Imagineer results in this repo yet. Run /imagineer:inspect to start."
- If its `schema` is not `1`, say which format it uses and that this version of Imagineer reads format 1, so the user should run `/imagineer:inspect` again.
- Otherwise show, in plain language and in this order:
  1. The overall grade from `overall.state` and `overall.reason`.
  2. Each dimension in `dimensions`: icon and word for its `state` (✓ Strong, ! Weak, ✕ At risk for `failing`, ? Not checked), its `name` and `summary`, how it was measured (`repo`: the repo's own setup, `default`: Imagineer's defaults, `none`: not measured), and "stale" or "claimed" when `stale` or `claimed` is true. Trust dimensions first, then care dimensions.
  3. How many questions are waiting (`questions.waiting`).
  4. The commit it was measured at (`run.commit`).

Report only what the file says. Never compute, raise or soften a grade yourself.
