// Shared helpers for Inspect's scripts. Node built-ins only, so the scripts
// run in any repository without installing anything.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

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
