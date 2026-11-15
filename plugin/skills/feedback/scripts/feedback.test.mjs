// Run: node --test 'plugin/skills/feedback/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fingerprint, issueFor, selfCheck } from './feedback.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-feedback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

const proven = { id: 'Q8', topic: 'behaviour', status: 'answered', expectation: 'A description is required.', test: { green: true, red: { killed: 4, total: 4 } } }

test('a quiet run raises no flags', t => {
  assert.deepEqual(selfCheck(repo(t, { '.claude/imagineer/questions.json': { questions: [proven] } })), [])
})

test('an answer proven by a test but broken by an attack is a grade contradiction', t => {
  const root = repo(t, {
    '.claude/imagineer/questions.json': { questions: [proven] },
    '.claude/imagineer/runs/3/attacks.json': { attacks: [{ id: 'A7', about: 'Q8', result: 'broke', void: null }] },
  })
  const [flag] = selfCheck(root)
  assert.equal(flag.kind, 'grade-contradiction')
  assert.match(flag.said, /Q8 was proven by a test, yet attack A7 broke/)
  assert.equal(flag.fingerprint, fingerprint('grade-contradiction', 'inspect', 'Q8:A7'))
})

test('role-guard refusals and tools that did not run are flagged', t => {
  const root = repo(t, {
    '.claude/imagineer/denials.jsonl': '{"agent":"dev","tool":"Write","reason":"x"}\n{"agent":"dev","tool":"Write","reason":"y"}\n',
    '.claude/imagineer/runs/2/fallow.json': { ok: false },
    '.claude/imagineer/runs/2/stryker.json': { ok: false, skipped: 'No test command.' },
    '.claude/imagineer/build/approvals/state.json': { rounds: [1, 2, 3, 4].map(round => ({ round, bar: { met: false } })) },
  })
  const kinds = selfCheck(root).map(f => `${f.kind}:${f.rule}`)
  assert.deepEqual(kinds.sort(), ['rule-broken:dev:Write', 'tool-trouble:fallow'])
})

test('a reach for a database is one flag per agent, whichever tool it came through', t => {
  const line = (agent, tool, reason) => JSON.stringify({ agent, tool, kind: 'database', reason })
  const root = repo(t, {
    '.claude/imagineer/denials.jsonl': [
      line('attacker', 'Read', '.env.local is an env file, which the attacker never reads.'),
      line('attacker', 'attack.mjs', 'the command sets DATABASE_URL, which says where a database is or how to sign in to it'),
      line('lead', 'prove.mjs', 'the command reads an env file (.env)'),
      JSON.stringify({ agent: 'attacker', tool: 'Bash', reason: 'This command runs git push.' }),
    ].join('\n'),
  })
  const flags = selfCheck(root)
  assert.deepEqual(flags.map(f => `${f.kind}:${f.rule}`).sort(), ['rule-broken:attacker:Bash', 'rule-broken:attacker:database', 'rule-broken:lead:database'])
  assert.equal(
    flags.find(f => f.rule === 'attacker:database').said,
    'The attacker agent reached 2 times for a database or outside the copy, and was refused (first: .env.local is an env file, which the attacker never reads).',
  )
  assert.match(flags.find(f => f.rule === 'lead:database').said, /^Inspect reached once for a database/)
})

test('questions answered mostly in the user’s own words, or asked twice, are flagged', t => {
  const q = (id, own, expectation = `Question ${id} about something distinct`) => ({ id, status: 'answered', ownWords: own, expectation })
  const root = repo(t, {
    '.claude/imagineer/questions.json': {
      questions: [q('Q1', true), q('Q2', true), q('Q3', true), q('Q4', false), q('Q5', false, 'My guess (no docs found): Question Q1 about something distinct')],
    },
  })
  const rules = selfCheck(root).map(f => f.rule)
  assert.ok(rules.includes('own-words'))
  assert.ok(rules.includes('repeated'))
})

test('a shared record is behaviour only, short, and opens a pre-filled issue the user submits', () => {
  const issue = issueFor({ kind: 'miss', area: 'inspect', said: 'Security: Weak, nothing broke', happened: 'A member approved an expense.', imagineer: '0.7.0', fingerprint: 'abc123def456' })
  assert.equal(issue.title, 'Feedback: miss in inspect')
  assert.ok(issue.body.length <= 1500)
  const url = new URL(issue.url)
  assert.equal(url.pathname, '/thuannguyen13/imagineer/issues/new')
  assert.equal(url.searchParams.get('labels'), 'feedback')
  assert.match(url.searchParams.get('body'), /A member approved an expense\./)
})

test('the role guard records each refusal for the self-check', t => {
  const root = repo(t, {})
  const guard = join(HERE, '../../../hooks/role-guard.mjs')
  const payload = JSON.stringify({ cwd: root, agent_type: 'imagineer:verifier', tool_name: 'Write', tool_input: { file_path: `${root}/src/a.ts` } })
  spawnSync('node', [guard], { input: payload, encoding: 'utf8' })
  const [line] = readFileSync(join(root, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n')
  assert.equal(JSON.parse(line).agent, 'verifier')
  assert.equal(selfCheck(root)[0].kind, 'rule-broken')
})

test('feedback is recorded locally with the Imagineer version and a fingerprint', t => {
  const home = mkdtempSync(join(tmpdir(), 'imagineer-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const run = (...args) => spawnSync('node', [join(HERE, 'feedback.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, IMAGINEER_HOME: home } })
  assert.equal(run('record', '--kind', 'miss', '--area', 'inspect', '--said', 'Said Strong', '--happened', 'It broke').status, 0)
  assert.match(run('list').stdout, /#1 .* miss\/inspect/)
  assert.match(run('share', '--id', '1').stdout, /issues\/new\?/)
  assert.notEqual(run('record', '--kind', 'bug', '--area', 'inspect', '--said', 'x').status, 0)
})

test('a mutation run where most breaks timed out is flagged as tool trouble', t => {
  const root = repo(t, {
    '.claude/imagineer/runs/1/mutation.json': { files: { 'lib/a.ts': { mutants: [...Array.from({ length: 30 }, () => ({ status: 'Timeout' })), { status: 'Killed' }] } } },
  })
  const [f] = selfCheck(root)
  assert.equal(f.rule, 'stryker-timeouts')
  assert.match(f.said, /30 of 31 breaks timed out/)
})

test('a test strength check the user chose to skip is not Imagineer going wrong; a failed one says why', t => {
  const declined = repo(t, { '.claude/imagineer/runs/2/stryker.json': { ok: false, declined: 'it would take about 45 minutes' } })
  assert.deepEqual(selfCheck(declined), [])
  const failed = repo(t, { '.claude/imagineer/runs/3/stryker.json': { ok: false, error: '\nError: Could not find a test runner for "vitest".\n  at x' } })
  const [flag] = selfCheck(failed)
  assert.equal(flag.kind, 'tool-trouble')
  assert.equal(flag.said, 'The test strength check failed in Inspect run 3: Error: Could not find a test runner for "vitest".')
})

test("a test strength check that failed is flagged, even where only the estimate recorded it or it was recorded as the user's skip", t => {
  const output = ' FAIL  features/audit/writing-actions.test.ts > uses every action\n10:00:00 (1) ERROR Stryker There were failed tests in the initial test run.'
  const onlyEstimate = repo(t, { '.claude/imagineer/runs/3/stryker-estimate.json': { ok: false, output } })
  assert.equal(selfCheck(onlyEstimate)[0]?.said, 'The test strength check failed in Inspect run 3: some tests fail under the test strength tool, though they pass in a normal run')
  const maskedAsSkip = repo(t, {
    '.claude/imagineer/runs/2/stryker-estimate.json': { ok: false, output },
    '.claude/imagineer/runs/2/stryker.json': { ok: false, declined: 'Some tests fail when run under the test-strength tool' },
  })
  assert.equal(selfCheck(maskedAsSkip)[0]?.rule, 'stryker')
})
