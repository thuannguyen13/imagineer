#!/usr/bin/env node
// The user's own settings for a repository, kept in .claude/imagineer/settings.json (out of git).
//
//   node settings.mjs thresholds --repo <repo>                                  prints them
//   node settings.mjs thresholds --repo <repo> [--tests 70] [--critical 85]    sets them
//   node settings.mjs thresholds --repo <repo> --reset                          back to Imagineer's suggestion

import { resolve } from 'node:path'
import { arg, loadThresholds, saveThresholds } from './lib.mjs'

const [step] = process.argv.slice(2)
const repo = resolve(arg('repo') ?? '.')
const number = name => (arg(name) === null ? undefined : Number(arg(name)))
try {
  if (step !== 'thresholds') throw new Error('Steps: thresholds')
  const changing = process.argv.includes('--reset') || arg('tests') !== null || arg('critical') !== null
  const t = changing ? saveThresholds(repo, { tests: number('tests'), critical: number('critical'), reset: process.argv.includes('--reset') }) : loadThresholds(repo)
  const whose = t.bySetting ? 'set for this repository' : "Imagineer's suggestion"
  console.log(`Tests must catch ${t.tests}% of planted bugs overall and ${t.critical}% in critical code (${whose}).`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
