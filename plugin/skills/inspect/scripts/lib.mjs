// Shared helpers for Inspect's scripts. Node built-ins only, so the scripts
// run in any repository without installing anything.

import { spawnSync } from 'node:child_process'
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

/** Runs a command without a shell. Never throws: the result says what happened. */
export function run(argv, { cwd, timeoutMs = 10 * 60_000, env } = {}) {
  const started = Date.now()
  // A test runner's own marker would make a nested `node --test` report to it instead of failing.
  const { NODE_TEST_CONTEXT, ...inherited } = process.env
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    env: { ...inherited, CI: '1', ...env },
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
