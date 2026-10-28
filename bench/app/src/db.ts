import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';

export type Db = PGlite;
export type Tx = Transaction;

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Opens the database; no data directory means in memory (tests). */
export async function openDb(dataDir?: string): Promise<Db> {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.exec(schema);
  return db;
}

/** Runs fn in a transaction as the signed-in user, so row-level security applies. */
export function asUser<T>(db: Db, userId: number, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('app.uid', $1, true)`, [String(userId)]);
    await tx.exec('set local role app_user');
    return fn(tx);
  });
}
