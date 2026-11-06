#!/usr/bin/env node
// The question ledger: what Inspect asked the user, and what they answered.
// Lives in <repo>/.claude/imagineer/questions.json, kept out of git.
//
//   node questions.mjs findings --repo <repo> --out <run folder>   what needs a question, as JSON
//   node questions.mjs add      --repo <repo>                       questions as a JSON array on stdin
//   node questions.mjs next     --repo <repo> [--limit 4]           open questions, most consequential first
//   node questions.mjs ask      --repo <repo> [--limit 4]           the next questions as AskUserQuestion input
//   node questions.mjs not-sure --repo <repo> --id Q3 --example "<a new example>" [--point "<said another way>"]
//   node questions.mjs answer   --repo <repo> --id Q3 --status answered|decided|deferred
//                               --answer "<the user's words>" [--reason "<why>"]
//                               [--dismiss <key>,<key>] [--critical <glob>,<glob>] [--own]   --own: the user typed their own answer
//   node questions.mjs equivalent --repo <repo> --mutant <file>#<id> --reason "<why no one could tell>"
//   node questions.mjs summary  --repo <repo>

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, readJsonIf, writeJson } from './lib.mjs'

export const LEDGER = '.claude/imagineer/questions.json'

/** Most consequential first. */
export const TOPICS = ['data', 'money', 'permissions', 'behaviour', 'wording']
export const CRITICAL_TOPICS = ['data', 'money', 'permissions']
const RESOLVED = ['answered', 'decided', 'deferred']

export const emptyLedger = () => ({ schema: 1, critical: [], dismissed: {}, equivalent: {}, questions: [] })

export const loadLedger = repo => ({ ...emptyLedger(), ...readJsonIf(join(repo, LEDGER)) })

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

  const security = readJsonIf(join(out, 'security.json'))
  for (const c of security?.candidates ?? []) {
    items.push({
      key: findingKey('security', c.path, `${c.line}:${c.category}`),
      kind: 'security',
      file: c.path,
      line: c.line,
      detail: `Possible ${c.category} (CWE-${c.cwe}, ${c.severity}): ${c.evidence}`,
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

/** Words a person without technical knowledge reads, by topic, for the dialog's chip. */
export const TOPIC_WORD = { data: 'Data', money: 'Money', permissions: 'Access', behaviour: 'Behaviour', wording: 'Wording' }

const CODE_PATTERNS = [
  [/`/, 'backticks'],
  [/\b[\w./-]+\.(?:[cm]?[jt]sx?|py|rb|go|sql|json|ya?ml|css|html|md)\b/i, 'a file name'],
  [/\b[A-Za-z_$][\w$]*\(/, 'a function call'],
  [/\b[a-z]+[A-Z][A-Za-z0-9]*\b/, 'a code name in camelCase'],
  [/\b[a-z]+_[a-z_]+\b/, 'a code name with underscores'],
  [/:\d+\b/, 'a line number'],
]

/** Why a text a user reads is not plain language, or null. Code details belong in `detail`. */
export function plainLanguageProblem(text) {
  for (const [pattern, what] of CODE_PATTERNS) if (pattern.test(text ?? '')) return what
  return null
}

const MAX_POINT = 100
const MAX_LABEL = 40

/** A suggestion: a short label and what choosing it means for people or data. */
function toSuggestion(raw, id) {
  const suggestion = typeof raw === 'string' ? { label: raw, means: '' } : { label: raw?.label ?? '', means: raw?.means ?? '' }
  if (!suggestion.label.trim()) throw new Error(`${id}: each suggestion needs a label.`)
  if (suggestion.label.length > MAX_LABEL) throw new Error(`${id}: the suggestion "${suggestion.label}" is longer than ${MAX_LABEL} characters; put the rest in "means".`)
  if (!suggestion.means.trim()) throw new Error(`${id}: the suggestion "${suggestion.label}" needs "means": what choosing it means for people or data.`)
  return suggestion
}

export function addQuestions(ledger, incoming) {
  let next = ledger.questions.reduce((n, q) => Math.max(n, Number(q.id.slice(1))), 0)
  for (const raw of incoming) {
    const id = `Q${next + 1}`
    if (!TOPICS.includes(raw.topic)) throw new Error(`Unknown topic "${raw.topic}". Topics: ${TOPICS.join(', ')}`)
    for (const field of ['point', 'expectation', 'actual', 'example']) {
      if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`${id} needs a "${field}".`)
    }
    if (raw.point.length > MAX_POINT) throw new Error(`${id}: "point" is one short sentence, at most ${MAX_POINT} characters.`)
    if (!Array.isArray(raw.suggestions) || raw.suggestions.length < 2 || raw.suggestions.length > 3) {
      throw new Error(`${id} needs two or three suggestions; "Not sure" is added for you.`)
    }
    const suggestions = raw.suggestions.map(s => toSuggestion(s, id))
    const userFacing = [raw.point, raw.expectation, raw.actual, raw.example, ...suggestions.flatMap(s => [s.label, s.means])]
    for (const text of userFacing) {
      const problem = plainLanguageProblem(text)
      if (problem) throw new Error(`${id}: "${text.slice(0, 60)}…" holds ${problem}. Say it as behaviour a person sees, and put code details in "detail".`)
    }
    next += 1
    ledger.questions.push({
      id,
      topic: raw.topic,
      point: raw.point,
      expectation: raw.expectation,
      actual: raw.actual,
      example: raw.example,
      suggestions,
      multi: raw.multi === true,
      detail: raw.detail ?? '',
      about: raw.about ?? [],
      status: 'open',
      answer: null,
      reason: null,
      test: null,
      notSure: 0,
    })
  }
  return ledger
}

export const NOT_SURE = { label: 'Not sure', description: 'Explain it another way, with a new example.' }

/** The dialog for one question: the point, then what you would expect, what happens today, and an example. */
export function dialogFor(q) {
  const question = `${q.point}\n\nYou'd expect: ${q.expectation}\nToday: ${q.actual}\nFor example: ${q.example}\n\nWhat should happen?`
  return {
    question,
    header: `${q.id} ${TOPIC_WORD[q.topic] ?? 'Question'}`.slice(0, 12),
    multiSelect: q.multi === true,
    options: [...q.suggestions.map(s => ({ label: s.label, description: s.means })), NOT_SURE],
  }
}

/** AskUserQuestion's input for the next open questions, marked as Imagineer's so the mod can draw beside them. */
export const askInput = (ledger, limit = 4) => ({
  questions: openQuestions(ledger).slice(0, Math.min(limit, 4)).map(dialogFor),
  metadata: { source: 'imagineer' },
})

/** "Not sure": the question stays open with a new example, said another way, for one more try. */
export function notSure(ledger, { id, example, point }) {
  const question = ledger.questions.find(q => q.id === id)
  if (!question) throw new Error(`No question ${id}.`)
  if (!example?.trim()) throw new Error('A "Not sure" needs a new example to ask with.')
  for (const text of [example, point].filter(Boolean)) {
    const problem = plainLanguageProblem(text)
    if (problem) throw new Error(`"${text.slice(0, 60)}…" holds ${problem}; say it as behaviour a person sees.`)
  }
  question.notSure = (question.notSure ?? 0) + 1
  question.example = example
  if (point) question.point = point
  return ledger
}

export const openQuestions = ledger => ledger.questions.filter(q => q.status === 'open').sort((a, b) => rank(a) - rank(b))

export function answerQuestion(ledger, { id, status, answer, reason, dismiss = [], critical = [], ownWords = false }) {
  const question = ledger.questions.find(q => q.id === id)
  if (!question) throw new Error(`No question ${id}.`)
  if (!RESOLVED.includes(status)) throw new Error(`Status must be one of ${RESOLVED.join(', ')}.`)
  if (status !== 'answered' && !reason) throw new Error(`A ${status} question needs a reason.`)
  question.status = status
  question.answer = answer ?? null
  question.reason = reason ?? null
  question.ownWords = ownWords
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
    } else if (step === 'ask') {
      console.log(JSON.stringify(askInput(loadLedger(repo), Number(arg('limit', '4'))), null, 2))
    } else if (step === 'not-sure') {
      const ledger = notSure(loadLedger(repo), { id: arg('id'), example: arg('example'), point: arg('point') })
      save(repo, ledger)
      const q = ledger.questions.find(x => x.id === arg('id'))
      console.log(`${q.id} stays open with a new example (Not sure ${q.notSure} ${q.notSure === 1 ? 'time' : 'times'}).${q.notSure >= 2 ? ' Twice not sure: defer it with a reason, or settle it from the docs.' : ''}`)
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
        ownWords: process.argv.includes('--own'),
      })
      save(repo, ledger)
      console.log(JSON.stringify(summary(ledger)))
    } else if (step === 'equivalent') {
      const mutant = arg('mutant')
      const reason = arg('reason')
      if (!mutant || !/#/.test(mutant) || !reason) throw new Error('--mutant <file>#<id> and --reason are required')
      const ledger = loadLedger(repo)
      ledger.equivalent[mutant] = reason
      save(repo, ledger)
      console.log(`Recorded ${mutant} as a break no one could observe: ${reason}`)
    } else if (step === 'summary') {
      console.log(JSON.stringify(summary(loadLedger(repo)), null, 2))
    } else {
      throw new Error('Steps: findings, add, next, ask, not-sure, answer, equivalent, summary')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
