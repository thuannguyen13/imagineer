import type { Db } from './db.ts';

export type Role = 'member' | 'approver' | 'admin';
export type User = { id: number; name: string; role: Role; team: string };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Dev sign-in: the x-user-id header names the user. */
export async function currentUser(db: Db, header: string | undefined): Promise<User> {
  const id = Number(header);
  if (!Number.isInteger(id)) throw new HttpError(401, 'Sign in first.');
  const { rows } = await db.query<User>('select id, name, role, team from users where id = $1', [id]);
  if (!rows[0]) throw new HttpError(401, 'Sign in first.');
  return rows[0];
}
