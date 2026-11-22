/**
 * Cross-platform tests for dynamic per-session Claude Code project hook
 * discovery, priority merging, `${CLAUDE_PROJECT_DIR}` substitution, mtimeMs
 * caching, fast skip without hook files, and explicit configPath compatibility.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ShellExecutor,
  type ShellExecRequest,
  type ShellExecSpec,
  type ShellExecution,
  type ShellRunResult,
} from '@deepseek-ai/dsh-shell'
import { mountAgentLoopTestDependencies, provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as HooksClaude from '../src/index.ts'
import { createClaudeProjectHookResolver } from '../src/project-hooks.ts'

interface RecordedShellCall {
  readonly command: string
  readonly workdir: string
  readonly env?: Record<string, string>
  readonly stdin?: string
  readonly sandboxPolicy?: ShellExecSpec['sandboxPolicy']
}

type MockShellHandler = (spec: ShellExecSpec) => { exitCode: number; stdout?: string; stderr?: string }

class MockShellExecutor extends ShellExecutor {
  readonly calls: RecordedShellCall[] = []

  constructor(ctx: Context, private readonly handler: MockShellHandler) {
    super(ctx)
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 60_000,
      onExpiry: request.onExpiry ?? 'kill',
      stdoutMaxBytes: request.stdoutMaxBytes ?? 65_536,
      ...request.signal !== undefined ? { signal: request.signal } : {},
      ...request.stdin !== undefined ? { stdin: request.stdin } : {},
      ...request.env !== undefined ? { env: request.env } : {},
      ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  override execute(spec: ShellExecSpec): Promise<ShellExecution> {
    this.calls.push({
      command: spec.command,
      workdir: spec.workdir,
      ...spec.env !== undefined ? { env: spec.env } : {},
      ...spec.stdin !== undefined ? { stdin: spec.stdin } : {},
      ...spec.sandboxPolicy !== undefined ? { sandboxPolicy: spec.sandboxPolicy } : {},
    })
    const out = this.handler(spec)
    const runResult: ShellRunResult = {
      exitCode: out.exitCode,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: out.stdout ?? '', truncated: false },
      stderr: { text: out.stderr ?? '', truncated: false },
    }
    const emptyReader = {
      readFrom: () => ({ text: '', delta: '', nextOffset: 0, lossy: false }),
    }
    const execution: ShellExecution = {
      status: 'completed',
      exitCode: out.exitCode,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      observed: { stdout: emptyReader, stderr: emptyReader },
      kill: () => false,
      result: () => Promise.resolve(runResult),
    }
    return Promise.resolve(execution)
  }
}

const tempDirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newTempDir(prefix = 'dsh-hcc-project-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeJson(filePath: string, value: unknown, mtimeSeconds?: number): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value), 'utf8')
  if (mtimeSeconds !== undefined) {
    const t = new Date(mtimeSeconds * 1000)
    utimesSync(filePath, t, t)
  }
}

async function mountTestHarness(
  pluginConfig: HooksClaude.Config,
  shellHandler: MockShellHandler = () => ({ exitCode: 0, stdout: '{}' }),
): Promise<{ ctx: Context; shell: MockShellExecutor }> {
  const ctx = new Context()
  contexts.push(ctx)
  provideWorkingDirectoryFixture(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(MockShellExecutor, shellHandler)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('ok')]))
  ctx.tools.register(defineContentToolFixture({
    name: 'inspect',
    description: 'test tool',
    parameters: {},
    execute: () => Promise.resolve([{ type: 'text', text: 'inspected' }]),
  }))
  await ctx.plugin(HooksClaude, pluginConfig)
  const shell = ctx.get('shell')
  if (!(shell instanceof MockShellExecutor)) throw new Error('expected MockShellExecutor')
  return { ctx, shell }
}

describe('hooks-claude-code project hook discovery & caching', () => {
  it('skips missing .claude dirs cleanly and dynamically picks up newly created project configs', () => {
    const cwd = newTempDir()
    const resolver = createClaudeProjectHookResolver()

    expect(resolver.resolve(cwd)).toEqual({})
    expect(resolver.resolve(join(cwd, 'missing-subdir'))).toEqual({})

    writeJson(join(cwd, '.claude', 'hooks.json'), {
      PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/check.sh' }] }],
    }, 1_700_000_000)

    const resolved = resolver.resolve(cwd)
    expect(resolved['PreToolUse']).toHaveLength(1)
    expect(resolved['PreToolUse']?.[0]?.hooks[0]?.command).toBe(`${cwd}/check.sh`)
  })

  it('merges settings.local.json, settings.json, and hooks.json in priority order and resolves CLAUDE_PROJECT_DIR per cwd', () => {
    const cwdA = newTempDir('dsh-hcc-a-')
    const cwdB = newTempDir('dsh-hcc-b-')
    const resolver = createClaudeProjectHookResolver()

    writeJson(join(cwdA, '.claude', 'settings.local.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'local-step ${CLAUDE_PROJECT_DIR}' }] }],
      },
    })
    writeJson(join(cwdA, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'shared-step' }] }],
        PostToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'post-step' }] }],
      },
    })
    writeJson(join(cwdA, '.claude', 'hooks.json'), {
      PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'legacy-step' }] }],
    })
    writeJson(join(cwdB, '.claude', 'hooks.json'), {
      PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'repo-b ${CLAUDE_PROJECT_DIR}' }] }],
    })

    const resolvedA = resolver.resolve(cwdA)
    expect(resolvedA['PreToolUse']?.map(group => group.hooks[0]?.command)).toEqual([
      `local-step ${cwdA}`,
      'shared-step',
      'legacy-step',
    ])
    expect(resolvedA['PostToolUse']?.map(group => group.hooks[0]?.command)).toEqual(['post-step'])

    const resolvedB = resolver.resolve(cwdB)
    expect(resolvedB['PreToolUse']?.map(group => group.hooks[0]?.command)).toEqual([`repo-b ${cwdB}`])
  })

  it('caches resolved configs per cwd by mtimeMs and invalidates on file change or removal', () => {
    const cwd = newTempDir()
    const warnings: string[] = []
    const settingsPath = join(cwd, '.claude', 'settings.json')
    writeJson(settingsPath, {
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'v1' }] }] },
    }, 1_700_000_000)

    const resolver = createClaudeProjectHookResolver({ onWarn: (msg) => { warnings.push(msg) } })
    const first = resolver.resolve(cwd)
    const second = resolver.resolve(cwd)
    expect(second).toBe(first)
    expect(first['PreToolUse']?.[0]?.hooks[0]?.command).toBe('v1')

    // Update file with a newer mtimeMs -> cache invalidates and reloads.
    writeJson(settingsPath, {
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'v2' }] }] },
    }, 1_700_000_010)
    const third = resolver.resolve(cwd)
    expect(third).not.toBe(first)
    expect(third['PreToolUse']?.[0]?.hooks[0]?.command).toBe('v2')

    // Corrupt settings.json triggers safe fallback warning while keeping sibling hooks.local.json working.
    writeJson(join(cwd, '.claude', 'settings.local.json'), {
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'local-ok' }] }] },
    }, 1_700_000_020)
    writeFileSync(settingsPath, '{corrupt', 'utf8')
    const corruptTime = new Date(1_700_000_030 * 1000)
    utimesSync(settingsPath, corruptTime, corruptTime)

    const fourth = resolver.resolve(cwd)
    expect(fourth['PreToolUse']?.map(group => group.hooks[0]?.command)).toEqual(['local-ok'])
    expect(warnings.some(line => line.includes('could not load project hook config'))).toBe(true)

    // Delete .claude directory cleanly clears cache.
    rmSync(join(cwd, '.claude'), { recursive: true, force: true })
    expect(resolver.resolve(cwd)).toEqual({})
  })

  it('defaults discoverProjectHooks to true when configPath is omitted and runs per-session cwd hooks with CLAUDE_PROJECT_DIR', async () => {
    const cwdA = newTempDir('dsh-hcc-sess-a-')
    const cwdB = newTempDir('dsh-hcc-sess-b-')
    writeJson(join(cwdA, '.claude', 'settings.local.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'echo ${CLAUDE_PROJECT_DIR} localA' }] }],
      },
    })
    writeJson(join(cwdB, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'echo ${CLAUDE_PROJECT_DIR} sharedB' }] }],
      },
    })

    const cfg = HooksClaude.Config({})
    expect(cfg.configPath).toBeUndefined()

    const { ctx, shell } = await mountTestHarness(cfg, (spec) => {
      if (spec.command.includes('sharedB')) {
        return { exitCode: 2, stderr: 'blocked by project B hook' }
      }
      return { exitCode: 0, stdout: '{}' }
    })

    const agentA: Agent = await ctx.agentLoop.create(SessionId('cc-a'), { provider: 'mock', model: 'mock' }, { cwd: cwdA })
    const agentB: Agent = await ctx.agentLoop.create(SessionId('cc-b'), { provider: 'mock', model: 'mock' }, { cwd: cwdB })

    const resA = await executeToolFixture(ctx, {
      name: 'inspect',
      callId: ToolCallId('call-a'),
      arguments: {},
      agent: agentA,
      signal: new AbortController().signal,
    })
    expect(resA.isError).toBe(false)

    const resB = await executeToolFixture(ctx, {
      name: 'inspect',
      callId: ToolCallId('call-b'),
      arguments: {},
      agent: agentB,
      signal: new AbortController().signal,
    })
    expect(resB.isError).toBe(true)
    expect(resB.error?.message).toContain('blocked by project B hook')

    expect(shell.calls).toEqual([
      expect.objectContaining({
        command: `echo ${cwdA} localA`,
        workdir: cwdA,
        env: { CLAUDE_PROJECT_DIR: cwdA },
      }),
      expect.objectContaining({
        command: `echo ${cwdB} sharedB`,
        workdir: cwdB,
        env: { CLAUDE_PROJECT_DIR: cwdB },
      }),
    ])
  })

  it('respects discoverProjectHooks: false and preserves 100% backward compatibility when explicit configPath is passed', async () => {
    const projectDir = newTempDir('dsh-hcc-proj-')
    const staticDir = newTempDir('dsh-hcc-static-')
    writeJson(join(projectDir, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'project-should-not-run' }] }],
      },
    })
    const staticConfigPath = join(staticDir, 'hooks.json')
    writeJson(staticConfigPath, {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'static-only' }] }],
      },
    })

    // 1) Explicit discoverProjectHooks: false with no configPath runs zero hooks.
    const disabled = await mountTestHarness({ discoverProjectHooks: false })
    const agent1 = await disabled.ctx.agentLoop.create(SessionId('cc-off'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(disabled.ctx, {
      name: 'inspect',
      callId: ToolCallId('call-off'),
      arguments: {},
      agent: agent1,
      signal: new AbortController().signal,
    })
    expect(disabled.shell.calls).toHaveLength(0)

    // 2) Explicit configPath ignores project-local hooks unless discoverProjectHooks is explicitly true.
    const explicit = await mountTestHarness({ configPath: staticConfigPath })
    const agent2 = await explicit.ctx.agentLoop.create(SessionId('cc-static'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(explicit.ctx, {
      name: 'inspect',
      callId: ToolCallId('call-static'),
      arguments: {},
      agent: agent2,
      signal: new AbortController().signal,
    })
    expect(explicit.shell.calls).toHaveLength(1)
    expect(explicit.shell.calls[0]?.command).toBe('static-only')
  })

  it('does not call workingDirectory.ensure when no discovered project hook matches', async () => {
    const projectDir = newTempDir('dsh-hcc-empty-')
    const { ctx } = await mountTestHarness({})
    const ensureSpy = vi.spyOn(ctx.workingDirectory, 'ensure').mockRejectedValue(new Error('missing dir'))
    try {
      const agent = await ctx.agentLoop.create(SessionId('cc-nodir'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
      const res = await executeToolFixture(ctx, {
        name: 'inspect',
        callId: ToolCallId('call-nodir'),
        arguments: {},
        agent,
        signal: new AbortController().signal,
      })
      expect(res.isError).toBe(false)
      expect(ensureSpy).not.toHaveBeenCalled()
    } finally {
      ensureSpy.mockRestore()
    }
  })

  it('forwards optional ctx.get("sandboxPolicy") resolution to runHook and keeps zero fallback when absent', async () => {
    const projectDir = newTempDir('dsh-hcc-policy-')
    writeJson(join(projectDir, '.claude', 'settings.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'check-policy' }] }],
      },
    })

    const withPolicy = await mountTestHarness({})
    const expectedPolicy: NonNullable<ShellExecSpec['sandboxPolicy']> = {
      mode: 'workspace-write',
      workspaceRoot: projectDir,
    }
    const resolvePolicy = vi.fn(() => expectedPolicy)
    const originalGet = withPolicy.ctx.get.bind(withPolicy.ctx) as (service: string) => object | undefined
    vi.spyOn(withPolicy.ctx, 'get').mockImplementation(((service: string) => {
      return service === 'sandboxPolicy' ? { resolve: resolvePolicy } : originalGet(service)
    }) as typeof withPolicy.ctx.get)

    const agent = await withPolicy.ctx.agentLoop.create(SessionId('cc-policy-sess'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(withPolicy.ctx, {
      name: 'inspect',
      callId: ToolCallId('call-policy'),
      arguments: {},
      agent,
      signal: new AbortController().signal,
    })
    expect(resolvePolicy).toHaveBeenCalledWith({ session: agent.session })
    expect(withPolicy.shell.calls[0]?.sandboxPolicy).toEqual(expectedPolicy)

    // Without sandboxPolicy service mounted, hooks continue running with undefined policy.
    const withoutPolicy = await mountTestHarness({})
    const plainAgent = await withoutPolicy.ctx.agentLoop.create(SessionId('cc-plain-sess'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(withoutPolicy.ctx, {
      name: 'inspect',
      callId: ToolCallId('call-plain'),
      arguments: {},
      agent: plainAgent,
      signal: new AbortController().signal,
    })
    expect(withoutPolicy.shell.calls).toHaveLength(1)
    expect(withoutPolicy.shell.calls[0]?.sandboxPolicy).toBeUndefined()
  })
})
