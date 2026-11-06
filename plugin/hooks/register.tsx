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
  readOpenQuestions,
  readResults,
  RESULTS_PATH,
  rowLayout,
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
  shape: 'summary-6',
})

// Shaped, so a tab an earlier version stored (overview, evidence) reads as the grade.
const tabAtom = atom({ plugin: 'imagineer', key: 'tab' } as const, 'grade' as Tab, { shape: 'tab-2' })
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
      openQuestions: readOpenQuestions(await readIf($, QUESTIONS_PATH)),
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
    const layout = rowLayout(e.props.bodyColumns)
    // The numbers line up in their own column, right-aligned, as wide as the widest.
    const valueWidth = Math.max(0, ...summary.dimensions.map(d => (d.metric && d.metric.value !== '—' ? d.metric.value.length : 0)))
    const waiting = summary.questions.waiting
    const opened = await read($, openAtom)
    const tabs: { id: Tab; label: string }[] = [
      { id: 'grade', label: 'Grade' },
      { id: 'questions', label: waiting ? `Questions (${waiting})` : 'Questions' },
    ]

    // Only what matters at a glance: the verdict, the commit and when it was tested.
    // While a run is under way: that it is running, and what it is doing now.
    const tested = whenTested(summary.run.at)
    const isRunning = summary.run.status === 'running'
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

    // One row per area, a button that opens its evidence underneath. Laid out for the pane's
    // width: icon, name, state and the area's number, with what it counts when there is room;
    // two lines when the pane is narrow. A row's children are text only, as a button takes.
    const row = (dimension: Results['dimensions'][number]) => {
      const label = labelFor(dimension)
      const isOpen = opened.includes(dimension.id)
      const arrow = isOpen ? '▾ ' : '▸ '
      const stateText = `${label.word}${!dimension.isPending && (dimension.isStale || summary.isStale) ? ' ⟳' : ''}`
      const metric = dimension.metric && dimension.metric.value !== '—' ? dimension.metric : null
      const toggle = () => update($, openAtom, ids => (ids.includes(dimension.id) ? ids.filter(id => id !== dimension.id) : [...ids, dimension.id]))
      const plain = `${arrow}${label.icon} ${dimension.name} ${stateText}${metric ? ` ${metric.value} ${metric.label}` : ''}`

      const button =
        layout.kind === 'narrow' ? (
          <Button key={`row-${dimension.id}`} label={plain} plain onPress={toggle}>
            <Text dimColor>{arrow}</Text>
            <Text color={label.color}>{label.icon}</Text>
            {` ${dimension.name}`}
          </Button>
        ) : (
          <Button key={`row-${dimension.id}`} label={plain} plain onPress={toggle}>
            <Text dimColor>{arrow}</Text>
            <Text color={label.color}>{`${label.icon}  `}</Text>
            {dimension.name.padEnd(layout.nameWidth).slice(0, layout.nameWidth)}
            <Text color={label.color}>{stateText.padEnd(layout.stateWidth)}</Text>
            {metric ? metric.value.padStart(valueWidth) : ''.padStart(valueWidth)}
            {metric && layout.kind === 'wide' && metric.label ? <Text dimColor>{`  ${metric.label}`}</Text> : ''}
          </Button>
        )

      return (
        <Box flexDirection="column">
          {button}
          {layout.kind === 'narrow' && (
            <Box paddingLeft={4}>
              <Text>
                <Text color={label.color}>{stateText}</Text>
                {metric ? ` · ${metric.value}` : ''}
              </Text>
            </Box>
          )}
          {isOpen && (
            <Box flexDirection="column" paddingLeft={5} marginBottom={1}>
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

    const grade = (
      <Box flexDirection="column">
        {summary.dimensions.map(dimension => row(dimension))}
        <Box marginTop={1} flexDirection="column">
          {isRunning && <Text dimColor>Areas fill in as Inspect measures them.</Text>}
          {!isRunning &&
            summary.run.bar &&
            finishLines(summary.run.bar).map(line => (
              <Text dimColor={!line.startsWith('✓')} color={line.startsWith('✓') ? 'success' : undefined}>
                {line}
              </Text>
            ))}
          <Box marginTop={1}>
            <Text dimColor>Select a row for details.</Text>
          </Box>
        </Box>
      </Box>
    )

    const questions = (
      <Box flexDirection="column" gap={1}>
        {waiting === 0 ? (
          <Text dimColor>Nothing is waiting for you.</Text>
        ) : (
          <Text color="warning">
            {waiting} {waiting === 1 ? 'question is' : 'questions are'} waiting. Run /imagineer:inspect to answer.
          </Text>
        )}
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
        {tab === 'questions' ? questions : grade}
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
