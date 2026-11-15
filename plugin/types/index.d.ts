// The values the Imagineer mod keeps in $.state, and the shape of the
// results file it reads (.claude/imagineer/results.json, schema 1).
// The file format is documented in docs/results-file.md.

export type GradeState = 'strong' | 'weak' | 'failing' | 'unchecked'

/** The overall grade adds "not proven yet": a trust dimension is unchecked. */
export type OverallState = GradeState | 'not-proven'

export type Measured = 'repo' | 'default' | 'none'

export type Dimension = {
  id: string
  name: string
  group: 'trust' | 'care'
  state: GradeState
  measured: Measured
  summary: string
  /** The list behind the summary (files, attacks, answers), shown under Evidence. */
  items: string[]
  /** The area's one measured number and what it counts, for its tile. */
  metric: { value: string; label: string; text: string } | null
  isStale: boolean
  isClaimed: boolean
  /** A running Inspect has not reached this area yet: coming up, not "not checked". */
  isPending: boolean
}

/** One finish threshold and how far along it is: `done` of `total`, and the numbers in words. */
/**
 * One of Inspect's finish conditions. From 0.5.0 each has a kind (a threshold to reach, findings to
 * count down, or a streak that starts again), a state, its goal in words, today's value and a note.
 * `label`, `done`, `total` and `text` are what results from before 0.5.0 carry, drawn as bars.
 */
export type FinishStep = {
  label: string
  done: number
  total: number
  met: boolean
  text: string
  kind: 'threshold' | 'countdown' | 'streak' | null
  state: 'met' | 'open' | 'blocked' | 'pending' | null
  goal: string
  value: number | null
  target: number
  note: string
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'stopped'

export type Run = {
  command: 'inspect'
  status: RunStatus
  round: number
  commit: string
  /** What the run is doing now, in plain words, while it runs; empty otherwise. */
  step: string
  /** When the run measured the code, as an ISO time; empty when unknown. */
  at: string
  /** The layout the run worked from, in one short line (the app, the code test strength measured); empty when unknown. */
  layout: string
  /** Inspect's finish thresholds, when the run recorded them: met, or what is still missing. */
  /** `by`: whose thresholds they are, the user's own (`you`) or Imagineer's suggestion. */
  bar: { met: boolean; missing: string[]; progress: FinishStep[]; by: 'you' | 'imagineer' } | null
}

/** An open question from the question ledger, for the pane. */
export type OpenQuestion = {
  id: string
  topic: string
  text: string
  /** The user's answer differs from what the app does: asked next whether to fix it. */
  isGap: boolean
}

export type Results = {
  kind: 'results'
  imagineer: string
  scale: number
  run: Run
  overall: { state: OverallState; reason: string }
  dimensions: Dimension[]
  questions: { waiting: number; resolved: number }
  /** True once the repository's HEAD is no longer the commit the grade was measured at. */
  isStale: boolean
  openQuestions: OpenQuestion[]
  /** A question the user resolved, and what came of it, for the Questions tab's record. */
  answered: AnsweredQuestion[]
  /** The self-check's flags about Imagineer itself, as plain lines. */
  flags: string[]
}

/** A resolved question and its outcome in plain words; `tone` colours it. */
export type AnsweredQuestion = { id: string; text: string; outcome: string; tone: 'good' | 'gap' | 'plain' }

/** What the mod knows about the repo's results file. */
/** The pane's tabs. */
export type Tab = 'overview' | 'questions'

export type Summary =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | Results

declare module 'claude-code' {
  interface PluginState {
    imagineer: { summary: Shaped<Summary>; tab: Shaped<Tab>; open: string[]; starting: boolean; frame: number }
  }
}
