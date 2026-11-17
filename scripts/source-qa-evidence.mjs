import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Export only the scripted step results and one screenshot, never the profile,
// credentials, browser cache, workspace or complete runtime.
/** @param {{resultPath: string, userData: string}} dirs
 * @param {string | undefined} evidenceDir
 * @param {{error?: unknown}} [options]
 */
export function writeSourceQaEvidence(dirs, evidenceDir, { error = null } = {}) {
  if (!evidenceDir) return
  mkdirSync(evidenceDir, { recursive: true })
  let result = null
  if (existsSync(dirs.resultPath)) result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const qa = result?.result?.qa || result?.qa
  /** @type {{name: string, ok: boolean, optional?: boolean}[]} */
  const recordedSteps = qa?.steps || []
  const steps = recordedSteps.map(({ name, ok, optional }) => ({ name, ok, optional: Boolean(optional) }))
  const summary = {
    platform: process.platform,
    arch: process.arch,
    ok: !error && result?.ok === true && qa?.ok === true,
    // assertSmokeResult's exception can contain complete startup logs and URLs.
    // Those belong in the local diagnostic log, never in exported evidence.
    error: error ? 'Scripted UI walkthrough failed; consult the CI log for diagnostics.' : null,
    steps,
  }
  writeFileSync(path.join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  const lines = [
    `Source UI walkthrough: ${summary.platform}/${summary.arch} ${summary.ok ? 'PASS' : 'FAIL'}`,
    ...(summary.error ? [`Error: ${summary.error}`] : []),
    ...steps.map(step => `${step.ok ? 'PASS' : step.optional ? 'SKIP' : 'FAIL'} ${step.name}`),
  ]
  writeFileSync(path.join(evidenceDir, 'summary.txt'), `${lines.join('\n')}\n`)
  const screenshot = path.join(dirs.userData, 'dshd-qa.png')
  if (existsSync(screenshot)) copyFileSync(screenshot, path.join(evidenceDir, 'walkthrough.png'))
}
