// The ways into an app's server code: API routes, route handlers, server actions, loaders and form
// actions, and routes in a router or route table. Attacks are counted against this list, read from
// the code, rather than against what the attacker says it covered: a way in no attack test touches
// is listed as not attacked yet, never read as safe. Read only.

import { isTestFile, SOURCE } from './layout.mjs'

const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS'
const ident = name => /^[A-Za-z_$][\w$]*$/.test(name)
// Words too common to show that a test reached one particular way in.
const COMMON = new Set(['await', 'async', 'return', 'Number', 'String', 'JSON', 'body', 'user', 'req', 'res', 'db', 'ctx', 'context', 'next', 'json', 'send', 'status', 'parse', 'then', 'match', 'params', 'query', 'request', 'response', 'handler', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

const GUARD = /^(require|ensure|check|validate|verify|auth|authenticate|authorize|is[A-Z]|has[A-Z]|with[A-Z]|protect|limit|rateLimit|cors|logger|csrf|session)/

/** A module's path without its extension, as an import names it from elsewhere: `features/notes/actions`. */
const modulePath = file => file.replace(/\.(m|c)?[jt]sx?$|\.(vue|svelte|astro)$/, '')

/** The names a module exports: functions, constants and `export { a, b }`. */
function exportsOf(text) {
  const names = new Set()
  for (const m of text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of text.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (ident(name)) names.add(name)
    }
  }
  return [...names]
}

/** The URL a file-based route serves, its fixed part only: `app/(app)/products/[id]/route.ts` → `/products/`. */
function urlOf(file, root) {
  const parts = file.slice(file.indexOf(root) + root.length).split('/').slice(0, -1).filter(p => !/^\(.*\)$/.test(p) && !p.startsWith('@'))
  const fixed = []
  for (const p of parts) {
    if (/[[\]:$]/.test(p) || p.startsWith('_')) break
    fixed.push(p)
  }
  return `/${fixed.join('/')}${fixed.length < parts.length ? '/' : ''}`
}

/** The identifiers a route's own lines call, so a test that calls them reached it: `listExpenses(db, …)`. */
function callsIn(lines) {
  const found = new Set()
  for (const m of lines.join('\n').matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (!COMMON.has(m[1]) && m[1].length > 3) found.add(m[1])
  return [...found]
}

/**
 * The server entry points in an app's files: `{ file, name, kind, words }`, where `words` are what a
 * test's code would hold had it reached this way in (an exported name, a URL, a function the route calls).
 */
export function serverEntries(files, read) {
  const entries = []
  const add = (file, name, kind, words) => entries.push({ file, name, kind, words: [...new Set(words.filter(Boolean))] })
  for (const file of files) {
    if (!SOURCE.test(file) || isTestFile(file) || file.split('/').includes('node_modules')) continue
    const text = read(file)
    if (!text) continue
    const base = file.split('/').pop()

    // Next.js route handlers and SvelteKit endpoints: one entry per HTTP method the file exports.
    if (/^(route|\+server)\.(m|c)?[jt]s$/.test(base)) {
      const root = base.startsWith('+') ? 'routes/' : 'app/'
      for (const m of text.matchAll(new RegExp(`^export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)(${METHODS})\\b`, 'gm'))) add(file, `${m[1]} ${urlOf(file, root)}`, 'route handler', [modulePath(file).split('/').slice(-3).join('/'), urlOf(file, root)])
      continue
    }
    // Next.js pages/api, Nuxt and Nitro server/api and server/routes: the file is the handler.
    const apiRoot = file.match(/(^|\/)(pages\/api\/|server\/(?:api|routes)\/)/)
    if (apiRoot) {
      // The URL is the file's path under its folder: pages/api/teams/[id].ts serves /api/teams/[id].
      const rest = modulePath(file.slice(apiRoot.index + apiRoot[0].length)).replace(/(^|\/)index$/, '')
      const url = `${apiRoot[2].endsWith('routes/') ? '/' : '/api/'}${rest}`.replace(/\/$/, '') || '/'
      add(file, url, 'API route', [modulePath(file).split('/').slice(-2).join('/'), url.split('[')[0].length > 5 ? url.split('[')[0] : null])
      continue
    }
    // Server actions: every export of a file that starts with 'use server'.
    if (/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use server['"]/.test(text)) {
      for (const name of exportsOf(text)) add(file, name, 'server action', [name])
      continue
    }
    // SvelteKit form actions and loads, Remix and React Router loaders and actions.
    if (/^\+page\.server\.(m|c)?[jt]s$|^\+layout\.server\.(m|c)?[jt]s$/.test(base) || /(^|\/)app\/routes\//.test(file)) {
      for (const name of exportsOf(text).filter(n => ['load', 'actions', 'loader', 'action'].includes(n))) add(file, `${name} ${file}`, name === 'load' || name === 'loader' ? 'loader' : 'form action', [`${modulePath(file).split('/').slice(-2).join('/')}`])
    }
    // Routers (Express, Fastify, Hono, Koa) and route tables: one entry per route line.
    const lines = text.split('\n')
    lines.forEach((line, at) => {
      const router = line.match(new RegExp(`\\b[A-Za-z_$][\\w$]*\\.(get|post|put|patch|delete|all)\\(\\s*['"\`](/[^'"\`]*)['"\`]`, 'i'))
      const table = line.match(new RegExp(`\\[\\s*['"](${METHODS})['"]\\s*,\\s*(?:/\\^?((?:\\\\.|[^/])*)/|['"\`](/[^'"\`]*)['"\`])`))
      if (!router && !table) return
      const method = (router?.[1] ?? table[1]).toUpperCase()
      const path = router?.[2] ?? table[3] ?? table[2].replace(/\\\//g, '/').replace(/\$$/, '').replace(/\(\\d\+\)|\([^)]*\)/g, ':id')
      // The route's own lines: this one and those up to the next route.
      const own = [line]
      for (let i = at + 1; i < Math.min(lines.length, at + 8) && !/^\s*\[\s*['"]|\.(get|post|put|patch|delete|all)\(/i.test(lines[i]); i += 1) own.push(lines[i])
      const fixed = path.split(/[:([*]/)[0]
      // The method and the path on the route's first line are not calls.
      own[0] = own[0].replace(router ? /^.*?\(\s*['"`][^'"`]*['"`]/ : /^[^,]*,[^,]*,/, '')
      // A router names its handlers too: `router.post('/teams/:id/members', requireAdmin, addMember)`.
      // Shared guards (`requireAdmin`, `authenticate`) sit on many routes, so they show nothing about this one.
      const named = router ? [...own[0].matchAll(/[,(]\s*([A-Za-z_$][\w$]*)\s*(?=[,)])/g)].map(m => m[1]).filter(n => !COMMON.has(n) && n.length > 3 && !GUARD.test(n)) : []
      add(file, `${method} ${path}`, 'route', [...callsIn(own), ...named, fixed.length > 1 ? fixed : null])
    })
  }
  return entries
}

/** Whether a test's code reached an entry: it holds one of the entry's words. */
export const reaches = (entry, text) => entry.words.some(word => text.includes(word))

/** Which entries the attack tests reached, and which none did. */
export function coverage(entries, testTexts) {
  const reached = []
  const notReached = []
  for (const entry of entries) (testTexts.some(text => reaches(entry, text)) ? reached : notReached).push(entry)
  return { total: entries.length, reached: reached.length, reachedEntries: reached, notReached }
}
