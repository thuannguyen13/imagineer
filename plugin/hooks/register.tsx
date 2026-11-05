// Imagineer's mod: the grade pane, the status band above the prompt, and the
// instant answer to /imagineer:status. It only reads the results file and
// draws: it never writes files, runs processes, calls models or approves
// tool calls. The grade itself is computed by Inspect and Build; this mod
// shows what the results file says and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'
import {
  isActive,
  MEASURED_LABEL,
  readResults,
  RESULTS_PATH,
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
  shape: 'summary-1',
})

let lastMtime: number | null = null
let stopWatching: (() => void) | null = null

/** Reads the results file again when it changed, and stores what it says. */
async function refresh($: EngineInterface): Promise<Summary> {
  if (!(await $.fs.exists(RESULTS_PATH))) {
    lastMtime = null
    const none: Summary = { kind: 'none' }
    await update($, summaryAtom, () => none)
    return none
  }

  const { mtimeMs } = await $.fs.stat(RESULTS_PATH)
  if (mtimeMs === lastMtime) return read($, summaryAtom)

  const summary = readResults(await $.fs.read(RESULTS_PATH))
  lastMtime = mtimeMs
  await update($, summaryAtom, () => summary)
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

  // /imagineer:inspect and /imagineer:build: watched, then passed on.
  for (const command of ['imagineer:inspect', 'imagineer:build']) {
    on('command.run', { command }, async ($, e, next) => {
      watch($)
      const summary = await refresh($)
      // Open the pane unasked only where it sits beside the transcript.
      if (summary.kind === 'results' && e.presentation.isFullscreen) {
        void $.ui.open({ id: PANE, title: TITLE })
      }
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const summary = await read($, summaryAtom)

    if (summary.kind !== 'results') {
      return <Text dimColor>{summaryText(summary)}</Text>
    }

    const overall = STATE_LABEL[summary.overall.state]
    const groups = [
      { title: 'Can you trust it?', dimensions: summary.dimensions.filter(one => one.group === 'trust') },
      { title: 'Is it kept well?', dimensions: summary.dimensions.filter(one => one.group === 'care') },
    ]

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color={overall.color} weight="semibold">
            {overall.icon} Overall: {overall.word}
          </Text>
          {summary.overall.reason !== '' && <Text dimColor>{summary.overall.reason}</Text>}
        </Box>
        {groups.map(group => (
          <Box flexDirection="column">
            <Text weight="semibold">{group.title}</Text>
            {group.dimensions.map(dimension => {
              const label = STATE_LABEL[dimension.state]
              const notes = [dimension.isStale ? '⟳ stale' : '', dimension.isClaimed ? 'claimed' : '']
                .filter(Boolean)
                .join(' · ')
              return (
                <Box flexDirection="column">
                  <Text color={label.color}>
                    {label.icon} {label.word}: {dimension.name}
                    {notes ? ` (${notes})` : ''}
                  </Text>
                  {dimension.summary !== '' && <Text dimColor>{`   ${dimension.summary}`}</Text>}
                  <Text dimColor>{`   ${MEASURED_LABEL[dimension.measured]}`}</Text>
                </Box>
              )
            })}
          </Box>
        ))}
        {summary.questions.waiting > 0 && (
          <Text color="warning">
            {summary.questions.waiting} {summary.questions.waiting === 1 ? 'question is' : 'questions are'} waiting
            for you.
          </Text>
        )}
        <Text dimColor>
          {summary.run.commit ? `Measured at ${summary.run.commit} · ` : ''}Imagineer {summary.imagineer}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const summary = await read($, summaryAtom)
    if (e.props.hasSurvey || !isActive(summary)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const overall = STATE_LABEL[summary.overall.state]

    return (
      <Box>
        <Text color={overall.color}>{overall.icon} </Text>
        <Text>Imagineer · {statusLine(summary)} </Text>
        <Button key="details" label="Details" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })
}
