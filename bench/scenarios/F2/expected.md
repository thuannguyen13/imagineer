# F2 — rule checked after the write
**Seeded:** `decideExpense` writes in one transaction and checks "not your own expense" afterwards; the 403 is returned but the self-approval is saved.
**Must report:** Critical (a default role does what a rule forbids: an approver approves their own expense; `constraints` broken), R3 FAIL, `src/approvals.ts` `decideExpense`.
**Oracle:** `bench/oracles/F2.oracle.test.ts`.
