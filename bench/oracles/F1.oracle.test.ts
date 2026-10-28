import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideExpense } from '../src/approvals.ts';
import { alice, dave, setup } from './_helpers.ts';

test('F1: an approver cannot decide another team’s expense', async () => {
  const { db, submitted, statusOf } = await setup();
  const expense = await submitted(alice, 'Team A only');
  await assert.rejects(decideExpense(db, dave, expense.id, 'approved'), { status: 404 });
  assert.equal(await statusOf(expense.id), 'submitted');
});
