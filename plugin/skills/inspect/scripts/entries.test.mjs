// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// The app's server entry points are read from its code, and what the attacks reached is counted
// from the attack tests' code: a way in no attack touched is listed, never read as safe.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coverage, serverEntries } from './entries.mjs'
import { reader, trackedFiles } from './layout.mjs'
import { appEntries, entryCoverage } from './attack.mjs'
import { security } from './grade.mjs'

const BENCH_APP = join(dirname(fileURLToPath(import.meta.url)), '../../../../bench/app')

const FILES = {
  'app/(app)/products/[id]/route.ts': "export async function GET(req: Request) {}\nexport const DELETE = async () => {}\nconst helper = 1\n",
  'features/notes/actions.ts': "'use server'\nimport { db } from '@/db'\nexport async function createNote(text: string) {}\nexport const deleteNote = async (id: string) => {}\n",
  'features/notes/queries.ts': "export async function listNotes() {}\n",
  'pages/api/health.ts': "export default function handler(req, res) { res.send('ok') }\n",
  'src/routes/boards/[id]/+server.ts': "export const POST = async () => {}\n",
  'src/routes/boards/+page.server.ts': "export const load = async () => ({})\nexport const actions = { default: async () => {} }\n",
  'server/router.ts': "router.post('/teams/:id/members', requireAdmin, addMember)\napp.get('/health', (req, res) => res.send('ok'))\n",
  'test/notes.test.ts': "export async function GET() {}\n",
}
const read = path => FILES[path] ?? ''

test('every kind of way into the server is found from the code; plain modules and tests are not', () => {
  const found = serverEntries(Object.keys(FILES), read).map(e => `${e.kind}: ${e.name}`)
  assert.deepEqual(found.sort(), [
    'API route: /api/health',
    'form action: actions src/routes/boards/+page.server.ts',
    'loader: load src/routes/boards/+page.server.ts',
    'route handler: DELETE /products/',
    'route handler: GET /products/',
    'route handler: POST /boards/',
    'route: GET /health',
    'route: POST /teams/:id/members',
    'server action: createNote',
    'server action: deleteNote',
  ])
})

test('the bench app\'s route table is read, and its own tests reach every route', () => {
  const entries = serverEntries(trackedFiles(BENCH_APP).filter(f => f.startsWith('src/')), reader(BENCH_APP))
  assert.deepEqual(entries.map(e => e.name), ['GET /api/expenses', 'POST /api/expenses', 'POST /api/expenses/:id/submit'])
  const reach = coverage(entries, [readFileSync(join(BENCH_APP, 'test/expenses.test.ts'), 'utf8')])
  assert.equal(reach.reached, 3)
})

test('an entry point counts as reached only when an attack test calls it; a shared guard shows nothing', () => {
  const entries = serverEntries(Object.keys(FILES), read)
  const reach = coverage(entries, ["import { createNote } from '../features/notes/actions'\nawait createNote('x')", 'requireAdmin()'])
  assert.equal(reach.reached, 1)
  assert.ok(reach.notReached.some(e => e.name === 'POST /teams/:id/members'))
})

test('attack.mjs counts what the attack tests reached in the app\'s folder, and the grade lists the rest', t => {
  const out = mkdtempSync(join(tmpdir(), 'imagineer-entries-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const copy = join(out, 'copy')
  for (const [path, text] of Object.entries({ ...FILES, 'other/app/actions.ts': "'use server'\nexport async function elsewhere() {}\n" })) {
    mkdirSync(dirname(join(copy, path)), { recursive: true })
    writeFileSync(join(copy, path), text)
  }
  writeFileSync(join(out, 'detect.json'), JSON.stringify({ layout: { app: { dir: '.' } } }))
  const entries = appEntries(out, { path: copy, source: copy })
  writeFileSync(join(out, 'entries.json'), JSON.stringify(entries))
  mkdirSync(join(out, 'attacks/test'), { recursive: true })
  writeFileSync(join(out, 'attacks/test/a1.test.ts'), "await deleteNote('someone-elses')")
  writeFileSync(join(out, 'attacks.json'), JSON.stringify({ attacks: [{ id: 'A1', round: 1, category: 'permissions', title: 'delete another user’s note', file: 'test/a1.test.ts', result: 'held', void: null }] }))

  const reach = entryCoverage(out)
  assert.equal(reach.total, 11)
  assert.equal(reach.reached, 1)

  const attacks = JSON.parse(readFileSync(join(out, 'attacks.json'), 'utf8')).attacks
  const result = security({ attacks, entries: reach, security: { planted: [], candidates: [], audit: { critical: 0, high: 0 } }, findings: [] })
  assert.match(result.summary, /10 of 11 ways into the server not reached by any attack/)
  assert.ok(result.items.includes('Not attacked yet: createNote (features/notes/actions.ts)'))
  // Before any attack, nothing is said to be unreached: the rounds have not started.
  assert.doesNotMatch(security({ attacks: [], entries: reach, security: { audit: {} }, findings: [] }).summary, /not reached/)
})
