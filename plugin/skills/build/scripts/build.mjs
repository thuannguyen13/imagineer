#!/usr/bin/env node
// Build's run state, worktree, models, red-first tests, done bar and pull
// request body. The run folder is <repo>/.claude/imagineer/build/<slug>/,
// kept out of git with the worktrees.
//
//   node build.mjs models    [--set recommended|budget|maximum|<json>]      the user's model preset
//   node build.mjs start     --repo <repo> --slug <slug> --request "<what to build>"
//   node build.mjs state     --repo <repo> --slug <slug> [--phase <p>] [--status <s>] [--round <n>]
//   node build.mjs list      --repo <repo>                                   unfinished runs
//   node build.mjs worktree  --repo <repo> --slug <slug>
//   node build.mjs require   --repo <repo> --slug <slug> --id R1 --text "<requirement>" [--tests <file>,<file>]
//   node build.mjs red       --repo <repo> --slug <slug> --run "<command for QA's tests>"
//   node build.mjs bar       --repo <repo> --slug <slug> --run "<command for QA's tests>" [--skip-mutation]
//   node build.mjs pr-body   --repo <repo> --slug <slug>

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, readJson, readJsonIf, run, tail, writeJson } from '../../inspect/scripts/lib.mjs'
import { detect } from '../../inspect/scripts/detect.mjs'
import { mutationScore } from '../../inspect/scripts/grade.mjs'
import { isCritical, loadLedger } from '../../inspect/scripts/questions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const INSPECT = join(HERE, '../../inspect/scripts')

export const PRESETS = {
  recommended: { architect: 'opus', dev: 'sonnet', devCritical: 'opus', qa: 'opus' },
  budget: { architect: 'sonnet', dev: 'sonnet', devCritical: 'sonnet', qa: 'sonnet' },
  maximum: { architect: 'opus', dev: 'opus', devCritical: 'opus', qa: 'opus' },
}
const MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable', 'inherit'])
const prefsPath = () => join(process.env.IMAGINEER_HOME ?? join(homedir(), '.claude', 'imagineer'), 'preferences.json')

/** The user's model choice: a preset name, or a role-by-role map. Per user, not per repo. */
export function modelsFrom(choice) {
  if (typeof choice === 'string' && choice in PRESETS) return { preset: choice, ...PRESETS[choice] }
  if (choice && typeof choice === 'object') {
    const models = { ...PRESETS.recommended, ...choice }
    for (const role of ['architect', 'dev', 'devCritical', 'qa']) {
      if (!MODELS.has(models[role])) throw new Error(`Unknown model "${models[role]}" for ${role}. Models: ${[...MODELS].join(', ')}`)
    }
    return { preset: 'custom', ...models }
  }
  return null
}

const runDir = (repo, slug) => join(repo, '.claude/imagineer/build', slug)
const statePath = (repo, slug) => join(runDir(repo, slug), 'state.json')
const loadState = (repo, slug) => {
  const state = readJsonIf(statePath(repo, slug))
  if (!state) throw new Error(`No Build run "${slug}". Start one with: build.mjs start`)
  return state
}
const saveState = (repo, state) => writeJson(statePath(repo, state.slug), { ...state, updatedAt: new Date().toISOString() })

function excludeFromGit(repo, lines) {
  const path = run(['git', '-C', repo, 'rev-parse', '--git-path', 'info/exclude']).stdout.trim()
  const target = path.startsWith('/') ? path : join(repo, path)
  const text = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const missing = lines.filter(line => !text.split('\n').includes(line))
  if (missing.length) appendFileSync(target, `${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`)
}

/** Keeps the status line above the prompt current, without touching the repo's grade. */
function banner(repo, state) {
  const path = join(repo, '.claude/imagineer/results.json')
  const results = readJsonIf(path) ?? {
    schema: 1,
    imagineer: 'unknown',
    scale: 1,
    overall: { state: 'unchecked', reason: 'Run /imagineer:inspect for a grade.' },
    dimensions: [],
    questions: { waiting: 0, resolved: 0 },
    run: {},
  }
  const status = state.status === 'running' ? 'running' : state.status === 'waiting' ? 'waiting' : 'done'
  results.run = { ...results.run, command: 'build', status, round: state.round }
  writeJson(path, results)
}

const git = (cwd, ...args) => run(['git', '-C', cwd, ...args])

function start(repo, slug, request) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)) throw new Error('The slug is 1 to 41 lowercase letters, digits and hyphens.')
  if (existsSync(statePath(repo, slug))) throw new Error(`A Build run "${slug}" exists already. Resume it, or choose another name.`)
  const branch = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()
  const sha = git(repo, 'rev-parse', 'HEAD').stdout.trim()
  if (!sha) throw new Error('Not a git repository with a commit.')
  excludeFromGit(repo, ['.claude/imagineer/', '.claude/worktrees/'])
  const state = {
    slug,
    request,
    status: 'running',
    phase: 'design',
    round: 0,
    base: { branch, sha },
    branch: `imagineer/${slug}`,
    worktree: join(repo, '.claude/worktrees', slug),
    requirements: [],
    rounds: [],
    red: null,
    startedAt: new Date().toISOString(),
  }
  saveState(repo, state)
  banner(repo, state)
  console.log(`Build "${slug}" started from ${branch} at ${sha.slice(0, 7)}. Run folder: ${runDir(repo, slug)}`)
}

function worktree(repo, slug) {
  const state = loadState(repo, slug)
  if (!existsSync(state.worktree)) {
    const added = git(repo, 'worktree', 'add', '-b', state.branch, state.worktree, state.base.sha)
    if (!added.ok) throw new Error(`Could not add the worktree: ${tail(added.stderr)}`)
  }
  const facts = detect(state.worktree)
  const install = { npm: ['npm', 'ci', '--no-audit', '--no-fund'], pnpm: ['pnpm', 'install', '--frozen-lockfile'], yarn: ['yarn', 'install', '--frozen-lockfile'], bun: ['bun', 'install'] }[facts.manager]
  const installed = facts.lockfile ? run(install, { cwd: state.worktree, timeoutMs: 15 * 60_000 }) : { ok: true }
  console.log(`Worktree ${state.worktree} on ${state.branch}; dependencies ${installed.ok ? 'installed' : `failed: ${tail(installed.stderr, 5)}`}.`)
}

/** QA's tests must fail before any feature code exists: proof that they can fail. */
function red(repo, slug, command) {
  const state = loadState(repo, slug)
  const result = run(['sh', '-c', command], { cwd: state.worktree, timeoutMs: 10 * 60_000 })
  state.red = { command, failedFirst: !result.ok, commit: git(state.worktree, 'rev-parse', '--short', 'HEAD').stdout.trim(), output: tail(result.stdout + '\n' + result.stderr, 20) }
  saveState(repo, state)
  console.log(result.ok ? "QA's tests already pass with no feature code: they do not test the new behaviour. Send them back to QA." : "QA's tests fail before the feature exists, as they should.")
}

/** Source files changed since the base, which the done bar mutates. */
export function changedSources(files) {
  return files.filter(f => /\.(m|c)?[jt]sx?$/.test(f) && !/(^|\/)(test|tests|__tests__|spec|e2e)\/|\.(test|spec)\./.test(f) && !f.startsWith('.claude/'))
}

export function barFrom({ tests, typecheck, audit, mutation, critical }) {
  const missing = []
  if (!tests.ok) missing.push("QA's tests do not pass")
  if (typecheck && typecheck.present && !typecheck.ok) missing.push('the typecheck fails')
  if (audit && audit.ok && audit.verdict !== 'pass') missing.push('Fallow finds new problems in the changed code')
  if (audit && !audit.ok) missing.push('Fallow could not audit the change')
  if (mutation === 'skipped') missing.push('mutation testing skipped')
  else if (mutation) {
    if (mutation.total === 0) missing.push('no changed source code to mutate')
    else if ((mutation.timeouts ?? 0) > 10 && mutation.timeouts / mutation.total > 0.2) {
      missing.push(`${mutation.timeouts} of ${mutation.total} breaks timed out, so the run cannot say whether the tests would notice`)
    }
    else if (mutation.caught / mutation.total < 0.8) {
      missing.push(`tests catch ${Math.round((mutation.caught / mutation.total) * 100)}% of breaks in the changed code, below 80%`)
    }
    for (const file of critical) missing.push(`breaks no test notices in critical code: ${file.path} (${file.missed})`)
  }
  return { met: missing.length === 0, missing }
}

function bar(repo, slug, command, skipMutation) {
  const state = loadState(repo, slug)
  state.round += 1
  const out = join(runDir(repo, slug), `round-${state.round}`)
  const tests = run(['sh', '-c', command], { cwd: state.worktree, timeoutMs: 20 * 60_000 })
  const changed = git(state.worktree, 'diff', '--name-only', `${state.base.sha}...HEAD`).stdout.split('\n').filter(Boolean)
  const sources = changedSources(changed)

  const step = (...args) => run(['node', join(INSPECT, 'measure.mjs'), ...args, '--out', out], { timeoutMs: 6 * 60 * 60_000 })
  step('prepare', '--repo', state.worktree)
  step('checks')
  step('audit', '--base', state.base.sha)
  let mutation = 'skipped'
  if (!skipMutation && sources.length) {
    step('stryker', '--mutate', sources.join(','))
    const report = readJsonIf(join(out, 'mutation.json'))
    if (report) {
      const scored = mutationScore(report)
      const ledger = loadLedger(repo)
      mutation = {
        ...scored,
        critical: scored.files.filter(f => isCritical(ledger, f.path) && f.caught < f.total).map(f => ({ path: f.path, missed: f.total - f.caught })),
      }
    }
  } else if (!sources.length) mutation = { caught: 0, total: 0, score: 0, files: [], critical: [] }
  step('cleanup')

  const checks = readJsonIf(join(out, 'checks.json'))
  const audit = readJsonIf(join(out, 'audit.json'))
  const result = barFrom({ tests: { ok: tests.ok }, typecheck: checks?.typecheck, audit, mutation, critical: mutation === 'skipped' ? [] : mutation.critical })
  const commit = git(state.worktree, 'rev-parse', '--short', 'HEAD').stdout.trim()
  state.rounds.push({
    round: state.round,
    commit,
    changed: sources,
    tests: tests.ok,
    audit: audit?.verdict ?? null,
    mutation: mutation === 'skipped' ? null : { caught: mutation.caught, total: mutation.total },
    bar: result,
  })
  if (result.met) state.phase = 'done'
  saveState(repo, state)
  banner(repo, state)
  writeJson(join(out, 'bar.json'), { commit, ...result, testsOutput: tests.ok ? '' : tail(tests.stdout + '\n' + tests.stderr, 20) })
  console.log(result.met ? `Round ${state.round} at ${commit}: the done bar is met.` : `Round ${state.round} at ${commit}: not done. ${result.missing.join('; ')}.`)
  if (!tests.ok) console.log(tail(tests.stdout + '\n' + tests.stderr, 20))
}

const STATE_WORD = { strong: '✓ Strong', weak: '! Weak', failing: '✕ Failing', unchecked: '? Not checked', 'not-proven': '? Not proven yet' }

/** The repository's grade from its last Inspect run, as it stood before this change. */
export function gradeSection(results) {
  if (!results || !Array.isArray(results.dimensions) || results.dimensions.length === 0) {
    return ['## Repository grade', '', 'Not inspected yet. Run `/imagineer:inspect` after merging for a grade.']
  }
  const lines = [
    '## Repository grade',
    '',
    `Before this change, at ${results.run?.commit || 'an earlier commit'}: **${STATE_WORD[results.overall?.state] ?? results.overall?.state}**${results.overall?.reason ? ` (${results.overall.reason})` : ''}`,
    '',
  ]
  for (const d of results.dimensions) lines.push(`- ${STATE_WORD[d.state] ?? d.state} ${d.name}${d.summary ? `: ${d.summary}` : ''}`)
  lines.push('', 'Run `/imagineer:inspect` after merging for the grade with this change.')
  return lines
}

export function prBody(state, results = null) {
  const last = state.rounds.at(-1)
  const lines = [`${state.request}`, '', '## Requirements', '', '| ID | Requirement | Tests |', '|---|---|---|']
  for (const r of state.requirements) lines.push(`| ${r.id} | ${r.text} | ${r.tests.length ? r.tests.map(t => `\`${t}\``).join(', ') : 'none'} |`)
  lines.push('', '## Evidence', '')
  if (state.red) lines.push(`- QA's tests were written from the Architect's spec before any feature code, and **${state.red.failedFirst ? 'failed' : 'did not fail'}** at ${state.red.commit}, before the feature existed.`)
  if (last) {
    lines.push(`- At ${last.commit}: QA's tests ${last.tests ? 'pass' : 'fail'}; Fallow audit of the change: ${last.audit ?? 'not run'}.`)
    if (last.mutation) lines.push(`- Mutation testing of the changed code: the tests catch ${last.mutation.total ? Math.round((last.mutation.caught / last.mutation.total) * 100) : 0}% of deliberate breaks (${last.mutation.caught} of ${last.mutation.total}).`)
    lines.push(`- Done bar: ${last.bar.met ? '**met**' : `**not met**: ${last.bar.missing.join('; ')}`}.`)
  }
  lines.push('', '## Rounds', '', '| Round | Commit | Tests | Audit | Breaks caught | Bar |', '|---|---|---|---|---|---|')
  for (const r of state.rounds) {
    lines.push(`| ${r.round} | ${r.commit} | ${r.tests ? 'pass' : 'fail'} | ${r.audit ?? '-'} | ${r.mutation ? `${r.mutation.caught} of ${r.mutation.total}` : '-'} | ${r.bar.met ? 'met' : 'not met'} |`)
  }
  lines.push('', ...gradeSection(results))
  if (state.models) lines.push('', `Models: Architect ${state.models.architect}, Dev ${state.models.dev} (${state.models.devCritical} for data, money and permissions), QA ${state.models.qa}.`)
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step] = process.argv.slice(2)
  try {
    const repo = arg('repo') ? resolve(arg('repo')) : null
    const slug = arg('slug')
    const need = (...values) => {
      if (values.some(v => v === null)) throw new Error(`${step} needs --repo and --slug`)
    }
    if (step === 'models') {
      const choice = arg('set')
      if (choice) {
        const models = modelsFrom(choice.startsWith('{') ? JSON.parse(choice) : choice)
        if (!models) throw new Error('Choose recommended, budget, maximum, or a JSON map of roles to models.')
        writeJson(prefsPath(), { ...readJsonIf(prefsPath()), buildModels: models })
        console.log(JSON.stringify(models))
      } else {
        const saved = readJsonIf(prefsPath())?.buildModels ?? null
        console.log(JSON.stringify(saved ?? { unset: true, default: modelsFrom('recommended') }))
      }
    } else if (step === 'start') {
      need(repo, slug)
      start(repo, slug, arg('request') ?? '')
    } else if (step === 'state') {
      need(repo, slug)
      const state = loadState(repo, slug)
      for (const key of ['phase', 'status']) if (arg(key)) state[key] = arg(key)
      if (arg('round')) state.round = Number(arg('round'))
      if (arg('models')) state.models = JSON.parse(arg('models'))
      saveState(repo, state)
      banner(repo, state)
      console.log(JSON.stringify(state, null, 2))
    } else if (step === 'list') {
      if (!repo) throw new Error('list needs --repo')
      const dir = join(repo, '.claude/imagineer/build')
      const runs = existsSync(dir)
        ? run(['ls', dir]).stdout.split('\n').filter(Boolean).map(name => readJsonIf(join(dir, name, 'state.json'))).filter(Boolean)
        : []
      console.log(JSON.stringify(runs.filter(s => s.status !== 'done').map(s => ({ slug: s.slug, status: s.status, phase: s.phase, round: s.round, request: s.request })), null, 2))
    } else if (step === 'worktree') {
      need(repo, slug)
      worktree(repo, slug)
    } else if (step === 'require') {
      need(repo, slug)
      const state = loadState(repo, slug)
      const id = arg('id')
      if (!/^R\d+$/.test(id ?? '') || !arg('text')) throw new Error('require needs --id R<n> and --text')
      state.requirements = state.requirements.filter(r => r.id !== id)
      state.requirements.push({ id, text: arg('text'), tests: (arg('tests') ?? '').split(',').map(s => s.trim()).filter(Boolean) })
      state.requirements.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
      saveState(repo, state)
      console.log(`${state.requirements.length} requirements.`)
    } else if (step === 'red') {
      need(repo, slug)
      red(repo, slug, arg('run'))
    } else if (step === 'bar') {
      need(repo, slug)
      bar(repo, slug, arg('run'), process.argv.includes('--skip-mutation'))
    } else if (step === 'pr-body') {
      need(repo, slug)
      console.log(prBody(loadState(repo, slug), readJsonIf(join(repo, '.claude/imagineer/results.json'))))
    } else {
      throw new Error('Steps: models, start, state, list, worktree, require, red, bar, pr-body')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
