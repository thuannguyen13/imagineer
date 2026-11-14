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

test('reading git and running tests is allowed for everyone', () => {
  for (const agent of ['dev', 'qa', 'architect', 'attacker']) {
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

import { mkdirSync, readFileSync } from 'node:fs'

const attacker = (tool, input) => decide({ agent_type: 'imagineer:attacker', tool_name: tool, tool_input: input })

test('the attacker never reads an env file, in the repository or in the copy', () => {
  assert.match(attacker('Read', { file_path: '/repo/.env.local' }), /\.env\.local is an env file/)
  assert.match(attacker('Read', { file_path: '/tmp/imagineer-x/.env' }), /is an env file/)
  assert.match(attacker('Glob', { pattern: '**/.env*', path: '/tmp/imagineer-x' }), /is an env file/)
  assert.match(attacker('Grep', { pattern: 'DATABASE_URL', glob: '.env.production.local' }), /is an env file/)
  assert.match(attacker('Read', { file_path: '/repo/.env.local' }), /record it as not attacked/)

  assert.equal(attacker('Read', { file_path: '/tmp/imagineer-x/src/auth.ts' }), null)
  assert.equal(attacker('Read', { file_path: '/tmp/imagineer-x/.env.example' }), null)
  assert.equal(attacker('Grep', { pattern: 'process.env.DATABASE_URL', path: '/tmp/imagineer-x' }), null)
  assert.equal(attacker('Glob', { pattern: '**/*.test.ts' }), null)
})

test('the attacker never brings a credential or a database into a command', () => {
  const bash = command => attacker('Bash', { command })
  // How attacks once ran against a real database, and the same through attack.mjs.
  assert.match(bash("export $(grep '^DATABASE_URL=' /repo/.env.local | xargs) && npx vitest run a4.test.ts"), /reads an env file \(\.env\.local\)/)
  assert.match(bash('cd /tmp/imagineer-x && DATABASE_URL=postgresql://app:pw@127.0.0.1:5432/app npx vitest run a.test.ts'), /sets DATABASE_URL/)
  assert.match(bash('node attack.mjs run --out /repo/.claude/imagineer/runs/1 --id A7 --run "DATABASE_URL=postgresql://x npx vitest run a.test.ts"'), /sets DATABASE_URL/)
  assert.match(bash('docker run -d -e POSTGRES_PASSWORD=x -p 127.0.0.1:55432:5432 postgres:17'), /sets POSTGRES_PASSWORD/)
  assert.match(bash('psql postgres://localhost/dev -c "select 1"'), /names a database/)

  // What attackers do all day: work in the copy, read the repository's history, run Imagineer's scripts.
  for (const fine of [
    'cd /tmp/imagineer-x && npx vitest run test/attacks/a7.test.ts',
    'cd /repo; S=/plugins/imagineer/skills/inspect/scripts; node $S/attack.mjs void --out .claude/imagineer/runs/3 --id A7 --reason "wrong import"',
    'git -C /repo log --oneline -40',
    'node attack.mjs run --out /repo/.claude/imagineer/runs/1 --round 1 --id A7 --category data --title "double submit" --file test/a7.test.ts --run "npx vitest run test/a7.test.ts"',
    'node attack.mjs untested --out /repo/.claude/imagineer/runs/1 --round 1 --category data --what "saving twice (needs a database)"',
  ]) assert.equal(bash(fine), null, fine)
})

test('only the attacker is kept from env files and credentials', () => {
  for (const agent of [undefined, 'general-purpose', 'imagineer:dev', 'imagineer:qa']) {
    assert.equal(decide({ agent_type: agent, tool_name: 'Read', tool_input: { file_path: '/repo/.env.local' } }), null, String(agent))
    assert.equal(decide({ agent_type: agent, tool_name: 'Bash', tool_input: { command: 'DATABASE_URL=postgres://localhost/dev npm test' } }), null, String(agent))
  }
})

test('as a hook, a reach for credentials is refused and recorded as one', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'imagineer-guard-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const script = join(dirname(fileURLToPath(import.meta.url)), 'role-guard.mjs')
  const hook = (tool_name, tool_input) => spawnSync('node', [script], { input: JSON.stringify({ cwd, agent_type: 'imagineer:attacker', tool_name, tool_input }), encoding: 'utf8', cwd })
  assert.equal(JSON.parse(hook('Read', { file_path: join(cwd, '.env.local') }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(JSON.parse(hook('Bash', { command: 'git push' }).stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(hook('Read', { file_path: join(cwd, 'src/a.ts') }).stdout, '')
  const denials = readFileSync(join(cwd, '.claude/imagineer/denials.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(denials.map(d => [d.agent, d.tool, d.kind, d.reason]), [
    ['attacker', 'Read', 'credentials', '.env.local is an env file.'],
    ['attacker', 'Bash', undefined, 'This command runs git push. The Lead owns commits, pushes and GitHub.'],
  ])
})
