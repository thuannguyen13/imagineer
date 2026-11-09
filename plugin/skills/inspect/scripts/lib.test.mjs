// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keepOutOfGit, projectEnv, run } from './lib.mjs'

test("the project's own code runs without the user's credentials", () => {
  const { env, dropped } = projectEnv({
    PATH: '/usr/bin',
    HOME: '/home/a',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'C',
    HTTPS_PROXY: 'http://proxy:8080',
    npm_config_registry: 'https://registry.npmjs.org/',
    DATABASE_URL: 'postgres://prod',
    AWS_SECRET_ACCESS_KEY: 'x',
    OPENAI_API_KEY: 'x',
    GITHUB_TOKEN: 'x',
    STRIPE_KEY: 'x',
    npm_config__authToken: 'x',
    MY_APP_MODE: 'live',
  })
  assert.deepEqual(Object.keys(env).sort(), ['CI', 'HOME', 'HTTPS_PROXY', 'LANG', 'LC_ALL', 'PATH', 'npm_config_registry'].sort())
  assert.equal(env.CI, '1')
  // Names only, never values, so the run can say what was left out.
  assert.deepEqual(dropped, ['AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'GITHUB_TOKEN', 'MY_APP_MODE', 'OPENAI_API_KEY', 'STRIPE_KEY', 'npm_config__authToken'])
})

test('a project command sees the cleaned environment, other commands the full one', () => {
  process.env.IMAGINEER_TEST_SECRET_KEY = 'should-not-leak'
  try {
    const printed = cmd => run(['sh', '-c', 'printf %s "${IMAGINEER_TEST_SECRET_KEY:-absent}"'], cmd).stdout
    assert.equal(printed({ project: true }), 'absent')
    assert.equal(printed({}), 'should-not-leak')
  } finally {
    delete process.env.IMAGINEER_TEST_SECRET_KEY
  }
})

test("Imagineer's folders are kept out of git from inside, never through .git", () => {
  const dir = mkdtempSync(join(tmpdir(), 'imagineer-git-'))
  try {
    const folder = join(dir, '.claude/imagineer')
    keepOutOfGit(folder)
    assert.match(readFileSync(join(folder, '.gitignore'), 'utf8'), /^\*$/m)
    // An existing one is left as the user has it.
    writeFileSync(join(folder, '.gitignore'), 'mine\n')
    keepOutOfGit(folder)
    assert.equal(readFileSync(join(folder, '.gitignore'), 'utf8'), 'mine\n')
    assert.equal(existsSync(join(dir, '.git')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { spawn as spawnChild, spawnSync as spawnSyncChild } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname as dirOf } from 'node:path'

test('stopping a script stops the long command it started, workers and all', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'imagineer-group-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  // A sleep no other process runs, so the count is this test's workers only.
  const seconds = `60.${process.pid % 1000}${Date.now() % 1000}`
  const lib = join(dirOf(fileURLToPath(import.meta.url)), 'lib.mjs')
  // A stand-in for Stryker: a parent that starts two workers, all sleeping.
  writeFileSync(join(dir, 'script.mjs'), `import { runGroup } from ${JSON.stringify(lib)}\nawait runGroup(['sh', '-c', 'sleep ${seconds} & sleep ${seconds} & wait'])\n`)
  const script = spawnChild('node', [join(dir, 'script.mjs')], { stdio: 'ignore' })
  const count = () => Number(spawnSyncChild('sh', ['-c', `ps -eo command | grep -c '[s]leep ${seconds}' || true`], { encoding: 'utf8' }).stdout.trim())
  const before = await waitFor(() => count() >= 2)
  assert.ok(before, 'the workers started')
  script.kill('SIGTERM') // only the script, as a kill of one process does
  assert.ok(await waitFor(() => count() === 0), 'no worker is left running')
})

async function waitFor(check, ms = 5000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return check()
}

import { DEFAULT_THRESHOLDS, loadThresholds, saveThresholds } from './lib.mjs'

test("thresholds are Imagineer's 80 and 80 until the user sets their own for a repository", t => {
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-thresholds-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  assert.deepEqual(DEFAULT_THRESHOLDS, { tests: 80, critical: 80 })
  assert.deepEqual(loadThresholds(repo), { tests: 80, critical: 80, bySetting: false })
  assert.deepEqual(saveThresholds(repo, { tests: 65 }), { tests: 65, critical: 80, bySetting: true })
  assert.deepEqual(saveThresholds(repo, { critical: 90 }), { tests: 65, critical: 90, bySetting: true })
  assert.throws(() => saveThresholds(repo, { tests: 0 }), /whole percentage from 1 to 100/)
  assert.throws(() => saveThresholds(repo, { tests: 70.5 }), /whole percentage/)
  // Kept out of git like everything else of Imagineer's.
  assert.ok(existsSync(join(repo, '.claude/imagineer/.gitignore')))
  assert.deepEqual(saveThresholds(repo, { reset: true }), { tests: 80, critical: 80, bySetting: false })
})

import { strykerFailure, testStrengthResult } from './lib.mjs'

// The shape of Stryker's output when the first test run fails, cut from a real Vitest project.
const FAILED_DRY_RUN = [
  '\u001b[31m FAIL \u001b[39m features/audit/writing-actions.test.ts > audit actions > uses every action in the list in a write',
  'AssertionError: expected [ "user.join", "user.link" ] to deeply equal []',
  '   × uses every action in the list in a write 15ms',
  ' Test Files  1 failed | 193 passed (194)',
  '\u001b[91m15:54:00 (32625) ERROR Stryker\u001b[39m There were failed tests in the initial test run.',
  'ConfigError: There were failed tests in the initial test run.',
].join('\n')

test('a failed first test run is read as a plain reason, with the tests that failed', () => {
  assert.deepEqual(strykerFailure(FAILED_DRY_RUN), {
    reason: 'some tests fail under the test strength tool, though they pass in a normal run',
    failingTests: ['features/audit/writing-actions.test.ts > audit actions > uses every action in the list in a write'],
  })
  // Any other stop: Stryker's own error line, never its stack.
  assert.equal(strykerFailure('x\n10:00:00 (1) ERROR Stryker Could not find a test runner\n    at y').reason, 'Could not find a test runner')
  assert.deepEqual(strykerFailure('').failingTests, [])
})

test("a failure only the estimate recorded, or recorded as the user's skip, reads as the failure it was", t => {
  const dir = mkdtempSync(join(tmpdir(), 'imagineer-ts-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const write = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value))

  write('stryker-estimate.json', { ok: false, output: FAILED_DRY_RUN })
  assert.equal(testStrengthResult(dir).error, 'some tests fail under the test strength tool, though they pass in a normal run')
  write('stryker.json', { ok: false, declined: 'Some tests fail when run under the test-strength tool' })
  assert.equal(testStrengthResult(dir).declined, undefined)
  assert.equal(testStrengthResult(dir).failingTests.length, 1)

  // A later run that worked wins; a skip with nothing failed stays the user's skip.
  write('stryker.json', { ok: true })
  assert.deepEqual(testStrengthResult(dir), { ok: true })
  write('stryker-estimate.json', { ok: true, minutes: 45 })
  write('stryker.json', { ok: false, declined: 'it would take about 45 minutes' })
  assert.equal(testStrengthResult(dir).declined, 'it would take about 45 minutes')
})
