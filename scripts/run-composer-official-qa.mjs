#!/usr/bin/env node
/**
 * Real-machine Electron suite for composer draft + official triggers + Remote on.
 *
 * Starts a fresh Electron with remoteEnabled=true on disk, walks only the
 * composer-official cases, and fails if any required case is missing or red.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort,
} from './smoke-workspace.mjs'
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js'

const require = createRequire(import.meta.url)
const { assertComposerOfficialQaResult } = require('../src/main/composer-official-qa.js')

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
    throw new Error('Composer official QA needs a local Electron binary (npm ci, then node node_modules/electron/install.js).')
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
      reject(new Error(`Composer official QA timed out after ${timeoutMs}ms.`))
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
  console.log('\nComposer official QA cases:')
  for (const step of steps) {
    const mark = step.ok ? 'PASS' : (step.optional ? 'SKIP' : 'FAIL')
    const detail = step.detail ? `  ${step.detail}` : ''
    console.log(`  ${mark.padEnd(4)}  ${step.name}${detail}`)
  }
}

function writeComposerQaConfig(userData, workspace, port) {
  // remoteEnabled:true on disk proves the gateway listens after Harness is ready.
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: true,
    remoteMode: 'lan',
    remoteRelayUrl: '',
  }, null, 2))
}

const dirs = createSmokeDirs('dsh-composer-qa-')
const keepRequested = process.env.DSH_SMOKE_KEEP === '1'
let keepArtifacts = keepRequested

try {
  const executable = electronExecutable()
  initGitWorkspace(dirs.workspace)
  writeFileSync(path.join(dirs.workspace, 'note.md'), 'composer official qa\nline-two\n')
  const port = await reservePort()
  writeComposerQaConfig(dirs.userData, dirs.workspace, port)

  console.log(`Composer official QA: ${executable}`)
  console.log(`Config forces remoteEnabled=true; gateway must listen after Harness is ready.`)
  const outcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_COMPOSER: '1',
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`QA result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const qa = result.result?.composerOfficialQa || result.composerOfficialQa
  printStepTable(qa)
  assertDesktopHarnessHome(dirs.userData, result)
  assertSmokeResult(outcome, result)
  assertComposerOfficialQaResult(qa)
  console.log(`Composer official QA passed on port ${port}.`)
} catch (error) {
  keepArtifacts = true
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (keepArtifacts) {
    console.log(`QA artifacts kept at ${dirs.smokeRoot}`)
    if (existsSync(path.join(dirs.userData, 'dshd-composer-qa.png'))) {
      console.log(`Screenshot: ${path.join(dirs.userData, 'dshd-composer-qa.png')}`)
    }
  } else if (!keepRequested) {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn(`Could not remove QA artifacts at ${dirs.smokeRoot}: ${error.message}`)
    }
  }
}
