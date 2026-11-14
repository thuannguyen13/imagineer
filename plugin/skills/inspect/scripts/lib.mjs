// Shared helpers for Inspect's scripts. Node built-ins only, so the scripts
// run in any repository without installing anything.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, dirname, relative, resolve, sep } from 'node:path'

/** Tool versions Inspect uses when the repository has none of its own. */
export const PINNED = { fallow: '3.40.0', stryker: '9.6.1' }

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export const readJsonIf = path => (existsSync(path) ? readJson(path) : null)

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

// What a tool needs from the environment to work: where programs, home and temp are, the locale,
// the terminal, proxies and certificates. Nothing else reaches the project's own code.
const SAFE_NAMES = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TERM', 'TZ', 'COLORTERM', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'PNPM_HOME', 'VOLTA_HOME', 'BUN_INSTALL', 'COREPACK_HOME'])
const SAFE_PATTERNS = [/^LC_/, /^XDG_/, /^(HTTPS?|NO|ALL)_PROXY$/i, /^npm_config_(registry|cache|prefix|userconfig|proxy|https_proxy|noproxy|strict_ssl|cafile)$/i]
// Never passed on, whatever its name matched: anything that reads like a credential.
const SECRET_LIKE = /TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH|SESSION|COOKIE|PRIVATE|DSN|DATABASE_URL/i

/**
 * The environment for a command that runs the project's own code (its install, tests, typecheck,
 * mutation testing, proofs and attacks): only what tools need, so a test cannot reach a real
 * database or service with the user's credentials. Returns the names left out, never their values.
 */
export function projectEnv(source = process.env) {
  const env = {}
  const dropped = []
  for (const [name, value] of Object.entries(source)) {
    const safe = (SAFE_NAMES.has(name) || SAFE_PATTERNS.some(p => p.test(name))) && !SECRET_LIKE.test(name)
    if (safe && value !== undefined) env[name] = value
    else if (name !== 'NODE_TEST_CONTEXT') dropped.push(name)
  }
  return { env: { ...env, CI: '1' }, dropped: dropped.sort() }
}

// What a proof or an attack may never be pointed at: a database nobody set up for it. An agent
// that finds a test skipped for want of a database goes looking for one, and the user's own is
// the nearest. These say what counts as reaching for one, by name and by address, never by value.

/** A file that can hold real settings: `.env`, `.env.local`, `.env.production.local`, `.envrc`. Example files hold none. */
export const isEnvFile = path => {
  const name = basename(String(path))
  return /^\.env(rc|(\.[\w-]+)*)$/.test(name) && !/\.(example|sample|template|dist|defaults)$/.test(name)
}

// An env file named in a command, a path or a pattern of file names (`.env*`, `.env.*`). `process.env.NAME` is not one.
const ENV_FILE_IN_TEXT = /(?:^|[\s/'"=<>(:,])(\.env(?:rc|(?:\.[\w*?-]+)*))(?=$|[\s'")|;&<>,:*?])/g

/** The env file a text names, or the pattern that would match one; null otherwise. */
export function envFileIn(text) {
  for (const [, name] of String(text ?? '').matchAll(ENV_FILE_IN_TEXT)) if (/[*?]/.test(name) || isEnvFile(name)) return name
  return null
}

// Settings that say where a database (or a hosted backend, a cache, a queue) is, or how to sign in to it.
const DATABASE_NAME =
  /(^|_)(DATABASE|DB|PG|PG(HOST|HOSTADDR|PORT|USER|PASSWORD|PASSFILE|DATABASE|SERVICE|OPTIONS|SSL[A-Z]*)|POSTGRES(QL)?|MYSQL|MARIADB|MONGO(DB)?|REDIS|SQLITE|MSSQL|SQLSERVER|SUPABASE|FIREBASE|FIRESTORE|PRISMA|DRIZZLE|TURSO|LIBSQL|NEON|PLANETSCALE|COCKROACH(DB)?|DYNAMO(DB)?|CLICKHOUSE|ELASTIC(SEARCH)?|UPSTASH|KV|AMQP|RABBITMQ)(_|$)/i
const DATABASE_SCHEME = /^(postgres(ql)?|mysql|mariadb|mongodb|rediss?|amqps?|mssql|sqlserver|libsql|cockroachdb|clickhouse|sqlite)(\+[\w.-]+)?$/i

/**
 * The scheme of a database address in a text (`postgres://…`, `mongodb+srv://…`), or, with `signIn`,
 * of any address that carries a sign-in (`https://user:pw@host`); null when there is none.
 */
export function databaseAddressIn(text, { signIn = true } = {}) {
  for (const [, scheme, user] of String(text ?? '').matchAll(/\b([a-z][a-z0-9+.-]*):\/\/([^\s'"@/]*@)?/gi)) {
    if (DATABASE_SCHEME.test(scheme) || (signIn && user)) return scheme.toLowerCase()
  }
  return null
}

/** Whether a setting says where a database is or how to sign in to it, by its name or its value. */
export const isDatabaseSetting = (name, value = '') => DATABASE_NAME.test(name) || databaseAddressIn(value) !== null

/**
 * Why a command reaches for a database, in plain words, or null: it reads an env file, sets a
 * database setting, or names a database. Says names and schemes only, never a value.
 */
export function databaseProblem(command) {
  const text = String(command ?? '')
  const file = envFileIn(text)
  if (file) return `reads an env file (${file})`
  for (const [, name] of text.matchAll(/(?:^|[\s;&|('"`])(?:export\s+)?([A-Z_][A-Z0-9_]*)=/g)) {
    if (DATABASE_NAME.test(name)) return `sets ${name}, which says where a database is or how to sign in to it`
  }
  const scheme = databaseAddressIn(text)
  if (scheme) return `names a database, or a service with a sign-in (${scheme}://…)`
  return null
}

const CASELESS = process.platform === 'darwin' || process.platform === 'win32'

/** A path as the file system knows it, links followed, whether or not it exists yet. */
export function real(path) {
  const full = resolve(path)
  try {
    return realpathSync.native(full)
  } catch {
    const parent = dirname(full)
    return parent === full ? full : join(real(parent), basename(full))
  }
}

/** Whether a path is at or under a folder, as the file system sees both. */
export function isUnder(path, dir) {
  const [target, root] = [real(path), real(dir)].map(p => (CASELESS ? p.toLowerCase() : p))
  return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Whether a path is in the repository itself, outside Imagineer's own folder there. */
export const inRepository = (path, repo) => isUnder(path, repo) && !isUnder(path, join(repo, '.claude', 'imagineer'))

/**
 * Why a text (a command, a test file) reaches into the repository itself, or null: everything runs
 * in the copy. Paths are read as the shell would from `cwd`: quoted, relative, under `~` or `$HOME`,
 * joined with colons, or as a `file://` address.
 */
export function repositoryProblem(text, repo, { cwd = null } = {}) {
  if (!repo) return null
  const plain = String(text ?? '').replace(/["']/g, '').replace(/file:\/\//g, ' ')
  for (const token of plain.split(/[\s=;&|()<>`,:]+/)) {
    const path = token.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir())
    const reaches = path.startsWith('/') ? inRepository(path, repo) : cwd && /^\.\.?(\/|$)/.test(path) && inRepository(resolve(cwd, path), repo)
    if (reaches) return 'reaches into the repository itself, not the copy'
  }
  return null
}

/**
 * Why a proof or an attack must not run as asked, or null. Its command runs in the copy (`cwd`) and
 * may not reach for a database or the repository (`source`); its test may not name a database or the
 * repository either. A test may still say `.env` or sign in to the app under test: those are attacks.
 */
export function runProblem({ command, test = '', source = null, cwd = null }) {
  const inCommand = databaseProblem(command) ?? repositoryProblem(command, source, { cwd })
  if (inCommand) return `the command ${inCommand}`
  const scheme = databaseAddressIn(test, { signIn: false })
  if (scheme) return `the test names a database (${scheme}://…)`
  const inTest = repositoryProblem(test, source)
  return inTest ? `the test ${inTest}` : null
}

/**
 * An env file's text without its database settings: those lines are left out (a quoted value over
 * several lines too), every other line is kept as it is, so the project's own test settings still
 * work. Returns the names left out, never their values.
 */
export function withoutDatabaseSettings(text) {
  const kept = []
  const leftOut = []
  const closes = (rest, quote) => new RegExp(`(^|[^\\\\])${quote}`).test(rest)
  let open = null
  for (const line of String(text).split('\n')) {
    if (open) {
      if (closes(line, open)) open = null
      continue
    }
    // Windows line endings stay on the lines kept, and never hide a setting.
    const [, name, value] = line.replace(/\r$/, '').match(/^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/) ?? []
    if (!name || !isDatabaseSetting(name, value)) {
      kept.push(line)
      continue
    }
    leftOut.push(name)
    if (/^["'`]/.test(value) && !closes(value.slice(1), value[0])) open = value[0]
  }
  return { text: kept.join('\n'), leftOut }
}

/** Records something Imagineer refused, for its self-check (`denials.jsonl`, in Imagineer's folder in the repository). */
export function recordDenial(repo, entry) {
  try {
    const dir = join(repo, '.claude', 'imagineer')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'denials.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

const stripAnsi = text => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '')

/**
 * How many tests a run says passed and were skipped, read from the summary of the usual runners
 * (Vitest, Jest, node:test, Mocha, Playwright, Bun), or null when the output has no such summary.
 * A runner counts the tests a name filter left out as skipped too.
 */
export function testCounts(output) {
  const text = stripAnsi(output)
  const count = (from, pattern) => Number(from.match(pattern)?.[1] ?? 0)
  const first = pattern => (pattern.test(text) ? count(text, pattern) : null)
  // Vitest: "Tests  3 passed | 1 skipped (4)". Jest: "Tests:  1 skipped, 2 passed, 3 total". The last
  // such line with a count in it: the app's own output may start a line with "Tests" too.
  const line = [...text.matchAll(/^\s*Tests:?\s+(.*\b\d+ (?:passed|failed|skipped|todo|total)\b.*)$/gm)].at(-1)?.[1]
  if (line) return { passed: count(line, /(\d+) passed/), skipped: count(line, /(\d+) skipped/) + count(line, /(\d+) todo/) }
  // node:test: "ℹ pass 3", "ℹ skipped 1" (or "# pass 3").
  const pass = first(/^(?:ℹ|#) pass (\d+)$/m)
  if (pass !== null) return { passed: pass, skipped: count(text, /^(?:ℹ|#) skipped (\d+)$/m) + count(text, /^(?:ℹ|#) todo (\d+)$/m) }
  // Mocha: "3 passing", "1 pending".
  const passing = first(/^\s*(\d+) passing\b/m)
  if (passing !== null) return { passed: passing, skipped: count(text, /^\s*(\d+) pending\b/m) }
  // Playwright: "3 passed (2.1s)", "1 skipped". Bun: "3 pass", "1 skip".
  const passed = first(/^\s*(\d+) pass(?:ed)?\b/m)
  const skipped = first(/^\s*(\d+) skip(?:ped)?\b/m)
  if (passed !== null || skipped !== null) return { passed: passed ?? 0, skipped: skipped ?? 0 }
  // A runner told to pass when it finds nothing: "No tests found, exiting with code 0".
  return /\bno tests?(?: files?)?(?: were)? found\b/i.test(text) ? { passed: 0, skipped: 0 } : null
}

/**
 * Runs a command without a shell. Never throws: the result says what happened.
 * `project: true` runs it with projectEnv(), for anything that executes the project's own code.
 */
export function run(argv, { cwd, timeoutMs = 10 * 60_000, env, project = false } = {}) {
  const started = Date.now()
  // A test runner's own marker would make a nested `node --test` report to it instead of failing.
  const { NODE_TEST_CONTEXT, ...inherited } = process.env
  const base = project ? projectEnv().env : { ...inherited, CI: '1' }
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    ok: result.status === 0,
    code: result.status,
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: result.error?.message ?? null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }
}

/** The last lines of a command's output, for a report. */
export const tail = (text, lines = 20) => text.trim().split('\n').slice(-lines).join('\n')

/**
 * Why a test strength run stopped, in plain words, and the tests that failed in it, read from its
 * whole output (the failing tests' names come long before the last lines).
 */
export function strykerFailure(log) {
  const text = stripAnsi(log)
  const names = pattern =>
    [...new Set([...text.matchAll(pattern)].map(m => m[1].replace(/\s+\d+(\.\d+)?m?s$/, '').trim()))].filter(Boolean)
  // A file's FAIL line names it; the × lines name single tests when no FAIL line was printed.
  const byFile = names(/^\s*FAIL\s+(\S.*)$/gm)
  const failingTests = (byFile.length ? byFile : names(/^\s*[×✗✕]\s+(\S.*)$/gm)).slice(0, 10)
  if (/failed tests in the initial test run/i.test(text)) {
    return { reason: 'some tests fail under the test strength tool, though they pass in a normal run', failingTests }
  }
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const error = lines.find(l => /ERROR Stryker/.test(l))?.replace(/^.*ERROR Stryker\s*/, '') ?? lines.at(-1) ?? 'the tool stopped without saying why'
  return { reason: error.length > 140 ? `${error.slice(0, 139)}…` : error, failingTests }
}

/**
 * A run's test strength result (`stryker.json`). Runs from before 0.3.1 wrote only the estimate when
 * its first test run failed, and an agent sometimes recorded that failure as the user's skip: both are
 * read as the failure they were.
 */
export function testStrengthResult(out) {
  const recorded = readJsonIf(join(out, 'stryker.json'))
  const estimate = readJsonIf(join(out, 'stryker-estimate.json'))
  if (estimate && estimate.ok === false && !estimate.reused && (!recorded || recorded.declined)) {
    if (estimate.error) return { ok: false, error: estimate.error, failingTests: [] }
    const { reason, failingTests } = strykerFailure(estimate.output)
    return { ok: false, error: reason, failingTests }
  }
  return recorded
}

/** Every file under a folder, relative to it, skipping dependencies and build output. */
export function listFiles(root, { skip = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.claude', 'reports', '.stryker-tmp'] } = {}) {
  const out = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (skip.includes(name)) continue
      const path = join(dir, name)
      const stat = statSync(path, { throwIfNoEntry: false })
      if (!stat) continue
      if (stat.isDirectory()) walk(path)
      else out.push(relative(root, path))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

export const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const KEEP_OUTPUT = 4 * 1024 * 1024

/**
 * Like run, for a long command that starts many processes of its own (mutation testing). It runs
 * in a process group of its own, and when this script is stopped (Ctrl-C, a kill, a closed
 * terminal) or times out, the whole group is stopped with it, so no worker is left running.
 * Resolves the same shape as run; keeps the last few megabytes of output.
 */
export function runGroup(argv, { cwd, timeoutMs = 10 * 60_000, env, project = false } = {}) {
  const started = Date.now()
  const { NODE_TEST_CONTEXT, ...inherited } = process.env
  const base = project ? projectEnv().env : { ...inherited, CI: '1' }
  return new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...base, ...env }, detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let error = null
    const keep = (text, chunk) => (text + chunk).slice(-KEEP_OUTPUT)
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout = keep(stdout, chunk)))
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr = keep(stderr, chunk)))
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {}
    }
    const onSignal = signal => {
      stop()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP']
    for (const signal of signals) process.on(signal, onSignal)
    process.on('exit', stop)
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    child.on('error', e => (error = e.message))
    child.on('close', code => {
      clearTimeout(timer)
      for (const signal of signals) process.off(signal, onSignal)
      process.off('exit', stop)
      resolve({ ok: code === 0 && !timedOut && !error, code, timedOut, error, stdout, stderr, seconds: Math.round((Date.now() - started) / 100) / 10 })
    })
  })
}

/**
 * Keeps one of Imagineer's own folders out of git with a .gitignore inside it that ignores
 * everything, itself included, so nothing in the repository's .git is ever written.
 */
export function keepOutOfGit(dir) {
  const path = join(dir, '.gitignore')
  if (existsSync(path)) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, "# Imagineer's own files: kept out of git.\n*\n")
}

/**
 * The test-strength thresholds: the share of planted bugs the tests must catch, overall and in
 * critical code (money, data, permissions). Imagineer suggests 80 and 80 (Stryker's own "high"
 * band; see docs/research/grading.md for what that number rests on, and what it does not). A user
 * can set their own per repository; `bySetting` says whose numbers they are, for the wording.
 */
export const DEFAULT_THRESHOLDS = { tests: 80, critical: 80 }

const settingsPath = repo => join(repo, '.claude/imagineer/settings.json')

export function loadThresholds(repo) {
  const saved = repo ? readJsonIf(settingsPath(repo))?.thresholds : null
  if (!saved) return { ...DEFAULT_THRESHOLDS, bySetting: false }
  return { tests: saved.tests ?? DEFAULT_THRESHOLDS.tests, critical: saved.critical ?? DEFAULT_THRESHOLDS.critical, bySetting: true }
}

/** Saves the user's own thresholds for this repository; `reset` goes back to Imagineer's suggestion. */
export function saveThresholds(repo, { tests, critical, reset = false }) {
  const path = settingsPath(repo)
  const settings = readJsonIf(path) ?? {}
  if (reset) {
    delete settings.thresholds
  } else {
    const current = loadThresholds(repo)
    const next = { tests: tests ?? current.tests, critical: critical ?? current.critical }
    for (const [name, value] of Object.entries(next)) {
      if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(`${name} is a whole percentage from 1 to 100, not ${value}.`)
    }
    settings.thresholds = next
  }
  keepOutOfGit(join(repo, '.claude/imagineer'))
  writeJson(path, settings)
  return loadThresholds(repo)
}
