# F1 — missing record scope
**Seeded:** `decideExpense` runs in `db.transaction` instead of `asUser`, so row-level security does not apply. An approver of team B can decide team A's submitted expenses.
**Must report:** Critical (forbidden access reachable by a default role), R1/R2 FAIL, tied to `src/approvals.ts` `decideExpense`.
**Oracle:** `bench/oracles/F1.oracle.test.ts`.
