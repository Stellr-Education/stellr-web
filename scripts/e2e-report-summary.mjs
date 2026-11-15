// Prints what a Playwright run actually did, from its JSON report: the counts, and
// the title of every skipped test. A skipped spec passes a run while proving
// nothing. Both e2e jobs print this to their step summary (e2e-tests and
// e2e-local), so comparing the two runs means comparing these lists too
// (docs/RUNBOOK-ci-database.md, "The e2e-local job").
//
//   node scripts/e2e-report-summary.mjs test-results/e2e-results.json [job name]
//
// The job name heads the summary; it defaults to e2e-local.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The summary, as Markdown, for a parsed Playwright JSON report. */
export function summarise(report, job = 'e2e-local') {
  const { expected, unexpected, flaky, skipped } = report.stats

  const skippedTitles = []
  const walk = (suite, trail) => {
    const path = suite.title ? [...trail, suite.title] : trail
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (t.status === 'skipped') skippedTitles.push(`${t.projectName}: ${[...path, spec.title].join(' › ')}`)
      }
    }
    for (const child of suite.suites ?? []) walk(child, path)
  }
  for (const suite of report.suites ?? []) walk(suite, [])

  const lines = [`### ${job} result\n`, `Passed ${expected}, failed ${unexpected}, flaky ${flaky}, skipped ${skipped}.\n`]
  if (skippedTitles.length) {
    lines.push('Skipped:\n')
    for (const title of skippedTitles.sort()) lines.push(`- ${title}`)
  }
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, job] = process.argv.slice(2)
  console.log(summarise(JSON.parse(readFileSync(file, 'utf8')), job || undefined))
}
