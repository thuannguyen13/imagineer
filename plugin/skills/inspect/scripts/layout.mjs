// Where things live in a repository: its packages and the app Inspect measures, that app's source
// and test files, its scripts by purpose, its package manager, how its code reads settings, its docs
// and agent instruction files, and its CI. Read from the files git tracks at the last commit, so
// installed packages and build output are never read as source, and a folder's name hides nothing.
// Read only. Where it cannot tell (several apps), it says what to ask; where it assumes, it says so.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

/**
 * The files of the last commit (`git ls-tree`), as paths from the repository's top: what Inspect's
 * copy holds. Links and submodules are left out. A folder that is not a git repository (a test's)
 * is walked instead, without installed packages or Imagineer's own files.
 */
export function trackedFiles(repo) {
  const tree = spawnSync('git', ['-C', repo, 'ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  if (tree.status === 0) {
    const files = []
    for (const entry of tree.stdout.split('\0')) {
      const tab = entry.indexOf('\t')
      if (tab === -1) continue
      const [mode, type] = entry.slice(0, tab).split(' ')
      if (type === 'blob' && mode !== '120000') files.push(entry.slice(tab + 1))
    }
    return files
  }
  const out = []
  const walk = dir => {
    for (const name of readdirSync(join(repo, dir))) {
      const path = dir ? `${dir}/${name}` : name
      if (['node_modules', '.git', '.stryker-tmp'].includes(name) || path === '.claude/imagineer') continue
      const stat = statSync(join(repo, path), { throwIfNoEntry: false })
      if (stat?.isDirectory()) walk(path)
      else if (stat?.isFile()) out.push(path)
    }
  }
  walk('')
  return out
}

/** Reads files of `root` by their path, once each; a file that cannot be read is empty. */
export function reader(root) {
  const seen = new Map()
  return path => {
    if (!seen.has(path)) {
      let text = ''
      try {
        text = readFileSync(join(root, path), 'utf8')
      } catch {}
      seen.set(path, text)
    }
    return seen.get(path)
  }
}

const json = text => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// tsconfig.json allows comments and trailing commas.
const jsonc = text => json(String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))

/** A workspace pattern (`apps/*`, `packages/**`) as a test on a folder path. */
function globTest(glob) {
  const text = glob.replace(/^\.\//, '').replace(/\/+$/, '')
  const pattern = text
    .split('/')
    .map(part => (part === '**' ? '.*' : part.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')))
    .join('/')
  return new RegExp(`^${pattern}$`)
}

const dirOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')
const under = (path, dir) => dir === '.' || path.startsWith(`${dir}/`)
const fromDir = (path, dir) => (dir === '.' ? path : path.slice(dir.length + 1))
const inDir = (dir, name) => (dir === '.' ? name : `${dir}/${name}`)

export const SOURCE = /\.(m|c)?[jt]sx?$|\.(vue|svelte|astro)$/
/** What Stryker can plant bugs in: `.astro` files it cannot. */
export const MUTABLE = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue', 'svelte']
const TEST_NAME = /\.(test|spec|cy|e2e)\.[^/]+$/
const TEST_DIRS = ['__tests__', 'test', 'tests', 'spec', 'e2e', 'cypress', 'playwright']
const TEST_DIR = new RegExp(`(^|/)(${TEST_DIRS.join('|')})/`)
/** Stand-ins for tests, at any depth, and code at a package's top that is not the app's: tools, samples, docs. */
const STAND_IN = /(^|\/)(fixtures|__fixtures__|__mocks__|mocks)\//
const SIDE_DIR = /^(scripts|examples?|docs|stories|bench|benchmarks?|tools)\//
const DOT_DIR = /(^|\/)\.[^/]+\//
const CONFIG = /(^|\/)([^/]+\.config\.[^/]+|\.[^/]+)$/
const DECLARATION = /\.d\.[cm]?ts$/
const STORY = /\.stories\.[^/]+$/

export const isTestFile = path => SOURCE.test(path) && (TEST_NAME.test(path) || TEST_DIR.test(path))

/** Globs that keep tests and what is not the app's code out of mutation, whatever the scope names. */
export const NOT_MUTATED = [
  '!**/*.{test,spec,cy,e2e}.*',
  `!**/{${TEST_DIRS.join(',')}}/**`,
  '!**/{__mocks__,mocks,fixtures,__fixtures__}/**',
  '!**/*.d.{ts,mts,cts}',
  '!**/*.config.*',
  '!**/*.stories.*',
]

const LOCKFILES = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

const DEFAULT_TEST = /no test specified/
const TEST_NAMES = ['test', 'test:unit', 'unit', 'test:ci', 'test:run', 'tests']
const RUNNER = /(?:^|[\s/])(vitest|jest|mocha|ava|tap|uvu|jasmine|playwright|cypress)(?=$|[\s@])|\bnode\s+(?:[^\s]+\s+)*--test\b/
const TYPECHECK_NAMES = ['typecheck', 'type-check', 'check-types', 'check:types', 'types:check', 'types', 'tsc', 'lint:types', 'lint:ts', 'ts:check', 'check']
const TYPECHECK_COMMAND = /\btsc\b[^&|;]*--noEmit|\b(vue-tsc|svelte-check|tsgo)\b|\bastro\s+check\b|\bnux[ti]\s+typecheck\b/
const NOT_A_CHECK = /build|dev|start|watch|serve|deploy|^pre|^post/
const EMITS = /--emitDeclarationOnly|--declaration\b/

/** The scripts of a package, by what they are for; each `{ name, command, dir }` or null. */
function scriptsOf(pkg, dir) {
  const scripts = pkg?.scripts ?? {}
  const entry = name => (name ? { name, command: scripts[name], dir } : null)
  const usable = name => typeof scripts[name] === 'string' && scripts[name].trim() !== '' && !DEFAULT_TEST.test(scripts[name])
  const names = Object.keys(scripts).filter(usable)
  const test =
    TEST_NAMES.find(usable) ??
    names.find(n => /^test(:|$)/.test(n) && !/e2e|watch|coverage|ui/.test(n)) ??
    names.find(n => RUNNER.test(scripts[n]) && !/e2e|watch|dev|coverage|ui/.test(n))
  const typecheck =
    TYPECHECK_NAMES.find(n => usable(n) && !EMITS.test(scripts[n]) && (n !== 'check' || TYPECHECK_COMMAND.test(scripts[n]))) ??
    names.find(n => !NOT_A_CHECK.test(n) && TYPECHECK_COMMAND.test(scripts[n]))
  return { test: entry(test), typecheck: entry(typecheck), lint: entry(usable('lint') ? 'lint' : null), build: entry(usable('build') ? 'build' : null) }
}

/** The folders a package's own settings say its build writes to, when tracked files are there. */
function outputDirs(pkg, dir, tsconfig, owned) {
  const found = new Map()
  const outDir = tsconfig?.compilerOptions?.outDir
  if (typeof outDir === 'string') found.set(outDir.replace(/^\.\//, '').replace(/\/+$/, '').split('/')[0], 'tsconfig outDir')
  const named = ['dist', 'out', 'build', 'coverage', 'storybook-static']
  const entries = []
  const collect = value => {
    if (typeof value === 'string') entries.push(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(collect)
  }
  ;['main', 'module', 'types', 'typings', 'bin', 'exports', 'browser'].forEach(key => collect(pkg?.[key]))
  for (const entry of entries) {
    const top = entry.replace(/^\.\//, '').split('/')[0]
    if (named.includes(top) && entry.includes('/')) found.set(top, `package.json points into it`)
  }
  for (const top of named) {
    if (found.has(top)) continue
    if (owned.some(f => fromDir(f, dir).startsWith(`${top}/`) && /\.(map|min\.js)$|(^|\/)(lcov\.info|coverage-final\.json)$/.test(f))) found.set(top, 'holds built or report files')
  }
  return [...found].filter(([top]) => top && top !== '.' && top !== '..').map(([top, why]) => ({ dir: inDir(dir, top), why }))
}

const ENV_ACCESS = [
  ['process.env', /process\.env(?:\?\.|\.)([A-Za-z_][A-Za-z0-9_]*)|process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g],
  ['import.meta.env', /import\.meta\.env(?:\?\.|\.)([A-Za-z_][A-Za-z0-9_]*)|import\.meta\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g],
  ['Bun.env', /Bun\.env\.([A-Za-z_][A-Za-z0-9_]*)/g],
  ['Deno.env', /Deno\.env\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\)/g],
]
const DESTRUCTURED = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(process\.env|import\.meta\.env|Bun\.env)\b/g
const SVELTEKIT_STATIC = /import\s*\{([^}]*)\}\s*from\s*['"]\$env\/static\/(?:private|public)['"]/g
const SVELTEKIT_DYNAMIC = /import\s*\{[^}]*\benv\b[^}]*\}\s*from\s*['"]\$env\/dynamic\/(?:private|public)['"]/

/** The settings a file reads, and how it reads them. */
export function envReads(text) {
  const names = new Set()
  const styles = new Set()
  for (const [style, pattern] of ENV_ACCESS) {
    for (const match of text.matchAll(pattern)) {
      names.add(match[1] ?? match[2])
      styles.add(style)
    }
  }
  const keep = list => list.split(',').map(part => part.trim().split(/\s*[:=]\s*|\s+as\s+/)[0]).filter(n => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !n.startsWith('...'))
  for (const match of text.matchAll(DESTRUCTURED)) {
    keep(match[1]).forEach(n => names.add(n))
    styles.add(match[2])
  }
  for (const match of text.matchAll(SVELTEKIT_STATIC)) {
    keep(match[1]).forEach(n => names.add(n))
    styles.add('$env (SvelteKit)')
  }
  if (SVELTEKIT_DYNAMIC.test(text)) {
    for (const match of text.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1])
    styles.add('$env (SvelteKit)')
  }
  return { names, styles }
}

/** Settings a platform or framework sets itself, which need no example file. */
export const platformSet = name =>
  ['NODE_ENV', 'CI', 'PORT', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'TZ'].includes(name) || /^(VERCEL|NETLIFY|RENDER|FLY|GITHUB|NEXT_RUNTIME|CF_PAGES|RAILWAY)(_|$)/.test(name)

// A test that runs only when a setting is present: `describe.skipIf(!process.env.X)`, `runIf(…)`, or a
// skip chosen by a setting (`process.env.X ? describe : describe.skip`).
const ENV = /(process\.env|import\.meta\.env)/
const SKIPS_BY_SETTING = new RegExp(`\\b(skipIf|runIf)\\(\\s*!?\\s*${ENV.source}|${ENV.source}[^;\\n]*\\.skip\\b|\\.skip\\b[^;\\n]*${ENV.source}`)

const CI_FILES = [
  ['GitHub Actions', /^\.github\/workflows\/[^/]+\.ya?ml$/],
  ['GitLab CI', /^\.gitlab-ci\.ya?ml$|^\.gitlab\/ci\/.+\.ya?ml$/],
  ['CircleCI', /^\.circleci\/config\.ya?ml$/],
  ['Bitbucket Pipelines', /^bitbucket-pipelines\.ya?ml$/],
  ['Azure Pipelines', /^azure-pipelines\.ya?ml$|^\.?azure-pipelines\/.+\.ya?ml$/],
  ['Jenkins', /(^|\/)Jenkinsfile$/],
  ['Travis CI', /^\.travis\.ya?ml$/],
  ['Buildkite', /^\.buildkite\/.+\.ya?ml$/],
  ['Drone', /^\.drone\.ya?ml$/],
]

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether CI text runs the tests: a test script through a package manager or a task runner, or the runner itself. */
export function runsTests(text, testCommand) {
  if (/\b(npm|pnpm|yarn|bun)\b[^\n#]*?\s(run\s+)?test(:[\w:-]+)?\b|\bnpm\s+t\b/.test(text)) return true
  if (/\b(turbo|nx|lerna|moon)\b[^\n#]*\btest\b/.test(text)) return true
  const runner = String(testCommand ?? '').trim().split(/\s+/)[0]
  return Boolean(runner) && !/^(npm|pnpm|yarn|bun|npx|turbo|nx)$/.test(runner) && new RegExp(`\\b(npx |pnpm exec |pnpm |yarn |bunx )?${escape(runner)}\\b`).test(text)
}

const DOC_DIRS = /(^|\/)(docs?|documentation|adrs?|decisions)\//
const DOC_FILE = /\.(md|mdx|markdown)$/i
const AGENT_FILES = /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|^\.github\/copilot-instructions\.md$|^\.github\/instructions\/.+\.md$|^\.cursorrules$|^\.cursor\/rules\/.+|^\.windsurfrules$|^\.clinerules(\/.+)?$/
const README = /(^|\/)readme(\.(md|mdx|markdown|txt))?$/i
// The README a framework's starter writes, left as it came: it says how to run the framework, not what the app is.
const STARTER = /bootstrapped with \[?`?create-|create-next-app|Astro Starter Kit|npm create astro|This template should help get you started|Getting Started with Create React App|Vite \+ (React|Vue|Svelte|TS|Preact|Lit)|npm (create|init) (svelte|vite|vue)|Look at the \[?Nuxt( 3)? documentation|Welcome to (your new )?(TanStack|Remix|Expo)|^# (React|Vue|Svelte) \+ (TypeScript|Vite)/im

/** A README that is a framework's starter text and never names the app (its package name): no docs about the app. */
export const isStarterReadme = (text, appName) => STARTER.test(text) && !(appName && new RegExp(`\\b${appName.replace(/^@[^/]+\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text.replace(/npm create \S+|create-[\w-]+/g, '')))

/**
 * The layout of a repository from its tracked files.
 *
 * @param {object} input
 * @param {string[]} input.files   tracked paths
 * @param {(path: string) => string} input.read   a file's text, '' when it cannot be read
 * @param {{ app?: string, docs?: string, source?: string[] }} [input.saved]   what the user said before, for this repository
 */
export function scanLayout({ files, read, saved = {} }) {
  const has = new Set(files)
  const defaults = []
  const notes = []

  // Packages: every package.json, with the workspaces their roots name.
  const packages = files
    .filter(f => /(^|\/)package\.json$/.test(f) && !f.split('/').includes('node_modules'))
    .map(file => ({ dir: dirOf(file), json: json(read(file)) }))
    .filter(p => p.json && typeof p.json === 'object')
  const workspaceGlobs = new Map()
  for (const p of packages) {
    const globs = []
    const field = p.json.workspaces
    if (Array.isArray(field)) globs.push(...field)
    else if (Array.isArray(field?.packages)) globs.push(...field.packages)
    const pnpmFile = inDir(p.dir, 'pnpm-workspace.yaml')
    if (has.has(pnpmFile)) {
      let inPackages = false
      for (const line of read(pnpmFile).split('\n')) {
        if (/^packages\s*:/.test(line)) inPackages = true
        else if (/^\S/.test(line)) inPackages = false
        else if (inPackages) {
          const item = line.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/)?.[1]
          if (item) globs.push(item)
        }
      }
    }
    const own = globs.filter(g => typeof g === 'string' && !g.startsWith('!')).map(g => globTest(inDir(p.dir, g.replace(/^\.\//, ''))))
    if (own.length) workspaceGlobs.set(p.dir, own)
  }
  const workspaceRootOf = dir => [...workspaceGlobs].find(([root, tests]) => root !== dir && under(dir, root) && tests.some(t => t.test(dir)))?.[0] ?? null
  const byDepth = [...packages].sort((a, b) => b.dir.length - a.dir.length)
  const ownerOf = file => byDepth.find(p => under(file, p.dir))?.dir ?? null

  // Build output a package's own settings point to, kept out of its source.
  const owned = new Map(packages.map(p => [p.dir, []]))
  for (const f of files) {
    const owner = ownerOf(f)
    if (owner !== null) owned.get(owner).push(f)
  }
  const outputs = packages.flatMap(p => outputDirs(p.json, p.dir, jsonc(read(inDir(p.dir, 'tsconfig.json'))), owned.get(p.dir)))
  const isOutput = f => outputs.some(o => under(f, o.dir))

  const isSource = f => {
    const owner = ownerOf(f)
    const own = owner === null ? f : fromDir(f, owner)
    return SOURCE.test(f) && !isTestFile(f) && !DOT_DIR.test(f) && !STAND_IN.test(f) && !SIDE_DIR.test(own) && !CONFIG.test(f) && !DECLARATION.test(f) && !STORY.test(f) && !isOutput(f) && !f.split('/').includes('node_modules')
  }
  const info = packages.map(p => {
    const mine = owned.get(p.dir)
    return {
      dir: p.dir,
      name: typeof p.json.name === 'string' ? p.json.name : null,
      kind: workspaceGlobs.has(p.dir) ? 'workspace root' : workspaceRootOf(p.dir) ? 'workspace' : p.dir === '.' ? 'root' : 'package',
      sourceFiles: mine.filter(isSource).length,
      testFiles: mine.filter(isTestFile).length,
      scripts: scriptsOf(p.json, p.dir),
      json: p.json,
    }
  })

  // The app: what Inspect measures. A folder of samples or fixtures is never a candidate.
  const sample = dir => dir.split('/').some(part => ['scripts', 'examples', 'example', 'docs', 'fixtures', '__fixtures__', 'bench', 'benchmarks', 'tools', ...TEST_DIRS].includes(part))
  const candidates = info.filter(p => p.kind !== 'workspace root' && !sample(p.dir) && (p.sourceFiles > 0 || p.scripts.test))
  let app = null
  let ask = null
  const wanted = saved.app ? saved.app.replace(/^\.\//, '').replace(/\/+$/, '') || '.' : null
  const chosen = wanted ? info.find(p => p.dir === wanted) : null
  if (saved.app && !chosen) notes.push(`You chose ${saved.app} as your app, but it has no package.json at this commit.`)
  // With no likely app, every package is a choice: a sample is never measured unasked.
  const choices = candidates.length ? candidates : info.filter(p => p.kind !== 'workspace root')
  if (chosen) app = { dir: chosen.dir, from: 'you' }
  else if (candidates.length === 1) app = { dir: candidates[0].dir, from: 'only' }
  else if (choices.length) {
    ask = {
      about: 'app',
      question: 'Which of these is your app?',
      candidates: choices.map(p => ({ dir: p.dir, name: p.name, sourceFiles: p.sourceFiles, testFiles: p.testFiles })),
    }
  } else if (info.length === 1) app = { dir: info[0].dir, from: 'only' }

  const appInfo = app ? info.find(p => p.dir === app.dir) : null
  const appDir = app?.dir ?? '.'

  // Where installing happens: the folder with the lockfile, at the app or above it, or the workspace root, or the app.
  const ancestors = []
  for (let dir = appDir; ; dir = dirOf(dir)) {
    ancestors.push(dir)
    if (dir === '.') break
  }
  const lockAt = ancestors.map(dir => ({ dir, lock: LOCKFILES.find(([name]) => has.has(inDir(dir, name))) })).find(x => x.lock)
  const workspaceRoot = workspaceRootOf(appDir)
  const installRoot = lockAt?.dir ?? workspaceRoot ?? appDir
  const rootJson = info.find(p => p.dir === installRoot)?.json ?? appInfo?.json ?? {}
  const declared = typeof rootJson.packageManager === 'string' ? rootJson.packageManager.match(/^(npm|pnpm|yarn|bun)@([^+\s]+)/) : null
  let manager
  if (lockAt) manager = { name: lockAt.lock[1], lockfile: inDir(lockAt.dir, lockAt.lock[0]), version: declared?.[1] === lockAt.lock[1] ? declared[2] : null, from: 'lockfile' }
  else if (declared) manager = { name: declared[1], lockfile: null, version: declared[2], from: 'packageManager' }
  else if (has.has(inDir(installRoot, 'pnpm-workspace.yaml'))) manager = { name: 'pnpm', lockfile: null, version: null, from: 'pnpm-workspace.yaml' }
  else {
    manager = { name: 'npm', lockfile: null, version: null, from: 'default' }
    if (info.length) defaults.push('npm, because there is no lockfile and package.json names no package manager')
  }
  // Yarn 2 and later (Berry) replaced `--frozen-lockfile` with `--immutable`.
  manager.modern =
    manager.name === 'yarn' &&
    (Number(manager.version?.split('.')[0]) >= 2 || has.has(inDir(installRoot, '.yarnrc.yml')) || (manager.lockfile !== null && /^\s*(#[^\n]*\n\s*)*__metadata:/m.test(read(manager.lockfile).slice(0, 2000))))

  // Scripts by purpose: the app's, else the install root's (a monorepo's `turbo run test`).
  const rootInfo = info.find(p => p.dir === installRoot)
  const scripts = {}
  for (const purpose of ['test', 'typecheck', 'lint', 'build']) scripts[purpose] = appInfo?.scripts[purpose] ?? (rootInfo && rootInfo !== appInfo ? rootInfo.scripts[purpose] : null) ?? null
  const appDeps = { ...rootInfo?.json.dependencies, ...rootInfo?.json.devDependencies, ...appInfo?.json.dependencies, ...appInfo?.json.devDependencies }
  const runnerMatch = scripts.test?.command.match(RUNNER)
  const runner = runnerMatch ? (runnerMatch[1] ?? 'node --test') : ['vitest', 'jest', 'mocha', 'ava', 'tap', 'uvu', 'jasmine'].find(n => n in appDeps) ?? null

  // The app's source and tests.
  const appFiles = app ? owned.get(app.dir) ?? [] : []
  const sources = appFiles.filter(isSource)
  const tests = appFiles.filter(isTestFile)
  const mutable = new RegExp(`\\.(${MUTABLE.join('|')})$`)
  const toMutate = sources.filter(f => mutable.test(f)).map(f => fromDir(f, appDir))
  // The user can narrow it to the folders that hold their app's own code.
  const keep = saved.source?.length ? f => saved.source.some(dir => f === dir || f.startsWith(`${dir}/`)) : () => true
  const dirs = [...new Set(toMutate.filter(f => f.includes('/') && keep(f)).map(f => f.split('/')[0]))].sort()
  const topFiles = toMutate.filter(f => !f.includes('/') && keep(f)).sort()
  const mutate = [...dirs.map(d => `${d}/**/*.{${MUTABLE.join(',')}}`), ...topFiles]
  const unmutable = [...new Set(sources.filter(f => !mutable.test(f)).map(f => posix.extname(f)))]
  if (unmutable.length) notes.push(`Test strength cannot plant bugs in ${unmutable.join(', ')} files, so they are not measured.`)

  // Settings the code reads, in every package's source (not tests, samples or tools).
  const allSources = files.filter(isSource)
  const envRead = new Set()
  const envStyles = new Set()
  for (const file of allSources) {
    const { names, styles } = envReads(read(file))
    names.forEach(n => envRead.add(n))
    styles.forEach(s => envStyles.add(s))
  }
  const examples = files.filter(f => /(^|\/)\.env(\.[\w-]+)*\.(example|sample|template)$/.test(f) && !STAND_IN.test(f) && !TEST_DIR.test(f))
  const example = [appDir, installRoot, '.'].map(dir => examples.find(f => dirOf(f) === dir)).find(Boolean) ?? examples[0] ?? null
  const documented = new Set(examples.flatMap(f => read(f).split('\n').map(line => line.trim().replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]).filter(Boolean)))
  const envMissing = [...envRead].filter(name => !documented.has(name) && !platformSet(name)).sort()

  // Tests anywhere that run only when a setting is present.
  const allTests = files.filter(isTestFile)
  const needSetting = allTests.filter(f => SKIPS_BY_SETTING.test(read(f)))

  // CI.
  const ciFiles = files.filter(f => CI_FILES.some(([, pattern]) => pattern.test(f)))
  const providers = CI_FILES.filter(([, pattern]) => ciFiles.some(f => pattern.test(f))).map(([name]) => name)
  const ciText = ciFiles.map(read).join('\n')

  // Docs and the files that instruct AI agents, wherever they are.
  const docFiles = files.filter(f => DOC_FILE.test(f) && DOC_DIRS.test(f) && !DOT_DIR.test(f) && !f.split('/').includes('node_modules') && !isOutput(f))
  const agentFiles = files.filter(f => AGENT_FILES.test(f))
  const readmes = files.filter(f => README.test(f) && (dirOf(f) === '.' || dirOf(f) === appDir))
  const readme = readmes.find(f => dirOf(f) === '.') ?? readmes[0] ?? null
  // A starter README left as the framework wrote it says nothing about the app.
  const appName = appInfo?.name ?? null
  const starters = readmes.filter(f => isStarterReadme(read(f), appName))
  const readmeText = readmes.filter(f => !starters.includes(f)).map(read).join('\n')
  const docsLevel = docFiles.length === 0 && agentFiles.length === 0 && readmeText.length < 400 ? (readme ? 'thin' : 'none') : 'present'
  const docDirCounts = new Map()
  for (const f of docFiles) {
    const match = f.match(DOC_DIRS)
    const dir = f.slice(0, match.index + match[0].length - 1)
    docDirCounts.set(dir, (docDirCounts.get(dir) ?? 0) + 1)
  }
  const docsDir = saved.docs ?? ([...docDirCounts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? null)
  const agentFile = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md', inDir(appDir, 'CLAUDE.md'), inDir(appDir, 'AGENTS.md')].find(f => has.has(f)) ?? agentFiles.find(f => /\.md$/.test(f)) ?? null

  const deps = appDeps
  return {
    packages: info.map(({ json: _json, scripts: _scripts, ...p }) => p),
    app,
    ask,
    installRoot,
    manager,
    scripts,
    runner,
    typescript: 'typescript' in deps || files.some(f => /(^|\/)tsconfig(\.[\w-]+)?\.json$/.test(f) && (under(f, appDir) || dirOf(f) === installRoot)),
    sources: { files: sources.length, dirs, topFiles, mutate, from: saved.source?.length ? 'you' : 'found', extensions: [...new Set(sources.map(f => posix.extname(f)))].sort() },
    tests: { files: tests.length, all: allTests.length, needSetting: needSetting.length, example: tests.find(f => !/\.(cy|e2e)\./.test(f)) ?? null, dirs: [...new Set(tests.map(f => fromDir(f, appDir).split('/')[0]).filter(d => TEST_DIRS.includes(d)))] },
    outputs,
    env: { styles: [...envStyles].sort(), read: [...envRead].sort(), missing: envMissing, example, examples },
    ci: { providers, files: ciFiles, runsTests: Boolean(scripts.test) && runsTests(ciText, scripts.test?.command) },
    docs: { level: docsLevel, readme, readmeIsStarter: Boolean(readme && starters.includes(readme)), agentDocs: agentFiles, agentFile, files: docFiles, dir: docsDir, dirFrom: saved.docs ? 'you' : docsDir ? 'found' : null },
    deps,
    defaults,
    notes,
  }
}

/** The layout in one short line, for the pane: which app, and the code test strength plants bugs in. */
export function layoutLine(layout) {
  if (!layout?.app) return ''
  const app = layout.app.dir === '.' ? '' : `App in ${layout.app.dir}/ · `
  const code = layout.sources.mutate.length ? [...layout.sources.dirs.map(d => `${d}/`), ...layout.sources.topFiles].join(', ') : 'no source files'
  const defaults = layout.defaults.length ? ` · default: ${layout.defaults.map(d => d.split(',')[0]).join(', ')}` : ''
  return `${app}test strength on ${code}${defaults}`
}

/** The layout in a few plain lines, for the user and the report: what Inspect worked from. */
export function describeLayout(layout) {
  const lines = []
  if (!layout.app) {
    if (layout.ask) lines.push(`Several apps: ${layout.ask.candidates.map(c => c.dir).join(', ')}. Inspect asks which one to measure.`)
    else lines.push('No package.json found.')
    return lines
  }
  const where = layout.app.dir === '.' ? 'the repository root' : layout.app.dir
  lines.push(`App: ${where}${layout.app.from === 'you' ? ' (as you chose)' : ''}${layout.installRoot !== layout.app.dir ? `, installed from ${layout.installRoot === '.' ? 'the root' : layout.installRoot}` : ''}.`)
  const m = layout.manager
  lines.push(`Package manager: ${m.name}${m.version ? ` ${m.version}` : ''} (${m.from === 'default' ? 'a default: no lockfile, and package.json names none' : m.from === 'lockfile' ? m.lockfile : m.from}).`)
  const s = layout.scripts
  lines.push(`Scripts: tests ${s.test ? `\`${s.test.name}\`${layout.runner ? ` (${layout.runner})` : ''}` : 'none'}, typecheck ${s.typecheck ? `\`${s.typecheck.name}\`` : 'none'}.`)
  lines.push(`Test strength measures: ${layout.sources.mutate.length ? [...layout.sources.dirs.map(d => `${d}/`), ...layout.sources.topFiles].join(', ') : 'nothing (no source files found)'}${layout.sources.from === 'you' ? ' (as you chose)' : ''}.`)
  if (layout.outputs.length) lines.push(`Left out as build output: ${layout.outputs.map(o => `${o.dir}/ (${o.why})`).join(', ')}.`)
  lines.push(`CI: ${layout.ci.providers.length ? layout.ci.providers.join(', ') : 'none found'}.`)
  lines.push(`Docs: ${layout.docs.dir ? `${layout.docs.dir}/` : 'no docs folder'}${layout.docs.agentFile ? `; agent instructions in ${layout.docs.agentFile}` : ''}.`)
  return [...lines, ...layout.notes]
}
