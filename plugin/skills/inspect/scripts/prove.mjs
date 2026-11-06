#!/usr/bin/env node
// Proves that a test enforces a user's answer: it passes on the code as it is
// (green), and fails when the code behind the answer is broken (red), using the
// same breaks Stryker found no test noticed. Runs in the throwaway copy only.
//
//   node prove.mjs --repo <repo> --out <run folder> --id Q3 --file <test path> --run "<command for that test>"
//
// The test is written first to <run folder>/tests/<test path>; this copies it
// into the copy at the same path, runs it, records the result on the question,
// and explains (dismisses) each line whose every break the test caught.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { arg, readJson, readJsonIf, run, tail, writeJson } from './lib.mjs'
import { LEDGER, loadLedger } from './questions.mjs'

/** Character offset of a 1-based { line, column } in a text. */
export function offset(text, { line, column }) {
  let index = 0
  for (let n = 1; n < line; n += 1) index = text.indexOf('\n', index) + 1
  return index + column - 1
}

/** The text with one mutant applied. */
export function applyMutant(text, mutant) {
  const start = offset(text, mutant.location.start)
  const end = offset(text, mutant.location.end)
  return text.slice(0, start) + mutant.replacement + text.slice(end)
}

/** The mutants no test noticed on the lines a question is about, minus those recorded as unobservable. */
export function targetMutants(mutation, about, equivalent = {}) {
  const lines = about
    .filter(key => key.startsWith('mutant:'))
    .map(key => {
      const [, file, line] = key.match(/^mutant:(.+):(\d+)$/) ?? []
      return { file, line: Number(line), key }
    })
  return lines.flatMap(({ file, line, key }) =>
    (mutation?.files?.[file]?.mutants ?? [])
      .filter(m => (m.status === 'Survived' || m.status === 'NoCoverage') && m.location.start.line === line)
      .filter(m => !(`${file}#${m.id}` in equivalent))
      .map(mutant => ({ file, key, mutant })),
  )
}

function prove({ repo, out, id, file, command }) {
  const copy = readJson(join(out, 'copy.json'))
  const mutation = readJsonIf(join(out, 'mutation.json'))
  const ledger = loadLedger(repo)
  const question = ledger.questions.find(q => q.id === id)
  if (!question) throw new Error(`No question ${id}.`)

  const source = join(out, 'tests', file)
  const target = join(copy.path, file)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  const sh = cmd => run(['sh', '-c', cmd], { cwd: copy.path, timeoutMs: 5 * 60_000 })

  const green = sh(command)
  const test = { file, run: command, commit: copy.commit, green: green.ok, red: null, output: green.ok ? '' : tail(green.stdout + '\n' + green.stderr, 15) }

  if (green.ok) {
    const targets = targetMutants(mutation, question.about, ledger.equivalent)
    const caughtByKey = new Map()
    const missed = []
    for (const { file: path, key, mutant } of targets) {
      const full = join(copy.path, path)
      const original = readFileSync(full, 'utf8')
      writeFileSync(full, applyMutant(original, mutant))
      const broken = sh(command)
      writeFileSync(full, original)
      const entry = caughtByKey.get(key) ?? { caught: 0, total: 0 }
      entry.total += 1
      if (!broken.ok) entry.caught += 1
      else missed.push({ mutant: `${path}#${mutant.id}`, line: mutant.location.start.line, change: `${mutant.mutatorName} → ${mutant.replacement}` })
      caughtByKey.set(key, entry)
    }
    const totals = [...caughtByKey.values()]
    test.red = { killed: totals.reduce((n, e) => n + e.caught, 0), total: totals.reduce((n, e) => n + e.total, 0), missed }
    for (const [key, entry] of caughtByKey) {
      if (entry.caught === entry.total) ledger.dismissed[key] = { question: id, reason: `Test ${file} catches every break on this line.` }
    }
  }

  // The proof leaves the copy as it came, so later measurements see only the repository's own tests.
  rmSync(target, { force: true })
  question.test = test
  writeJson(join(repo, LEDGER), ledger)

  if (!green.ok) console.log(`${id}: the test fails on the code as it is, so the code does not do what the answer says.\n${test.output}`)
  else if (!test.red.total) console.log(`${id}: the test passes, but there was no recorded break to prove it can fail. Point the question's "about" at the lines it protects.`)
  else {
    console.log(`${id}: passes on the code as it is, and fails on ${test.red.killed} of ${test.red.total} breaks behind the answer.`)
    for (const m of test.red.missed) console.log(`  not caught: ${m.mutant} (line ${m.line}): ${m.change}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const repo = arg('repo')
    const out = arg('out')
    const id = arg('id')
    const file = arg('file')
    const command = arg('run')
    if (!repo || !out || !id || !file || !command) throw new Error('Usage: node prove.mjs --repo <repo> --out <run folder> --id Q3 --file <test path> --run "<command>"')
    prove({ repo, out, id, file, command })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
