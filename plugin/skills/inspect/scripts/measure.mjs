#!/usr/bin/env node
// Measures a repository in a throwaway copy, so the repository itself is
// never changed. Each step writes its evidence to the run folder.
//
//   node measure.mjs prepare  --repo <repo> --out <run folder>
//   node measure.mjs checks   --out <run folder>
//   node measure.mjs fallow   --out <run folder>
//   node measure.mjs stryker  --out <run folder> [--estimate] [--mutate <glob>,<glob>] [--decline "<why not this time>"]
//   node measure.mjs audit    --out <run folder> --base <ref>     Fallow on what changed since <ref>
//   node measure.mjs security --out <run folder>
//   node measure.mjs cleanup  --out <run folder>
//
// checks, fallow, security and stryker reuse an earlier run's result when it measured the same
// commit with the same Imagineer and tool versions, and say so; --fresh measures again.

import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect } from './detect.mjs'
import { arg, PINNED, projectEnv, readJson, readJsonIf, run, runGroup, tail, writeJson } from './lib.mjs'

const INSTALL = {
  npm: lock => (lock ? ['npm', 'ci', '--no-audit', '--no-fund'] : ['npm', 'install', '--no-audit', '--no-fund']),
  pnpm: () => ['pnpm', 'install', '--frozen-lockfile'],
  yarn: () => ['yarn', 'install', '--frozen-lockfile'],
  bun: () => ['bun', 'install', '--frozen-lockfile'],
}

const RUNNER = { npm: ['npm', 'run'], pnpm: ['pnpm', 'run'], yarn: ['yarn', 'run'], bun: ['bun', 'run'] }

const ADD = {
  npm: pkg => ['npm', 'install', '--no-save', '--no-audit', '--no-fund', pkg],
  pnpm: pkg => ['pnpm', 'add', '-D', pkg],
  yarn: pkg => ['yarn', 'add', '-D', pkg],
  bun: pkg => ['bun', 'add', '-d', pkg],
}

const HERE = dirname(fileURLToPath(import.meta.url))

/** What a measurement depends on besides the code: the commit, Imagineer's version and the tools used. */
export function measurementKey(commit, facts) {
  const manifest = readJsonIf(join(HERE, '../../../.claude-plugin/plugin.json'))
  return JSON.stringify({ commit, imagineer: manifest?.version ?? 'unknown', pinned: PINNED, tools: facts.tools })
}

// The files each step writes, which a reuse copies.
const OUTPUTS = { checks: ['checks.json'], fallow: ['fallow.json'], security: ['security.json'], stryker: ['stryker.json', 'mutation.json'] }

/**
 * Copies a step's result from the latest earlier run that measured the same commit with the same
 * versions, if `accepts` takes it, and returns that run's name; null to measure. Runs from before
 * the key existed are never reused.
 */
export function reuse(out, step, accepts = () => true) {
  if (process.argv.includes('--fresh')) return null
  const key = readJsonIf(join(out, 'copy.json'))?.key
  if (!key) return null
  const self = resolve(out)
  const runs = dirname(self)
  const earlier = readdirSync(runs)
    .map(name => join(runs, name))
    .filter(dir => dir !== self && readJsonIf(join(dir, 'copy.json'))?.key === key)
    .sort((a, b) => String(readJsonIf(join(b, 'copy.json'))?.at).localeCompare(String(readJsonIf(join(a, 'copy.json'))?.at)))
  for (const dir of earlier) {
    if (!OUTPUTS[step].every(file => existsSync(join(dir, file))) || !accepts(dir)) continue
    for (const file of OUTPUTS[step]) copyFileSync(join(dir, file), join(out, file))
    writeJson(join(out, 'reused.json'), { ...readJsonIf(join(out, 'reused.json')), [step]: basename(dir) })
    return basename(dir)
  }
  return null
}

const reusedLine = (what, from) => `${what} reused from run ${from}: same commit, same tools. Nothing to run (--fresh measures again).`

function state(out) {
  const copy = readJson(join(out, 'copy.json'))
  return { copy, repoFacts: readJson(join(out, 'detect.json')) }
}

/**
 * A run stopped before its cleanup leaves its throwaway copy behind, installed packages and all.
 * A new run removes those its earlier runs left, and returns their names.
 */
export function removeLeftCopies(out) {
  const self = resolve(out)
  const runs = dirname(self)
  if (!existsSync(runs)) return []
  const removed = []
  for (const name of readdirSync(runs)) {
    const dir = join(runs, name)
    if (dir === self) continue
    const copy = readJsonIf(join(dir, 'copy.json'))
    if (copy?.path && basename(copy.path).startsWith('imagineer-') && existsSync(copy.path)) {
      rmSync(copy.path, { recursive: true, force: true })
      removed.push(name)
    }
  }
  return removed
}

function prepare(repo, out) {
  const left = removeLeftCopies(out)
  if (left.length) console.log(`Removed the throwaway ${left.length === 1 ? 'copy' : 'copies'} that run ${left.join(', ')} left behind.`)
  const facts = detect(repo)
  writeJson(join(out, 'detect.json'), facts)

  const head = run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'])
  if (!head.ok) throw new Error(`Not a git repository with a commit: ${repo}`)
  const dirty = run(['git', '-C', repo, 'status', '--porcelain']).stdout.trim() !== ''

  // The committed state only: what was measured is exactly a commit.
  const path = mkdtempSync(join(tmpdir(), 'imagineer-'))
  const archive = run(['sh', '-c', `git -C "$1" archive HEAD | tar -x -C "$2"`, 'sh', repo, path])
  if (!archive.ok) throw new Error(`Could not copy the repository: ${tail(archive.stderr)}`)

  const install = facts.isNodeProject
    ? run(INSTALL[facts.manager](facts.lockfile), { cwd: path, timeoutMs: 15 * 60_000, project: true })
    : { ok: false, seconds: 0, stderr: 'No package.json.' }
  writeJson(join(out, 'copy.json'), {
    path,
    source: repo,
    // When this run measured the code: the time the results show.
    at: new Date().toISOString(),
    commit: head.stdout.trim(),
    dirty,
    install: { ok: install.ok, seconds: install.seconds, output: install.ok ? '' : tail(install.stderr || install.stdout) },
    // The project's code runs without the user's environment: the names left out, never their values.
    envLeftOut: projectEnv().dropped,
    // What a later run on the same commit, with the same versions, may reuse from this one.
    key: measurementKey(head.stdout.trim(), facts),
  })
  console.log(`Copied ${head.stdout.trim()}${dirty ? ' (uncommitted changes not included)' : ''} to ${path}; install ${install.ok ? 'passed' : 'failed'}.`)
}

function checks(out) {
  const { copy, repoFacts } = state(out)
  const runner = RUNNER[repoFacts.manager]
  const step = (script, name) => {
    if (!repoFacts.scripts[name]) return { present: false }
    const result = run([...runner, script], { cwd: copy.path, project: true, timeoutMs: 20 * 60_000 })
    return { present: true, ok: result.ok, seconds: result.seconds, output: tail(result.stdout + '\n' + result.stderr) }
  }
  const result = { typecheck: step('typecheck', 'typecheck'), test: step('test', 'test') }
  writeJson(join(out, 'checks.json'), result)
  console.log(`Typecheck: ${describe(result.typecheck)}. Tests: ${describe(result.test)}.`)
}

const describe = step => (!step.present ? 'none' : step.ok ? `passed in ${step.seconds}s` : 'failed')

function fallow(out) {
  const { copy, repoFacts } = state(out)
  const own = repoFacts.tools.fallow.inRepo && repoFacts.tools.fallow.version !== null
  const command = own ? ['npx', 'fallow'] : ['npx', '-y', `fallow@${PINNED.fallow}`]
  const health = run([...command, 'health', '--format', 'json', '--quiet'], { cwd: copy.path, project: true })
  const check = run([...command, 'check', '--format', 'json', '--quiet'], { cwd: copy.path, project: true })
  const parse = result => {
    try {
      return JSON.parse(result.stdout)
    } catch {
      return null
    }
  }
  const healthJson = parse(health)
  const checkJson = parse(check)
  writeJson(join(out, 'fallow.json'), {
    ok: healthJson !== null,
    measured: repoFacts.tools.fallow.inRepo ? 'repo' : 'default',
    version: healthJson?.version ?? null,
    health: healthJson,
    check: checkJson,
    error: healthJson === null ? tail(health.stderr || health.stdout) : null,
  })
  console.log(healthJson ? `Fallow ${healthJson.version}: health ${healthJson.health_score?.score} ${healthJson.health_score?.grade}.` : 'Fallow did not run.')
}

async function stryker(out, isEstimate) {
  const { copy, repoFacts } = state(out)
  // Each mutant runs the whole test suite, which usually uses every core itself: running
  // many at once slows each past its time limit, and breaks then time out instead of being
  // caught. A quarter of the cores, at most four, keeps runs near their own speed.
  const concurrency = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4)))
  const own = repoFacts.tools.stryker.inRepo
  // Imagineer's own Stryker lives in a tools folder of its own, never in the project's
  // node_modules: adding a package there can make npm drop the project's platform binaries.
  let command = ['npx', 'stryker', 'run']
  if (!own) {
    const tools = join(tmpdir(), `imagineer-tools-stryker-${PINNED.stryker}`)
    const bin = join(tools, 'node_modules', '.bin', 'stryker')
    if (!existsSync(bin)) {
      const installed = run(['npm', 'install', '--prefix', tools, '--no-audit', '--no-fund', `@stryker-mutator/core@${PINNED.stryker}`, 'typescript@5'], { timeoutMs: 10 * 60_000 })
      if (!installed.ok) {
        writeJson(join(out, isEstimate ? 'stryker-estimate.json' : 'stryker.json'), { ok: false, error: `Could not install Stryker: ${tail(installed.stderr)}` })
        console.log('Stryker could not be installed.')
        return
      }
    }
    command = [bin, 'run']
  }

  let config = repoFacts.tools.stryker.config
  if (!own || config === null) {
    if (!repoFacts.scripts.test) {
      writeJson(join(out, 'stryker.json'), { ok: false, skipped: 'The repository has no test command, so no test would notice a break.' })
      console.log('Stryker skipped: no test command.')
      return
    }
    // Imagineer's defaults: run the repository's own tests for every mutant.
    config = 'stryker.imagineer.json'
    writeFileSync(
      join(copy.path, config),
      JSON.stringify({
        testRunner: 'command',
        commandRunner: { command: `${RUNNER[repoFacts.manager].join(' ')} test` },
        coverageAnalysis: 'off',
        reporters: ['json', 'clear-text'],
        jsonReporter: { fileName: 'reports/mutation/mutation.json' },
        tempDirName: '.stryker-tmp',
        // A mutant's limit is the clean run's time × timeoutFactor + timeoutMS.
        timeoutFactor: 3,
        timeoutMS: 30_000,
      }),
    )
  }

  const argv = [...command, config, '--concurrency', String(concurrency), '--reporters', 'json,clear-text']
  const mutate = arg('mutate')
  // Tests are never mutated, whatever the scope names.
  if (mutate) argv.push('--mutate', [mutate, '!**/*.test.*', '!**/*.spec.*', '!**/__tests__/**', '!**/test/**', '!**/tests/**'].join(','))
  if (isEstimate) argv.push('--dryRunOnly')
  // Its own process group: stopping this script stops every Stryker worker with it.
  const result = await runGroup(argv, { cwd: copy.path, project: true, timeoutMs: isEstimate ? 15 * 60_000 : 6 * 60 * 60_000 })
  const log = result.stdout + '\n' + result.stderr

  if (isEstimate) {
    const mutants = Number(log.match(/with (\d+) mutant/)?.[1] ?? NaN)
    const testSeconds = Number(log.match(/Ran [\d.]+ tests? in ([\d.]+) seconds?/)?.[1] ?? NaN)
    // Runs side by side slow each other down; 1.5 is what the first real project showed at this concurrency.
    const minutes = Number.isFinite(mutants) && Number.isFinite(testSeconds) ? Math.ceil((mutants * testSeconds * 1.5) / concurrency / 60) : null
    writeJson(join(out, 'stryker-estimate.json'), { ok: result.ok, mutants, testSeconds, concurrency, minutes, output: result.ok ? '' : tail(log) })
    console.log(result.ok ? `Stryker: ${mutants} mutants, about ${minutes} minutes with ${concurrency} at a time.` : `Stryker dry run failed:\n${tail(log)}`)
    return
  }

  const report = join(copy.path, 'reports/mutation/mutation.json')
  if (existsSync(report)) copyFileSync(report, join(out, 'mutation.json'))
  writeJson(join(out, 'stryker.json'), {
    ok: result.ok && existsSync(report),
    measured: own ? 'repo' : 'default',
    version: own ? repoFacts.tools.stryker.version : PINNED.stryker,
    // What was mutated, so a reuse takes only a run over the same scope.
    mutate: arg('mutate') ?? null,
    seconds: result.seconds,
    error: existsSync(report) ? null : tail(log),
  })
  console.log(existsSync(report) ? `Stryker finished in ${Math.round(result.seconds / 60)} minutes.` : `Stryker failed:\n${tail(log)}`)
}

function security(out) {
  const { copy, repoFacts } = state(out)
  const own = repoFacts.tools.fallow.inRepo && repoFacts.tools.fallow.version !== null
  const command = own ? ['npx', 'fallow'] : ['npx', '-y', `fallow@${PINNED.fallow}`]
  const scan = run([...command, 'security', '--format', 'json', '--quiet'], { cwd: copy.path, project: true })
  let candidates = null
  try {
    candidates = JSON.parse(scan.stdout).security_findings ?? []
  } catch {}

  // Known vulnerabilities in the dependencies the app ships with (not dev tools).
  let audit = { skipped: `No audit for ${repoFacts.manager} yet.` }
  if (repoFacts.manager === 'npm' && repoFacts.lockfile) {
    const result = run(['npm', 'audit', '--json', '--omit=dev'], { cwd: copy.path, project: true, timeoutMs: 3 * 60_000 })
    try {
      const counts = JSON.parse(result.stdout).metadata?.vulnerabilities ?? {}
      audit = { tool: 'npm audit --omit=dev', high: counts.high ?? 0, critical: counts.critical ?? 0, moderate: counts.moderate ?? 0 }
    } catch {
      audit = { skipped: `npm audit did not answer: ${tail(result.stderr, 3)}` }
    }
  }
  writeJson(join(out, 'security.json'), {
    candidates:
      candidates === null
        ? null
        : candidates.map(c => ({ path: c.path, line: c.line, category: c.category, cwe: c.cwe, severity: c.severity, evidence: c.evidence })),
    audit,
  })
  console.log(
    `Security candidates: ${candidates === null ? 'scan failed' : candidates.length}. Dependency audit: ${audit.skipped ?? `${audit.critical} critical, ${audit.high} high`}.`,
  )
}

function audit(out, base) {
  const { copy, repoFacts } = state(out)
  const own = repoFacts.tools.fallow.inRepo && repoFacts.tools.fallow.version !== null
  const command = own ? ['npx', 'fallow'] : ['npx', '-y', `fallow@${PINNED.fallow}`]
  // The copy has no git history; Fallow needs it to compare with the base, so audit the source checkout.
  const result = run([...command, 'audit', '--base', base, '--format', 'json', '--quiet'], { cwd: copy.source ?? copy.path })
  let report = null
  try {
    report = JSON.parse(result.stdout)
  } catch {}
  writeJson(join(out, 'audit.json'), report ? { ok: true, verdict: report.verdict, changedFiles: report.changed_files_count, summary: report.summary } : { ok: false, error: tail(result.stderr || result.stdout) })
  console.log(report ? `Fallow audit against ${base}: ${report.verdict} (${report.changed_files_count} files changed).` : 'Fallow audit did not run.')
}

function cleanup(out) {
  const { copy } = state(out)
  if (copy.path.includes('imagineer-')) rmSync(copy.path, { recursive: true, force: true })
  console.log(`Removed ${copy.path}.`)
}

// Run as a command (paths compared resolved, so spaces or a relative path do not stop it); loaded by a test, it only exports.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [step] = process.argv.slice(2)
  const out = arg('out')
  try {
    if (!out) throw new Error('--out <run folder> is required')
    if (step === 'prepare') prepare(resolve(arg('repo') ?? '.'), out)
    else if (['checks', 'fallow', 'security'].includes(step) && reuse(out, step, dir => step !== 'fallow' || readJsonIf(join(dir, 'fallow.json'))?.ok === true)) {
      console.log(reusedLine(step === 'checks' ? 'Checks' : step === 'fallow' ? 'Code quality' : 'Security scan', readJson(join(out, 'reused.json'))[step]))
    } else if (step === 'checks') checks(out)
    else if (step === 'fallow') fallow(out)
    else if (step === 'stryker' && arg('decline')) {
      // The user chose not to run it this time: recorded, so the grade says so instead of waiting for it.
      writeJson(join(out, 'stryker.json'), { ok: false, declined: arg('decline') })
      console.log('Test strength not measured this time.')
    } else if (step === 'stryker') {
      const scope = arg('mutate') ?? null
      const from = reuse(out, 'stryker', dir => {
        const earlier = readJsonIf(join(dir, 'stryker.json'))
        return earlier?.ok === true && (earlier.mutate ?? null) === scope
      })
      if (from && process.argv.includes('--estimate')) {
        writeJson(join(out, 'stryker-estimate.json'), { ok: true, reused: from, minutes: 0 })
        console.log(reusedLine('Test strength', from))
      } else if (from) console.log(reusedLine('Test strength', from))
      else await stryker(out, process.argv.includes('--estimate'))
    }
    else if (step === 'security') security(out)
    else if (step === 'audit') audit(out, arg('base') ?? 'main')
    else if (step === 'cleanup') cleanup(out)
    else throw new Error('Steps: prepare, checks, fallow, stryker, security, audit, cleanup')
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
