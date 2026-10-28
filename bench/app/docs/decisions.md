# Decisions

## 2026-10-01 — PGlite in process
One process, no database server to run or secure. Revisit when more than one server process is needed.

## 2026-10-01 — Row-level security as a second line
The server checks every action; the database refuses the same things again, so one missed check in code does not expose data.

## 2026-10-01 — Development sign-in only
Choosing a user by id is refused outside development. Real sign-in is out of scope until there are outside users.

## 2026-10-01 — Separate data folders per environment
`data/dev` and `data/prod`; agents and local runs never open production data.

## 2026-10-01 — File-copy backups with a logged test restore
Backups copy the data folder with the server stopped; each test restore is logged in `ops/restore-log.md`.
