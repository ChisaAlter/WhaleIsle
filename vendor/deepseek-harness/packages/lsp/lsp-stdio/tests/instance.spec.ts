import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { LspInstance } from '../src/instance.ts'
import { readHostSource } from '../src/host.ts'
import { encodeMessage } from '../src/framing.ts'
import type { ConnectionSpawner, ConnectionWriter } from '@deepseek-ai/dsh-lsp-stdio/src/connection.ts'
import type { InstanceSpec } from '@deepseek-ai/dsh-lsp-stdio/src/instance.ts'
import type { LspProviderQuery, LspQueryResult } from '@deepseek-ai/dsh-lsp'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { spawnSubprocess } from '@deepseek-ai/dsh-subprocess-local/src/spawn.ts'

const fixtureServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))

let root: string
let ws: string
let ctx: Context
let fs: LocalFileSystem
const live: LspInstance[] = []

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'lsp-inst-')))
  ws = join(root, 'ws')
  await mkdir(ws)
  await writeFile(join(ws, 'a.ts'), 'const x = 1\n')
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  fs = ctx.fs as LocalFileSystem
})

afterEach(async () => {
  const instances = live.splice(0)
  const ownedContext = ctx
  const directory = root
  for (const instance of instances) await instance.dispose()
  await ownedContext.fiber.dispose()
  await rm(directory, { recursive: true, force: true })
})

function makeInstance(
  env: Record<string, string> = {},
  overrides: Partial<InstanceSpec> = {},
  writer?: ConnectionWriter,
  spawner: ConnectionSpawner = spawnSubprocess,
): LspInstance {
  const instance = new LspInstance({
    command: process.execPath,
    args: [fixtureServer],
    cwd: ws,
    workspaceUri: pathToFileURL(ws).href,
    env: { ...scrubbedParentEnv(), ...env },
    configuration: { setting: 42 },
    initializationOptions: { init: true },
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 100_000,
    shutdownTimeoutMs: 200,
    killGraceMs: 200,
    ...overrides,
  }, spawner, writer)
  live.push(instance)
  return instance
}

function query(operation: LspProviderQuery['operation'] = 'goToDefinition'): LspProviderQuery {
  return { operation, filePath: 'a.ts', position: { line: 0, character: 6 }, workspaceRoot: ws, languageId: 'typescript' }
}

/** Run a query against an instance, reading the source first the way the provider does. */
async function run(instance: LspInstance, operation: LspProviderQuery['operation'] = 'goToDefinition', signal?: AbortSignal): Promise<LspQueryResult> {
  const workspace = {
    target: await fs.resolve(ws),
    canonicalPath: ws,
    fileUrl: pathToFileURL(ws).href,
  }
  const source = await readHostSource(fs, 'a.ts', workspace, 4_000_000)
  return instance.query(query(operation), source, signal)
}

/** Build an instance whose "server" is an inline node script (for teardown-escalation control). */
function scriptInstance(script: string, overrides: Partial<InstanceSpec> = {}, writer?: ConnectionWriter): LspInstance {
  const instance = new LspInstance({
    command: process.execPath,
    args: ['-e', script],
    cwd: ws,
    workspaceUri: pathToFileURL(ws).href,
    env: scrubbedParentEnv(),
    configuration: null,
    initializationOptions: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 100_000,
    shutdownTimeoutMs: 150,
    killGraceMs: 150,
    ...overrides,
  }, spawnSubprocess, writer)
  live.push(instance)
  return instance
}

/** An inline server that answers initialize + definition and echoes a location. */
const RESPONDING_SERVER =
  'let b=Buffer.alloc(0);'
  + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
  + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
  + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
  + 'else if(m.method==="textDocument/definition")process.stdout.write(fr({id:m.id,result:null}));'
  + '}});'

const locJson = () => JSON.stringify({ uri: pathToFileURL(join(ws, 'a.ts')).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } })

describe('LspInstance server-request handling', () => {
  it('answers workspace/configuration with the static config per item', async () => {
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'configuration', LSP_FAKE_DEF: locJson() })
    // The query drives didOpen, which makes the fake emit workspace/configuration; a healthy answer
    // keeps the query working.
    await expect(run(instance, 'goToDefinition')).resolves.toMatchObject({ kind: 'locations' })
  })

  it('accepts a lifecycle client/registerCapability request', async () => {
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'lifecycle', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })

  it('rejects a workspace/applyEdit request but keeps serving', async () => {
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'applyEdit', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })

  it('rejects an unknown server request but keeps serving', async () => {
    const instance = makeInstance({ LSP_FAKE_ON_OPEN: 'unknown', LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({ kind: 'locations', locations: [], resolvedWorkspaceUri: pathToFileURL(ws).href })
  })
})

describe('LspInstance query and abort', () => {
  it('sends includeDeclaration for references', async () => {
    const instance = makeInstance({ LSP_FAKE_REFS: JSON.stringify([JSON.parse(locJson())]) })
    await expect(run(instance, 'findReferences')).resolves.toMatchObject({ kind: 'locations' })
  })

  it('rejects a query aborted before it starts', async () => {
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    const controller = new AbortController()
    controller.abort(new Error('pre-abort'))
    await expect(run(instance, 'goToDefinition', controller.signal)).rejects.toThrow(/pre-abort/)
  })

  it('cancels an in-flight request on abort and rejects', async () => {
    const instance = makeInstance({ LSP_FAKE_HANG: '1' })
    const controller = new AbortController()
    // Warm the instance first so the abort lands during the hanging request, not during startup.
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
  })

  it('terminates the instance when the server ignores $/cancelRequest past the grace', async () => {
    // The hang server never honors cancellation, so after the bounded grace the instance must be torn
    // down (its process closed) rather than left with an active request.
    const instance = makeInstance({ LSP_FAKE_HANG: '1' }, { killGraceMs: 100 })
    const controller = new AbortController()
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
    expect(instance.dead).toBe(true)
  })

  it('resolves the cancel grace when the server honors $/cancelRequest', async () => {
    // A server that answers $/cancelRequest by settling the pending request lets the grace race
    // resolve via the request rather than the timeout, so the instance is NOT force-terminated.
    const script = 'let b=Buffer.alloc(0),reqId=null;'
      + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
      + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,definitionProvider:true}}}));'
      + 'else if(m.method==="textDocument/definition")reqId=m.id;'
      + 'else if(m.method==="$/cancelRequest"&&reqId!==null)process.stdout.write(fr({id:reqId,error:{code:-32800,message:"request cancelled"}}));'
      + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
      + 'else if(m.method==="exit")process.exit(0);'
      + '}});'
    const defWritten = Promise.withResolvers<undefined>()
    const instance = scriptInstance(script, { killGraceMs: 2_000 }, (stdin, message, done) => {
      const frame = message as { method?: string }
      stdin.write(encodeMessage(message), (err) => {
        done(err)
        if (frame.method === 'textDocument/definition') defWritten.resolve(undefined)
      })
    })
    const controller = new AbortController()
    const pending = run(instance, 'goToDefinition', controller.signal)
    await defWritten.promise
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    controller.abort(new Error('mid-flight'))
    await expect(pending).rejects.toThrow(/mid-flight/)
    // The server acknowledged cancellation within grace, so the instance was not force-killed.
    expect(instance.dead).toBe(false)
    await instance.dispose()
  })

  it('observes abort while awaiting a slow initialize handshake', async () => {
    // A server that answers nothing (not even initialize) leaves `ready` pending; an abort must be
    // observed during that wait instead of hanging the tool-timeout signal.
    const instance = scriptInstance('setInterval(()=>{},1000)', { killGraceMs: 100 })
    const controller = new AbortController()
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 150))
    controller.abort(new Error('handshake-abort'))
    await expect(pending).rejects.toThrow(/handshake-abort/)
    await instance.dispose()
  })

  it('terminates when abort interrupts a backpressured didOpen write', async ({ task, signal }) => {
    // The fixture consumes initialized, then stops reading. A document larger than the stdio pipe
    // keeps didOpen's write callback pending until cancellation forces bounded process teardown.
    await writeFile(join(ws, 'a.ts'), 'x'.repeat(2_000_000))
    const marker = join(root, 'initialized.log')
    const didOpenStarted = Promise.withResolvers<undefined>()
    let didOpenFinished = false
    let processClosed = false
    const instance = makeInstance({
      LSP_FAKE_INITIALIZED_MARKER: marker,
      LSP_FAKE_PAUSE_STDIN_AFTER_INITIALIZED: '1',
    }, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    }, (stdin, message, done) => {
      if ((message as { method?: unknown }).method !== 'textDocument/didOpen') {
        stdin.write(encodeMessage(message), done)
        return
      }
      stdin.write(encodeMessage(message), (error) => {
        didOpenFinished = true
        done(error)
      })
      didOpenStarted.resolve(undefined)
    }, (spec) => {
      const handle = spawnSubprocess(spec)
      void Promise.allSettled([handle.done]).then(([result]) => { processClosed = result.status === 'fulfilled' })
      return handle
    })
    const controller = new AbortController()
    const outcome = run(instance, 'goToDefinition', controller.signal)
      .then(() => undefined, (error: unknown) => error)
    await waitForFile(marker, task.timeout, signal)
    await didOpenStarted.promise
    signal.throwIfAborted()
    expect(didOpenFinished).toBe(false)
    expect(processClosed).toBe(false)
    controller.abort(new Error('didOpen-abort'))
    const failure = await outcome
    expect(() => { throw failure }).toThrow(/didOpen-abort/)
    expect(didOpenFinished).toBe(true)
    expect(processClosed).toBe(true)
    expect(instance.dead).toBe(true)
  })

  it('terminates when stdin fails during the didOpen write', async () => {
    const instance = makeInstance({}, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    }, failingWriter('textDocument/didOpen'))
    await expect(run(instance, 'goToDefinition')).rejects.toMatchObject({ name: 'LspError', code: 'LSP_SERVER_EXITED' })
    expect(instance.dead).toBe(true)
  })

  it('finishes teardown before rejecting a request write failure', async () => {
    const instance = makeInstance({}, {
      shutdownTimeoutMs: 100,
      killGraceMs: 100,
    }, failingWriter('textDocument/definition'))
    await expect(run(instance, 'goToDefinition')).rejects.toMatchObject({
      name: 'LspError',
      code: 'LSP_SERVER_EXITED',
      message: 'language server stopped accepting input: fixture textDocument/definition failure',
    })
    expect(instance.dead).toBe(true)
  })

  it('rejects when the server lacks the operation capability', async () => {
    const instance = makeInstance({ LSP_FAKE_CAPS: JSON.stringify({ definitionProvider: false }), LSP_FAKE_DEF: 'null' })
    await expect(run(instance, 'goToDefinition')).rejects.toMatchObject({
      name: 'LspError',
      code: 'LSP_UNSUPPORTED_OPERATION',
      message: 'server does not support goToDefinition',
    })
  })

  it('propagates a server error response even when a signal is supplied (not an abort)', async () => {
    // A live signal is passed, but the request fails for a server reason; the catch must rethrow
    // without treating it as an abort.
    const instance = makeInstance({ LSP_FAKE_ERROR: '1' })
    const controller = new AbortController()
    await expect(run(instance, 'goToDefinition', controller.signal)).rejects.toMatchObject({
      name: 'LspError',
      code: 'LSP_SERVER_ERROR',
      message: 'language server rejected textDocument/definition with JSON-RPC error -32000: server refused the request',
    })
  })

  it('keeps a settled result but awaits teardown when didClose cannot be written', async () => {
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
    }, { shutdownTimeoutMs: 100, killGraceMs: 100, keepDocumentsOpen: false }, failingWriter('textDocument/didClose'))
    await expect(run(instance, 'goToDefinition')).resolves.toEqual({
      kind: 'locations',
      locations: [],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })
    expect(instance.dead).toBe(true)
  })

  it('reports the launch failure when the server executable cannot be spawned', async () => {
    const instance = makeInstance({}, { command: join(root, 'missing-server') })
    await expect(run(instance, 'goToDefinition')).rejects.toMatchObject({
      name: 'LspError',
      code: 'LSP_SPAWN_FAILED',
      message: expect.stringMatching(/^language server process failed: .*ENOENT/) as string,
    })
    expect(instance.dead).toBe(true)
  })

  it.each([
    ['a non-object result', 'null', 'LSP initialize result was not an object'],
    ['no capabilities object', '{}', 'LSP initialize result had no capabilities object'],
  ])('rejects an initialize result with %s', async (_label, result, message) => {
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(s)=>{const x=Buffer.from(s);return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);const s=b.indexOf("\\r\\n\\r\\n");if(s<0)return;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);const body=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
      + `if(body.method==="initialize")process.stdout.write(fr(JSON.stringify({jsonrpc:"2.0",id:body.id,result:${result}})));});`
    const instance = makeInstance({}, { args: ['-e', script], shutdownTimeoutMs: 100, killGraceMs: 100 })
    await expect(run(instance, 'goToDefinition')).rejects.toMatchObject({
      name: 'LspError',
      code: 'LSP_MALFORMED_RESPONSE',
      message,
    })
  })

})

describe('LspInstance disposal', () => {
  it('lets a server finish protocol exit before signal escalation', async () => {
    const marker = join(root, 'graceful-exit.log')
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_EXIT_DELAY_MS: '75',
      LSP_FAKE_EXIT_MARKER: marker,
    }, { shutdownTimeoutMs: 500 })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    expect(await readFile(marker, 'utf8')).toBe('EXIT\nCLEAN\n')
  })

  it('is idempotent — a second dispose awaits close without error', async () => {
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    await expect(instance.dispose()).resolves.toBeUndefined()
  })

  it('rejects a query after disposal', async () => {
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    await expect(run(instance, 'goToDefinition')).rejects.toThrow(expect.objectContaining({ code: 'LSP_DISPOSED' }))
  })

  it('reports dead after the process closes', async () => {
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' })
    await run(instance, 'goToDefinition')
    await instance.dispose()
    expect(instance.dead).toBe(true)
  })

  it('escalates to SIGKILL when the server ignores shutdown and SIGTERM', async () => {
    // Server answers initialize, ignores shutdown, and traps SIGTERM so only SIGKILL stops it.
    const script = RESPONDING_SERVER + 'process.on("SIGTERM",()=>{});'
    const instance = scriptInstance(script, { shutdownTimeoutMs: 100, killGraceMs: 100 })
    await run(instance, 'goToDefinition')
    await expect(instance.dispose()).resolves.toBeUndefined()
  })

  it('awaits a surviving managed-range helper on every concurrent dispose', async () => {
    const marker = join(root, 'helper.pid')
    const helper = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);'
    const script = 'const{spawn}=require("node:child_process");const{writeFileSync}=require("node:fs");'
      + `const helper=spawn(process.execPath,["-e",${JSON.stringify(helper)}],{stdio:"ignore"});`
      + `writeFileSync(${JSON.stringify(marker)},String(helper.pid));`
      + RESPONDING_SERVER
    const instance = scriptInstance(script, { shutdownTimeoutMs: 100, killGraceMs: 100 })
    await run(instance, 'goToDefinition')
    const helperPid = Number(await readFile(marker, 'utf8'))
    try {
      const first = instance.dispose()
      await instance.dispose()
      expect(processAlive(helperPid)).toBe(false)
      await first
    } finally {
      if (processAlive(helperPid)) process.kill(helperPid, 'SIGKILL')
      await waitForProcessExit(helperPid)
    }
  })

  it('carries a non-Error abort reason as a generic aborted error', async () => {
    const instance = makeInstance({ LSP_FAKE_HANG: '1' })
    const controller = new AbortController()
    const pending = run(instance, 'goToDefinition', controller.signal)
    await new Promise<void>(resolve => setTimeout(resolve, 200))
    controller.abort('a string reason, not an Error')
    await expect(pending).rejects.toThrow(/aborted/)
  })
})

describe('LspInstance persistent document cache and publishDiagnostics', () => {
  async function runFile(
    instance: LspInstance,
    filePath: string,
    operation: LspProviderQuery['operation'] = 'goToDefinition',
    signal?: AbortSignal,
  ): Promise<LspQueryResult> {
    const workspace = {
      target: await fs.resolve(ws),
      canonicalPath: ws,
      fileUrl: pathToFileURL(ws).href,
    }
    const source = await readHostSource(fs, filePath, workspace, 4_000_000)
    return instance.query({
      operation,
      filePath,
      position: { line: 0, character: 0 },
      workspaceRoot: ws,
      languageId: 'typescript',
    }, source, signal)
  }

  it('skips redundant didOpen when text is unchanged, emits incrementing didChange on edit, and closes on dispose', async () => {
    const openMarker = join(root, 'open.log')
    const changeMarker = join(root, 'change.log')
    const closeMarker = join(root, 'close.log')
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_OPEN_MARKER: openMarker,
      LSP_FAKE_CHANGE_MARKER: changeMarker,
      LSP_FAKE_CLOSE_MARKER: closeMarker,
    })

    await runFile(instance, 'a.ts')
    await runFile(instance, 'a.ts')
    expect((await readFile(openMarker, 'utf8')).trim().split('\n')).toHaveLength(1)

    await writeFile(join(ws, 'a.ts'), 'const x = 2\n')
    await runFile(instance, 'a.ts')
    await writeFile(join(ws, 'a.ts'), 'const x = 3\n')
    await runFile(instance, 'a.ts')

    const changes = (await readFile(changeMarker, 'utf8')).trim().split('\n').map(l => JSON.parse(l) as { version: number; text: string })
    expect(changes).toEqual([
      { uri: pathToFileURL(join(ws, 'a.ts')).href, version: 2, text: 'const x = 2\n' },
      { uri: pathToFileURL(join(ws, 'a.ts')).href, version: 3, text: 'const x = 3\n' },
    ])

    await instance.dispose()
    const closed = (await readFile(closeMarker, 'utf8')).trim().split('\n').map(l => JSON.parse(l) as string)
    expect(closed).toEqual([pathToFileURL(join(ws, 'a.ts')).href])
  })

  it('evicts the least-recently-used document via didClose when exceeding maxOpenDocuments', async () => {
    await writeFile(join(ws, 'b.ts'), 'const b = 1\n')
    await writeFile(join(ws, 'c.ts'), 'const c = 1\n')
    const closeMarker = join(root, 'lru-close.log')
    const instance = makeInstance({
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_CLOSE_MARKER: closeMarker,
    }, { maxOpenDocuments: 2 })

    await runFile(instance, 'a.ts')
    await runFile(instance, 'b.ts')
    // Touch a.ts again so b.ts becomes LRU before opening c.ts.
    await runFile(instance, 'a.ts')
    await runFile(instance, 'c.ts')

    const closed = (await readFile(closeMarker, 'utf8')).trim().split('\n').map(l => JSON.parse(l) as string)
    expect(closed).toEqual([pathToFileURL(join(ws, 'b.ts')).href])
    await instance.dispose()
  })

  it('reopens documents with didClose + didOpen when server textDocumentSync change is 0', async () => {
    const openMarker = join(root, 'nochange-open.log')
    const closeMarker = join(root, 'nochange-close.log')
    const instance = makeInstance({
      LSP_FAKE_SYNC: JSON.stringify({ openClose: true, change: 0 }),
      LSP_FAKE_DEF: 'null',
      LSP_FAKE_OPEN_MARKER: openMarker,
      LSP_FAKE_CLOSE_MARKER: closeMarker,
    })

    await runFile(instance, 'a.ts')
    await writeFile(join(ws, 'a.ts'), 'const x = 99\n')
    await runFile(instance, 'a.ts')

    const opens = (await readFile(openMarker, 'utf8')).trim().split('\n').map(l => JSON.parse(l) as string)
    expect(opens).toEqual(['const x = 1\n', 'const x = 99\n'])
    const closes = (await readFile(closeMarker, 'utf8')).trim().split('\n').map(l => JSON.parse(l) as string)
    expect(closes).toEqual([pathToFileURL(join(ws, 'a.ts')).href])
    await instance.dispose()
  })

  it('awaits publishDiagnostics within bounded diagnosticsWaitMs, returns cached diagnostics without waiting, and updates on didChange', async () => {
    await writeFile(join(ws, 'diag.ts'), 'const bad = ERROR\n')
    const instance = makeInstance({
      LSP_FAKE_DIAGNOSTICS: 'auto',
      LSP_FAKE_DIAGNOSTICS_DELAY_MS: '40',
    }, { diagnosticsWaitMs: 1_000 })

    const first = await runFile(instance, 'diag.ts', 'diagnostics')
    expect(first).toEqual({
      kind: 'diagnostics',
      uri: pathToFileURL(join(ws, 'diag.ts')).href,
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        severity: 'error',
        source: 'fake',
        code: 'E1',
        message: 'error token',
      }],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })

    // Second query with unchanged text returns cached diagnostics immediately without re-pushing.
    const started = Date.now()
    const second = await runFile(instance, 'diag.ts', 'diagnostics')
    expect(second).toEqual(first)
    expect(Date.now() - started).toBeLessThan(150)

    // Editing file clears stale error after didChange + new publishDiagnostics push.
    await writeFile(join(ws, 'diag.ts'), 'const ok = 1\n')
    const third = await runFile(instance, 'diag.ts', 'diagnostics')
    expect(third).toEqual({
      kind: 'diagnostics',
      uri: pathToFileURL(join(ws, 'diag.ts')).href,
      diagnostics: [],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })
  })

  it('drops stale versioned publishDiagnostics while awaiting a newer document version', async () => {
    // Custom server: v1 emits stale diagnostics slowly (100ms), v2 emits clean diagnostics quickly (30ms).
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
      + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,hoverProvider:true}}}));'
      + 'else if(m.method==="textDocument/didOpen"){'
      + '  const uri=m.params.textDocument.uri;'
      + '  setTimeout(()=>process.stdout.write(fr({method:"textDocument/publishDiagnostics",params:{uri,version:1,diagnostics:[{range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:"v1 error"}]}})), 120);'
      + '}'
      + 'else if(m.method==="textDocument/didChange"){'
      + '  const uri=m.params.textDocument.uri;'
      + '  setTimeout(()=>process.stdout.write(fr({method:"textDocument/publishDiagnostics",params:{uri,version:m.params.textDocument.version,diagnostics:[]}})), 30);'
      + '}'
      + 'else if(m.method==="textDocument/hover")process.stdout.write(fr({id:m.id,result:{contents:"ok"}}));'
      + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
      + 'else if(m.method==="exit")process.exit(0);'
      + '}});'
    const instance = scriptInstance(script, { diagnosticsWaitMs: 1_000 })
    await runFile(instance, 'a.ts', 'hover')
    await writeFile(join(ws, 'a.ts'), 'const fixed = 1\n')
    const diag = await runFile(instance, 'a.ts', 'diagnostics')
    // Wait long enough for the late v1 notification to also arrive and verify it did not overwrite v2.
    await new Promise<void>(resolve => setTimeout(resolve, 140))
    const afterLateV1 = await runFile(instance, 'a.ts', 'diagnostics')
    expect(diag).toMatchObject({ kind: 'diagnostics', diagnostics: [] })
    expect(afterLateV1).toMatchObject({ kind: 'diagnostics', diagnostics: [] })
  })

  it('settles multi-phase unversioned publishDiagnostics instead of stopping on the first empty pass', async () => {
    const script = 'let b=Buffer.alloc(0);'
      + 'const fr=(o)=>{const x=Buffer.from(JSON.stringify({jsonrpc:"2.0",...o}));return Buffer.concat([Buffer.from(`Content-Length: ${x.length}\\r\\n\\r\\n`),x]);};'
      + 'process.stdin.on("data",c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf("\\r\\n\\r\\n");if(s<0)break;const len=Number(/(\\d+)/.exec(b.toString("ascii",0,s))[1]);if(b.length<s+4+len)break;const m=JSON.parse(b.toString("utf8",s+4,s+4+len));b=b.subarray(s+4+len);'
      + 'if(m.method==="initialize")process.stdout.write(fr({id:m.id,result:{capabilities:{positionEncoding:"utf-16",textDocumentSync:1,hoverProvider:true}}}));'
      + 'else if(m.method==="textDocument/didOpen"){'
      + '  const uri=m.params.textDocument.uri;'
      + '  setTimeout(()=>process.stdout.write(fr({method:"textDocument/publishDiagnostics",params:{uri,diagnostics:[]}})), 20);'
      + '  setTimeout(()=>process.stdout.write(fr({method:"textDocument/publishDiagnostics",params:{uri,diagnostics:[{range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:"semantic error"}]}})), 120);'
      + '}'
      + 'else if(m.method==="shutdown")process.stdout.write(fr({id:m.id,result:null}));'
      + 'else if(m.method==="exit")process.exit(0);'
      + '}});'
    const instance = scriptInstance(script, { diagnosticsWaitMs: 1_500 })
    const result = await runFile(instance, 'a.ts', 'diagnostics')
    expect(result).toMatchObject({
      kind: 'diagnostics',
      diagnostics: [{ severity: 'error', message: 'semantic error' }],
    })
  })

  it('returns empty diagnostics when diagnosticsWaitMs elapses without a server push and respects abort without killing healthy instance', async () => {
    const instance = makeInstance({ LSP_FAKE_DEF: 'null' }, { diagnosticsWaitMs: 60 })
    await expect(runFile(instance, 'a.ts', 'diagnostics')).resolves.toEqual({
      kind: 'diagnostics',
      uri: pathToFileURL(join(ws, 'a.ts')).href,
      diagnostics: [],
      resolvedWorkspaceUri: pathToFileURL(ws).href,
    })

    // Aborting during diagnostics wait rejects the caller but leaves the healthy instance alive.
    await writeFile(join(ws, 'b.ts'), 'const b = 1\n')
    const bOpenWritten = Promise.withResolvers<undefined>()
    const slowInstance = makeInstance(
      { LSP_FAKE_DEF: 'null' },
      { diagnosticsWaitMs: 2_000 },
      (stdin, message, done) => {
        const frame = message as { method?: string; params?: { textDocument?: { uri?: string } } }
        stdin.write(encodeMessage(message), (err) => {
          done(err)
          if (frame.method === 'textDocument/didOpen' && frame.params?.textDocument?.uri?.endsWith('/b.ts')) {
            bOpenWritten.resolve(undefined)
          }
        })
      },
    )
    // Warm up the initialize handshake first, then abort deterministically once b.ts didOpen is flushed.
    await expect(runFile(slowInstance, 'a.ts', 'goToDefinition')).resolves.toMatchObject({ kind: 'locations' })
    const controller = new AbortController()
    const pending = runFile(slowInstance, 'b.ts', 'diagnostics', controller.signal)
    await bOpenWritten.promise
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    controller.abort(new Error('diag-abort'))
    await expect(pending).rejects.toThrow(/diag-abort/)
    expect(slowInstance.dead).toBe(false)
    await expect(runFile(slowInstance, 'b.ts', 'goToDefinition')).resolves.toMatchObject({ kind: 'locations' })
  })
})

/** Probe a pid without changing its state. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
  if (process.platform !== 'linux') return true
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/, 1)[0]
    return !/^[ZXx]$/.test(state ?? '')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Wait until a process can no longer execute so temporary-workspace cleanup cannot race handle release. */
async function waitForProcessExit(pid: number, timeoutMs = 3_000): Promise<void> {
  const started = Date.now()
  while (processAlive(pid)) {
    if (Date.now() - started > timeoutMs) throw new Error(`process ${pid} did not exit`)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

/** Write normally except for one method whose callback receives a deterministic transport error. */
function failingWriter(method: string, failure = new Error(`fixture ${method} failure`)): ConnectionWriter {
  return (stdin, message, done) => {
    if ((message as { method?: unknown }).method === method) {
      queueMicrotask(() => { done(failure) })
      return
    }
    stdin.write(encodeMessage(message), done)
  }
}

/** Wait until a fixture marker exists, bounded so a broken handshake cannot hang the test. */
async function waitForFile(path: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const started = Date.now()
  for (;;) {
    signal.throwIfAborted()
    try {
      await readFile(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (Date.now() - started > timeoutMs) throw new Error('waitForFile timed out')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}
