# G3 — dev uses production data
**Seeded:** `src/config.ts` uses `data/prod` in every environment.
**Must report:** checklist item 3 failing; consequence: running the app locally reads and changes real data.
