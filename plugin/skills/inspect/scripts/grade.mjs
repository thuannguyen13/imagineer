#!/usr/bin/env node
// Computes the grade from the evidence in a run folder and writes the
// results file (format 1, docs/results-file.md). Deterministic: the same
// evidence always gives the same grade. Agents add evidence; only this
// script sets a state.
//
//   node grade.mjs --repo <repo> --out <run folder> [--status running|waiting|done|stopped] [--round N]

import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { arg, readJson, readJsonIf, run, writeJson } from './lib.mjs'
import { loadAttacks, rounds } from './attack.mjs'
import { CRITICAL_TOPICS, emptyLedger, findings, isCritical, loadLedger, summary } from './questions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const RESULTS = '.claude/imagineer/results.json'
const SCALE = 1

// `summary` is one or two short sentences; `items` holds the list behind it (files, attacks, answers),
// which the pane shows under Evidence, cut to a few.
const dimension = (id, name, group, state, measured, summary, items = []) => ({ id, name, group, state, measured, summary, items, stale: false, claimed: false })

const percent = n => `${Math.round(n * 100)}%`

const lines = n => `${n} ${n === 1 ? 'line' : 'lines'}`

/** Stryker's mutation score: breaks the tests noticed, of breaks that ran. */
export function mutationScore(report) {
  const files = Object.entries(report.files ?? {}).map(([path, file]) => {
    const counts = { caught: 0, total: 0, timeouts: 0 }
    for (const mutant of file.mutants ?? []) {
      if (mutant.status === 'Timeout') counts.timeouts += 1
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') counts.caught += 1
      if (['Killed', 'Timeout', 'Survived', 'NoCoverage'].includes(mutant.status)) counts.total += 1
    }
    return { path, ...counts, score: counts.total ? counts.caught / counts.total : 1 }
  })
  const caught = files.reduce((n, f) => n + f.caught, 0)
  const total = files.reduce((n, f) => n + f.total, 0)
  const timeouts = files.reduce((n, f) => n + f.timeouts, 0)
  return { caught, total, timeouts, score: total ? caught / total : 0, files }
}

export function testStrength(evidence) {
  const { stryker, mutation } = evidence
  const ledger = evidence.ledger ?? emptyLedger()
  const name = 'Test strength'
  if (!stryker) return dimension('test-strength', name, 'trust', 'unchecked', 'none', 'Not measured yet.')
  if (stryker.skipped) return dimension('test-strength', name, 'trust', 'failing', 'default', stryker.skipped)
  if (!stryker.ok || !mutation) return dimension('test-strength', name, 'trust', 'unchecked', 'none', 'Mutation testing could not run, so test strength is unknown.')

  const { caught, total, timeouts, score, files } = mutationScore(mutation)
  if (total === 0) return dimension('test-strength', name, 'trust', 'unchecked', stryker.measured, 'No code was mutated, so test strength is unknown.')
  // A timeout counts as caught only when it is rare (a break that hangs the app). When most
  // breaks time out, the runs were too slow to tell, and nothing about the tests is known.
  if (timeouts > 10 && timeouts / total > 0.2) {
    return dimension(
      'test-strength',
      name,
      'trust',
      'unchecked',
      'none',
      `${timeouts} of ${total} breaks timed out instead of being caught or missed, so this run cannot say whether the tests would notice. Measure again with fewer runs at once.`,
    )
  }
  const band = n => (n >= 0.8 ? 'strong' : n >= 0.6 ? 'weak' : 'failing')
  // Code the user confirmed as critical (money, data, permissions) must meet the threshold
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
    .map(f => `${f.path}: ${percent(f.score)} of breaks caught`)
  const skipped = evidence.detect?.tests?.needSetting ?? 0
  const skippedNote = skipped
    ? ` ${skipped} test ${skipped === 1 ? 'file' : 'files'} run only with a setting this copy did not have (a database, most often), so this may be lower than in CI.`
    : ''
  const goal = critical.length
    ? ' Imagineer suggests at least 80% overall, and every break in critical code caught or explained.'
    : ' Imagineer suggests at least 80%.'
  const summary = `Tests catch ${percent(score)} of deliberate breaks (${caught} of ${total}).${goal}${criticalNote}${skippedNote}`
  return dimension('test-strength', name, 'trust', state, stryker.measured, summary, weakest)
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
  const answered = ledger.questions.filter(q => q.status === 'answered')
  const deferred = ledger.questions.filter(q => q.status === 'deferred').length
  const tally = [
    answered.length ? `${answered.length} answered by you` : '',
    settled ? `${settled} settled from the docs or code` : '',
    deferred ? `${deferred} deferred` : '',
    counts.waiting ? `${counts.waiting} waiting` : '',
  ].filter(Boolean)
  const opening = `${plural(counts.asked, 'question')}: ${tally.join(', ')}.`
  const waitingItems = ledger.questions.filter(q => q.status === 'open').map(q => `${q.id}: ${q.point ?? q.expectation}`)
  if (counts.openCritical) {
    return dimension('intent', name, 'trust', 'failing', 'repo', `${opening} ${counts.openCritical} about data, money or permissions still need your answer.`, waitingItems)
  }
  if (counts.waiting) return dimension('intent', name, 'trust', 'weak', 'repo', `${opening} Some still need your answer.`, waitingItems)
  const contradicted = answered.filter(q => q.test && q.test.green === false)
  if (contradicted.length) {
    const isCriticalGap = contradicted.some(q => CRITICAL_TOPICS.includes(q.topic))
    return dimension(
      'intent',
      name,
      'trust',
      isCriticalGap ? 'failing' : 'weak',
      'repo',
      `${opening} The code does not yet do what you answered for ${plural(contradicted.length, 'question')}.`,
      contradicted.map(q => `${q.id}: ${q.point ?? q.answer ?? q.expectation}`),
    )
  }
  const untested = answered.filter(q => !isProven(q))
  if (untested.length) {
    const none = untested.length === answered.length
    const sentence = none ? `None of your answers is proven by a test yet.` : `${plural(untested.length, 'answer')} not yet proven by a test.`
    return dimension('intent', name, 'trust', 'weak', 'repo', `${opening} ${sentence}`, untested.map(q => `${q.id}: ${q.point ?? q.answer ?? q.expectation}`))
  }
  return dimension('intent', name, 'trust', 'strong', 'repo', `${opening} Every answer is proven by a test seen failing, then passing.`)
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sentenceCase = text => `${text[0].toUpperCase()}${text.slice(1)}`

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
  if (attacks.broke.length) failing.push(`${plural(attacks.broke.length, 'attack')} broke through`)
  if (scan?.audit?.critical || scan?.audit?.high) failing.push(`${scan.audit.critical} critical and ${scan.audit.high} high known vulnerabilities in dependencies`)
  if (answers.contradicted.length) failing.push(`the code contradicts ${plural(answers.contradicted.length, 'answer')} of yours`)
  const securityItems = [...attacks.broke.map(a => `${a.id}: ${a.title}`), ...answers.contradicted.map(id => `${id}: the code does not do what you answered`)]
  if (failing.length) return dimension('security', name, 'trust', 'failing', 'default', `${sentenceCase(failing.join('; '))}.`, securityItems)

  const openCandidates = (evidence.findings ?? []).filter(item => item.kind === 'security' && !(item.key in ledger.dismissed)).length
  const gaps = []
  if (attacks.tried) gaps.push(`${plural(attacks.tried, 'attack')} held`)
  if (attacks.cleanInARow < 2) gaps.push(attacks.tried ? 'two attack rounds in a row have not yet come back clean' : 'no attack rounds yet')
  if (openCandidates) gaps.push(`${plural(openCandidates, 'possible weakness', 'possible weaknesses')} not yet verified`)
  if (answers.total > answers.proven) gaps.push(`${plural(answers.total - answers.proven, 'permission answer')} not yet proven by a test`)
  if (scan?.audit?.skipped) gaps.push('dependencies not audited')
  gaps.push('secrets not scanned yet')
  return dimension('security', name, 'trust', 'weak', 'default', `${sentenceCase(gaps.join('; '))}.`)
}

export function dataSafety(evidence) {
  const name = 'Data safety'
  const ledger = evidence.ledger ?? emptyLedger()
  const attacks = attackNotes(evidence.attacks ?? [], 'data')
  const answers = answersOn(ledger, 'data')
  if (!attacks.tried && !answers.total) return dimension('data-safety', name, 'trust', 'unchecked', 'none', 'Not tested by Imagineer yet.')

  const failing = []
  if (attacks.broke.length) failing.push(`${plural(attacks.broke.length, 'attack')} broke through`)
  if (answers.contradicted.length) failing.push(`the code contradicts ${plural(answers.contradicted.length, 'answer')} of yours`)
  const dataItems = [...attacks.broke.map(a => `${a.id}: ${a.title}`), ...answers.contradicted.map(id => `${id}: the code does not do what you answered`)]
  if (failing.length) return dimension('data-safety', name, 'trust', 'failing', 'default', `${sentenceCase(failing.join('; '))}.`, dataItems)

  const gaps = []
  if (attacks.tried) gaps.push(`${plural(attacks.tried, 'attack')} held`)
  if (attacks.cleanInARow < 2) gaps.push(attacks.tried ? 'two attack rounds in a row have not yet come back clean' : 'no attack rounds yet')
  if (answers.total > answers.proven) gaps.push(`${plural(answers.total - answers.proven, 'data answer')} not yet proven by a test`)
  gaps.push('backup restore not drilled by Imagineer yet')
  return dimension('data-safety', name, 'trust', 'weak', 'default', `${sentenceCase(gaps.join('; '))}.`)
}

/** Shown where an area has nothing measured. */
const NONE = label => ({ value: '—', label })

const ratio = (done, total) => ({ done, total, value: `${done}/${total}` })

/**
 * One measured number per area, in one shape for every area: `done/total`, then what is
 * counted and its good outcome, so a higher number is always better. Never a blended score;
 * anything else an area knows (vulnerabilities, contradicted answers, open findings) is in its
 * summary and items, under Evidence.
 */
export function metricFor(d, evidence) {
  const ledger = evidence.ledger ?? emptyLedger()
  if (d.id === 'test-strength') {
    const report = evidence.mutation
    if (!report || d.state === 'unchecked') return NONE(evidence.stryker?.skipped ? 'no test command' : /timed out/.test(d.summary) ? 'runs timed out' : 'not measured')
    const { caught, total } = mutationScore(report)
    return { ...ratio(caught, total), label: 'breaks caught' }
  }
  if (d.id === 'intent') {
    const answered = ledger.questions.filter(q => q.status === 'answered')
    if (!answered.length) return NONE(ledger.questions.length ? 'no answers yet' : 'no questions yet')
    return { ...ratio(answered.filter(isProven).length, answered.length), label: 'answers proven' }
  }
  if (d.id === 'security' || d.id === 'data-safety') {
    const mine = (evidence.attacks ?? []).filter(a => a.category === (d.id === 'security' ? 'permissions' : 'data') && !a.void)
    if (!mine.length) return NONE('not attacked yet')
    return { ...ratio(mine.filter(a => a.result === 'held').length, mine.length), label: 'attacks held' }
  }
  if (d.id === 'structure') {
    const score = evidence.fallow?.health?.health_score?.score
    if (score === undefined || d.state === 'unchecked') return NONE('not measured')
    return { ...ratio(score, 100), label: 'Fallow health' }
  }
  if (d.id === 'foundations') {
    const { detect, copy, checks } = evidence
    if (!detect || !copy || !checks) return NONE('not measured')
    const results = [
      Boolean(detect.lockfile),
      copy.install.ok,
      !checks.typecheck.present ? !detect.typescript : checks.typecheck.ok,
      checks.test.present && checks.test.ok,
      detect.ci.runsTests,
      detect.env.missing.length === 0,
    ]
    return { ...ratio(results.filter(Boolean).length, results.length), label: 'checks pass' }
  }
  return NONE('')
}

/** Inspect's finish thresholds: test strength meets its threshold, no open structure findings, and 2 attack rounds in a row found nothing new. */
/**
 * What test strength still needs, with today's number beside the goal: the overall 80%, the
 * 80% in each critical file, and every break in critical code caught or explained.
 */
export function testStrengthNeeds(evidence = {}) {
  const ledger = evidence.ledger ?? emptyLedger()
  const report = evidence.mutation
  if (!evidence.stryker || !report) return ['a measurement of test strength (not measured yet)']
  if (evidence.stryker.skipped) return ['tests: the project has no test command']
  const { total, timeouts, score, files } = mutationScore(report)
  if (total === 0) return ['code to measure: no breaks were made']
  if (timeouts > 10 && timeouts / total > 0.2) return ['a test strength measurement that does not time out']
  const needs = []
  if (score < 0.8) needs.push(`tests that catch at least 80% of deliberate breaks (now ${percent(score)})`)
  for (const f of files.filter(f => f.total > 0 && isCritical(ledger, f.path))) {
    const missed = (report.files[f.path].mutants ?? [])
      .filter(m => m.status === 'Survived' || m.status === 'NoCoverage')
      .filter(m => !(`${f.path}#${m.id}` in (ledger.equivalent ?? {})))
      .filter(m => !(`mutant:${f.path}:${m.location.start.line}` in ledger.dismissed)).length
    if (missed) needs.push(`every break in critical code caught or explained (${missed} left in ${f.path}, ${percent(f.score)} caught)`)
  }
  return needs
}

export function stopBar(dimensions, attacks, evidence = {}) {
  const missing = []
  const byId = id => dimensions.find(d => d.id === id)
  // Each line says what Inspect still needs, in words a person reads in the grade pane.
  if (byId('test-strength')?.state !== 'strong') {
    const needs = testStrengthNeeds(evidence)
    missing.push(...(needs.length ? needs : ['tests that catch at least 80% of deliberate breaks']))
  }
  if (byId('structure')?.state !== 'strong') missing.push('you to review the structure findings')
  if (rounds((attacks ?? []).filter(a => !a.void)).cleanInARow < 2) missing.push('two attack rounds in a row that find nothing new')
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
  for (const d of dimensions) d.metric = metricFor(d, evidence)
  return { evidence, dimensions, overall: overall(dimensions), bar: stopBar(dimensions, evidence.attacks, evidence) }
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
      // When the code was measured: the copy's time, or for a run before 0.9.0 when its copy was made.
      at: evidence.copy?.at ?? (existsSync(join(out, 'copy.json')) ? statSync(join(out, 'copy.json')).mtime.toISOString() : null),
      bar,
    },
    overall: grade,
    dimensions,
    questions: { waiting: counts.waiting, resolved: counts.resolved },
  }
  excludeFromGit(repo)
  writeJson(join(repo, RESULTS), results)
  console.log(`${grade.state}: ${grade.reason || 'every area meets the thresholds Imagineer suggests.'}`)
  console.log(bar.met ? 'Finished, by the thresholds Imagineer suggests.' : `Not finished yet. By the thresholds Imagineer suggests, Inspect still needs: ${bar.missing.join('; ')}.`)
  for (const d of dimensions) console.log(`  ${d.state.padEnd(9)} ${d.name}: ${d.summary}`)
}
