# F4 — payload and grant leak
**Seeded:** the queue returns owner email and reimbursement account, and `schema.sql` widens the app role to every column of `users`; the feature's own R5 test was weakened.
**Must report:** Critical (approvers, a default role, read email and bank details that `docs/data-model.md` says never leave the server). Major is acceptable while forge's severity text lists "a record leak" separately; P5 must remove that overlap, R5 FAIL, `src/approvals.ts` `listQueue` and `src/schema.sql`.
**Oracle:** `bench/oracles/F4.oracle.test.ts`.
