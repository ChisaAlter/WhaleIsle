#!/usr/bin/env node
/**
 * In-app Appendix A: five composer turns against a seeded desktop dsh-home.
 * Copies official ~/.dsh settings + credentials into the smoke userData home
 * (does not print them), pins agent-default-model to grok-4.6, and drops a
 * copied vision-fallback route so the vision extra can assert pre-send
 * refusal on the text-only model. Does not migrate the product userData.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'
import { killProcessTree, spawnTreeOptions } from '../src/shared/process-tree.js'

const require = createRequire(import.meta.url)
const { assertAppendixAQaResult, pinAgentDefaultModel, stripVisionFallback } = require('../src/main/appendix-a-qa.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 900_000

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
    throw new Error('In-app appendix A needs a local Electron binary.')
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
      reject(new Error(`In-app appendix A timed out after ${timeoutMs}ms.`))
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

function seedDesktopHome(userData) {
  const official = path.join(os.homedir(), '.dsh')
  const settings = path.join(official, 'settings.yaml')
  if (!existsSync(settings)) {
    throw new Error(`Official ${settings} is missing; cannot seed the in-app appendix A home.`)
  }
  const home = path.join(userData, 'dsh-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'settings.yaml'), pinAgentDefaultModel(stripVisionFallback(readFileSync(settings, 'utf8'))))
  const creds = path.join(official, '.credentials.yaml')
  if (existsSync(creds)) {
    copyFileSync(creds, path.join(home, '.credentials.yaml'))
  }
  return home
}

function printStepTable(qa) {
  const steps = Array.isArray(qa?.steps) ? qa.steps : []
  console.log('\nIn-app appendix A:')
  for (const step of steps) {
    const mark = step.ok ? 'PASS' : 'FAIL'
    const detail = step.detail ? `  ${step.detail}` : ''
    console.log(`  ${mark.padEnd(4)}  ${step.name}${detail}`)
  }
}

const dirs = createSmokeDirs('dsh-appendix-qa-')
const keepRequested = process.env.DSH_SMOKE_KEEP === '1'
let keepArtifacts = keepRequested

try {
  const executable = electronExecutable()
  initGitWorkspace(dirs.workspace)
  writeFileSync(
    path.join(dirs.workspace, 'README.md'),
    '# Deepseek-Harness-Desktop\n\nElectron desktop shell for DeepSeek Harness Web UI.\n',
  )
  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)
  seedDesktopHome(dirs.userData)

  console.log(`In-app appendix A: ${executable}`)
  console.log('Seeded desktop dsh-home from official ~/.dsh settings (contents not logged).')
  const outcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_QA_APPENDIX: '1',
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`Appendix result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  const qa = result.result?.appendixQa || result.appendixQa
  printStepTable(qa)
  assertDesktopHarnessHome(dirs.userData, result)
  assertSmokeResult(outcome, result)
  assertAppendixAQaResult(qa)
  console.log(`In-app appendix A passed on port ${port}.`)
} catch (error) {
  keepArtifacts = true
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (keepArtifacts) {
    console.log(`QA artifacts kept at ${dirs.smokeRoot}`)
    if (existsSync(path.join(dirs.userData, 'dshd-appendix-qa.png'))) {
      console.log(`Screenshot: ${path.join(dirs.userData, 'dshd-appendix-qa.png')}`)
    }
  } else if (!keepRequested) {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn(`Could not remove QA artifacts at ${dirs.smokeRoot}: ${error.message}`)
    }
  }
}
