#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  prepareSmokeWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const distDir = path.join(root, 'dist')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 300_000
const macosEvidenceDir = process.platform === 'darwin' ? path.join(distDir, 'macos-chrome-evidence') : null
const macosOutput = []
let macosCrash = null

function packagedExecutable() {
  if (process.env.DSH_SMOKE_EXE) {
    return path.resolve(process.env.DSH_SMOKE_EXE)
  }
  if (process.platform === 'win32') {
    return path.join(distDir, 'win-unpacked', `${packageJson.productName}.exe`)
  }
  if (process.platform === 'darwin') {
    const appExecutable = path.join(`${packageJson.productName}.app`, 'Contents', 'MacOS', packageJson.productName)
    for (const output of ['mac-arm64', 'mac-universal', 'mac']) {
      const candidate = path.join(distDir, output, appExecutable)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error(`Packaged smoke is not configured for ${process.platform}.`)
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
    const startedAt = Date.now()
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
      reject(new Error(`Packaged smoke timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      if (macosEvidenceDir) macosOutput.push(chunk)
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (macosEvidenceDir) macosOutput.push(chunk)
      process.stderr.write(chunk)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })

    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (macosEvidenceDir && signal) macosCrash = { pid: child.pid, startedAt, signal }
      resolve({ code, signal })
    })
  })
}

const dirs = createSmokeDirs('dsh-packaged-smoke-')
const keepArtifacts = process.env.DSH_SMOKE_KEEP === '1'

try {
  if (macosEvidenceDir) mkdirSync(macosEvidenceDir, { recursive: true })
  const executable = packagedExecutable()
  if (!existsSync(executable)) {
    throw new Error(`Packaged executable not found: ${executable}`)
  }

  const workspacePrep = prepareSmokeWorkspace(dirs)
  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)

  console.log(`Packaged smoke: ${executable}`)
  console.log(`Workspace mode: ${workspacePrep.mode}`)
  if (workspacePrep.gitIdentity) {
    console.log(`Workspace: ${workspacePrep.gitIdentity.workspace}`)
    console.log(`Git identity: ${JSON.stringify(workspacePrep.gitIdentity)}`)
  }
  const outcome = await run(executable, [`--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    // Packaged builds ignore ambient QA/smoke flags; the rehearsal opts in.
    DSHD_ALLOW_PACKAGED_QA: '1',
    ...(macosEvidenceDir ? {
      DSH_MACOS_CHROME_EVIDENCE_DIR: macosEvidenceDir,
      ELECTRON_ENABLE_STACK_DUMPING: '1',
    } : {}),
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`Smoke result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  assertSmokeResult(outcome, result)
  assertDesktopHarnessHome(dirs.userData, result)
  console.log(`Packaged smoke passed on port ${port}; UI, titlebar hits, and PTY probes are healthy.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (macosEvidenceDir) {
    writeFileSync(path.join(macosEvidenceDir, 'packaged-smoke.log'), Buffer.concat(macosOutput))
    if (existsSync(dirs.resultPath)) copyFileSync(dirs.resultPath, path.join(macosEvidenceDir, 'dshd-smoke.json'))
    const startupResult = path.join(dirs.userData, 'last-desktop-start.json')
    if (existsSync(startupResult)) copyFileSync(startupResult, path.join(macosEvidenceDir, 'last-desktop-start.json'))
    if (macosCrash) {
      // macOS can write its report shortly after process exit. Read once,
      // retaining only reports for this rehearsal PID and launch interval.
      await new Promise(resolve => setTimeout(resolve, 2000))
      const reportsDir = path.join(homedir(), 'Library', 'Logs', 'DiagnosticReports')
      try {
        for (const name of readdirSync(reportsDir).filter(name => name.endsWith('.ips'))) {
          const file = path.join(reportsDir, name)
          if (statSync(file).mtimeMs < macosCrash.startedAt) continue
          const report = readFileSync(file, 'utf8')
          if (!new RegExp(`"pid"\\s*:\\s*${macosCrash.pid}(?:\\s*[,}])`).test(report)) continue
          copyFileSync(file, path.join(macosEvidenceDir, name))
          console.log(`Mac crash report retained: ${name}`)
        }
      } catch (error) {
        console.warn(`Mac crash report unavailable: ${error.message}`)
      }
    }
  }
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
