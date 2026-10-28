import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExpense } from '../src/expenses.ts';
import { decideExpense } from '../src/approvals.ts';
import { alice, carol, erin, setup } from './_helpers.ts';

test('F5: drafts cannot be decided and decisions are final', async () => {
  const { db, submitted, statusOf } = await setup();
  const draft = await createExpense(db, alice, { amount_cents: 500, description: 'Draft' });
  await assert.rejects(decideExpense(db, erin, draft.id, 'approved'), { status: 409 });
  const expense = await submitted(alice, 'Meal');
  await decideExpense(db, carol, expense.id, 'rejected');
  await assert.rejects(decideExpense(db, carol, expense.id, 'approved'), { status: 409 });
  assert.equal(await statusOf(expense.id), 'rejected');
});
