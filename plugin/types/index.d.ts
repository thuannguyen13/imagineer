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
  /** A running Inspect has not reached this area yet: coming up, not "not checked". */
  isPending: boolean
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'stopped'

export type Run = {
  command: 'inspect' | 'build'
  status: RunStatus
  round: number
  commit: string
  /** What the run is doing now, in plain words, while it runs; empty otherwise. */
  step: string
  /** When the run measured the code, as an ISO time; empty when unknown. */
  at: string
  /** Inspect's finish thresholds, when the run recorded them: met, or what is still missing. */
  bar: { met: boolean; missing: string[] } | null
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
  /** The self-check's flags about Imagineer itself, as plain lines. */
  flags: string[]
}

/** What the mod knows about the repo's results file. */
/** The pane's tabs. */
export type Tab = 'grade' | 'questions'

export type Summary =
  | { kind: 'none' }
  | { kind: 'unreadable'; reason: string }
  | Results

declare module 'claude-code' {
  interface PluginState {
    imagineer: { summary: Shaped<Summary>; tab: Shaped<Tab>; open: string[]; starting: boolean }
  }
}
