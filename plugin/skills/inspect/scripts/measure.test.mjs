// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MEASURE = join(dirname(fileURLToPath(import.meta.url)), 'measure.mjs')
const measure = (...args) => spawnSync('node', [MEASURE, ...args], { encoding: 'utf8' })

function runs(t) {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-reuse-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const make = (name, copy, files = {}) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    // A copy that does not exist: a step that ran instead of reusing would fail.
    writeFileSync(join(dir, 'copy.json'), JSON.stringify({ path: join(root, 'gone'), at: copy.at, key: copy.key }))
    writeFileSync(join(dir, 'detect.json'), JSON.stringify({ manager: 'npm', scripts: {}, tools: { fallow: {}, stryker: {} } }))
    for (const [file, value] of Object.entries(files)) writeFileSync(join(dir, file), JSON.stringify(value))
    return dir
  }
  return make
}

test('a step on the same commit with the same tools reuses the earlier result, and says so', t => {
  const make = runs(t)
  make('1', { key: 'K', at: '2026-11-06T10:00:00Z' }, { 'checks.json': { test: { present: true, ok: true } }, 'stryker.json': { ok: true, mutate: null }, 'mutation.json': { files: {} } })
  const now = make('2', { key: 'K', at: '2026-11-06T11:00:00Z' })

  const checks = measure('checks', '--out', now)
  assert.equal(checks.status, 0, checks.stderr)
  assert.match(checks.stdout, /Checks reused from run 1: same commit, same tools/)
  assert.deepEqual(JSON.parse(readFileSync(join(now, 'checks.json'), 'utf8')), { test: { present: true, ok: true } })

  const estimate = measure('stryker', '--estimate', '--out', now)
  assert.match(estimate.stdout, /Test strength reused from run 1/)
  assert.deepEqual(JSON.parse(readFileSync(join(now, 'stryker-estimate.json'), 'utf8')), { ok: true, reused: '1', minutes: 0 })
  assert.ok(existsSync(join(now, 'mutation.json')))
  assert.deepEqual(JSON.parse(readFileSync(join(now, 'reused.json'), 'utf8')), { checks: '1', stryker: '1' })
})

test('nothing is reused across commits, across mutation scopes, from failed runs, or with --fresh', t => {
  const make = runs(t)
  make('1', { key: 'OTHER', at: '2026-11-06T10:00:00Z' }, { 'checks.json': { ok: true } })
  make('2', { key: 'K', at: '2026-11-06T10:30:00Z' }, { 'stryker.json': { ok: true, mutate: 'src/a.ts' }, 'mutation.json': {} })
  make('3', { key: 'K', at: '2026-11-06T10:40:00Z' }, { 'stryker.json': { ok: false }, 'mutation.json': {} })
  make('4', { key: 'K', at: '2026-11-06T10:50:00Z' }, { 'checks.json': { test: { present: false } } })
  const now = make('5', { key: 'K', at: '2026-11-06T11:00:00Z' })

  // Run 1 is another commit, 2 mutated a different scope, 3 failed: Stryker would have to run (and fails on the missing copy).
  assert.doesNotMatch(measure('stryker', '--estimate', '--out', now).stdout, /reused/)
  // --fresh measures again even where run 4 could be reused.
  assert.doesNotMatch(measure('checks', '--fresh', '--out', now).stdout, /reused/)
  assert.match(measure('checks', '--out', now).stdout, /reused from run 4/)
})

import { removeLeftCopies } from './measure.mjs'

test('a new run removes the throwaway copies earlier runs left behind, and nothing else', t => {
  const make = runs(t)
  const left = mkdtempSync(join(tmpdir(), 'imagineer-'))
  const notOurs = mkdtempSync(join(tmpdir(), 'someone-else-'))
  t.after(() => rmSync(notOurs, { recursive: true, force: true }))
  const one = make('1', { key: 'K', at: 'a' })
  writeFileSync(join(one, 'copy.json'), JSON.stringify({ path: left }))
  const two = make('2', { key: 'K', at: 'b' })
  writeFileSync(join(two, 'copy.json'), JSON.stringify({ path: notOurs }))
  const now = make('3', { key: 'K', at: 'c' })
  assert.deepEqual(removeLeftCopies(now), ['1'])
  assert.equal(existsSync(left), false)
  assert.equal(existsSync(notOurs), true)
})

test("a test strength check that failed is never recorded as the user's skip", t => {
  const make = runs(t)
  const failed = make('1', { key: 'K', at: 'a' }, { 'stryker.json': { ok: false, error: 'some tests fail under the test strength tool, though they pass in a normal run' } })
  const refused = measure('stryker', '--out', failed, '--decline', 'Some tests fail under the tool')
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /stays recorded as a failure, not as skipped/)
  assert.equal(JSON.parse(readFileSync(join(failed, 'stryker.json'), 'utf8')).declined, undefined)

  // The user's own choice, with nothing failed, is still recorded.
  const fresh = make('2', { key: 'K', at: 'b' })
  assert.equal(measure('stryker', '--out', fresh, '--decline', 'it would take about 45 minutes').status, 0)
  assert.equal(JSON.parse(readFileSync(join(fresh, 'stryker.json'), 'utf8')).declined, 'it would take about 45 minutes')
})

import { symlinkSync } from 'node:fs'
import { cleanEnvFiles } from './measure.mjs'

test("env files a commit carries run in the copy without their credentials; a link is removed, never written through", t => {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-env-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const copy = join(root, 'copy')
  mkdirSync(join(copy, 'apps/web'), { recursive: true })
  writeFileSync(join(copy, '.env'), 'APP_NAME=Lunch\nDATABASE_URL=postgresql://app:hunter2@db.example.com/app\nSTRIPE_SECRET_KEY=sk_live_x\n')
  writeFileSync(join(copy, '.env.example'), 'DATABASE_URL=\n')
  writeFileSync(join(copy, 'apps/web/.env.development'), 'PORT=3000\n')
  writeFileSync(join(root, 'outside.env'), 'API_TOKEN=real\n')
  symlinkSync(join(root, 'outside.env'), join(copy, '.env.local'))

  const cleaned = cleanEnvFiles(copy)
  assert.deepEqual(
    cleaned.sort((a, b) => a.file.localeCompare(b.file)),
    [
      { file: '.env', leftOut: ['DATABASE_URL', 'STRIPE_SECRET_KEY'] },
      { file: '.env.local', removed: true, leftOut: [] },
    ],
  )
  assert.equal(readFileSync(join(copy, '.env'), 'utf8'), 'APP_NAME=Lunch\n')
  assert.equal(readFileSync(join(copy, '.env.example'), 'utf8'), 'DATABASE_URL=\n')
  assert.equal(existsSync(join(copy, '.env.local')), false)
  assert.equal(readFileSync(join(root, 'outside.env'), 'utf8'), 'API_TOKEN=real\n')
})
