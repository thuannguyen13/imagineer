// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'
//
// Where blind questions can start: errors handled silently and rules stated in comments. Found in the
// app's code, offered as findings, never graded.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { questionSeeds, ruleComments, silentHandling } from './seeds.mjs'
import { findings } from './questions.mjs'
import { structure } from './grade.mjs'

test('a catch is silent when it drops, only logs, or swaps the error for a default; not when it tells anyone', () => {
  assert.equal(silentHandling(' '), 'drops the error without a word')
  assert.equal(silentHandling(' /* ignore */ '), 'drops the error without a word')
  assert.equal(silentHandling('\n console.error(err)\n'), 'only logs the error and carries on')
  assert.equal(silentHandling('logger.warn("failed", e); return null'), 'turns the error into an ordinary-looking answer')
  assert.equal(silentHandling('return []'), 'turns the error into an ordinary-looking answer')
  for (const told of ['throw new Error("x")', 'return { ok: false, error: e.message }', 'res.status(500).json({})', 'toast.error("Could not save")', 'setError(e)', 'console.error(e); throw e', 'await retry(); count++']) {
    assert.equal(silentHandling(told), null, told)
  }
})

test('a comment that states who may do what, or a rule about money or personal data, is a seed; interface notes are not', () => {
  const text = [
    '// Only admins may delete a board.',
    '// Refunds must never exceed the original payment.',
    '/* The viewer sees only their own team’s invoices. */',
    '// The first Tab stop, shown only when focused: the sidebar links come first.',
    '// Only the hover reaches past its column, so the user sees the whole label.',
    '// never touches it, and the user puts it away again.',
    '// eslint-disable-next-line only for users',
    'const x = 1 // must be a number',
  ].join('\n')
  assert.deepEqual(ruleComments(text).map(r => r.line), [1, 2, 3])
})

test('seeds come from the app\'s source, not tests, nor a script inside a string; the strongest rules first', () => {
  const files = {
    'src/notes.ts': "export async function save(n) {\n  try { await db.insert(n) } catch (e) { console.error(e) }\n}\nmarkRead(id).catch(() => {})\n",
    'src/theme.ts': 'export const SCRIPT = `(function(){try{localStorage.x}catch(e){}})()`\n',
    'src/rules.ts': '// Prices must be at least zero.\n// Only owners can invite members.\n',
    'test/notes.test.ts': 'try { x() } catch (e) {}\n// Only admins may see this.\n',
  }
  const seeds = questionSeeds(Object.keys(files), path => files[path])
  assert.deepEqual(seeds.map(s => `${s.kind} ${s.path}:${s.line}`), [
    'silent-failure src/notes.ts:2',
    'silent-failure src/notes.ts:4',
    'rule-comment src/rules.ts:2',
    'rule-comment src/rules.ts:1',
  ])
})

test('seeds are offered as findings and leave Code quality and the finish thresholds alone', t => {
  const out = mkdtempSync(join(tmpdir(), 'imagineer-seeds-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  writeFileSync(join(out, 'seeds.json'), JSON.stringify([{ kind: 'rule-comment', path: 'src/rules.ts', line: 2, code: 'Only owners can invite members.', detail: 'x' }]))
  const items = findings(out)
  assert.deepEqual(items.map(i => i.key), ['rule-comment:src/rules.ts:2'])
  const quality = structure({ fallow: { ok: true, health: { health_score: { score: 90, grade: 'A' } } }, findings: items })
  assert.equal(quality.state, 'strong')
})
