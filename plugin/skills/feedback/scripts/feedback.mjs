#!/usr/bin/env node
// Imagineer's self-check and feedback log: signs that Imagineer itself went
// wrong, never the user's code. Records stay on the user's machine until the
// user chooses to share one.
//
//   node feedback.mjs check  --repo <repo>                 flags from the run records, saved for the pane
//   node feedback.mjs record --kind <kind> --area <area> --said "<what Imagineer said or did>"
//                            --happened "<what actually happened>" [--rule <rule>] [--repo <repo>]
//   node feedback.mjs list
//   node feedback.mjs share  --id <n> [--file <path>]     the record as text and a pre-filled GitHub issue link

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_URL = 'https://github.com/thuannguyen13/imagineer'
export const KINDS = ['rule-broken', 'stuck', 'tool-trouble', 'grade-contradiction', 'poor-questions', 'mod-fault', 'cost', 'miss', 'false-alarm', 'praise']
export const AREAS = ['inspect', 'build', 'grade', 'mod', 'agent']

const home = () => process.env.IMAGINEER_HOME ?? join(homedir(), '.claude', 'imagineer')
const logPath = () => join(home(), 'feedback.jsonl')
const readJsonIf = path => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch {
    return null
  }
}
const readLines = path =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap(line => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        })
    : []
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

/** Groups repeats of one problem: same kind, area and rule. */
export const fingerprint = (kind, area, rule) => createHash('sha256').update(`${kind}|${area}|${rule}`).digest('hex').slice(0, 12)

const flag = (kind, area, rule, said) => ({ kind, area, rule, said, fingerprint: fingerprint(kind, area, rule) })

const isProven = q => q.test?.green === true && q.test.red?.total > 0 && q.test.red.killed === q.test.red.total
const normalize = text => (text ?? '').toLowerCase().replace(/^my guess \(no docs found\):\s*/, '').replace(/\W+/g, ' ').trim()

/** Signs, from the files Imagineer keeps, that Imagineer itself went wrong. */
export function selfCheck(repo) {
  const base = join(repo, '.claude', 'imagineer')
  const flags = []

  // An agent tried to step outside its role, and the role guard refused it.
  const denials = readLines(join(base, 'denials.jsonl'))
  const byRole = new Map()
  for (const d of denials) byRole.set(`${d.agent}:${d.tool}`, (byRole.get(`${d.agent}:${d.tool}`) ?? 0) + 1)
  for (const [key, n] of byRole) {
    const [agent, tool] = key.split(':')
    flags.push(flag('rule-broken', 'agent', key, `The ${agent} agent tried ${n === 1 ? 'once' : `${n} times`} to use ${tool} outside its role; the role guard refused it.`))
  }

  // Tools that did not run in the latest Inspect run.
  const runsDir = join(base, 'runs')
  const latest = existsSync(runsDir)
    ? readdirSync(runsDir)
        .filter(n => /^\d+$/.test(n))
        .sort((a, b) => Number(b) - Number(a))[0]
    : null
  if (latest) {
    const out = join(runsDir, latest)
    const fallow = readJsonIf(join(out, 'fallow.json'))
    const stryker = readJsonIf(join(out, 'stryker.json'))
    if (fallow && !fallow.ok) flags.push(flag('tool-trouble', 'inspect', 'fallow', `Fallow did not run in Inspect run ${latest}.`))
    if (stryker && !stryker.ok && !stryker.skipped) flags.push(flag('tool-trouble', 'inspect', 'stryker', `Stryker did not run in Inspect run ${latest}.`))
    // Most breaks timing out means the runs were too slow to tell anything, not that tests caught them.
    const mutants = Object.values(readJsonIf(join(out, 'mutation.json'))?.files ?? {}).flatMap(f => f.mutants ?? [])
    const timeouts = mutants.filter(m => m.status === 'Timeout').length
    if (timeouts > 10 && timeouts / mutants.length > 0.2) {
      flags.push(flag('tool-trouble', 'inspect', 'stryker-timeouts', `${timeouts} of ${mutants.length} breaks timed out in Inspect run ${latest}: the runs were too slow to measure test strength.`))
    }
  }

  // An answer Inspect called proven, broken by one of its own attacks.
  const ledger = readJsonIf(join(base, 'questions.json'))
  const attacks = existsSync(runsDir)
    ? readdirSync(runsDir).flatMap(n => readJsonIf(join(runsDir, n, 'attacks.json'))?.attacks ?? [])
    : []
  for (const q of (ledger?.questions ?? []).filter(isProven)) {
    for (const a of attacks.filter(a => a.about === q.id && a.result === 'broke' && !a.void)) {
      flags.push(flag('grade-contradiction', 'inspect', `${q.id}:${a.id}`, `${q.id} was proven by a test, yet attack ${a.id} broke the same behaviour: the proof missed a case.`))
    }
  }

  // Questions that were not worth asking: the user rejected the suggestions, or the same question came back.
  const answered = (ledger?.questions ?? []).filter(q => q.status === 'answered')
  const own = answered.filter(q => q.ownWords).length
  if (answered.length >= 4 && own / answered.length > 0.5) {
    flags.push(flag('poor-questions', 'inspect', 'own-words', `The user typed their own answer to ${own} of ${answered.length} questions: the suggestions did not fit.`))
  }
  const seen = new Map()
  for (const q of ledger?.questions ?? []) {
    const key = normalize(q.expectation)
    if (key.length < 12) continue
    if (seen.has(key)) flags.push(flag('poor-questions', 'inspect', 'repeated', `${q.id} asks again what ${seen.get(key)} asked.`))
    else seen.set(key, q.id)
  }

  // A Build that ran four rounds without meeting the done thresholds.
  const buildDir = join(base, 'build')
  for (const slug of existsSync(buildDir) ? readdirSync(buildDir) : []) {
    const state = readJsonIf(join(buildDir, slug, 'state.json'))
    const rounds = state?.rounds ?? []
    if (rounds.length >= 4 && !rounds.at(-1)?.bar?.met) flags.push(flag('stuck', 'build', slug, `Build "${slug}" ran ${rounds.length} rounds without meeting the done bar.`))
  }
  return flags
}

function version() {
  return readJsonIf(join(HERE, '../../../.claude-plugin/plugin.json'))?.version ?? 'unknown'
}

export function issueFor(record) {
  const title = `Feedback: ${record.kind} in ${record.area}`
  const body = [
    `**Kind:** ${record.kind} · **Area:** ${record.area} · **Imagineer:** ${record.imagineer} · **Fingerprint:** \`${record.fingerprint}\``,
    '',
    `**What Imagineer said or did:** ${record.said}`,
    '',
    `**What actually happened:** ${record.happened || '(not given)'}`,
  ]
    .join('\n')
    .slice(0, 1500)
  const url = `${REPO_URL}/issues/new?${new URLSearchParams({ title, body, labels: 'feedback' })}`
  return { title, body, url }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [step] = process.argv.slice(2)
  try {
    if (step === 'check') {
      const repo = resolve(arg('repo', '.'))
      const flags = selfCheck(repo)
      mkdirSync(join(repo, '.claude', 'imagineer'), { recursive: true })
      writeFileSync(join(repo, '.claude', 'imagineer', 'flags.json'), JSON.stringify({ at: new Date().toISOString(), flags }, null, 2) + '\n')
      console.log(flags.length ? flags.map(f => `${f.kind} (${f.fingerprint}): ${f.said}`).join('\n') : 'No signs that Imagineer went wrong.')
    } else if (step === 'record') {
      const kind = arg('kind')
      const area = arg('area')
      if (!KINDS.includes(kind)) throw new Error(`--kind is one of ${KINDS.join(', ')}`)
      if (!AREAS.includes(area)) throw new Error(`--area is one of ${AREAS.join(', ')}`)
      if (!arg('said')) throw new Error('--said is required: what Imagineer said or did, as behaviour, never the user\'s code')
      const records = readLines(logPath())
      const record = {
        id: records.length + 1,
        at: new Date().toISOString(),
        kind,
        area,
        said: arg('said'),
        happened: arg('happened', ''),
        imagineer: version(),
        repo: arg('repo') ? basename(resolve(arg('repo'))) : null,
        fingerprint: fingerprint(kind, area, arg('rule', 'user')),
      }
      mkdirSync(dirname(logPath()), { recursive: true })
      appendFileSync(logPath(), JSON.stringify(record) + '\n')
      console.log(`Recorded feedback #${record.id} (${record.fingerprint}) in ${logPath()}.`)
    } else if (step === 'list') {
      for (const r of readLines(logPath())) console.log(`#${r.id} ${r.at.slice(0, 10)} ${r.kind}/${r.area} (${r.fingerprint}): ${r.said}`)
    } else if (step === 'share') {
      const record = readLines(logPath()).find(r => r.id === Number(arg('id')))
      if (!record) throw new Error(`No feedback #${arg('id')}. See: feedback.mjs list`)
      const issue = issueFor(record)
      if (arg('file')) {
        writeFileSync(resolve(arg('file')), `# ${issue.title}\n\n${issue.body}\n`)
        console.log(`Saved to ${resolve(arg('file'))}.`)
      } else {
        console.log(`${issue.title}\n\n${issue.body}\n\nOpen this link to review and submit it yourself:\n${issue.url}`)
      }
    } else {
      throw new Error('Steps: check, record, list, share')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
