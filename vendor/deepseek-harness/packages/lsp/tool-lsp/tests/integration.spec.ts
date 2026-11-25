import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as LspLocal from '@deepseek-ai/dsh-lsp-stdio'
import * as TimeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'
import * as ToolLsp from '@deepseek-ai/dsh-tool-lsp'

/**
 * Focused in-process integration of the model-facing tool, seam, local provider, and timeout policy.
 * The `lsp-definition` ACP snapshot owns the shipped Loader/app entry path.
 */

let root: string
let ws: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-tool-int-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** An inline stdio server that answers initialize + definition and pushes publishDiagnostics on open/change. */
function serverScript(hang: boolean): string {
  const definition = JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })
  return 'let b=Buffer.alloc(0);'
    + `const DEF=${definition};`
    + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
    + 'const pushDiag=(uri,version,text)=>{'
    + '  const diags=[];'
    + '  if(typeof text==="string"&&text.includes("BAD_TYPE")){diags.push({range:{start:{line:0,character:6},end:{line:0,character:14}},severity:1,source:"mock-ts",code:"TS2322",message:"bad type assignment"});}'
    + '  if(typeof text==="string"&&text.includes("UNUSED")){diags.push({range:{start:{line:1,character:0},end:{line:1,character:6}},severity:2,source:"mock-ts",message:"unused identifier"});}'
    + '  process.stdout.write(fr({method:"textDocument/publishDiagnostics",params:{uri,version,diagnostics:diags}}));'
    + '};'
    + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
    + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
    + 'else if(m.method==="textDocument/didOpen")pushDiag(m.params.textDocument.uri,m.params.textDocument.version,m.params.textDocument.text);'
    + 'else if(m.method==="textDocument/didChange")pushDiag(m.params.textDocument.uri,m.params.textDocument.version,m.params.contentChanges[0].text);'
    + `else if(m.method==="textDocument/definition"){${hang ? '' : 'process.stdout.write(fr({id:m.id,result:DEF}));'}}`
    + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
    + 'else if(m.method==="exit")process.exit(0);'
    + '}});'
}

async function mount(hang: boolean, timeoutMs?: number): Promise<Context> {
  const ctx = new Context()
  provideWorkingDirectoryFixture(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(Lsp)
  await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LspLocal, {
    servers: {
      inline: {
        command: process.execPath,
        args: ['-e', serverScript(hang)],
        extensionToLanguage: { '.ts': 'typescript' },
        shutdownTimeoutMs: 200,
        killGraceMs: 200,
      },
    },
  })
  await ctx.plugin(TimeoutPolicy)
  await ctx.plugin(ToolLsp, timeoutMs !== undefined ? { timeoutMs } : {})
  return ctx
}

let seq = 0
const testToolSignal = new AbortController().signal
function call(ctx: Context, args: unknown) {
  return executeToolFixture(ctx, {
    signal: testToolSignal,
    callId: `int-${++seq}` as never,
    name: 'lsp',
    arguments: args,
    agent: { session: { header: { cwd: ws } } } as never,
  })
}

describe('tool-lsp integration', () => {
  it('round-trips a definition query through the real provider and renders a location', async () => {
    const ctx = await mount(false)
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 7 })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toEqual({ type: 'text', text: 'a.ts:1:1' })
    await ctx.fiber.dispose()
  }, 30_000)

  it('enforces the TOOL_TIMEOUT budget when the server hangs', async () => {
    const ctx = await mount(true, 300)
    const result = await call(ctx, { operation: 'goToDefinition', file_path: 'a.ts', line: 1, character: 7 })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('TOOL_TIMEOUT')
    await ctx.fiber.dispose()
  }, 30_000)

  it('keeps provider failure names and codes on tool results', async () => {
    const outside = join(root, 'outside.ts')
    await writeFile(outside, 'x')
    const ctx = await mount(false)
    const missing = await call(ctx, { operation: 'goToDefinition', file_path: 'missing.ts', line: 1, character: 1 })
    expect(missing.isError).toBe(true)
    expect(missing.error?.info).toEqual({ name: 'FsError', code: 'FS_NOT_FOUND' })
    const escaped = await call(ctx, { operation: 'goToDefinition', file_path: outside, line: 1, character: 1 })
    expect(escaped.isError).toBe(true)
    expect(escaped.error?.info).toEqual({ name: 'LspError', code: 'LSP_FILE_OUTSIDE_WORKSPACE' })
    await ctx.fiber.dispose()
  }, 30_000)

  it('round-trips explicit diagnostics queries and autoDiagnosticsAfterEdit feedback over mock stdio LSP', async () => {
    const ctx = await mount(false)
    ctx.tools.register(defineTool({
      name: 'write',
      description: 'write file via ctx.fs',
      parameters: {
        file_path: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: `Updated ${value.path}` }],
      },
      async execute(args) {
        const target = await ctx.fs.resolve(args.file_path, { cwd: ws })
        await ctx.fs.writeText(target, args.content)
        return { path: ctx.fs.processPath(target) }
      },
    }))

    // Warm up the lazily spawned stdio server once so cold child startup cannot eat the 2s hook budget.
    const initialClean = await call(ctx, { operation: 'diagnostics', file_path: 'a.ts' })
    expect(initialClean.isError).toBe(false)
    expect(initialClean.content[0]).toEqual({ type: 'text', text: 'No diagnostics.' })

    const writeBad = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: `int-${++seq}` as never,
      name: 'write',
      arguments: { file_path: 'a.ts', content: 'const BAD_TYPE = 1\nUNUSED\n' },
      agent: { session: { header: { cwd: ws } } } as never,
    })
    expect(writeBad.isError).toBe(false)
    expect((writeBad.content[0] as { text: string }).text).toContain('LSP diagnostics:')
    expect((writeBad.content[0] as { text: string }).text).toContain('a.ts:1:7 [error] (mock-ts/TS2322) bad type assignment')
    expect((writeBad.content[0] as { text: string }).text).toContain('a.ts:2:1 [warning] (mock-ts) unused identifier')

    const explicitDiag = await call(ctx, { operation: 'diagnostics', file_path: 'a.ts' })
    expect(explicitDiag.isError).toBe(false)
    expect((explicitDiag.content[0] as { text: string }).text).toBe(
      'a.ts:1:7 [error] (mock-ts/TS2322) bad type assignment\na.ts:2:1 [warning] (mock-ts) unused identifier',
    )

    const writeClean = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: `int-${++seq}` as never,
      name: 'write',
      arguments: { file_path: 'a.ts', content: 'const clean = 1\n' },
      agent: { session: { header: { cwd: ws } } } as never,
    })
    expect(writeClean.isError).toBe(false)
    expect((writeClean.content[0] as { text: string }).text).not.toContain('LSP diagnostics:')

    const explicitClean = await call(ctx, { operation: 'diagnostics', file_path: 'a.ts' })
    expect(explicitClean.content[0]).toEqual({ type: 'text', text: 'No diagnostics.' })
    await ctx.fiber.dispose()
  }, 30_000)
})
