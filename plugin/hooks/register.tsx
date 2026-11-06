// Imagineer's mod: the grade pane, the status band above the prompt, and the
// instant answer to /imagineer:status. It only reads the results file and
// draws: it never writes files, runs processes, calls models or approves
// tool calls. The grade itself is computed by Inspect and Build; this mod
// shows what the results file says and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Results, Summary, Tab } from '../types'
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

const PANE = 'imagineer'
const TITLE = 'Imagineer'
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
// Set when /imagineer:inspect starts, so the pane has something to say before the first results arrive.
const startingAtom = atom({ plugin: 'imagineer', key: 'starting' } as const, false)

let lastMtime: number | null = null
let lastBase: Summary = { kind: 'none' }
let lastShown = ''
let stopWatching: (() => void) | null = null

const readIf = async ($: EngineInterface, path: string): Promise<string | null> =>
  (await $.fs.exists(path)) ? $.fs.read(path) : null

/** The commit the repository's HEAD is at, read from git's own files (no git process). */
async function currentCommit($: EngineInterface): Promise<string | null> {
  try {
    if (!(await $.fs.exists('.git'))) return null
    let gitDir = '.git'
    if ((await $.fs.stat('.git')).kind === 'file') {
      // A worktree: .git names the real folder.
      const pointer = (await $.fs.read('.git')).match(/^gitdir:\s*(.+)$/m)
      if (!pointer) return null
      gitDir = pointer[1]!.trim()
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
  if (!(await $.fs.exists(RESULTS_PATH))) {
    lastMtime = null
    lastBase = { kind: 'none' }
  } else {
    const { mtimeMs } = await $.fs.stat(RESULTS_PATH)
    if (mtimeMs !== lastMtime) {
      lastBase = readResults(await $.fs.read(RESULTS_PATH))
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
  return summary
}

/** Polls the results file while this repo uses Imagineer. Started once. */
function watch($: EngineInterface): void {
  if (stopWatching) return
  const timer = $.clock.every(POLL_MS, () => {
    refresh($).catch(() => undefined)
  })
  stopWatching = () => timer.cancel()
}

export const register: Register = on => {
  // Quiet in repos that do not use Imagineer: only watch when a results
  // file is already there, or when an Imagineer command runs.
  on('session.start', async ($, e, next) => {
    if ((await refresh($)).kind !== 'none') watch($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stopWatching?.()
    stopWatching = null
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

  // /imagineer:inspect and /imagineer:build: watched, then passed on. The pane opens unasked
  // only where it sits beside the transcript; elsewhere the band's Details button opens it.
  // Inspect opens it from the start, so each area fills in as it is measured.
  for (const command of ['imagineer:inspect', 'imagineer:build']) {
    on('command.run', { command }, async ($, e, next) => {
      watch($)
      const summary = await refresh($)
      const isInspect = command === 'imagineer:inspect'
      if (isInspect) await update($, startingAtom, () => true)
      if ((isInspect || summary.kind === 'results') && e.presentation.isFullscreen) {
        void $.ui.open({ id: PANE, title: TITLE })
      }
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
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
    // the number, what it counts, and a small chevron that opens the evidence. The row itself is not a
    // button: Desktop, VS Code and mobile draw a button as its plain label alone.
    const columns = e.props.bodyColumns
    const showValue = columns >= 44
    const showWhat = columns >= 64
    const nameWidth = Math.max(12, Math.min(26, columns - 4 - 12 - (showValue ? 10 : 0) - (showWhat ? 18 : 0) - 3))
    const valueWidth = Math.max(0, ...summary.dimensions.map(d => (d.metric && d.metric.value !== '—' ? d.metric.value.length : 0)))
    const toggleArea = (id: string) => () =>
      update($, openAtom, ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]))

    const header = isRunning ? (
      <Box flexDirection="column">
        <Text weight="semibold">{runningTitle(summary.run)}</Text>
        <Text dimColor>{summary.run.step || 'Working…'}</Text>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text color={overall.color} weight="semibold">
          {overall.icon} {overall.word}
        </Text>
        <Text dimColor>{[summary.run.commit, tested ? `tested ${tested}` : ''].filter(Boolean).join(' · ')}</Text>
      </Box>
    )

    const areaRow = (dimension: Results['dimensions'][number]) => {
      const label = labelFor(dimension)
      const isOpen = opened.includes(dimension.id)
      const metric = dimension.metric && dimension.metric.value !== '—' ? dimension.metric : null
      const stateText = `${label.word}${!dimension.isPending && (dimension.isStale || summary.isStale) ? ' ⟳' : ''}`
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Box width={3} flexShrink={0}>
              <Text color={label.color}>{label.icon}</Text>
            </Box>
            <Box width={nameWidth} flexShrink={0}>
              <Text wrap="truncate-end">{dimension.name}</Text>
            </Box>
            <Box width={12} flexShrink={0}>
              <Text color={label.color}>{stateText}</Text>
            </Box>
            {showValue && (
              <Box width={valueWidth + 2} flexShrink={0} justifyContent="flex-end">
                <Text tabular>{metric ? metric.value : ''}</Text>
              </Box>
            )}
            {showWhat && (
              <Box width={18} flexShrink={0} paddingLeft={2}>
                <Text dimColor wrap="truncate-end">
                  {metric?.label ?? ''}
                </Text>
              </Box>
            )}
            <Box paddingLeft={1}>
              <Button key={`row-${dimension.id}`} label={isOpen ? '⌄' : '›'} plain dimColor onPress={toggleArea(dimension.id)} />
            </Box>
          </Box>
          {isOpen && (
            <Box flexDirection="column" paddingLeft={3} marginBottom={1}>
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
          {isRunning && <Text dimColor>Areas fill in as Inspect measures them.</Text>}
          {!isRunning &&
            summary.run.bar &&
            finishLines(summary.run.bar).map(line => (
              <Text dimColor={!line.startsWith('✓')} color={line.startsWith('✓') ? 'success' : undefined}>
                {line}
              </Text>
            ))}
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
          <Box marginTop={1}>
            <Text dimColor>Select › on an area for its evidence.</Text>
          </Box>
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
        {header}
        {tab === 'questions' ? questions : overview}
        <Text dimColor>Imagineer {summary.imagineer}</Text>
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
