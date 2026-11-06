// Imagineer's mod: the grade pane, the status band above the prompt, and the
// instant answer to /imagineer:status. It only reads the results file and
// draws: it never writes files, runs processes, calls models or approves
// tool calls. The grade itself is computed by Inspect and Build; this mod
// shows what the results file says and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Summary } from '../types'
import {
  dialogIds,
  FLAGS_PATH,
  findPackedRef,
  isActive,
  isSameCommit,
  MEASURED_LABEL,
  parseHead,
  QUESTIONS_PATH,
  readDetails,
  readFlags,
  questionLine,
  readOpenQuestions,
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
  shape: 'summary-3',
})

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
          {summary.isStale && (
            <Text color="warning">{`⟳ Measured at ${summary.run.commit}; the code has changed since. Run /imagineer:inspect again.`}</Text>
          )}
        </Box>
        {groups.map(group => (
          <Box flexDirection="column">
            <Text weight="semibold">{group.title}</Text>
            {group.dimensions.map(dimension => {
              const label = STATE_LABEL[dimension.state]
              const notes = [dimension.isStale || summary.isStale ? '⟳ stale' : '', dimension.isClaimed ? 'claimed' : '']
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
        {summary.run.bar && (
          <Text color={summary.run.bar.met ? 'success' : 'inactive'}>
            {summary.run.bar.met ? '✓ Stop bar met.' : `Stop bar not met: ${summary.run.bar.missing.join('; ')}.`}
          </Text>
        )}
        {summary.questions.waiting > 0 && (
          <Box flexDirection="column">
            <Text color="warning">
              {summary.questions.waiting} {summary.questions.waiting === 1 ? 'question is' : 'questions are'} waiting
              for you. Run /imagineer:inspect to answer.
            </Text>
            {summary.openQuestions.map(q => (
              <Text dimColor>{`   ${questionLine(q)}`}</Text>
            ))}
          </Box>
        )}
        {summary.flags.length > 0 && (
          <Box flexDirection="column">
            <Text color="warning">Imagineer may have gone wrong on its side:</Text>
            {summary.flags.map(flag => (
              <Text dimColor>{`   ${flag}`}</Text>
            ))}
            <Text dimColor>   Run /imagineer:feedback to record or share it.</Text>
          </Box>
        )}
        <Text dimColor>
          {summary.run.commit ? `Measured at ${summary.run.commit} · ` : ''}Imagineer {summary.imagineer}
        </Text>
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
