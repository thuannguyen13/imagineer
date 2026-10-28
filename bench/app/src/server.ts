import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { config } from './config.ts';
import { openDb, type Db } from './db.ts';
import { currentUser, HttpError } from './auth.ts';
import { createExpense, listExpenses, submitExpense } from './expenses.ts';

type Route = (db: Db, req: IncomingMessage, params: string[]) => Promise<unknown>;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'Send valid JSON.');
  }
}

const user = (db: Db, req: IncomingMessage) => currentUser(db, req.headers['x-user-id'] as string | undefined);

const routes: [string, RegExp, Route][] = [
  ['GET', /^\/api\/expenses$/, async (db, req) => listExpenses(db, await user(db, req))],
  ['POST', /^\/api\/expenses$/, async (db, req) => {
    const input = await body(req);
    return createExpense(db, await user(db, req), { amount_cents: input.amount_cents, description: input.description });
  }],
  ['POST', /^\/api\/expenses\/(\d+)\/submit$/, async (db, req, [id]) => submitExpense(db, await user(db, req), Number(id))],
];

const staticFiles: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/config.js': 'config.js' };

export function handler(db: Db) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://local').pathname;
    const file = staticFiles[path];
    if (req.method === 'GET' && file) {
      const type = file.endsWith('.js') ? 'text/javascript' : 'text/html';
      res.writeHead(200, { 'content-type': type }).end(await readFile(new URL(`../public/${file}`, import.meta.url)));
      return;
    }
    for (const [method, pattern, route] of routes) {
      const match = req.method === method ? pattern.exec(path) : null;
      if (!match) continue;
      try {
        const result = await route(db, req, match.slice(1));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        const message = error instanceof HttpError ? error.message : 'Something went wrong.';
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
      }
      return;
    }
    res.writeHead(404).end();
  };
}

if (import.meta.main) {
  const db = await openDb(config.dataDir);
  createServer(handler(db)).listen(config.port, () => console.log(`${config.env} server on http://localhost:${config.port}`));
}
