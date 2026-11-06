import { expect, mock, test } from 'claude-code/testing'

const RESULTS = '.claude/imagineer/results.json'

const SAMPLE = {
  schema: 1,
  imagineer: '0.2.0',
  scale: 1,
  run: { command: 'inspect', status: 'waiting', round: 2, commit: 'abc1234', bar: { met: false, missing: ['not yet 2 clean attack rounds'] } },
  overall: { state: 'failing', reason: 'Test strength and data safety are failing.' },
  dimensions: [
    {
      id: 'test-strength',
      name: 'Test strength',
      group: 'trust',
      state: 'failing',
      measured: 'default',
      summary: 'Tests catch 30% of deliberate breaks.',
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
    bodyColumns: 60,
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

type On = Parameters<Parameters<typeof test>[1]>[1]

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

  const result = await $.command.run({ command: 'imagineer:status', args: '' })

  expect(result.text).toBe('No Imagineer results in this repo yet. Run /imagineer:inspect to start.')
  expect(opened).toBe(false)
})

test('status opens the pane, which shows the grade on every surface', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const result = await $.command.run({ command: 'imagineer:status', args: '' })
  expect(result.text ?? '').toBe('')

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Overall/ }))?.text).toBe('✕ Overall: Failing')
    expect(await ui.find({ type: 'Text', text: /Can you trust it/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /: Test strength/ }))?.text).toBe('✕ Failing: Test strength')
    expect((await ui.find({ type: 'Text', text: /: Matches your intent/ }))?.text).toBe('? Not checked: Matches your intent')
    expect((await ui.find({ type: 'Text', text: /: Data safety/ }))?.text).toBe('! Weak: Data safety (claimed)')
    expect((await ui.find({ type: 'Text', text: /: Structure/ }))?.text).toBe('! Weak: Structure (⟳ stale)')
    expect(await ui.find({ type: 'Text', text: /Imagineer's defaults/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 questions are waiting/ })).toBeDefined()
    await ui.unmount()
  }
})

test('status answers in text where no pane can be drawn', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE) })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))

  const result = await $.command.run({ command: 'imagineer:status', args: '' })

  expect(result.text).toContain('Imagineer: ✕ Failing')
  expect(result.text).toContain('? Matches your intent: Not checked')
  expect(result.text).toContain('[claimed]')
  expect(result.text).toContain('3 questions waiting for you.')
})

test('a results file in another format is not shown as a grade', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify({ ...SAMPLE, schema: 2 }) })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const result = await $.command.run({ command: 'imagineer:status', args: '' })

  expect(result.text).toContain('uses format 2')
  expect(result.text).toContain('Run /imagineer:inspect again')
})

test('a broken results file is reported, not shown as a grade', async ($, on) => {
  files(on, { [RESULTS]: '{ not json' })

  const result = await $.command.run({ command: 'imagineer:status', args: '' })

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

  const result = await $.command.run({ command: 'imagineer:inspect', args: '' })
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
  await $.command.run({ command: 'imagineer:status', args: '' })

  disk.change(RESULTS, JSON.stringify({ ...SAMPLE, overall: { state: 'weak', reason: '' } }))
  await $.command.run({ command: 'imagineer:status', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Overall/ }))?.text).toBe('! Overall: Weak')
  await ui.unmount()
})

const LEDGER = JSON.stringify({
  questions: [
    { id: 'Q9', topic: 'wording', status: 'open', expectation: 'Error messages are plain.' },
    { id: 'Q6', topic: 'permissions', status: 'open', expectation: 'My guess (no docs found): test sign-in never works on the live app.' },
    { id: 'Q2', topic: 'data', status: 'answered', expectation: 'Answered already.' },
  ],
})

test('the pane lists open questions, most consequential first, and the stop bar', async ($, on) => {
  files(on, { [RESULTS]: JSON.stringify(SAMPLE), '.claude/imagineer/questions.json': LEDGER })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'imagineer:status', args: '' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const lines = (await ui.findAll({ type: 'Text', text: /^ {3}Q\d/ })).map(found => found.text)
  expect(lines).toEqual(['   Q6 (permissions): test sign-in never works on the live app.', '   Q9 (wording): Error messages are plain.'])
  expect(await ui.find({ type: 'Text', text: /Stop bar not met: not yet 2 clean attack rounds\./ })).toBeDefined()
  await ui.unmount()
})

test('the grade is marked stale once HEAD moves past the measured commit', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/refs/heads/main': 'def5678000000000000000000000000000000000\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run({ command: 'imagineer:status', args: '' })
  expect(result.text).toContain('⟳ Measured at abc1234; the code has changed since.')
  expect(result.text).toContain('[stale]')
})

test('the grade is current when HEAD is the measured commit, found in packed-refs', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/packed-refs': '# pack-refs with: peeled\nabc1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/heads/main\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run({ command: 'imagineer:status', args: '' })
  expect(result.text).not.toContain('changed since')
})

test('a worktree is followed to its own HEAD', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.git': 'gitdir: /repo/.git/worktrees/feature\n',
    '/repo/.git/worktrees/feature/HEAD': 'def5678000000000000000000000000000000000\n',
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run({ command: 'imagineer:status', args: '' })
  expect(result.text).toContain('the code has changed since')
})

test('the self-check’s flags about Imagineer itself are shown, with the way to report them', async ($, on) => {
  files(on, {
    [RESULTS]: JSON.stringify(SAMPLE),
    '.claude/imagineer/flags.json': JSON.stringify({ flags: [{ kind: 'grade-contradiction', said: 'Q8 was proven by a test, yet attack A7 broke the same behaviour.' }] }),
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'no-surface' } }))
  const result = await $.command.run({ command: 'imagineer:status', args: '' })
  expect(result.text).toContain('Imagineer may have gone wrong on its side:')
  expect(result.text).toContain('Q8 was proven by a test, yet attack A7 broke the same behaviour.')
  expect(result.text).toContain('/imagineer:feedback')
})

const DIALOG = (metadataSource?: string) => ({
  plugin: 'imagineer',
  component: 'AskUserQuestion',
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
