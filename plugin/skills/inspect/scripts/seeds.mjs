// Places in the app's code that a blind question can start from, read only, never graded:
//   - errors handled silently: a failure caught and dropped, only logged, or turned into a default
//     ("Saving to the bank fails. What should Bo see?");
//   - comments that state a rule ("only admins can delete a board"): a rule kept only in a comment
//     is a claim, not a rule, until the user confirms it and a test proves the code keeps it.
// After Anthropic's pr-review-toolkit (silent-failure-hunter) and code-modernization (business rules).

import { isTestFile, reader, SOURCE } from './layout.mjs'

/** The text between a `{` at `open` and its matching `}`, skipping strings and comments roughly. */
function block(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') {
      for (i += 1; i < text.length && text[i] !== c; i += 1) if (text[i] === '\\') i += 1
    } else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1
    else if (c === '{') depth += 1
    else if (c === '}' && --depth === 0) return text.slice(open + 1, i)
  }
  return null
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length
const LOGS = /^(console\.(log|warn|error|info|debug)|(this\.)?(logger|log)\.\w+|Sentry\.capture\w+|captureException|reportError)\s*\(/
const DEFAULTS = /^return\s*(null|undefined|false|true|0|''|""|\[\s*\]|\{\s*\}|-1)?\s*;?$/

/** How a catch block's body handles the error, when it does so silently; null when it throws, returns the error, or does more. */
export function silentHandling(body) {
  const statements = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(/;|\n/)
    .map(s => s.trim())
    .filter(Boolean)
  if (!statements.length) return 'drops the error without a word'
  if (statements.some(s => /\bthrow\b|\breject\(|\bnext\(\s*\w+|\bres\.status\(|\bstatus\s*:\s*[45]\d\d|\berror\s*:|\bok\s*:\s*false|toast|notify|setError|redirect/i.test(s))) return null
  if (statements.every(s => LOGS.test(s))) return 'only logs the error and carries on'
  if (statements.every(s => LOGS.test(s) || DEFAULTS.test(s))) return 'turns the error into an ordinary-looking answer'
  return null
}

// Words that state a rule, about who may do what or about money and personal data; a comment about how
// the screen looks or moves ("shown only when focused") is about the interface, not a rule.
const RULE = /\b(only|must|must not|never|cannot|can't|can not|may not|should not|shouldn't|not allowed|forbidden|is required|are required|at most|at least|no more than)\b/i
const SUBJECT = /\b(admins?|owners?|roles?|permissions?|viewers?|managers?|approvers?|members?|teams?|users?|guests?|signed[- ]in|logged[- ]in|amounts?|prices?|totals?|refunds?|payments?|balances?|invoices?|charges?|deleted?|deletes|approves?|approved|private|personal|secrets?|passwords?|tokens?|leak)\b/i
const INTERFACE = /\b(focus(ed)?|hover|tab stop|padding|margin|column|tooltip|layout|pixels?|px|css|scroll|chart|bar|icon|label|font|colou?r|animation|draws?|render(s|ed)?|shown|card|sidebar|button|badge|dialog|modal|width|height|aria|screen reader|placeholder)\b/i

/** The comment lines of a file that state a rule about who may do what, or with which data. */
export function ruleComments(text) {
  const found = []
  text.split('\n').forEach((line, i) => {
    const comment = line.match(/^\s*(?:\/\/+|\/?\*+|\{\s*\/\*)\s*(.+?)\s*(?:\*\/\s*\}?)?$/)?.[1] ?? line.match(/\s\/\/\s*(.+)$/)?.[1]
    // A line that carries on the comment above it ("never touches it, and…") is half a sentence, not a rule.
    if (!comment || comment.length < 15 || comment.length > 240 || /^[a-z(,;:]/.test(comment)) return
    if (/eslint|prettier|ts-(ignore|expect-error|nocheck)|@(param|returns?|type|see|license)|copyright|https?:\/\//i.test(comment)) return
    if (RULE.test(comment) && SUBJECT.test(comment) && !INTERFACE.test(comment)) found.push({ line: i + 1, text: comment })
  })
  return found
}

const WHO = /\b(admins?|owners?|roles?|permissions?|viewers?|managers?|approvers?|members?|teams?|users?|guests?|signed[- ]in|logged[- ]in)\b/i
const STRONG = /\b(must|never|only|cannot|can't|may not|not allowed|forbidden)\b/i
/** How much a rule comment is worth asking about: who may do what first, then money and personal data. */
const weight = text => (WHO.test(text) ? 3 : 2) + (STRONG.test(text) ? 1 : 0)
/** A run asks about a dozen things at most: more seeds than this only bury the best ones. */
export const MAX_SEEDS = 40

/** The seeds in the app's source files: `{ kind, path, line, code, detail }`, the strongest of each kind first. */
export function questionSeeds(files, read) {
  const seeds = []
  for (const path of files) {
    if (!SOURCE.test(path) || isTestFile(path) || /\.d\.[cm]?ts$/.test(path)) continue
    const text = read(path)
    if (!text || text.length > 512 * 1024) continue
    for (const match of text.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
      // Inside a template string (a script the page sends to the browser), not the app's own handling.
      if ((text.slice(0, match.index).match(/`/g) ?? []).length % 2) continue
      const body = block(text, match.index + match[0].length - 1)
      const how = body === null ? null : silentHandling(body)
      if (how) seeds.push({ kind: 'silent-failure', path, line: lineAt(text, match.index), code: text.split('\n')[lineAt(text, match.index) - 1].trim().slice(0, 200), detail: `When this fails, the code ${how}.` })
    }
    for (const match of text.matchAll(/\.catch\(\s*(\(\s*\w*\s*\)|\w+)?\s*=>\s*(null|undefined|\{\s*\}|\[\s*\]|false|console\.\w+\([^)]*\))\s*\)|\.catch\(\s*(console\.\w+|noop|\(\)\s*=>\s*\{\s*\})\s*\)/g)) {
      const line = lineAt(text, match.index)
      seeds.push({ kind: 'silent-failure', path, line, code: text.split('\n')[line - 1].trim().slice(0, 200), detail: 'When this fails, the code carries on as if it had not.' })
    }
    for (const rule of ruleComments(text)) seeds.push({ kind: 'rule-comment', path, line: rule.line, code: rule.text, weight: weight(rule.text), detail: 'A rule stated in a comment: ask whether it is the rule, then prove the code keeps it.' })
  }
  const kind = name => seeds.filter(s => s.kind === name)
  const rules = kind('rule-comment').sort((a, b) => b.weight - a.weight).slice(0, MAX_SEEDS).map(({ weight: _w, ...s }) => s)
  return [...kind('silent-failure').slice(0, MAX_SEEDS), ...rules]
}

/** The seeds in an app's folder of a repository's files, read from `root`. */
export function appSeeds(files, root, app = '.') {
  return questionSeeds(files.filter(f => app === '.' || f.startsWith(`${app}/`)), reader(root))
}
