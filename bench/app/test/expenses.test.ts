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
