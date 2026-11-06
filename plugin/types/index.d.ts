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
  metric: { value: string; label: string } | null
  isStale: boolean
  isClaimed: boolean
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'stopped'

export type Run = {
  command: 'inspect' | 'build'
  status: RunStatus
  round: number
  commit: string
  /** Inspect's stop bar, when the run recorded one. */
  bar: { met: boolean; missing: string[] } | null
}

/** An open question from the question ledger, for the pane. */
export type OpenQuestion = { id: string; topic: string; text: string }

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
  /** The self-check's flags about Imagineer itself, as plain lines. */
  flags: string[]
}

/** What the mod knows about the repo's results file. */
/** The pane's tabs. */
export type Tab = 'overview' | 'evidence' | 'questions'

export type Summary =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | Results

declare module 'claude-code' {
  interface PluginState {
    imagineer: { summary: Shaped<Summary>; tab: Tab }
  }
}
