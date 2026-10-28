import { openDb } from '../src/db.ts';
import type { User } from '../src/auth.ts';
import { createExpense, listExpenses, submitExpense } from '../src/expenses.ts';

export const alice: User = { id: 1, name: 'Alice', role: 'member', team: 'A' };
export const carol: User = { id: 3, name: 'Carol', role: 'approver', team: 'A' };
export const dave: User = { id: 4, name: 'Dave', role: 'approver', team: 'B' };
export const erin: User = { id: 5, name: 'Erin', role: 'admin', team: 'A' };

export async function setup() {
  const db = await openDb();
  const submitted = async (owner: User, description: string) => {
    const expense = await createExpense(db, owner, { amount_cents: 1000, description });
    return submitExpense(db, owner, expense.id);
  };
  const statusOf = async (id: number) => (await listExpenses(db, erin)).find((e) => e.id === id)?.status;
  return { db, submitted, statusOf };
}
