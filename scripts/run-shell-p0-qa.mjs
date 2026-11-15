#!/usr/bin/env node
/**
 * Desktop-shell P0: shortcuts, tray/close, persist relaunch, skip-plugins + crash recovery.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js'

const require = createRequire(import.meta.url)
const {
  assertShellP0QaResult,
  assertPersistQaResult,
  assertRecoveryQaResult,
} = require('../src/main/shell-p0-qa.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 420_000

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
    throw new Error('Shell P0 QA needs a local Electron binary.')
  }
  return found
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null) return
  killProcessTree(child.pid).catch((error) => {
    console.warn(`stopProcessTree failed for pid ${child.pid}: ${error.message}`)
  })
}

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      ...spawnTreeOptions(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      stopProcessTree(child)
      reject(new Error(`Shell P0 QA timed out after ${timeoutMs}ms.`))
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

function printStepTable(title, qa) {
  const steps = Array.isArray(qa?.steps) ? qa.steps : []
  console.log(`\n${title}:`)
  for (const step of steps) {
    const mark = step.ok ? 'PASS' : (step.optional ? 'SKIP' : 'FAIL')
    const detail = step.detail ? `  ${step.detail}` : ''
    console.log(`  ${mark.padEnd(4)}  ${step.name}${detail}`)
  }
}

function seedSkipSticky(userData) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const file = path.join(userData, 'config.json')
  const config = JSON.parse(readFileSync(file, 'utf8'))
  config.pluginRecovery = {
    skipUserPlugins: true,
    reason: 'qa skip sticky',
    at: new Date().toISOString(),
    appVersion: pkg.version,
  }
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
}

const dirs = createSmokeDirs('dsh-shell-qa-')
const keepRequested = process.env.DSH_SMOKE_KEEP === '1'
let keepArtifacts = keepRequested

try {
  const executable = electronExecutable()
  initGitWorkspace(dirs.workspace)
  writeFileSync(path.join(dirs.workspace, 'note.md'), 'shell p0\n')
  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)

  console.log(`Shell P0 QA: ${executable}`)
  const shellOutcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_SHELL: '1',
  }))
  if (!existsSync(dirs.resultPath)) {
    throw new Error(`Shell result was not written (exit=${shellOutcome.code}).`)
  }
  const shellResult = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const shellQa = shellResult.result?.shellP0Qa || shellResult.shellP0Qa
  printStepTable('Shell P0', shellQa)
  assertDesktopHarnessHome(dirs.userData, shellResult)
  assertSmokeResult(shellOutcome, shellResult)
  assertShellP0QaResult(shellQa)

  const persistOutcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_PERSIST: '1',
  }))
  const persistResult = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const persistQa = persistResult.result?.persistQa || persistResult.persistQa
  printStepTable('Persist', persistQa)
  assertSmokeResult(persistOutcome, persistResult)
  assertPersistQaResult(persistQa)

  seedSkipSticky(dirs.userData)
  const recoveryOutcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_RECOVERY: '1',
  }))
  const recoveryResult = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const recoveryQa = recoveryResult.result?.recoveryQa || recoveryResult.recoveryQa
  printStepTable('Recovery', recoveryQa)
  assertSmokeResult(recoveryOutcome, recoveryResult)
  assertRecoveryQaResult(recoveryQa)

  console.log(`Shell / persist / recovery QA passed on port ${port}.`)
} catch (error) {
  keepArtifacts = true
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (keepArtifacts) {
    console.log(`QA artifacts kept at ${dirs.smokeRoot}`)
  } else if (!keepRequested) {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn(`Could not remove QA artifacts at ${dirs.smokeRoot}: ${error.message}`)
    }
  }
}
