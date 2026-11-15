// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// The layout scan on projects laid out as Imagineer had not seen before (bench/layouts): each is
// made a repository of its own, then scanned. A new assumption about where things live fails here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detect } from './detect.mjs'
import { envReads, layoutLine, runsTests, scanLayout, trackedFiles } from './layout.mjs'
import { saveLayoutChoices } from './lib.mjs'
import { auditCounts, fromRepositoryTop, installCommand, mutationFromRepositoryTop } from './measure.mjs'

const LAYOUTS = join(dirname(fileURLToPath(import.meta.url)), '../../../../bench/layouts')

function repoFrom(t, name) {
  const repo = mkdtempSync(join(tmpdir(), `imagineer-layout-${name}-`))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  cpSync(join(LAYOUTS, name), repo, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('-c', 'user.name=dev', '-c', 'user.email=dev@example.test', 'commit', '-qm', name)
  return repo
}

const MUTABLE = '{js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte}'

test('a monorepo: Inspect asks which package is the app, then measures that one from the workspace root', t => {
  const repo = repoFrom(t, 'monorepo')
  const asked = detect(repo).layout
  assert.equal(asked.app, null)
  assert.deepEqual(asked.ask.candidates.map(c => c.dir), ['apps/web', 'packages/ui'])

  saveLayoutChoices(repo, { app: 'apps/web' })
  const facts = detect(repo)
  const { layout } = facts
  assert.deepEqual(layout.app, { dir: 'apps/web', from: 'you' })
  assert.equal(layout.installRoot, '.')
  assert.deepEqual({ ...layout.manager }, { name: 'pnpm', lockfile: 'pnpm-lock.yaml', version: '9.12.0', from: 'lockfile', modern: false })
  assert.equal(layout.scripts.test.name, 'test')
  assert.equal(layout.scripts.test.dir, 'apps/web')
  assert.equal(layout.scripts.typecheck.name, 'check-types')
  assert.equal(layout.runner, 'vitest')
  // The business rules in features/ and app/ are measured, not only lib/ (#28); config is not.
  assert.deepEqual(layout.sources.mutate, [`app/**/*.${MUTABLE}`, `features/**/*.${MUTABLE}`, `lib/**/*.${MUTABLE}`])
  assert.equal(facts.ci.runsTests, true)
  assert.deepEqual(facts.env.missing, [])
  assert.equal(facts.env.example, 'apps/web/.env.example')
  assert.equal(facts.docs.dir, 'docs')
  assert.equal(facts.typescript, true)
  assert.equal(layoutLine(layout), `App in apps/web/ · test strength on app/, features/, lib/`)
})

test('a Vue app: Yarn 4, GitLab CI, import.meta.env, .vue files, type-check and test:unit scripts', t => {
  const repo = repoFrom(t, 'vue-app')
  const facts = detect(repo)
  const { layout } = facts
  assert.deepEqual(layout.app, { dir: '.', from: 'only' })
  assert.equal(layout.manager.name, 'yarn')
  assert.equal(layout.manager.modern, true)
  assert.deepEqual(installCommand(layout.manager), ['yarn', 'install', '--immutable'])
  assert.equal(layout.scripts.test.name, 'test:unit')
  assert.equal(layout.scripts.typecheck.name, 'type-check')
  assert.deepEqual(layout.sources.mutate, [`src/**/*.${MUTABLE}`])
  assert.deepEqual(layout.sources.extensions, ['.ts', '.vue'])
  // __tests__ without .test in the name, and Cypress's .cy.ts, are tests.
  assert.deepEqual(facts.tests, { files: 3, needSetting: 1 })
  assert.deepEqual(facts.ci.providers, ['GitLab CI'])
  assert.equal(facts.ci.runsTests, true)
  assert.deepEqual(facts.env.styles, ['import.meta.env'])
  assert.deepEqual(facts.env.missing, ['VITE_API_URL'])
  assert.equal(facts.docs.level, 'thin')
})

test('an app in a subfolder with no package.json at the root: SvelteKit, CircleCI, docs in documentation/, AGENTS.md', t => {
  const repo = repoFrom(t, 'subfolder-app')
  const facts = detect(repo)
  const { layout } = facts
  assert.equal(facts.isNodeProject, true)
  assert.deepEqual(layout.app, { dir: 'web', from: 'only' })
  assert.equal(layout.installRoot, 'web')
  assert.equal(facts.lockfile, 'web/package-lock.json')
  assert.equal(layout.scripts.typecheck.name, 'check')
  assert.deepEqual(layout.sources.mutate, [`src/**/*.${MUTABLE}`])
  assert.match(layout.notes.join(' '), /cannot plant bugs in \.astro files/)
  // SvelteKit's $env modules; a tool in scripts/ is not the app's code.
  assert.deepEqual(facts.env.read, ['DATABASE_URL', 'POOL_SIZE'])
  assert.deepEqual(facts.env.missing, ['POOL_SIZE'])
  assert.deepEqual(facts.ci.providers, ['CircleCI'])
  assert.equal(facts.ci.runsTests, true)
  assert.equal(facts.docs.level, 'present')
  assert.equal(facts.docs.dir, 'documentation')
  assert.equal(facts.docs.agentFile, 'AGENTS.md')
})

test('committed build output is left out, and a source folder named build/ is not', t => {
  const repo = repoFrom(t, 'committed-output')
  const { layout } = detect(repo)
  assert.deepEqual(layout.outputs.map(o => o.dir).sort(), ['dist', 'lib'])
  assert.deepEqual(layout.sources.mutate, [`build/**/*.${MUTABLE}`, `src/**/*.${MUTABLE}`])
  assert.equal(layout.ci.runsTests, true)
})

test('the user can narrow test strength to the folders that hold their own code', t => {
  const repo = repoFrom(t, 'monorepo')
  saveLayoutChoices(repo, { app: 'apps/web', source: 'features,app' })
  const { layout } = detect(repo)
  assert.deepEqual(layout.sources.mutate, [`app/**/*.${MUTABLE}`, `features/**/*.${MUTABLE}`])
  assert.equal(layout.sources.from, 'you')
  assert.match(layout.summary.join('\n'), /Test strength measures: app\/, features\/ \(as you chose\)/)
  assert.throws(() => saveLayoutChoices(repo, { app: '../elsewhere' }), /inside the repository/)
})

test('only committed files are read: installed packages and ignored output are not source', t => {
  const repo = repoFrom(t, 'vue-app')
  writeFileSync(join(repo, 'stray.ts'), 'process.env.NOT_COMMITTED')
  const files = trackedFiles(repo)
  assert.ok(!files.includes('stray.ts'))
  assert.ok(files.includes('src/App.vue'))
})

test('no lockfile and no packageManager field: npm, shown as a default', () => {
  const files = ['package.json', 'src/a.ts']
  const read = path => (path === 'package.json' ? JSON.stringify({ scripts: { test: 'jest' } }) : '')
  const layout = scanLayout({ files, read })
  assert.equal(layout.manager.from, 'default')
  assert.match(layout.defaults[0], /^npm, because there is no lockfile/)
})

test('settings are read however the code reaches them', () => {
  const { names, styles } = envReads(
    "const { API_KEY, REGION: region = 'eu' } = process.env\nconst a = Bun.env.BUN_ONE\nconst b = import.meta.env['VITE_TWO']\nconst c = process.env?.OPTIONAL",
  )
  assert.deepEqual([...names].sort(), ['API_KEY', 'BUN_ONE', 'OPTIONAL', 'REGION', 'VITE_TWO'])
  assert.deepEqual([...styles].sort(), ['Bun.env', 'import.meta.env', 'process.env'])
})

test('CI runs the tests through a package manager, a task runner or the runner itself; installs and builds do not count', () => {
  assert.equal(runsTests('- run: pnpm --filter web test', 'vitest run'), true)
  assert.equal(runsTests('script:\n  - yarn test:unit', 'vitest run'), true)
  assert.equal(runsTests('- run: npx nx run-many -t test', 'jest'), true)
  assert.equal(runsTests('- run: npx vitest run --shard=1/3', 'vitest run'), true)
  assert.equal(runsTests('- run: npm ci\n- run: npm run build # then test later', 'vitest run'), false)
})

test('each package manager\'s audit is counted from its own output', () => {
  assert.deepEqual(auditCounts('pnpm', JSON.stringify({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 3, critical: 0 } } })), { critical: 0, high: 3, moderate: 2 })
  const yarn1 = ['{"type":"auditAdvisory","data":{}}', '{"type":"auditSummary","data":{"vulnerabilities":{"info":0,"low":0,"moderate":2,"high":3,"critical":1}}}'].join('\n')
  assert.deepEqual(auditCounts('yarn', yarn1), { critical: 1, high: 3, moderate: 2 })
  const yarn4 = ['{"value":"lodash","children":{"Severity":"high"}}', '{"value":"lodash","children":{"Severity":"moderate"}}'].join('\n')
  assert.deepEqual(auditCounts('yarn-modern', yarn4), { critical: 0, high: 1, moderate: 1 })
  const bun = `bun audit v1.2.21\n${JSON.stringify({ lodash: [{ severity: 'high' }, { severity: 'critical' }] })}`
  assert.deepEqual(auditCounts('bun', bun), { critical: 1, high: 1, moderate: 0 })
})

test('reports from the app\'s folder name files from the repository\'s top, as every other step does', () => {
  assert.deepEqual(fromRepositoryTop({ unused_files: [{ path: 'lib/a.ts' }], findings: [{ file: 'b.ts', line: 3 }] }, 'apps/web'), {
    unused_files: [{ path: 'apps/web/lib/a.ts' }],
    findings: [{ file: 'apps/web/b.ts', line: 3 }],
  })
  assert.deepEqual(Object.keys(mutationFromRepositoryTop({ files: { 'features/x.ts': {} } }, 'apps/web').files), ['apps/web/features/x.ts'])
  assert.deepEqual(mutationFromRepositoryTop({ files: { 'a.ts': {} } }, '.'), { files: { 'a.ts': {} } })
})
