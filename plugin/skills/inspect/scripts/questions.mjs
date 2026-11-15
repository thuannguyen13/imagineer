#!/usr/bin/env node
// The question ledger: what Inspect asked the user, and what they answered.
// Lives in <repo>/.claude/imagineer/questions.json, kept out of git.
//
//   node questions.mjs findings --repo <repo> --out <run folder>   what needs a question, as JSON
//   node questions.mjs add      --repo <repo>                       questions as a JSON array on stdin
//   node questions.mjs next     --repo <repo> [--limit 4]           open questions, most consequential first
//   node questions.mjs ask      --repo <repo> [--limit 4]           the next questions as AskUserQuestion input
//   node questions.mjs pick     --repo <repo> --id Q3 --choice "<the option picked>" [--own --matches yes|no] [--dismiss <key>,<key>]
//                               a check's answer: matches today (answered) or differs (a gap, asked next)
//   node questions.mjs decide   --repo <repo> --id Q3 --decision fix|keep [--dismiss <key>,<key>]   a gap's decision
//   node questions.mjs not-sure --repo <repo> --id Q3 --example "<a new example>" [--point "<said another way>"]
//   node questions.mjs answer   --repo <repo> --id Q3 --status answered|decided|deferred   (a choice's answer, or any question settled or deferred)
//                               --answer "<the user's words>" [--reason "<why>"]
//                               [--dismiss <key>,<key>] [--critical <glob>,<glob>] [--own]   --own: the user typed their own answer
//   node questions.mjs equivalent --repo <repo> --mutant <file>#<id> --reason "<why no one could tell>"
//   node questions.mjs summary  --repo <repo>

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { arg, isMain, readJsonIf, writeJson } from './lib.mjs'

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

// Gaps first (the user said one thing and the app does another), then by topic, then in order asked.
const rank = question => (question.status === 'gap' ? 0 : 100_000) + TOPICS.indexOf(question.topic) * 10_000 + Number(question.id.slice(1))

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

/**
 * Two kinds of question:
 *   check   about what the app already does. Asked blind: the user picks what should happen from
 *           possible outcomes, one of which is what the app does today, unmarked. Only when their pick
 *           differs are they shown what happens today, and asked whether to fix it.
 *   choice  where there is nothing to compare with: the big picture, or a design decision for
 *           something new. Suggestions, the recommended one first.
 */
export const KINDS = ['check', 'choice']

/** An option: a short label and what choosing it means for people or data. */
function toOption(raw, id) {
  const option = typeof raw === 'string' ? { label: raw, means: '' } : { label: raw?.label ?? '', means: raw?.means ?? '' }
  if (!option.label.trim()) throw new Error(`${id}: each option needs a label.`)
  if (option.label.length > MAX_LABEL) throw new Error(`${id}: the option "${option.label}" is longer than ${MAX_LABEL} characters; put the rest in "means".`)
  if (!option.means.trim()) throw new Error(`${id}: the option "${option.label}" needs "means": what choosing it means for people or data.`)
  return option
}

function options(raw, id, field) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 3) throw new Error(`${id} needs two or three ${field}; "Not sure" is added for you.`)
  return raw.map(o => toOption(o, id))
}

function requirePlain(id, texts) {
  for (const text of texts) {
    const problem = plainLanguageProblem(text)
    if (problem) throw new Error(`${id}: "${text.slice(0, 60)}…" holds ${problem}. Say it as behaviour a person sees, and put code details in "detail".`)
  }
}

const blank = { status: 'open', pick: null, matches: null, decision: null, answer: null, reason: null, test: null, notSure: 0 }

export function addQuestions(ledger, incoming) {
  let next = ledger.questions.reduce((n, q) => Math.max(n, Number(q.id.slice(1))), 0)
  for (const raw of incoming) {
    const id = `Q${next + 1}`
    const kind = raw.kind ?? 'check'
    if (!KINDS.includes(kind)) throw new Error(`${id}: kind is "check" (what the app does today) or "choice" (nothing to compare with).`)
    if (!TOPICS.includes(raw.topic)) throw new Error(`Unknown topic "${raw.topic}". Topics: ${TOPICS.join(', ')}`)
    if (typeof raw.point !== 'string' || !raw.point.trim()) throw new Error(`${id} needs a "point".`)
    if (raw.point.length > MAX_POINT) throw new Error(`${id}: "point" is one short sentence, at most ${MAX_POINT} characters.`)
    if (kind === 'check' && ('expectation' in raw || 'suggestions' in raw)) {
      throw new Error(`${id}: a check asks blind. Give "outcomes" (one of them what the app does today, named by "today") and "actual", not "expectation" or "suggestions".`)
    }
    const common = { id, kind, topic: raw.topic, point: raw.point, detail: raw.detail ?? '', about: raw.about ?? [] }

    if (kind === 'check') {
      for (const field of ['example', 'actual']) {
        if (typeof raw[field] !== 'string' || !raw[field].trim()) throw new Error(`${id} needs "${field}".`)
      }
      const outcomes = options(raw.outcomes, id, 'outcomes')
      const today = typeof raw.today === 'number' ? raw.today : outcomes.findIndex(o => o.label === raw.today)
      if (!Number.isInteger(today) || today < 0 || today >= outcomes.length) {
        throw new Error(`${id}: "today" names the outcome the app does now, by its label or its position from 0.`)
      }
      // Blind means unmarked: nothing may point the user at an answer.
      for (const o of outcomes) {
        if (/recommend|today|current|as it is/i.test(`${o.label} ${o.means}`)) {
          throw new Error(`${id}: the outcome "${o.label}" gives the answer away. Describe what happens, not which one is recommended or current.`)
        }
      }
      requirePlain(id, [raw.point, raw.example, raw.actual, ...outcomes.flatMap(o => [o.label, o.means])])
      ledger.questions.push({ ...common, example: raw.example, outcomes, today, actual: raw.actual, multi: false, ...blank })
    } else {
      const suggestions = options(raw.suggestions, id, 'suggestions')
      requirePlain(id, [raw.point, raw.example ?? '', ...suggestions.flatMap(o => [o.label, o.means])])
      ledger.questions.push({ ...common, example: raw.example ?? '', suggestions, multi: raw.multi === true, ...blank })
    }
    next += 1
  }
  return ledger
}

export const NOT_SURE = { label: 'Not sure', description: 'Explain it another way, with a new example.' }
const NOT_SURE_GAP = { label: 'Not sure', description: 'Leave it undecided for now; Inspect lists it as a gap.' }

/** A check's outcomes in an order that does not give away which one is today's. */
export function shuffled(q) {
  const n = q.outcomes.length
  const start = Number(q.id.slice(1)) % n
  return q.outcomes.map((_, i) => q.outcomes[(start + i) % n])
}

const header = q => `${q.id} ${TOPIC_WORD[q.topic] ?? 'Question'}`.slice(0, 12)

/** The dialog for one question. */
export function dialogFor(q) {
  if (q.status === 'gap') {
    const picked = q.outcomes?.find(o => o.label === q.pick)
    const today = q.outcomes?.[q.today]
    return {
      question: `${q.point}\n\nYou said: ${q.pick}${picked ? `. ${picked.means}` : ''}\nToday: ${q.actual}\n\nFix it, or keep it as it is?`,
      header: header(q),
      multiSelect: false,
      options: [
        { label: 'Fix it (recommended)', description: picked ? picked.means : `Make the app do what you said: ${q.pick}` },
        { label: 'Keep it as it is', description: today ? today.means : 'The app keeps doing what it does today.' },
        NOT_SURE_GAP,
      ],
    }
  }
  if (q.kind === 'check') {
    return {
      question: `${q.point}\n\nFor example: ${q.example}\n\nWhat should happen?`,
      header: header(q),
      multiSelect: false,
      options: [...shuffled(q).map(o => ({ label: o.label, description: o.means })), NOT_SURE],
    }
  }
  if (q.kind === 'choice') {
    return {
      question: `${q.point}${q.example ? `\n\nFor example: ${q.example}` : ''}`,
      header: header(q),
      multiSelect: q.multi === true,
      options: [...q.suggestions.map(s => ({ label: s.label, description: s.means })), NOT_SURE],
    }
  }
  // A question written before 0.3.0, still open in an older ledger.
  return {
    question: `${q.point ?? q.expectation}\n\nYou'd expect: ${q.expectation}\nToday: ${q.actual}\nFor example: ${q.example}\n\nWhat should happen?`,
    header: header(q),
    multiSelect: q.multi === true,
    options: [...(q.suggestions ?? []).map(s => (typeof s === 'string' ? { label: s, description: '' } : { label: s.label, description: s.means })), NOT_SURE],
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

const WAITING = ['open', 'gap']

export const openQuestions = ledger => ledger.questions.filter(q => WAITING.includes(q.status)).sort((a, b) => rank(a) - rank(b))

/**
 * The user's pick on a check, asked blind. Their own words (`own`) need the Lead's reading of
 * whether they describe what the app does today (`matches`). A match is answered; a difference
 * becomes a gap, asked next: fix it or keep it.
 */
export function pick(ledger, { id, choice, own = false, matches = null }) {
  const q = ledger.questions.find(x => x.id === id)
  if (!q) throw new Error(`No question ${id}.`)
  if (q.kind !== 'check') throw new Error(`${id} is not a check; record its answer with "answer".`)
  if (q.status !== 'open') throw new Error(`${id} is ${q.status}, not open.`)
  if (!choice?.trim()) throw new Error('--choice is the option the user picked, or their own words.')
  let matched
  if (own) {
    if (matches === null) throw new Error('For their own words, say whether they describe what the app does today: --matches yes|no.')
    matched = matches
  } else {
    const index = q.outcomes.findIndex(o => o.label.toLowerCase() === choice.trim().toLowerCase())
    if (index === -1) throw new Error(`"${choice}" is not one of ${id}'s outcomes: ${q.outcomes.map(o => o.label).join(' / ')}. Use --own for their own words.`)
    matched = index === q.today
    choice = q.outcomes[index].label
  }
  q.pick = choice
  q.ownWords = own
  q.matches = matched
  if (matched) {
    q.status = 'answered'
    q.answer = choice
  } else {
    q.status = 'gap'
  }
  return { ledger, matched }
}

/** The user's decision on a gap: fix it (the app should do what they said) or keep it as it is. */
export function decide(ledger, { id, decision }) {
  const q = ledger.questions.find(x => x.id === id)
  if (!q) throw new Error(`No question ${id}.`)
  if (q.status !== 'gap') throw new Error(`${id} is ${q.status}, not a gap.`)
  if (!['fix', 'keep'].includes(decision)) throw new Error('The decision is fix or keep.')
  q.status = 'answered'
  q.decision = decision
  q.answer = decision === 'fix' ? q.pick : (q.outcomes[q.today]?.label ?? q.actual)
  return ledger
}

/** An answer the code does not do yet, by the user's own decision: a gap to fix. */
export const isGapToFix = q => q.status === 'answered' && q.decision === 'fix'

export function answerQuestion(ledger, { id, status, answer, reason, dismiss = [], critical = [], ownWords = false }) {
  const question = ledger.questions.find(q => q.id === id)
  if (!question) throw new Error(`No question ${id}.`)
  if (!RESOLVED.includes(status)) throw new Error(`Status must be one of ${RESOLVED.join(', ')}.`)
  if (status !== 'answered' && !reason) throw new Error(`A ${status} question needs a reason.`)
  if (status === 'answered' && question.kind === 'check') {
    throw new Error(`${id} is a check: record the user's pick with "pick", and a gap's decision with "decide".`)
  }
  question.status = status
  question.answer = answer ?? null
  question.reason = reason ?? null
  question.ownWords = ownWords
  for (const key of dismiss) ledger.dismissed[key] = { question: id, reason: answer ?? reason }
  for (const glob of critical) if (!ledger.critical.includes(glob)) ledger.critical.push(glob)
  return ledger
}

/** Records keys as dismissed by a question's answer. */
export function dismissKeys(ledger, id, keys) {
  const q = ledger.questions.find(x => x.id === id)
  for (const key of keys) ledger.dismissed[key] = { question: id, reason: q?.answer ?? q?.reason ?? '' }
  return ledger
}

export function summary(ledger) {
  const waiting = ledger.questions.filter(q => WAITING.includes(q.status))
  return {
    asked: ledger.questions.length,
    waiting: waiting.length,
    resolved: ledger.questions.length - waiting.length,
    openCritical: waiting.filter(q => CRITICAL_TOPICS.includes(q.topic)).length,
    gaps: ledger.questions.filter(isGapToFix).length,
    tested: ledger.questions.filter(q => q.test?.green).length,
    critical: ledger.critical,
  }
}

const list = value => (value ? value.split(',').map(s => s.trim()).filter(Boolean) : [])

if (isMain(import.meta.url)) {
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
    } else if (step === 'pick') {
      const matches = arg('matches')
      const { ledger, matched } = pick(loadLedger(repo), {
        id: arg('id'),
        choice: arg('choice'),
        own: process.argv.includes('--own'),
        matches: matches === null ? null : matches === 'yes',
      })
      dismissKeys(ledger, arg('id'), list(arg('dismiss')))
      save(repo, ledger)
      console.log(matched ? `${arg('id')}: matches what the app does today. Answered.` : `${arg('id')}: differs from what the app does today. Ask it again: it now asks whether to fix it or keep it.`)
    } else if (step === 'decide') {
      const ledger = decide(loadLedger(repo), { id: arg('id'), decision: arg('decision') })
      dismissKeys(ledger, arg('id'), list(arg('dismiss')))
      save(repo, ledger)
      console.log(JSON.stringify(summary(ledger)))
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
      throw new Error('Steps: findings, add, next, ask, pick, decide, not-sure, answer, equivalent, summary')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
