// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// What the first field test on a real app (aperia-esg, 2026-11-15) asked for: attack breaks tied to
// the questions they repeat, breaks the user kept not counted as failing, saying when finishing is
// out of reach, named vulnerable packages, a starter README read as no docs, test strength with no
// tests, and the retro recording by itself.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canStillFinish, isNewBreak, rounds } from './attack.mjs'
import { dataSafety, testStrength } from './grade.mjs'
import { emptyLedger } from './questions.mjs'
import { auditPackages } from './measure.mjs'
import { isStarterReadme } from './layout.mjs'

const attack = (id, round, result, extra = {}) => ({ id, round, category: 'data', title: id, result, void: null, ...extra })

test('a break that tried what an earlier question asked is not new; one linked to a question written after it is', () => {
  assert.equal(isNewBreak(attack('A4', 1, 'broke', { about: 'Q3', questionsBefore: 11 })), false)
  assert.equal(isNewBreak(attack('A9', 2, 'broke', { about: 'Q14', questionsBefore: 11 })), true)
  assert.equal(isNewBreak(attack('A5', 1, 'broke')), true)
  // Round 2 broke only what was asked before: it counts as finding nothing new.
  const r = rounds([attack('A1', 1, 'broke'), attack('A7', 2, 'broke', { about: 'Q4', questionsBefore: 11 }), attack('A8', 2, 'held')])
  assert.equal(r.cleanInARow, 1)
})

test('when the rounds left cannot give two clean rounds in a row, it says finishing is out of reach', () => {
  const broken = round => attack(`A${round}`, round, 'broke')
  assert.deepEqual(canStillFinish([broken(1), broken(2)]), { roundsLeft: 2, possible: true })
  assert.deepEqual(canStillFinish([broken(1), broken(2), broken(3)]), { roundsLeft: 1, possible: false })
  assert.deepEqual(canStillFinish([broken(1), broken(2), attack('A3', 3, 'held')]), { roundsLeft: 1, possible: true })
})

test('breaks the user chose to keep are not failing, and a break repeating a gap to fix is counted once', () => {
  const ledger = {
    ...emptyLedger(),
    questions: [
      { id: 'Q16', topic: 'data', kind: 'check', status: 'answered', matches: true },
      { id: 'Q4', topic: 'data', kind: 'check', status: 'answered', matches: false, decision: 'fix' },
    ],
  }
  const attacks = [attack('A10', 1, 'broke', { about: 'Q16', questionsBefore: 16 }), attack('A7', 1, 'broke', { about: 'Q4', questionsBefore: 16 }), attack('A2', 1, 'held')]
  const result = dataSafety({ ledger, attacks })
  assert.equal(result.state, 'failing')
  assert.doesNotMatch(result.summary, /attacks? broke through/)
  assert.match(result.summary, /the code contradicts 1 answer of yours; 1 break you chose to keep/i)
  const onlyKept = dataSafety({ ledger: { ...ledger, questions: [ledger.questions[0]] }, attacks: [attacks[0], attacks[2]] })
  assert.equal(onlyKept.state, 'weak')
  assert.match(onlyKept.summary, /1 attack held; 1 break you chose to keep/)
})

test('the audit names its packages, worst first, for every package manager\'s output', () => {
  const npm = JSON.stringify({ vulnerabilities: { postcss: { severity: 'high' }, next: { severity: 'critical' }, 'source-map-js': { severity: 'moderate' } } })
  assert.deepEqual(auditPackages('npm', npm), [{ name: 'next', severity: 'critical' }, { name: 'postcss', severity: 'high' }, { name: 'source-map-js', severity: 'moderate' }])
  const pnpm = JSON.stringify({ advisories: { 1: { module_name: 'lodash', severity: 'high' }, 2: { module_name: 'lodash', severity: 'critical' } } })
  assert.deepEqual(auditPackages('pnpm', pnpm), [{ name: 'lodash', severity: 'critical' }])
  assert.deepEqual(auditPackages('yarn', '{"type":"auditAdvisory","data":{"advisory":{"module_name":"minimist","severity":"high"}}}'), [{ name: 'minimist', severity: 'high' }])
  assert.deepEqual(auditPackages('yarn-modern', '{"value":"semver","children":{"Severity":"moderate"}}'), [{ name: 'semver', severity: 'moderate' }])
  assert.deepEqual(auditPackages('npm', 'not json'), [])
})

test('a starter README left as the framework wrote it is not docs about the app; one that names the app is', () => {
  assert.equal(isStarterReadme('# Astro Starter Kit: Minimal\n\n```sh\nnpm create astro@latest\n```', 'aperia-esg'), true)
  assert.equal(isStarterReadme('This is a [Next.js](https://nextjs.org) project bootstrapped with `create-next-app`.', 'shop'), true)
  assert.equal(isStarterReadme('# Shop\n\nBootstrapped with create-next-app. Shop lets staff send quotes.', 'shop'), false)
  assert.equal(isStarterReadme('# Expenses\n\nSubmit and approve expenses.', 'expenses'), false)
})

test('with no tests, test strength says so plainly and stays at risk, and answers can still be proven', () => {
  const mutation = { files: { 'src/a.ts': { mutants: [{ status: 'Survived', location: { start: { line: 1 } } }, { status: 'Survived', location: { start: { line: 2 } } }] } } }
  const result = testStrength({ stryker: { ok: true, measured: 'default', noTests: true }, mutation })
  assert.equal(result.state, 'failing')
  assert.match(result.summary, /^There are no tests, so none of the 2 planted bugs is caught\./)
  assert.match(result.summary, /can still be proven by a new test/)
})

test('the retro records the self-check\'s flags by itself, once per kind of problem and repository', t => {
  const home = mkdtempSync(join(tmpdir(), 'imagineer-retro-home-'))
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-retro-repo-'))
  t.after(() => [home, repo].forEach(d => rmSync(d, { recursive: true, force: true })))
  const feedback = join(dirname(fileURLToPath(import.meta.url)), '../../feedback/scripts/feedback.mjs')
  const guard = join(dirname(fileURLToPath(import.meta.url)), '../../../hooks/role-guard.mjs')
  spawnSync('node', [guard], { input: JSON.stringify({ cwd: repo, agent_type: 'imagineer:verifier', tool_name: 'Write', tool_input: { file_path: `${repo}/src/a.ts` } }), encoding: 'utf8' })
  const env = { ...process.env, IMAGINEER_HOME: home }
  const first = spawnSync('node', [feedback, 'check', '--repo', repo, '--record'], { encoding: 'utf8', env })
  assert.match(first.stdout, /Recorded #1\./)
  const again = spawnSync('node', [feedback, 'check', '--repo', repo, '--record'], { encoding: 'utf8', env })
  assert.doesNotMatch(again.stdout, /Recorded/)
  const log = readFileSync(join(home, 'feedback.jsonl'), 'utf8').trim().split('\n')
  assert.equal(log.length, 1)
  assert.equal(JSON.parse(log[0]).kind, 'rule-broken')
})
