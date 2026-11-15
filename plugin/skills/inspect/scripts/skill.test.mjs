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

test('Inspect and Feedback run their own scripts without a prompt each time, and nothing else', () => {
  for (const name of ['inspect', 'feedback']) {
    const front = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8').split('---')[1]
    assert.match(front, /^allowed-tools: Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/\*\)$/m, name)
  }
})

/** Every script call written in the skills, their references and the agents: `{ file, command, script, step, flags }`. */
function scriptCalls() {
  const calls = []
  for (const file of files) {
    for (const [, command] of readFileSync(file, 'utf8').matchAll(/`(node [^`]*?\.mjs\b[^`]*)`/g)) {
      const path = command.match(/node\s+(\S+\.mjs)/)[1]
      const script = path
        .replace(/^\$S\//, join(SKILLS, 'inspect', 'scripts') + '/')
        .replace(/^\$\{CLAUDE_SKILL_DIR\}\/scripts\//, join(dirname(file), 'scripts') + '/')
        .replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, PLUGIN + '/')
      // Words inside quotes are the call's values (a test command, a title), not its own options.
      const own = command.replace(/'[^']*'|"[^"]*"/g, '')
      const after = own.slice(own.indexOf('.mjs') + 4).trim().split(/\s+/)
      const step = after[0] && /^[a-z][\w-]*$/.test(after[0]) ? after[0] : null
      const flags = [...own.matchAll(/(?:^|\s)--([a-z][\w-]*)/g)].map(m => m[1])
      calls.push({ file: file.slice(PLUGIN.length + 1), command, script, step, flags })
    }
  }
  return calls
}

test('every script call the skills and agents name exists, with a step and options the script takes', () => {
  const calls = scriptCalls()
  assert.ok(calls.length > 30, `only ${calls.length} calls found: the pattern no longer matches the text`)
  for (const { file, command, script, step, flags } of calls) {
    if (/\$S\/<|<name>|<x>/.test(command)) continue
    assert.ok(existsSync(script), `${file}: \`${command}\` names a script that does not exist`)
    const source = readFileSync(script, 'utf8')
    if (step) assert.ok(new RegExp(`step === '${step}'|\\[[^\\]]*'${step}'[^\\]]*\\]\\.includes\\(step\\)`).test(source), `${file}: \`${command}\`: ${script.split('/').pop()} has no step "${step}"`)
    for (const flag of flags) {
      assert.ok(new RegExp(`arg\\('${flag}'|['"\`]--${flag}\\b`).test(source), `${file}: \`${command}\`: ${script.split('/').pop()} does not read --${flag}`)
    }
  }
})
