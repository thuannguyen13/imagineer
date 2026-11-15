#!/usr/bin/env node
// Measures a repository in a throwaway copy, so the repository itself is
// never changed. Each step writes its evidence to the run folder.
//
//   node measure.mjs prepare  --repo <repo> --out <run folder>
//   node measure.mjs checks   --out <run folder>
//   node measure.mjs fallow   --out <run folder>
//   node measure.mjs stryker  --out <run folder> [--estimate] [--mutate <glob>,<glob>] [--decline "<why not this time>"]
//   node measure.mjs security --out <run folder>
//   node measure.mjs cleanup  --out <run folder>
//
// checks, fallow, security and stryker reuse an earlier run's result when it measured the same
// commit with the same Imagineer and tool versions, and say so; --fresh measures again.

import { mkdtempSync, rmSync, writeFileSync, existsSync, copyFileSync, readFileSync, readdirSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect } from './detect.mjs'
import { NOT_MUTATED } from './layout.mjs'
import { plantedInstructions } from './planted.mjs'
import { appSeeds } from './seeds.mjs'
import { trackedFiles } from './layout.mjs'
import { arg, isEnvFile, isEnvLike, isMain, PINNED, projectEnv, readJson, readJsonIf, run, runGroup, strykerFailure, tail, withDatabasePointedNowhere, writeJson } from './lib.mjs'

/** The install command: exactly the lockfile when there is one. Yarn 2 and later replaced `--frozen-lockfile` with `--immutable`. */
export function installCommand({ name, lockfile, modern }) {
  if (name === 'npm') return lockfile ? ['npm', 'ci', '--no-audit', '--no-fund'] : ['npm', 'install', '--no-audit', '--no-fund']
  if (name === 'yarn') return lockfile ? ['yarn', 'install', modern ? '--immutable' : '--frozen-lockfile'] : ['yarn', 'install']
  return lockfile ? [name, 'install', '--frozen-lockfile'] : [name, 'install']
}

/** Where each step runs in the copy: the app's folder, and the folder installing happens from. Runs from before the layout scan use the root. */
export function places(copyPath, facts) {
  const at = dir => (dir && dir !== '.' ? join(copyPath, dir) : copyPath)
  const layout = facts.layout
  return { app: layout?.app?.dir ?? '.', appPath: at(layout?.app?.dir), installPath: at(layout?.installRoot) }
}

const LOADERS = [
  ['tsx', '--import tsx'],
  ['jiti', '--import jiti/register'],
]
const ONE_FILE = { vitest: 'npx vitest run {file}', jest: 'npx jest {file}', mocha: 'npx mocha {file}', ava: 'npx ava {file}', tap: 'npx tap {file}', uvu: 'npx uvu {file}' }

/**
 * How to run one test in the copy, for the attacker and for proofs, so neither spends its turns
 * finding out: `{ runner, command, example, loader, note }`, where `command` has `{file}` for the
 * test's path from the copy's top. With no runner, Node's own, with a TypeScript loader the project
 * already has (never one installed). Read from the layout and the installed packages.
 */
export function testSetupFor(layout, appPath) {
  const app = layout.app?.dir ?? '.'
  const has = name => existsSync(join(appPath, 'node_modules', name, 'package.json'))
  const loader = LOADERS.find(([name]) => has(name)) ?? null
  const runner = layout.runner && !['playwright', 'cypress'].includes(layout.runner) ? layout.runner : null
  const node = `node ${layout.typescript && loader ? `${loader[1]} ` : ''}--test {file}`
  const command = app !== '.' ? null : runner === 'node --test' ? node : runner ? ONE_FILE[runner] ?? null : node
  const note =
    app !== '.'
      ? `The app is in ${app}/: run its tests from there with the package manager's folder option (pnpm --filter, npm -w).`
      : !runner && layout.typescript && !loader
        ? 'No test runner and no TypeScript loader: write tests in plain JavaScript (.mjs), run with node --test.'
        : !runner
          ? `No test runner: Node's own, with ${loader ? loader[0] : 'no loader'}.`
          : ''
  return { runner: runner ?? 'node --test', command, example: layout.tests?.example ?? null, loader: loader?.[0] ?? null, note }
}

/** A tool's report with its paths from the app's folder, made paths from the repository's top, as every other step names files. */
export function fromRepositoryTop(value, app) {
  if (!app || app === '.') return value
  const prefix = path => (typeof path === 'string' && path !== '' && !path.startsWith('/') ? `${app}/${path}`.replace(/\/\.$/, '') : path)
  const walk = item => {
    if (Array.isArray(item)) return item.map(walk)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, ['path', 'file'].includes(key) ? prefix(inner) : walk(inner)]))
  }
  return walk(value)
}

/** Stryker's report names files by their path in the folder it ran in. */
export function mutationFromRepositoryTop(report, app) {
  if (!report?.files || !app || app === '.') return report
  return { ...report, files: Object.fromEntries(Object.entries(report.files).map(([path, file]) => [`${app}/${path}`, file])) }
}

/**
 * Known vulnerabilities counted from a package manager's audit output: npm and pnpm write one summary,
 * Yarn 1 one summary line among others, Yarn 2 and later and Bun one entry per advisory.
 */
export function auditCounts(tool, stdout) {
  const counts = { critical: 0, high: 0, moderate: 0 }
  const add = severity => {
    if (severity in counts) counts[severity] += 1
  }
  if (tool === 'npm' || tool === 'pnpm') {
    const v = JSON.parse(stdout).metadata?.vulnerabilities
    if (!v) throw new Error('no summary')
    return { critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0 }
  }
  const lines = stdout.split('\n').filter(line => line.trim().startsWith('{')).map(line => JSON.parse(line))
  if (tool === 'yarn') {
    const v = lines.find(line => line.type === 'auditSummary')?.data?.vulnerabilities
    if (!v) throw new Error('no summary')
    return { critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0 }
  }
  if (tool === 'yarn-modern') {
    for (const line of lines) add(String(line.children?.Severity ?? '').toLowerCase())
    return counts
  }
  if (tool === 'bun') {
    const report = JSON.parse(stdout.slice(stdout.indexOf('{')) || '{}')
    for (const advisories of Object.values(report)) for (const a of [].concat(advisories)) add(String(a?.severity ?? '').toLowerCase())
    return counts
  }
  throw new Error(`no audit for ${tool}`)
}

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info']

/**
 * The packages an audit names, worst first, each with its worst severity: `[{ name, severity }]`.
 * npm names vulnerable packages; pnpm and Yarn 1 name each advisory's package; Yarn 2+ and Bun name
 * the package each entry is about.
 */
export function auditPackages(tool, stdout) {
  const worst = new Map()
  const add = (name, severity) => {
    const s = String(severity ?? '').toLowerCase()
    if (!name || !SEVERITY_ORDER.includes(s)) return
    if (!worst.has(name) || SEVERITY_ORDER.indexOf(s) < SEVERITY_ORDER.indexOf(worst.get(name))) worst.set(name, s)
  }
  try {
    if (tool === 'npm') for (const [name, v] of Object.entries(JSON.parse(stdout).vulnerabilities ?? {})) add(name, v.severity)
    else if (tool === 'pnpm') for (const a of Object.values(JSON.parse(stdout).advisories ?? {})) add(a.module_name, a.severity)
    else if (tool === 'bun') for (const [name, list] of Object.entries(JSON.parse(stdout.slice(stdout.indexOf('{')) || '{}'))) for (const a of [].concat(list)) add(name, a?.severity)
    else {
      for (const line of stdout.split('\n').filter(l => l.trim().startsWith('{')).map(l => JSON.parse(l))) {
        if (tool === 'yarn' && line.type === 'auditAdvisory') add(line.data?.advisory?.module_name, line.data?.advisory?.severity)
        if (tool === 'yarn-modern') add(line.value, line.children?.Severity)
      }
    }
  } catch {
    return []
  }
  return [...worst].map(([name, severity]) => ({ name, severity })).sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.name.localeCompare(b.name))
}

const AUDIT = {
  npm: { argv: ['npm', 'audit', '--json', '--omit=dev'], label: 'npm audit --omit=dev' },
  pnpm: { argv: ['pnpm', 'audit', '--json', '--prod'], label: 'pnpm audit --prod' },
  yarn: { argv: ['yarn', 'audit', '--json', '--groups', 'dependencies'], label: 'yarn audit --groups dependencies' },
  'yarn-modern': { argv: ['yarn', 'npm', 'audit', '--json', '--environment', 'production', '--recursive'], label: 'yarn npm audit --environment production' },
  // Bun's audit has no way to leave out dev tools: they are counted too.
  bun: { argv: ['bun', 'audit', '--json'], label: 'bun audit (dev tools included)' },
}

const RUNNER = { npm: ['npm', 'run'], pnpm: ['pnpm', 'run'], yarn: ['yarn', 'run'], bun: ['bun', 'run'] }

const HERE = dirname(fileURLToPath(import.meta.url))

/** What a measurement depends on besides the code: the commit, Imagineer's version and the tools used. */
export function measurementKey(commit, facts) {
  const manifest = readJsonIf(join(HERE, '../../../.claude-plugin/plugin.json'))
  // The same commit measured as another app, or over other folders, is another measurement.
  const layout = facts.layout ? { app: facts.layout.app?.dir ?? null, mutate: facts.layout.sources?.mutate ?? null, scripts: Object.fromEntries(Object.entries(facts.layout.scripts ?? {}).map(([k, v]) => [k, v?.name ?? null])) } : null
  return JSON.stringify({ commit, imagineer: manifest?.version ?? 'unknown', pinned: PINNED, tools: facts.tools, layout })
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

/**
 * A commit can carry env files, an install can write more, and the project's own tests load them.
 * In the copy their database settings point nowhere (the examples' too: a test setup copies them into place), so no test reaches a database through them;
 * every other setting stays, so the project's own test settings still work. A link is never
 * followed: an env file that is one is removed, and a linked folder is not entered, so nothing
 * outside the copy is read or written. Returns each file with the names replaced, never their values.
 */
export function cleanEnvFiles(root) {
  const cleaned = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const file = relative(root, path)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') walk(path)
      } else if (isEnvLike(entry.name)) {
        if (entry.isSymbolicLink()) {
          rmSync(path, { force: true })
          cleaned.push({ file, removed: true, replaced: [] })
        } else if (entry.isFile()) {
          const { text, replaced } = withDatabasePointedNowhere(readFileSync(path, 'utf8'))
          if (!replaced.length) continue
          writeFileSync(path, text)
          // An example is cleaned too, and marked: it is not the project's own settings, so not worth telling the user about.
          cleaned.push(isEnvFile(entry.name) ? { file, replaced } : { file, example: true, replaced })
        }
      }
    }
  }
  walk(root)
  return cleaned
}

function prepare(repo, out) {
  // Prepared again in the same run (after the user said which folder is their app): the earlier copy goes.
  const earlier = readJsonIf(join(out, 'copy.json'))?.path
  if (earlier && basename(earlier).startsWith('imagineer-') && existsSync(earlier)) rmSync(earlier, { recursive: true, force: true })
  const left = removeLeftCopies(out)
  if (left.length) console.log(`Removed the throwaway ${left.length === 1 ? 'copy' : 'copies'} that run ${left.join(', ')} left behind.`)
  const head = run(['git', '-C', repo, 'rev-parse', '--short', 'HEAD'])
  if (!head.ok) throw new Error(`Not a git repository with a commit: ${repo}`)
  const dirty = run(['git', '-C', repo, 'status', '--porcelain']).stdout.trim() !== ''

  // The layout first: when it cannot tell which folder is the app, nothing is copied until the user says.
  const first = detect(repo)
  if (first.layout.ask) {
    writeJson(join(out, 'detect.json'), first)
    console.log(
      `Ask the user: ${first.layout.ask.question}\n${first.layout.ask.candidates.map(c => `- ${c.dir}${c.name ? ` (${c.name})` : ''}: ${c.sourceFiles} source files, ${c.testFiles} test files`).join('\n')}\nKeep the answer with \`settings.mjs layout --app <folder>\`, then prepare again.`,
    )
    process.exit(3)
  }

  // The committed state only: what was measured is exactly a commit.
  const path = mkdtempSync(join(tmpdir(), 'imagineer-'))
  const archive = run(['sh', '-c', `git -C "$1" archive HEAD | tar -x -C "$2"`, 'sh', repo, path])
  if (!archive.ok) throw new Error(`Could not copy the repository: ${tail(archive.stderr)}`)
  const envFilesCleaned = cleanEnvFiles(path)
  // Read again from the copy: exactly the commit, whatever the working tree holds.
  const facts = detect(repo, { root: path })
  writeJson(join(out, 'detect.json'), facts)
  // Where blind questions can start: errors handled silently, rules stated in comments. Never graded.
  writeJson(join(out, 'seeds.json'), appSeeds(trackedFiles(repo), path, facts.layout.app?.dir ?? '.'))

  const { installPath } = places(path, facts)
  const install = facts.isNodeProject
    ? run(installCommand(facts.layout.manager), { cwd: installPath, timeoutMs: 15 * 60_000, project: true })
    : { ok: false, seconds: 0, stderr: 'No package.json.' }
  // Again after the install: its scripts can write an env file (a copy of the example, most often).
  for (const entry of facts.isNodeProject ? cleanEnvFiles(path) : []) {
    const earlier = envFilesCleaned.find(e => e.file === entry.file)
    if (earlier) earlier.replaced.push(...entry.replaced)
    else envFilesCleaned.push(entry)
  }
  // How to run one test here, now that the packages are installed: given to the attacker and to proofs.
  if (facts.isNodeProject) {
    facts.layout.testSetup = testSetupFor(facts.layout, places(path, facts).appPath)
    writeJson(join(out, 'detect.json'), facts)
  }
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
    // The env files in the copy, and the database settings pointed nowhere in each there: names, never values.
    envFilesCleaned,
    // What a later run on the same commit, with the same versions, may reuse from this one.
    key: measurementKey(head.stdout.trim(), facts),
  })
  console.log(`Copied ${head.stdout.trim()}${dirty ? ' (uncommitted changes not included)' : ''} to ${path}; install ${install.ok ? 'passed' : 'failed'}.`)
  console.log(`Layout:\n${facts.layout.summary.map(line => `- ${line}`).join('\n')}`)
  for (const line of facts.layout.defaults) console.log(`Default used: ${line}.`)
  for (const { file, removed, replaced } of envFilesCleaned.filter(e => !e.example)) {
    console.log(removed ? `${file} is a link: removed from the copy.` : `${file}: in the copy, ${replaced.join(', ')} ${replaced.length === 1 ? 'points' : 'point'} nowhere, so no test reaches that database.`)
  }
}

/** The script for a purpose, `{ name, dir }`: from the layout, or by its usual name in a run from before it. */
const scriptFor = (facts, purpose) => facts.layout?.scripts?.[purpose] ?? (facts.scripts?.[purpose] ? { name: purpose, dir: '.' } : null)

function checks(out) {
  const { copy, repoFacts } = state(out)
  const runner = RUNNER[repoFacts.manager]
  const step = purpose => {
    const script = scriptFor(repoFacts, purpose)
    if (!script) return { present: false }
    const cwd = script.dir && script.dir !== '.' ? join(copy.path, script.dir) : copy.path
    const result = run([...runner, script.name], { cwd, project: true, timeoutMs: 20 * 60_000 })
    return { present: true, script: script.name, dir: script.dir ?? '.', ok: result.ok, seconds: result.seconds, output: tail(result.stdout + '\n' + result.stderr) }
  }
  const result = { typecheck: step('typecheck'), test: step('test') }
  writeJson(join(out, 'checks.json'), result)
  console.log(`Typecheck: ${describe(result.typecheck)}. Tests: ${describe(result.test)}.`)
}

const describe = step => (!step.present ? 'none' : step.ok ? `passed in ${step.seconds}s` : 'failed')

function fallow(out) {
  const { copy, repoFacts } = state(out)
  const { app, appPath } = places(copy.path, repoFacts)
  const own = repoFacts.tools.fallow.inRepo && repoFacts.tools.fallow.version !== null
  const command = own ? ['npx', 'fallow'] : ['npx', '-y', `fallow@${PINNED.fallow}`]
  const health = run([...command, 'health', '--format', 'json', '--quiet'], { cwd: appPath, project: true })
  const check = run([...command, 'check', '--format', 'json', '--quiet'], { cwd: appPath, project: true })
  const parse = result => {
    try {
      return fromRepositoryTop(JSON.parse(result.stdout), app)
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
  // Stryker runs in the app's folder, with the app's own test script; its report is made to name files from the repository's top.
  const { app, appPath } = places(copy.path, repoFacts)
  const testScript = scriptFor(repoFacts, 'test')
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
        const failed = { ok: false, error: `Could not install Stryker: ${tail(installed.stderr)}` }
        if (isEstimate) writeJson(join(out, 'stryker-estimate.json'), failed)
        writeJson(join(out, 'stryker.json'), failed)
        console.log('Stryker could not be installed.')
        return
      }
    }
    command = [bin, 'run']
  }

  let config = repoFacts.tools.stryker.config
  if (!own || config === null) {
    if (testScript && (testScript.dir ?? '.') !== app) {
      // Stryker copies the app's folder and runs its tests there; a script elsewhere would test the original files.
      const failed = { ok: false, error: `The app's own package.json (${app === '.' ? 'at the root' : `in ${app}`}) has no test script; the tests run from ${testScript.dir === '.' ? 'the root' : testScript.dir}, which test strength cannot point at its copy` }
      if (isEstimate) writeJson(join(out, 'stryker-estimate.json'), failed)
      writeJson(join(out, 'stryker.json'), failed)
      console.log(`Test strength could not run: ${failed.error}.`)
      return
    }
    // Imagineer's defaults: run the app's own tests for every mutant, planting bugs in the folders the layout found.
    // With no test command, a command that runs no tests: every planted bug survives, which is the honest
    // answer, and each line gets its record, so an answer about it can still be proven by a new test.
    config = 'stryker.imagineer.json'
    const mutate = repoFacts.layout?.sources?.mutate
    const testCommand = testScript ? `${RUNNER[repoFacts.manager].join(' ')} ${testScript.name}` : 'node -e "process.exit(0)"'
    writeFileSync(
      join(appPath, config),
      JSON.stringify({
        ...(mutate?.length ? { mutate: [...mutate, ...NOT_MUTATED] } : {}),
        testRunner: 'command',
        commandRunner: { command: testCommand },
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
  if (mutate) argv.push('--mutate', [mutate, ...NOT_MUTATED].join(','))
  if (isEstimate) argv.push('--dryRunOnly')
  // Its own process group: stopping this script stops every Stryker worker with it.
  const result = await runGroup(argv, { cwd: appPath, project: true, timeoutMs: isEstimate ? 15 * 60_000 : 6 * 60 * 60_000 })
  const log = result.stdout + '\n' + result.stderr

  if (isEstimate) {
    const mutants = Number(log.match(/with (\d+) mutant/)?.[1] ?? NaN)
    const testSeconds = Number(log.match(/Ran [\d.]+ tests? in ([\d.]+) seconds?/)?.[1] ?? NaN)
    // Runs side by side slow each other down; 1.5 is what the first real project showed at this concurrency.
    const minutes = Number.isFinite(mutants) && Number.isFinite(testSeconds) ? Math.ceil((mutants * testSeconds * 1.5) / concurrency / 60) : null
    writeJson(join(out, 'stryker-estimate.json'), { ok: result.ok, mutants, testSeconds, concurrency, minutes, output: result.ok ? '' : tail(log) })
    if (result.ok) {
      console.log(`Stryker: ${mutants} mutants, about ${minutes} minutes with ${concurrency} at a time.`)
      return
    }
    // A failed first run means the full run cannot run either: recorded as a failed check, so the grade
    // says it could not run and why, and the self-check flags it. Never left looking like "not measured yet".
    const { reason, failingTests } = strykerFailure(log)
    writeJson(join(out, 'stryker.json'), { ok: false, error: reason, failingTests })
    console.log(`Test strength could not run: ${reason}.${failingTests.length ? `\nFailing tests:\n${failingTests.map(t => `- ${t}`).join('\n')}` : ''}`)
    return
  }

  const report = join(appPath, 'reports/mutation/mutation.json')
  if (existsSync(report)) writeJson(join(out, 'mutation.json'), mutationFromRepositoryTop(readJson(report), app))
  writeJson(join(out, 'stryker.json'), {
    ok: result.ok && existsSync(report),
    measured: own ? 'repo' : 'default',
    version: own ? repoFacts.tools.stryker.version : PINNED.stryker,
    // What was mutated, so a reuse takes only a run over the same scope.
    mutate: arg('mutate') ?? null,
    // No test command: no test ran for any planted bug.
    noTests: !testScript && (!own || repoFacts.tools.stryker.config === null),
    // The folders the layout found, measured when no scope was given.
    scope: arg('mutate') ? null : (repoFacts.layout?.sources?.mutate ?? null),
    seconds: result.seconds,
    error: existsSync(report) ? null : tail(log),
  })
  console.log(existsSync(report) ? `Stryker finished in ${Math.round(result.seconds / 60)} minutes.` : `Stryker failed:\n${tail(log)}`)
}

function security(out) {
  const { copy, repoFacts } = state(out)
  const { app, appPath, installPath } = places(copy.path, repoFacts)
  const own = repoFacts.tools.fallow.inRepo && repoFacts.tools.fallow.version !== null
  const command = own ? ['npx', 'fallow'] : ['npx', '-y', `fallow@${PINNED.fallow}`]
  const scan = run([...command, 'security', '--format', 'json', '--quiet'], { cwd: appPath, project: true })
  let candidates = null
  try {
    candidates = fromRepositoryTop(JSON.parse(scan.stdout).security_findings ?? [], app)
  } catch {}

  // Known vulnerabilities in the dependencies the app ships with (not dev tools), with the project's own package manager.
  const manager = repoFacts.layout?.manager ?? { name: repoFacts.manager, lockfile: repoFacts.lockfile, modern: false }
  const tool = manager.name === 'yarn' && manager.modern ? 'yarn-modern' : manager.name
  let audit = { skipped: `No audit for ${manager.name} yet.` }
  if (!manager.lockfile) audit = { skipped: 'No lockfile, so the versions an install gets are not known.' }
  else if (AUDIT[tool]) {
    // An audit exits non-zero when it finds something: its output is read either way.
    const result = run(AUDIT[tool].argv, { cwd: installPath, project: true, timeoutMs: 3 * 60_000 })
    try {
      audit = { tool: AUDIT[tool].label, ...auditCounts(tool, result.stdout), packages: auditPackages(tool, result.stdout) }
    } catch {
      audit = { skipped: `${AUDIT[tool].label.split(' (')[0]} did not answer: ${tail(result.stderr || result.stdout, 3)}` }
    }
  }
  // Text that gives orders to AI tools or reviewers: shown to the user, never obeyed.
  const planted = plantedInstructions(copy.source ?? copy.path, { root: copy.path })
  writeJson(join(out, 'security.json'), {
    planted,
    candidates:
      candidates === null
        ? null
        : candidates.map(c => ({ path: c.path, line: c.line, category: c.category, cwe: c.cwe, severity: c.severity, evidence: c.evidence })),
    audit,
  })
  console.log(
    `Possible security weaknesses: ${candidates === null ? 'scan failed' : candidates.length}. Dependency audit: ${audit.skipped?.replace(/\.$/, '') ?? `${audit.critical} critical, ${audit.high} high`}.`,
  )
  if (planted.length) console.log(`Text that gives orders to AI tools or reviewers (not followed; a finding for the user):\n${planted.map(p => `- ${p.path}:${p.line} ${p.why}: ${p.text}`).join('\n')}`)
}

function cleanup(out) {
  const { copy } = state(out)
  if (copy.path.includes('imagineer-')) rmSync(copy.path, { recursive: true, force: true })
  console.log(`Removed ${copy.path}.`)
}

// Run as a command (paths compared resolved, so spaces or a relative path do not stop it); loaded by a test, it only exports.
if (isMain(import.meta.url)) {
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
      // A check that already failed is never recorded as the user's choice: that would hide the failure.
      const earlier = readJsonIf(join(out, 'stryker.json'))
      if (earlier && earlier.ok === false && earlier.error) {
        console.error(`Test strength could not run (${earlier.error}); it stays recorded as a failure, not as skipped.`)
        process.exit(1)
      }
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
    else if (step === 'cleanup') cleanup(out)
    else throw new Error('Steps: prepare, checks, fallow, stryker, security, cleanup')
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
