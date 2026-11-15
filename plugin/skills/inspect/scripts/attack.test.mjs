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
  // With a workspace tool's prefix before each line, or a less common runner.
  assert.equal(didNotRun('web:test:  Tests  3 skipped (3)'), 'its test was skipped')
  assert.equal(didNotRun('  1 test skipped'), 'its test was skipped')
  // No summary to tell by: never held on the exit alone.
  assert.equal(didNotRun('done'), 'the run printed no summary of tests passed and skipped')
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
  assert.deepEqual(rounds(ledger.attacks, ledger.notRun).perRound, [{ round: 1, tried: 1, broke: 0, notRun: 1 }, { round: 2, tried: 0, broke: 0, notRun: 1 }])
  assert.equal(rounds(ledger.attacks, ledger.notRun).cleanInARow, 0)
  // Two rounds where every attack ran and held are clean; one attack that did not run in the later round is not.
  const two = [entry('B1', 1), entry('B2', 2)]
  assert.equal(rounds(two).cleanInARow, 2)
  assert.equal(rounds(two, [{ id: 'B3', round: 2 }]).cleanInARow, 0)
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
  return { root, repo, copy, out, attack, ledger: () => JSON.parse(readFileSync(join(out, 'attacks.json'), 'utf8')) }
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

import { symlinkSync } from 'node:fs'

test('attack.mjs: only a run\'s own folder is one, and a test stays in its folder and in the copy', t => {
  const { repo, copy, out, attack } = run(t, { 'a6.test.mjs': "test('A6', () => {})" })
  writeFileSync(join(repo, 'app.ts'), 'export const x = 1\n')
  mkdirSync(join(copy, 'src'))
  writeFileSync(join(copy, 'src/app.ts'), 'export const x = 1\n')
  const call = (...args) => spawnSync('node', [ATTACK, 'run', '--round', '1', '--id', 'A6', '--category', 'data', '--title', 'A6 title', ...args], { encoding: 'utf8' })

  // A copy.json the attacker wrote under attacks/, naming the repository as the copy.
  mkdirSync(join(out, 'attacks/attacks'), { recursive: true })
  writeFileSync(join(out, 'attacks/copy.json'), JSON.stringify({ path: repo }))
  writeFileSync(join(out, 'attacks/attacks/a6.test.mjs'), "import { test } from 'node:test'\ntest('A6', () => {})\n")
  const forged = call('--out', join(out, 'attacks'), '--file', 'a6.test.mjs', '--run', 'node --test a6.test.mjs')
  assert.match(forged.stderr, /--out is a run's folder/)
  // The same nested deeper, to look like a run's folder.
  const nested = join(out, 'attacks/.claude/imagineer/runs/9')
  mkdirSync(join(nested, 'attacks'), { recursive: true })
  writeFileSync(join(nested, 'copy.json'), JSON.stringify({ path: repo }))
  assert.match(call('--out', nested, '--file', 'a6.test.mjs', '--run', 'node --test a6.test.mjs').stderr, /--out is a run's folder/)
  assert.equal(existsSync(join(repo, 'a6.test.mjs')), false)

  // A path that climbs out of the attacks folder to a file of the repository, which the clean-up would then delete.
  for (const file of ['../../../../app.ts', join(repo, 'app.ts'), '../copy.json']) {
    assert.match(call('--out', out, '--file', file, '--run', 'node --test test/a6.test.mjs').stderr, /--file is a path inside/, file)
  }
  assert.equal(readFileSync(join(repo, 'app.ts'), 'utf8'), 'export const x = 1\n')
  // A test named as a file the copy already has would overwrite it, then delete it.
  mkdirSync(join(out, 'attacks/src'))
  writeFileSync(join(out, 'attacks/src/app.ts'), 'export const x = 2\n')
  assert.match(call('--out', out, '--file', 'src/app.ts', '--run', 'node --test src/app.ts').stderr, /The copy already has a file at src\/app\.ts/)
  assert.equal(readFileSync(join(copy, 'src/app.ts'), 'utf8'), 'export const x = 1\n')
  // A folder of the copy that is a link out of it.
  symlinkSync(repo, join(copy, 'linked'))
  mkdirSync(join(out, 'attacks/linked'))
  writeFileSync(join(out, 'attacks/linked/a6.test.mjs'), "import { test } from 'node:test'\ntest('A6', () => {})\n")
  assert.match(call('--out', out, '--file', 'linked/a6.test.mjs', '--run', 'node --test linked/a6.test.mjs').stderr, /--file is a path inside the copy/)
  assert.equal(existsSync(join(repo, 'a6.test.mjs')), false)

  // Anything but a test runner, however it is dressed.
  for (const command of ['psql -h localhost -U postgres app_dev', 'pwd; cat .e*', `cd ${repo} && node --test`, 'node --test test/a6.test.mjs | tail -3']) {
    const result = attack('A6', 'a6.test.mjs', command)
    assert.equal(result.status, 1, command)
    assert.match(result.stderr, /Refused: the command (does not start a test runner|is more than a test runner)/, command)
  }
  assert.equal(existsSync(join(out, 'attacks.json')), false)
})

test('attack.mjs works when it is started through a link', t => {
  const { root, attack, out } = run(t, { 'a1.test.mjs': "test('A1', () => {})" })
  symlinkSync(dirname(ATTACK), join(root, 'scripts'))
  const linked = spawnSync('node', [join(root, 'scripts/attack.mjs'), 'list', '--out', out], { encoding: 'utf8' })
  assert.match(linked.stdout, /"cleanInARow"/, linked.stderr)
  assert.match(attack('A1', 'a1.test.mjs', 'node --test test/a1.test.mjs').stdout, /the app held/)
})

test('attack.mjs: a runner that cannot start is not a break, and a test an interrupted run left behind does not stop the next', t => {
  const { repo, copy, out, attack, ledger } = run(t, { 'a8.test.mjs': "test('A8', () => {})" })
  // A bare runner name that is not installed: nothing ran, so nothing broke.
  const missing = attack('A8', 'a8.test.mjs', 'vitest run test/a8.test.mjs')
  assert.equal(missing.status, 0, missing.stderr)
  assert.match(missing.stdout, /A8 \(data\): not attacked, because the test runner could not start \(vitest was not found/)
  assert.deepEqual(ledger().attacks, [])
  assert.deepEqual(ledger().notRun.map(a => a.id), ['A8'])
  // A shape of command that is refused is not a reach for a database.
  assert.equal(attack('A8', 'a8.test.mjs', 'cd test && node --test a8.test.mjs').status, 1)
  const denials = readFileSync(join(repo, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(denials.map(d => d.kind), [undefined])

  // An earlier run was stopped between putting its test in the copy and taking it out.
  mkdirSync(join(copy, 'test'), { recursive: true })
  writeFileSync(join(copy, 'test/a8.test.mjs'), 'left behind')
  writeFileSync(join(out, 'placed.json'), JSON.stringify(['test/a8.test.mjs']))
  const again = attack('A8', 'a8.test.mjs', 'node --test test/a8.test.mjs')
  assert.match(again.stdout, /A8 \(data\): the app held/, again.stderr)
  assert.equal(existsSync(join(copy, 'test/a8.test.mjs')), false)
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'placed.json'), 'utf8')), [])
  assert.deepEqual([ledger().attacks.map(a => a.id), ledger().notRun], [['A8'], []])
})
