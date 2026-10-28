# G1 — access rules off
**Seeded:** row-level security is not enabled on `expenses`; listing relies on it, so every member sees every expense. The tests that would have caught it are gone.
**Must report:** checklist item 1 failing, highest severity, with the consequence in user terms (members can see each other's expenses).
