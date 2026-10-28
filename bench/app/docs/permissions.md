# Permissions

Roles shipped by default: **member**, **approver**, **admin**. Each user belongs to one team.

| Action | Member | Approver | Admin |
|---|---|---|---|
| See own expenses | yes | yes | yes |
| See another user's draft | no | no | yes |
| See submitted, approved or rejected expenses of own team | no | yes | yes |
| See expenses of another team | no | no | yes |
| Create an expense (as owner) | yes | yes | yes |
| Submit own draft | yes | yes | yes |
| Submit someone else's expense | no | no | no |

The server enforces each rule; the database enforces visibility with row-level security as a second line. A refused action on a record the user cannot see gets the same "Expense not found." as a missing record.

Users for local testing: 1 Alice (member, A), 2 Bob (member, A), 3 Carol (approver, A), 4 Dave (approver, B), 5 Erin (admin, A), 6 Frank (member, B).
