import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asUser } from '../src/db.ts';
import { listQueue } from '../src/approvals.ts';
import { alice, carol, setup } from './_helpers.ts';

test('F4: the queue and the app role expose no email or bank details', async () => {
  const { db, submitted } = await setup();
  await submitted(alice, 'Books');
  const [item] = await listQueue(db, carol);
  assert.ok(item && !('email' in item) && !('reimbursement_account' in item));
  await assert.rejects(asUser(db, carol.id, (tx) => tx.query('select reimbursement_account from users')));
});
