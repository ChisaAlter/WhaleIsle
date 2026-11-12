#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'

const require = createRequire(import.meta.url)
const { assertReleaseQaResult } = require('../src/main/release-ui-walk.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 600_000

function electronExecutable() {
  if (process.env.ELECTRON_PATH && existsSync(process.env.ELECTRON_PATH)) {
    return process.env.ELECTRON_PATH
  }
  const candidates = [
    path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
  ]
  const found = candidates.find((item) => existsSync(item))
  if (!found) {
    throw new Error('Source QA needs a local Electron binary (npm ci, then node node_modules/electron/install.js).')
  }
  return found
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      stopProcessTree(child)
      reject(new Error(`Source QA timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

function printStepTable(qa) {
  const steps = Array.isArray(qa?.steps) ? qa.steps : []
  if (steps.length === 0) {
    console.log('Release QA recorded no steps.')
    return
  }
  console.log('\nRelease QA steps:')
  for (const step of steps) {
    const mark = step.ok ? 'PASS' : (step.optional ? 'SKIP' : 'FAIL')
    const detail = step.detail ? `  ${step.detail}` : ''
    console.log(`  ${mark.padEnd(4)}  ${step.name}${detail}`)
  }
}

const dirs = createSmokeDirs('dsh-source-qa-')
const keepRequested = process.env.DSH_SMOKE_KEEP === '1'
let keepArtifacts = keepRequested

try {
  const executable = electronExecutable()
  initGitWorkspace(dirs.workspace)
  writeFileSync(path.join(dirs.workspace, 'note.md'), 'post-merge ui\n')
  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)

  console.log(`Source release QA: ${executable}`)
  const outcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run', '--disable-backgrounding-occluded-windows'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA: '1',
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`QA result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  printStepTable(result.result?.qa || result.qa)
  assertDesktopHarnessHome(dirs.userData, result)
  assertSmokeResult(outcome, result)
  assertReleaseQaResult({ qa: result.result?.qa || result.qa, ...result })
  console.log(`Source release QA passed on port ${port}.`)
} catch (error) {
  keepArtifacts = true
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (keepArtifacts) {
    console.log(`QA artifacts kept at ${dirs.smokeRoot}`)
    if (existsSync(path.join(dirs.userData, 'dshd-qa.png'))) {
      console.log(`Screenshot: ${path.join(dirs.userData, 'dshd-qa.png')}`)
    }
  } else if (!keepRequested) {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn(`Could not remove QA artifacts at ${dirs.smokeRoot}: ${error.message}`)
    }
  }
}
