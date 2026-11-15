import { expect, mock, test } from 'claude-code/testing'
import { VERSION } from './version'

const RESULTS = '.claude/imagineer/results.json'

const SAMPLE = {
  schema: 1,
  imagineer: '0.2.0',
  scale: 1,
  run: { command: 'inspect', status: 'waiting', round: 2, commit: 'abc1234', at: '2026-11-06T14:02:00', bar: { met: false, missing: ['two attack rounds in a row that find nothing new'] } },
  overall: { state: 'failing', reason: 'Test strength and data safety are failing.' },
  dimensions: [
    {
      id: 'test-strength',
      name: 'Test strength',
      group: 'trust',
      state: 'failing',
      measured: 'default',
      summary: 'Tests catch 30% of planted bugs.',
      metric: { value: '51/167', label: 'planted bugs caught' },
    },
    { id: 'intent', name: 'Matches your intent', group: 'trust', state: 'unchecked', measured: 'none', summary: '' },
    {
      id: 'data-safety',
      name: 'Data safety',
      group: 'trust',
      state: 'weak',
      measured: 'none',
      summary: 'Restore is only claimed.',
      claimed: true,
    },
    { id: 'structure', name: 'Structure', group: 'care', state: 'weak', measured: 'default', summary: 'Fallow 81.', stale: true },
  ],
  questions: { waiting: 3, resolved: 5 },
}

const PANE = {
  plugin: 'imagineer',
  component: 'Pane',
  requestId: 'imagineer',
  props: {
    title: 'Imagineer',
    isFocused: false,
    bodyColumns: 90,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'imagineer',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} },
} as const

import type { CommandRunInput, On } from 'claude-code'

/** A command typed at the prompt, as the engine stamps it. */
const typed = (command: string): CommandRunInput => ({
  command,
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
})

/** Stands for the engine's file system, with the given files in the repo. */
function files(on: On, contents: Record<string, string>) {
  let mtime = 1
  // The engine may hand the path on resolved against the session's directory.
  const find = (path: string) => Object.keys(contents).find(name => path === name || path.endsWith(`/${name}`))
  // Every folder above a file, so `.git` is a folder when `.git/HEAD` is a file, however the path is spelled.
  const isDir = (path: string) =>
    Object.keys(contents).some(name =>
      name
        .split('/')
        .slice(0, -1)
        .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
        .some(folder => folder !== '' && (path === folder || path.endsWith(`/${folder}`))),
    )
  mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_, e) => ({ value: find(e.path) !== undefined || isDir(e.path) }))
  on('fs.stat', (_, e) => {
    if (find(e.path) === undefined && isDir(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    const name = find(e.path)
    if (name === undefined) throw new Error('not found')
    return { value: { kind: 'file', size: contents[name]!.length, mtimeMs: mtime, isLink: false } }
  })
  on('fs.read', (_, e) => {
    const name = find(e.path)
    if (name === undefined) throw new Error('not found')
    return { value: contents[name]! }
  })
  return {
    change(path: string, text: string) {
      contents[path] = text
      mtime += 1
    },
  }
}

test('status with no results says how to start, and opens nothing', async ($, on) => {
  files(on, {})
  let opened = false
  on('ui.open', () => {
    opened = true
    return { value: { isPlaced: true } }
  })

  const result = await $.command.run(typed('imagineer:status'))

  expect(result.text).toBe('No Imagineer results in this repo yet. Run /imagineer:inspect to start.')
  expect(opened).toBe(false)
})

test('status opens the pane: an aligned overview first, on every surface', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  const titles: string[] = []
  on('ui.open', (_, e) => {
    titles.push(String(e.title))
    return { value: { isPlaced: true } }
  })

  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text ?? '').toBe('')
  // The plugin's version is in the pane's title, kept in step with plugin.json by CI.
  expect(titles).toEqual([`Imagineer ${VERSION}`])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^✕ At risk$/ }))?.text).toBe('✕ At risk')
    // The header: the verdict, the commit and when it was tested, nothing else.
    expect(await ui.find({ type: 'Text', text: /^abc1234 · tested Nov 6, 14:02$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Test strength and data safety are failing/ })).toBeUndefined()
    // One layout on every surface: each area's name, its number and what it counts, its state, each
    // its own Text with its colour. The chevron and the name are one button, the widest place to press.
    const row = await ui.find({ type: 'Button', key: 'row-test-strength' })
    {
      expect(row?.text).toBe('▶ Test strength')
      // Results written before the plain phrase say the number and its label.
      expect(await ui.find({ type: 'Text', text: /^51\/167 planted bugs caught$/ })).toBeDefined()
      expect((await ui.find({ type: 'Button', key: 'go-questions' }))?.text).toBe('3 questions wait for you: open Questions')
      expect(await ui.find({ type: 'Text', text: /^✕ At risk$/ })).toBeDefined()
    }
    expect(await ui.find({ type: 'Button', key: 'row-intent' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'tab-questions' })).toBeDefined()
    // The version sits on the tabs' line, on every surface, since not every app shows the pane's title.
    expect(await ui.find({ type: 'Text', text: `v${VERSION}` })).toBeDefined()
    // All rows start closed: no evidence until a row is pressed.
    expect(await ui.find({ type: 'Text', text: /Tests catch 30%/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('pressing a row opens its evidence: the summary and the first five items, then the rest counted', async ($, on) => {
  const many = { ...SAMPLE, dimensions: [{ ...SAMPLE.dimensions[0], items: Array.from({ length: 18 }, (_, i) => `A${i + 1}: attack ${i + 1}`) }] }
  files(on, { [RESULTS]: JSON.stringify(many) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'row-test-strength' })
    expect((await ui.find({ type: 'Button', key: 'row-test-strength' }))?.text).toBe('▼ Test strength')
    expect(await ui.find({ type: 'Text', text: /Tests catch 30% of planted bugs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(• )?A5: attack 5$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(• )?A6: attack 6$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /and 13 more/ })).toBeDefined()
    await ui.press({ key: 'row-test-strength' })
    expect(await ui.find({ type: 'Text', text: /Tests catch 30%/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('Questions lists what is waiting, by its point', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.claude/imagineer/questions.json': JSON.stringify({ questions: [{ id: 'Q6', topic: 'permissions', status: 'open', point: 'A Microsoft sign-in can take over the test admin.', expectation: 'x' }] }),
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-questions' })
  expect(await ui.find({ type: 'Text', text: /^A Microsoft sign-in can take over the test admin\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Waiting for you \(3\)$/ })).toBeDefined()
  await ui.unmount()
})

test('status answers in text where no pane can be drawn', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))

  const result = await $.command.run(typed('imagineer:status'))

  expect(result.text).toContain('Imagineer: ✕ At risk')
  expect(result.text).toContain('? Matches your intent: Not checked')
  expect(result.text).toContain('[claimed]')
  expect(result.text).toContain('3 questions waiting for you.')
})

test('a results file in another format is not shown as a grade', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, schema: 2 }) })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const result = await $.command.run(typed('imagineer:status'))

  expect(result.text).toContain('uses format 2')
  expect(result.text).toContain('Run /imagineer:inspect again')
})

test('a broken results file is reported, not shown as a grade', async ($, on) => {
  files(on, { [RESULTS]: '{ not json' })

  const result = await $.command.run(typed('imagineer:status'))

  expect(result.text).toBe('The results file is not valid JSON.')
})

test('inspect is passed on to the skill, and the band shows the run', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let reachedSkill = false
  on('command.run', () => {
    reachedSkill = true
    return { text: 'skill ran' }
  })

  const result = await $.command.run(typed('imagineer:inspect'))
  expect(reachedSkill).toBe(true)
  expect(result.text).toBe('skill ran')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Imagineer ·/ }))?.text).toBe(
      'Imagineer · Inspecting · round 2 · 3 questions waiting ',
    )
    expect(await ui.find({ type: 'Button', key: 'details' })).toBeDefined()
    await ui.unmount()
  }
})

test('the band stays quiet in a repo without Imagineer results', async ($, on) => {
  files(on, {})
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the band stays quiet once a run is done', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, run: { ...SAMPLE.run, status: 'done' } }) })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('the pane follows the file when it changes', async ($, on) => {
  const disk = files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  disk.change(RESULTS, JSON.stringify({ ...SAMPLE, overall: { state: 'weak', reason: '' } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^! Weak$/ }))?.text).toBe('! Weak')
  await ui.unmount()
})

const LEDGER = JSON.stringify({
  questions: [
    { id: 'Q9', topic: 'wording', status: 'open', expectation: 'Error messages are plain.' },
    { id: 'Q6', topic: 'permissions', status: 'open', expectation: 'My guess (no docs found): test sign-in never works on the live app.' },
    { id: 'Q2', topic: 'data', status: 'answered', expectation: 'Answered already.' },
  ],
})

test('the pane lists open questions, most consequential first, and the finish thresholds', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE), '.claude/imagineer/questions.json': LEDGER })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Not finished yet\. By the thresholds Imagineer suggests, Inspect still needs:$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^  • two attack rounds in a row that find nothing new$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Run \/imagineer:inspect to continue\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Stop bar/ })).toBeUndefined()
  await ui.press({ key: 'tab-questions' })
  const ids = (await ui.findAll({ type: 'Text', text: /^Q\d+$/ })).map(found => found.text)
  // Waiting first, most consequential first; then the record of what was answered.
  expect(ids).toEqual(['Q6', 'Q9', 'Q2'])
  expect(await ui.find({ type: 'Text', text: /^test sign-in never works on the live app\.$/ })).toBeDefined()
  await ui.unmount()
})

test('Overview says when questions wait, and pressing it opens Questions', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE), '.claude/imagineer/questions.json': LEDGER })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'tab-overview' }))?.text).toMatch(/Overview/)
  expect((await ui.find({ type: 'Button', key: 'go-questions' }))?.text).toBe('3 questions wait for you: open Questions')
  await ui.press({ key: 'go-questions' })
  expect(await ui.find({ type: 'Text', text: /^Waiting for you \(3\)$/ })).toBeDefined()
  await ui.unmount()
})

test('Your answers says what came of each question, gaps to fix first', async ($, on) => {
  const ledger = JSON.stringify({
    questions: [
      { id: 'Q1', topic: 'data', status: 'answered', point: 'Deleted clients?', matches: true, answer: 'Hidden', test: { green: true, red: { killed: 2, total: 2 } } },
      { id: 'Q2', topic: 'permissions', status: 'answered', point: 'Notes after losing access?', matches: false, decision: 'fix', answer: 'Bo can no longer read them' },
      { id: 'Q3', topic: 'wording', status: 'answered', point: 'Error wording?', matches: false, decision: 'keep', answer: 'Short' },
      { id: 'Q4', topic: 'data', status: 'decided', point: 'Backups?', reason: 'docs/data.md' },
      { id: 'Q5', topic: 'behaviour', status: 'answered', kind: 'choice', point: 'What is the app for?', answer: 'Selling plans' },
    ],
  })
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, questions: { waiting: 0, resolved: 5 } }), '.claude/imagineer/questions.json': ledger })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'go-questions' })).toBeUndefined()
  await ui.press({ key: 'tab-questions' })
  expect(await ui.find({ type: 'Text', text: /^Nothing is waiting for you\.$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^Q\d+$/ })).map(t => t.text)).toEqual(['Q2', 'Q1', 'Q3', 'Q4', 'Q5'])
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Differs from the app: you want it fixed (Bo can no longer read them)')
  expect(texts).toContain('Matches what the app does · proven by a test')
  expect(texts).toContain('Differs from the app: kept as it is')
  expect(texts).toContain('Settled from the docs or code')
  expect(texts).toContain('You answered: Selling plans')
  await ui.unmount()
})

test('the grade is marked stale once HEAD moves past the measured commit', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/refs/heads/main': 'def5678000000000000000000000000000000000\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).toContain('⟳ Measured at abc1234; the code has changed since.')
  // Said once, not on every area.
  expect(result.text).not.toContain('[stale]')
})

test('the pane says once, in its header, that the code has changed since the grade', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/refs/heads/main': 'def5678000000000000000000000000000000000\n',
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const stale = await ui.findAll({ type: 'Text', text: /⟳/ })
  expect(stale.map(t => t.text)).toEqual(['⟳ Your code has changed since. Run /imagineer:inspect for a current grade.'])
  await ui.unmount()
})

test('the grade is current when HEAD is the measured commit, found in packed-refs', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/packed-refs': '# pack-refs with: peeled\nabc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).not.toContain('changed since')
})

test('a worktree is followed to its own HEAD', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git': 'gitdir: /repo/.git/worktrees/feature\n',
    '/repo/.git/worktrees/feature/HEAD': 'def5678000000000000000000000000000000000\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).toContain('the code has changed since')
})

test('the self-check’s flags about Imagineer itself are shown, with the way to report them', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.claude/imagineer/flags.json': JSON.stringify({ flags: [{ kind: 'grade-contradiction', said: 'Q8 was proven by a test, yet attack A7 broke the same behaviour.' }] }),
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).toContain('Imagineer may have gone wrong on its side:')
  expect(result.text).toContain('Q8 was proven by a test, yet attack A7 broke the same behaviour.')
  expect(result.text).toContain('/imagineer:feedback')
})

const DIALOG = (metadataSource?: string) => ({
  plugin: 'imagineer',
  component: 'AskUserQuestion' as const,
  props: {
    tool: 'AskUserQuestion',
    questions: [{ question: 'Bo can still read deal notes after losing Pipeline access.', header: 'Q4 Access', multiSelect: false, options: [{ label: 'Must not happen', description: 'Bo stops seeing them.' }, { label: 'Not sure', description: 'Explain it another way.' }] }],
    ...(metadataSource ? { metadataSource } : {}),
  },
})

test('Imagineer\'s question dialog gets a calm line and the engineers\' detail above Claude Code\'s own', async ($, on) => {
  files(on, { '.claude/imagineer/questions.json': JSON.stringify({ questions: [{ id: 'Q4', detail: 'The notes rule skips the Pipeline View check (features/notes/rules.ts:14).' }] }) })
  // Stands for Claude Code's own dialog, which the tree must hold exactly once.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...DIALOG('imagineer'), surface })
    expect(await ui.find({ type: 'Text', text: /Imagineer asks what your app should do/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /For engineers/ }))?.text).toBe('For engineers · Q4: The notes rule skips the Pipeline View check (features/notes/rules.ts:14).')
    await ui.unmount()
  }
})

test('other questions keep Claude Code\'s dialog untouched', async ($, on) => {
  files(on, {})
  // Stands for Claude Code's own dialog, which the tree must hold exactly once.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const ui = await $.ui.mount({ ...DIALOG(), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Imagineer asks/ })).toBeUndefined()
  await ui.unmount()
})

const RUNNING = {
  ...SAMPLE,
  run: { ...SAMPLE.run, status: 'running', round: 1, step: 'Measuring test strength (about 18 minutes)', bar: { met: false, missing: ['x'] } },
  overall: { state: 'not-proven', reason: '' },
  dimensions: [
    { id: 'foundations', name: 'Foundations', group: 'care', state: 'weak', measured: 'default', summary: 'No CI.' },
    { id: 'test-strength', name: 'Test strength', group: 'trust', state: 'unchecked', measured: 'none', summary: 'Inspect gets to this later in this run.', pending: true },
  ],
  questions: { waiting: 0, resolved: 0 },
}

test('a first inspect opens the pane at once, saying it is starting, when the user turned that on', { options: { openPaneOnRun: true } }, async ($, on) => {
  files(on, {})
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('command.run', () => ({ text: 'skill ran' }))

  await $.command.run(typed('imagineer:inspect'))
  expect(opened).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^◌ Inspect is starting$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fills in here as it is measured/ })).toBeDefined()
  await ui.unmount()
})

test('inspect leaves the pane closed unless the user turned on opening it', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('command.run', () => ({ text: 'skill ran' }))

  await $.command.run(typed('imagineer:inspect'))
  expect(opened).toBe(0)

  // The band still shows the run, and its Details button opens the pane when asked.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'details' })
  expect(opened).toBe(1)
  await band.unmount()
})

test('inspect does not open the pane unasked on the main screen, where it would cover the transcript', { options: { openPaneOnRun: true } }, async ($, on) => {
  files(on, {})
  let opened = 0
  on('ui.open', () => {
    opened += 1
    return { value: { isPlaced: true } }
  })
  on('command.run', () => ({ text: 'skill ran' }))

  await $.command.run({ ...typed('imagineer:inspect'), presentation: { isFullscreen: false, columns: 120 } })
  expect(opened).toBe(0)
})

test('while Inspect runs, the pane says what it is doing, and areas not reached yet are coming up', async ($, on) => {
  const disk = files(on, {})
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.run', () => ({ text: 'skill ran' }))
  await $.command.run(typed('imagineer:inspect'))

  // The first results arrive while the pane is open; the poll picks them up.
  disk.change(RESULTS, JSON.stringify(RUNNING))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // While running: no verdict yet, and a spinner beside what Inspect is doing.
  expect(await ui.find({ type: 'Text', text: /^Inspect is running$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Measuring test strength \(about 18 minutes\)$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^◌ Coming up$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^! Weak$/ })).toBeDefined()
  // Not a verdict, and not "not finished" while it is still measuring.
  expect(await ui.find({ type: 'Text', text: /Not proven yet/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Not finished yet/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Areas fill in as Inspect measures them/ })).toBeUndefined()
  await ui.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /Imagineer ·/ }))?.text).toBe('Imagineer · Inspecting · round 1 · Measuring test strength (about 18 minutes) ')
  expect((await band.find({ type: 'Text', text: /^◌ $/ }))).toBeDefined()
  await band.unmount()
})

test('a gap waits in Questions first, saying the answer differs from what the app does', async ($, on) => {
  const ledger = JSON.stringify({
    questions: [
      { id: 'Q1', topic: 'data', status: 'open', point: 'What should happen to a deleted client?' },
      { id: 'Q2', topic: 'wording', status: 'gap', point: 'What should the error say?' },
      { id: 'Q3', topic: 'data', status: 'answered', point: 'Answered.' },
    ],
  })
  files(on, { [RESULTS]: JSON.stringify(SAMPLE), '.claude/imagineer/questions.json': ledger })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-questions' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.indexOf('What should the error say?')).toBeLessThan(texts.indexOf('What should happen to a deleted client?'))
  expect(texts).toContain('Your answer differs from what the app does: fix it or keep it?')
  // Answered questions are not waiting: they are in the record below.
  expect(texts.indexOf('Answered.')).toBeGreaterThan(texts.indexOf('Your answers (1)'))
  expect(texts.indexOf('Your answers (1)')).toBeGreaterThan(texts.indexOf('What should happen to a deleted client?'))
  await ui.unmount()
})

test('results from before 0.5.0 still show their finish thresholds as bars', async ($, on) => {
  const progress = [
    { label: 'Planted bugs caught', done: 61, total: 80, met: false, text: '61% of 80%' },
    { label: 'Structure reviewed', done: 2, total: 2, met: true, text: '2 of 2 findings' },
    { label: 'Clean attack rounds', done: 1, total: 2, met: false, text: '1 of 2 in a row' },
  ]
  const results = { ...SAMPLE, run: { ...SAMPLE.run, bar: { met: false, missing: ['x'], progress } } }
  files(on, { [RESULTS]: JSON.stringify(results) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    // Stopped before finishing: the verdict leads, Inspect's progress beneath it with its bars.
    expect(await ui.find({ type: 'Text', text: /^✕ At risk$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Inspect's progress · 1 of 3 done · by the thresholds Imagineer suggests$/ })).toBeDefined()
    // Segmented bars, label first: done in colour, the rest dim.
    expect(await ui.find({ type: 'Text', text: /^▰▰▰▰▰▰▰▰▰$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▱▱▱$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^▰▰▰▰▰▰▰▰▰▰▰▰$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^61% of 80%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Run \/imagineer:inspect to continue\.$/ })).toBeDefined()
    // The old wording is for results written before the bars.
    expect(await ui.find({ type: 'Text', text: /^Not finished yet/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Select an area/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('once Inspect is finished, the box holds the result alone, without the bars', async ($, on) => {
  const progress = ['Planted bugs caught', 'Structure reviewed', 'Clean attack rounds'].map(label => ({ label, done: 2, total: 2, met: true, text: 'done' }))
  const results = { ...SAMPLE, run: { ...SAMPLE.run, status: 'done', bar: { met: true, missing: [], progress } }, overall: { state: 'weak', reason: '' } }
  files(on, { [RESULTS]: JSON.stringify(results) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^! Weak$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓ Inspect finished: every threshold Imagineer suggests is met\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Structure reviewed$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Run \/imagineer:inspect to continue/ })).toBeUndefined()
  await ui.unmount()
})

test('each area says its number as one plain phrase, with no tool names', async ($, on) => {
  const dims = SAMPLE.dimensions.map(d =>
    d.id === 'test-strength' ? { ...d, metric: { value: '31/51', label: 'planted bugs caught', text: '31 of 51 planted bugs caught' } } : d,
  )
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, dimensions: dims }) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^31 of 51 planted bugs caught$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^31\/51 planted bugs caught$/ })).toBeUndefined()
  await ui.unmount()
})

test('thresholds the user set are called theirs, not Imagineer\'s', async ($, on) => {
  const progress = [{ label: 'Planted bugs caught', done: 65, total: 65, met: true, text: '70% of 65%' }]
  const results = { ...SAMPLE, run: { ...SAMPLE.run, status: 'waiting', bar: { met: false, missing: ['x'], progress, by: 'you' } } }
  files(on, { [RESULTS]: JSON.stringify(results) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /by the thresholds you set$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Imagineer suggests/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane names the layout Inspect worked from, so a wrong guess is seen', async ($, on) => {
  const results = { ...SAMPLE, run: { ...SAMPLE.run, status: 'done', layout: 'App in web/ · test strength on src/' } }
  files(on, { [RESULTS]: JSON.stringify(results) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^App in web\/ · test strength on src\/$/ })).toBeDefined()
  await ui.unmount()
})

test('the text answer names the layout too', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, run: { ...SAMPLE.run, layout: 'App in web/ · test strength on src/' } }) })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).toContain('Read as: App in web/ · test strength on src/.')
})

test('the finish conditions show as conditions: a mark for each state, and the picture its kind calls for', async ($, on) => {
  const progress = [
    { kind: 'threshold', state: 'open', goal: 'Tests catch 80% of planted bugs', value: 61, target: 80, note: '61% now', label: 'Planted bugs caught', done: 61, total: 80, met: false, text: '61% of 80%' },
    { kind: 'countdown', state: 'met', goal: 'Every code quality finding reviewed', value: 0, target: 14, note: '0 left of 14', label: 'Code quality reviewed', done: 14, total: 14, met: true, text: '14 of 14 findings' },
    { kind: 'streak', state: 'open', goal: 'Two clean attack rounds in a row', value: 1, target: 2, note: '1 of 2 in a row', label: 'Clean attack rounds', done: 1, total: 2, met: false, text: '1 of 2 in a row' },
  ]
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, run: { ...SAMPLE.run, bar: { met: false, missing: ['x'], progress } } }) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^To finish Inspect · 1 of 3 done {3}Imagineer's suggested thresholds$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Tests catch 80% of planted bugs$/ })).toBeDefined()
  // The threshold: today's share, with the target marked where it sits (61% of 12 cells, the mark at 80%).
  expect(await ui.find({ type: 'Text', text: /^▰▰▰▰▰▰▰$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^│$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^61% now$/ })).toBeDefined()
  // The streak as dots, lit for each clean round and dim for the rest; the countdown as a count; met with ✓.
  expect(await ui.find({ type: 'Text', text: /^● $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^○ {2}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^✓$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^0 left of 14$/ })).toBeDefined()
  await ui.unmount()
})

test('a finish condition that cannot be measured says why, with no picture', async ($, on) => {
  const progress = [{ kind: 'threshold', state: 'blocked', goal: 'Tests catch 80% of planted bugs', value: null, target: 80, note: "can't measure: no test command", label: 'Planted bugs caught', done: 0, total: 80, met: false, text: 'no test command' }]
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, run: { ...SAMPLE.run, bar: { met: false, missing: ['x'], progress } } }) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run(typed('imagineer:status'))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^⊘$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^can't measure: no test command$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▱/ })).toBeUndefined()
  await ui.unmount()
})

test('after a reload, the pane still finds the results: it reads them from the session\'s folder, not a working directory the reload did not bind', async ($, on) => {
  // Only absolute paths in the session's folder answer, as after a hot reload of the module.
  const files: Record<string, string> = { '/work/app/.claude/imagineer/results.json': JSON.stringify(SAMPLE) }
  mock.clock(on)
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.stat', (_, e) => {
    if (!(e.path in files)) throw new Error('not found')
    return { value: { kind: 'file', size: files[e.path]!.length, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_, e) => {
    if (!(e.path in files)) throw new Error('not found')
    return { value: files[e.path]! }
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run(typed('imagineer:status'))
  expect(result.text).toContain('Imagineer: ✕ At risk')
})
