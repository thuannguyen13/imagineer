// Reading the results file. Pure functions: no $ calls, so the mod's hooks
// stay thin and this logic is easy to test.

import type {
  Dimension,
  GradeState,
  Measured,
  OverallState,
  Results,
  Run,
  RunStatus,
  Summary,
} from '../types'

/** Where Inspect and Build write their results, relative to the repo root. */
export const RESULTS_PATH = '.claude/imagineer/results.json'

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
  }
}

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
  }

  return results
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
  for (const dimension of summary.dimensions) {
    const label = STATE_LABEL[dimension.state]
    const notes = [dimension.isStale ? 'stale' : '', dimension.isClaimed ? 'claimed' : ''].filter(Boolean)
    lines.push(
      `  ${label.icon} ${dimension.name}: ${label.word}${dimension.summary ? `. ${dimension.summary}` : ''}${notes.length ? ` [${notes.join(', ')}]` : ''}`,
    )
  }
  if (summary.questions.waiting > 0) {
    lines.push(`${summary.questions.waiting} questions waiting for you.`)
  }
  if (summary.run.commit) lines.push(`Measured at commit ${summary.run.commit}.`)

  return lines.join('\n')
}
