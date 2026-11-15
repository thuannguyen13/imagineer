// Run: node --test plugin/hooks/run-guard.test.mjs
//
// While an Inspect run is in progress, the Lead's changes to the repository are asked of the user;
// the attacker does not finish a round without saying what it did not reach.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hookAnswer } from './role-guard.mjs'
import { stopProblem } from './attacker-stop.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function repo(t, status = 'running') {
  const root = mkdtempSync(join(tmpdir(), 'imagineer-run-guard-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, '.claude/imagineer/runs/1'), { recursive: true })
  if (status) writeFileSync(join(root, '.claude/imagineer/results.json'), JSON.stringify({ run: { command: 'inspect', status } }))
  return root
}
const lead = (cwd, tool, input) => hookAnswer({ cwd, tool_name: tool, tool_input: input })?.output ?? null

test('during a run, the Lead writing in the repository or changing it with git is asked of the user', t => {
  const cwd = repo(t)
  for (const [tool, input] of [
    ['Write', { file_path: join(cwd, 'src/app.ts') }],
    ['Edit', { file_path: join(cwd, 'CLAUDE.md') }],
    ['Bash', { command: 'git stash' }],
    ['Bash', { command: 'npm test && git commit -am wip' }],
    ['Bash', { command: 'git -C . checkout -- src' }],
  ]) {
    const answer = lead(cwd, tool, input)
    assert.equal(answer?.permissionDecision, 'ask', JSON.stringify(input))
    assert.match(answer.permissionDecisionReason, /Inspect never changes your repository/)
  }
})

test('during a run, the Lead works freely in Imagineer\'s folder and outside the repository, and reads git', t => {
  const cwd = repo(t)
  assert.equal(lead(cwd, 'Write', { file_path: join(cwd, '.claude/imagineer/runs/1/tests/test/q8.test.ts') }), null)
  assert.equal(lead(cwd, 'Write', { file_path: join(tmpdir(), 'imagineer-x/notes.md') }), null)
  assert.equal(lead(cwd, 'Bash', { command: 'git ls-files' }), null)
  assert.equal(lead(cwd, 'Bash', { command: 'git log --oneline -3' }), null)
  assert.equal(lead(cwd, 'Bash', { command: `node ${HERE}/../skills/inspect/scripts/grade.mjs --repo ${cwd} --out x` }), null)
})

test('with no run in progress, a finished one, or one stopped long ago, nothing is asked', t => {
  for (const status of [null, 'done', 'stopped']) {
    const cwd = repo(t, status)
    assert.equal(lead(cwd, 'Write', { file_path: join(cwd, 'src/app.ts') }), null, String(status))
  }
  const stale = repo(t)
  const old = (Date.now() - 13 * 60 * 60 * 1000) / 1000
  utimesSync(join(stale, '.claude/imagineer/results.json'), old, old)
  assert.equal(lead(stale, 'Write', { file_path: join(stale, 'src/app.ts') }), null)
})

test('other agents are not held to the Lead\'s rule', t => {
  const cwd = repo(t)
  assert.equal(hookAnswer({ cwd, agent_type: 'general-purpose', tool_name: 'Write', tool_input: { file_path: join(cwd, 'src/app.ts') } }), null)
})

test('as a hook, the Lead\'s change is asked, not refused, and not recorded as an agent stepping out of role', t => {
  const cwd = repo(t)
  const result = spawnSync('node', [join(HERE, 'role-guard.mjs')], { input: JSON.stringify({ cwd, tool_name: 'Write', tool_input: { file_path: join(cwd, 'src/app.ts') } }), encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'ask')
})

test('the attacker does not finish a round that does not say what it did not reach, and is held back only once', t => {
  const cwd = repo(t)
  const attacks = ledger => writeFileSync(join(cwd, '.claude/imagineer/runs/1/attacks.json'), JSON.stringify(ledger))
  const stop = (extra = {}) => stopProblem({ cwd, agent_type: 'imagineer:attacker', ...extra })
  assert.match(stop(), /No attack or part not attacked is recorded/)
  attacks({ attacks: [{ id: 'A1', round: 1, category: 'permissions', result: 'held' }], untested: {} })
  assert.match(stop(), /Round 1 does not say what it did not reach/)
  assert.equal(stop({ stop_hook_active: true }), null)
  attacks({ attacks: [{ id: 'A1', round: 1, category: 'permissions', result: 'held' }], untested: { 1: [] } })
  assert.equal(stop(), null)
  attacks({ attacks: [{ id: 'A7', round: 2, category: 'data', result: 'broke' }], untested: { 1: [{ category: 'data', what: 'exports' }] } })
  assert.match(stop(), /Round 2/)
  // Other agents stop as they like.
  assert.equal(stopProblem({ cwd, agent_type: 'imagineer:verifier' }), null)
  assert.equal(stopProblem({ cwd, agent_type: undefined }), null)
})
