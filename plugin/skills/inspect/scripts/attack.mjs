#!/usr/bin/env node
// Attack rounds: tests that try to make the app do what it must not. Each
// attack test asserts the app holds (refuses, keeps data apart, saves once);
// it passes when the app held and fails when the attack broke through.
// Runs in the throwaway copy only.
//
//   node attack.mjs run  --out <run folder> --round 1 --id A3 --category permissions|data
//                        --title "<what was tried, in plain words>" --file <path> --run "<command>"
//   node attack.mjs void --out <run folder> --id A3 --reason "<why the test itself was wrong>"
//   node attack.mjs list --out <run folder>
//
// Attack tests are written first to <run folder>/attacks/<path>.

import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { arg, readJson, readJsonIf, run, tail, writeJson } from './lib.mjs'

export const CATEGORIES = ['permissions', 'data']

const ledgerPath = out => join(out, 'attacks.json')
export const loadAttacks = out => readJsonIf(ledgerPath(out)) ?? { attacks: [] }

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

function attack({ out, round, id, category, title, file, command }) {
  if (!CATEGORIES.includes(category)) throw new Error(`Category must be one of ${CATEGORIES.join(', ')}.`)
  const copy = readJson(join(out, 'copy.json'))
  const target = join(copy.path, file)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(out, 'attacks', file), target)
  const result = run(['sh', '-c', command], { cwd: copy.path, timeoutMs: 5 * 60_000 })

  const ledger = loadAttacks(out)
  ledger.attacks = ledger.attacks.filter(a => a.id !== id)
  ledger.attacks.push({
    id,
    round,
    category,
    title,
    file,
    run: command,
    result: result.ok ? 'held' : 'broke',
    output: result.ok ? '' : tail(result.stdout + '\n' + result.stderr, 15),
    void: null,
  })
  writeJson(ledgerPath(out), ledger)
  console.log(`${id} (${category}): ${result.ok ? 'the app held' : 'the attack broke through'}. ${title}`)
  if (!result.ok) console.log(tail(result.stdout + '\n' + result.stderr, 15))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step] = process.argv.slice(2)
  const out = arg('out')
  try {
    if (!out) throw new Error('--out <run folder> is required')
    if (step === 'run') {
      const fields = { round: Number(arg('round')), id: arg('id'), category: arg('category'), title: arg('title'), file: arg('file'), command: arg('run') }
      if (Object.values(fields).some(v => v === null || Number.isNaN(v))) throw new Error('run needs --round, --id, --category, --title, --file and --run')
      attack({ out, ...fields })
    } else if (step === 'void') {
      const ledger = loadAttacks(out)
      const entry = ledger.attacks.find(a => a.id === arg('id'))
      if (!entry || !arg('reason')) throw new Error('void needs an existing --id and a --reason')
      entry.void = arg('reason')
      writeJson(ledgerPath(out), ledger)
      console.log(`${entry.id} set aside: ${entry.void}`)
    } else if (step === 'list') {
      const summary = rounds(loadAttacks(out).attacks)
      console.log(JSON.stringify({ ...summary, broke: summary.broke.map(a => `${a.id}: ${a.title}`), held: summary.held.length }, null, 2))
    } else {
      throw new Error('Steps: run, void, list')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
