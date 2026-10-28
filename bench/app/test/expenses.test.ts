import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asUser, openDb } from '../src/db.ts';
import type { User } from '../src/auth.ts';
import { createExpense, listExpenses, submitExpense } from '../src/expenses.ts';

const alice: User = { id: 1, name: 'Alice', role: 'member', team: 'A' };
const bob: User = { id: 2, name: 'Bob', role: 'member', team: 'A' };
const carol: User = { id: 3, name: 'Carol', role: 'approver', team: 'A' };
const dave: User = { id: 4, name: 'Dave', role: 'approver', team: 'B' };
const erin: User = { id: 5, name: 'Erin', role: 'admin', team: 'A' };

test('members see only their own expenses', async () => {
  const db = await openDb();
  await createExpense(db, alice, { amount_cents: 1200, description: 'Taxi' });
  await createExpense(db, bob, { amount_cents: 800, description: 'Lunch' });
  assert.deepEqual((await listExpenses(db, alice)).map((e) => e.description), ['Taxi']);
});

test('approvers see submitted expenses of their own team only; admins see all', async () => {
  const db = await openDb();
  const draft = await createExpense(db, alice, { amount_cents: 500, description: 'Draft' });
  const sent = await createExpense(db, alice, { amount_cents: 700, description: 'Sent' });
  await submitExpense(db, alice, sent.id);
  assert.deepEqual((await listExpenses(db, carol)).map((e) => e.id), [sent.id]);
  assert.deepEqual(await listExpenses(db, dave), []);
  assert.deepEqual((await listExpenses(db, erin)).map((e) => e.id), [draft.id, sent.id]);
});

test('only the owner can submit, and only a draft', async () => {
  const db = await openDb();
  const expense = await createExpense(db, alice, { amount_cents: 900, description: 'Hotel' });
  await assert.rejects(submitExpense(db, bob, expense.id), { status: 404 });
  await submitExpense(db, alice, expense.id);
  await assert.rejects(submitExpense(db, alice, expense.id), { status: 409 });
});

test('row-level security refuses writes the app does not offer', async () => {
  const db = await openDb();
  const mine = await createExpense(db, alice, { amount_cents: 400, description: 'Mine' });
  await submitExpense(db, alice, mine.id);
  const update = (user: User, sql: string) => asUser(db, user.id, (tx) => tx.query(sql, [mine.id]));
  assert.equal((await update(alice, `update expenses set status = 'approved' where id = $1`)).affectedRows, 0);
  assert.equal((await update(carol, `update expenses set status = 'approved' where id = $1`)).affectedRows, 0);
  await assert.rejects(update(alice, `update expenses set amount_cents = 1 where id = $1`));
  await assert.rejects(asUser(db, alice.id, (tx) => tx.query(`insert into expenses (owner_id, team, amount_cents, description) values (1, 'B', 100, 'x')`)));
  await assert.rejects(asUser(db, alice.id, (tx) => tx.query(`insert into expenses (owner_id, team, amount_cents, description, status) values (1, 'A', 100, 'x', 'approved')`)));
});

test('amount must be whole cents above zero', async () => {
  const db = await openDb();
  await assert.rejects(createExpense(db, alice, { amount_cents: 0, description: 'Zero' }), { status: 400 });
  await assert.rejects(createExpense(db, alice, { amount_cents: 1.5, description: 'Half' }), { status: 400 });
});

test('row-level security hides other members’ expenses even from a raw query', async () => {
  const db = await openDb();
  await createExpense(db, bob, { amount_cents: 300, description: 'Bob only' });
  const rows = await asUser(db, alice.id, async (tx) => (await tx.query('select id from expenses')).rows);
  assert.deepEqual(rows, []);
});
