// Run: node --test 'plugin/skills/build/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barFrom, changedSources, modelsFrom, prBody } from './build.mjs'

test('model presets: recommended mixes, budget and maximum are uniform, custom is checked', () => {
  assert.deepEqual(modelsFrom('recommended'), { preset: 'recommended', architect: 'opus', dev: 'sonnet', devCritical: 'opus', qa: 'opus' })
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

test('the done bar: tests pass, typecheck passes, the audit is clean, 80% of breaks caught, critical code fully covered', () => {
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
  assert.match(body, /Done bar: \*\*met\*\*/)
})
