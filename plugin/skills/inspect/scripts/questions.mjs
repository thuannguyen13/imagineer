#!/usr/bin/env node
// The question ledger: what Inspect asked the user, and what they answered.
// Lives in <repo>/.claude/imagineer/questions.json, kept out of git.
//
//   node questions.mjs findings --repo <repo> --out <run folder>   what needs a question, as JSON
//   node questions.mjs add      --repo <repo>                       questions as a JSON array on stdin
//   node questions.mjs next     --repo <repo> [--limit 4]           open questions, most consequential first
//   node questions.mjs answer   --repo <repo> --id Q3 --status answered|decided|deferred
//                               --answer "<the user's words>" [--reason "<why>"]
//                               [--dismiss <key>,<key>] [--critical <glob>,<glob>]
//   node questions.mjs summary  --repo <repo>

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, readJsonIf, writeJson } from './lib.mjs'

export const LEDGER = '.claude/imagineer/questions.json'

/** Most consequential first. */
export const TOPICS = ['data', 'money', 'permissions', 'behaviour', 'wording']
export const CRITICAL_TOPICS = ['data', 'money', 'permissions']
const RESOLVED = ['answered', 'decided', 'deferred']

export const emptyLedger = () => ({ schema: 1, critical: [], dismissed: {}, questions: [] })

export const loadLedger = repo => readJsonIf(join(repo, LEDGER)) ?? emptyLedger()

const save = (repo, ledger) => writeJson(join(repo, LEDGER), ledger)

/** Matches a path against a glob with `*` (within a folder) and `**` (across folders). */
export function matches(glob, path) {
  const pattern = glob
    .split('**')
    .map(part => part.split('*').map(text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*')
  return new RegExp(`^${pattern}$`).test(path)
}

export const isCritical = (ledger, path) => ledger.critical.some(glob => matches(glob, path))

/** Stable keys for what can be dismissed: a Fallow finding or a line of surviving mutants. */
export const findingKey = (kind, file, detail) => `${kind}:${file}:${detail}`

export function findings(out) {
  const fallow = readJsonIf(join(out, 'fallow.json'))
  const mutation = readJsonIf(join(out, 'mutation.json'))
  const items = []

  for (const file of fallow?.check?.unused_files ?? []) {
    items.push({ key: findingKey('unused-file', file.path, ''), kind: 'unused-file', file: file.path, detail: 'Fallow finds nothing that imports this file.' })
  }
  for (const entry of fallow?.check?.unused_exports ?? []) {
    const name = entry.export_name ?? entry.name ?? '?'
    items.push({ key: findingKey('unused-export', entry.path, name), kind: 'unused-export', file: entry.path, detail: `Export ${name} is never imported.` })
  }
  for (const finding of fallow?.health?.findings ?? []) {
    items.push({
      key: findingKey('complex', finding.path, finding.line),
      kind: 'complex',
      file: finding.path,
      line: finding.line,
      detail: `${finding.name} is hard to follow (cyclomatic ${finding.cyclomatic}, cognitive ${finding.cognitive}).`,
    })
  }

  for (const [path, file] of Object.entries(mutation?.files ?? {})) {
    const lines = file.source ? file.source.split('\n') : []
    const byLine = new Map()
    for (const mutant of file.mutants ?? []) {
      if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue
      const line = mutant.location.start.line
      if (!byLine.has(line)) byLine.set(line, [])
      byLine.get(line).push(`${mutant.mutatorName} → ${mutant.replacement ?? '?'}`)
    }
    for (const [line, changes] of byLine) {
      items.push({
        key: findingKey('mutant', path, line),
        kind: 'mutant',
        file: path,
        line,
        code: (lines[line - 1] ?? '').trim(),
        detail: `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} no test noticed: ${changes.slice(0, 3).join('; ')}`,
      })
    }
  }
  return items
}

const rank = question => TOPICS.indexOf(question.topic) * 10_000 + Number(question.id.slice(1))

export function addQuestions(ledger, incoming) {
  let next = ledger.questions.reduce((n, q) => Math.max(n, Number(q.id.slice(1))), 0)
  for (const raw of incoming) {
    if (!TOPICS.includes(raw.topic)) throw new Error(`Unknown topic "${raw.topic}". Topics: ${TOPICS.join(', ')}`)
    for (const field of ['expectation', 'actual', 'example']) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`Each question needs a "${field}".`)
    }
    if (!Array.isArray(raw.suggestions) || raw.suggestions.length < 2) throw new Error('Each question needs at least two suggestions.')
    next += 1
    ledger.questions.push({
      id: `Q${next}`,
      topic: raw.topic,
      expectation: raw.expectation,
      actual: raw.actual,
      example: raw.example,
      suggestions: raw.suggestions,
      about: raw.about ?? [],
      status: 'open',
      answer: null,
      reason: null,
      test: null,
    })
  }
  return ledger
}

export const openQuestions = ledger => ledger.questions.filter(q => q.status === 'open').sort((a, b) => rank(a) - rank(b))

export function answerQuestion(ledger, { id, status, answer, reason, dismiss = [], critical = [] }) {
  const question = ledger.questions.find(q => q.id === id)
  if (!question) throw new Error(`No question ${id}.`)
  if (!RESOLVED.includes(status)) throw new Error(`Status must be one of ${RESOLVED.join(', ')}.`)
  if (status !== 'answered' && !reason) throw new Error(`A ${status} question needs a reason.`)
  question.status = status
  question.answer = answer ?? null
  question.reason = reason ?? null
  for (const key of dismiss) ledger.dismissed[key] = { question: id, reason: answer ?? reason }
  for (const glob of critical) if (!ledger.critical.includes(glob)) ledger.critical.push(glob)
  return ledger
}

export function summary(ledger) {
  const open = ledger.questions.filter(q => q.status === 'open')
  return {
    asked: ledger.questions.length,
    waiting: open.length,
    resolved: ledger.questions.length - open.length,
    openCritical: open.filter(q => CRITICAL_TOPICS.includes(q.topic)).length,
    tested: ledger.questions.filter(q => q.test?.green).length,
    critical: ledger.critical,
  }
}

const list = value => (value ? value.split(',').map(s => s.trim()).filter(Boolean) : [])

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step] = process.argv.slice(2)
  const repo = arg('repo', '.')
  try {
    if (step === 'findings') {
      const out = arg('out')
      if (!out) throw new Error('--out <run folder> is required')
      const ledger = loadLedger(repo)
      const items = findings(out)
        .filter(item => !(item.key in ledger.dismissed))
        .map(item => ({ ...item, critical: isCritical(ledger, item.file) }))
      console.log(JSON.stringify(items, null, 2))
    } else if (step === 'add') {
      const incoming = JSON.parse(readFileSync(0, 'utf8'))
      const ledger = addQuestions(loadLedger(repo), Array.isArray(incoming) ? incoming : [incoming])
      save(repo, ledger)
      console.log(`${ledger.questions.length} questions; ${openQuestions(ledger).length} open.`)
    } else if (step === 'next') {
      console.log(JSON.stringify(openQuestions(loadLedger(repo)).slice(0, Number(arg('limit', '4'))), null, 2))
    } else if (step === 'answer') {
      const ledger = answerQuestion(loadLedger(repo), {
        id: arg('id'),
        status: arg('status', 'answered'),
        answer: arg('answer'),
        reason: arg('reason'),
        dismiss: list(arg('dismiss')),
        critical: list(arg('critical')),
      })
      save(repo, ledger)
      console.log(JSON.stringify(summary(ledger)))
    } else if (step === 'summary') {
      console.log(JSON.stringify(summary(loadLedger(repo)), null, 2))
    } else {
      throw new Error('Steps: findings, add, next, answer, summary')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
