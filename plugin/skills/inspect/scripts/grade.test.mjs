// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foundations, gradeRun, intent, markPending, mutationScore, overall, structure, testStrength } from './grade.mjs'
import { addQuestions, answerQuestion, emptyLedger, matches, openQuestions } from './questions.mjs'
import { detect } from './detect.mjs'

const mutants = (killed, survived, other = {}) => ({
  files: {
    'src/a.ts': {
      mutants: [
        ...Array.from({ length: killed }, () => ({ status: 'Killed' })),
        ...Array.from({ length: survived }, () => ({ status: 'Survived' })),
        ...Object.entries(other).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status }))),
      ],
    },
  },
})

const stryker = { ok: true, measured: 'default' }

test('mutation score counts timeouts as caught and ignores errors', () => {
  const { caught, total } = mutationScore(mutants(3, 1, { Timeout: 1, NoCoverage: 1, CompileError: 2, Ignored: 3 }))
  assert.equal(caught, 4)
  assert.equal(total, 6)
})

test('test strength uses Stryker bands: 80% strong, 60% weak, below failing', () => {
  assert.equal(testStrength({ stryker, mutation: mutants(8, 2) }).state, 'strong')
  assert.equal(testStrength({ stryker, mutation: mutants(79, 21) }).state, 'weak')
  assert.equal(testStrength({ stryker, mutation: mutants(6, 4) }).state, 'weak')
  assert.equal(testStrength({ stryker, mutation: mutants(59, 41) }).state, 'failing')
})

test('test strength names the weakest files', () => {
  const report = {
    files: {
      'src/server.ts': { mutants: [{ status: 'Survived' }, { status: 'NoCoverage' }] },
      'src/db.ts': { mutants: [{ status: 'Killed' }] },
    },
  }
  assert.deepEqual(testStrength({ stryker, mutation: report }).items, ['src/server.ts: 0% of planted bugs caught'])
})

test('no tests at all fails test strength; a run that never happened is not checked', () => {
  assert.equal(testStrength({ stryker: { ok: false, skipped: 'No test command.' } }).state, 'failing')
  assert.equal(testStrength({}).state, 'unchecked')
  assert.equal(testStrength({ stryker: { ok: false } }).state, 'unchecked')
})

const fallow = score => ({
  ok: true,
  measured: 'default',
  health: { health_score: { score, grade: 'B' }, findings: [], vital_signs: { duplication_pct: 0 } },
  check: {},
})
const unused = n => Array.from({ length: n }, (_, i) => ({ key: `unused-file:public/${i}.js:`, kind: 'unused-file', file: `public/${i}.js` }))

test('structure: clean and 70 or more is strong, findings make it weak, below 55 fails', () => {
  assert.equal(structure({ fallow: fallow(85), findings: [] }).state, 'strong')
  assert.equal(structure({ fallow: fallow(85), findings: unused(2) }).state, 'weak')
  assert.equal(structure({ fallow: fallow(60), findings: [] }).state, 'weak')
  assert.equal(structure({ fallow: fallow(50), findings: [] }).state, 'failing')
  assert.match(structure({ fallow: fallow(81), findings: unused(2) }).summary, /2 unused files; not yet reviewed with you/)
})

test('structure: findings the user resolved no longer count', () => {
  const ledger = {
    ...emptyLedger(),
    questions: [{ id: 'Q1', status: 'answered' }, { id: 'Q2', status: 'decided' }],
    dismissed: { 'unused-file:public/0.js:': { question: 'Q1' }, 'unused-file:public/1.js:': { question: 'Q2' } },
  }
  const result = structure({ fallow: fallow(81), findings: unused(2), ledger })
  assert.equal(result.state, 'strong')
  assert.match(result.summary, /1 finding resolved with you, 1 settled from the repo's docs or code/)
})

const good = {
  detect: { lockfile: 'package-lock.json', typescript: true, ci: { runsTests: true }, env: { missing: [], example: '.env.example' } },
  copy: { install: { ok: true } },
  checks: { typecheck: { present: true, ok: true }, test: { present: true, ok: true } },
}

test('foundations: all present is strong, gaps are weak, failing tests fail', () => {
  assert.equal(foundations(good).state, 'strong')
  assert.equal(foundations({ ...good, detect: { ...good.detect, ci: { runsTests: false } } }).state, 'weak')
  assert.equal(foundations({ ...good, checks: { ...good.checks, test: { present: true, ok: false } } }).state, 'failing')
  const missingEnv = foundations({ ...good, detect: { ...good.detect, env: { missing: ['API_KEY'], example: '.env.example' } } })
  assert.equal(missingEnv.summary, 'API_KEY not in .env.example.')
})

const dim = (group, state, name = `${group}-${state}`) => ({ group, state, name })

test('overall is the weakest link, never an average', () => {
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'failing'), dim('care', 'strong')]).state, 'failing')
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'unchecked')]).state, 'not-proven')
  assert.equal(overall([dim('trust', 'failing'), dim('trust', 'unchecked')]).state, 'failing')
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'weak')]).state, 'weak')
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'strong')]).state, 'strong')
})

test('care dimensions pull the overall down to weak, never to failing', () => {
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'failing')]).state, 'weak')
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'weak')]).state, 'weak')
})

test('detect finds env variables missing from .env.example, and no docs', t => {
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
  writeFileSync(join(repo, 'src/app.js'), 'const a = process.env.API_KEY; const b = process.env["PORT"]; const c = process.env.NODE_ENV')
  writeFileSync(join(repo, '.env.example'), 'PORT=3000\n')
  const facts = detect(repo)
  assert.deepEqual(facts.env.missing, ['API_KEY'])
  assert.equal(facts.docs.level, 'none')
  assert.equal(facts.scripts.test, null)
  assert.equal(facts.lockfile, null)
})

// A check, asked blind: possible outcomes, one of them what the app does today (unmarked).
const ask = (topic, extra = {}) => ({
  topic,
  point: 'What should happen to deal notes when someone loses Pipeline access?',
  example: 'Bo is on the Acme deal and moves to Marketing, with no Pipeline access.',
  outcomes: [
    { label: 'Bo can no longer read them', means: 'Notes follow Pipeline access.' },
    { label: 'Bo keeps reading them', means: 'Anyone still on the deal reads its notes.' },
  ],
  today: 1,
  actual: 'Bo still reads every note on the Acme deal.',
  ...extra,
})

test('questions are ranked data, money, permissions, behaviour, wording', () => {
  const ledger = addQuestions(emptyLedger(), [ask('wording'), ask('behaviour'), ask('permissions'), ask('data')])
  assert.deepEqual(openQuestions(ledger).map(q => q.topic), ['data', 'permissions', 'behaviour', 'wording'])
  assert.deepEqual(ledger.questions.map(q => q.id), ['Q1', 'Q2', 'Q3', 'Q4'])
})

test('a check needs an example, two or three outcomes, and which one the app does today', () => {
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { example: '' })]), /example/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { outcomes: [{ label: 'only one', means: 'x' }] })]), /two or three outcomes/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { today: 5 })]), /"today" names the outcome/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { actual: '' })]), /needs "actual"/)
  assert.equal(addQuestions(emptyLedger(), [ask('data', { today: 'Bo keeps reading them' })]).questions[0].today, 1)
  assert.throws(() => addQuestions(emptyLedger(), [ask('security')]), /Unknown topic/)
})

test('intent: not checked, then failing while a critical question is open, then weak until tested', () => {
  assert.equal(intent({ ledger: emptyLedger() }).state, 'unchecked')
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('wording')])
  assert.equal(intent({ ledger }).state, 'failing')
  assert.equal(intent({ ledger }).summary, '2 questions: 2 waiting. 1 about data, money or permissions still need your answer.')
  assert.equal(intent({ ledger }).items.length, 2)
  pick(ledger, { id: 'Q1', choice: 'Bo keeps reading them' })
  assert.equal(intent({ ledger }).state, 'weak')
  answerQuestion(ledger, { id: 'Q2', status: 'deferred', answer: null, reason: 'Later.' })
  const resolved = intent({ ledger })
  assert.equal(resolved.state, 'weak')
  assert.equal(resolved.summary, '2 questions: 1 matched what the app does, 1 deferred. None of your answers is proven by a test yet.')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 2, total: 3 } }
  assert.equal(intent({ ledger }).state, 'weak')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 3, total: 3 } }
  assert.equal(intent({ ledger }).state, 'strong')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: false, red: null }
  const gap = intent({ ledger })
  assert.equal(gap.state, 'failing')
  assert.match(gap.summary, /does not yet do what you said for 1 question\./)
  assert.match(gap.items[0], /^Q1: /)
})

test('deferring or deciding needs a reason', () => {
  const ledger = addQuestions(emptyLedger(), [ask('data')])
  assert.throws(() => answerQuestion(ledger, { id: 'Q1', status: 'deferred' }), /needs a reason/)
})

test('critical code must meet the threshold on its own, with every surviving break explained', () => {
  const report = {
    files: {
      'src/auth.ts': { mutants: [{ status: 'Killed', location: { start: { line: 1 } } }, { status: 'Survived', location: { start: { line: 17 } } }] },
      'src/other.ts': { mutants: Array.from({ length: 18 }, () => ({ status: 'Killed', location: { start: { line: 1 } } })) },
    },
  }
  const ledger = { ...emptyLedger(), critical: ['src/auth.ts'] }
  assert.equal(testStrength({ stryker, mutation: report }).state, 'strong')
  assert.equal(testStrength({ stryker, mutation: report, ledger }).state, 'failing')
  report.files['src/auth.ts'].mutants.unshift(...Array.from({ length: 8 }, () => ({ status: 'Killed', location: { start: { line: 2 } } })))
  const weak = testStrength({ stryker, mutation: report, ledger })
  assert.equal(weak.state, 'weak')
  assert.match(weak.summary, /1 line with planted bugs not yet explained/)
  ledger.dismissed['mutant:src/auth.ts:17'] = { question: 'Q4', reason: 'Only the message text changes.' }
  assert.equal(testStrength({ stryker, mutation: report, ledger }).state, 'strong')
})

test('globs: * stays in a folder, ** crosses folders', () => {
  assert.ok(matches('src/*.ts', 'src/auth.ts'))
  assert.ok(!matches('src/*.ts', 'src/lib/auth.ts'))
  assert.ok(matches('src/**', 'src/lib/auth.ts'))
})

import { dataSafety, security, stopBar } from './grade.mjs'

const attackRow = (id, round, category, result) => ({ id, round, category, result, title: `${id} title`, void: null })

test('security: unchecked until attacked or scanned; a break fails it; otherwise weak while secrets are unscanned', () => {
  assert.equal(security({ ledger: emptyLedger() }).state, 'unchecked')
  const held = [attackRow('A1', 1, 'permissions', 'held'), attackRow('A2', 2, 'permissions', 'held')]
  const clean = security({ ledger: emptyLedger(), attacks: held, security: { candidates: [], audit: { high: 0, critical: 0 } } })
  assert.equal(clean.state, 'weak')
  assert.match(clean.summary, /secrets not scanned yet/)
  assert.doesNotMatch(clean.summary, /have not yet come back clean/)
  const broke = security({ ledger: emptyLedger(), attacks: [...held, attackRow('A3', 3, 'permissions', 'broke')] })
  assert.equal(broke.state, 'failing')
  assert.equal(broke.summary, '1 attack broke through.')
  assert.deepEqual(broke.items, ['A3: A3 title'])
})

test('security: a high vulnerability in a shipped dependency fails it', () => {
  assert.equal(security({ ledger: emptyLedger(), security: { candidates: [], audit: { high: 1, critical: 0 } } }).state, 'failing')
})

test('a voided attack does not count', () => {
  const attacks = [{ ...attackRow('A1', 1, 'data', 'broke'), void: 'The test imported the wrong module.' }]
  assert.equal(dataSafety({ ledger: emptyLedger(), attacks }).state, 'unchecked')
})

test('data safety notes that backups are not drilled yet', () => {
  const result = dataSafety({ ledger: emptyLedger(), attacks: [attackRow('A1', 1, 'data', 'held')] })
  assert.equal(result.state, 'weak')
  assert.match(result.summary, /backup restore not drilled/)
})

test('the finish thresholds need strong tests, clean structure and two clean attack rounds', () => {
  const dims = [{ id: 'test-strength', state: 'strong' }, { id: 'structure', state: 'strong' }]
  assert.deepEqual(stopBar(dims, [attackRow('A1', 1, 'data', 'broke'), attackRow('A2', 2, 'data', 'held')]).missing, ['two attack rounds in a row that find nothing new'])
  assert.equal(stopBar(dims, [attackRow('A1', 1, 'data', 'broke'), attackRow('A2', 2, 'data', 'held'), attackRow('A3', 3, 'permissions', 'held')]).met, true)
  assert.equal(stopBar([{ id: 'test-strength', state: 'weak' }, { id: 'structure', state: 'strong' }], []).met, false)
})

import { askInput, decide, dialogFor, notSure, pick, plainLanguageProblem, shuffled } from './questions.mjs'

test('questions are plain language: code goes in detail, never in what the user reads', () => {
  assert.equal(plainLanguageProblem('Bo can still read deal notes after losing Pipeline access.'), null)
  assert.equal(plainLanguageProblem('canReadNote lets him in'), 'a code name in camelCase')
  assert.equal(plainLanguageProblem('see features/notes/rules.ts'), 'a file name')
  assert.equal(plainLanguageProblem('canSeeOpportunity(deal) is true'), 'a function call')
  assert.equal(plainLanguageProblem('it is in `rules`'), 'backticks')
  assert.equal(plainLanguageProblem('line :14 is wrong'), 'a line number')
  assert.throws(() => addQuestions(emptyLedger(), [ask('permissions', { actual: 'canReadNote never checks it.' })]), /code details in "detail"/)
  const ledger = addQuestions(emptyLedger(), [ask('permissions', { detail: 'canReadNote (features/notes/rules.ts:14) uses canSeeOpportunity.' })])
  assert.match(ledger.questions[0].detail, /rules\.ts:14/)
})

test('every option says what it means for people or data', () => {
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { outcomes: [{ label: 'Yes', means: '' }, { label: 'No', means: 'x' }] })]), /needs "means"/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { point: 'x'.repeat(120) })]), /at most 100 characters/)
})

test('a check is asked blind: the point and an example, outcomes unmarked, and always Not sure', () => {
  const ledger = addQuestions(emptyLedger(), [ask('permissions')])
  const dialog = dialogFor(ledger.questions[0])
  assert.equal(dialog.header, 'Q1 Access')
  assert.equal(
    dialog.question,
    'What should happen to deal notes when someone loses Pipeline access?\n\nFor example: Bo is on the Acme deal and moves to Marketing, with no Pipeline access.\n\nWhat should happen?',
  )
  // Nothing says what the app does today, or which answer is recommended.
  assert.doesNotMatch(JSON.stringify(dialog), /Today|today|recommended|still reads/)
  assert.deepEqual(new Set(dialog.options.map(o => o.label)), new Set(['Bo can no longer read them', 'Bo keeps reading them', 'Not sure']))
  assert.equal(dialog.options.at(-1).label, 'Not sure')
  assert.ok(dialog.header.length <= 12)
  const input = askInput(addQuestions(emptyLedger(), [ask('wording'), ask('data'), ask('money'), ask('behaviour'), ask('permissions')]))
  assert.equal(input.questions.length, 4)
  assert.equal(input.metadata.source, 'imagineer')
  assert.deepEqual(input.questions.map(q => q.header.split(' ')[1]), ['Data', 'Money', 'Access', 'Behaviour'])
})

test('Not sure keeps the question open with a new example', () => {
  const ledger = addQuestions(emptyLedger(), [ask('permissions')])
  notSure(ledger, { id: 'Q1', example: 'Sam, an intern with no Pipeline access, opens a client he once covered.' })
  assert.equal(ledger.questions[0].status, 'open')
  assert.equal(ledger.questions[0].notSure, 1)
  assert.match(dialogFor(ledger.questions[0]).question, /For example: Sam, an intern/)
  assert.throws(() => notSure(ledger, { id: 'Q1', example: 'canReadNote returns true' }), /camelCase/)
})

test('detect: CI that runs the test command directly counts, and named env examples count', t => {
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, '.github/workflows'), { recursive: true })
  mkdirSync(join(repo, 'lib'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
  writeFileSync(join(repo, '.github/workflows/checks.yml'), 'jobs:\n  tests:\n    steps:\n      - run: npx vitest run --shard=${{ matrix.shard }}/3\n')
  writeFileSync(join(repo, 'lib/db.ts'), 'const url = process.env.DATABASE_URL; const onVercel = process.env.VERCEL; const env = process.env.VERCEL_ENV')
  writeFileSync(join(repo, '.env.local.example'), 'DATABASE_URL=postgres://localhost/app\n')
  const facts = detect(repo)
  assert.equal(facts.ci.runsTests, true)
  assert.equal(facts.env.example, '.env.local.example')
  assert.deepEqual(facts.env.missing, [])
})

test('test strength: a run where most planted bugs timed out says nothing, and is never Strong', () => {
  const report = { files: { 'lib/permissions.ts': { mutants: [...Array.from({ length: 728 }, () => ({ status: 'Timeout' })), { status: 'Killed' }] } } }
  const result = testStrength({ stryker: { ok: true, measured: 'default' }, mutation: report })
  assert.equal(result.state, 'unchecked')
  assert.match(result.summary, /728 of 729 planted bugs timed out/)
  const rare = { files: { 'a.ts': { mutants: [...Array.from({ length: 95 }, () => ({ status: 'Killed' })), ...Array.from({ length: 5 }, () => ({ status: 'Timeout' }))] } } }
  assert.equal(testStrength({ stryker: { ok: true, measured: 'default' }, mutation: rare }).state, 'strong')
})

test('test strength says when tests that need a database did not run', () => {
  const report = { files: { 'a.ts': { mutants: [{ status: 'Killed' }, { status: 'Survived', location: { start: { line: 1 } } }] } } }
  const result = testStrength({ stryker: { ok: true, measured: 'default' }, mutation: report, detect: { tests: { files: 200, needSetting: 43 } } })
  assert.match(result.summary, /43 test files run only with a setting this copy did not have/)
})

test('detect counts test files that skip themselves without a setting', t => {
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'lib'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }))
  writeFileSync(join(repo, 'lib/a.test.ts'), 'describe.skipIf(!process.env.DATABASE_URL)("db", () => {})')
  writeFileSync(join(repo, 'lib/b.test.ts'), 'it("plain", () => {})')
  assert.deepEqual(detect(repo).tests, { files: 2, needSetting: 1 })
})

import { metricFor } from './grade.mjs'

test('every area\'s number has one shape: done/total and its good outcome', () => {
  const report = { files: { 'a.ts': { mutants: [...Array.from({ length: 48 }, () => ({ status: 'Killed' })), ...Array.from({ length: 3 }, () => ({ status: 'Survived', location: { start: { line: 1 } } }))] } } }
  const metric = (d, evidence) => {
    const { value, label } = metricFor(d, evidence)
    return `${value} ${label}`
  }
  assert.equal(metric({ id: 'test-strength', state: 'strong', summary: '' }, { mutation: report, stryker: { ok: true } }), '48/51 planted bugs caught')
  // The pane's phrase: plain words, no tool names.
  assert.equal(metricFor({ id: 'test-strength', state: 'strong', summary: '' }, { mutation: report, stryker: { ok: true } }).text, '48 of 51 planted bugs caught')
  assert.equal(metricFor({ id: 'structure', state: 'weak', summary: '' }, { fallow: { health: { health_score: { score: 63.6 } } } }).text, 'code health 63.6 of 100')
  assert.equal(metric({ id: 'test-strength', state: 'unchecked', summary: '728 of 729 planted bugs timed out' }, { mutation: report }), '— runs timed out')
  const attacks = [attackRow('A1', 1, 'permissions', 'broke'), attackRow('A2', 1, 'permissions', 'held'), attackRow('A3', 2, 'data', 'held')]
  assert.equal(metric({ id: 'security', state: 'failing', summary: '' }, { attacks, security: { audit: { critical: 1, high: 6 } } }), '1/2 attacks held')
  assert.equal(metric({ id: 'data-safety', state: 'weak', summary: '' }, { attacks }), '1/1 attacks held')
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('data')])
  assert.equal(metric({ id: 'intent', state: 'failing', summary: '' }, { ledger }), '— no answers yet')
  pick(ledger, { id: 'Q1', choice: 'Bo keeps reading them' })
  pick(ledger, { id: 'Q2', choice: 'Bo keeps reading them' })
  ledger.questions[1].test = { green: true, red: { killed: 2, total: 2 } }
  assert.equal(metric({ id: 'intent', state: 'weak', summary: '' }, { ledger }), '1/2 answers proven')
  assert.equal(metric({ id: 'structure', state: 'weak', summary: '' }, { fallow: { health: { health_score: { score: 87.5 } } } }), '87.5/100 Fallow health')
})

import { testStrengthNeeds } from './grade.mjs'

test('what test strength still needs names the real reason, with today\'s number', () => {
  const mutant = (status, line = 1, id = String(line)) => ({ id, status, location: { start: { line } } })
  const report = {
    files: {
      'lib/deal-scope.ts': { mutants: [mutant('Killed', 1), mutant('Killed', 2), mutant('Killed', 3), mutant('Survived', 16), mutant('Survived', 24), mutant('Survived', 28)] },
      'lib/identity.ts': { mutants: Array.from({ length: 45 }, (_, i) => mutant('Killed', i + 1)) },
    },
  }
  const ledger = { ...emptyLedger(), critical: ['lib/deal-scope.ts', 'lib/identity.ts'] }
  assert.deepEqual(testStrengthNeeds({ stryker: { ok: true }, mutation: report, ledger }), [
    'every planted bug in critical code caught or explained (3 left in lib/deal-scope.ts, 50% caught)',
  ])
  const weak = { files: { 'a.ts': { mutants: [mutant('Killed', 1), mutant('Survived', 2), mutant('Survived', 3)] } } }
  assert.deepEqual(testStrengthNeeds({ stryker: { ok: true }, mutation: weak }), ['tests that catch at least 80% of planted bugs (now 33%)'])
  assert.deepEqual(testStrengthNeeds({}), ['a measurement of test strength (not measured yet)'])
})

test('while Inspect runs, areas it has not reached yet are coming up, not "not checked"', () => {
  const out = mkdtempSync(join(tmpdir(), 'imagineer-pending-'))
  try {
    writeFileSync(join(out, 'fallow.json'), JSON.stringify({ ok: false }))
    const running = gradeRun(out, null, 'running').dimensions
    const byId = Object.fromEntries(running.map(d => [d.id, d]))
    // Fallow ran and failed: that is a result, not something still to come.
    assert.equal(byId.structure.pending, false)
    assert.match(byId.structure.summary, /could not run/)
    for (const id of ['test-strength', 'foundations', 'security', 'data-safety', 'intent']) {
      assert.equal(byId[id].pending, true, id)
      assert.equal(byId[id].state, 'unchecked', id)
      assert.equal(byId[id].summary, 'Inspect gets to this later in this run.')
    }
    // Once the run is done, nothing is coming up: what was not measured is not checked.
    assert.ok(gradeRun(out, null, 'done').dimensions.every(d => d.pending === false))
    assert.ok(gradeRun(out, null, 'waiting').dimensions.every(d => d.pending === false))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('test strength the user chose not to measure is not checked, with the reason, and not coming up', () => {
  const d = testStrength({ stryker: { ok: false, declined: 'it would take about 45 minutes' } })
  assert.equal(d.state, 'unchecked')
  assert.equal(d.summary, 'Not measured this time: it would take about 45 minutes')
  assert.equal(markPending([d], { stryker: { ok: false, declined: 'x' } }, 'running')[0].pending, false)
})

test('a pick that matches what the app does is answered; one that differs becomes a gap, asked next', () => {
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('permissions')])
  assert.equal(pick(ledger, { id: 'Q1', choice: 'bo keeps reading them' }).matched, true)
  assert.equal(ledger.questions[0].status, 'answered')
  assert.equal(ledger.questions[0].answer, 'Bo keeps reading them')
  assert.equal(pick(ledger, { id: 'Q2', choice: 'Bo can no longer read them' }).matched, false)
  assert.equal(ledger.questions[1].status, 'gap')
  assert.throws(() => pick(ledger, { id: 'Q2', choice: 'x' }), /is gap, not open/)
  assert.throws(() => answerQuestion(ledger, { id: 'Q1', status: 'answered', answer: 'x' }), /is a check: record the user's pick/)

  // Only now is today's behaviour shown, with the fix recommended.
  const dialog = dialogFor(ledger.questions[1])
  assert.match(dialog.question, /You said: Bo can no longer read them\. Notes follow Pipeline access\.\nToday: Bo still reads every note on the Acme deal\.\n\nFix it, or keep it as it is\?$/)
  assert.deepEqual(dialog.options.map(o => o.label), ['Fix it (recommended)', 'Keep it as it is', 'Not sure'])
  assert.equal(dialog.options[1].description, 'Anyone still on the deal reads its notes.')
  // Gaps come first in the next ask.
  addQuestions(ledger, [ask('data')])
  assert.deepEqual(askInput(ledger).questions.map(q => q.header), ['Q2 Access', 'Q3 Data'])
})

test('a gap the user wants fixed counts against their intent at once; one they keep is answered as it is', () => {
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('wording')])
  pick(ledger, { id: 'Q1', choice: 'Bo can no longer read them' })
  pick(ledger, { id: 'Q2', choice: 'Bo can no longer read them' })
  assert.equal(intent({ ledger }).state, 'failing')
  decide(ledger, { id: 'Q2', decision: 'keep' })
  assert.equal(ledger.questions[1].answer, 'Bo keeps reading them')
  decide(ledger, { id: 'Q1', decision: 'fix' })
  const graded = intent({ ledger })
  assert.equal(graded.state, 'failing')
  assert.equal(graded.summary, '2 questions: 1 differs and you want it fixed, 1 differs, kept as it is. The app does not yet do what you said for 1 question.')
  assert.equal(graded.items[0], 'Q1: What should happen to deal notes when someone loses Pipeline access? (you said: Bo can no longer read them)')
  assert.throws(() => decide(ledger, { id: 'Q1', decision: 'fix' }), /not a gap/)
})

test('their own words need the Lead to say whether they describe what the app does today', () => {
  const ledger = addQuestions(emptyLedger(), [ask('data')])
  assert.throws(() => pick(ledger, { id: 'Q1', choice: 'Only managers keep them', own: true }), /--matches yes\|no/)
  assert.equal(pick(ledger, { id: 'Q1', choice: 'Only managers keep them', own: true, matches: false }).matched, false)
  assert.equal(ledger.questions[0].ownWords, true)
  assert.match(dialogFor(ledger.questions[0]).question, /You said: Only managers keep them\n/)
})

test('outcomes may not give the answer away', () => {
  for (const label of ['Keep it as it is', 'Recommended: Bo loses them', 'What happens today']) {
    const outcomes = [{ label, means: 'x y' }, { label: 'Bo loses them', means: 'Notes follow access.' }]
    assert.throws(() => addQuestions(emptyLedger(), [ask('data', { outcomes, today: 1 })]), /gives the answer away/, label)
  }
  assert.throws(() => addQuestions(emptyLedger(), [{ ...ask('data'), expectation: 'x' }]), /asks blind/)
})

test('the outcomes are not always in the same place: today\'s is not always first or last', () => {
  const three = { outcomes: [{ label: 'One', means: 'a b' }, { label: 'Two', means: 'c d' }, { label: 'Three', means: 'e f' }], today: 0 }
  const ledger = addQuestions(emptyLedger(), [ask('data', three), ask('data', three), ask('data', three)])
  const firsts = ledger.questions.map(q => shuffled(q)[0].label)
  assert.equal(new Set(firsts).size, 3)
})

test('a choice is for the big picture or something new: suggestions, the recommended first', () => {
  const ledger = addQuestions(emptyLedger(), [
    {
      kind: 'choice',
      topic: 'permissions',
      point: 'Which parts of the product handle money, personal data or who may do what?',
      suggestions: [
        { label: 'Sign-in', means: 'Who can get in, and as whom.' },
        { label: 'Roles and permissions', means: 'Who may see or change what.' },
      ],
      multi: true,
    },
  ])
  const dialog = dialogFor(ledger.questions[0])
  assert.equal(dialog.question, 'Which parts of the product handle money, personal data or who may do what?')
  assert.equal(dialog.multiSelect, true)
  assert.deepEqual(dialog.options.map(o => o.label), ['Sign-in', 'Roles and permissions', 'Not sure'])
  answerQuestion(ledger, { id: 'Q1', status: 'answered', answer: 'Sign-in' })
  assert.equal(intent({ ledger }).summary, '1 question: 1 answered by you. None of your answers is proven by a test yet.')
})

test('a question still open from before 0.3.0 is asked in its old layout', () => {
  const ledger = emptyLedger()
  ledger.questions.push({
    id: 'Q1', topic: 'data', status: 'open', point: 'Old point.', expectation: 'Old expectation.', actual: 'Old actual.', example: 'Old example.',
    suggestions: [{ label: 'A', means: 'a' }, { label: 'B', means: 'b' }],
  })
  const dialog = dialogFor(ledger.questions[0])
  assert.match(dialog.question, /^Old point\.\n\nYou'd expect: Old expectation\./)
  assert.deepEqual(dialog.options.map(o => o.label), ['A', 'B', 'Not sure'])
})

import { finishProgress } from './grade.mjs'

test('each finish condition still carries the numbers a pane from before 0.5.0 draws as bars', () => {
  const report = { files: { 'a.ts': { mutants: [...Array.from({ length: 61 }, () => ({ status: 'Killed' })), ...Array.from({ length: 39 }, (_, i) => ({ id: String(i), status: 'Survived', location: { start: { line: i + 1 } } }))] } } }
  const byId = id => ({ 'test-strength': { state: 'failing' }, structure: { state: 'weak' } })[id]
  const ledger = { ...emptyLedger(), dismissed: { 'unused-file:a.ts:': { question: 'Q1' } } }
  const findings = [
    { key: 'unused-file:a.ts:', kind: 'unused-file' },
    { key: 'complex:b.ts:3', kind: 'complex' },
    { key: 'mutant:a.ts:1', kind: 'mutant' },
  ]
  // The fields a pane from before 0.5.0 reads, still written.
  const old = ({ label, done, total, met, text }) => ({ label, done, total, met, text })
  const [tests, structure, attacks] = finishProgress(byId, 1, { stryker: { ok: true }, mutation: report, ledger, findings }).map(old)
  assert.deepEqual(tests, { label: 'Planted bugs caught', done: 61, total: 80, met: false, text: '61% of 80%' })
  assert.deepEqual(structure, { label: 'Code quality reviewed', done: 1, total: 2, met: false, text: '1 of 2 findings' })
  assert.deepEqual(attacks, { label: 'Clean attack rounds', done: 1, total: 2, met: false, text: '1 of 2 in a row' })
  assert.equal(finishProgress(byId, 3, {})[2].done, 2)
})

import { recordUntested, untestedNow } from './attack.mjs'

test('what the latest attack round did not reach is listed, never read as safe', () => {
  const ledger = { attacks: [], untested: {} }
  recordUntested(ledger, { round: 1, category: 'permissions', what: "exporting another team's report" })
  recordUntested(ledger, { round: 1, category: 'data', what: 'two people editing one deal at once' })
  recordUntested(ledger, { round: 2, category: 'permissions', what: 'the admin settings page' })
  // The latest round's list is what is still untested: round 2 reached the export.
  assert.deepEqual(untestedNow(ledger), [{ category: 'permissions', what: 'the admin settings page' }])
  assert.throws(() => recordUntested(ledger, { round: 3, category: 'money', what: 'x' }), /Category/)

  const held = [{ id: 'A1', round: 1, category: 'permissions', result: 'held' }, { id: 'A2', round: 1, category: 'data', result: 'held' }]
  const s = security({ attacks: held, untested: untestedNow(ledger) })
  assert.match(s.summary, /1 part not attacked yet/)
  assert.deepEqual(s.items, ['Not attacked yet: the admin settings page'])
  assert.doesNotMatch(dataSafety({ attacks: held, untested: untestedNow(ledger) }).summary, /not attacked yet/)
  // An area no attack has reached yet still lists what is known to be untested.
  const round1 = { 1: ledger.untested['1'] }
  assert.deepEqual(dataSafety({ attacks: [], untested: untestedNow({ untested: round1 }) }).items, ['Not attacked yet: two people editing one deal at once'])
})

test('test strength is graded against the thresholds in force, and says whose they are', () => {
  const caught = n => ({ files: { 'a.ts': { mutants: [...Array.from({ length: n }, () => ({ status: 'Killed' })), ...Array.from({ length: 100 - n }, (_, i) => ({ id: String(i), status: 'Survived', location: { start: { line: i + 1 } } }))] } } })
  const stryker = { ok: true, measured: 'default' }
  // 70%: Weak by Imagineer's 80 (within 20 below), Strong by a user's 65, At risk by a user's 95.
  const imagineer = testStrength({ stryker, mutation: caught(70) })
  assert.equal(imagineer.state, 'weak')
  assert.match(imagineer.summary, /Imagineer suggests at least 80%\./)
  const lenient = testStrength({ stryker, mutation: caught(70), thresholds: { tests: 65, critical: 80, bySetting: true } })
  assert.equal(lenient.state, 'strong')
  assert.match(lenient.summary, /You set at least 65%\./)
  assert.equal(testStrength({ stryker, mutation: caught(70), thresholds: { tests: 95, critical: 95, bySetting: true } }).state, 'failing')
  const steps = finishProgress(() => ({ state: 'weak' }), 0, { stryker, mutation: caught(70), thresholds: { tests: 65, critical: 80, bySetting: true } })
  assert.deepEqual([steps[0].done, steps[0].total, steps[0].text], [65, 65, '70% of 65%'])
})

test('test strength that could not run says so and why, names the failing tests, and is never "not measured yet"', () => {
  const stryker = { ok: false, error: 'some tests fail under the test strength tool, though they pass in a normal run', failingTests: ['features/audit/writing-actions.test.ts'] }
  const d = testStrength({ stryker })
  assert.equal(d.state, 'unchecked')
  assert.equal(d.summary, 'Could not run: Some tests fail under the test strength tool, though they pass in a normal run.')
  assert.deepEqual(d.items, ['features/audit/writing-actions.test.ts'])
  assert.equal(metricFor(d, { stryker }).text, 'could not run')
  assert.deepEqual(testStrengthNeeds({ stryker }), ['a measurement of test strength (the last one could not run)'])
  const byId = id => (id === 'test-strength' ? d : undefined)
  assert.equal(finishProgress(byId, 0, { stryker })[0].text, 'could not run')

  // Skipped by the user, and not reached yet, each say their own thing.
  const declined = { ok: false, declined: 'it would take about 45 minutes' }
  assert.equal(metricFor(testStrength({ stryker: declined }), { stryker: declined }).text, 'skipped this time')
  assert.equal(finishProgress(byId, 0, { stryker: declined })[0].text, 'skipped this time')
  assert.equal(finishProgress(byId, 0, {})[0].text, 'not measured yet')
})

test('every finish threshold\'s label fits the pane\'s label column, so none is cut off', () => {
  // The pane gives each bar's label 22 columns (plugin/hooks/register.tsx).
  const byId = () => ({ state: 'weak' })
  const report = { files: { 'a.ts': { mutants: [{ status: 'Killed' }, { status: 'Survived', location: { start: { line: 1 } } }] } } }
  for (const evidence of [{}, { stryker: { ok: true }, mutation: report }]) {
    for (const step of finishProgress(byId, 0, evidence)) assert.ok(step.label.length <= 22, `"${step.label}" is ${step.label.length} columns, more than 22`)
  }
})

test('the finish conditions are a threshold, a countdown and a streak, each met, open, blocked or pending', () => {
  const byId = id => ({ 'test-strength': { state: 'weak' }, structure: { state: 'weak' } })[id]
  const report = { files: { 'a.ts': { mutants: [...Array.from({ length: 61 }, () => ({ status: 'Killed' })), ...Array.from({ length: 39 }, () => ({ status: 'Survived', location: { start: { line: 1 } } }))] } } }
  const findings = [{ key: 'f1', kind: 'unused-file' }, { key: 'f2', kind: 'complex' }, { key: 'f3', kind: 'unused-export' }]
  const ledger = { ...emptyLedger(), dismissed: { f1: { question: 'Q1' } } }
  const [tests, structure, attacks] = finishProgress(byId, 1, { stryker: { ok: true }, mutation: report, findings, ledger })
  assert.deepEqual([tests.kind, tests.state, tests.goal, tests.value, tests.target, tests.note], ['threshold', 'open', 'Tests catch 80% of planted bugs', 61, 80, '61% now'])
  assert.deepEqual([structure.kind, structure.state, structure.value, structure.note], ['countdown', 'open', 2, '2 left of 3'])
  assert.deepEqual([attacks.kind, attacks.state, attacks.value, attacks.note], ['streak', 'open', 1, '1 of 2 in a row'])

  // Not measured because it cannot be: blocked, and why. Not measured yet: pending.
  const [noTests] = finishProgress(byId, 0, { stryker: { ok: false, skipped: 'no test command' } })
  assert.deepEqual([noTests.state, noTests.note, noTests.value], ['blocked', "can't measure: no test command", null])
  const [later, notYet] = finishProgress(() => undefined, 0, {})
  assert.deepEqual([later.state, notYet.state], ['pending', 'pending'])
  assert.equal(finishProgress(byId, 2, {})[2].state, 'met')
})
