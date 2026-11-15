#!/usr/bin/env node
// PreToolUse settings hook: keeps each Imagineer agent to its role.
//
//   dev        writes code, never tests; may commit, never push or call GitHub
//   qa         writes tests only; never commits, pushes or calls GitHub
//   architect  writes only under .claude/imagineer/; never commits, pushes or calls GitHub
//   attacker   runs one thing, Imagineer's attack script; reads only the throwaway copy, its
//              run folder and Imagineer's scripts, never an env file; writes only its attack
//              tests. So the app's code runs in one place: the copy, through attack.mjs.
//
// Plugin agents ignore their own `hooks` frontmatter, so this runs for every
// matching tool call in the session and acts only when `agent_type` names one
// of these agents. Everyone else, the main session included, passes untouched.

import { readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { databaseProblem, envFileIn, isMain, isUnder, plainCall, real, recordDenial } from '../skills/inspect/scripts/lib.mjs'

export { plainCall }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
// Imagineer's own files, wherever the plugin is installed.
const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ATTACK_SCRIPT = join(PLUGIN, 'skills', 'inspect', 'scripts', 'attack.mjs')
const GIT_WRITES = new Set(['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'reset', 'checkout', 'switch'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

export const isTestFile = path =>
  /(^|\/)(test|tests|__tests__|spec|e2e)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)

export const isImagineerFile = path => /(^|\/)\.claude\/imagineer\//.test(path)

/** An attack test, where the attacker writes them: a run's `attacks` folder. Nothing else of a run is the attacker's to write. */
export const isAttackTest = path => /(^|\/)\.claude\/imagineer\/runs\/[^/]+\/attacks\/./.test(path)

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
  if (name === 'architect' && !isImagineerFile(path)) return 'is outside .claude/imagineer/, where the architect writes'
  // Not the run's own records (the copy's path, the results of attacks): those are the scripts' to write.
  if (name === 'attacker' && !isAttackTest(resolve('/', path))) return "is outside its run's attacks folder (.claude/imagineer/runs/<n>/attacks/), where the attacker writes"
  return null
}

/**
 * Why the attacker may not run this command, or null. It runs Imagineer's attack script and nothing
 * else: a shell cannot be kept in the copy or away from a database by reading what it is asked to
 * run, so the app's code runs only where attack.mjs runs it.
 */
export function blockedAttackerCommand(command, cwd = null) {
  const words = plainCall(command)
  if (!words) return 'is more than one plain call. Give one command with every path written out: no $, pipes, && or redirects, and the --run command in single quotes'
  const isAttackScript = words[0] === 'node' && words[1] && real(resolve(cwd ?? '/', words[1])) === real(ATTACK_SCRIPT)
  // Said without the script's path, which holds the user's home folder: the reason is kept for the self-check.
  return isAttackScript ? null : "runs something other than Imagineer's attack script (node <the scripts folder you were given>/attack.mjs run | void | untested | list). Read and search with Read, Grep and Glob"
}

/** The throwaway copies of the runs kept in the session's folder, as each run recorded its own. */
function copiesOf(cwd) {
  if (!cwd) return []
  const runs = join(cwd, '.claude', 'imagineer', 'runs')
  try {
    return readdirSync(runs).flatMap(run => {
      try {
        const path = JSON.parse(readFileSync(join(runs, run, 'copy.json'), 'utf8')).path
        return typeof path === 'string' && basename(path).startsWith('imagineer-') ? [path] : []
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/** Whether the attacker may read here: a throwaway copy, Imagineer's folder in a repository, or Imagineer's own scripts. */
function attackerMayRead(path, cwd) {
  const target = real(resolve(cwd ?? '/', path))
  if (/(^|\/)\.claude\/imagineer(\/|$)/.test(target) || isUnder(target, PLUGIN)) return true
  if (copiesOf(cwd).some(copy => isUnder(target, copy))) return true
  // A copy whose run is kept elsewhere (Inspect was given another folder): every copy is made in the temp folder under this name.
  const temp = real(tmpdir())
  return isUnder(target, temp) && target.slice(temp.length + 1).startsWith('imagineer-')
}

/** Why the attacker may not read or search this, or null; `envFile` says the reason is an env file. */
export function blockedAttackerRead(toolName, input, cwd = null) {
  // Read names a file; Grep and Glob a folder (the session's own when none is given) and a pattern of file names.
  const pattern = toolName === 'Glob' ? input.pattern : input.glob
  const file = envFileIn(input.file_path) ?? envFileIn(input.path) ?? envFileIn(pattern)
  if (file) return { envFile: true, reason: `${file} is an env file, which the attacker never reads` }
  // Every place the call names must be one the attacker reads: the folder, and a pattern that starts at the root.
  const rooted = [toolName === 'Glob' ? input.pattern : null, input.glob].filter(p => p?.startsWith('/')).map(p => p.split(/[*?[{]/)[0])
  const places = [input.file_path ?? input.path ?? (rooted.length ? null : (cwd ?? '.')), ...rooted].filter(Boolean)
  if (places.every(place => attackerMayRead(place, cwd))) return null
  return { envFile: false, reason: "is outside the throwaway copy, the run folder and Imagineer's scripts, where the attacker reads. Give the copy's path" }
}

const ROLES = new Set(['dev', 'qa', 'architect', 'attacker'])

/** Why a tool call is outside the agent's role, and whether it was a reach for a database; null when it is fine. */
export function judge(payload) {
  const name = role(payload.agent_type)
  if (!ROLES.has(name)) return null
  const input = payload.tool_input ?? {}
  if (name === 'attacker' && payload.tool_name === 'Bash') {
    const command = input.command ?? ''
    const reason = blockedAttackerCommand(command, payload.cwd)
    if (!reason) return null
    // A refused command that names an env file or a database is how an attack once ran against a real one: flagged apart.
    return { reason: `This command ${reason}.`, database: Boolean(envFileIn(command) || databaseProblem(command)) }
  }
  if (name === 'attacker' && READ_TOOLS.has(payload.tool_name)) {
    const blocked = blockedAttackerRead(payload.tool_name, input, payload.cwd)
    if (!blocked) return null
    if (!blocked.envFile) return { reason: `That ${blocked.reason}.`, database: false }
    return { reason: `${blocked.reason}. If an attack needs a database that is not there, record it as not attacked (attack.mjs untested).`, database: true, record: blocked.reason }
  }
  if (payload.tool_name === 'Bash') {
    const reason = blockedCommand(name, input.command ?? '')
    return reason ? { reason: `This command ${reason}. ${name === 'dev' ? 'Dev commits; the Lead pushes and opens the pull request.' : 'The Lead owns commits, pushes and GitHub.'}`, database: false } : null
  }
  if (WRITE_TOOLS.has(payload.tool_name)) {
    const path = input.file_path ?? input.notebook_path ?? ''
    const reason = blockedWrite(name, path)
    return reason ? { reason: `${path} ${reason}.`, database: false } : null
  }
  return null
}

export const decide = payload => judge(payload)?.reason ?? null

if (isMain(import.meta.url)) {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    process.exit(0)
  }
  const verdict = judge(payload)
  if (verdict) {
    // Keep a record for Imagineer's self-check: an agent stepping outside its role is a sign Imagineer went wrong.
    recordDenial(payload.cwd ?? process.cwd(), { agent: role(payload.agent_type), tool: payload.tool_name, ...(verdict.database ? { kind: 'database' } : {}), reason: verdict.record ?? verdict.reason })
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }),
    )
  }
  process.exit(0)
}
