// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foundations, intent, mutationScore, overall, structure, testStrength } from './grade.mjs'
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
  assert.match(testStrength({ stryker, mutation: report }).summary, /Weakest: src\/server\.ts 0%\./)
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

const ask = (topic, extra = {}) => ({ topic, expectation: 'e', actual: 'a', example: 'x', suggestions: ['yes', 'no'], ...extra })

test('questions are ranked data, money, permissions, behaviour, wording', () => {
  const ledger = addQuestions(emptyLedger(), [ask('wording'), ask('behaviour'), ask('permissions'), ask('data')])
  assert.deepEqual(openQuestions(ledger).map(q => q.topic), ['data', 'permissions', 'behaviour', 'wording'])
  assert.deepEqual(ledger.questions.map(q => q.id), ['Q1', 'Q2', 'Q3', 'Q4'])
})

test('a question needs an example and at least two suggestions', () => {
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { example: '' })]), /example/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('data', { suggestions: ['only one'] })]), /two suggestions/)
  assert.throws(() => addQuestions(emptyLedger(), [ask('security')]), /Unknown topic/)
})

test('intent: not checked, then failing while a critical question is open, then weak until tested', () => {
  assert.equal(intent({ ledger: emptyLedger() }).state, 'unchecked')
  const ledger = addQuestions(emptyLedger(), [ask('permissions'), ask('wording')])
  assert.equal(intent({ ledger }).state, 'failing')
  assert.match(intent({ ledger }).summary, /^2 questions for you; 1 about data, money or permissions still open\./)
  answerQuestion(ledger, { id: 'Q1', status: 'answered', answer: 'Only the owner.' })
  assert.equal(intent({ ledger }).state, 'weak')
  answerQuestion(ledger, { id: 'Q2', status: 'deferred', answer: null, reason: 'Later.' })
  const resolved = intent({ ledger })
  assert.equal(resolved.state, 'weak')
  assert.match(resolved.summary, /1 answer is not yet backed by a test/)
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 2, total: 3 } }
  assert.equal(intent({ ledger }).state, 'weak')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: true, red: { killed: 3, total: 3 } }
  assert.equal(intent({ ledger }).state, 'strong')
  ledger.questions[0].test = { file: 'test/q1.test.js', green: false, red: null }
  const gap = intent({ ledger })
  assert.equal(gap.state, 'failing')
  assert.match(gap.summary, /does not yet do what you answered for Q1/)
})

test('deferring or deciding needs a reason', () => {
  const ledger = addQuestions(emptyLedger(), [ask('data')])
  assert.throws(() => answerQuestion(ledger, { id: 'Q1', status: 'deferred' }), /needs a reason/)
})

test('critical code must meet the bar on its own, with every surviving break explained', () => {
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
