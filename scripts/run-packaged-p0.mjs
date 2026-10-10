#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import packagedP0Checks from '../src/main/packaged-p0.js'
import runtimeIdentityChecks from '../src/shared/harness-runtime-identity.js'
import {
  assertDesktopHarnessHome, assertSmokeResult, createSmokeDirs, electronSpawnEnv,
  initGitWorkspace, reservePort, writeSmokeConfig,
} from './smoke-workspace.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const distDir = path.join(root, 'dist')
const timeoutMs = Number(process.env.DSH_SMOKE_TIMEOUT_MS) || 600_000
const PRODUCT_EXE = 'Whale Isle.exe'
const STALE_HARNESS_VERSION = '0.1.0-rc.7'

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
  throw new Error(`Packaged P0 is not configured for ${process.platform}.`)
}

function productExeRunning() {
  if (process.platform !== 'win32') {
    return false
  }
  const listed = spawnSync('tasklist', [
    '/FI', `IMAGENAME eq ${PRODUCT_EXE}`,
    '/FO', 'CSV',
    '/NH',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return new RegExp(PRODUCT_EXE.replaceAll('.', '\\.'), 'i').test(listed.stdout || '')
}

function assertProductNotRunning() {
  if (productExeRunning()) {
    throw new Error(
      `${PRODUCT_EXE} is already running (same appId lock). Quit Whale Isle.exe first. Do not kill Cursor.`,
    )
  }
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
      reject(new Error(`Packaged P0 timed out after ${timeoutMs}ms.`))
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

function gitIn(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
}

function seedStaleExtract(dest) {
  mkdirSync(path.join(dest, 'apps', 'cli', 'lib'), { recursive: true })
  mkdirSync(path.join(dest, 'apps', 'web', 'dist'), { recursive: true })
  writeFileSync(path.join(dest, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n')
  writeFileSync(path.join(dest, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n')
  const pkg = path.join(dest, 'packages', 'client', 'ui-user-terminal', 'lib')
  mkdirSync(path.join(pkg, 'assets'), { recursive: true })
  writeFileSync(path.join(pkg, 'client.js'), 'export {}\n')
  for (const name of ['ghostty-vt.wasm', 'ghostty-write-pty.wasm', 'SymbolsNerdFontMono-Regular.woff2']) {
    writeFileSync(path.join(pkg, 'assets', name), 'x')
  }
  writeFileSync(path.join(dest, 'package.json'), `{"version":"${STALE_HARNESS_VERSION}"}\n`)
}

function writeRegisteredSibling(userData, siblingAbs) {
  const storages = path.join(userData, 'dsh-home', 'storages')
  mkdirSync(storages, { recursive: true })
  const now = '2026-08-23T00:00:00.000Z'
  writeFileSync(path.join(storages, 'workspace.json'), `${JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-p0'] },
    tables: {
      workspaces: {
        'ws-p0': {
          path: siblingAbs,
          title: 'PackagedP0',
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2)}\n`)
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject)
  })
}

async function printSetupSha() {
  if (!existsSync(distDir)) {
    console.warn('No dist/ Setup exe; GitHub Release must use the matching Setup for this win-unpacked rehearsal.')
    return
  }
  const setups = readdirSync(distDir).filter((name) => /^Whale-Isle-Setup-.*\.exe$/i.test(name))
  if (setups.length === 0) {
    console.warn('win-unpacked is the gate; GitHub Release must use the matching Setup. No Setup exe in dist/.')
    return
  }
  for (const name of setups) {
    const file = path.join(distDir, name)
    const digest = await sha256File(file)
    console.log(`Setup ${name} SHA256 ${digest}`)
  }
}

async function assertPackagedP0Result(result, extractRoot, resourcesPath) {
  const packagedP0 = result.packagedP0
  if (!packagedP0) {
    throw new Error(
      'dshd-smoke.json has no packagedP0. Diagnose the missing payload before repeating qa:packaged. If rebuilding is needed, run npm run dist with the Node version in root .nvmrc so the asar includes DSH_SMOKE_SIBLING. Quit Whale Isle.exe first.',
    )
  }
  if (packagedP0.ok !== true) {
    throw new Error(`packagedP0 failed: ${JSON.stringify(packagedP0)}`)
  }
  const required = [
    'packaged.sibling.exists',
    'packaged.git.branchList',
    'packaged.pty.create',
    'packaged.ghostty.wasm',
    'packaged.boot.noOpen',
    'packaged.runtime.stamp',
  ]
  const steps = Array.isArray(packagedP0.steps) ? packagedP0.steps : []
  for (const name of required) {
    const row = steps.find((item) => item.name === name)
    if (!row || row.ok !== true) {
      throw new Error(`packagedP0 step failed: ${name} ${JSON.stringify(row || null)}`)
    }
  }
  const runtime = packagedP0.runtime
  if (!runtime || !runtime.root) throw new Error('Packaged P0 has no selected runtime identity')
  const expectedPin = JSON.parse(readFileSync(path.join(root, 'vendor', 'harness-upstream.json'), 'utf8'))
  const expectedResources = runtime.mode === 'installed'
    ? path.join(distDir, 'win-unpacked', 'resources') : resourcesPath
  const expectedArchiveIdentity = await runtimeIdentityChecks.readRuntimeArchiveIdentity(
    path.join(expectedResources, 'vendor', 'deepseek-harness.tar'))
  if (!expectedArchiveIdentity) throw new Error('Missing matching build runtime archive identity')
  const verified = await packagedP0Checks.verifyPackagedRuntime({
    resourcesPath, runtimeRoot: runtime.root, userData: path.dirname(path.dirname(extractRoot)),
    appVersion: packageJson.version, expectedPin, expectedArchiveIdentity,
  })
  if (JSON.stringify(verified) !== JSON.stringify(runtime)) throw new Error('Packaged P0 runtime identity mismatch')
  // NSIS has replaced the application directory and selected its verified
  // runtime. The deliberately stale userData extract must remain unselected.
  if (verified.mode === 'installed') return
  const stamp = path.join(extractRoot, '.dshd-runtime.json')
  if (!existsSync(stamp)) {
    throw new Error(`missing runtime stamp after packaged boot: ${stamp}`)
  }
  const extractedPkg = path.join(extractRoot, 'package.json')
  if (!existsSync(extractedPkg)) {
    throw new Error(`missing extracted package.json after packaged boot: ${extractedPkg}`)
  }
  const extracted = JSON.parse(readFileSync(extractedPkg, 'utf8'))
  if (extracted.version === STALE_HARNESS_VERSION) {
    throw new Error(`stale extract was reused (package.json still ${STALE_HARNESS_VERSION})`)
  }
}

const dirs = createSmokeDirs('dsh-packaged-p0-')
const keepArtifacts = process.env.DSH_SMOKE_KEEP === '1'

try {
  assertProductNotRunning()
  const executable = packagedExecutable()
  if (!existsSync(executable)) {
    throw new Error(
      `Packaged executable not found: ${executable}. For the default dist/win-unpacked path, run npm run dist with the Node version in root .nvmrc before qa:packaged.`,
    )
  }

  initGitWorkspace(dirs.workspace, { branch: 'master' })
  const sibling = path.join(dirs.smokeRoot, 'sibling')
  mkdirSync(sibling, { recursive: true })
  initGitWorkspace(sibling, { branch: 'master' })
  gitIn(sibling, ['branch', '111'])
  const siblingAbs = path.resolve(sibling)
  writeRegisteredSibling(dirs.userData, siblingAbs)

  const extractRoot = path.join(dirs.userData, 'runtime', packageJson.version)
  seedStaleExtract(extractRoot)

  const port = await reservePort()
  writeSmokeConfig(dirs.userData, dirs.workspace, port)

  console.log(`Packaged P0: ${executable}`)
  console.log(`Sibling git repo: ${siblingAbs}`)
  const outcome = await run(executable, [`--user-data-dir=${dirs.userData}`, '--no-first-run'], electronSpawnEnv({
    DSH_SMOKE: '1',
    DSH_SMOKE_SIBLING: siblingAbs,
    // Packaged builds ignore ambient QA/smoke flags; the rehearsal opts in.
    DSHD_ALLOW_PACKAGED_QA: '1',
  }))

  if (!existsSync(dirs.resultPath)) {
    throw new Error(`Smoke result was not written (exit=${outcome.code}, signal=${outcome.signal || 'none'}).`)
  }
  const result = JSON.parse(readFileSync(dirs.resultPath, 'utf8'))
  assertSmokeResult(outcome, result)
  assertDesktopHarnessHome(dirs.userData, result)
  const resourcesPath = process.platform === 'darwin'
    ? path.resolve(path.dirname(executable), '..', 'Resources')
    : path.join(path.dirname(executable), 'resources')
  await assertPackagedP0Result(result, extractRoot, resourcesPath)
  await printSetupSha()
  console.log(`Packaged P0 passed on port ${port}; sibling Git/PTY, Ghostty wasm, selected runtime identity, and --no-open are healthy.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  try {
    await printSetupSha()
  } catch (shaError) {
    console.warn(shaError instanceof Error ? shaError.message : String(shaError))
  }
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
