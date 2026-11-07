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
