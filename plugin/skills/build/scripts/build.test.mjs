// Run: node --test 'plugin/skills/build/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barFrom, changedSources, gradeSection, modelsFrom, prBody } from './build.mjs'

test('model presets: recommended mixes, budget and maximum are uniform, custom is checked', () => {
  assert.deepEqual(modelsFrom('recommended'), { preset: 'recommended', architect: 'opus', dev: 'sonnet', devCritical: 'opus', qa: 'opus', attacker: 'opus' })
  assert.equal(modelsFrom('budget').qa, 'sonnet')
  assert.equal(modelsFrom('maximum').dev, 'opus')
  assert.equal(modelsFrom({ dev: 'opus' }).architect, 'opus')
  assert.throws(() => modelsFrom({ qa: 'gpt' }), /Unknown model/)
  assert.equal(modelsFrom('cheap'), null)
})

test('only changed source files are mutated, never tests or Imagineer files', () => {
  assert.deepEqual(changedSources(['src/approvals.ts', 'test/approval.test.ts', 'src/a.spec.js', 'docs/x.md', '.claude/imagineer/x.mjs', 'public/app.js']), [
    'src/approvals.ts',
    'public/app.js',
  ])
})

const passing = { tests: { ok: true }, typecheck: { present: true, ok: true }, audit: { ok: true, verdict: 'pass' }, critical: [] }

test('the done thresholds: tests pass, typecheck passes, the audit is clean, 80% of breaks caught, critical code fully covered', () => {
  assert.deepEqual(barFrom({ ...passing, mutation: { caught: 9, total: 10 } }), { met: true, missing: [] })
  assert.deepEqual(barFrom({ ...passing, mutation: { caught: 7, total: 10 } }).missing, ['tests catch 70% of breaks in the changed code, below 80%'])
  assert.match(barFrom({ ...passing, tests: { ok: false }, mutation: { caught: 9, total: 10 } }).missing[0], /QA's tests do not pass/)
  assert.match(barFrom({ ...passing, audit: { ok: true, verdict: 'fail' }, mutation: { caught: 9, total: 10 } }).missing[0], /Fallow finds new problems/)
  const critical = barFrom({ ...passing, mutation: { caught: 19, total: 20 }, critical: [{ path: 'src/approvals.ts', missed: 1 }] })
  assert.equal(critical.met, false)
  assert.match(critical.missing[0], /critical code: src\/approvals\.ts \(1\)/)
  assert.equal(barFrom({ ...passing, mutation: 'skipped' }).met, false)
})

test('the pull request body leads with requirements and their evidence', () => {
  const body = prBody({
    request: 'Add expense approvals.',
    requirements: [{ id: 'R1', text: 'An approver decides their own team’s submitted expenses.', tests: ['test/approval.test.ts'] }],
    red: { failedFirst: true, commit: 'aaa1111' },
    rounds: [{ round: 1, commit: 'bbb2222', tests: true, audit: 'pass', mutation: { caught: 18, total: 20 }, bar: { met: true, missing: [] } }],
    models: { architect: 'opus', dev: 'sonnet', devCritical: 'opus', qa: 'opus' },
  })
  assert.match(body, /\| R1 \| An approver decides .* \| `test\/approval\.test\.ts` \|/)
  assert.match(body, /\*\*failed\*\* at aaa1111, before the feature existed/)
  assert.match(body, /catch 90% of deliberate breaks \(18 of 20\)/)
  assert.match(body, /Done thresholds \(Imagineer's suggestion\): \*\*met\*\*/)
})

test('the pull request carries the repository grade as it stood before the change', () => {
  const results = {
    run: { commit: 'b903e13' },
    overall: { state: 'failing', reason: 'At risk: test strength.' },
    dimensions: [{ name: 'Test strength', state: 'failing', summary: 'Tests catch 31% of deliberate breaks.' }],
  }
  const lines = gradeSection(results).join('\n')
  assert.match(lines, /Before this change, at b903e13: \*\*✕ At risk\*\* \(At risk: test strength\.\)/)
  assert.match(lines, /- ✕ At risk Test strength: Tests catch 31%/)
  assert.match(gradeSection(null).join('\n'), /Not inspected yet/)
  assert.match(prBody({ request: 'x', requirements: [], rounds: [] }, results), /## Repository grade/)
})

test('the done thresholds are not met when most breaks timed out', () => {
  const result = barFrom({ tests: { ok: true }, typecheck: { present: true, ok: true }, audit: { ok: true, verdict: 'pass' }, critical: [], mutation: { caught: 20, total: 20, timeouts: 19 } })
  assert.equal(result.met, false)
  assert.match(result.missing[0], /19 of 20 breaks timed out/)
})

test('the model choice covers Inspect\'s attacker, and a choice saved before it had one still works', async () => {
  const { savedModels } = await import('./build.mjs')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  assert.equal(modelsFrom('budget').attacker, 'sonnet')
  assert.equal(modelsFrom('recommended').attacker, 'opus')
  // A custom map without an attacker gives it QA's model.
  assert.equal(modelsFrom({ qa: 'sonnet' }).attacker, 'sonnet')
  assert.throws(() => modelsFrom({ attacker: 'gpt' }), /Unknown model "gpt" for attacker/)

  const dir = mkdtempSync(join(tmpdir(), 'imagineer-prefs-'))
  try {
    const path = join(dir, 'preferences.json')
    writeFileSync(path, JSON.stringify({ buildModels: { preset: 'budget', architect: 'sonnet', dev: 'sonnet', devCritical: 'sonnet', qa: 'sonnet' } }))
    assert.equal(savedModels(path).attacker, 'sonnet')
    writeFileSync(path, JSON.stringify({ buildModels: { preset: 'custom', architect: 'opus', dev: 'sonnet', devCritical: 'opus', qa: 'haiku' } }))
    assert.equal(savedModels(path).attacker, 'haiku')
    assert.equal(savedModels(join(dir, 'missing.json')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the example question in the Architect\'s instructions passes Inspect\'s plain-language check', async () => {
  const { readFileSync } = await import('node:fs')
  const { addQuestions, emptyLedger } = await import('../../inspect/scripts/questions.mjs')
  const text = readFileSync(new URL('../../../agents/architect.md', import.meta.url), 'utf8')
  const example = JSON.parse(text.match(/```json\n([\s\S]+?)\n```/)[1])
  assert.equal(addQuestions(emptyLedger(), [example]).questions[0].point, example.point)
})

test("Build's done check uses the repository's thresholds", () => {
  const base = { tests: { ok: true }, typecheck: { present: true, ok: true }, audit: { ok: true, verdict: 'pass' }, critical: [], mutation: { caught: 7, total: 10 } }
  assert.match(barFrom(base).missing[0], /70% of breaks in the changed code, below 80%/)
  assert.equal(barFrom({ ...base, thresholds: { tests: 65, critical: 80 } }).met, true)
})
