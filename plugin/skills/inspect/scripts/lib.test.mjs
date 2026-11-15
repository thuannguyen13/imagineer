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

import { databaseAddressIn, databaseProblem, envFileIn, inRepository, isDatabaseSetting, isEnvFile, repositoryProblem, runProblem, testCounts, withoutDatabaseSettings } from './lib.mjs'
import { mkdirSync } from 'node:fs'

test('an env file is one that can hold real settings, never an example', () => {
  for (const name of ['.env', '.env.local', '.env.production.local', 'apps/web/.env.test', '.envrc']) assert.equal(isEnvFile(name), true, name)
  for (const name of ['.env.example', '.env.local.sample', '.env.template', 'env.ts', '.environment', 'README.md']) assert.equal(isEnvFile(name), false, name)
  // A pattern that would match one counts.
  assert.equal(envFileIn('**/.env*'), '.env')
  assert.equal(envFileIn('cat .env.*'), '.env.*')
  // Code that reads a setting is not a file.
  assert.equal(envFileIn('grep -rn "process.env.DATABASE_URL" src'), null)
})

test('a database setting is known by its name or its address, whatever the database', () => {
  for (const name of ['DATABASE_URL', 'DB_HOST', 'DB_NAME', 'APP_DB', 'PGHOST', 'PGDATABASE', 'PG_URL', 'POSTGRES_PASSWORD', 'MONGO_URL', 'MONGODB_URI', 'REDIS_HOST', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_API_KEY', 'KV_REST_API_TOKEN', 'mysql_host']) {
    assert.equal(isDatabaseSetting(name), true, name)
  }
  // What a project commits so its own tests run is not one.
  for (const name of ['JWT_SECRET', 'SESSION_SECRET', 'NEXTAUTH_URL', 'STRIPE_SECRET_KEY', 'APP_NAME', 'PORT', 'DEBUG', 'ADBLOCK', 'PGP_KEY_ID']) assert.equal(isDatabaseSetting(name, 'x'), false, name)
  assert.equal(isDatabaseSetting('CACHE', 'redis://cache.internal:6379'), true)
  assert.equal(isDatabaseSetting('SEARCH', 'https://elastic:pw@search.example.com:9200'), true)
  assert.equal(isDatabaseSetting('API', 'https://api.example.com'), false)
  for (const address of ['postgres://localhost/dev', 'postgresql+psycopg2://u@h/db', 'jdbc:postgresql://h/db', 'sqlite:///data/dev.db', 'mongodb+srv://u:p@c.example.net/app']) {
    assert.notEqual(databaseAddressIn(address), null, address)
  }
})

test('a command that reaches for a database is refused, with names and never values', () => {
  // How attacks once ran against a real database: the URL taken from the repository's env file.
  assert.equal(databaseProblem("export $(grep '^DATABASE_URL=' /Users/a/app/.env.local | xargs) && npx vitest run a4.test.ts"), 'reads an env file (.env.local)')
  assert.equal(databaseProblem('node --env-file=.env --test a.test.mjs'), 'reads an env file (.env)')
  const inline = databaseProblem('DATABASE_URL=postgresql://app:hunter2@db.example.com:5432/app npx vitest run a.test.ts')
  assert.equal(inline, 'sets DATABASE_URL, which says where a database is or how to sign in to it')
  assert.equal(databaseProblem('PGHOST=localhost PGDATABASE=app npx vitest run a.test.ts'), 'sets PGHOST, which says where a database is or how to sign in to it')
  // A database on this machine is still a database nobody set up for attacks.
  const named = databaseProblem('STORE=postgres://localhost:5432/dev npx vitest run a.test.ts')
  assert.equal(named, 'names a database, or a service with a sign-in (postgres://…)')
  assert.equal(databaseProblem('curl https://admin:hunter2@example.com/x'), 'names a database, or a service with a sign-in (https://…)')
  for (const reason of [inline, named]) assert.doesNotMatch(reason, /hunter2|example\.com|localhost/)

  for (const fine of [
    'npx vitest run test/attacks/a7-approver-other-team.test.ts',
    'NODE_ENV=test TZ=UTC npx jest test/attacks/a7.test.ts',
    'JWT_SECRET=test SESSION_SECRET=x npx vitest run test/attacks/a7.test.ts',
    'node --test test/attacks/a7.test.mjs',
    'BASE_URL=http://localhost:3000 npx playwright test attacks/a7.spec.ts',
  ]) assert.equal(databaseProblem(fine), null, fine)
})

test('a command or a test stays in the copy: nothing in the repository itself but Imagineer’s folder', t => {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-where-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'app')
  const copy = join(root, 'imagineer-copy')
  mkdirSync(join(repo, '.claude/imagineer/runs/1'), { recursive: true })
  mkdirSync(copy)
  assert.equal(inRepository(join(repo, 'src/auth.ts'), repo), true)
  assert.equal(inRepository(repo, repo), true)
  assert.equal(inRepository(join(repo, '.claude/imagineer/runs/1/attacks.json'), repo), false)
  assert.equal(inRepository(join(copy, 'src/auth.ts'), repo), false)
  assert.equal(inRepository(join(root, 'app-two/src/auth.ts'), repo), false)

  const reaches = 'reaches into the repository itself, not the copy'
  for (const text of [
    `cat ${repo}/service-account.json`,
    `readFileSync("${repo}/secrets.json", "utf8")`,
    `cat "${root}"/app/secrets.json`,
    `NODE_PATH=/usr/lib:${repo}/node_modules npx vitest`,
    `open('file://${repo}/dev.db')`,
    `npx vitest run --root ../app`,
  ]) assert.equal(repositoryProblem(text, repo, { cwd: copy }), reaches, text)
  for (const text of [`node attack.mjs run --out ${repo}/.claude/imagineer/runs/1`, `cd ${copy} && npx vitest run ./src/a.test.ts`, 'npx vitest run ../imagineer-copy/a.test.ts']) {
    assert.equal(repositoryProblem(text, repo, { cwd: copy }), null, text)
  }
})

test('a proof or an attack is refused for what its command or its test reaches for, and for nothing an attack may say', () => {
  const source = '/Users/a/app'
  assert.equal(runProblem({ command: 'DATABASE_URL=postgresql://x npx vitest run a.test.ts', source }), 'the command sets DATABASE_URL, which says where a database is or how to sign in to it')
  assert.equal(runProblem({ command: `npx vitest run --root ${source}`, source }), 'the command reaches into the repository itself, not the copy')
  const run = test => runProblem({ command: 'npx vitest run a.test.ts', test, source })
  // An address found in a compose file or an example, written into the test.
  assert.equal(run("process.env.DATABASE_URL = 'postgres://postgres:postgres@localhost:5432/app_dev'"), 'the test names a database (postgres://…)')
  assert.equal(run(`config({ path: '${source}/config/local.json' })`), 'the test reaches into the repository itself, not the copy')
  // Attacks worth trying: an env file the app must not serve, a wrong sign-in to the app under test.
  assert.equal(run("expect((await fetch('/.env')).status).toBe(404)"), null)
  assert.equal(run("await fetch('http://admin:wrong@localhost:3000/admin')"), null)
})

test('an env file keeps every setting but its database settings', () => {
  const { text, leftOut } = withoutDatabaseSettings(
    [
      '# App',
      'APP_NAME=Lunch',
      'JWT_SECRET=test-secret',
      'export DATABASE_URL="postgresql://app:hunter2@db.example.com/app"',
      'CACHE=redis://cache.internal:6379',
      'DB_HOST=localhost',
      "FIREBASE_PRIVATE_KEY='-----BEGIN KEY-----",
      'MIIEvQIBADANBg',
      "-----END KEY-----'",
      'PORT=3000',
      'NEXT_PUBLIC_API=https://api.example.com',
      'pgpassword = hunter2',
    ].join('\n'),
  )
  assert.equal(text, ['# App', 'APP_NAME=Lunch', 'JWT_SECRET=test-secret', 'PORT=3000', 'NEXT_PUBLIC_API=https://api.example.com'].join('\n'))
  assert.deepEqual(leftOut, ['DATABASE_URL', 'CACHE', 'DB_HOST', 'FIREBASE_PRIVATE_KEY', 'pgpassword'])
  // Windows line endings hide nothing, and stay on what is kept.
  assert.deepEqual(withoutDatabaseSettings('A=1\r\nDATABASE_URL=postgres://u:p@h/db\r\nB=2\r\n'), { text: 'A=1\r\nB=2\r\n', leftOut: ['DATABASE_URL'] })
})

test('a test run says how many tests passed and were skipped, whichever runner printed it', () => {
  assert.deepEqual(testCounts(' Test Files  1 passed (1)\n      Tests  3 passed (3)\n'), { passed: 3, skipped: 0 })
  assert.deepEqual(testCounts(' Test Files  1 skipped (1)\n      Tests  2 skipped (2)\n'), { passed: 0, skipped: 2 })
  assert.deepEqual(testCounts('\u001b[2m      Tests \u001b[22m \u001b[32m1 passed\u001b[39m | \u001b[33m2 skipped\u001b[39m (3)'), { passed: 1, skipped: 2 })
  assert.deepEqual(testCounts('Tests:       1 skipped, 2 passed, 3 total'), { passed: 2, skipped: 1 })
  // The app's own output may start a line with the same word.
  assert.deepEqual(testCounts('Tests connection to the store\n      Tests  3 passed (3)\n'), { passed: 3, skipped: 0 })
  assert.deepEqual(testCounts('ℹ tests 2\nℹ pass 0\nℹ fail 0\nℹ skipped 2\nℹ todo 0'), { passed: 0, skipped: 2 })
  assert.deepEqual(testCounts('# tests 1\n# pass 1\n# skipped 0'), { passed: 1, skipped: 0 })
  assert.deepEqual(testCounts('  2 passing (12ms)\n  1 pending'), { passed: 2, skipped: 1 })
  assert.deepEqual(testCounts(' 3 pass\n 1 skip\n 0 fail'), { passed: 3, skipped: 1 })
  assert.deepEqual(testCounts('  1 skipped\n  2 passed (3.1s)'), { passed: 2, skipped: 1 })
  // A runner told to pass when it finds nothing.
  assert.deepEqual(testCounts('No tests found, exiting with code 0'), { passed: 0, skipped: 0 })
  assert.deepEqual(testCounts('No test files found, exiting with code 0'), { passed: 0, skipped: 0 })
  assert.equal(testCounts('ok\n'), null)
})

import { isEnvLike, runnerCall } from './lib.mjs'

test('env files by any of their names; the examples are settings files too, only never real ones', () => {
  for (const name of ['.env.defaults', '.env.dist', '.env_local', '.env-prod', 'prod.env', '.dev.vars']) assert.equal(isEnvFile(name), true, name)
  for (const name of ['.env.example', '.env.local.sample', '.env_template']) assert.deepEqual([isEnvFile(name), isEnvLike(name)], [false, true], name)
  assert.equal(isEnvLike('environment.ts'), false)
  for (const name of ['AWS_ACCESS_KEY_ID', 'SQL_HOST', 'TYPEORM_HOST', 'S3_BUCKET']) assert.equal(isDatabaseSetting(name), true, name)
})

test('a proof or an attack runs a test runner and its words, with no shell: nothing else gets through', () => {
  assert.deepEqual(runnerCall('NODE_ENV=test npx vitest run "test/my attack.test.ts"'), { env: { NODE_ENV: 'test' }, argv: ['npx', 'vitest', 'run', 'test/my attack.test.ts'] })
  for (const fine of [
    'npx vitest run test/a7.test.ts',
    'npx -y jest test/a7.test.ts',
    'node --test test/a7.test.mjs',
    'node --import tsx --test test/a7.test.ts',
    'npm test -- test/a7.test.ts',
    'npm run test:unit -- test/a7.test.ts',
    'pnpm exec vitest run test/a7.test.ts',
    'pnpm test test/a7.test.ts',
    'yarn vitest run test/a7.test.ts',
    'bun test test/a7.test.ts',
    'npx playwright test attacks/a7.spec.ts',
    './node_modules/.bin/vitest run test/a7.test.ts',
  ]) assert.equal(runnerCall(fine).problem, undefined, fine)
  for (const shell of ['npx vitest run a.test.ts | tail', 'cd /Users/me && npx vitest run a.test.ts', 'R=/Users/me; cat $R/app/.e*', 'npx vitest run a.test.ts > out.txt', 'npx vitest run $(cat x)']) {
    assert.match(runnerCall(shell).problem, /more than a test runner/, shell)
  }
  for (const other of [
    'psql -h localhost -U postgres app_dev -c "drop table users"',
    'docker run -d -p 5432:5432 postgres:17',
    'cat src/app.ts',
    'npx prisma migrate reset --force',
    'npx -c "psql -h localhost"',
    'npm exec -c "psql -h localhost"',
    'npm run db:reset',
    'node scripts/seed.js',
    'node -e "require(\'child_process\').execSync(\'psql\')" --test',
    'npx tsx scripts/seed.ts',
    'true',
  ]) assert.match(runnerCall(other).problem, /does not start a test runner/, other)
  assert.equal(runProblem({ command: 'psql -h localhost -U postgres app_dev' }), 'the command does not start a test runner (npx vitest run <file>, npx jest <file>, node --test <file>, npm test -- <file> and the like)')
})

test('the repository is recognised with a space in its path, however the path is written', t => {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-space-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'My Projects', 'app')
  const copy = join(root, 'imagineer-copy')
  mkdirSync(repo, { recursive: true })
  mkdirSync(copy)
  const reaches = 'reaches into the repository itself, not the copy'
  assert.equal(repositoryProblem(`import { db } from "${repo}/src/db.ts"`, repo), reaches)
  assert.equal(repositoryProblem(`readFileSync('${repo.toUpperCase()}/src/db.ts')`, repo), process.platform === 'darwin' ? reaches : null)
  assert.equal(repositoryProblem("import { db } from '../My Projects/app/src/db.ts'", repo, { cwd: copy }), reaches)
  assert.equal(runProblem({ command: `npx vitest run --root "${repo}"`, source: repo, cwd: copy }), `the command ${reaches}`)
  assert.equal(runProblem({ command: `npx vitest run --root "../My Projects/app"`, source: repo, cwd: copy }), `the command ${reaches}`)
  assert.equal(runProblem({ command: `npx vitest run --root=${repo.replaceAll(' ', '\\ ')}/src`, source: repo, cwd: copy }), `the command ${reaches}`)
  assert.equal(runProblem({ command: 'npx vitest run test/a7.test.ts', test: `import { x } from '../../../My Projects/app/src/x.ts'`, source: repo, cwd: copy, testDir: join(copy, 'test/attacks') }), `the test ${reaches}`)
  assert.equal(runProblem({ command: 'npx vitest run test/a7.test.ts', test: "import { x } from '../src/x.ts'", source: repo, cwd: copy, testDir: join(copy, 'test') }), null)
})

import { judgeRun } from './lib.mjs'

test('a refusal is a reach for a database only when it was one; a wrong shape of command is not', () => {
  const source = '/Users/a/app'
  assert.deepEqual(judgeRun({ command: 'cd packages/api && npx vitest run a.test.ts', source }), { reason: 'the command is more than a test runner and its words: no pipes, &&, redirects or $', reach: false })
  assert.equal(judgeRun({ command: 'npx prisma generate', source }).reach, false)
  assert.equal(judgeRun({ command: `cd ${source} && npx vitest run`, source }).reach, true)
  assert.equal(judgeRun({ command: 'DATABASE_URL=postgres://x npx vitest run a.test.ts', source }).reach, true)
  assert.equal(judgeRun({ command: 'npx vitest run a.test.ts', test: "const url = 'postgres://localhost/dev'", source }).reach, true)
})

test('a package of a workspace is named with the package manager’s own flag, since there is no cd', () => {
  for (const fine of ['pnpm --filter api test', 'pnpm --filter api exec vitest run test/a7.test.ts', 'pnpm -C packages/api test', 'yarn workspace api test', 'yarn workspace api vitest run a7.test.ts', 'npm -w api test', 'npm test -w api -- a7.test.ts', 'npm --workspace=api run test:unit', 'npx vitest@3 run test/a7.test.ts', 'npx vitest --root packages/api run a7.test.ts']) {
    assert.equal(runnerCall(fine).problem, undefined, fine)
  }
  for (const other of ['pnpm --filter api db:reset', 'yarn workspace api prisma migrate reset', 'npx prisma@5 migrate reset', 'pnpm --filter api exec psql']) {
    assert.match(runnerCall(other).problem, /does not start a test runner/, other)
  }
})

test('a database in memory or in a file of the copy is the test’s own: it stays, in an env file and in a command', () => {
  for (const value of ['file:./test.db', 'file:test.db', './data/test.sqlite', ':memory:', 'file::memory:?cache=shared', '"file:./dev.db"']) {
    assert.equal(isDatabaseSetting('DATABASE_URL', value), false, value)
  }
  for (const value of ['', 'localhost', 'file:/Users/a/app/dev.db', 'file:../../app/dev.db', '~/dev.db', 'postgres://localhost/dev', 'sqlite:///data/dev.db']) {
    assert.equal(isDatabaseSetting('DATABASE_URL', value), true, value)
  }
  assert.deepEqual(withoutDatabaseSettings('DATABASE_URL=file:./test.db\nDB_HOST=localhost\n'), { text: 'DATABASE_URL=file:./test.db\n', leftOut: ['DB_HOST'] })
  assert.equal(databaseProblem('DATABASE_URL=file:./test.db npx vitest run a.test.ts'), null)
})

test('a repository one folder below the root does not turn every address and import into a reach', () => {
  // A container's /app: nothing of that name is on this machine, so only the text is read.
  for (const text of ["import { POST } from '@/app/api/expenses/route'", "await page.goto('/app/login')", "import x from 'src/app/page'", "fetch(`${base}/app/api`)"]) {
    assert.equal(repositoryProblem(text, '/app'), null, text)
  }
  assert.equal(repositoryProblem("process.chdir('/app')", '/app'), 'reaches into the repository itself, not the copy')
  assert.equal(runProblem({ command: 'npx vitest run --root /app', source: '/app' }), 'the command reaches into the repository itself, not the copy')
})
