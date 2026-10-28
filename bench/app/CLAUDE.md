# Expenses (bench fixture)

Team members record expenses and submit them for approval. Docs: `docs/product.md`, `docs/permissions.md`, `docs/data-model.md`.

## Commands

- Tests: `npm test`
- Typecheck: `npm run typecheck`
- Dev server: `PORT=3200 npm start` (dev data in `data/dev`)
- Backup: `npm run backup`

## Environments

- Dev: `APP_ENV=dev` (default), data in `data/dev`.
- Prod: `APP_ENV=prod`, data in `data/prod`. Agents never use prod.
- Secrets come from environment variables (`.env.example` lists them). The browser only receives `public/config.js`.

## Forge setup

| Key | Value |
|---|---|
| `checks` | `npm test`, `npm run typecheck` |
| `fast-checks` | `npm test` |
| `deps` | `npm install` |
| `framework-docs` | n/a |
| `constraints` | Server checks permission, then record scope, then the business rule, inside one transaction, before any write |
| `db-check` | n/a (in-process PGlite; tests create their own database) |
| `qa-server` | `PORT=3210 npm start` |
| `qa-driver` | n/a |
| `qa-sign-in` | `x-user-id` header with the user's id (see `docs/permissions.md`) |
| `board` | n/a |
| `test-prefix` | `zz-` |
