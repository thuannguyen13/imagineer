# Data model

Source of truth: `src/schema.sql`.

- **users:** id, name, email, role (`member` | `approver` | `admin`), team, reimbursement_account. The app role can read only id, name, role and team; email and reimbursement account never leave the server.
- **expenses:** id, owner_id → users, team (the owner's team at creation), amount_cents (> 0), description, status, decided_by → users, decided_at, created_at.

Status moves `draft → submitted`; approving or rejecting is planned (`docs/product.md`).

Row-level security on `expenses`: the owner sees their own; an approver sees their team's non-draft expenses; an admin sees all. New expenses must be the user's own, in their own team, as drafts; the only change allowed is an owner submitting their own draft (`status` is the only column the app role may update). Expense reads and writes run as `app_user` with `app.uid` set to the signed-in user (`asUser` in `src/db.ts`); the sign-in lookup reads only id, name, role and team with full access.
