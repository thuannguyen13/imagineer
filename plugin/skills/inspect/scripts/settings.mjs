#!/usr/bin/env node
// The user's own settings for a repository, kept in .claude/imagineer/settings.json (out of git).
//
//   node settings.mjs thresholds --repo <repo>                                  prints them
//   node settings.mjs thresholds --repo <repo> [--tests 70] [--critical 85]    sets them
//   node settings.mjs thresholds --repo <repo> --reset                          back to Imagineer's suggestion
//
//   node settings.mjs layout --repo <repo>                                      prints the answers kept
//   node settings.mjs layout --repo <repo> [--app <folder>] [--source <folder>,<folder>] [--docs <folder>]
//   node settings.mjs layout --repo <repo> --forget app|source|docs             forgets one answer
//   node settings.mjs layout --repo <repo> --reset                              forgets them all
//
//   node settings.mjs size                                                      how much a run does, or unset
//   node settings.mjs size --set quick|standard|thorough                        the user's choice, for every repository
//   node settings.mjs models                                                    the models Inspect's agents run on, or unset
//   node settings.mjs models --set recommended|budget                           the user's choice, for every repository
//
// Layout answers are what the user said when the scan could not tell: which folder is their app,
// which of its folders hold its own code (from the app's folder), and where project docs go.

import { resolve } from 'node:path'
import { arg, loadLayoutChoices, loadThresholds, MODEL_PRESETS, RUN_SIZES, saveLayoutChoices, savedModels, saveModels, savedRunSize, saveRunSize, saveThresholds } from './lib.mjs'

const [step] = process.argv.slice(2)
const repo = resolve(arg('repo') ?? '.')
const number = name => (arg(name) === null ? undefined : Number(arg(name)))
try {
  if (step === 'thresholds') {
    const changing = process.argv.includes('--reset') || arg('tests') !== null || arg('critical') !== null
    const t = changing ? saveThresholds(repo, { tests: number('tests'), critical: number('critical'), reset: process.argv.includes('--reset') }) : loadThresholds(repo)
    const whose = t.bySetting ? 'set for this repository' : "Imagineer's suggestion"
    console.log(`Tests must catch ${t.tests}% of planted bugs overall and ${t.critical}% in critical code (${whose}).`)
  } else if (step === 'layout') {
    const forget = arg('forget')
    if (forget && !['app', 'source', 'docs'].includes(forget)) throw new Error('--forget takes app, source or docs.')
    const given = { app: arg('app') ?? undefined, source: arg('source') ?? undefined, docs: arg('docs') ?? undefined }
    if (forget) given[forget] = null
    const changing = process.argv.includes('--reset') || Object.values(given).some(v => v !== undefined)
    const kept = changing ? saveLayoutChoices(repo, { ...given, reset: process.argv.includes('--reset') }) : loadLayoutChoices(repo)
    const lines = [kept.app && `App: ${kept.app}`, kept.source && `Its own code: ${kept.source.join(', ')}`, kept.docs && `Docs: ${kept.docs}`].filter(Boolean)
    console.log(lines.length ? `Kept for this repository: ${lines.join('; ')}.` : 'Nothing kept: Inspect reads the layout from the repository.')
  } else if (step === 'size') {
    const size = arg('set') ? saveRunSize(arg('set')) : savedRunSize()
    console.log(JSON.stringify(size ?? { unset: true, default: { size: 'standard', ...RUN_SIZES.standard } }))
  } else if (step === 'models') {
    const models = arg('set') ? saveModels(arg('set')) : savedModels()
    // Until the user chooses, the run size decides: the faster, cheaper model for Quick and Standard.
    const preset = RUN_SIZES[savedRunSize()?.size ?? 'standard'].models
    console.log(JSON.stringify(models ?? { unset: true, default: { preset, ...MODEL_PRESETS[preset] } }))
  } else throw new Error('Steps: thresholds, layout, size, models')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
