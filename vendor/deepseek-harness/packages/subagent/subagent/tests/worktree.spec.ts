import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { afterEach, describe, expect, it } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime, {
  createIsolatedSubagentWorktree,
  finalizeIsolatedSubagentWorktree,
  formatWorktreeOutcomeNotice,
  rollbackIsolatedSubagentWorktree,
} from '../src/index.ts'
import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'

const execFileAsync = promisify(execFile)

const TEST_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Test User',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test User',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: TEST_GIT_ENV,
  })
  return stdout.trim()
}

const tempRoots: Array<{ dir: string; dispose?: () => Promise<void> }> = []

afterEach(async () => {
  const errors: unknown[] = []
  for (const entry of tempRoots.splice(0).reverse()) {
    try {
      await entry.dispose?.()
      rmSync(entry.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (error: unknown) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'worktree test cleanup failed')
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push({ dir })
  return dir
}

async function initGitRepo(): Promise<{ repoDir: string; baseCommit: string }> {
  const rawDir = makeTempDir('dsh-subagent-wt-repo-')
  const repoDir = realpathSync.native(rawDir)
  await git(['init'], repoDir)
  writeFileSync(join(repoDir, 'README.md'), 'initial\n', 'utf8')
  await git(['add', 'README.md'], repoDir)
  await git(['commit', '-m', 'initial commit'], repoDir)
  const baseCommit = await git(['rev-parse', 'HEAD'], repoDir)
  return { repoDir, baseCommit }
}

describe('subagent isolated Git worktrees', () => {
  it('fails loudly outside a Git repository', async () => {
    const plainDir = makeTempDir('dsh-subagent-non-git-')
    await expect(createIsolatedSubagentWorktree(plainDir, { nameHint: 'worker' }))
      .rejects.toMatchObject({ code: 'WORKTREE_NOT_GIT_REPO' })
    expect(existsSync(join(plainDir, '.agents', 'worktrees'))).toBe(false)
  })

  it('fails loudly when HEAD has no commits yet', async () => {
    const unbornRepo = makeTempDir('dsh-subagent-unborn-')
    await git(['init'], unbornRepo)
    await expect(createIsolatedSubagentWorktree(unbornRepo))
      .rejects.toMatchObject({ code: 'WORKTREE_UNBORN_HEAD' })
  })

  it('creates an isolated worktree and branch from HEAD and reclaims clean worktrees', { timeout: 20_000 }, async () => {
    const { repoDir, baseCommit } = await initGitRepo()
    const spec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'Cleaner Agent' })

    expect(spec.baseCommit).toBe(baseCommit)
    expect(spec.repoRoot).toBe(repoDir)
    expect(spec.branch).toMatch(/^subagent-cleaner-agent-[0-9a-f]{8}$/)
    expect(existsSync(spec.path)).toBe(true)
    expect(existsSync(join(repoDir, '.agents', 'worktrees', '.gitignore'))).toBe(true)
    expect(await git(['status', '--porcelain'], repoDir)).toBe('')
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], spec.path)).toBe(spec.branch)
    expect(await git(['rev-parse', 'HEAD'], spec.path)).toBe(baseCommit)

    const outcome = await finalizeIsolatedSubagentWorktree(spec)
    expect(outcome).toEqual({
      worktreePath: spec.path,
      branch: spec.branch,
      status: 'cleaned',
    })
    expect(existsSync(spec.path)).toBe(false)
    expect(await git(['branch', '--list', spec.branch], repoDir)).toBe('')
  })

  it('retains worktree and branch when uncommitted tracked or untracked changes exist', { timeout: 20_000 }, async () => {
    const { repoDir } = await initGitRepo()
    const spec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'dirty' })
    writeFileSync(join(spec.path, 'scratch.txt'), 'uncommitted change\n', 'utf8')

    const outcome = await finalizeIsolatedSubagentWorktree(spec)
    expect(outcome).toEqual({
      worktreePath: spec.path,
      branch: spec.branch,
      status: 'retained',
      reason: 'uncommitted-changes',
    })
    expect(existsSync(join(spec.path, 'scratch.txt'))).toBe(true)
    expect(await git(['branch', '--list', spec.branch], repoDir)).toContain(spec.branch)
    expect(formatWorktreeOutcomeNotice(outcome)).toContain(spec.path)
    expect(formatWorktreeOutcomeNotice(outcome)).toContain(spec.branch)
    // Main repo remains clean.
    expect(existsSync(join(repoDir, 'scratch.txt'))).toBe(false)

    // Clean manually via git worktree remove --force so afterEach can remove temp dir on Windows.
    await git(['worktree', 'remove', '--force', spec.path], repoDir)
  })

  it('retains worktree and branch when new commits were created on the isolated branch', { timeout: 20_000 }, async () => {
    const { repoDir, baseCommit } = await initGitRepo()
    const spec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'committer' })
    writeFileSync(join(spec.path, 'feature.txt'), 'committed feature\n', 'utf8')
    await git(['add', 'feature.txt'], spec.path)
    await git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'child work'], spec.path)
    const childCommit = await git(['rev-parse', 'HEAD'], spec.path)
    expect(childCommit).not.toBe(baseCommit)

    const outcome = await finalizeIsolatedSubagentWorktree(spec)
    expect(outcome).toEqual({
      worktreePath: spec.path,
      branch: spec.branch,
      status: 'retained',
      reason: 'new-commits',
    })
    expect(existsSync(spec.path)).toBe(true)
    expect(await git(['rev-parse', `refs/heads/${spec.branch}`], repoDir)).toBe(childCommit)
    expect(await git(['rev-parse', 'HEAD'], repoDir)).toBe(baseCommit)

    await git(['worktree', 'remove', '--force', spec.path], repoDir)
  })

  it('resolves childCwd inside a matching subdirectory when created from a nested cwd', { timeout: 20_000 }, async () => {
    const { repoDir } = await initGitRepo()
    const nested = join(repoDir, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'index.ts'), 'export {}\n', 'utf8')
    await git(['add', 'packages/app/index.ts'], repoDir)
    await git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'add nested app'], repoDir)

    const spec = await createIsolatedSubagentWorktree(nested, { nameHint: 'nested' })
    expect(spec.childCwd).toBe(join(spec.path, 'packages', 'app'))
    expect(existsSync(spec.childCwd!)).toBe(true)

    const outcome = await finalizeIsolatedSubagentWorktree(spec)
    expect(outcome.status).toBe('cleaned')
  })

  it('rolls back untouched worktree idempotently', { timeout: 20_000 }, async () => {
    const { repoDir } = await initGitRepo()
    const spec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'rollback' })
    expect(existsSync(spec.path)).toBe(true)

    await rollbackIsolatedSubagentWorktree(spec)
    await rollbackIsolatedSubagentWorktree(spec)
    expect(existsSync(spec.path)).toBe(false)
    expect(await git(['branch', '--list', spec.branch], repoDir)).toBe('')
  })

  it('integrates worktree outcome into SubagentResult and parent settlement notices', { timeout: 20_000 }, async () => {
    const { repoDir } = await initGitRepo()
    const persistenceDir = mkdtempSync(join(tmpdir(), 'dsh-subagent-wt-persist-'))
    const ctx = new Context()
    tempRoots.push({
      dir: persistenceDir,
      dispose: () => ctx.fiber.dispose(),
    })

    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceDir })
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })

    const adapter = new MockAdapter([
      textResponse('clean child output'),
      textResponse('dirty child output'),
      textResponse('parent ack 1'),
      textResponse('parent ack 2'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const parent = await ctx.agentLoop.create(SessionId('wt-parent'), {
      provider: 'mock',
      model: 'mock',
    })
    await ctx.workingDirectory.set(parent, repoDir)

    const cleanSpec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'clean-run' })
    const cleanRun = await ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'clean worktree run',
      prompt: [{ type: 'text', text: 'do nothing' }],
      parent,
      cwd: cleanSpec.path,
      worktree: cleanSpec,
      signal: new AbortController().signal,
      delivery: 'parent',
    })
    const cleanResult = await cleanRun.result
    expect(cleanResult.worktree).toEqual({
      worktreePath: cleanSpec.path,
      branch: cleanSpec.branch,
      status: 'cleaned',
    })
    expect(existsSync(cleanSpec.path)).toBe(false)
    await parent.whenIdle()

    const dirtySpec = await createIsolatedSubagentWorktree(repoDir, { nameHint: 'dirty-run' })
    writeFileSync(join(dirtySpec.path, 'dirty.txt'), 'kept work\n', 'utf8')
    const dirtyRun = await ctx.subagents.startActivation({
      provider: 'spawn',
      label: 'dirty worktree run',
      prompt: [{ type: 'text', text: 'leave work' }],
      parent,
      cwd: dirtySpec.path,
      worktree: dirtySpec,
      signal: new AbortController().signal,
      delivery: 'parent',
    })
    const dirtyResult = await dirtyRun.result
    expect(dirtyResult.worktree).toEqual({
      worktreePath: dirtySpec.path,
      branch: dirtySpec.branch,
      status: 'retained',
      reason: 'uncommitted-changes',
    })
    expect(existsSync(dirtySpec.path)).toBe(true)
    await parent.whenIdle()

    const notices = [
      ...parent.session.snapshotEvents().flatMap(event => event.type === 'user/message' ? [event.data] : []),
      ...parent.inbox.nextStep,
      ...parent.inbox.nextTurn,
    ]
      .filter(message => message.source.kind === 'subagent-settled')
      .map(message => message.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('\n'))
    expect(notices.some(n => n.includes(cleanSpec.path) && n.includes('cleaned up'))).toBe(true)
    expect(notices.some(n => n.includes(dirtySpec.path) && n.includes(dirtySpec.branch) && n.includes('retained with uncommitted changes'))).toBe(true)

    await git(['worktree', 'remove', '--force', dirtySpec.path], repoDir)
  })
})
