# When the repository has no docs

Read when `detect.json` says `docs.level` is `none` or `thin`, before the big-picture questions, and again at the docs step. Paths: `$S` is `${CLAUDE_SKILL_DIR}/scripts`, `$R` the repository's absolute path, `$O` the run folder.


When `detect.json` says `docs.level` is `none` or `thin`, the user is the only source of intent, and the docs are something Inspect produces, not something it reads.

- **Never treat the code as intent.** Code written by prompting can be wrong; describing its behaviour as intended would make its bugs official. Checks are asked blind for this reason: the user says what should happen before seeing what the code does.
- **The big-picture questions come first and matter most**: their answers rank every later question.
- **Save what was confirmed.** At the end of the run, ask once whether to write the confirmed answers as short docs in the repository. If yes, write, in plain language and only from answers the user gave (`status: answered`), never from guesses:
  - `docs/product.md`: what the app is for, who uses it, what must never happen;
  - `docs/permissions.md`: the roles and what each may and may not do;
  - `docs/data.md`: what data the app keeps, what is sensitive, and the rules about it;
  - `docs/decisions.md`: each answer as a dated decision, with its question ID.
  Then add a short "Project docs" section to `CLAUDE.md` (create it if missing) pointing to them, so later AI sessions read them. Never commit them. Anything not confirmed stays out.
- Without a user, list the docs you would write and their outline, and write nothing.
