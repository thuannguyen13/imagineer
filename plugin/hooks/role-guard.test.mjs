// Run: node --test plugin/hooks/role-guard.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

test('as a hook it prints a deny decision and exits 0', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'role-guard.mjs')
  const payload = JSON.stringify({ agent_type: 'imagineer:qa', tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' } })
  const result = spawnSync('node', [script], { input: payload, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny')
  const allowed = spawnSync('node', [script], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }), encoding: 'utf8' })
  assert.equal(allowed.stdout, '')
})
