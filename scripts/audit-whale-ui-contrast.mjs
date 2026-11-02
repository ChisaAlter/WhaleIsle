#!/usr/bin/env node
/**
 * Whale UI colour audit: renders the audit pages in the built viewer under light, dark
 * and transparent-host themes inside real Chromium and fails when any text, control
 * value, placeholder or <select> popup option falls below 3:1 against what is behind it.
 *
 *   npm run prepare:whale-ui && npm run qa:whale-contrast [-- --strict] [-- --shots=<dir>] [-- --json] [-- --no-known]
 *
 * Findings already recorded in whale-ui-contrast/known-findings.json are reported but do not fail the run;
 * --no-known ignores that list and --strict also fails on warnings (< 4.5:1) and on stale known entries.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatReport, verdict } from './whale-ui-contrast/report.mjs'

const knownFindingsPath = new URL('./whale-ui-contrast/known-findings.json', import.meta.url)

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const flags = process.argv.slice(2)
const strict = flags.includes('--strict')
const raw = flags.includes('--json')
const forwarded = flags.filter((flag) => /^--(viewer|shots)=/.test(flag))
const known = flags.includes('--no-known') ? [] : JSON.parse(readFileSync(knownFindingsPath, 'utf8'))
const timeoutMs = Number(process.env.WHALE_CONTRAST_TIMEOUT_MS) || 300_000

function stopTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
  else child.kill('SIGKILL')
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'whale-contrast-run-'))
const outPath = path.join(scratch, 'result.json')
let exitCode = 1
try {
  const electron = require('electron')
  if (typeof electron !== 'string' || !existsSync(electron)) throw new Error('The audit needs a local Electron binary (npm ci).')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [
    path.join(root, 'scripts', 'whale-ui-contrast', 'electron-main.cjs'),
    `--user-data-dir=${path.join(scratch, 'profile')}`, '--no-first-run', `--out=${outPath}`, ...forwarded,
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timer = setTimeout(() => stopTree(child), timeoutMs)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  clearTimeout(timer)
  if (!existsSync(outPath)) throw new Error(`The audit wrote no result (exit ${code}).\n${stderr.trim().split('\n').slice(-8).join('\n')}`)
  const result = JSON.parse(readFileSync(outPath, 'utf8'))
  console.log(raw ? JSON.stringify(result, null, 2) : formatReport(result, { strict, known }))
  exitCode = verdict(result, { strict, known }).ok ? 0 : 1
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 })
}
process.exitCode = exitCode
