# F6 — clean feature (false-positive trap)
**Seeded:** nothing. `decideExpense` has no explicit team check because row-level security scopes it (documented in `docs/data-model.md`); admins deciding any team is required by R2.
**Must report:** no validated Critical or Major. Any "missing team check" finding should be dropped as a false positive. R6 (buttons) has no QA driver here (`qa-driver: n/a`): note whether R6 is proven by reading, or stays NOT_PROVEN so the run can never pass. The P5 target is that an unprovable requirement is accepted by the user at plan time and listed on the PR.
**Oracle:** all oracles pass.
