#!/usr/bin/env node
// PreToolUse settings hook: keeps each Imagineer agent to its role.
//
//   attacker   runs one thing, Imagineer's attack script; reads only the throwaway copy, its
//              run folder and Imagineer's scripts, never an env file; writes only its attack
//              tests. So the app's code runs in one place: the copy, through attack.mjs.
//   verifier   reads where the attacker reads; runs only Imagineer's questions script to record
//              its ruling, and the attack script's read-only steps; writes nothing.
//
// Plugin agents ignore their own `hooks` frontmatter, so this runs for every matching tool call in
// the session and acts only on Imagineer's own agents: Claude Code names a plugin's agent with the
// plugin's prefix (`imagineer:attacker`), so a user's own `attacker`, or another plugin's, passes untouched.
//
// The main session (the Lead) is held to one rule, only while an Inspect run is in progress in its
// folder: Inspect never changes the repository, so writing a file there outside .claude/imagineer/,
// or a git command that writes, asks the user first. Adding proven tests or docs the user said yes
// to is such a write, and the user confirms it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
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
const QUESTIONS_SCRIPT = join(PLUGIN, 'skills', 'inspect', 'scripts', 'questions.mjs')
const GIT_WRITES = new Set(['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull', 'reset', 'checkout', 'switch'])
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])


/** An attack test, where the attacker writes them: a run's `attacks` folder. Nothing else of a run is the attacker's to write. */
export const isAttackTest = path => /(^|\/)\.claude\/imagineer\/runs\/[^/]+\/attacks\/./.test(path)

/** Imagineer's agent's short name (`imagineer:attacker` is `attacker`); empty for every other agent. */
export const role = agentType => (/^imagineer:/.test(agentType ?? '') ? agentType.slice('imagineer:'.length) : '')

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
  return isAttackScript ? null : "runs something other than Imagineer's attack script (node <the scripts folder you were given>/attack.mjs run | void | untested | list | files | search). List the copy's files with its files step and search them with its search step"
}

/**
 * Why the verifier may not run this command, or null. It judges code it reads; the only things it
 * runs are recording its ruling (questions.mjs verdict) and listing or searching the copy (attack.mjs
 * files, search, list). It runs none of the app's code.
 */
export function blockedVerifierCommand(command, cwd = null) {
  const words = plainCall(command)
  if (!words) return 'is more than one plain call. Give one command with every path written out: no $, pipes, && or redirects'
  const script = words[0] === 'node' && words[1] ? real(resolve(cwd ?? '/', words[1])) : null
  if (script === real(QUESTIONS_SCRIPT) && words[2] === 'verdict') return null
  if (script === real(ATTACK_SCRIPT) && ['files', 'search', 'list'].includes(words[2])) return null
  return "runs something other than recording a verdict (node <the scripts folder you were given>/questions.mjs verdict …) or looking around the copy (attack.mjs files | search | list)"
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

/**
 * Why the attacker may not read or search this, or null; `envFile` says the place it named is an
 * env file, which is how an attack once got a real database's address. (Env files in the copy are
 * the copy's own: their database settings point nowhere.)
 */
export function blockedAttackerRead(toolName, input, cwd = null) {
  // Read names a file; Grep and Glob a folder (the session's own when none is given) and a pattern of file names.
  // Every place the call names must be one the attacker reads: the folder, and a pattern that starts at the root.
  const pattern = toolName === 'Glob' ? input.pattern : input.glob
  const rooted = pattern?.startsWith('/') ? [pattern.split(/[*?[{]/)[0]] : []
  // An empty path is no path: the tool then searches the session's own folder.
  const places = [input.file_path || input.path || (rooted.length ? null : cwd || '.'), ...rooted].filter(Boolean)
  if (places.length && places.every(place => attackerMayRead(place, cwd))) return null
  const envFile = Boolean(envFileIn(input.file_path) ?? envFileIn(input.path) ?? envFileIn(pattern))
  return { envFile, reason: "is outside the throwaway copy, the run folder and Imagineer's scripts, where Imagineer's agents read. Give the copy's path" }
}

const ROLES = new Set(['attacker', 'verifier'])

// A run whose results were last written longer ago than this was stopped, not paused: it holds nothing.
const RUN_FRESH_MS = 12 * 60 * 60 * 1000
const LEAD_GIT_WRITES = new Set([...GIT_WRITES, 'add', 'stash', 'clean', 'restore', 'tag', 'apply', 'mv', 'rm'])

/** The Inspect run in progress in a folder: its results say running or waiting, written recently. */
export function activeRun(cwd, now = Date.now()) {
  if (!cwd) return null
  const file = join(cwd, '.claude', 'imagineer', 'results.json')
  try {
    if (now - statSync(file).mtimeMs > RUN_FRESH_MS) return null
    const run = JSON.parse(readFileSync(file, 'utf8')).run
    return run?.command === 'inspect' && ['running', 'waiting'].includes(run.status) ? run : null
  } catch {
    return null
  }
}

/** What the Lead is about to change in the repository during a run, in plain words, or null. */
export function leadChange(payload) {
  const cwd = payload.cwd
  if (!activeRun(cwd)) return null
  const input = payload.tool_input ?? {}
  if (WRITE_TOOLS.has(payload.tool_name)) {
    const target = resolve(cwd, input.file_path ?? input.notebook_path ?? '')
    if (isUnder(target, cwd) && !isUnder(target, join(cwd, '.claude', 'imagineer'))) return `writes ${target.slice(cwd.length + 1)} in the repository`
    return null
  }
  if (payload.tool_name === 'Bash') {
    for (const raw of segments(input.command ?? '')) {
      const words = program(raw)
      if (words[0]?.split('/').pop() !== 'git') continue
      const sub = gitSubcommand(words)
      if (LEAD_GIT_WRITES.has(sub)) return `runs git ${sub}, which changes the repository`
    }
  }
  return null
}

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
  if (name === 'verifier' && payload.tool_name === 'Bash') {
    const command = input.command ?? ''
    const reason = blockedVerifierCommand(command, payload.cwd)
    return reason ? { reason: `This command ${reason}.`, database: Boolean(envFileIn(command) || databaseProblem(command)) } : null
  }
  if (name === 'verifier' && WRITE_TOOLS.has(payload.tool_name)) return { reason: 'The verifier writes nothing: record a ruling with questions.mjs verdict.', database: false }
  if ((name === 'attacker' || name === 'verifier') && READ_TOOLS.has(payload.tool_name)) {
    const blocked = blockedAttackerRead(payload.tool_name, input, payload.cwd)
    if (!blocked) return null
    if (!blocked.envFile) return { reason: `That ${blocked.reason}.`, database: false }
    return { reason: `That ${blocked.reason}. If an attack needs a database that is not there, record it as not attacked (attack.mjs untested).`, database: true, record: 'an env file outside the copy' }
  }
  if (name === 'attacker' && WRITE_TOOLS.has(payload.tool_name)) {
    const path = input.file_path ?? input.notebook_path ?? ''
    // Not the run's own records (the copy's path, the results of attacks): those are the scripts' to write.
    return isAttackTest(resolve('/', path)) ? null : { reason: `${path} is outside its run's attacks folder (.claude/imagineer/runs/<n>/attacks/), where the attacker writes.`, database: false }
  }
  return null
}

export const decide = payload => judge(payload)?.reason ?? null

/** The hook's answer: refused for an agent outside its role, asked of the user for the Lead's change during a run. */
export function hookAnswer(payload) {
  const verdict = judge(payload)
  if (verdict) return { verdict, output: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } }
  if (payload.agent_type) return null
  const change = leadChange(payload)
  if (!change) return null
  return {
    verdict: null,
    output: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `An Inspect run is in progress, and Inspect never changes your repository; this ${change}. Allow it only if you asked for it, such as adding the proven tests or docs.`,
    },
  }
}

if (isMain(import.meta.url)) {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    process.exit(0)
  }
  const answer = hookAnswer(payload)
  if (answer?.verdict) {
    // Keep a record for Imagineer's self-check: an agent stepping outside its role is a sign Imagineer went wrong.
    const { verdict } = answer
    recordDenial(payload.cwd ?? process.cwd(), { agent: role(payload.agent_type), tool: payload.tool_name, ...(verdict.database ? { kind: 'database' } : {}), reason: verdict.record ?? verdict.reason })
  }
  if (answer) process.stdout.write(JSON.stringify({ hookSpecificOutput: answer.output }))
  process.exit(0)
}
