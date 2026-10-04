#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  prepareSmokeWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 300_000

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
    throw new Error('Source smoke needs a local Electron binary (npm ci, then node node_modules/electron/install.js).')
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
      // Coordinate input and layout transitions require a visible GUI window.
      windowsHide: false,
    })
    const timer = setTimeout(() => {
      stopProcessTree(child)
      reject(new Error(`Source smoke timed out after ${timeoutMs}ms.`))
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

const dirs = createSmokeDirs('dsh-source-smoke-')
const keepArtifacts = process.env.DSH_SMOKE_KEEP === '1'

try {
  const executable = electronExecutable()
  const workspacePrep = prepareSmokeWorkspace(dirs)
  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)

  console.log(`Source smoke: ${executable}`)
  console.log(`Workspace mode: ${workspacePrep.mode}`)
  if (workspacePrep.gitIdentity) {
    console.log(`Workspace: ${workspacePrep.gitIdentity.workspace}`)
    console.log(`Git identity: ${JSON.stringify(workspacePrep.gitIdentity)}`)
  }
  const outcome = await run(executable, ['.', `--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`Smoke result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  assertSmokeResult(outcome, result)
  assertDesktopHarnessHome(dirs.userData, result)
  console.log(`Source smoke passed on port ${port}; UI, titlebar hits, and PTY probes are healthy.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (keepArtifacts) {
    console.log(`Smoke artifacts kept at ${dirs.smokeRoot}`)
  } else {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.warn(`Could not remove smoke artifacts at ${dirs.smokeRoot}: ${error.message}`)
    }
  }
}
