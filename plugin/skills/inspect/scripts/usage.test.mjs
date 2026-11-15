// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// Sparing the user's Claude usage: a run size chosen once (Quick, Standard, Thorough), a cheaper model
// by default on the smaller sizes, and the test setup worked out once instead of by every agent.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RUN_SIZES, runSize, savedRunSize, saveRunSize } from './lib.mjs'
import { testSetupFor } from './measure.mjs'
import { stopBar } from './grade.mjs'

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'imagineer-usage-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return join(dir, 'preferences.json')
}

test('the run size is chosen once; until then a run is Standard', t => {
  const path = home(t)
  assert.equal(savedRunSize(path), null)
  assert.deepEqual(runSize(path), { size: 'standard', ...RUN_SIZES.standard })
  assert.deepEqual(saveRunSize('quick', path), { size: 'quick', rounds: 0, attacksPerRound: 0, agents: false, models: 'budget' })
  assert.throws(() => saveRunSize('huge', path), /Choose quick, standard, thorough/)
  assert.equal(RUN_SIZES.standard.rounds, 2)
  assert.equal(RUN_SIZES.thorough.models, 'recommended')
})

test('finishing is judged against the run size: Quick says it runs no attacks, Standard counts two rounds', () => {
  const dims = ['test-strength', 'structure'].map(id => ({ id, state: 'strong' }))
  const broke = round => ({ id: `A${round}`, round, category: 'data', result: 'broke', void: null })
  const quick = stopBar(dims, [], { runSize: { size: 'quick', rounds: 0 } })
  assert.match(quick.missing.at(-1), /a Quick check does not run: choose Standard or Thorough/)
  const standard = stopBar(dims, [broke(1)], { runSize: { size: 'standard', rounds: 2 } })
  assert.match(standard.missing.at(-1), /the 2 rounds of a standard run can no longer give/)
  const thorough = stopBar(dims, [broke(1)], { runSize: { size: 'thorough', rounds: 4 } })
  assert.equal(thorough.missing.at(-1), 'two attack rounds in a row that find nothing new')
})

test('how to run one test is worked out once: the runner\'s command, or Node\'s own with a loader the project has', t => {
  const app = mkdtempSync(join(tmpdir(), 'imagineer-setup-'))
  t.after(() => rmSync(app, { recursive: true, force: true }))
  const layout = extra => ({ app: { dir: '.' }, runner: null, typescript: true, tests: { example: null }, ...extra })
  assert.deepEqual(testSetupFor(layout({ runner: 'vitest', tests: { example: 'src/a.test.ts' } }), app), { runner: 'vitest', command: 'npx vitest run {file}', example: 'src/a.test.ts', loader: null, note: '' })
  assert.match(testSetupFor(layout(), app).note, /no TypeScript loader: write tests in plain JavaScript/)
  mkdirSync(join(app, 'node_modules/jiti'), { recursive: true })
  writeFileSync(join(app, 'node_modules/jiti/package.json'), '{"name":"jiti"}')
  assert.equal(testSetupFor(layout(), app).command, 'node --import jiti/register --test {file}')
  assert.equal(testSetupFor(layout({ runner: 'node --test' }), app).command, 'node --import jiti/register --test {file}')
  const sub = testSetupFor(layout({ app: { dir: 'web' }, runner: 'vitest' }), app)
  assert.equal(sub.command, null)
  assert.match(sub.note, /The app is in web\//)
})
