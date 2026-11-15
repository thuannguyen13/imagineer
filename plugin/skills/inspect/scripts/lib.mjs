// Shared helpers for Inspect's scripts. Node built-ins only, so the scripts
// run in any repository without installing anything.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const EXAMPLE = /[._-](example|sample|template)$/

/**
 * A file of settings by its name: `.env`, `.env.local`, `.env_local`, `.envrc`, `prod.env`,
 * `.dev.vars`, and their examples (`.env.example`), which an install or a test setup copies into place.
 */
export const isEnvLike = path => /^(\.env(rc|[._-][\w.-]+)?|[\w.-]+\.env|\.dev\.vars)$/.test(basename(String(path)))

/** An env file that can hold real settings: every one but an example. */
export const isEnvFile = path => isEnvLike(path) && !EXAMPLE.test(basename(String(path)))

// An env file named in a command, a path or a pattern of file names (`.env*`, `.env.*`). `process.env.NAME` is not one.
const ENV_FILE_IN_TEXT = /(?:^|[\s/'"=<>(:,{])((?:\.env(?:rc|(?:[._-][\w*?-]+)*)|[\w-]+\.env|\.dev\.vars))(?=$|[\s'")|;&<>,:*?}])/g

/** The env file a text names, or the pattern that would match one; null otherwise. */
export function envFileIn(text) {
  for (const [, name] of String(text ?? '').matchAll(ENV_FILE_IN_TEXT)) if (/[*?]/.test(name) || isEnvFile(name)) return name
  return null
}

// Settings that say where a database (or a hosted backend, a cloud data store, a cache, a queue) is, or how to
// sign in to it. A list, so never complete: what it misses still needs a test that asks for it.
const DATABASE_NAME =
  /(^|_)(DATABASE|DB|SQL|PG|PG(HOST|HOSTADDR|PORT|USER|PASSWORD|PASSFILE|DATABASE|SERVICE|OPTIONS|SSL[A-Z]*)|POSTGRES(QL)?|MYSQL|MARIADB|MONGO(DB)?|REDIS|SQLITE|MSSQL|SQLSERVER|SUPABASE|FIREBASE|FIRESTORE|PRISMA|DRIZZLE|TYPEORM|SEQUELIZE|KNEX|TURSO|LIBSQL|NEON|PLANETSCALE|COCKROACH(DB)?|DYNAMO(DB)?|AWS|S3|RDS|COSMOS|BIGQUERY|SNOWFLAKE|CASSANDRA|NEO4J|COUCH(DB|BASE)?|INFLUX(DB)?|CLICKHOUSE|ELASTIC(SEARCH|ACHE)?|MEMCACHED?|UPSTASH|KV|CONVEX|POCKETBASE|APPWRITE|HASURA|XATA|FAUNA|AMQP|RABBITMQ|KAFKA)(_|$)/i
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
 * Why a text of settings and words reaches for a database, in plain words, or null: it reads an
 * env file, sets a database setting, or names a database. Says names and schemes only, never a value.
 */
export function databaseProblem(command) {
  const text = String(command ?? '')
  const file = envFileIn(text)
  if (file) return `reads an env file (${file})`
  for (const [, name] of text.matchAll(/(?:^|[\s;&|('"`])(?:export\s+)?([A-Za-z_]\w*)=/g)) {
    if (DATABASE_NAME.test(name)) return `sets ${name}, which says where a database is or how to sign in to it`
  }
  const scheme = databaseAddressIn(text)
  if (scheme) return `names a database, or a service with a sign-in (${scheme}://…)`
  return null
}

/**
 * The words of a command that is one plain program call, or null: nothing chained, piped,
 * redirected or expanded by the shell (`$`, backticks), which would run before the program does.
 * Text in single quotes is passed on as it is.
 */
export function plainCall(command) {
  const words = []
  let word = ''
  let started = false
  let quote = null
  const text = String(command ?? '').trim()
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quote === "'") {
      if (c === "'") quote = null
      else word += c
    } else if (c === '$' || c === '`') return null
    else if (quote === '"') {
      if (c === '"') quote = null
      else if (c === '\\' && i + 1 < text.length) word += text[++i]
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      started = true
    } else if (c === '\\') {
      if (i + 1 >= text.length || text[i + 1] === '\n') return null
      word += text[++i]
      started = true
    } else if (c === '\n' || ';&|()<>'.includes(c)) return null
    else if (/\s/.test(c)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (quote) return null
  if (started) words.push(word)
  return words
}

const RUNNERS = new Set(['vitest', 'jest', 'mocha', 'ava', 'tap', 'playwright', 'cypress', 'uvu', 'jasmine', 'tsx'])
const MANAGERS = new Set(['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx'])

/** Whether words start a test runner: the runner itself, through a package manager, or the project's own test script. */
function startsTestRunner([program, ...rest]) {
  const name = basename(program ?? '')
  const runner = (word, args) => RUNNERS.has(basename(word ?? '')) && (basename(word) !== 'tsx' || args.includes('--test'))
  if (name === 'node') return rest.includes('--test') && !rest.some(a => /^(-e|--eval|-p|--print)(=|$)/.test(a))
  if (runner(program, rest)) return true
  if (!MANAGERS.has(name)) return false
  // `npx -y vitest`, `pnpm exec jest`, `npm test -- file`, `yarn run test:unit`: never `npx -c "<any command>"`.
  const args = rest.filter(a => !/^(-y|--yes|--no-install|--silent|-s|exec|dlx|x|--)$/.test(a))
  if (args[0] === 'run') return /^test/.test(args[1] ?? '')
  if (name !== 'npx' && name !== 'bunx' && /^t(est[\w:-]*)?$/.test(args[0] ?? '')) return true
  return runner(args[0], args)
}

/**
 * A proof's or an attack's command, as a test runner to start without a shell: `{ env, argv }`, or
 * `{ problem }` when it is anything else. A shell cannot be kept in the copy or away from a database
 * by reading what it is asked to run, so no shell runs: only a test runner and its words, with any
 * `NAME=value` settings before it.
 */
export function runnerCall(command) {
  const words = plainCall(command)
  if (!words) return { problem: 'is more than a test runner and its words: no pipes, &&, redirects or $' }
  const env = {}
  while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) {
    const setting = words.shift()
    env[setting.slice(0, setting.indexOf('='))] = setting.slice(setting.indexOf('=') + 1)
  }
  if (!startsTestRunner(words)) return { problem: 'does not start a test runner (npx vitest run <file>, npx jest <file>, node --test <file>, npm test -- <file> and the like)' }
  return { env, argv: words }
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

const REACHES = 'reaches into the repository itself, not the copy'
const HOME = /(^|[\s"'=:(,])(~|\$HOME|\$\{HOME\})(?=\/)/g

/** Whether one path, written as a shell or a program would read it from `cwd`, is in the repository itself. */
function pathReaches(piece, repo, cwd) {
  const path = piece.replace(/^file:\/\//, '').replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir())
  if (!path) return false
  if (isAbsolute(path)) return inRepository(path, repo)
  return cwd !== null && /[/.]/.test(path) && inRepository(resolve(cwd, path), repo)
}

/**
 * Why a text (a test file, a command) reaches into the repository itself, or null: everything runs
 * in the copy. The repository's path written out is found spaces and all; other paths are read as
 * a program would from `cwd`: relative, under `~` or `$HOME`, joined with colons, a `file://` address.
 */
export function repositoryProblem(text, repo, { cwd = null } = {}) {
  if (!repo) return null
  const raw = String(text ?? '').replace(HOME, (_, before) => before + homedir())
  const fold = value => (CASELESS ? value.toLowerCase() : value)
  // Without its quotes, so a path quoted in parts ("/Users/me"/app) reads as the shell joins it.
  const joined = raw.replace(/["']/g, '')
  for (const root of new Set([resolve(repo), real(repo)])) {
    for (let at = fold(joined).indexOf(fold(root)); at !== -1; at = fold(joined).indexOf(fold(root), at + 1)) {
      const rest = joined.slice(at + root.length)
      // A longer name beside it (app-two) is another folder; Imagineer's own folder in it is fine.
      if (!/^[\w.-]/.test(rest) && !/^\/\.claude\/imagineer(?![\w.-])/.test(rest)) return REACHES
    }
  }
  // A path in quotes is one path, spaces and all (an import, a file to open); outside quotes, words are.
  const quoted = [...raw.matchAll(/(["'`])((?:\\.|(?!\1)[^\n])*)\1/g)].map(m => m[2])
  const words = raw.replace(/["']/g, ' ').split(/[\s=;&|()<>`,]+/).flatMap(token => [token, ...token.split(':')])
  for (const piece of [...quoted, ...words]) if (/^(\.\.?\/|\.\.$|file:\/\/)/.test(piece) && pathReaches(piece, repo, cwd)) return REACHES
  return null
}

/**
 * Why a proof or an attack must not run as asked, or null. Its command starts a test runner in the
 * copy (`cwd`) and may not reach for a database or the repository (`source`); its test, which sits
 * in `testDir` of the copy, may not name a database or the repository either. A test may still say
 * `.env` or sign in to the app under test: those are attacks worth trying.
 */
export function runProblem({ command, test = '', source = null, cwd = null, testDir = null }) {
  // What it reaches for first: that is the reason worth telling, and worth flagging.
  const inCommand = databaseProblem(command)
  if (inCommand) return `the command ${inCommand}`
  const call = runnerCall(command)
  if (call.problem) return `the command ${call.problem}`
  const words = [...call.argv, ...Object.values(call.env)]
  if (source && words.some(word => [word, ...word.split(/[=:,]/)].some(piece => pathReaches(piece, source, cwd)))) return `the command ${REACHES}`
  const scheme = databaseAddressIn(test, { signIn: false })
  if (scheme) return `the test names a database (${scheme}://…)`
  const inTest = repositoryProblem(test, source, { cwd: testDir })
  return inTest ? `the test ${inTest}` : null
}

/** A run's folder, `<repository>/.claude/imagineer/runs/<n>`, as `{ path, repo }`. Throws for any other folder, one nested in a run included. */
export function runFolder(out) {
  const path = real(out)
  const [, repo] = path.match(/^(.+)\/\.claude\/imagineer\/runs\/[^/]+$/) ?? []
  if (!repo || /\/\.claude\/imagineer(\/|$)/.test(repo)) throw new Error(`--out is a run's folder, <repository>/.claude/imagineer/runs/<n>, not ${out}.`)
  return { path, repo }
}

/** A file's full path inside a folder, links followed. Throws when the path given leaves the folder. */
export function inside(folder, file, what) {
  const path = resolve(folder, file)
  if (isAbsolute(file) || !isUnder(path, folder) || real(path) === real(folder)) throw new Error(`--file is a path inside ${what}, not ${file}.`)
  return path
}

/**
 * Whether this module is the program that was started, whatever its path holds: a link, a space,
 * a letter outside English. (Comparing `import.meta.url` with `file://` + the path fails on each.)
 */
export const isMain = metaUrl => Boolean(process.argv[1]) && real(fileURLToPath(metaUrl)) === real(process.argv[1])

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
 * (Vitest, Jest, node:test, Mocha, AVA, tap, Jasmine, uvu, Playwright, Bun), with or without a
 * prefix a workspace tool puts before each line; null when the output has no such summary.
 * A runner counts the tests a name filter left out as skipped too.
 */
export function testCounts(output) {
  const text = stripAnsi(output)
  const count = (from, pattern) => Number(from.match(pattern)?.[1] ?? 0)
  const first = pattern => (pattern.test(text) ? count(text, pattern) : null)
  const START = '(?:^|[\\s:|>])'
  // Vitest: "Tests  3 passed | 1 skipped (4)". Jest: "Tests:  1 skipped, 2 passed, 3 total". The last
  // such line with a count in it: the app's own output may start a line with "Tests" too.
  const line = [...text.matchAll(new RegExp(`${START}Tests:?\\s+(.*\\b\\d+ (?:passed|failed|skipped|todo|total)\\b.*)$`, 'gm'))].at(-1)?.[1]
  if (line) return { passed: count(line, /(\d+) passed/), skipped: count(line, /(\d+) skipped/) + count(line, /(\d+) todo/) }
  // node:test and tap: "ℹ pass 3", "ℹ skipped 1", "# pass 3", "# skip 1".
  const pass = first(new RegExp(`${START}(?:ℹ|#) pass\\s+(\\d+)\\s*$`, 'm'))
  if (pass !== null) return { passed: pass, skipped: count(text, /(?:ℹ|#) skip(?:ped)?\s+(\d+)\s*$/m) + count(text, /(?:ℹ|#) todo\s+(\d+)\s*$/m) }
  // Mocha: "3 passing", "1 pending".
  const passing = first(new RegExp(`${START}(\\d+) passing\\b`, 'm'))
  if (passing !== null) return { passed: passing, skipped: count(text, /(\d+) pending\b/) }
  // AVA: "2 tests passed", "1 test skipped", "1 test todo".
  const ava = [/(\d+) tests? passed\b/, /(\d+) tests? skipped\b/, /(\d+) tests? todo\b/].map(first)
  if (ava.some(n => n !== null)) return { passed: ava[0] ?? 0, skipped: (ava[1] ?? 0) + (ava[2] ?? 0) }
  // Jasmine: "3 specs, 0 failures, 1 pending spec".
  const specs = text.match(/(\d+) specs?, (\d+) failures?(?:, (\d+) pending specs?)?/)
  if (specs) return { passed: Number(specs[1]) - Number(specs[2]) - Number(specs[3] ?? 0), skipped: Number(specs[3] ?? 0) }
  // uvu: "Total: 3", "Passed: 3", "Skipped: 0".
  const uvu = first(/Passed:\s+(\d+)/)
  if (uvu !== null) return { passed: uvu, skipped: count(text, /Skipped:\s+(\d+)/) }
  // Playwright: "3 passed (2.1s)", "1 skipped". Bun: "3 pass", "1 skip".
  const passed = first(new RegExp(`${START}(\\d+) pass(?:ed)?\\b`, 'm'))
  const skipped = first(new RegExp(`${START}(\\d+) skip(?:ped)?\\b`, 'm'))
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
