// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// The verifier's ruling on a possible weakness or an attack's break: it rests on lines of the copy
// that exist, a false alarm is set aside, a confirmed one waits for the user.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emptyLedger, findings, recordVerdict } from './questions.mjs'
import { security } from './grade.mjs'

const QUESTIONS = join(dirname(fileURLToPath(import.meta.url)), 'questions.mjs')
const KEY = 'security:src/notes.ts:2:sql-injection'

/** A repository with one run: its throwaway copy, a security scan with one candidate and one broken attack. */
function run(t) {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-verdict-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'app')
  const copy = join(root, 'imagineer-copy')
  const out = join(repo, '.claude/imagineer/runs/1')
  mkdirSync(out, { recursive: true })
  mkdirSync(join(copy, 'src'), { recursive: true })
  writeFileSync(join(copy, 'src/notes.ts'), "export const find = (db, id) =>\n  db.query(`select * from notes where id = ${id}`)\n")
  writeFileSync(join(out, 'copy.json'), JSON.stringify({ path: copy, source: repo }))
  writeFileSync(join(out, 'security.json'), JSON.stringify({ planted: [], candidates: [{ path: 'src/notes.ts', line: 2, category: 'sql-injection', cwe: 89, severity: 'high', evidence: 'template literal in query' }], audit: {} }))
  writeFileSync(join(out, 'attacks.json'), JSON.stringify({ attacks: [{ id: 'A7', round: 1, category: 'permissions', title: 'read another team’s note', file: 'test/a7.test.ts', result: 'broke', void: null }] }))
  const verdict = (...args) => spawnSync('node', [QUESTIONS, 'verdict', '--repo', repo, '--out', out, ...args], { encoding: 'utf8' })
  return { repo, copy, out, verdict }
}

test('a ruling must cite lines that exist in the copy, about an open finding or a broken attack', t => {
  const { copy, out } = run(t)
  const context = { copyPath: copy, findingKeys: findings(out).map(i => i.key), attacks: JSON.parse(readFileSync(join(out, 'attacks.json'), 'utf8')) }
  const ruling = extra => recordVerdict(emptyLedger(), { key: KEY, verdict: 'real', reason: 'the id comes from the URL', evidence: 'src/notes.ts:2', ...extra }, context)
  assert.throws(() => ruling({ evidence: '' }), /at least one line/)
  assert.throws(() => ruling({ evidence: 'src/notes.ts:40' }), /has 2 lines, not 40/)
  assert.throws(() => ruling({ evidence: 'src/missing.ts:1' }), /not a file of the copy/)
  assert.throws(() => ruling({ evidence: '../../etc/passwd:1' }), /copy/)
  assert.throws(() => ruling({ key: 'security:src/other.ts:1:xss' }), /not an open finding/)
  assert.throws(() => ruling({ key: 'attack:A9' }), /not an attack that broke through/)
  assert.throws(() => ruling({ verdict: 'maybe' }), /real or false-alarm/)
  assert.throws(() => ruling({ reason: ' ' }), /--reason/)
  assert.equal(ruling().ledger.verdicts[KEY].verdict, 'real')
})

test('a false alarm is set aside with its reason; a false-alarm attack is set aside as a wrong test', t => {
  const { repo, out, verdict } = run(t)
  const set = verdict('--key', KEY, '--verdict', 'false-alarm', '--reason', 'Only the app itself passes the id, from its own route', '--evidence', 'src/notes.ts:1')
  assert.equal(set.status, 0, set.stderr)
  const ledger = JSON.parse(readFileSync(join(repo, '.claude/imagineer/questions.json'), 'utf8'))
  assert.deepEqual(ledger.dismissed[KEY], { question: null, by: 'verifier', reason: 'Only the app itself passes the id, from its own route' })

  const attack = verdict('--key', 'attack:A7', '--verdict', 'false-alarm', '--reason', 'The test reads the table directly, which no user can', '--evidence', 'src/notes.ts:2')
  assert.equal(attack.status, 0, attack.stderr)
  const a7 = JSON.parse(readFileSync(join(out, 'attacks.json'), 'utf8')).attacks[0]
  assert.match(a7.void, /The verifier found the test wrong/)
})

test('Security says which weaknesses are confirmed and wait for the user, and which are not yet verified', t => {
  const { out } = run(t)
  const items = findings(out)
  const ledger = { ...emptyLedger(), verdicts: { [KEY]: { verdict: 'real', reason: 'the id comes from the URL', evidence: ['src/notes.ts:2'] } } }
  const confirmed = security({ ledger, findings: items, attacks: [], security: { audit: { critical: 0, high: 0 } } })
  assert.match(confirmed.summary, /1 weakness confirmed in the code, waiting for you/)
  assert.doesNotMatch(confirmed.summary, /not yet verified/)
  assert.match(confirmed.items[0], /^Confirmed: Possible sql-injection/)
  const unchecked = security({ ledger: emptyLedger(), findings: items, attacks: [], security: { audit: { critical: 0, high: 0 } } })
  assert.match(unchecked.summary, /1 possible weakness not yet verified/)
})
