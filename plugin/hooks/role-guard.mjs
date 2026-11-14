#!/usr/bin/env node
// PreToolUse settings hook: keeps each Imagineer agent to its role.
//
//   dev        writes code, never tests; may commit, never push or call GitHub
//   qa         writes tests only; never commits, pushes or calls GitHub
//   architect  writes only under .claude/imagineer/; never commits, pushes or calls GitHub
//   attacker   writes only under .claude/imagineer/; never commits, pushes or calls GitHub;
//              never reads an env file, sets a credential or names a database in a command
//
// Plugin agents ignore their own `hooks` frontmatter, so this runs for every
// matching tool call in the session and acts only when `agent_type` names one
// of these agents. Everyone else, the main session included, passes untouched.

import { readFileSync } from 'node:fs'
import { credentialProblem, envFileIn, recordDenial } from '../skills/inspect/scripts/lib.mjs'

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const GIT_WRITES = new Set(['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'reset', 'checkout', 'switch'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

export const isTestFile = path =>
  /(^|\/)(test|tests|__tests__|spec|e2e)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)

export const isImagineerFile = path => /(^|\/)\.claude\/imagineer\//.test(path)

/** The agent's short name: `imagineer:dev` and `dev` are both `dev`. */
export const role = agentType => (agentType ?? '').split(':').pop()

/** Splits a shell command into simple commands, keeping quoted text whole. */
export function segments(command) {
  const out = []
  let words = []
  let word = ''
  let quote = null
  const endWord = () => {
    if (word) words.push(word)
    word = ''
  }
  const endSegment = () => {
    endWord()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += c
    } else if (c === '"' || c === "'") quote = c
    else if (c === '\\' && i + 1 < command.length) word += command[++i]
    else if (/\s/.test(c)) endWord()
    else if (';&|()`\n'.includes(c) || (c === '$' && command[i + 1] === '(')) {
      if (c === '$') i += 1
      endSegment()
    } else word += c
  }
  endSegment()
  return out
}

function program(words) {
  let rest = words
  while (rest.length && (/^[A-Za-z_]\w*=/.test(rest[0]) || ['env', 'command', 'exec', 'sudo', 'nohup'].includes(rest[0]))) rest = rest.slice(1)
  return rest
}

function gitSubcommand(words) {
  const rest = words.slice(1)
  while (rest.length && rest[0].startsWith('-')) {
    const option = rest.shift()
    if (GIT_VALUE_OPTIONS.has(option) && rest.length) rest.shift()
  }
  return rest[0] ?? null
}

/** Why a shell command is outside the role, or null. */
export function blockedCommand(name, command) {
  for (const raw of segments(command)) {
    const words = program(raw)
    if (!words.length) continue
    const bin = words[0].split('/').pop()
    if (bin === 'gh') return 'calls GitHub'
    if (bin === 'git') {
      const sub = gitSubcommand(words)
      if (!GIT_WRITES.has(sub)) continue
      if (name === 'dev' && sub === 'commit') continue
      return `runs git ${sub}`
    }
  }
  return null
}

/** Why writing this file is outside the role, or null. */
export function blockedWrite(name, path) {
  if (name === 'dev' && isTestFile(path) && !isImagineerFile(path)) return 'is a test file, and Dev never writes or edits tests'
  if (name === 'qa' && !isTestFile(path) && !isImagineerFile(path)) return 'is not a test file, and QA writes only tests'
  if ((name === 'architect' || name === 'attacker') && !isImagineerFile(path)) return `is outside .claude/imagineer/, where the ${name} writes`
  return null
}

/**
 * Why a tool call reaches for credentials, or null. The attacker only: an attack that needs a
 * database that is not there is recorded as not attacked, never run against one the attacker found.
 * (That the app's code runs in the copy and nowhere else is attack.mjs's to enforce: this hook
 * cannot tell which folder a command runs in.)
 */
export function offLimits(payload) {
  if (role(payload.agent_type) !== 'attacker') return null
  const input = payload.tool_input ?? {}
  if (payload.tool_name === 'Bash') {
    const reason = credentialProblem(input.command)
    return reason ? `This command ${reason}.` : null
  }
  if (!READ_TOOLS.has(payload.tool_name)) return null
  // Read names a file; Grep and Glob a folder and a pattern of file names.
  const file = envFileIn(input.file_path) ?? envFileIn(input.path) ?? envFileIn(payload.tool_name === 'Glob' ? input.pattern : input.glob)
  return file ? `${file} is an env file.` : null
}

const OFF_LIMITS = 'The attacker never looks for credentials. If an attack needs a database or a service that is not there, record it as not attacked (attack.mjs untested).'

const ROLES = new Set(['dev', 'qa', 'architect', 'attacker'])

export function decide(payload) {
  const name = role(payload.agent_type)
  if (!ROLES.has(name)) return null
  const input = payload.tool_input ?? {}
  const outside = offLimits(payload)
  if (outside) return `${outside} ${OFF_LIMITS}`
  if (payload.tool_name === 'Bash') {
    const reason = blockedCommand(name, input.command ?? '')
    return reason ? `This command ${reason}. ${name === 'dev' ? 'Dev commits; the Lead pushes and opens the pull request.' : 'The Lead owns commits, pushes and GitHub.'}` : null
  }
  if (WRITE_TOOLS.has(payload.tool_name)) {
    const path = input.file_path ?? input.notebook_path ?? ''
    const reason = blockedWrite(name, path)
    return reason ? `${path} ${reason}.` : null
  }
  return null
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    process.exit(0)
  }
  const reason = decide(payload)
  if (reason) {
    // Keep a record for Imagineer's self-check: an agent stepping outside its role is a sign Imagineer went wrong.
    const outside = offLimits(payload)
    recordDenial(payload.cwd ?? process.cwd(), { agent: role(payload.agent_type), tool: payload.tool_name, ...(outside ? { kind: 'credentials', reason: outside } : { reason }) })
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
    )
  }
  process.exit(0)
}
