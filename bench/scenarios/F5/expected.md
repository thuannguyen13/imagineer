# F5 — invalid transitions
**Seeded:** no status check: an admin can approve a draft, and any decision can be reversed; the feature's own R4 test was removed.
**Must report:** Critical (a default role does what a rule forbids: approving a draft, reversing a final decision), R4 FAIL, `src/approvals.ts` `decideExpense`.
**Oracle:** `bench/oracles/F5.oracle.test.ts`.
