import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  EXISTING_WORKSPACE_ENV,
  assertDesktopHarnessHome,
  assertWorkspaceOutsideScratchRoot,
  createSmokeDirs,
  initGitWorkspace,
  prepareSmokeWorkspace,
  readWorkspaceGitIdentity,
  resolveExistingWorkspace,
} from './smoke-workspace.mjs'

/**
 * The existing-workspace mode exists because this task forbids creating commits,
 * while the default smoke fixture has to run `git init` + `add` + `commit`. These
 * tests pin both halves of that contract: the default path still commits, and the
 * opt-in path performs no Git mutation and never deletes the supplied workspace.
 */

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0

function makeTempRoot(t) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'dshd-smoke-workspace-test-')))
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // A leftover temp dir must not fail the suite.
    }
  })
  return root
}

test('desktop home accepts filesystem aliases but rejects a different physical directory', (t) => {
  const root = makeTempRoot(t)
  const userData = path.join(root, 'user-data')
  const home = path.join(userData, 'dsh-home')
  mkdirSync(home, { recursive: true })
  const alias = path.join(root, 'user-data-alias')
  symlinkSync(userData, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const result = { desktopHome: path.join(alias, 'dsh-home'), homeLog: `[app] Harness 家目录 ${home}` }
  assert.equal(assertDesktopHarnessHome(userData, result), home)
  const otherHome = path.join(root, 'other-home')
  mkdirSync(otherHome)
  assert.throws(() => assertDesktopHarnessHome(userData, { ...result, desktopHome: otherHome }), /desktopHome mismatch/)
})

function makeRepo(root, name = 'repo') {
  const repo = path.join(root, name)
  mkdirSync(repo, { recursive: true })
  const run = (args) => spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'dshd-smoke-test',
      GIT_AUTHOR_EMAIL: 'smoke@example.test',
      GIT_COMMITTER_NAME: 'dshd-smoke-test',
      GIT_COMMITTER_EMAIL: 'smoke@example.test',
    },
  })
  run(['init', '-b', 'main'])
  writeFileSync(path.join(repo, 'README.md'), 'existing\n')
  run(['add', '.'])
  run(['commit', '-m', 'existing'])
  return repo
}

test('the mode is opt-in: without the env var resolveExistingWorkspace returns null', () => {
  assert.equal(resolveExistingWorkspace({}), null)
  assert.equal(resolveExistingWorkspace({ [EXISTING_WORKSPACE_ENV]: '   ' }), null)
  assert.equal(resolveExistingWorkspace({ [EXISTING_WORKSPACE_ENV]: undefined }), null)
})

test('a missing path, a file path and a non-Git directory are rejected', (t) => {
  const root = makeTempRoot(t)

  assert.throws(
    () => resolveExistingWorkspace({ [EXISTING_WORKSPACE_ENV]: path.join(root, 'absent') }),
    /missing path/,
  )

  const filePath = path.join(root, 'not-a-dir.txt')
  writeFileSync(filePath, 'x\n')
  assert.throws(
    () => resolveExistingWorkspace({ [EXISTING_WORKSPACE_ENV]: filePath }),
    /must point at a directory/,
  )

  const plainDir = path.join(root, 'plain')
  mkdirSync(plainDir, { recursive: true })
  assert.throws(
    () => resolveExistingWorkspace({ [EXISTING_WORKSPACE_ENV]: plainDir }),
    /readable Git workspace/,
  )
})

test('the default (no env var) path still creates and commits a throwaway fixture', { skip: !gitAvailable }, (t) => {
  const root = makeTempRoot(t)
  const previous = process.env[EXISTING_WORKSPACE_ENV]
  delete process.env[EXISTING_WORKSPACE_ENV]
  t.after(() => {
    if (previous === undefined) delete process.env[EXISTING_WORKSPACE_ENV]
    else process.env[EXISTING_WORKSPACE_ENV] = previous
  })

  const dirs = createSmokeDirs('dshd-smoke-default-test-')
  t.after(() => {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best effort
    }
  })

  assert.equal(dirs.externalWorkspace, false)
  const prep = prepareSmokeWorkspace(dirs)
  assert.equal(prep.mode, 'throwaway-fixture')
  assert.ok(dirs.workspace.startsWith(dirs.smokeRoot), 'fixture workspace must live inside the scratch root')

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dirs.workspace, encoding: 'utf8', windowsHide: true })
  assert.equal(head.status, 0, 'default mode is expected to create a commit')
  assert.match(head.stdout.trim(), /^[0-9a-f]{40}$/)
  assert.equal(dirs.externalWorkspace, false)
  assert.equal(dirs.gitIdentity, null, 'the throwaway fixture has no pre-existing identity to report')
  assert.ok(existsSync(path.join(dirs.workspace, 'README.md')))
  void root
})

test('existing-workspace mode performs no Git mutation and reads the real identity', { skip: !gitAvailable }, (t) => {
  const root = makeTempRoot(t)
  const repo = makeRepo(root)
  const before = readWorkspaceGitIdentity(repo)
  const beforeLog = spawnSync('git', ['rev-list', '--all', '--count'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout.trim()
  const beforeStatus = spawnSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout

  const dirs = createSmokeDirs('dshd-smoke-existing-test-', { existingWorkspace: repo })
  t.after(() => {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best effort
    }
  })

  assert.equal(dirs.externalWorkspace, true)
  assert.equal(dirs.workspace, before.workspace)
  assert.equal(dirs.gitIdentity.head, before.head)
  assert.equal(dirs.gitIdentity.branch, 'main')
  assert.equal(dirs.gitIdentity.committed, true)

  const prep = prepareSmokeWorkspace(dirs)
  assert.equal(prep.mode, 'existing-workspace')
  assert.equal(prep.gitIdentity.head, before.head)

  const afterLog = spawnSync('git', ['rev-list', '--all', '--count'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout.trim()
  const afterStatus = spawnSync('git', ['status', '--porcelain=v1'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout
  const headAfter = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', windowsHide: true }).stdout.trim()

  assert.equal(afterLog, beforeLog, 'no commit may be created')
  assert.equal(afterStatus, beforeStatus, 'the repository status must be untouched')
  assert.equal(headAfter, before.head, 'HEAD must not move')

  // Cleanup of the scratch root must leave the supplied workspace alone.
  rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
  assert.ok(existsSync(path.join(repo, 'README.md')), 'the supplied workspace must survive smoke cleanup')
})

test('an unborn-HEAD Git workspace is readable and reported as not committed', { skip: !gitAvailable }, (t) => {
  const root = makeTempRoot(t)
  const repo = path.join(root, 'unborn')
  mkdirSync(repo, { recursive: true })
  spawnSync('git', ['init', '-b', 'main'], { cwd: repo, encoding: 'utf8', windowsHide: true })

  const dirs = createSmokeDirs('dshd-smoke-unborn-test-', { existingWorkspace: repo })
  t.after(() => {
    try {
      rmSync(dirs.smokeRoot, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // best effort
    }
  })

  assert.equal(dirs.externalWorkspace, true)
  assert.equal(dirs.gitIdentity.committed, false)
  assert.equal(dirs.gitIdentity.head, null)
  assert.ok(dirs.gitIdentity.gitDir, 'git dir should still be resolvable')
})

test('a workspace inside the smoke scratch root is rejected so cleanup cannot delete it', (t) => {
  const root = makeTempRoot(t)
  const scratch = path.join(root, 'scratch')
  mkdirSync(scratch, { recursive: true })

  // The scratch root itself.
  assert.throws(() => assertWorkspaceOutsideScratchRoot(scratch, scratch), /must not point inside/)

  // A nested path below it.
  const nested = path.join(scratch, 'workspace')
  mkdirSync(nested, { recursive: true })
  assert.throws(() => assertWorkspaceOutsideScratchRoot(scratch, nested), /must not point inside/)

  // A sibling is allowed.
  const sibling = path.join(root, 'sibling')
  mkdirSync(sibling, { recursive: true })
  assert.equal(assertWorkspaceOutsideScratchRoot(scratch, sibling), sibling)
})

test('existing-workspace mode keeps the historical mutating helper out of its path', () => {
  // A static check: prepareSmokeWorkspace only reaches initGitWorkspace() in the
  // non-external branch, so the opt-in mode cannot create a commit.
  const source = prepareSmokeWorkspace.toString()
  assert.match(source, /externalWorkspace/)
  assert.match(source, /initGitWorkspace/)
  assert.doesNotMatch(source, /git\(/, 'prepareSmokeWorkspace must not shell out to Git itself')
})
