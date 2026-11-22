/**
 * Cross-platform tests for dynamic per-session Codex project hook discovery
 * (`<cwd>/.codex/hooks.json`), mtimeMs caching, fast missing-file skip,
 * optional configPath defaults, and explicit configPath backward compatibility.
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
import * as HooksCodex from '../src/index.ts'
import { createCodexProjectHookResolver } from '../src/project-hooks.ts'

interface RecordedShellCall {
  readonly command: string
  readonly workdir: string
  readonly stdin?: string
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
      ...spec.stdin !== undefined ? { stdin: spec.stdin } : {},
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

function newTempDir(prefix = 'dsh-hcodex-project-'): string {
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
  pluginConfig: HooksCodex.Config,
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
  await ctx.plugin(HooksCodex, pluginConfig)
  const shell = ctx.get('shell')
  if (!(shell instanceof MockShellExecutor)) throw new Error('expected MockShellExecutor')
  return { ctx, shell }
}

describe('hooks-codex project hook discovery & caching', () => {
  it('skips missing .codex/hooks.json cleanly, caches by mtimeMs, and recovers safely from corrupt JSON', () => {
    const cwd = newTempDir()
    const warnings: string[] = []
    const resolver = createCodexProjectHookResolver({ onWarn: (msg) => { warnings.push(msg) } })

    expect(resolver.resolve(cwd)).toEqual({})
    expect(resolver.resolve(join(cwd, 'missing-subdir'))).toEqual({})

    const hookPath = join(cwd, '.codex', 'hooks.json')
    writeJson(hookPath, {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'codex-v1' }] }],
      },
    }, 1_700_000_000)

    const first = resolver.resolve(cwd)
    const second = resolver.resolve(cwd)
    expect(second).toBe(first)
    expect(first['PreToolUse']?.[0]?.hooks[0]?.command).toBe('codex-v1')

    writeJson(hookPath, {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'codex-v2' }] }],
      },
    }, 1_700_000_010)
    const third = resolver.resolve(cwd)
    expect(third).not.toBe(first)
    expect(third['PreToolUse']?.[0]?.hooks[0]?.command).toBe('codex-v2')

    writeFileSync(hookPath, '{corrupt', 'utf8')
    const corruptTime = new Date(1_700_000_020 * 1000)
    utimesSync(hookPath, corruptTime, corruptTime)
    expect(resolver.resolve(cwd)).toEqual({})
    expect(warnings.some(line => line.includes('could not load project hook config'))).toBe(true)

    rmSync(hookPath, { force: true })
    expect(resolver.resolve(cwd)).toEqual({})
  })

  it('defaults discoverProjectHooks to true when configPath is omitted and isolates sessions by cwd', async () => {
    const cwdA = newTempDir('dsh-hcodex-a-')
    const cwdB = newTempDir('dsh-hcodex-b-')
    writeJson(join(cwdA, '.codex', 'hooks.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'codex-allow-a' }] }],
      },
    })
    writeJson(join(cwdB, '.codex', 'hooks.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'codex-deny-b' }] }],
      },
    })

    const cfg = HooksCodex.Config({ model: 'deepseek-chat' })
    expect(cfg.configPath).toBeUndefined()

    const { ctx, shell } = await mountTestHarness(cfg, (spec) => {
      if (spec.command === 'codex-deny-b') {
        return { exitCode: 2, stderr: 'blocked by codex repo B' }
      }
      return { exitCode: 0, stdout: '{}' }
    })

    const agentA: Agent = await ctx.agentLoop.create(SessionId('codex-a'), { provider: 'mock', model: 'mock' }, { cwd: cwdA })
    const agentB: Agent = await ctx.agentLoop.create(SessionId('codex-b'), { provider: 'mock', model: 'mock' }, { cwd: cwdB })

    const resA = await executeToolFixture(ctx, {
      name: 'inspect',
      callId: ToolCallId('cx-call-a'),
      arguments: {},
      agent: agentA,
      signal: new AbortController().signal,
    })
    expect(resA.isError).toBe(false)

    const resB = await executeToolFixture(ctx, {
      name: 'inspect',
      callId: ToolCallId('cx-call-b'),
      arguments: {},
      agent: agentB,
      signal: new AbortController().signal,
    })
    expect(resB.isError).toBe(true)
    expect(resB.error?.message).toContain('blocked by codex repo B')

    expect(shell.calls).toEqual([
      expect.objectContaining({ command: 'codex-allow-a', workdir: cwdA }),
      expect.objectContaining({ command: 'codex-deny-b', workdir: cwdB }),
    ])
  })

  it('respects discoverProjectHooks: false and preserves 100% backward compatibility with explicit configPath', async () => {
    const projectDir = newTempDir('dsh-hcodex-proj-')
    const staticDir = newTempDir('dsh-hcodex-static-')
    writeJson(join(projectDir, '.codex', 'hooks.json'), {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'project-should-not-run' }] }],
      },
    })
    const staticConfigPath = join(staticDir, 'hooks.json')
    writeJson(staticConfigPath, {
      hooks: {
        PreToolUse: [{ matcher: 'inspect', hooks: [{ type: 'command', command: 'codex-static-only' }] }],
      },
    })

    const disabled = await mountTestHarness({ discoverProjectHooks: false })
    const agent1 = await disabled.ctx.agentLoop.create(SessionId('cx-off'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(disabled.ctx, {
      name: 'inspect',
      callId: ToolCallId('cx-call-off'),
      arguments: {},
      agent: agent1,
      signal: new AbortController().signal,
    })
    expect(disabled.shell.calls).toHaveLength(0)

    const explicit = await mountTestHarness({ configPath: staticConfigPath })
    const agent2 = await explicit.ctx.agentLoop.create(SessionId('cx-static'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
    await executeToolFixture(explicit.ctx, {
      name: 'inspect',
      callId: ToolCallId('cx-call-static'),
      arguments: {},
      agent: agent2,
      signal: new AbortController().signal,
    })
    expect(explicit.shell.calls).toHaveLength(1)
    expect(explicit.shell.calls[0]?.command).toBe('codex-static-only')
  })

  it('does not call workingDirectory.ensure when no discovered project hook matches', async () => {
    const projectDir = newTempDir('dsh-hcodex-empty-')
    const { ctx } = await mountTestHarness({})
    const ensureSpy = vi.spyOn(ctx.workingDirectory, 'ensure').mockRejectedValue(new Error('missing dir'))
    try {
      const agent = await ctx.agentLoop.create(SessionId('cx-nodir'), { provider: 'mock', model: 'mock' }, { cwd: projectDir })
      const res = await executeToolFixture(ctx, {
        name: 'inspect',
        callId: ToolCallId('cx-call-nodir'),
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
})
