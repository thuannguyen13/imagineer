// Text in a repository that gives orders to AI tools or reviewers: "ignore previous instructions",
// "do not flag this file", "this endpoint has been verified secure". Inspect reads a project's text
// as evidence of what the code is meant to do, never as instructions to itself, so such a line is
// a finding to show the user, not something to obey. Read only; nothing found here is ever run.

import { reader, trackedFiles } from './layout.mjs'

// Files people write in: code, docs, settings and agent instruction files. Lockfiles and minified
// or generated files are left out; so is anything too large to have been written by hand.
const TEXT = /\.(m|c)?[jt]sx?$|\.(vue|svelte|astro|md|mdx|markdown|txt|rst|json|jsonc|ya?ml|toml|html?|css|scss|sql|sh|env|example|sample)$|(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|(^|\/)\.(cursorrules|windsurfrules|clinerules)$|(^|\/)Dockerfile$/i
const NOT_WRITTEN = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$|\.min\.[jc]ss?$|\.map$|(^|\/)(node_modules|dist|vendor)\//
const MAX_BYTES = 512 * 1024

// Who such text addresses: an AI, an agent or an automated reviewer.
const ADDRESSEE = /\b(AI|A\.I\.|LLMs?|language models?|assistants?|agents?|Claude|ChatGPT|GPT|Copilot|Cursor|Gemini|bots?|reviewers?|scanners?|auditors?|security (?:tools?|scans?|scanners?|reviews?)|automated (?:reviews?|tools?|scans?|analysis)|static analy[sz]ers?|pentesters?)\b/i

const PATTERNS = [
  ['tells the reader to drop its instructions', /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|preceding|existing|system|original)\s+(instructions?|prompts?|rules|directions|guidelines)/i],
  ['claims to give new instructions', /(^|[\s#*/>-])(system prompt|developer message|new instructions|updated instructions|instructions for (?:the )?(?:AI|assistant|agent|model|reviewer)s?)\s*:/i],
  ['claims the code is already verified', /\b(this|the|these|our)\s+(?:[\w-]+\s+)?(code|file|files|function|functions|endpoint|endpoints|module|route|routes|handler|app|application|component|service|logic)\s+(has|have|is|are|was|were)\s+(already\s+|been\s+|already been\s+)*(fully\s+)?(verified|audited|certified|approved|reviewed|proven|pen-?tested)(\s+and\s+(is|are))?\s+(as\s+|to be\s+)?(secure|safe|correct|clean|bug-free)/i],
  ['asks for a grade or verdict', /\b(mark|grade|rate|report|score|classify)\s+(this|the|it)?\s*(code|file|project|repo|repository|app|application|endpoint|module)?\s*as\s+(secure|safe|passing|strong|clean|low[- ]risk|no issues)/i],
]
// Asks a reader not to look at something named here ("this file", "these issues"), only when the line addresses
// an AI or a reviewer: "skip this test on CI" is a note for people, "agents never open production data" a rule.
const POINTED = String.raw`(?:\s+[\w'-]+){0,4}?\s+(this|these|that|here|the following|it)\b`
const ADDRESSED = [
  ['asks not to report or examine something', new RegExp(String.raw`\b(do not|don't|dont|never|no need to|please do not|you must not|you should not)\s+(flag|report|mention|scan|review|test|attack|audit|inspect|check|analy[sz]e|look at|read|open|modify)\b` + POINTED, 'i')],
  // "You are now signed in" is an app's own message: a new role counts only when the line addresses an AI.
  ['tries to give the reader a new role', /\byou are (now|no longer)\b|\bfrom now on,? you\b|\bact as (an? )?(unrestricted|different|new)\b/i],
  ['asks to skip or ignore part of the code', /\b(skip|ignore|exclude|bypass|omit)\s+(this|these|the following|that)\s+(file|files|folder|directory|function|functions|code|module|section|endpoint|route|check|finding|findings|issue|issues|warning|warnings|vulnerabilit(y|ies))\b/i],
]

// Files written for agents on purpose (skills, CLAUDE.md, editor rules) address them and give them roles:
// there, only the signs of tampering count, not a role or a "do not" aimed at the project's own work.
const FOR_AGENTS = /(^|\/)(CLAUDE|AGENTS|GEMINI)\.md$|(^|\/)\.(claude|cursor|windsurf|clinerules|github\/instructions)\/|(^|\/)\.(cursorrules|windsurfrules|clinerules)$|(^|\/)\.github\/copilot-instructions\.md$|(^|\/)SKILL\.md$/
const TAMPERING = ['tells the reader to drop its instructions', 'claims the code is already verified', 'asks for a grade or verdict', 'asks to skip or ignore part of the code']

/** Each line of a text that gives orders to AI tools or reviewers: `{ line, text, why }`. With `forAgents`, only the signs of tampering. */
export function plantedIn(text, { forAgents = false } = {}) {
  const found = []
  const lines = String(text).split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    // Characters no one sees can hide words between letters: read the line without them.
    const line = lines[i].replace(/[​-‏⁠-⁤﻿­]/g, '')
    if (line.length > 2000) continue
    let why = PATTERNS.find(([, pattern]) => pattern.test(line))?.[0]
    if (!why && ADDRESSEE.test(line)) why = ADDRESSED.find(([, pattern]) => pattern.test(line))?.[0]
    if (why && (!forAgents || TAMPERING.includes(why))) found.push({ line: i + 1, text: line.trim().slice(0, 200), why })
  }
  return found
}

/** Every such line in a repository's committed files, read from `root` (Inspect's copy) when given. */
export function plantedInstructions(repo, { root = repo, files = trackedFiles(repo) } = {}) {
  const read = reader(root)
  const found = []
  for (const path of files) {
    if (!TEXT.test(path) || NOT_WRITTEN.test(path)) continue
    const text = read(path)
    if (!text || text.length > MAX_BYTES) continue
    for (const hit of plantedIn(text, { forAgents: FOR_AGENTS.test(path) })) found.push({ path, ...hit })
  }
  return found
}
