#!/usr/bin/env node
// Computes the grade from the evidence in a run folder and writes the
// results file (format 1, docs/results-file.md). Deterministic: the same
// evidence always gives the same grade. Agents add evidence; only this
// script sets a state.
//
//   node grade.mjs --repo <repo> --out <run folder> [--status running|waiting|done|stopped] [--round N]

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, readJson, readJsonIf, run, writeJson } from './lib.mjs'
import { loadAttacks, rounds } from './attack.mjs'
import { CRITICAL_TOPICS, emptyLedger, findings, isCritical, loadLedger, summary } from './questions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const RESULTS = '.claude/imagineer/results.json'
const SCALE = 1

const dimension = (id, name, group, state, measured, summary) => ({ id, name, group, state, measured, summary, stale: false, claimed: false })

const percent = n => `${Math.round(n * 100)}%`

const lines = n => `${n} ${n === 1 ? 'line' : 'lines'}`

/** Stryker's mutation score: breaks the tests noticed, of breaks that ran. */
export function mutationScore(report) {
  const files = Object.entries(report.files ?? {}).map(([path, file]) => {
    const counts = { caught: 0, total: 0 }
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') counts.caught += 1
      if (['Killed', 'Timeout', 'Survived', 'NoCoverage'].includes(mutant.status)) counts.total += 1
    }
    return { path, ...counts, score: counts.total ? counts.caught / counts.total : 1 }
  })
  const caught = files.reduce((n, f) => n + f.caught, 0)
  const total = files.reduce((n, f) => n + f.total, 0)
  return { caught, total, score: total ? caught / total : 0, files }
}

export function testStrength(evidence) {
  const { stryker, mutation } = evidence
  const ledger = evidence.ledger ?? emptyLedger()
  const name = 'Test strength'
  if (!stryker) return dimension('test-strength', name, 'trust', 'unchecked', 'none', 'Not measured yet.')
  if (stryker.skipped) return dimension('test-strength', name, 'trust', 'failing', 'default', stryker.skipped)
  if (!stryker.ok || !mutation) return dimension('test-strength', name, 'trust', 'unchecked', 'none', 'Mutation testing could not run, so test strength is unknown.')

  const { caught, total, score, files } = mutationScore(mutation)
  if (total === 0) return dimension('test-strength', name, 'trust', 'unchecked', stryker.measured, 'No code was mutated, so test strength is unknown.')
  const band = n => (n >= 0.8 ? 'strong' : n >= 0.6 ? 'weak' : 'failing')
  // Code the user confirmed as critical (money, data, permissions) must meet the bar
  // on its own, and every break no test noticed there must be explained.
  const critical = files.filter(f => f.total > 0 && isCritical(ledger, f.path))
  const unexplained = critical.flatMap(f =>
    (mutation.files[f.path].mutants ?? [])
      .filter(m => m.status === 'Survived' || m.status === 'NoCoverage')
      .map(m => `mutant:${f.path}:${m.location.start.line}`)
      .filter(key => !(key in ledger.dismissed)),
  )
  const order = ['strong', 'weak', 'failing']
  let state = band(score)
  for (const f of critical) if (order.indexOf(band(f.score)) > order.indexOf(state)) state = band(f.score)
  if (state === 'strong' && unexplained.length) state = 'weak'
  const criticalNote = critical.length
    ? ` Critical code: ${critical.map(f => `${f.path} ${percent(f.score)}`).join(', ')}${unexplained.length ? `; ${lines(new Set(unexplained).size)} with breaks not yet explained` : ''}.`
    : ''
  const weakest = files
    .filter(f => f.total > 0 && f.score < 0.6)
    .sort((a, b) => a.score - b.score || b.total - a.total)
    .slice(0, 3)
    .map(f => `${f.path} ${percent(f.score)}`)
  const summary = `Tests catch ${percent(score)} of deliberate breaks (${caught} of ${total}).${weakest.length ? ` Weakest: ${weakest.join(', ')}.` : ''}${criticalNote}`
  return dimension('test-strength', name, 'trust', state, stryker.measured, summary)
}

const resolvedNote = (byUser, byDocs) =>
  [byUser ? `${byUser} ${byUser === 1 ? 'finding' : 'findings'} resolved with you` : '', byDocs ? `${byDocs} settled from the repo's docs or code` : '']
    .filter(Boolean)
    .join(', ')

export function structure(evidence) {
  const { fallow } = evidence
  const name = 'Structure'
  if (!fallow) return dimension('structure', name, 'care', 'unchecked', 'none', 'Not measured yet.')
  if (!fallow.ok) return dimension('structure', name, 'care', 'unchecked', 'none', 'Fallow could not run, so structure is unknown.')

  const score = fallow.health.health_score?.score ?? 0
  const grade = fallow.health.health_score?.grade ?? '?'
  const parts = []
  const dismissed = (evidence.ledger ?? emptyLedger()).dismissed
  const open = (evidence.findings ?? []).filter(item => item.kind !== 'mutant' && !(item.key in dismissed))
  const ledger = evidence.ledger ?? emptyLedger()
  const resolvedKeys = (evidence.findings ?? []).filter(item => item.kind !== 'mutant' && item.key in dismissed).map(item => item.key)
  const byUser = resolvedKeys.filter(key => ledger.questions.find(q => q.id === dismissed[key].question)?.status === 'answered').length
  const byDocs = resolvedKeys.length - byUser
  const unusedFiles = open.filter(item => item.kind === 'unused-file').length
  const unusedExports = open.filter(item => item.kind === 'unused-export').length
  const complex = open.filter(item => item.kind === 'complex').length
  const duplication = fallow.health.vital_signs?.duplication_pct ?? 0
  if (unusedFiles) parts.push(`${unusedFiles} unused ${unusedFiles === 1 ? 'file' : 'files'}`)
  if (unusedExports) parts.push(`${unusedExports} unused ${unusedExports === 1 ? 'export' : 'exports'}`)
  if (complex) parts.push(`${complex} ${complex === 1 ? 'function' : 'functions'} too complex`)
  if (duplication >= 5) parts.push(`${duplication.toFixed(1)}% duplicated`)
  const state = score < 55 ? 'failing' : open.length > 0 || score < 70 ? 'weak' : 'strong'
  const summary = `Fallow health ${score} (${grade}).${parts.length ? ` ${parts.join(', ')}; not yet reviewed with you.` : ''}${resolvedKeys.length ? ` ${resolvedNote(byUser, byDocs)}.` : ''}`
  return dimension('structure', name, 'care', state, fallow.measured, summary)
}

export function foundations(evidence) {
  const { detect, copy, checks } = evidence
  const name = 'Foundations'
  if (!detect || !copy || !checks) return dimension('foundations', name, 'care', 'unchecked', 'none', 'Not measured yet.')

  const problems = []
  if (!detect.lockfile) problems.push('no lockfile')
  if (!copy.install.ok) problems.push('installing dependencies fails')
  if (detect.typescript && !checks.typecheck.present) problems.push('no typecheck command')
  if (checks.typecheck.present && !checks.typecheck.ok) problems.push('the typecheck fails')
  if (!checks.test.present) problems.push('no test command')
  if (checks.test.present && !checks.test.ok) problems.push('the tests fail')
  if (!detect.ci.runsTests) problems.push('CI does not run the tests')
  if (detect.env.missing.length) problems.push(`${detect.env.missing.join(', ')} not in ${detect.env.example ?? 'an .env.example'}`)

  const isBroken = !copy.install.ok || (checks.test.present && !checks.test.ok)
  const state = isBroken ? 'failing' : problems.length ? 'weak' : 'strong'
  const summary = problems.length
    ? `${problems[0][0].toUpperCase()}${problems.join('; ').slice(1)}.`
    : 'Lockfile, install, typecheck, tests, CI and env file all check out.'
  return dimension('foundations', name, 'care', state, 'repo', summary)
}

/** An answer is proven by a test that passes now and fails on every break behind it. */
export const isProven = q => q.test?.green === true && q.test.red?.total > 0 && q.test.red.killed === q.test.red.total

export function intent(evidence) {
  const ledger = evidence.ledger ?? emptyLedger()
  const counts = summary(ledger)
  const name = 'Matches your intent'
  if (counts.asked === 0) {
    const level = evidence.detect?.docs.level
    const text = level === 'none' ? 'No docs found, and no questions asked yet.' : 'No questions asked yet.'
    return dimension('intent', name, 'trust', 'unchecked', 'none', text)
  }
  const settled = ledger.questions.filter(q => q.status === 'decided').length
  const fromUser = counts.asked - settled
  const asked = `${fromUser} ${fromUser === 1 ? 'question' : 'questions'} for you${settled ? `, ${settled} settled from the repo's docs or code` : ''}`
  if (counts.openCritical) {
    return dimension('intent', name, 'trust', 'failing', 'repo', `${asked}; ${counts.openCritical} about data, money or permissions still open.`)
  }
  if (counts.waiting) return dimension('intent', name, 'trust', 'weak', 'repo', `${asked}; ${counts.waiting} still open.`)
  const answered = ledger.questions.filter(q => q.status === 'answered')
  const contradicted = answered.filter(q => q.test && q.test.green === false)
  if (contradicted.length) {
    const isCriticalGap = contradicted.some(q => CRITICAL_TOPICS.includes(q.topic))
    const ids = contradicted.map(q => q.id).join(', ')
    return dimension('intent', name, 'trust', isCriticalGap ? 'failing' : 'weak', 'repo', `${asked}; the code does not yet do what you answered for ${ids}.`)
  }
  const untested = answered.filter(q => !isProven(q)).length
  if (untested) {
    return dimension('intent', name, 'trust', 'weak', 'repo', `${asked}, all resolved; ${untested} ${untested === 1 ? 'answer is' : 'answers are'} not yet backed by a test.`)
  }
  return dimension('intent', name, 'trust', 'strong', 'repo', `${asked}, all resolved, and every answer is backed by a test seen failing, then passing.`)
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Answers on a topic: how many are proven, and which the code contradicts. */
function answersOn(ledger, topic) {
  const answered = ledger.questions.filter(q => q.status === 'answered' && q.topic === topic)
  return {
    total: answered.length,
    proven: answered.filter(isProven).length,
    contradicted: answered.filter(q => q.test && q.test.green === false).map(q => q.id),
  }
}

function attackNotes(attacks, category) {
  const mine = attacks.filter(a => a.category === category && !a.void)
  const { cleanInARow } = rounds(mine)
  const broke = mine.filter(a => a.result === 'broke')
  return { tried: mine.length, broke, cleanInARow }
}

export function security(evidence) {
  const name = 'Security and permissions'
  const ledger = evidence.ledger ?? emptyLedger()
  const attacks = attackNotes(evidence.attacks ?? [], 'permissions')
  const scan = evidence.security
  if (!attacks.tried && !scan) return dimension('security', name, 'trust', 'unchecked', 'none', 'Not tested by Imagineer yet.')

  const answers = answersOn(ledger, 'permissions')
  const failing = []
  if (attacks.broke.length) failing.push(`${plural(attacks.broke.length, 'attack')} broke through (${attacks.broke.map(a => a.title).join('; ')})`)
  if (scan?.audit?.critical || scan?.audit?.high) failing.push(`${scan.audit.critical} critical and ${scan.audit.high} high known vulnerabilities in dependencies`)
  if (answers.contradicted.length) failing.push(`the code contradicts your answer to ${answers.contradicted.join(', ')}`)
  if (failing.length) return dimension('security', name, 'trust', 'failing', 'default', `${failing.join('; ')}.`)

  const openCandidates = (evidence.findings ?? []).filter(item => item.kind === 'security' && !(item.key in ledger.dismissed)).length
  const gaps = []
  if (attacks.tried) gaps.push(`${plural(attacks.tried, 'attack')} held`)
  if (attacks.cleanInARow < 2) gaps.push(attacks.tried ? 'not yet 2 clean rounds' : 'no attack rounds yet')
  if (openCandidates) gaps.push(`${plural(openCandidates, 'possible weakness', 'possible weaknesses')} not yet verified`)
  if (answers.total > answers.proven) gaps.push(`${plural(answers.total - answers.proven, 'permission answer')} not yet proven by a test`)
  if (scan?.audit?.skipped) gaps.push('dependencies not audited')
  gaps.push('secrets not scanned yet')
  return dimension('security', name, 'trust', 'weak', 'default', `${gaps[0][0].toUpperCase()}${gaps.join('; ').slice(1)}.`)
}

export function dataSafety(evidence) {
  const name = 'Data safety'
  const ledger = evidence.ledger ?? emptyLedger()
  const attacks = attackNotes(evidence.attacks ?? [], 'data')
  const answers = answersOn(ledger, 'data')
  if (!attacks.tried && !answers.total) return dimension('data-safety', name, 'trust', 'unchecked', 'none', 'Not tested by Imagineer yet.')

  const failing = []
  if (attacks.broke.length) failing.push(`${plural(attacks.broke.length, 'attack')} broke through (${attacks.broke.map(a => a.title).join('; ')})`)
  if (answers.contradicted.length) failing.push(`the code contradicts your answer to ${answers.contradicted.join(', ')}`)
  if (failing.length) return dimension('data-safety', name, 'trust', 'failing', 'default', `${failing.join('; ')}.`)

  const gaps = []
  if (attacks.tried) gaps.push(`${plural(attacks.tried, 'attack')} held`)
  if (attacks.cleanInARow < 2) gaps.push(attacks.tried ? 'not yet 2 clean rounds' : 'no attack rounds yet')
  if (answers.total > answers.proven) gaps.push(`${plural(answers.total - answers.proven, 'data answer')} not yet proven by a test`)
  gaps.push('backup restore not drilled by Imagineer yet')
  return dimension('data-safety', name, 'trust', 'weak', 'default', `${gaps[0][0].toUpperCase()}${gaps.join('; ').slice(1)}.`)
}

/** Inspect's stop bar: test strength meets the bar, no open structure findings, and 2 attack rounds in a row found nothing new. */
export function stopBar(dimensions, attacks) {
  const missing = []
  const byId = id => dimensions.find(d => d.id === id)
  if (byId('test-strength')?.state !== 'strong') missing.push('test strength below the bar')
  if (byId('structure')?.state !== 'strong') missing.push('structure findings open')
  if (rounds((attacks ?? []).filter(a => !a.void)).cleanInARow < 2) missing.push('not yet 2 clean attack rounds')
  return { met: missing.length === 0, missing }
}

/** The overall grade: the weakest link, never an average. */
export function overall(dimensions) {
  const trust = dimensions.filter(d => d.group === 'trust')
  const care = dimensions.filter(d => d.group === 'care')
  const names = list => list.map(d => d.name.toLowerCase()).join(', ')

  const failing = trust.filter(d => d.state === 'failing')
  if (failing.length) return { state: 'failing', reason: `Failing: ${names(failing)}.` }
  const unchecked = trust.filter(d => d.state === 'unchecked')
  if (unchecked.length) return { state: 'not-proven', reason: `Not checked yet: ${names(unchecked)}.` }
  const weak = [...trust, ...care].filter(d => d.state === 'weak' || (d.group === 'care' && d.state === 'failing'))
  if (weak.length) return { state: 'weak', reason: `Weak: ${names(weak)}.` }
  return { state: 'strong', reason: '' }
}

export function gradeRun(out, repo = null) {
  const evidence = {
    ledger: repo ? loadLedger(repo) : emptyLedger(),
    findings: findings(out),
    attacks: loadAttacks(out).attacks,
    security: readJsonIf(join(out, 'security.json')),
    detect: readJsonIf(join(out, 'detect.json')),
    copy: readJsonIf(join(out, 'copy.json')),
    checks: readJsonIf(join(out, 'checks.json')),
    fallow: readJsonIf(join(out, 'fallow.json')),
    stryker: readJsonIf(join(out, 'stryker.json')),
    mutation: readJsonIf(join(out, 'mutation.json')),
  }
  const dimensions = [
    testStrength(evidence),
    intent(evidence),
    security(evidence),
    dataSafety(evidence),
    structure(evidence),
    foundations(evidence),
  ]
  return { evidence, dimensions, overall: overall(dimensions), bar: stopBar(dimensions, evidence.attacks) }
}

function imagineerVersion() {
  const manifest = join(HERE, '../../../.claude-plugin/plugin.json')
  return existsSync(manifest) ? readJson(manifest).version : 'unknown'
}

/** Keeps the results out of git unless the user chooses to commit them. */
function excludeFromGit(repo) {
  const path = run(['git', '-C', repo, 'rev-parse', '--git-path', 'info/exclude'])
  if (!path.ok) return
  const relativeOrAbsolute = path.stdout.trim()
  const target = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : join(repo, relativeOrAbsolute)
  const text = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (text.split('\n').includes('.claude/imagineer/')) return
  appendFileSync(target, `${text === '' || text.endsWith('\n') ? '' : '\n'}.claude/imagineer/\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = arg('repo')
  const out = arg('out')
  if (!repo || !out) {
    console.error('Usage: node grade.mjs --repo <repo> --out <run folder> [--status running|done] [--round N]')
    process.exit(2)
  }
  const { evidence, dimensions, overall: grade, bar } = gradeRun(out, repo)
  const counts = summary(evidence.ledger)
  const results = {
    schema: 1,
    imagineer: imagineerVersion(),
    scale: SCALE,
    run: {
      command: 'inspect',
      status: arg('status', 'done'),
      round: Number(arg('round', '1')),
      commit: evidence.copy?.commit ?? '',
      bar,
    },
    overall: grade,
    dimensions,
    questions: { waiting: counts.waiting, resolved: counts.resolved },
  }
  excludeFromGit(repo)
  writeJson(join(repo, RESULTS), results)
  console.log(`${grade.state}: ${grade.reason || 'every dimension meets the bar.'}`)
  console.log(bar.met ? 'Stop bar met.' : `Stop bar not met: ${bar.missing.join('; ')}.`)
  for (const d of dimensions) console.log(`  ${d.state.padEnd(9)} ${d.name}: ${d.summary}`)
}
