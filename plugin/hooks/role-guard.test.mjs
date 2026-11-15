// Run: node --test plugin/hooks/role-guard.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decide, segments } from './role-guard.mjs'

const write = (agent, file) => decide({ agent_type: `imagineer:${agent}`, tool_name: 'Write', tool_input: { file_path: file } })
const bash = (agent, command) => decide({ agent_type: `imagineer:${agent}`, tool_name: 'Bash', tool_input: { command } })

test('Dev writes code but never tests', () => {
  assert.equal(write('dev', '/repo/src/approvals.ts'), null)
  assert.match(write('dev', '/repo/test/approval.test.ts'), /Dev never writes or edits tests/)
  assert.match(write('dev', '/repo/src/approvals.spec.ts'), /test file/)
  assert.match(write('dev', '/repo/src/__tests__/a.js'), /test file/)
})

test('QA writes tests only', () => {
  assert.equal(write('qa', '/repo/test/approval.test.ts'), null)
  assert.match(write('qa', '/repo/src/approvals.ts'), /QA writes only tests/)
})

test('the Architect and the attacker write only under .claude/imagineer/', () => {
  assert.equal(write('architect', '/repo/.claude/imagineer/build/approvals/spec.md'), null)
  assert.match(write('architect', '/repo/src/approvals.ts'), /outside \.claude\/imagineer\//)
  assert.equal(write('attacker', '/repo/.claude/imagineer/runs/3/attacks/test/a1.test.ts'), null)
  assert.match(write('attacker', '/repo/test/a1.test.ts'), /outside/)
  // A run's own records say where the copy is and what the attacks found: the scripts write those.
  assert.match(write('attacker', '/repo/.claude/imagineer/runs/3/copy.json'), /outside its run's attacks folder/)
  assert.match(write('attacker', '/repo/.claude/imagineer/runs/3/attacks.json'), /outside/)
  assert.match(write('attacker', '/repo/.claude/imagineer/runs/3/attacks/../copy.json'), /outside/)
})

test('Dev may commit but never push; the others never commit', () => {
  assert.equal(bash('dev', 'npm test && git add -A && git commit -m "Add approvals"'), null)
  assert.match(bash('dev', 'git push origin HEAD'), /runs git push/)
  assert.match(bash('qa', 'git commit -m tests'), /runs git commit/)
  assert.match(bash('architect', 'git -C /repo commit -m x'), /runs git commit/)
  assert.match(bash('dev', 'gh pr create'), /calls GitHub/)
  assert.match(bash('qa', 'echo hi; git reset --hard'), /runs git reset/)
  assert.match(bash('dev', 'FOO=1 env git push'), /git push/)
})

test('reading git and running tests is allowed for Build\'s agents', () => {
  for (const agent of ['dev', 'qa', 'architect']) {
    assert.equal(bash(agent, 'git diff main...HEAD -- src && git log --oneline -3 && node --test'), null)
  }
})

test('quoted text is not mistaken for a command', () => {
  assert.equal(bash('qa', 'node -e "console.log(\'git push\')"'), null)
  assert.deepEqual(segments('a "b; c" && d'), [['a', 'b; c'], ['d']])
})

test('the main session and other agents pass untouched', () => {
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'git push' } }), null)
  assert.equal(decide({ agent_type: 'general-purpose', tool_name: 'Write', tool_input: { file_path: '/repo/test/a.test.ts' } }), null)
})

test('as a hook it prints a deny decision and exits 0', t => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'role-guard.mjs')
  // Run from a scratch folder: a refusal is logged under the session's folder, never this repository.
  const cwd = mkdtempSync(join(tmpdir(), 'imagineer-guard-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const payload = JSON.stringify({ cwd, agent_type: 'imagineer:qa', tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' } })
  const result = spawnSync('node', [script], { input: payload, encoding: 'utf8', cwd })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
  const allowed = spawnSync('node', [script], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), encoding: 'utf8' })
  assert.equal(allowed.stdout, '')
})

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { plainCall } from './role-guard.mjs'

const ATTACK = join(dirname(fileURLToPath(import.meta.url)), '../skills/inspect/scripts/attack.mjs')

/** A repository the session runs in, with one run whose throwaway copy is elsewhere. */
function session(t) {
  const root = mkdtempSync(join(tmpdir(), 'guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'app')
  const copy = join(root, 'imagineer-copy')
  const out = join(repo, '.claude/imagineer/runs/1')
  mkdirSync(out, { recursive: true })
  mkdirSync(copy)
  writeFileSync(join(out, 'copy.json'), JSON.stringify({ path: copy, source: repo }))
  const attacker = (tool, input) => decide({ cwd: repo, agent_type: 'imagineer:attacker', tool_name: tool, tool_input: input })
  return { root, repo, copy, out, attacker, bash: command => attacker('Bash', { command }) }
}

test('a plain call is one program and its words: nothing chained, piped, redirected or expanded', () => {
  assert.deepEqual(plainCall(`node a.mjs run --title "a b" --run 'X=$Y npx vitest run a.test.ts | tail' `), ['node', 'a.mjs', 'run', '--title', 'a b', '--run', 'X=$Y npx vitest run a.test.ts | tail'])
  assert.deepEqual(plainCall('node a.mjs void --reason ""'), ['node', 'a.mjs', 'void', '--reason', ''])
  for (const not of ['a; b', 'a && b', 'a | b', 'a > f', 'a < f', 'a $(b)', 'a `b`', 'a "$(b)"', 'a "$HOME"', 'a $X', 'a\nb', '(a)', 'a "unclosed']) assert.equal(plainCall(not), null, not)
})

test("the attacker runs Imagineer's attack script and nothing else", t => {
  const { repo, copy, out, bash } = session(t)
  assert.equal(bash(`node ${ATTACK} run --out ${out} --round 1 --id A7 --category data --title "GET /../.env is refused" --file test/a7.test.ts --run 'npx vitest run test/a7.test.ts'`), null)
  assert.equal(bash(`node ${ATTACK} untested --out ${out} --round 1 --category data --what "saving twice (needs a database)"`), null)
  assert.equal(bash(`node ${ATTACK} list --out ${out}`), null)

  // How attacks once ran against a real database, and every other way to a database or an env file from a shell.
  for (const command of [
    `export $(grep '^DATABASE_URL=' ${repo}/.env.local | xargs) && npx vitest run a4.test.ts`,
    `node ${ATTACK} run --out ${out} --id A7 --run "DATABASE_URL=$(grep DATABASE_URL ${repo}/.env.local) npx vitest run a.test.ts"`,
    `S=${dirname(ATTACK)}; node $S/attack.mjs list --out ${out}`,
    `cd ${repo} && node ${ATTACK} list --out ${out}`,
    `node ${ATTACK} list --out ${out} > ${repo}/notes.txt`,
  ]) assert.match(bash(command), /more than one plain call/, command)
  for (const command of [
    'npx vitest run',
    'npx prisma migrate reset --force',
    'psql -h localhost -U postgres app_dev',
    'docker run -d -p 127.0.0.1:55432:5432 postgres:17',
    'cat .env.local',
    'grep -rn DATABASE_URL .',
    `ls ${copy}`,
    'git log --oneline -5',
    `node ${copy}/attack.mjs run`,
    `node --env-file=.env ${ATTACK} list`,
  ]) assert.match(bash(command), /something other than Imagineer's attack script/, command)
})

test("the attacker reads the copy, its run folder and Imagineer's scripts: never an env file, nothing else", t => {
  const { root, repo, copy, out, attacker } = session(t)
  assert.equal(attacker('Read', { file_path: join(copy, 'src/auth.ts') }), null)
  assert.equal(attacker('Read', { file_path: join(copy, '.env.example') }), null)
  assert.equal(attacker('Grep', { pattern: 'process.env.DATABASE_URL', path: copy }), null)
  assert.equal(attacker('Glob', { pattern: '**/*.test.ts', path: copy }), null)
  assert.equal(attacker('Glob', { pattern: `${copy}/src/**/*.ts` }), null)
  assert.equal(attacker('Read', { file_path: join(out, 'attacks.json') }), null)
  assert.equal(attacker('Read', { file_path: ATTACK }), null)
  // A copy whose run is kept in another folder: any copy in the temp folder.
  assert.equal(attacker('Read', { file_path: join(tmpdir(), 'imagineer-AbC123/src/auth.ts') }), null)

  for (const input of [{ file_path: join(repo, '.env.local') }, { file_path: join(copy, '.env') }, { file_path: join(out, 'attacks/.env.local') }]) {
    assert.match(attacker('Read', input), /is an env file, which the attacker never reads/)
  }
  assert.match(attacker('Glob', { pattern: '**/.env*', path: copy }), /is an env file/)
  assert.match(attacker('Glob', { pattern: '.env.*', path: copy }), /is an env file/)
  assert.match(attacker('Grep', { pattern: 'DATABASE_URL', glob: '.env.production.local', path: copy }), /is an env file/)

  const outside = /outside the throwaway copy, the run folder and Imagineer's scripts/
  assert.match(attacker('Read', { file_path: join(repo, 'src/auth.ts') }), outside)
  assert.match(attacker('Read', { file_path: join(repo, 'docker-compose.yml') }), outside)
  assert.match(attacker('Read', { file_path: join(root, 'other/notes.md') }), outside)
  assert.match(attacker('Read', { file_path: join(copy, '../app/src/auth.ts') }), outside)
  // No folder given means the session's own, which is the repository.
  assert.match(attacker('Grep', { pattern: 'requireRole' }), outside)
  assert.match(attacker('Glob', { pattern: 'src/**/*.ts' }), outside)
  assert.match(attacker('Glob', { pattern: `${repo}/src/**/*.ts` }), outside)
})

test('only the attacker is held to this; everyone else reads and runs as before', () => {
  for (const agent of [undefined, 'general-purpose', 'imagineer:dev', 'imagineer:qa']) {
    assert.equal(decide({ cwd: '/repo', agent_type: agent, tool_name: 'Read', tool_input: { file_path: '/repo/.env.local' } }), null, String(agent))
    assert.equal(decide({ cwd: '/repo', agent_type: agent, tool_name: 'Bash', tool_input: { command: 'DATABASE_URL=postgres://localhost/dev npm test' } }), null, String(agent))
  }
})

test('as a hook, a reach for an env file is refused and recorded apart from other refusals', t => {
  const { repo, copy } = session(t)
  const script = join(dirname(fileURLToPath(import.meta.url)), 'role-guard.mjs')
  const hook = (tool_name, tool_input) => spawnSync('node', [script], { input: JSON.stringify({ cwd: repo, agent_type: 'imagineer:attacker', tool_name, tool_input }), encoding: 'utf8', cwd: repo })
  assert.equal(JSON.parse(hook('Read', { file_path: join(repo, '.env.local') }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(JSON.parse(hook('Bash', { command: 'npx vitest run' }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(hook('Read', { file_path: join(copy, 'src/a.ts') }).stdout, '')
  const denials = readFileSync(join(repo, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(denials.map(d => [d.agent, d.tool, d.kind]), [['attacker', 'Read', 'database'], ['attacker', 'Bash', undefined]])
  assert.equal(denials[0].reason, '.env.local is an env file, which the attacker never reads')
  // Kept for the self-check, which the user may share: no path of theirs in it.
  assert.doesNotMatch(denials.map(d => d.reason).join(' '), new RegExp(repo))
})

import { symlinkSync } from 'node:fs'

test('a search may not name a place outside through its pattern, whatever folder it gives', t => {
  const { repo, copy, attacker } = session(t)
  const outside = /outside the throwaway copy/
  assert.match(attacker('Glob', { path: copy, pattern: `${repo}/**/*` }), outside)
  assert.match(attacker('Grep', { pattern: 'x', path: copy, glob: `${repo}/**/*.ts` }), outside)
  assert.equal(attacker('Grep', { pattern: `${repo}/src`, path: copy }), null) // what it searches for is not where it searches
  assert.match(attacker('Glob', { pattern: '{.env,.env.local}', path: copy }), /is an env file/)
  assert.match(attacker('Read', { file_path: join(copy, '.dev.vars') }), /is an env file/)
  // An empty folder is no folder: the search would run in the session's own, the repository.
  assert.match(attacker('Grep', { pattern: 'postgres', path: '' }), outside)
  assert.match(attacker('Glob', { pattern: '**/*', path: '' }), outside)
  assert.match(attacker('Read', { file_path: '' }), outside)
  // A pattern of hidden files could match an env file whatever it spells.
  assert.match(attacker('Glob', { pattern: '.e*', path: copy }), /never reads/)
  assert.equal(attacker('Glob', { pattern: '.github/workflows/*.yml', path: copy }), null)
})

test('the guard holds when the plugin is started through a link, and says nothing of where it is installed', t => {
  const { root, repo } = session(t)
  symlinkSync(dirname(fileURLToPath(import.meta.url)), join(root, 'hooks link'))
  const hook = command => spawnSync('node', [join(root, 'hooks link', 'role-guard.mjs')], { input: JSON.stringify({ cwd: repo, agent_type: 'imagineer:attacker', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', cwd: repo })
  assert.equal(JSON.parse(hook('cat .env.local').stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(JSON.parse(hook("export $(grep '^DATABASE_URL=' .env.local | xargs) && npx vitest run a4.test.ts").stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(JSON.parse(hook('git log').stdout).hookSpecificOutput.permissionDecision, 'deny')
  const denials = readFileSync(join(repo, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  // A refused command that names an env file or a database is flagged as a reach for one; any other is an ordinary refusal.
  assert.deepEqual(denials.map(d => d.kind), ['database', 'database', undefined])
  assert.doesNotMatch(denials.map(d => d.reason).join(' '), new RegExp(dirname(ATTACK)))
})
