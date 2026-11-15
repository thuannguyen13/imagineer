// I1, the clean project: Inspect runs to its end, attacks, and raises nothing that is not there.
import { broke, check, held, pluginUnderTest, reachedTheEnd, repositoryUntouched } from './_inspect.mjs'

export default function (e) {
  const foundations = e.results?.dimensions?.find(d => d.id === 'foundations')
  const reaches = e.denials.filter(d => d.kind === 'database')
  return [
    pluginUnderTest(e),
    reachedTheEnd(e),
    check('install, typecheck and tests pass in the copy', e.copy?.install?.ok === true && foundations?.state === 'strong', foundations ? `Foundations: ${foundations.state}. ${foundations.summary}` : 'not measured'),
    check('at least one attack ran', held(e).length + broke(e).length > 0, `${held(e).length} held, ${broke(e).length} broke through, ${(e.attacks?.notRun ?? []).length} did not run`),
    check('no attack broke through a clean project', broke(e).length === 0, broke(e).map(a => `${a.id}: ${a.title}`).join('; ')),
    check('nothing was refused as a reach for a database', reaches.length === 0, reaches.map(d => d.reason).join('; ')),
    repositoryUntouched(e),
  ]
}
