import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

/**
 * Opt-in escape hatch for environments where the smoke fixture must be a REAL
 * existing Git workspace: this task forbids creating commits, and
 * `initGitWorkspace()` would have to run `git init` + `git add` + `git commit`.
 *
 * The mode is deliberately explicit (env var, never a default) and only selects
 * a workspace; it never initializes, commits, branches or cleans one up.
 */
export const EXISTING_WORKSPACE_ENV = 'DSHD_SMOKE_EXISTING_WORKSPACE'

export function gitQuery(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status,
  }
}

/**
 * Resolve the opt-in existing workspace. Returns `null` when the mode is off so
 * callers keep the historical throwaway-fixture behavior untouched.
 */
export function resolveExistingWorkspace(env = process.env) {
  const raw = env[EXISTING_WORKSPACE_ENV]
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const resolved = path.resolve(raw.trim())
  if (!existsSync(resolved)) {
    throw new Error(`${EXISTING_WORKSPACE_ENV} points at a missing path: ${resolved}`)
  }
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`${EXISTING_WORKSPACE_ENV} must point at a directory: ${resolved}`)
  }
  const gitDir = gitQuery(resolved, ['rev-parse', '--git-dir'])
  if (!gitDir.ok) {
    throw new Error(
      `${EXISTING_WORKSPACE_ENV} must point at a readable Git workspace: ${resolved} `
      + `(git rev-parse --git-dir failed: ${gitDir.stderr || gitDir.stdout || 'no output'})`,
    )
  }
  return resolved
}

/**
 * Read-only identity of an existing workspace. Never mutates the repository;
 * an unborn HEAD is reported as such instead of being treated as an error.
 */
export function readWorkspaceGitIdentity(workspace) {
  const gitDir = gitQuery(workspace, ['rev-parse', '--absolute-git-dir'])
  const branch = gitQuery(workspace, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const head = gitQuery(workspace, ['rev-parse', 'HEAD'])
  const committed = head.ok
  return {
    workspace,
    gitDir: gitDir.ok ? gitDir.stdout : null,
    branch: committed && branch.ok ? branch.stdout : null,
    head: committed ? head.stdout : null,
    committed,
  }
}

export function createSmokeDirs(prefix, options = {}) {
  const existingWorkspace = options.existingWorkspace === undefined
    ? resolveExistingWorkspace()
    : options.existingWorkspace
  const smokeRoot = mkdtempSync(path.join(os.tmpdir(), prefix))
  const userData = path.join(smokeRoot, 'user-data')
  mkdirSync(userData, { recursive: true })
  if (existingWorkspace) {
    const workspaceReal = assertWorkspaceOutsideScratchRoot(smokeRoot, existingWorkspace)
    return {
      smokeRoot,
      userData,
      workspace: workspaceReal,
      resultPath: path.join(userData, 'dshd-smoke.json'),
      externalWorkspace: true,
      gitIdentity: readWorkspaceGitIdentity(workspaceReal),
    }
  }
  const workspace = path.join(smokeRoot, 'workspace')
  mkdirSync(workspace, { recursive: true })
  return {
    smokeRoot,
    userData,
    workspace,
    resultPath: path.join(userData, 'dshd-smoke.json'),
    externalWorkspace: false,
    gitIdentity: null,
  }
}

/**
 * The supplied workspace must stay outside the throwaway smoke root, otherwise
 * the runner's `rmSync(smokeRoot, { recursive: true })` cleanup could delete a
 * real repository. Returns the resolved workspace path.
 */
export function assertWorkspaceOutsideScratchRoot(smokeRoot, workspace) {
  const smokeRootReal = realpathSync(smokeRoot)
  const workspaceReal = realpathSync(workspace)
  const inside = workspaceReal === smokeRootReal
    || workspaceReal.startsWith(smokeRootReal + path.sep)
  if (inside) {
    throw new Error(
      `${EXISTING_WORKSPACE_ENV} must not point inside the smoke scratch root: ${workspaceReal}`,
    )
  }
  return workspaceReal
}

export function writeSmokeConfig(userData, workspace, port) {
  writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    workspace,
    host: '127.0.0.1',
    port,
    closeToTray: false,
    openAtLogin: false,
    openDevTools: false,
    remoteEnabled: false,
  }, null, 2))
}

export function initGitWorkspace(workspace, options = {}) {
  writeFileSync(path.join(workspace, 'README.md'), 'smoke\n')
  const git = (args) => {
    const result = spawnSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      windowsHide: true,
    })
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`)
    }
  }
  const branch = typeof options.branch === 'string' && options.branch.trim()
    ? options.branch.trim()
    : ''
  git(branch ? ['init', '-b', branch] : ['init'])
  // UI-driven follow-up commits must not depend on the host's global identity.
  git(['config', '--local', 'user.name', 'dsh-smoke'])
  git(['config', '--local', 'user.email', 'smoke@example.test'])
  git(['add', '.'])
  git([
    'commit',
    '-m',
    'smoke',
  ])
}

/**
 * Prepare the workspace the smoke will drive.
 *
 * Default mode keeps the historical throwaway fixture. Existing-workspace mode
 * performs NO Git mutation at all: the caller supplied a real repository and the
 * smoke only reads it.
 */
export function prepareSmokeWorkspace(dirs, options = {}) {
  if (dirs.externalWorkspace) {
    const identity = dirs.gitIdentity || readWorkspaceGitIdentity(dirs.workspace)
    return { mode: 'existing-workspace', gitIdentity: identity }
  }
  initGitWorkspace(dirs.workspace, options)
  return { mode: 'throwaway-fixture', gitIdentity: null }
}

export function electronSpawnEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.DSH_HOME
  delete env.DSHD_HOME
  return env
}

export function assertDesktopHarnessHome(userData, result = {}) {
  const home = path.join(userData, 'dsh-home')
  if (!existsSync(home)) {
    throw new Error(`desktop Harness home was not created at ${home}`)
  }
  const recorded = typeof result.desktopHome === 'string' ? result.desktopHome : ''
  if (recorded && realpathSync(recorded) !== realpathSync(home)) {
    throw new Error(`desktopHome mismatch: recorded=${recorded} expected=${home}`)
  }
  if (result.electronEnv?.DSH_HOME) {
    throw new Error(`Electron process.env.DSH_HOME leaked: ${result.electronEnv.DSH_HOME}`)
  }
  const logs = Array.isArray(result.bootLogs) ? result.bootLogs : []
  const homeLog = result.homeLog || logs.find((line) => /Harness \u5bb6\u76ee\u5f55/.test(String(line)))
  if (!homeLog) {
    throw new Error('boot logs missing Harness 家目录')
  }
  if (!String(homeLog).toLowerCase().includes('dsh-home')) {
    throw new Error(`Harness 家目录 is not under dsh-home: ${homeLog}`)
  }
  return home
}

export function assertSmokeResult(outcome, result) {
  const buttons = Array.isArray(result.result?.titlebarButtons) ? result.result.titlebarButtons : []
  const hasTerminalToggle = buttons.some((label) => /terminal|\u7ec8\u7aef/i.test(label))
  const hasSurfacesToggle = buttons.some((label) => /right panel|surfaces|\u53f3\u4fa7\u680f/i.test(label))
  const hits = result.result?.titlebarHits?.hits || {}
  const hitCount = Number(hits.surfaces || 0) + Number(hits.branch || 0) + Number(hits.git || 0)
  const uiOk = result.result?.hasFrame === true
    && result.result?.hasTitlebar === true
    && hasTerminalToggle
    && hasSurfacesToggle
    && result.result?.hasDragStrip !== true
    && result.result?.hasDragMark !== true
    && result.result?.hasHitMark !== true
    && result.result?.captionRegion === 'drag'
    && result.result?.hasBootShellApi === true
    && result.result?.bootShellApiIsScoped === true
    && result.result?.hasHarnessShellApi === true
    && result.result?.harnessShellApiIsScoped === true
    && hitCount > 0
    && Number(hits.surfaces) > 0
    && Number(hits.branch) > 0
    && Number(hits.git) > 0
    && result.result?.titlebarHits?.error == null
    && (process.env.DSH_THEME_SMOKE !== '1' || result.result?.themeSmoke?.ok === true)
    && Array.isArray(result.pageErrors)
    && result.pageErrors.length === 0
  if (outcome.code !== 0 || result.ok !== true || !uiOk || result.ptyStatus !== 'echoed:ok') {
    throw new Error(`Smoke failed: ${JSON.stringify({ outcome, result })}`)
  }
}
