#!/usr/bin/env node
// Attack rounds: tests that try to make the app do what it must not. Each
// attack test asserts the app holds (refuses, keeps data apart, saves once);
// it passes when the app held and fails when the attack broke through.
// Runs in the throwaway copy only, never against a database nobody set up for it:
// a command that reads an env file, sets a database setting, names a database or
// reaches into the repository itself is refused, and so is a test that names a
// database or the repository. An attack whose test did not run (skipped, most
// often for want of a database) is never "held": it is listed as not attacked yet.
//
//   node attack.mjs run  --out <run folder> --round 1 --id A3 --category permissions|data
//                        --title "<what was tried, in plain words>" --file <path> --run "<command>" [--about Q8]
//   node attack.mjs void --out <run folder> --id A3 --reason "<why the test itself was wrong>"
//   node attack.mjs untested --out <run folder> --round 1 --category permissions|data --what "<a part not attacked, in plain words>"
//   node attack.mjs list --out <run folder>
//
// Attack tests are written first to <run folder>/attacks/<path>.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { arg, inside, isMain, isUnder, readJson, readJsonIf, recordDenial, run, runFolder, runnerCall, runProblem, tail, testCounts, writeJson } from './lib.mjs'

export const CATEGORIES = ['permissions', 'data']

const ledgerPath = out => join(out, 'attacks.json')
export const loadAttacks = out => ({ attacks: [], untested: {}, notRun: [], ...readJsonIf(ledgerPath(out)) })

/**
 * What is not attacked yet: never safe, only not tested. The parts the latest round says it did
 * not reach (a later round that reaches one leaves it out of its own list), and every attack whose
 * test did not run, from any round, until it is run again under its ID.
 */
export function untestedNow(ledger) {
  const rounds = Object.keys(ledger.untested ?? {}).map(Number)
  const parts = rounds.length ? (ledger.untested[String(Math.max(...rounds))] ?? []) : []
  return [...parts, ...(ledger.notRun ?? []).map(a => ({ category: a.category, what: `${a.title} (${a.why})`, id: a.id }))]
}

export function recordUntested(ledger, { round, category, what }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  if (!what?.trim()) throw new Error('--what says, in plain words, which part was not attacked.')
  const list = (ledger.untested[String(round)] ??= [])
  if (!list.some(u => u.category === category && u.what === what)) list.push({ category, what })
  return ledger
}

/**
 * Why a test run that ended well still says nothing about the app, or null: no test passed, some
 * were skipped, or the run printed no summary to tell by. A skipped test cannot be told from one a
 * name filter left out, so the command must run the attack's own test and nothing else.
 */
export function didNotRun(output) {
  const counts = testCounts(output)
  if (!counts) return 'the run printed no summary of tests passed and skipped'
  if (counts.passed === 0) return counts.skipped ? 'its test was skipped' : 'no test ran'
  return counts.skipped ? `${counts.skipped} of the tests in that run ${counts.skipped === 1 ? 'was' : 'were'} skipped` : null
}

/**
 * Records an attack's outcome in the ledger, replacing what an earlier run under the same ID left.
 * With `why`, its test did not run: it is kept apart, as evidence and as a part not attacked yet,
 * and counts in no round.
 */
export function recordAttack(ledger, entry, why = null) {
  ledger.attacks = ledger.attacks.filter(a => a.id !== entry.id)
  ledger.notRun = (ledger.notRun ?? []).filter(a => a.id !== entry.id)
  if (why) ledger.notRun.push({ ...entry, result: 'not-run', why })
  else ledger.attacks.push(entry)
  return ledger
}

/**
 * What the rounds found: breaks still standing, and how many rounds in a row found nothing new.
 * A round with an attack whose test did not run found out less than it set out to: it is not a
 * clean round, so Inspect is never finished on attacks that never ran.
 */
export function rounds(attacks, notRun = []) {
  const live = attacks.filter(a => !a.void)
  const numbers = [...new Set([...live, ...notRun].map(a => a.round))].sort((a, b) => a - b)
  const perRound = numbers.map(round => ({
    round,
    tried: live.filter(a => a.round === round).length,
    broke: live.filter(a => a.round === round && a.result === 'broke').length,
    notRun: notRun.filter(a => a.round === round).length,
  }))
  let clean = 0
  for (const r of [...perRound].reverse()) {
    if (r.broke > 0 || r.notRun > 0) break
    clean += 1
  }
  return { perRound, cleanInARow: clean, broke: live.filter(a => a.result === 'broke'), held: live.filter(a => a.result === 'held') }
}

function attack({ out, round, id, category, title, file, command, about = null }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  // The run's own folder, never one written to look like it: its copy.json says where the app's code runs.
  const { path: runPath, repo } = runFolder(out)
  const copy = readJson(join(runPath, 'copy.json'))
  if (!basename(copy.path ?? '').startsWith('imagineer-') || isUnder(copy.path, repo)) throw new Error(`${out}/copy.json does not name a throwaway copy.`)
  // The test stays in the attacks folder and lands in the copy, at a path of its own.
  const source = inside(join(runPath, 'attacks'), file, "the run's attacks folder")
  const target = inside(copy.path, file, 'the copy')
  if (existsSync(target)) throw new Error(`The copy already has a file at ${file}: give the attack test a name of its own.`)
  const problem = runProblem({ command, test: readFileSync(source, 'utf8'), source: repo, cwd: copy.path, testDir: dirname(target) })
  if (problem) {
    recordDenial(repo, { agent: 'attacker', tool: 'attack.mjs', kind: 'database', reason: problem })
    throw new Error(
      `Refused: ${problem}. Attacks run in the copy, never against a database nobody set up for them. If this attack needs a database or a service that is not there, ` +
        `record it instead: attack.mjs untested --out ${out} --round ${round} --category ${category} --what "<the part, in plain words> (needs a database)".`,
    )
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  // The test runner itself, with no shell around it.
  const { env, argv } = runnerCall(command)
  const result = run(argv, { cwd: copy.path, timeoutMs: 5 * 60_000, project: true, env })
  // The attack test leaves the copy as it came: a test that broke through fails on purpose,
  // and would fail every later measurement of the copy.
  rmSync(target, { force: true })

  const output = result.stdout + '\n' + result.stderr
  // A run that ended well with its test skipped proved nothing: never "held".
  const why = result.ok ? didNotRun(output) : null
  const entry = { id, round, category, title, about, file, run: command, result: result.ok ? 'held' : 'broke', output: result.ok && !why ? '' : tail(output, 15), void: null }
  writeJson(ledgerPath(runPath), recordAttack(loadAttacks(runPath), entry, why))
  if (why) {
    console.log(`${id} (${category}): not attacked, because ${why}, most often for want of a database or a setting, or because the command ran more than the attack's own test. It is listed as not attacked yet and does not count as held. ${title}`)
    console.log(tail(output, 40))
    return
  }
  console.log(`${id} (${category}): ${result.ok ? 'the app held' : 'the attack broke through'}. ${title}`)
  // The attacker sees the app's code run nowhere else, so enough of the output to tell a wrong test from a real break.
  if (!result.ok) console.log(tail(output, 40))
}

if (isMain(import.meta.url)) {
  const [step] = process.argv.slice(2)
  let out = arg('out')
  try {
    if (!out) throw new Error('--out <run folder> is required')
    out = runFolder(out).path
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
      const summary = rounds(ledger.attacks, ledger.notRun)
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
