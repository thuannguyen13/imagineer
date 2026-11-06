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
