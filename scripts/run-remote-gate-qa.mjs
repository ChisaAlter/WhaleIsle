#!/usr/bin/env node
/**
 * Real-machine Electron suite for TC-NEG-001 + TC-REM-001 (unparked Remote).
 * Does not open the pairing URL / phone SPA.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort,
} from './smoke-workspace.mjs'
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js'

const require = createRequire(import.meta.url)
const {
  assertRemoteGateQaResult,
  REMOTE_GATE_CASES,
  REMOTE_GATE_NEG_REM_CASES,
  REMOTE_GATE_COLD_CASES,
  REMOTE_GATE_PARKED_CASES,
} = require('../src/main/remote-gate-qa.js')

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
    throw new Error('Remote gate QA needs a local Electron binary (npm ci, then node node_modules/electron/install.js).')
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
      reject(new Error(`Remote gate QA timed out after ${timeoutMs}ms.`))
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
    console.log('Remote gate QA recorded no steps.')
    return
  }
  console.log('\nRemote gate steps:')
  for (const step of steps) {
    const mark = step.ok ? 'PASS' : (step.optional ? 'SKIP' : 'FAIL')
    const detail = step.detail ? `  ${step.detail}` : ''
    console.log(`  ${mark.padEnd(4)}  ${step.name}${detail}`)
  }
}

function writeRemoteGateConfig(userData, workspace, port, { remoteEnabled = false } = {}) {
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled,
    remoteMode: 'lan',
    remoteRelayUrl: '',
    quitAfterStart: true,
    autoStartDesktop: true,
  }, null, 2))
}

const dirsFull = createSmokeDirs('dsh-remote-gate-')
const dirsCold = createSmokeDirs('dsh-remote-gate-cold-')
const keepRequested = process.env.DSH_SMOKE_KEEP === '1'
let keepArtifacts = keepRequested

try {
  const executable = electronExecutable()
  initGitWorkspace(dirsFull.workspace)
  writeFileSync(path.join(dirsFull.workspace, 'note.md'), 'remote gate qa\n')
  initGitWorkspace(dirsCold.workspace)
  writeFileSync(path.join(dirsCold.workspace, 'note.md'), 'remote gate cold qa\n')
  const portFull = await reservePort()
  const portCold = await reservePort()
  writeRemoteGateConfig(dirsFull.userData, dirsFull.workspace, portFull, { remoteEnabled: false })
  writeRemoteGateConfig(dirsCold.userData, dirsCold.workspace, portCold, { remoteEnabled: true })

  console.log(`Remote gate QA: ${executable}`)
  console.log('Boot 1: remoteEnabled=false + DSH_QA_REMOTE=1 (NEG+REM).')
  const outcomeFull = await run(executable, ['.', `--user-data-dir=${dirsFull.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_REMOTE: '1',
  }))
  if (!existsSync(dirsFull.resultPath)) {
    keepArtifacts = true
    throw new Error(`Remote gate QA wrote no result file (exit ${outcomeFull.code}${outcomeFull.signal ? ` / ${outcomeFull.signal}` : ''}).`)
  }
  const resultFull = JSON.parse(readFileSync(dirsFull.resultPath, 'utf8'))
  assertDesktopHarnessHome(dirsFull.userData, resultFull)
  if (outcomeFull.code !== 0 || resultFull.ok !== true) {
    throw new Error(`Remote gate boot 1 failed: ${JSON.stringify({
      code: outcomeFull.code,
      ok: resultFull.ok,
      remote: resultFull.result?.remoteGateQa,
      titlebar: resultFull.result?.titlebarHits,
    })}`)
  }
  if (resultFull.result?.remoteGateQa?.parked === true) {
    assertRemoteGateQaResult(resultFull.result.remoteGateQa, { required: REMOTE_GATE_PARKED_CASES })
    printStepTable(resultFull.result.remoteGateQa)
    console.log(`Remote feature parked; skipped cold boot. Artifacts: ${dirsFull.userData}`)
  } else {
  assertRemoteGateQaResult(resultFull.result?.remoteGateQa, { required: REMOTE_GATE_NEG_REM_CASES })

  console.log('Boot 2: remoteEnabled=true + DSH_QA_REMOTE=cold (no setRemote before open).')
  const outcomeCold = await run(executable, ['.', `--user-data-dir=${dirsCold.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_REMOTE: 'cold',
  }))
  if (!existsSync(dirsCold.resultPath)) {
    keepArtifacts = true
    throw new Error(`Remote gate cold QA wrote no result file (exit ${outcomeCold.code}${outcomeCold.signal ? ` / ${outcomeCold.signal}` : ''}).`)
  }
  const resultCold = JSON.parse(readFileSync(dirsCold.resultPath, 'utf8'))
  assertDesktopHarnessHome(dirsCold.userData, resultCold)
  if (outcomeCold.code !== 0 || resultCold.ok !== true) {
    throw new Error(`Remote gate boot 2 failed: ${JSON.stringify({
      code: outcomeCold.code,
      ok: resultCold.ok,
      remote: resultCold.result?.remoteGateQa,
      titlebar: resultCold.result?.titlebarHits,
    })}`)
  }
  assertRemoteGateQaResult(resultCold.result?.remoteGateQa, { required: REMOTE_GATE_COLD_CASES })

  const merged = {
    ok: true,
    steps: [
      ...(resultFull.result?.remoteGateQa?.steps || []),
      ...(resultCold.result?.remoteGateQa?.steps || []),
    ],
  }
  assertRemoteGateQaResult(merged, { required: REMOTE_GATE_CASES })
  printStepTable(merged)
  console.log(`Remote gate QA passed. Artifacts: ${dirsFull.userData} + ${dirsCold.userData}`)
  }
} catch (error) {
  keepArtifacts = true
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  for (const dirs of [dirsFull, dirsCold]) {
    if (existsSync(dirs.resultPath)) {
      try {
        const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
        printStepTable(result.result?.remoteGateQa)
      } catch {
        // ignore parse errors while reporting the primary failure
      }
    }
  }
  process.exitCode = 1
} finally {
  for (const dirs of [dirsFull, dirsCold]) {
    if (!keepArtifacts) {
      rmSync(dirs.smokeRoot, { recursive: true, force: true })
    } else {
      console.error(`Kept smoke dirs: ${dirs.smokeRoot}`)
    }
  }
}
