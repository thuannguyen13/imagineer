// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { applyMutant, offset, targetMutants } from './prove.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = 'export function canSubmit(user, expense) {\n  return expense.owner === user && expense.status === "draft"\n}\n'
let nextId = 0
const mutant = (replacement, start, end, status = 'Survived') => ({ id: String(nextId++), mutatorName: 'x', replacement, status, location: { start: { line: 2, column: start }, end: { line: 2, column: end } } })
// "expense.owner === user" spans columns 10 to 32 on line 2.
const OWNER_CHECK = mutant('true', 10, 32)
const STATUS_CHECK = mutant('true', 36, 62)

test('offsets and mutants use 1-based lines and columns, end exclusive', () => {
  assert.equal(SOURCE.slice(offset(SOURCE, { line: 2, column: 10 }), offset(SOURCE, { line: 2, column: 32 })), 'expense.owner === user')
  assert.match(applyMutant(SOURCE, OWNER_CHECK), /return true && expense\.status/)
  assert.match(applyMutant(SOURCE, STATUS_CHECK), /=== user && true\n/)
})

test('a question targets only the unnoticed breaks on its lines', () => {
  const report = { files: { 'src/rules.mjs': { mutants: [OWNER_CHECK, mutant('false', 10, 32, 'Killed'), { ...OWNER_CHECK, location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } } }] } } }
  assert.equal(targetMutants(report, ['mutant:src/rules.mjs:2', 'unused-file:x:']).length, 1)
})

function setup(testBody) {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-prove-'))
  const repo = join(root, 'repo')
  const out = join(repo, '.claude/imagineer/runs/1')
  const copy = join(root, 'imagineer-copy')
  for (const dir of [join(copy, 'src'), join(out, 'tests/test')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(copy, 'src/rules.mjs'), SOURCE)
  writeFileSync(join(out, 'copy.json'), JSON.stringify({ path: copy, commit: 'abc1234' }))
  writeFileSync(join(out, 'mutation.json'), JSON.stringify({ files: { 'src/rules.mjs': { mutants: [OWNER_CHECK, STATUS_CHECK] } } }))
  writeFileSync(join(out, 'tests/test/q1.test.mjs'), testBody)
  writeFileSync(
    join(repo, '.claude/imagineer/questions.json'),
    JSON.stringify({ schema: 1, critical: [], dismissed: {}, questions: [{ id: 'Q1', topic: 'permissions', status: 'answered', about: ['mutant:src/rules.mjs:2'] }] }),
  )
  const prove = () =>
    spawnSync('node', [join(HERE, 'prove.mjs'), '--repo', repo, '--out', out, '--id', 'Q1', '--file', 'test/q1.test.mjs', '--run', 'node --test test/q1.test.mjs'], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) })
  const ledger = () => JSON.parse(readFileSync(join(repo, '.claude/imagineer/questions.json'), 'utf8'))
  return { root, prove, ledger }
}

const header = "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { canSubmit } from '../src/rules.mjs'\n"

test('a test that passes now and catches every break proves the answer', t => {
  const { root, prove, ledger } = setup(
    header + "test('only the owner submits a draft', () => {\n  assert.equal(canSubmit('bob', { owner: 'alice', status: 'draft' }), false)\n  assert.equal(canSubmit('alice', { owner: 'alice', status: 'submitted' }), false)\n  assert.equal(canSubmit('alice', { owner: 'alice', status: 'draft' }), true)\n})\n",
  )
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const result = prove()
  assert.equal(result.status, 0, result.stderr)
  const { questions, dismissed } = ledger()
  assert.deepEqual(questions[0].test.red, { killed: 2, total: 2, missed: [] })
  assert.ok(!existsSync(join(root, 'imagineer-copy/test/q1.test.mjs')), 'the proof test is removed from the copy')
  assert.equal(questions[0].test.green, true)
  assert.ok('mutant:src/rules.mjs:2' in dismissed)
})

test('a test that misses a break is recorded as not yet proof', t => {
  const { root, prove, ledger } = setup(header + "test('owner only', () => {\n  assert.equal(canSubmit('bob', { owner: 'alice', status: 'draft' }), false)\n})\n")
  t.after(() => rmSync(root, { recursive: true, force: true }))
  prove()
  const { questions, dismissed } = ledger()
  assert.equal(questions[0].test.red.killed, 1)
  assert.equal(questions[0].test.red.total, 2)
  assert.equal(questions[0].test.red.missed[0].mutant, `src/rules.mjs#${STATUS_CHECK.id}`)
  assert.ok(!('mutant:src/rules.mjs:2' in dismissed))
})

test('a break recorded as unobservable is not held against the test', () => {
  const report = { files: { 'src/rules.mjs': { mutants: [OWNER_CHECK, STATUS_CHECK] } } }
  const equivalent = { [`src/rules.mjs#${STATUS_CHECK.id}`]: 'Only the message text changes.' }
  assert.equal(targetMutants(report, ['mutant:src/rules.mjs:2'], equivalent).length, 1)
})

test('a test that fails on the code as it is shows the code does not match the answer', t => {
  const { root, prove, ledger } = setup(header + "test('submitted can be resubmitted', () => {\n  assert.equal(canSubmit('alice', { owner: 'alice', status: 'submitted' }), true)\n})\n")
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const result = prove()
  assert.match(result.stdout, /does not do what the answer says/)
  assert.equal(ledger().questions[0].test.green, false)
})
