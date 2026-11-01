/** Turns the audit's JSON into a console report and a pass/fail verdict. */

function pagesOf(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function documentsOf(entry) {
  return [{ label: entry.page, ...entry.main }, ...(entry.frames ?? [])]
}

/**
 * Class names inside the declarative components are minified hashes, so a known finding is
 * matched on what a reader sees (page, kind, text) and the appearance it was recorded under.
 */
function matchesKnown(known, entry, finding) {
  return known.findIndex((item) => item.page === entry.page && item.kind === finding.kind
    && item.text === finding.text && item.appearance === entry.appearance)
}

/** Every failing finding, split into new regressions and ones already recorded in the known list. */
export function classify(result, known = []) {
  const found = new Set()
  const entries = pagesOf(result).map((entry) => {
    const documents = documentsOf(entry).map((document) => ({
      ...document,
      findings: (document.findings ?? []).map((finding) => {
        const index = finding.severity === 'fail' ? matchesKnown(known, entry, finding) : -1
        if (index >= 0) found.add(index)
        return { ...finding, known: index >= 0 ? known[index].reason : undefined }
      }),
    }))
    return { entry, documents }
  })
  const stale = known.filter((_, index) => !found.has(index))
  return { entries, stale }
}

export function tally(result, known = []) {
  const totals = { checked: 0, fail: 0, known: 0, warn: 0, diagnostics: 0, stale: 0 }
  const { entries, stale } = classify(result, known)
  totals.stale = stale.length
  for (const { entry, documents } of entries) {
    totals.diagnostics += entry.diagnostics?.length ?? 0
    for (const document of documents) {
      totals.checked += document.checked ?? 0
      for (const finding of document.findings) {
        if (finding.known) totals.known += 1
        else totals[finding.severity] += 1
      }
    }
  }
  return totals
}

/**
 * New failures and page diagnostics break the run. Warnings (readable but under AA) and stale
 * known entries do so only when `strict`.
 */
export function verdict(result, { strict = false, known = [] } = {}) {
  const totals = tally(result, known)
  if (result?.error || pagesOf(result).length === 0) return { ok: false, totals }
  const strictFailures = strict ? totals.warn + totals.stale : 0
  return { ok: totals.fail + totals.diagnostics + strictFailures === 0, totals }
}

function describeFinding(finding) {
  const subject = finding.control ? `${finding.control} > ${finding.selector}` : finding.selector
  const repeat = finding.count > 1 ? `  x${finding.count}` : ''
  const note = finding.gradient ? '  (over a gradient: unverified)' : ''
  const mark = finding.known ? 'KNOWN' : finding.severity === 'fail' ? 'FAIL' : 'WARN'
  return `${mark.padEnd(5)} ${finding.kind.padEnd(13)} ${subject}  "${finding.text}"  `
    + `${finding.foreground} on ${finding.background}  ${finding.ratio.toFixed(2)}:1${repeat}${note}`
}

export function formatReport(result, { strict = false, known = [] } = {}) {
  if (result?.error) return `Contrast audit could not run:\n${result.error}`
  const lines = [`Whale UI contrast audit (${result.viewer})`]
  const { entries, stale } = classify(result, known)
  let theme = ''
  for (const { entry, documents } of entries) {
    if (entry.theme !== theme) { theme = entry.theme; lines.push('', `[${theme}]`) }
    const checked = documents.reduce((sum, document) => sum + (document.checked ?? 0), 0)
    const findings = documents.flatMap((document) => document.findings.map((finding) => ({ document: document.label, ...finding })))
    const fails = findings.filter((finding) => finding.severity === 'fail' && !finding.known).length
    const recorded = findings.filter((finding) => finding.known).length
    lines.push(`  ${entry.page}: ${checked} text runs, ${fails} fail, ${recorded} known, ${findings.length - fails - recorded} warn`)
    for (const diagnostic of entry.diagnostics ?? []) lines.push(`    DIAG  ${diagnostic.phase}/${diagnostic.code}: ${diagnostic.message}`)
    for (const finding of findings) lines.push(`    ${describeFinding(finding)}${finding.document === entry.page ? '' : `  [${finding.document}]`}`)
  }
  for (const item of stale) {
    lines.push('', `STALE known finding (no longer reproduced, remove it from known-findings.json): ${item.appearance} ${item.page} ${item.kind} "${item.text}"`)
  }
  const { ok, totals } = verdict(result, { strict, known })
  lines.push('', `${ok ? 'PASS' : 'FAIL'}: ${totals.checked} text runs, ${totals.fail} new fail (< 3:1), ${totals.known} known, `
    + `${totals.warn} warn (< 4.5:1), ${totals.diagnostics} page diagnostics, ${totals.stale} stale known`)
  return lines.join('\n')
}
