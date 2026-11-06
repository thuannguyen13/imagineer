// Reading the results file. Pure functions: no $ calls, so the mod's hooks
// stay thin and this logic is easy to test.

import type {
  Dimension,
  GradeState,
  Measured,
  OpenQuestion,
  OverallState,
  Results,
  Run,
  RunStatus,
  Summary,
} from '../types'

/** Where Inspect and Build write their results, relative to the repo root. */
export const RESULTS_PATH = '.claude/imagineer/results.json'

/** The self-check's flags, written by /imagineer:feedback's check. */
export const FLAGS_PATH = '.claude/imagineer/flags.json'

/** The question ledger Inspect keeps beside the results. */
export const QUESTIONS_PATH = '.claude/imagineer/questions.json'

/** The results file format this version of the mod reads. */
export const SCHEMA = 1

const GRADE_STATES: readonly GradeState[] = ['strong', 'weak', 'failing', 'unchecked']
const OVERALL_STATES: readonly OverallState[] = [...GRADE_STATES, 'not-proven']
const MEASURED: readonly Measured[] = ['repo', 'default', 'none']
const RUN_STATUSES: readonly RunStatus[] = ['running', 'waiting', 'done', 'stopped']

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback

const unreadable = (reason: string): Summary => ({ kind: 'unreadable', reason })

function toDimension(raw: unknown): Dimension | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null

  return {
    id: raw.id,
    name: text(raw.name, raw.id),
    group: raw.group === 'care' ? 'care' : 'trust',
    // Anything the mod cannot read is shown as not checked, never as a pass.
    state: oneOf(raw.state, GRADE_STATES, 'unchecked'),
    measured: oneOf(raw.measured, MEASURED, 'none'),
    summary: text(raw.summary),
    items: Array.isArray(raw.items) ? raw.items.filter((i): i is string => typeof i === 'string') : [],
    isStale: raw.stale === true,
    isClaimed: raw.claimed === true,
  }
}

function toRun(raw: unknown): Run {
  const run = isObject(raw) ? raw : {}

  return {
    command: run.command === 'build' ? 'build' : 'inspect',
    status: oneOf(run.status, RUN_STATUSES, 'done'),
    round: count(run.round),
    commit: text(run.commit),
    bar: isObject(run.bar)
      ? { met: run.bar.met === true, missing: Array.isArray(run.bar.missing) ? run.bar.missing.filter((m): m is string => typeof m === 'string') : [] }
      : null,
  }
}

const TOPIC_ORDER = ['data', 'money', 'permissions', 'behaviour', 'wording']

/** The open questions in the ledger, most consequential first. Never throws. */
export function readOpenQuestions(source: string | null, limit = 5): OpenQuestion[] {
  if (source === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return []
  }
  if (!isObject(parsed) || !Array.isArray(parsed.questions)) return []
  const rank = (topic: string) => (TOPIC_ORDER.includes(topic) ? TOPIC_ORDER.indexOf(topic) : TOPIC_ORDER.length)
  return parsed.questions
    .filter((q): q is Json => isObject(q) && q.status === 'open' && typeof q.id === 'string')
    .map(q => ({ id: String(q.id), topic: text(q.topic, 'behaviour'), text: text(q.point) || text(q.expectation).replace(/^My guess \(no docs found\):\s*/, '') }))
    .sort((a, b) => rank(a.topic) - rank(b.topic) || Number(a.id.slice(1)) - Number(b.id.slice(1)))
    .slice(0, limit)
}

/** What the self-check said about Imagineer itself, as plain lines. Never throws. */
export function readFlags(source: string | null): string[] {
  if (source === null) return []
  try {
    const parsed: unknown = JSON.parse(source)
    if (!isObject(parsed) || !Array.isArray(parsed.flags)) return []
    return parsed.flags.filter(isObject).map(f => text(f.said)).filter(Boolean)
  } catch {
    return []
  }
}

/** The engineers' detail of each question in the ledger, by id. Never throws. */
export function readDetails(source: string | null): Record<string, string> {
  if (source === null) return {}
  try {
    const parsed: unknown = JSON.parse(source)
    if (!isObject(parsed) || !Array.isArray(parsed.questions)) return {}
    const details: Record<string, string> = {}
    for (const q of parsed.questions) if (isObject(q) && typeof q.id === 'string' && typeof q.detail === 'string' && q.detail) details[q.id] = q.detail
    return details
  } catch {
    return {}
  }
}

/** The question ids an Imagineer dialog asks, read from each question's chip ("Q4 Access"). */
export function dialogIds(questions: unknown[]): string[] {
  return questions.flatMap(q => (isObject(q) && typeof q.header === 'string' ? (q.header.match(/^Q\d+/) ?? []) : []))
}

/** Where `.git/HEAD` points: a ref to look up, or a commit when detached. */
export function parseHead(head: string): { ref: string } | { sha: string } | null {
  const line = head.trim()
  const ref = line.match(/^ref:\s*(\S+)$/)
  if (ref) return { ref: ref[1]! }
  return /^[0-9a-f]{7,64}$/.test(line) ? { sha: line } : null
}

/** A ref's commit in `packed-refs`, when it is not a loose file. */
export function findPackedRef(packed: string, ref: string): string | null {
  for (const line of packed.split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (name === ref && sha && /^[0-9a-f]+$/.test(sha)) return sha
  }
  return null
}

/** A full commit matches the short commit a grade records when it starts with it. */
export const isSameCommit = (full: string, short: string) => short !== '' && full.startsWith(short)

/** Turns the file's text into what the pane and band draw. */
export function readResults(source: string): Summary {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return unreadable('The results file is not valid JSON.')
  }
  if (!isObject(parsed)) return unreadable('The results file is not a JSON object.')
  if (parsed.schema !== SCHEMA) {
    return unreadable(
      `The results file uses format ${String(parsed.schema)}, and this version of Imagineer reads format ${SCHEMA}. Run /imagineer:inspect again.`,
    )
  }

  const overall = isObject(parsed.overall) ? parsed.overall : {}
  const questions = isObject(parsed.questions) ? parsed.questions : {}
  const dimensions = Array.isArray(parsed.dimensions)
    ? parsed.dimensions.map(toDimension).filter((one): one is Dimension => one !== null)
    : []

  const results: Results = {
    kind: 'results',
    imagineer: text(parsed.imagineer, 'unknown'),
    scale: count(parsed.scale),
    run: toRun(parsed.run),
    overall: {
      state: oneOf(overall.state, OVERALL_STATES, 'unchecked'),
      reason: text(overall.reason),
    },
    dimensions,
    questions: { waiting: count(questions.waiting), resolved: count(questions.resolved) },
    isStale: false,
    openQuestions: [],
    flags: [],
  }

  return results
}

const shortText = (value: string, max = 110) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

export const questionLine = (q: OpenQuestion) => `${q.id} (${q.topic}): ${shortText(q.text)}`

/** How many items Evidence shows per area before "and N more". */
export const ITEMS_SHOWN = 5

/** The first items of a list, with a last line counting the rest. */
export function firstItems(items: string[], shown = ITEMS_SHOWN): string[] {
  if (items.length <= shown) return items
  return [...items.slice(0, shown), `…and ${items.length - shown} more in the run's report`]
}

export const STATE_LABEL: Record<OverallState, { icon: string; word: string; color: string }> = {
  strong: { icon: '✓', word: 'Strong', color: 'success' },
  weak: { icon: '!', word: 'Weak', color: 'warning' },
  failing: { icon: '✕', word: 'Failing', color: 'error' },
  unchecked: { icon: '?', word: 'Not checked', color: 'inactive' },
  'not-proven': { icon: '?', word: 'Not proven yet', color: 'inactive' },
}

export const MEASURED_LABEL: Record<Measured, string> = {
  repo: "● the repo's own setup",
  default: "◐ Imagineer's defaults",
  none: '○ not measured',
}

const COMMAND_WORD = { inspect: 'Inspecting', build: 'Building' } as const

/** True while a run is under way, so the band has something to say. */
export const isActive = (summary: Summary): summary is Results =>
  summary.kind === 'results' && (summary.run.status === 'running' || summary.run.status === 'waiting')

/** The band's one line, for example "Inspecting · round 2 · 3 questions waiting". */
export function statusLine(results: Results): string {
  const parts: string[] = [COMMAND_WORD[results.run.command]]
  if (results.run.round > 0) parts.push(`round ${results.run.round}`)
  const waiting = results.questions.waiting
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? 'question' : 'questions'} waiting`)

  return parts.join(' · ')
}

/** The grade as plain text, where nothing draws a pane. */
export function summaryText(summary: Summary): string {
  if (summary.kind === 'none') {
    return 'No Imagineer results in this repo yet. Run /imagineer:inspect to start.'
  }
  if (summary.kind === 'unreadable') return summary.reason

  const overall = STATE_LABEL[summary.overall.state]
  const lines = [`Imagineer: ${overall.icon} ${overall.word}${summary.overall.reason ? ` (${summary.overall.reason})` : ''}`]
  if (summary.isStale) lines.push(`⟳ Measured at ${summary.run.commit}; the code has changed since. Run /imagineer:inspect again for a current grade.`)
  for (const dimension of summary.dimensions) {
    const label = STATE_LABEL[dimension.state]
    const notes = [dimension.isStale || summary.isStale ? 'stale' : '', dimension.isClaimed ? 'claimed' : ''].filter(Boolean)
    lines.push(
      `  ${label.icon} ${dimension.name}: ${label.word}${dimension.summary ? `. ${dimension.summary}` : ''}${notes.length ? ` [${notes.join(', ')}]` : ''}`,
    )
    for (const item of firstItems(dimension.items)) lines.push(`      • ${item}`)
  }
  if (summary.run.bar) {
    lines.push(summary.run.bar.met ? 'Stop bar: met.' : `Stop bar not met: ${summary.run.bar.missing.join('; ')}.`)
  }
  if (summary.questions.waiting > 0) {
    lines.push(`${summary.questions.waiting} questions waiting for you.`)
    for (const q of summary.openQuestions) lines.push(`  ${questionLine(q)}`)
  }
  if (summary.flags.length) {
    lines.push('Imagineer may have gone wrong on its side:')
    for (const flag of summary.flags) lines.push(`  ${flag}`)
    lines.push('Run /imagineer:feedback to record or share it.')
  }
  if (summary.run.commit) lines.push(`Measured at commit ${summary.run.commit}.`)

  return lines.join('\n')
}
