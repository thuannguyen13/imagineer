#!/usr/bin/env node
// Looks at a repository and reports what it already has, and where: its layout (packages, the app
// Inspect measures, source and test files, scripts by purpose, package manager, docs, CI; see
// layout.mjs), the tools it uses (Fallow, Stryker and similar) and its settings. Read only.
//
//   node detect.mjs <repo>            prints JSON
//
// The file list is the last commit's; with `root`, file contents are read from there (Inspect's
// copy of that commit) instead of the working tree.

import { isMain, loadLayoutChoices } from './lib.mjs'
import { describeLayout, reader, scanLayout, trackedFiles } from './layout.mjs'

export function detect(repo, { root = repo, saved = loadLayoutChoices(repo) } = {}) {
  const files = trackedFiles(repo)
  const read = reader(root)
  const layout = scanLayout({ files, read, saved })
  const app = layout.app?.dir ?? '.'
  const where = [...new Set([app, layout.installRoot])]

  const deps = layout.deps
  const scriptText = Object.values(layout.scripts).filter(Boolean).map(s => s.command).join('\n')
  // A tool's config sits in the app's folder or the one installing happens from.
  const dirOf = f => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.')
  const atApp = pattern => where.map(dir => files.find(f => dirOf(f) === dir && pattern.test(f.split('/').pop()))).find(Boolean) ?? null
  const fallowConfig = atApp(/^(\.fallowrc\.jsonc?|\.?fallow\.toml)$/)
  const strykerConfig = atApp(/^stryker\.(conf|config)\.(json|js|mjs|cjs|ts)$/)
  const strykerDeps = Object.keys(deps).filter(name => name.startsWith('@stryker-mutator/'))
  // Stryker's config is read from the folder it runs in: the app's.
  const strykerConfigInApp = strykerConfig && dirOf(strykerConfig) === app ? strykerConfig.split('/').pop() : null

  return {
    isNodeProject: layout.packages.length > 0,
    manager: layout.manager.name,
    lockfile: layout.manager.lockfile,
    scripts: { test: layout.scripts.test?.command ?? null, typecheck: layout.scripts.typecheck?.command ?? null },
    typescript: layout.typescript,
    tools: {
      fallow: {
        inRepo: 'fallow' in deps || fallowConfig !== null || /\bfallow\b/.test(scriptText),
        version: deps.fallow ?? null,
        config: fallowConfig,
      },
      stryker: {
        inRepo: strykerDeps.length > 0 || strykerConfig !== null,
        version: deps['@stryker-mutator/core'] ?? null,
        config: strykerConfigInApp,
      },
      similar: ['knip', 'jscpd', 'vitest', 'jest', 'c8', 'nyc'].filter(name => name in deps),
    },
    ci: { providers: layout.ci.providers, workflows: layout.ci.files, runsTests: layout.ci.runsTests },
    docs: { level: layout.docs.level, readme: layout.docs.readme, agentDocs: layout.docs.agentDocs, files: layout.docs.files, dir: layout.docs.dir, agentFile: layout.docs.agentFile },
    env: { example: layout.env.example, read: layout.env.read, missing: layout.env.missing, styles: layout.env.styles },
    sourceFiles: layout.sources.files,
    tests: { files: layout.tests.all, needSetting: layout.tests.needSetting },
    layout: { ...layout, deps: undefined, summary: describeLayout(layout) },
  }
}

if (isMain(import.meta.url)) {
  const repo = process.argv[2]
  if (!repo) {
    console.error('Usage: node detect.mjs <repo>')
    process.exit(2)
  }
  console.log(JSON.stringify(detect(repo), null, 2))
}
