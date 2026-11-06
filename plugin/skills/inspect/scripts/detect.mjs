#!/usr/bin/env node
// Looks at a repository and reports what it already has: package manager,
// scripts, tools (Fallow, Stryker and similar), docs, CI and env files.
// Read only.
//
//   node detect.mjs <repo>            prints JSON

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles, readJsonIf } from './lib.mjs'

const LOCKFILES = [
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]

const DEFAULT_TEST = /no test specified/

export function detect(repo) {
  const files = listFiles(repo)
  const has = name => files.includes(name)
  const pkg = readJsonIf(join(repo, 'package.json')) ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const scripts = pkg.scripts ?? {}
  const scriptText = Object.values(scripts).join('\n')

  const lock = LOCKFILES.find(([name]) => has(name))
  const manager = lock?.[1] ?? 'npm'

  const fallowConfig = files.find(f => /^(\.fallowrc\.jsonc?|\.?fallow\.toml)$/.test(f)) ?? null
  const strykerConfig = files.find(f => /^stryker\.(conf|config)\.(json|js|mjs|cjs|ts)$/.test(f)) ?? null
  const strykerDeps = Object.keys(deps).filter(name => name.startsWith('@stryker-mutator/'))

  const workflows = files.filter(f => /^\.github\/workflows\/.+\.ya?ml$/.test(f))
  const workflowText = workflows.map(f => readFileSync(join(repo, f), 'utf8')).join('\n')
  const testScript = scripts.test && !DEFAULT_TEST.test(scripts.test) ? scripts.test : null
  // CI runs the tests when a workflow calls the test script, or runs its command directly
  // (for example `npx vitest run --shard=1/3` for a test script of `vitest run`).
  const testRunner = testScript?.trim().split(/\s+/)[0] ?? null
  const ciRunsTests =
    testScript !== null &&
    (/\b(npm|pnpm|yarn|bun)( run)? test\b|\bnpm t\b/.test(workflowText) ||
      (testRunner !== null && new RegExp(`\\b(npx |pnpm exec |yarn |bunx )?${testRunner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(workflowText)))

  const docs = files.filter(f => /^docs\/.+\.md$/.test(f))
  const readme = files.find(f => /^readme(\.md)?$/i.test(f)) ?? null
  const readmeText = readme ? readFileSync(join(repo, readme), 'utf8') : ''
  const agentDocs = ['CLAUDE.md', 'AGENTS.md'].filter(has)
  const docsLevel =
    docs.length === 0 && agentDocs.length === 0 && readmeText.length < 400
      ? readme
        ? 'thin'
        : 'none'
      : 'present'

  const sources = files.filter(f => /\.(m|c)?[jt]sx?$/.test(f) && !/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./.test(f))
  const envRead = new Set()
  for (const file of sources) {
    for (const match of readFileSync(join(repo, file), 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) {
      envRead.add(match[1] ?? match[2])
    }
  }
  // `.env.example`, and named variants such as `.env.local.example`.
  const envExample = files.find(f => /^\.env(\.[\w-]+)*\.(example|sample|template)$/.test(f)) ?? null
  const envDocumented = envExample
    ? new Set(
        readFileSync(join(repo, envExample), 'utf8')
          .split('\n')
          .map(line => line.trim().match(/^([A-Z0-9_]+)\s*=/)?.[1])
          .filter(Boolean),
      )
    : new Set()
  // Variables the platform sets itself (Node, CI, Vercel, Netlify, Render, Fly) need no example.
  const platformSet = name => ['NODE_ENV', 'CI', 'PORT'].includes(name) || /^(VERCEL|NETLIFY|RENDER|FLY|GITHUB|NEXT_RUNTIME)(_|$)/.test(name)
  const envMissing = [...envRead].filter(name => !envDocumented.has(name) && !platformSet(name)).sort()

  return {
    isNodeProject: existsSync(join(repo, 'package.json')),
    manager,
    lockfile: lock?.[0] ?? null,
    scripts: { test: testScript, typecheck: scripts.typecheck ?? null },
    typescript: 'typescript' in deps || has('tsconfig.json'),
    tools: {
      fallow: {
        inRepo: 'fallow' in deps || fallowConfig !== null || /\bfallow\b/.test(scriptText),
        version: deps.fallow ?? null,
        config: fallowConfig,
      },
      stryker: {
        inRepo: strykerDeps.length > 0 || strykerConfig !== null,
        version: deps['@stryker-mutator/core'] ?? null,
        config: strykerConfig,
      },
      similar: ['knip', 'jscpd', 'vitest', 'jest', 'c8', 'nyc'].filter(name => name in deps),
    },
    ci: { workflows, runsTests: ciRunsTests },
    docs: { level: docsLevel, readme, agentDocs, files: docs },
    env: { example: envExample, read: [...envRead].sort(), missing: envMissing },
    sourceFiles: sources.length,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2]
  if (!repo) {
    console.error('Usage: node detect.mjs <repo>')
    process.exit(2)
  }
  console.log(JSON.stringify(detect(repo), null, 2))
}
