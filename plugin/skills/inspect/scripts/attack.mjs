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
//   node attack.mjs link --out <run folder> --id A3 --question Q8      the attack tried what Q8 asked: one finding, not two
//   node attack.mjs untested --out <run folder> --round 1 --category permissions|data --what "<a part not attacked, in plain words>"
//   node attack.mjs untested --out <run folder> --round 1 --none     the round reached every part worth attacking
//   node attack.mjs entries --out <run folder>      the app's server entry points, from its code, kept in entries.json
//   node attack.mjs list --out <run folder>         also says which entry points no attack test reached
//   node attack.mjs files  --out <run folder> [--under <folder of the copy>] [--match <text in the path>]
//   node attack.mjs search --out <run folder> --pattern '<regular expression>' [--under <folder of the copy>]
//                          the copy's files and their lines, for an attacker with no other way to look
//
// Attack tests are written first to <run folder>/attacks/<path>.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { coverage, serverEntries } from './entries.mjs'
import { reader, trackedFiles } from './layout.mjs'
import { arg, didNotRun, idle, inside, isMain, readJsonIf, run, runCopy, runFolder, runSize, tail, testInCopy, writeJson } from './lib.mjs'

export { didNotRun }

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

/** A round that reached every part worth attacking says so, so its silence is never mistaken for a missing report. */
export function recordNoneUntested(ledger, round) {
  ledger.untested[String(round)] ??= []
  return ledger
}

/**
 * Why an attacker may not finish yet, or null: its latest round must say what it did not reach
 * (`untested`, or `--none`), so a round is never read as covering what it never tried.
 */
export function unfinishedRound(ledger) {
  const rounds = [...ledger.attacks, ...(ledger.notRun ?? [])].map(a => Number(a.round)).filter(Number.isFinite)
  const latest = rounds.length ? Math.max(...rounds) : null
  if (latest === null && !Object.keys(ledger.untested ?? {}).length) return 'No attack or part not attacked is recorded. Run each attack with attack.mjs run, and record each part you did not reach with attack.mjs untested, before you finish.'
  if (latest !== null && !(String(latest) in (ledger.untested ?? {}))) return `Round ${latest} does not say what it did not reach. Record each part with attack.mjs untested --round ${latest} --category … --what "…", or, if it reached every part worth attacking, attack.mjs untested --round ${latest} --none. Then finish.`
  return null
}

export function recordUntested(ledger, { round, category, what }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  if (!what?.trim()) throw new Error('--what says, in plain words, which part was not attacked.')
  const list = (ledger.untested[String(round)] ??= [])
  if (!list.some(u => u.category === category && u.what === what)) list.push({ category, what })
  return ledger
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
/** A Thorough run has at most this many attack rounds (a Standard one, two); finishing needs this many clean ones in a row. */
export const MAX_ROUNDS = 4
export const CLEAN_NEEDED = 2

/**
 * Whether the rounds left can still bring the clean rounds in a row finishing needs. When they
 * cannot, another round in this run cannot finish Inspect: say so before offering one.
 */
export function canStillFinish(attacks, notRun = [], maxRounds = MAX_ROUNDS) {
  const { perRound, cleanInARow } = rounds(attacks, notRun)
  const done = perRound.length ? Math.max(...perRound.map(r => r.round)) : 0
  return { roundsLeft: Math.max(0, maxRounds - done), possible: cleanInARow >= CLEAN_NEEDED || maxRounds - done >= CLEAN_NEEDED - cleanInARow }
}

const questionNumber = id => Number(String(id ?? '').replace(/^Q/, '')) || null

/**
 * Whether a break is something new: not when it tried what a question asked before the attack ran
 * (its `about`, a question that existed then). A question written from the break itself is not
 * earlier, so linking it never hides a break.
 */
export const isNewBreak = a => a.result === 'broke' && !(a.about && a.questionsBefore && questionNumber(a.about) <= a.questionsBefore)

export function rounds(attacks, notRun = []) {
  const live = attacks.filter(a => !a.void)
  const numbers = [...new Set([...live, ...notRun].map(a => a.round))].sort((a, b) => a - b)
  const perRound = numbers.map(round => ({
    round,
    tried: live.filter(a => a.round === round).length,
    broke: live.filter(a => a.round === round && isNewBreak(a)).length,
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
  let test
  try {
    test = testInCopy({ out, folder: 'attacks', file, command, agent: 'attacker', tool: 'attack.mjs' })
  } catch (error) {
    if (!error.refused) throw error
    throw new Error(
      `Refused: ${error.message}. Attacks run in the copy, never against a database nobody set up for them. If this attack needs a database or a service that is not there, ` +
        `record it instead: attack.mjs untested --out ${out} --round ${round} --category ${category} --what "<the part, in plain words> (needs a database)".`,
    )
  }
  test.place()
  const result = test.start()
  // The attack test leaves the copy as it came: a test that broke through fails on purpose,
  // and would fail every later measurement of the copy.
  test.remove()

  // A run that could not start, did not end, found no test, or ended well with its test skipped proved nothing: never "held", never a break.
  const why = idle(result)
  // How many questions there were when this ran: a link to one of them says the break was already known.
  const asked = readJsonIf(join(runFolder(out).repo, '.claude', 'imagineer', 'questions.json'))
  const questionsBefore = Math.max(0, ...(asked?.questions ?? []).map(q => questionNumber(q.id) ?? 0))
  const entry = { id, round, category, title, about, questionsBefore, file, run: command, result: result.ok ? 'held' : 'broke', output: result.ok && !why ? '' : tail(result.output, 15), void: null }
  const ledger = recordAttack(loadAttacks(test.runPath), entry, why)
  // The first command that ran a test here is kept, with its test as the example, for the rounds and proofs after.
  if (!why && !ledger.setup) ledger.setup = { run: command.split(file).join('{file}'), example: `attacks/${file}`, attack: id }
  writeJson(ledgerPath(test.runPath), ledger)
  if (why) {
    console.log(`${id} (${category}): not attacked, because ${why}. It is listed as not attacked yet and does not count as held. ${title}`)
    console.log(tail(result.output, 40))
    return
  }
  console.log(`${id} (${category}): ${result.ok ? 'the app held' : 'the attack broke through'}. ${title}`)
  // The attacker sees the app's code run nowhere else, so enough of the output to tell a wrong test from a real break.
  if (!result.ok) console.log(tail(result.output, 40))
}

/**
 * The copy's files under a folder of it, as paths from the copy's top: no packages, no git, no links
 * followed, and not the project's own `.claude/` settings, which configure Claude, not the app.
 */
export function copyFiles(copy, under = '.') {
  const top = under === '.' ? copy : inside(copy, under, 'the copy')
  const files = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', '.claude'].includes(entry.name)) walk(join(dir, entry.name))
      } else if (entry.isFile()) files.push(relative(copy, join(dir, entry.name)))
    }
  }
  walk(top)
  return files.sort()
}

/** The lines of the copy's files that match a pattern, as `path:line: text`. */
export function copySearch(copy, pattern, under = '.') {
  const expression = new RegExp(pattern)
  const found = []
  for (const file of copyFiles(copy, under)) {
    const path = join(copy, file)
    if (statSync(path).size > 1024 * 1024) continue
    const text = readFileSync(path, 'utf8')
    if (text.includes('\u0000')) continue
    text.split('\n').forEach((line, at) => {
      if (expression.test(line)) found.push(`${file}:${at + 1}: ${line.trim().slice(0, 200)}`)
    })
  }
  return found
}

/** The latest earlier run of this repository that attacked: its number, commit and the entry points its attacks reached. */
export function previousAttacks(out) {
  const self = resolve(out)
  const here = Number(basename(self))
  const runs = dirname(self)
  let names = []
  try {
    names = readdirSync(runs).filter(n => /^\d+$/.test(n) && Number(n) < here).sort((a, b) => Number(b) - Number(a))
  } catch {}
  for (const name of names) {
    const dir = join(runs, name)
    const entries = readJsonIf(join(dir, 'entries.json'))
    const commit = readJsonIf(join(dir, 'copy.json'))?.commit
    if (!entries || !commit || !loadAttacks(dir).attacks.length) continue
    return { run: name, commit, reached: new Set(coverage(entries, attackTexts(dir)).reachedEntries.map(e => `${e.file}#${e.name}`)) }
  }
  return null
}

/**
 * The app's server entry points, read from the copy: its files under the app's folder. On a later
 * run, each says why it is worth attacking now (`focus`): its file changed since the last run that
 * attacked, or no attack has reached it yet. One an earlier run attacked, unchanged since, comes last.
 */
export function appEntries(out, copy) {
  const app = readJsonIf(join(out, 'detect.json'))?.layout?.app?.dir ?? '.'
  const files = trackedFiles(copy.source ?? copy.path).filter(f => app === '.' || f.startsWith(`${app}/`))
  const entries = serverEntries(files, reader(copy.path))
  const before = previousAttacks(out)
  if (!before) return entries
  const diff = run(['git', '-C', copy.source ?? copy.path, 'diff', '--name-only', before.commit, 'HEAD'])
  const changed = new Set(diff.ok ? diff.stdout.split('\n').filter(Boolean) : files)
  return entries.map(e => {
    const reached = before.reached.has(`${e.file}#${e.name}`)
    const since = changed.has(e.file) ? 'changed since run ' + before.run : reached ? `attacked in run ${before.run}, unchanged` : 'never reached'
    return { ...e, since, focus: !reached || changed.has(e.file) }
  })
}

/** The attack tests' code, from the run folder, for every attack that ran and was not set aside. */
export function attackTexts(out) {
  const ledger = loadAttacks(out)
  return ledger.attacks.filter(a => !a.void).map(a => {
    try {
      return readFileSync(join(out, 'attacks', a.file), 'utf8')
    } catch {
      return ''
    }
  })
}

/** Which of the app's entry points the attack tests reached, from entries.json; null before `entries` ran. */
export function entryCoverage(out) {
  const entries = readJsonIf(join(out, 'entries.json'))
  return entries ? coverage(entries, attackTexts(out)) : null
}

const LIMIT = 300
const capped = (lines, what) => [...lines.slice(0, LIMIT), ...(lines.length > LIMIT ? [`… ${lines.length - LIMIT} more ${what}: narrow it with --under or a tighter --match or --pattern.`] : [])].join('\n')

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
    } else if (step === 'link') {
      const ledger = loadAttacks(out)
      const entry = ledger.attacks.find(a => a.id === arg('id'))
      const question = arg('question')
      const questions = readJsonIf(join(runFolder(out).repo, '.claude', 'imagineer', 'questions.json'))?.questions ?? []
      if (!entry) throw new Error(`No attack ${arg('id')} in this run.`)
      if (!questions.some(q => q.id === question)) throw new Error(`No question ${question} in the ledger.`)
      entry.about = question
      writeJson(ledgerPath(out), ledger)
      console.log(`${entry.id} tried what ${question} asked${isNewBreak(entry) || entry.result !== 'broke' ? '' : ', asked before it ran: not a new break'}.`)
    } else if (step === 'untested') {
      const round = Number(arg('round'))
      if (Number.isNaN(round)) throw new Error('untested needs --round')
      if (process.argv.includes('--none')) {
        writeJson(ledgerPath(out), recordNoneUntested(loadAttacks(out), round))
        console.log(`Round ${round}: every part worth attacking was reached.`)
      } else {
        writeJson(ledgerPath(out), recordUntested(loadAttacks(out), { round, category: arg('category'), what: arg('what') }))
        console.log(`Round ${round}: not attacked yet (${arg('category')}): ${arg('what')}`)
      }
    } else if (step === 'list') {
      const ledger = loadAttacks(out)
      const summary = rounds(ledger.attacks, ledger.notRun)
      const notRun = ledger.notRun.map(a => `${a.id}: ${a.title} (${a.why})`)
      const reach = entryCoverage(out)
      // Worth attacking now first: changed since the last run that attacked, or never reached.
      const ordered = reach ? [...reach.notReached].sort((a, b) => Number(b.focus !== false) - Number(a.focus !== false)) : []
      const entries = reach && { total: reach.total, reached: reach.reached, notReached: ordered.slice(0, 40).map(e => `${e.name} (${e.kind}, ${e.file}${e.since ? `; ${e.since}` : ''})`) }
      const size = runSize()
      const finish = canStillFinish(ledger.attacks, ledger.notRun, size.rounds)
      console.log(JSON.stringify({ ...summary, broke: summary.broke.map(a => `${a.id}: ${a.title}`), held: summary.held.length, notRun, untested: untestedNow(ledger), entries, size: size.size, attacksPerRound: size.attacksPerRound, workingSetup: ledger.setup ?? null, roundsLeft: finish.roundsLeft, canStillFinish: finish.possible }, null, 2))
    } else if (step === 'entries') {
      const { copy } = runCopy(out)
      const entries = appEntries(out, copy)
      writeJson(join(out, 'entries.json'), entries)
      const kinds = Object.entries(entries.reduce((n, e) => ({ ...n, [e.kind]: (n[e.kind] ?? 0) + 1 }), {})).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
      const focus = entries.filter(e => e.focus).length
      const later = entries.some(e => 'focus' in e) ? ` ${focus} changed since the last run that attacked, or never reached: attack those first.` : ''
      console.log(entries.length ? `${entries.length} server entry points: ${kinds.join(', ')}.${later}\n${entries.map(e => `- ${e.name} (${e.file}${e.since ? `; ${e.since}` : ''})`).join('\n')}` : 'No server entry points found in the code: routes, route handlers, server actions, loaders or form actions.')
    } else if (step === 'files') {
      const { copy } = runCopy(out)
      const match = arg('match')
      console.log(capped(copyFiles(copy.path, arg('under') ?? '.').filter(file => !match || file.includes(match)), 'files') || 'No such files in the copy.')
    } else if (step === 'search') {
      const { copy } = runCopy(out)
      if (!arg('pattern')) throw new Error("search needs --pattern '<regular expression>'")
      console.log(capped(copySearch(copy.path, arg('pattern'), arg('under') ?? '.'), 'lines') || 'No line in the copy matches.')
    } else {
      throw new Error('Steps: run, void, link, untested, list, entries, files, search')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
