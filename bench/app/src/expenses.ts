import { asUser, type Db } from './db.ts';
import { HttpError, type User } from './auth.ts';

export type Expense = {
  id: number;
  owner_id: number;
  team: string;
  amount_cents: number;
  description: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
};

const columns = 'id, owner_id, team, amount_cents, description, status';
const notFound = () => new HttpError(404, 'Expense not found.');

/** Every expense the user may see; row-level security decides which. */
export function listExpenses(db: Db, user: User): Promise<Expense[]> {
  return asUser(db, user.id, async (tx) => {
    const { rows } = await tx.query<Expense>(`select ${columns} from expenses order by id`);
    return rows;
  });
}

export async function createExpense(db: Db, user: User, input: { amount_cents: unknown; description: unknown }): Promise<Expense> {
  const amount = input.amount_cents;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    throw new HttpError(400, 'Amount must be a whole number of cents above zero.');
  }
  if (!description) throw new HttpError(400, 'Add a description.');
  return asUser(db, user.id, async (tx) => {
    const { rows } = await tx.query<Expense>(
      `insert into expenses (owner_id, team, amount_cents, description) values ($1, $2, $3, $4) returning ${columns}`,
      [user.id, user.team, amount, description],
    );
    return rows[0]!;
  });
}

/** Owner submits their own draft for approval. */
export function submitExpense(db: Db, user: User, id: number): Promise<Expense> {
  return asUser(db, user.id, async (tx) => {
    const { rows } = await tx.query<Expense>(`select ${columns} from expenses where id = $1 for update`, [id]);
    const expense = rows[0];
    if (!expense || expense.owner_id !== user.id) throw notFound();
    if (expense.status !== 'draft') throw new HttpError(409, 'Only drafts can be submitted.');
    const updated = await tx.query<Expense>(
      `update expenses set status = 'submitted' where id = $1 returning ${columns}`,
      [id],
    );
    return updated.rows[0]!;
  });
}
