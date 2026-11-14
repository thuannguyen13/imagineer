#!/usr/bin/env node
// Attack rounds: tests that try to make the app do what it must not. Each
// attack test asserts the app holds (refuses, keeps data apart, saves once);
// it passes when the app held and fails when the attack broke through.
// Runs in the throwaway copy only, with no credentials: a command that reads an
// env file, sets a credential, names a database or reaches into the repository
// itself is refused. An attack whose test did not run (skipped, most often for
// want of a database) is never "held": it is recorded as not attacked yet.
//
//   node attack.mjs run  --out <run folder> --round 1 --id A3 --category permissions|data
//                        --title "<what was tried, in plain words>" --file <path> --run "<command>" [--about Q8]
//   node attack.mjs void --out <run folder> --id A3 --reason "<why the test itself was wrong>"
//   node attack.mjs untested --out <run folder> --round 1 --category permissions|data --what "<a part not attacked, in plain words>"
//   node attack.mjs list --out <run folder>
//
// Attack tests are written first to <run folder>/attacks/<path>.

import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { arg, readJson, readJsonIf, recordDenial, repositoryProblem, run, runCommandProblem, tail, testCounts, writeJson } from './lib.mjs'

export const CATEGORIES = ['permissions', 'data']

const ledgerPath = out => join(out, 'attacks.json')
export const loadAttacks = out => ({ attacks: [], untested: {}, notRun: [], ...readJsonIf(ledgerPath(out)) })

/**
 * What the latest round says it did not attack: never safe, only not tested yet. A later round
 * that reaches a part leaves it out of its own list.
 */
export function untestedNow(ledger) {
  const rounds = Object.keys(ledger.untested ?? {}).map(Number)
  if (!rounds.length) return []
  return ledger.untested[String(Math.max(...rounds))] ?? []
}

export function recordUntested(ledger, { round, category, what, id = null }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  if (!what?.trim()) throw new Error('--what says, in plain words, which part was not attacked.')
  const list = (ledger.untested[String(round)] ??= [])
  // `id`: the attack whose test did not run, so a later run of that attack takes the line away.
  if (!list.some(u => u.category === category && u.what === what)) list.push(id ? { category, what, id } : { category, what })
  return ledger
}

/**
 * Why a test run that ended well still says nothing about the app, or null: no test passed, or
 * some were skipped. Output with no summary this reads (an unusual runner) is taken as it ended.
 */
export function didNotRun(output) {
  const counts = testCounts(output)
  if (!counts) return null
  if (counts.passed === 0) return counts.skipped ? 'its test was skipped' : 'no test ran'
  return counts.skipped ? `${counts.skipped} of its tests ${counts.skipped === 1 ? 'was' : 'were'} skipped` : null
}

/** Why an attack must not run as asked, or null: its command or its test reaches for credentials or the repository itself. */
export function refused({ command, test, source }) {
  const problem = runCommandProblem(command, { source })
  if (problem) return `the command ${problem}`
  const inTest = repositoryProblem(test, source)
  return inTest ? `the test ${inTest}` : null
}

/** Records an attack's outcome in the ledger, replacing what an earlier run under the same ID left. */
export function recordAttack(ledger, entry, why = null) {
  ledger.attacks = ledger.attacks.filter(a => a.id !== entry.id)
  ledger.notRun = (ledger.notRun ?? []).filter(a => a.id !== entry.id)
  for (const list of Object.values(ledger.untested)) {
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].id === entry.id) list.splice(i, 1)
  }
  if (!why) {
    ledger.attacks.push(entry)
    return ledger
  }
  // Not an attack that held: evidence of why it did not run, and a line under "Not attacked yet".
  ledger.notRun.push({ ...entry, result: 'not-run', why })
  return recordUntested(ledger, { round: entry.round, category: entry.category, what: `${entry.title} (${why})`, id: entry.id })
}

/** What the rounds found: breaks still standing, and how many rounds in a row found nothing new. */
export function rounds(attacks) {
  const live = attacks.filter(a => !a.void)
  const numbers = [...new Set(live.map(a => a.round))].sort((a, b) => a - b)
  const perRound = numbers.map(round => ({
    round,
    tried: live.filter(a => a.round === round).length,
    broke: live.filter(a => a.round === round && a.result === 'broke').length,
  }))
  let clean = 0
  for (const r of [...perRound].reverse()) {
    if (r.broke > 0) break
    clean += 1
  }
  return { perRound, cleanInARow: clean, broke: live.filter(a => a.result === 'broke'), held: live.filter(a => a.result === 'held') }
}

function attack({ out, round, id, category, title, file, command, about = null }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  const copy = readJson(join(out, 'copy.json'))
  const source = join(out, 'attacks', file)
  const problem = refused({ command, test: readFileSync(source, 'utf8'), source: copy.source })
  if (problem) {
    if (copy.source) recordDenial(copy.source, { agent: 'attacker', tool: 'attack.mjs', kind: 'credentials', reason: problem })
    throw new Error(
      `Refused: ${problem}. Attacks run in the copy, with no credentials. If this attack needs a database or a service that is not there, ` +
        `record it instead: attack.mjs untested --out ${out} --round ${round} --category ${category} --what "<the part, in plain words> (needs a database)".`,
    )
  }
  const target = join(copy.path, file)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  const result = run(['sh', '-c', command], { cwd: copy.path, timeoutMs: 5 * 60_000, project: true })
  // The attack test leaves the copy as it came: a test that broke through fails on purpose,
  // and would fail every later measurement of the copy.
  rmSync(target, { force: true })

  const output = result.stdout + '\n' + result.stderr
  // A run that ended well with its test skipped proved nothing: never "held".
  const why = result.ok ? didNotRun(output) : null
  const entry = { id, round, category, title, about, file, run: command, result: result.ok ? 'held' : 'broke', output: result.ok && !why ? '' : tail(output, 15), void: null }
  writeJson(ledgerPath(out), recordAttack(loadAttacks(out), entry, why))
  if (why) {
    console.log(`${id} (${category}): not attacked, because ${why}, most often for want of a database or a setting. It is listed as not attacked yet and does not count as held. ${title}`)
    return
  }
  console.log(`${id} (${category}): ${result.ok ? 'the app held' : 'the attack broke through'}. ${title}`)
  if (!result.ok) console.log(tail(output, 15))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step] = process.argv.slice(2)
  const out = arg('out')
  try {
    if (!out) throw new Error('--out <run folder> is required')
    if (step === 'run') {
      const fields = { round: Number(arg('round')), id: arg('id'), category: arg('category'), title: arg('title'), file: arg('file'), command: arg('run') }
      if (Object.values(fields).some(v => v === null || Number.isNaN(v))) throw new Error('run needs --round, --id, --category, --title, --file and --run')
      attack({ out, ...fields, about: arg('about') })
    } else if (step === 'void') {
      const ledger = loadAttacks(out)
      const entry = ledger.attacks.find(a => a.id === arg('id'))
      if (!entry || !arg('reason')) throw new Error('void needs an existing --id and a --reason')
      entry.void = arg('reason')
      writeJson(ledgerPath(out), ledger)
      console.log(`${entry.id} set aside: ${entry.void}`)
    } else if (step === 'untested') {
      const round = Number(arg('round'))
      if (Number.isNaN(round)) throw new Error('untested needs --round')
      writeJson(ledgerPath(out), recordUntested(loadAttacks(out), { round, category: arg('category'), what: arg('what') }))
      console.log(`Round ${round}: not attacked yet (${arg('category')}): ${arg('what')}`)
    } else if (step === 'list') {
      const ledger = loadAttacks(out)
      const summary = rounds(ledger.attacks)
      const notRun = ledger.notRun.map(a => `${a.id}: ${a.title} (${a.why})`)
      console.log(JSON.stringify({ ...summary, broke: summary.broke.map(a => `${a.id}: ${a.title}`), held: summary.held.length, notRun, untested: untestedNow(ledger) }, null, 2))
    } else {
      throw new Error('Steps: run, void, untested, list')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
