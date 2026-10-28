import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideExpense } from '../src/approvals.ts';
import { carol, setup } from './_helpers.ts';

test('F2: a refused self-approval leaves the expense unchanged', async () => {
  const { db, submitted, statusOf } = await setup();
  const own = await submitted(carol, 'Own');
  await assert.rejects(decideExpense(db, carol, own.id, 'approved'), { status: 403 });
  assert.equal(await statusOf(own.id), 'submitted');
});
