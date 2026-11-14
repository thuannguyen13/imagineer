// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { didNotRun, recordAttack, recordUntested, rounds, untestedNow } from './attack.mjs'
import { security } from './grade.mjs'

const ATTACK = join(dirname(fileURLToPath(import.meta.url)), 'attack.mjs')

const entry = (id, round, result = 'held') => ({ id, round, category: 'permissions', title: `${id} title`, about: null, file: `test/${id}.test.mjs`, run: 'node --test', result, output: '', void: null })

test('a test that was skipped, or did not run, says nothing about the app', () => {
  assert.equal(didNotRun(' Test Files  1 skipped (1)\n      Tests  2 skipped (2)'), 'its test was skipped')
  assert.equal(didNotRun('ℹ tests 0\nℹ pass 0\nℹ skipped 0'), 'no test ran')
  assert.equal(didNotRun('      Tests  1 passed | 2 skipped (3)'), '2 of the tests in that run were skipped')
  assert.equal(didNotRun('      Tests  3 passed (3)'), null)
  assert.equal(didNotRun('No tests found, exiting with code 0'), 'no test ran')
  // A runner whose summary is not known is taken as it ended.
  assert.equal(didNotRun('done'), null)
})

test('an attack whose test did not run is never held: it is listed as not attacked yet', () => {
  const ledger = { attacks: [], untested: {}, notRun: [] }
  recordAttack(ledger, entry('A1', 1))
  recordAttack(ledger, entry('A2', 1), 'its test was skipped')
  assert.deepEqual(ledger.attacks.map(a => a.id), ['A1'])
  assert.deepEqual(ledger.notRun.map(a => [a.id, a.result, a.why]), [['A2', 'not-run', 'its test was skipped']])
  assert.deepEqual(untestedNow(ledger), [{ category: 'permissions', what: 'A2 title (its test was skipped)', id: 'A2' }])
  // It counts in no round, so a round of skipped tests is not a clean round.
  recordAttack(ledger, entry('A3', 2), 'its test was skipped')
  assert.deepEqual(rounds(ledger.attacks).perRound, [{ round: 1, tried: 1, broke: 0 }])
  // It stays listed whatever later rounds say they did not reach.
  recordUntested(ledger, { round: 2, category: 'permissions', what: 'the export page' })
  recordUntested(ledger, { round: 3, category: 'permissions', what: 'the admin settings page' })
  const area = security({ attacks: ledger.attacks, untested: untestedNow(ledger) })
  assert.deepEqual(area.items, ['Not attacked yet: the admin settings page', 'Not attacked yet: A2 title (its test was skipped)', 'Not attacked yet: A3 title (its test was skipped)'])
  assert.match(area.summary, /1 attack held/)

  // Run again under the same ID once it can run: the line goes, the result stands.
  recordAttack(ledger, entry('A3', 2, 'broke'))
  assert.deepEqual(untestedNow(ledger).map(u => u.id), [undefined, 'A2'])
  assert.equal(rounds(ledger.attacks).broke.length, 1)
})

/** A run folder in a repository, with a copy beside it, and attack tests written as the attacker writes them. */
function run(t, tests) {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-attack-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'app')
  const copy = join(root, 'imagineer-copy')
  const out = join(repo, '.claude/imagineer/runs/1')
  mkdirSync(join(out, 'attacks/test'), { recursive: true })
  mkdirSync(copy)
  writeFileSync(join(repo, '.env.local'), 'DATABASE_URL=postgresql://app:hunter2@127.0.0.1:5432/app\n')
  writeFileSync(join(out, 'copy.json'), JSON.stringify({ path: copy, source: repo }))
  for (const [name, body] of Object.entries(tests)) writeFileSync(join(out, 'attacks/test', name), `import { test } from 'node:test'\n${body}\n`)
  const attack = (id, file, command) =>
    spawnSync('node', [ATTACK, 'run', '--out', out, '--round', '1', '--id', id, '--category', 'data', '--title', `${id} title`, '--file', `test/${file}`, '--run', command], { encoding: 'utf8' })
  return { repo, copy, out, attack, ledger: () => JSON.parse(readFileSync(join(out, 'attacks.json'), 'utf8')) }
}

test('attack.mjs: a held attack is held, a skipped one is not attacked, and neither stays in the copy', t => {
  const { copy, attack, ledger } = run(t, {
    'a1.test.mjs': "test('A1: refuses', () => {})",
    'a2.test.mjs': "test('A2: needs a database', { skip: !process.env.DATABASE_URL }, () => {})",
  })
  const held = attack('A1', 'a1.test.mjs', 'node --test test/a1.test.mjs')
  assert.match(held.stdout, /A1 \(data\): the app held/, held.stderr)
  const skipped = attack('A2', 'a2.test.mjs', 'node --test test/a2.test.mjs')
  assert.equal(skipped.status, 0, skipped.stderr)
  assert.match(skipped.stdout, /A2 \(data\): not attacked, because its test was skipped/)
  assert.deepEqual(ledger().attacks.map(a => [a.id, a.result]), [['A1', 'held']])
  assert.deepEqual(ledger().notRun.map(a => [a.id, a.why]), [['A2', 'its test was skipped']])
  assert.deepEqual(ledger().untested, {})
  assert.equal(existsSync(join(copy, 'test/a2.test.mjs')), false)
})

test('attack.mjs: the command that once took a database URL from the env file is refused, recorded, and never run', t => {
  const { repo, copy, out, attack } = run(t, { 'a4.test.mjs': "test('A4', () => {})" })
  const result = attack('A4', 'a4.test.mjs', `export $(grep '^DATABASE_URL=' ${repo}/.env.local | xargs) && node --test test/a4.test.mjs`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Refused: the command reads an env file \(\.env\.local\)/)
  assert.match(result.stderr, /attack\.mjs untested/)
  assert.doesNotMatch(result.stderr + result.stdout, /hunter2/)
  assert.equal(existsSync(join(out, 'attacks.json')), false)
  assert.equal(existsSync(join(copy, 'test/a4.test.mjs')), false)
  const [denial] = readFileSync(join(repo, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual([denial.agent, denial.tool, denial.kind, denial.reason], ['attacker', 'attack.mjs', 'database', 'the command reads an env file (.env.local)'])
})

test('attack.mjs: a database address written into the test is refused before anything runs', t => {
  const { copy, out, attack } = run(t, { 'a5.test.mjs': "process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/app_dev'\ntest('A5', () => {})" })
  const result = attack('A5', 'a5.test.mjs', 'node --test test/a5.test.mjs')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Refused: the test names a database \(postgres:\/\/…\)/)
  assert.equal(existsSync(join(out, 'attacks.json')), false)
  assert.equal(existsSync(join(copy, 'test/a5.test.mjs')), false)
})
