# Plan: expense approvals

## Outcome
Approvers decide their team's submitted expenses; admins decide any team's. Decisions are final.

## Facts verified (file:line)
- Visibility is enforced by row-level security through `asUser` (`src/db.ts`), policies in `src/schema.sql`.
- `submitExpense` (`src/expenses.ts`) shows the house pattern: check scope, check the rule, then a write that only succeeds while the row is still in the expected state, in one transaction.
- The app role can read only `id, name, role, team` of `users` (`src/schema.sql`).

## Brief requirements
- **R1** An approver can approve or reject a submitted expense of their own team.
- **R2** An admin can approve or reject a submitted expense of any team.
- **R3** Members cannot decide expenses, and no one can decide their own expense.
- **R4** Only submitted expenses can be decided, and a decision is final.
- **R5** The approval queue lists submitted expenses the user may decide, with owner name, amount, description and date; no email or bank details.
- **R6** The Approve and Reject buttons appear exactly where the server would accept the action.

## Where it applies
| Row | Files |
|---|---|
| Decide and queue | `src/approvals.ts`, `src/server.ts`, `src/schema.sql` (decision rule) |
| Buttons | `public/app.js`, `public/index.html` |
| Tests | `test/approval.test.ts` |
| Docs | `docs/product.md`, `docs/permissions.md`, `docs/data-model.md`, `docs/glossary.md` |

Excluded: editing after a decision, notifications (out of scope in `docs/product.md`).

## Shared mechanism
Reuse `asUser` for scope and the check-then-conditional-write pattern from `submitExpense`. No new permission mechanism.

## Behaviour rules
Permission, then record scope, then the rule, inside one transaction, before any write. A record the user cannot see gets "Expense not found."

## Tests
Unit tests per R-ID in `test/approval.test.ts`; server refusal for members, own expense, drafts and decided expenses.

## Order of work
1. `src/approvals.ts` with tests. 2. Routes. 3. Buttons. 4. Docs.

## Open questions
None.
