#!/usr/bin/env node
// SubagentStop hook: Inspect's attacker does not finish until its latest round says what it did not
// reach (attack.mjs untested, or --none). A round that ends without it would read as covering every
// part of the app it never tried. Acts on the attacker only; once per stop, so it can never trap it.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { unfinishedRound, loadAttacks } from '../skills/inspect/scripts/attack.mjs'
import { isMain } from '../skills/inspect/scripts/lib.mjs'
import { role } from './role-guard.mjs'

/** The latest run folder in a repository's Imagineer folder, or null. */
export function latestRun(cwd) {
  const runs = join(cwd, '.claude', 'imagineer', 'runs')
  try {
    const names = readdirSync(runs).filter(n => /^\d+$/.test(n)).sort((a, b) => Number(b) - Number(a))
    return names.length ? join(runs, names[0]) : null
  } catch {
    return null
  }
}

/** Why the attacker may not stop yet, or null. */
export function stopProblem(payload) {
  if (role(payload.agent_type) !== 'attacker' || payload.stop_hook_active) return null
  const run = payload.cwd ? latestRun(payload.cwd) : null
  return run ? unfinishedRound(loadAttacks(run)) : null
}

if (isMain(import.meta.url)) {
  let payload = {}
  try {
    payload = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    process.exit(0)
  }
  const reason = stopProblem(payload)
  if (reason) process.stdout.write(JSON.stringify({ decision: 'block', reason }))
  process.exit(0)
}
