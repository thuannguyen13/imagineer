---
name: feedback
description: Tell Imagineer it got something wrong (a problem it missed, a question not worth your time, a false alarm) or right. About Imagineer's own behaviour, never your code. Kept on your machine; you choose whether to share it.
argument-hint: "[what went wrong, in your words]"
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/skills/*)
---

# Feedback

The user is telling Imagineer about Imagineer: what it said or did, and what actually happened. This is never about the user's code, and the record never contains their code. `$F` is `node ${CLAUDE_SKILL_DIR}/scripts/feedback.mjs`, `$R` the repository's absolute path.

1. **Self-check first.** Run `$F check --repo $R`. If it lists flags, mention them in one line each: they may be what the user means.
2. **Understand it.** If the input does not already say, ask with AskUserQuestion, in plain words:
   - **What kind:** it missed a problem (`miss`); it raised something that was not a problem (`false-alarm`); a question was not worth your time (`poor-questions`); it got stuck or slow (`stuck`); something else went wrong (`tool-trouble`); or it did well (`praise`).
   - **Where:** Inspect, Build, the grade, the pane, or one of its agents.
   - **What Imagineer said or did, and what actually happened.** Ask for a concrete case.
3. **Record it**, as behaviour only, with no code, file contents, names of people or secrets: `$F record --repo $R --kind <kind> --area <inspect|build|grade|mod|agent> --said "<what Imagineer said or did>" --happened "<what actually happened>"`. For a flag from step 1, add `--rule <its rule>` so repeats are grouped.
4. **Show and offer to share.** Run `$F share --id <n>` and show the user the exact text. Ask whether to share it with Imagineer's maintainer:
   - **Open a GitHub issue:** give them the link; they review it in their browser and press Submit themselves. Nothing is sent by you.
   - **Save as a file** (no GitHub account): `$F share --id <n> --file <path>`, and say where it is.
   - **Keep it on this machine only.**
   Let them edit or shorten the text first if they want; record the edited version as a new entry.
