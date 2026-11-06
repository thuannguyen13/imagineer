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
  assert.deepEqual(testStrength({ stryker, mutation: report }).items, ['src/server.ts: 0% of breaks caught'])
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

const ask = (topic, extra = {}) => ({
  topic,
  point: 'Bo can still read deal notes after losing Pipeline access.',
  expectation: 'Notes follow Pipeline access.',
  actual: 'Anyone still on the deal reads its notes.',
  example: 'Bo moves to Marketing and still reads the Acme notes.',
  suggestions: [
    { label: 'Must not happen', means: 'Bo stops seeing the notes.' },
    { label: 'Fine as it is', means: 'Bo keeps reading them.' },
  ],
  ...extra,
})

test('questions are ranked data, money, permissions, behaviour, wording', () => {
  const ledger = addQuestions(emptyLedger(), [ask('wording'), ask('behaviour'), ask('permissions'), ask('data')])
  assert.deepEqual(openQuestions(ledger).map(q => q.topic), ['data', 'permissions', 'behaviour', 'wording'])
  assert.deepEqual(ledger.questions.map(q => q.id), ['Q1', 'Q2', 'Q3', 'Q4'])
})

test('a question needs an example and at least two suggestions', () => {
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { example: '' })]), /example/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { suggestions: [{ label: 'only one', means: 'x' }] })]), /two or three suggestions/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('security')]), /Unknown topic/)
})

test('intent: not checked, then failing while a critical question is open, then weak until tested', () => {
  assert.equal(intent({ ledger: emptyLedger() }).state, 'unchecked')
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('wording')])
  assert.equal(intent({ ledger }).state, 'failing')
  assert.equal(intent({ ledger }).summary, '2 questions: 2 waiting. 1 about data, money or permissions still need your answer.')
  assert.equal(intent({ ledger }).items.length, 2)
  answerQuestion(ledger, { id: 'Q1', status: 'answered', answer: 'Only the owner.' })
  assert.equal(intent({ ledger }).state, 'weak')
  answerQuestion(ledger, { id: 'Q2', status: 'deferred', answer: null, reason: 'Later.' })
  const resolved = intent({ ledger })
  assert.equal(resolved.state, 'weak')
  assert.equal(resolved.summary, '2 questions: 1 answered by you, 1 deferred. None of your answers is proven by a test yet.')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 2, total: 3 } }
  assert.equal(intent({ ledger }).state, 'weak')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 3, total: 3 } }
  assert.equal(intent({ ledger }).state, 'strong')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: false, red: null }
  const gap = intent({ ledger })
  assert.equal(gap.state, 'failing')
  assert.match(gap.summary, /does not yet do what you answered for 1 question\./)
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
  assert.match(weak.summary, /1 line with breaks not yet explained/)
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

import { askInput, dialogFor, notSure, plainLanguageProblem } from './questions.mjs'

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

test('every suggestion says what it means for people or data', () => {
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { suggestions: [{ label: 'Yes', means: '' }, { label: 'No', means: 'x' }] })]), /needs "means"/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { point: 'x'.repeat(120) })]), /at most 100 characters/)
})

test('the dialog leads with the point, then expectation, today and an example, and always offers Not sure', () => {
  const ledger = addQuestions(emptyLedger(), [ask('permissions')])
  const dialog = dialogFor(ledger.questions[0])
  assert.equal(dialog.header, 'Q1 Access')
  assert.match(dialog.question, /^Bo can still read deal notes after losing Pipeline access\.\n\nYou'd expect: Notes follow Pipeline access\.\nToday: .*\nFor example: .*\n\nWhat should happen\?$/)
  assert.deepEqual(dialog.options.map(o => o.label), ['Must not happen', 'Fine as it is', 'Not sure'])
  assert.equal(dialog.options[0].description, 'Bo stops seeing the notes.')
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

test('test strength: a run where most breaks timed out says nothing, and is never Strong', () => {
  const report = { files: { 'lib/permissions.ts': { mutants: [...Array.from({ length: 728 }, () => ({ status: 'Timeout' })), { status: 'Killed' }] } } }
  const result = testStrength({ stryker: { ok: true, measured: 'default' }, mutation: report })
  assert.equal(result.state, 'unchecked')
  assert.match(result.summary, /728 of 729 breaks timed out/)
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
  assert.equal(metric({ id: 'test-strength', state: 'strong', summary: '' }, { mutation: report, stryker: { ok: true } }), '48/51 breaks caught')
  assert.equal(metric({ id: 'test-strength', state: 'unchecked', summary: '728 of 729 breaks timed out' }, { mutation: report }), '— runs timed out')
  const attacks = [attackRow('A1', 1, 'permissions', 'broke'), attackRow('A2', 1, 'permissions', 'held'), attackRow('A3', 2, 'data', 'held')]
  assert.equal(metric({ id: 'security', state: 'failing', summary: '' }, { attacks, security: { audit: { critical: 1, high: 6 } } }), '1/2 attacks held')
  assert.equal(metric({ id: 'data-safety', state: 'weak', summary: '' }, { attacks }), '1/1 attacks held')
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('data')])
  assert.equal(metric({ id: 'intent', state: 'failing', summary: '' }, { ledger }), '— no answers yet')
  answerQuestion(ledger, { id: 'Q1', status: 'answered', answer: 'x' })
  answerQuestion(ledger, { id: 'Q2', status: 'answered', answer: 'y' })
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
    'every break in critical code caught or explained (3 left in lib/deal-scope.ts, 50% caught)',
  ])
  const weak = { files: { 'a.ts': { mutants: [mutant('Killed', 1), mutant('Survived', 2), mutant('Survived', 3)] } } }
  assert.deepEqual(testStrengthNeeds({ stryker: { ok: true }, mutation: weak }), ['tests that catch at least 80% of deliberate breaks (now 33%)'])
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
