// Imagineer's mod: the grade pane, the status band above the prompt, and the
// instant answer to /imagineer:status. It only reads the results file and
// draws: it never writes files, runs processes, calls models or approves
// tool calls. The grade itself is computed by Inspect; this mod
// shows what the results file says and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Results, Summary, Tab } from '../types'
import { VERSION } from './version'
import {
  dialogIds,
  FLAGS_PATH,
  findPackedRef,
  finishLines,
  firstItems,
  isActive,
  isSameCommit,
  labelFor,
  MEASURED_LABEL,
  parseHead,
  progressBar,
  targetBar,
  CONDITION_MARK,
  whoseShort,
  whose,
  PENDING_LABEL,
  QUESTIONS_PATH,
  readDetails,
  readFlags,
  questionLine,
  readAnswered,
  readOpenQuestions,
  readResults,
  RESULTS_PATH,
  runningTitle,
  whenTested,
  STATE_LABEL,
  statusLine,
  summaryText,
} from './results'

// The finish conditions' goal column: the longest goal and two columns of space.
const GOAL_WIDTH = 37

const PANE = 'imagineer'
const TITLE = `Imagineer ${VERSION}`
const POLL_MS = 3000

// Change the tag when Summary's fields change: a value an earlier version
// stored is then read as "no results" until the file is read again.
const summaryAtom = atom({ plugin: 'imagineer', key: 'summary' } as const, { kind: 'none' } as Summary, {
  shape: 'summary-7',
})

// Two tabs, each with its own job. Overview: how the project is doing. Questions: what the user
// told Imagineer, and what it still needs from them. Shaped, so a tab an earlier version stored reads as Overview.
const tabAtom = atom({ plugin: 'imagineer', key: 'tab' } as const, 'overview' as Tab, { shape: 'tab-3' })
// The areas whose evidence is open, by id; all closed at first.
const openAtom = atom({ plugin: 'imagineer', key: 'open' } as const, [] as string[])
// The spinner's frame while a run is under way; a timer advances it only then.
const frameAtom = atom({ plugin: 'imagineer', key: 'frame' } as const, 0)
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN_MS = 250
let stopSpinning: (() => void) | null = null

// Set when /imagineer:inspect starts, so the pane has something to say before the first results arrive.
const startingAtom = atom({ plugin: 'imagineer', key: 'starting' } as const, false)

let lastMtime: number | null = null
let lastBase: Summary = { kind: 'none' }
let lastShown = ''
let stopWatching: (() => void) | null = null

/**
 * A path in the session's folder, made absolute. The engine reads a relative path against the
 * working directory it binds when the session starts; a hot reload of this module (its files changed
 * during the session) does not bind it again, and the pane then found no results although they were
 * there. Asking the session for its folder each time holds after a reload too.
 */
async function at($: EngineInterface, path: string): Promise<string> {
  if (path.startsWith('/')) return path
  try {
    const dir = await $.session.cwd()
    return dir ? `${dir.replace(/\/+$/, '')}/${path}` : path
  } catch {
    return path
  }
}

const readIf = async ($: EngineInterface, path: string): Promise<string | null> => {
  const full = await at($, path)
  return (await $.fs.exists(full)) ? $.fs.read(full) : null
}

/** The commit the repository's HEAD is at, read from git's own files (no git process). */
async function currentCommit($: EngineInterface): Promise<string | null> {
  try {
    const dotGit = await at($, '.git')
    if (!(await $.fs.exists(dotGit))) return null
    let gitDir = dotGit
    if ((await $.fs.stat(dotGit)).kind === 'file') {
      // A worktree: .git names the real folder.
      const pointer = (await $.fs.read(dotGit)).match(/^gitdir:\s*(.+)$/m)
      if (!pointer) return null
      gitDir = await at($, pointer[1]!.trim())
    }
    const head = parseHead(await $.fs.read(`${gitDir}/HEAD`))
    if (!head) return null
    if ('sha' in head) return head.sha
    const common = await readIf($, `${gitDir}/commondir`)
    const commonDir = common === null ? gitDir : common.trim().startsWith('/') ? common.trim() : `${gitDir}/${common.trim()}`
    for (const dir of [gitDir, commonDir]) {
      const loose = await readIf($, `${dir}/${head.ref}`)
      if (loose !== null) return loose.trim()
    }
    const packed = await readIf($, `${commonDir}/packed-refs`)
    return packed === null ? null : findPackedRef(packed, head.ref)
  } catch {
    return null
  }
}

/** Reads the results file again when it changed, adds what changed since, and stores it. */
async function refresh($: EngineInterface): Promise<Summary> {
  const results = await at($, RESULTS_PATH)
  if (!(await $.fs.exists(results))) {
    lastMtime = null
    lastBase = { kind: 'none' }
  } else {
    const { mtimeMs } = await $.fs.stat(results)
    if (mtimeMs !== lastMtime) {
      lastBase = readResults(await $.fs.read(results))
      lastMtime = mtimeMs
    }
  }

  let summary: Summary = lastBase
  if (lastBase.kind === 'results') {
    const head = await currentCommit($)
    summary = {
      ...lastBase,
      isStale: head !== null && !isSameCommit(head, lastBase.run.commit),
      ...(await (async () => {
        const ledger = await readIf($, QUESTIONS_PATH)
        return { openQuestions: readOpenQuestions(ledger), answered: readAnswered(ledger) }
      })()),
      flags: readFlags(await readIf($, FLAGS_PATH)),
    }
  }

  // Redraw only when something a reader sees has changed.
  const shown = JSON.stringify(summary)
  if (shown !== lastShown) {
    lastShown = shown
    await update($, summaryAtom, () => summary)
  }
  spin($, summary.kind === 'results' && summary.run.status === 'running')
  return summary
}

/** Runs the spinner's timer while a run is under way, and stops it once the run stops. */
function spin($: EngineInterface, isRunning: boolean): void {
  if (isRunning && !stopSpinning) {
    const timer = $.clock.every(SPIN_MS, () => {
      update($, frameAtom, n => (n + 1) % SPINNER.length).catch(() => undefined)
    })
    stopSpinning = () => timer.cancel()
  } else if (!isRunning && stopSpinning) {
    stopSpinning()
    stopSpinning = null
  }
}

/** Polls the results file while this repo uses Imagineer. Started once. */
function watch($: EngineInterface): void {
  if (stopWatching) return
  const timer = $.clock.every(POLL_MS, () => {
    refresh($).catch(() => undefined)
  })
  stopWatching = () => timer.cancel()
}

export const register: Register = (on, options) => {
  // Whether a run opens the pane is the user's choice (the plugin's settings), never Imagineer's.
  const opensPaneOnRun = options.openPaneOnRun === true

  // Quiet in repos that do not use Imagineer: only watch when a results
  // file is already there, or when an Imagineer command runs.
  on('session.start', async ($, e, next) => {
    if ((await refresh($)).kind !== 'none') watch($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopWatching?.()
    stopWatching = null
    stopSpinning?.()
    stopSpinning = null
    return next(e)
  })

  // /imagineer:status: answered here, so the skill never reaches Claude.
  on('command.run', { command: 'imagineer:status' }, async $ => {
    const summary = await refresh($)
    if (summary.kind !== 'results') return { text: summaryText(summary) }

    watch($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    // Where no pane can be drawn (a -p run, a cloud session), answer in text.
    return opened.isPlaced ? {} : { text: summaryText(summary) }
  })

  // /imagineer:inspect: watched, then passed on. The pane opens only when
  // the user turned on openPaneOnRun, and then only where it sits beside the transcript;
  // otherwise the band's Details button or /imagineer:status opens it.
  // Inspect then opens it from the start, so each area fills in as it is measured.
  for (const command of ['imagineer:inspect']) {
    on('command.run', { command }, async ($, e, next) => {
      watch($)
      const summary = await refresh($)
      const isInspect = command === 'imagineer:inspect'
      if (isInspect) await update($, startingAtom, () => true)
      if (opensPaneOnRun && (isInspect || summary.kind === 'results') && e.presentation.isFullscreen) {
        void $.ui.open({ id: PANE, title: TITLE })
      }
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // A pane left open across a reload of this module keeps following the file.
    watch($)
    const { Box, Button, Text } = $.ui.resolve(e)
    const summary = await read($, summaryAtom)
    if (summary.kind === 'none' && (await read($, startingAtom))) {
      return (
        <Box flexDirection="column">
          <Text weight="semibold">◌ Inspect is starting</Text>
          <Text dimColor>Making a throwaway copy of your project. Each area fills in here as it is measured.</Text>
        </Box>
      )
    }
    if (summary.kind !== 'results') return <Text dimColor>{summaryText(summary)}</Text>

    const tab = await read($, tabAtom)
    const overall = STATE_LABEL[summary.overall.state]
    const waiting = summary.questions.waiting
    const opened = await read($, openAtom)
    const tabs: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Overview' },
      { id: 'questions', label: waiting ? `Questions (${waiting})` : 'Questions' },
    ]

    // Only what matters at a glance: the verdict, the commit and when it was tested.
    // While a run is under way: that it is running, and what it is doing now.
    const tested = whenTested(summary.run.at)
    const isRunning = summary.run.status === 'running'

    // One layout for every surface. Each area is one row of columns sized in character cells, which
    // Desktop measures with its code font, so they line up there as in the terminal: icon, name, state,
    // the number and what it counts. The chevron and the name are one button, the widest part of the
    // row to press; the rest cannot be, as Desktop, VS Code and mobile draw a button as its plain label
    // alone, without the columns or colours. So the coloured icon sits with the state.
    const columns = e.props.bodyColumns
    const nameWidth = Math.max(12, Math.min(26, columns - 2 - 14 - 16))
    const toggleArea = (id: string) => () =>
      update($, openAtom, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))

    // The header is one box that always holds where things stand, moving from the process to the
    // result. While Inspect runs: a spinner, what it is doing, and each threshold Imagineer suggests
    // as a bar (no verdict yet: the grade is partial). Once it stops: the verdict and the commit lead,
    // with Inspect's progress smaller beneath them while thresholds are left, and one line once all
    // are met. The verdict and Inspect's progress are independent: Inspect can be done while the
    // project still fails.
    const frame = await read($, frameAtom)
    const bar = summary.run.bar
    const progress = bar && bar.progress.length > 0 ? bar : null
    const doneCount = progress ? progress.progress.filter(p => p.met).length : 0
    // Each finish condition as what it is: a mark for its state and its goal, then beneath it the
    // picture its kind calls for. A condition that cannot be measured says why, with no picture.
    const condition = (step: NonNullable<typeof progress>['progress'][number]) => {
      const state = step.state ?? (step.met ? 'met' : 'open')
      const color = state === 'met' ? 'success' : state === 'blocked' ? 'warning' : undefined
      const shown = state === 'open' || state === 'met'
      const cells = step.kind === 'threshold' ? targetBar(step.value, step.target) : null
      const lit = step.met ? 'success' : 'warning'
      const dots = Math.max(0, Math.min(step.target, step.value ?? 0))
      // One row: the mark, the goal in its own column, then what it calls for and the note, so every
      // condition's detail starts at the same place.
      return (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color={color} dimColor={state === 'pending'}>
              {CONDITION_MARK[state]}
            </Text>
          </Box>
          <Box width={GOAL_WIDTH} flexShrink={0}>
            <Text wrap="truncate-end" dimColor={state === 'pending'}>
              {step.goal}
            </Text>
          </Box>
          {shown && cells && (
            <Text>
              <Text color={lit}>{cells.filled}</Text>
              <Text dimColor>{cells.empty}</Text>
              <Text>{cells.mark}</Text>
              <Text color={lit}>{cells.over}</Text>
              <Text dimColor>{`${cells.rest}  `}</Text>
            </Text>
          )}
          {shown && step.kind === 'streak' && (
            <Text>
              <Text color={lit}>{'● '.repeat(dots)}</Text>
              <Text dimColor>{`${'○ '.repeat(step.target - dots)} `}</Text>
            </Text>
          )}
          <Text color={state === 'blocked' ? 'warning' : undefined} dimColor={state !== 'blocked'} wrap="truncate-end">
            {step.note}
          </Text>
        </Box>
      )
    }
    const bars = progress?.progress.map(step => {
      if (step.kind) return condition(step)
      // Results from before 0.5.0: their numbers as bars.
      const cells = progressBar(step.done, step.total)
      return (
        <Box flexDirection="row">
          <Box width={2} flexShrink={0}>
            <Text color="success">{step.met ? '✓' : ' '}</Text>
          </Box>
          <Box width={22} flexShrink={0}>
            <Text wrap="truncate-end">{step.label}</Text>
          </Box>
          <Box width={15} flexShrink={0}>
            <Text>
              <Text color={step.met ? 'success' : 'warning'}>{cells.filled}</Text>
              <Text dimColor>{cells.empty}</Text>
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {step.text}
          </Text>
        </Box>
      )
    })
    const isConditions = Boolean(progress?.progress.some(step => step.kind))
    const progressTitle = progress ? (isConditions ? `To finish Inspect · ${doneCount} of ${progress.progress.length} done` : `Inspect's progress · ${doneCount} of ${progress.progress.length} done`) : ''

    const header = isRunning ? (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box flexDirection="row" flexWrap="wrap">
          <Text color="claude">{`${SPINNER[frame % SPINNER.length]} `}</Text>
          <Text weight="semibold">{progressTitle || runningTitle(summary.run).replace(/^◌ /, '')}</Text>
          {progress && <Text dimColor>{`   ${isConditions ? whoseShort(progress) : `by the thresholds ${whose(progress)}`}`}</Text>}
        </Box>
        {/* In line with the title after the spinner, and with the bars' labels. */}
        <Box flexDirection="row">
          <Box width={2} flexShrink={0} />
          <Text dimColor>{summary.run.step || 'Working…'}</Text>
        </Box>
        {bars}
      </Box>
    ) : (
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" borderDimColor paddingX={1}>
        <Text color={overall.color} weight="semibold">
          {overall.icon} {overall.word}
        </Text>
        <Text dimColor>{[summary.run.commit, tested ? `tested ${tested}` : ''].filter(Boolean).join(' · ')}</Text>
        {/* What Inspect took the project to be, so a wrong guess is seen. */}
        {summary.run.layout && <Text dimColor>{summary.run.layout}</Text>}
        {/* Out of date: said once, here, not on every area. */}
        {summary.isStale && (
          <Text color="warning">⟳ Your code has changed since. Run /imagineer:inspect for a current grade.</Text>
        )}
        {progress?.met ? (
          <Text color="success">{`✓ Inspect finished: every threshold ${whose(progress)} is met.`}</Text>
        ) : progress ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{isConditions ? `${progressTitle}   ${whoseShort(progress)}` : `${progressTitle} · by the thresholds ${whose(progress)}`}</Text>
            {bars}
            <Text dimColor>Run /imagineer:inspect to continue.</Text>
          </Box>
        ) : bar ? (
          <Box flexDirection="column" marginTop={1}>
            {finishLines(bar).map(line => (
              <Text dimColor={!line.startsWith('✓')} color={line.startsWith('✓') ? 'success' : undefined}>
                {line}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    )

    const areaRow = (dimension: Results['dimensions'][number]) => {
      const label = labelFor(dimension)
      const isOpen = opened.includes(dimension.id)
      const metric = dimension.metric && dimension.metric.text ? dimension.metric : null
      const stateText = label.word
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box width={nameWidth + 2} flexShrink={0}>
              <Button key={`row-${dimension.id}`} label={`${isOpen ? '▼' : '▶'} ${dimension.name}`} plain onPress={toggleArea(dimension.id)} />
            </Box>
            <Box width={14} flexShrink={0}>
              <Text color={label.color}>{`${label.icon} ${stateText}`}</Text>
            </Box>
            {metric && (
              <Box flexShrink={1}>
                <Text dimColor={metric.value === '—'} wrap="truncate-end">
                  {metric.text}
                </Text>
              </Box>
            )}
          </Box>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
              {dimension.summary !== '' && <Text>{dimension.summary}</Text>}
              {firstItems(dimension.items).map(item => (
                <Box flexDirection="row">
                  <Box width={2}>
                    <Text dimColor>•</Text>
                  </Box>
                  <Box flexShrink={1}>
                    <Text dimColor>{item}</Text>
                  </Box>
                </Box>
              ))}
              <Text dimColor>
                {MEASURED_LABEL[dimension.measured]}
                {dimension.isClaimed ? ' · claimed, not re-run' : ''}
                {dimension.isStale && !summary.isStale ? ' · measured before the latest changes' : ''}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    const overview = (
      <Box flexDirection="column">
        {summary.dimensions.map(d => areaRow(d))}
        <Box marginTop={1} flexDirection="column">
          {waiting > 0 && (
            <Box marginTop={1}>
              <Button
                key="go-questions"
                label={`${waiting} ${waiting === 1 ? 'question waits' : 'questions wait'} for you: open Questions`}
                plain
                onPress={() => update($, tabAtom, () => 'questions')}
              />
            </Box>
          )}
        </Box>
      </Box>
    )

    const ANSWERS_SHOWN = 8
    const toneColor = { good: 'success', gap: 'error', plain: undefined } as const
    const questions = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="semibold">{waiting ? `Waiting for you (${waiting})` : 'Waiting for you'}</Text>
          {waiting === 0 ? (
            <Text dimColor>Nothing is waiting for you.</Text>
          ) : (
            <Text dimColor>Run /imagineer:inspect to answer.</Text>
          )}
        </Box>
        {summary.openQuestions.map(q => (
          <Box flexDirection="row">
            <Box width={5}>
              <Text dimColor>{q.id}</Text>
            </Box>
            <Box flexShrink={1} flexDirection="column">
              <Text>{q.text}</Text>
              {q.isGap && <Text color="warning">Your answer differs from what the app does: fix it or keep it?</Text>}
            </Box>
          </Box>
        ))}
        {summary.answered.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text weight="semibold">Your answers ({summary.answered.length})</Text>
              <Text dimColor>What you told Imagineer, and what came of it.</Text>
            </Box>
            {summary.answered.slice(0, ANSWERS_SHOWN).map(q => (
              <Box flexDirection="row">
                <Box width={5}>
                  <Text dimColor>{q.id}</Text>
                </Box>
                <Box flexShrink={1} flexDirection="column">
                  <Text>{q.text}</Text>
                  <Text color={toneColor[q.tone]} dimColor={q.tone === 'plain'}>
                    {q.outcome}
                  </Text>
                </Box>
              </Box>
            ))}
            {summary.answered.length > ANSWERS_SHOWN && (
              <Text dimColor>…and {summary.answered.length - ANSWERS_SHOWN} more in .claude/imagineer/questions.json</Text>
            )}
          </Box>
        )}
        {summary.flags.length > 0 && (
          <Box flexDirection="column">
            <Text color="warning">Imagineer may have gone wrong on its side:</Text>
            {summary.flags.map(flag => (
              <Box paddingLeft={2}>
                <Text dimColor>{flag}</Text>
              </Box>
            ))}
            <Text dimColor>Run /imagineer:feedback to record or share it.</Text>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {/* The tabs on the left, the plugin's version on the right of the same line. */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            {tabs.map(t => (
              <Button
                key={`tab-${t.id}`}
                label={t.label}
                variant={t.id === tab ? 'primary' : 'secondary'}
                onPress={() => update($, tabAtom, () => t.id)}
              />
            ))}
          </Box>
          <Text dimColor>{`v${VERSION}`}</Text>
        </Box>
        {header}
        {tab === 'questions' ? questions : overview}
      </Box>
    )
  })

  // Inspect's questions: a calm line above Claude Code's own dialog, and each question's
  // details for engineers, read from the ledger. The dialog itself stays Claude Code's.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.metadataSource !== 'imagineer') return theirs
    const { Box, Text } = $.ui.resolve(e)
    const details = readDetails(await readIf($, QUESTIONS_PATH))
    const lines = dialogIds(e.props.questions)
      .filter(id => details[id])
      .slice(0, 2)
      .map(id => {
        const detail = details[id]!
        return `For engineers · ${id}: ${detail.length > 110 ? `${detail.slice(0, 109).trimEnd()}…` : detail}`
      })
    return (
      <Box flexDirection="column">
        <Text dimColor>Imagineer asks what your app should do. Pick an answer, Not sure, or type your own.</Text>
        {lines.map(line => (
          <Text dimColor>{line}</Text>
        ))}
        {theirs}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const summary = await read($, summaryAtom)
    if (e.props.hasSurvey || !isActive(summary)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    // While measuring, the grade so far is partial: show that it is running, not a verdict.
    const overall = summary.run.status === 'running' ? PENDING_LABEL : STATE_LABEL[summary.overall.state]

    return (
      <Box>
        <Text color={overall.color}>{overall.icon} </Text>
        <Text>Imagineer · {statusLine(summary)} </Text>
        <Button key="details" label="Details" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })
}
