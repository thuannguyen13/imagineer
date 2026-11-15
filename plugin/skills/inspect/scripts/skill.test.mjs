// Run: node --test 'plugin/skills/inspect/scripts/*.test.mjs'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '../..')
const PLUGIN = join(SKILLS, '..')
const files = [
  ...readdirSync(SKILLS).flatMap(name => [join(SKILLS, name, 'SKILL.md'), ...listMd(join(SKILLS, name, 'references'))]),
  ...listMd(join(PLUGIN, 'agents')),
].filter(existsSync)

function listMd(dir) {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => join(dir, f)) : []
}

const anchor = heading => heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

test("every link between the skills, their references and the agents points at a file and heading that exist", () => {
  for (const file of files) {
    for (const [, target] of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+\.md(?:#[\w-]+)?)\)/g)) {
      if (/^https?:/.test(target)) continue
      const [path, hash] = target.split('#')
      const resolved = join(dirname(file), path)
      assert.ok(existsSync(resolved), `${file} links to ${target}, which does not exist`)
      if (hash) {
        const headings = [...readFileSync(resolved, 'utf8').matchAll(/^#+ (.+)$/gm)].map(m => anchor(m[1]))
        assert.ok(headings.includes(hash), `${file} links to ${target}, but it has no such heading`)
      }
    }
  }
})

// Build is turned off from 0.4.0: its SKILL.md is kept outside the plugin, in the docs archive.
test('Inspect and Feedback run their own scripts without a prompt each time, and nothing else', () => {
  for (const name of ['inspect', 'feedback']) {
    const front = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8').split('---')[1]
    assert.match(front, /^allowed-tools: Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/\*\)$/m, name)
  }
})
