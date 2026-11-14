# Attack rounds

Read at the attack step. Paths: `$S` is `${CLAUDE_SKILL_DIR}/scripts`, `$R` the repository's absolute path, `$O` the run folder.


Try to break the app on purpose. Before the first round, regrade with `--status running --step "Attack round 1: trying to break permissions and data"`. **Model.** The attacker runs on the model the user chose for Imagineer's agents. Run `node ${CLAUDE_PLUGIN_ROOT}/skills/build/scripts/build.mjs models`. If it says `unset`, ask once, in plain words, and save the choice with `--set <choice>`:
- **Recommended:** the strongest model for planning, testing and attacking, a faster one for writing code. Medium cost.
- **Budget:** the faster model for every role. Lowest cost; attacks may miss more.
- **Maximum:** the strongest model for every role. Highest cost.

Without a user, use the `default` it prints. Spawn the attacker with its `attacker` model.

Each round, spawn the `imagineer:attacker` agent with the Agent tool (model: the `attacker` above) and give it, in its prompt: the copy's path (from `$O/copy.json`), `$O`, `$S`, the round number, the attack IDs to use (six per round, continuing from the last), what the app is for and its roles, the user's answers from the ledger, and the attacks already tried and the parts not yet attacked (`node $S/attack.mjs list --out $O`: `untested`). Point the next round at what is still untested first.

After each round:

1. Run `node $S/attack.mjs list --out $O`. For each attack that broke through, read its test to confirm it is a real break, and add it as a check for the user (topic `permissions` or `data`): the attack's situation as the example, stopping before what happened ("Carol, an approver on team A, opens Dave's expense from team B and presses Approve"), outcomes such as "The app refuses" and "The expense is approved", and `today` the one the attack showed. The user decides; Inspect does not fix it.
   Attacks it lists under `notRun` did not run (their test was skipped, most often for want of a database). They are not held: the grade lists them as not attacked yet, and so does your report, with the reason.
2. Regrade with `--status running --step "Attack round <next>: trying to break permissions and data"` before the next round, or `--step "Cleaning up"` when the rounds are over.
3. **Stop** when 2 rounds in a row find nothing new, after 4 rounds, or when the user says so. Ask before each round after the second.

**After the last round, ask the questions the attacks raised** in one go, as [questions.md](questions.md#asking) describes, before the run ends: a break left unasked waits for the next run, and the grade cannot count it as the user's decision until then.

Without a user, run two rounds, list what broke through, and stop.
