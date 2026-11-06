// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foundations, mutationScore, overall, structure, testStrength } from './grade.mjs'
import { detect } from './detect.mjs'

const mutants = (killed, survived, other = {}) => ({
  files: {
    'src/a.ts': {
      mutants: [
        ...Array.from({ length: killed }, () => ({ status: 'Killed' })),
        ...Array.from({ length: survived }, () => ({ status: 'Survived' })),
        ...Object.entries(other).flatMap(([status, n]) => Array.from({ length: n }, () => ({ status }))),
      ],
    },
  },
})

const stryker = { ok: true, measured: 'default' }

test('mutation score counts timeouts as caught and ignores errors', () => {
  const { caught, total } = mutationScore(mutants(3, 1, { Timeout: 1, NoCoverage: 1, CompileError: 2, Ignored: 3 }))
  assert.equal(caught, 4)
  assert.equal(total, 6)
})

test('test strength uses Stryker bands: 80% strong, 60% weak, below failing', () => {
  assert.equal(testStrength({ stryker, mutation: mutants(8, 2) }).state, 'strong')
  assert.equal(testStrength({ stryker, mutation: mutants(79, 21) }).state, 'weak')
  assert.equal(testStrength({ stryker, mutation: mutants(6, 4) }).state, 'weak')
  assert.equal(testStrength({ stryker, mutation: mutants(59, 41) }).state, 'failing')
})

test('test strength names the weakest files', () => {
  const report = {
    files: {
      'src/server.ts': { mutants: [{ status: 'Survived' }, { status: 'NoCoverage' }] },
      'src/db.ts': { mutants: [{ status: 'Killed' }] },
    },
  }
  assert.match(testStrength({ stryker, mutation: report }).summary, /Weakest: src\/server\.ts 0%\./)
})

test('no tests at all fails test strength; a run that never happened is not checked', () => {
  assert.equal(testStrength({ stryker: { ok: false, skipped: 'No test command.' } }).state, 'failing')
  assert.equal(testStrength({}).state, 'unchecked')
  assert.equal(testStrength({ stryker: { ok: false } }).state, 'unchecked')
})

const fallow = (score, issues = 0, findings = []) => ({
  ok: true,
  measured: 'default',
  health: { health_score: { score, grade: 'B' }, findings, vital_signs: { duplication_pct: 0 } },
  check: { total_issues: issues, summary: { unused_files: issues } },
})

test('structure: clean and 70 or more is strong, findings make it weak, below 55 fails', () => {
  assert.equal(structure({ fallow: fallow(85) }).state, 'strong')
  assert.equal(structure({ fallow: fallow(85, 2) }).state, 'weak')
  assert.equal(structure({ fallow: fallow(60) }).state, 'weak')
  assert.equal(structure({ fallow: fallow(50) }).state, 'failing')
  assert.match(structure({ fallow: fallow(81, 2) }).summary, /2 unused files; not yet reviewed with you/)
})

const good = {
  detect: { lockfile: 'package-lock.json', typescript: true, ci: { runsTests: true }, env: { missing: [], example: '.env.example' } },
  copy: { install: { ok: true } },
  checks: { typecheck: { present: true, ok: true }, test: { present: true, ok: true } },
}

test('foundations: all present is strong, gaps are weak, failing tests fail', () => {
  assert.equal(foundations(good).state, 'strong')
  assert.equal(foundations({ ...good, detect: { ...good.detect, ci: { runsTests: false } } }).state, 'weak')
  assert.equal(foundations({ ...good, checks: { ...good.checks, test: { present: true, ok: false } } }).state, 'failing')
  const missingEnv = foundations({ ...good, detect: { ...good.detect, env: { missing: ['API_KEY'], example: '.env.example' } } })
  assert.equal(missingEnv.summary, 'API_KEY not in .env.example.')
})

const dim = (group, state, name = `${group}-${state}`) => ({ group, state, name })

test('overall is the weakest link, never an average', () => {
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'failing'), dim('care', 'strong')]).state, 'failing')
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'unchecked')]).state, 'not-proven')
  assert.equal(overall([dim('trust', 'failing'), dim('trust', 'unchecked')]).state, 'failing')
  assert.equal(overall([dim('trust', 'strong'), dim('trust', 'weak')]).state, 'weak')
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'strong')]).state, 'strong')
})

test('care dimensions pull the overall down to weak, never to failing', () => {
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'failing')]).state, 'weak')
  assert.equal(overall([dim('trust', 'strong'), dim('care', 'weak')]).state, 'weak')
})

test('detect finds env variables missing from .env.example, and no docs', t => {
  const repo = mkdtempSync(join(tmpdir(), 'imagineer-test-'))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }))
  writeFileSync(join(repo, 'src/app.js'), 'const a = process.env.API_KEY; const b = process.env["PORT"]; const c = process.env.NODE_ENV')
  writeFileSync(join(repo, '.env.example'), 'PORT=3000\n')
  const facts = detect(repo)
  assert.deepEqual(facts.env.missing, ['API_KEY'])
  assert.equal(facts.docs.level, 'none')
  assert.equal(facts.scripts.test, null)
  assert.equal(facts.lockfile, null)
})
