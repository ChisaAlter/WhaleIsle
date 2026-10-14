import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Prompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import Skills from '@deepseek-ai/dsh-skill';
import Agents from '@deepseek-ai/dsh-agent';
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as Plugin from '../lib/index.js';
import { CheckpointStore } from '../lib/state.js';
import { stopBridge } from '../bridge/dist/process/daemon.js';
import { readRuntimeState } from '../bridge/dist/bridge/runtime.js';
import { Workspace } from '../bridge/dist/workspace/manager.js';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { createScope } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-scope', { paths: [require.resolve('@deepseek-ai/dsh-agent')] })).href);
const lifetimes = new WeakMap();

function fixtureAgent(ctx, id, root) {
  const sessionId = SessionId(id);
  const agent = {
    id: sessionId,
    session: Session.create(sessionId, [], { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, cwd: root, isSeeded: false }),
  };
  const lifetime = lifetimes.get(ctx);
  const scope = createScope(lifetime.plugin.ctx, agent);
  agent.ctx = scope.ctx;
  const detach = ctx.agents.enter(agent);
  lifetime.agents.push({ scope, detach });
  return agent;
}

async function runtime(stateDir) {
  const ctx = new Context();
  const fibers = [];
  for (const provider of [Prompt, Tools, Agents, Skills]) fibers.push(await ctx.plugin(provider));
  const plugin = await ctx.plugin(Plugin, { stateDir, headless: true });
  fibers.push(plugin);
  const agents = [];
  lifetimes.set(ctx, { plugin, agents });
  let disposal;
  const dispose = () => disposal ??= (async () => {
    for (const { scope, detach } of [...agents].reverse()) {
      await scope.dispose();
      detach();
    }
    // Dispose real owned fibers; root-fiber disposal can restart injected providers.
    for (const fiber of [...fibers].reverse()) await fiber.dispose();
  })();
  return { ctx, plugin, dispose };
}

let sequence = 0;
async function call(ctx, agent, name, args, signal = new AbortController().signal) {
  return ctx.tools.execute({ callId: ToolCallId(`d2c-test-${++sequence}`), agent, name, arguments: args, signal });
}

function valueOf(result) {
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.ok, undefined);
  assert.equal(result.value.ok, true, JSON.stringify(result.value));
  return result.value.data;
}

function testTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chatgpt-plugin-'));
  const workspace = path.join(root, 'workspace');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'README.md'), '# DSH plugin fixture\n');
  fs.writeFileSync(path.join(workspace, '.env'), 'SECRET=not-for-chatgpt\n');
  return { root, workspace, stateDir };
}

async function stopFixtureBridge(workspace) {
  const runtime = readRuntimeState(new Workspace(workspace).id);
  await stopBridge(workspace);
  // The shutdown route acknowledges before the daemon exits and releases its cwd.
  const deadline = Date.now() + 5000;
  while (runtime && Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${runtime.port}/health`, { signal: AbortSignal.timeout(100) }); }
    catch { break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

test('real DSH registries load the bundle, expose its skill, isolate sessions and reject stale owners', async () => {
  const tree = testTree();
  const { ctx, plugin, dispose } = await runtime(tree.stateDir);
  try {
    assert.deepEqual(ctx.tools.schemas().map(item => item.name).filter(name => name.startsWith('chatgpt_')).sort(), ['chatgpt_browser', 'chatgpt_checkpoint', 'chatgpt_connection', 'chatgpt_record']);
    const skill = await ctx.skills.get('dsh-with-chatgpt', { cwd: tree.workspace });
    assert.ok(skill.content.includes('ChatGPT plans and reviews'));
    assert.equal(skill.resourceBase.kind, 'directory');
    const first = fixtureAgent(ctx, 'first', tree.workspace);
    const second = fixtureAgent(ctx, 'second', tree.workspace);
    const saved = valueOf(await call(ctx, first, 'chatgpt_checkpoint', { action: 'set', chatUrl: 'https://chatgpt.com/c/11111111-test', state: 'EXECUTED_SENT', waitingFor: 'GPT_REVIEW', iteration: 1 })).session;
    assert.equal(valueOf(await call(ctx, second, 'chatgpt_checkpoint', { action: 'get' })).session, null);
    assert.equal(valueOf(await call(ctx, first, 'chatgpt_checkpoint', { action: 'get' })).session.taskId, saved.taskId);
    const resumed = { ...first };
    const rejected = await call(ctx, resumed, 'chatgpt_checkpoint', { action: 'get' });
    assert.equal(rejected.isError, true);
    const invalid = await call(ctx, first, 'chatgpt_checkpoint', { action: 'set', chatUrl: 'https://evil.example/c/id' });
    assert.equal(invalid.isError, true);
    const limit = await call(ctx, first, 'chatgpt_checkpoint', { action: 'set', iteration: 13 });
    assert.equal(limit.isError, true);
    const abort = new AbortController(); abort.abort(new Error('test cancellation'));
    const cancelled = await call(ctx, first, 'chatgpt_connection', { action: 'setup', localOnly: true }, abort.signal);
    assert.equal(cancelled.isError, true);
    await plugin.dispose();
    assert.equal(ctx.tools.schemas().some(item => item.name.startsWith('chatgpt_')), false);
    assert.equal(await ctx.skills.get('dsh-with-chatgpt'), undefined);
  } finally { await dispose(); fs.rmSync(tree.root, { recursive: true, force: true }); }
});

test('concurrent native DSH setup reuses one bridge and records retain distinct MCP-readable outputs', async () => {
  const tree = testTree();
  const originalState = process.env.D2C_STATE_DIR;
  process.env.D2C_STATE_DIR = tree.stateDir;
  const { ctx, dispose } = await runtime(tree.stateDir);
  const client = new Client({ name: 'dsh-native-test', version: '0.1.0' });
  try {
    const agent = fixtureAgent(ctx, 'native-loop', tree.workspace);
    const other = fixtureAgent(ctx, 'native-parallel', tree.workspace);
    const setups = await Promise.all([agent, other].map(async owner => {
      const data = valueOf(await call(ctx, owner, 'chatgpt_connection', { action: 'setup', localOnly: true }));
      const runtime = readRuntimeState(data.workspaceId);
      assert.ok(runtime);
      assert.equal(Number(new URL(data.mcpUrl).port), runtime.port);
      process.kill(runtime.pid, 0);
      return { data, runtime };
    }));
    assert.equal(setups[0].data.mcpUrl, setups[1].data.mcpUrl);
    assert.deepEqual(setups[0].runtime, setups[1].runtime);
    const setup = setups[1].data;
    assert.deepEqual(fs.readdirSync(path.join(tree.stateDir, 'runtime')), [`${setup.workspaceId}.json`]);
    const startupLog = fs.readFileSync(path.join(tree.stateDir, 'logs', `bridge-${setup.workspaceId}.out.log`), 'utf8');
    assert.equal((startupLog.match(/Bridge listening on /g) ?? []).length, 1);
    assert.equal((startupLog.match(/bridge ready on /g) ?? []).length, 1);
    assert.equal(setup.local, true);
    assert.ok(setup.connectorName.startsWith('DSH with ChatGPT'));
    const state = valueOf(await call(ctx, agent, 'chatgpt_connection', { action: 'status' }));
    assert.equal(state.service, 'd2c-bridge');
    assert.equal(state.pid, setups[0].runtime.pid);
    assert.equal(state.port, setups[0].runtime.port);
    assert.equal(state.startedAt, setups[0].runtime.startedAt);
    assert.equal(state.workspaceRoot.toLowerCase(), tree.workspace.toLowerCase());
    const unauthenticated = await fetch(setup.mcpUrl, { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    const [session, otherSession] = await Promise.all([agent, other].map(async owner =>
      valueOf(await call(ctx, owner, 'chatgpt_checkpoint', { action: 'set', state: 'EXECUTING' })).session));
    assert.notEqual(session.taskId, otherSession.taskId);
    fs.writeFileSync(path.join(tree.workspace, 'check.log'), 'pass\nd2c_at_secret-token\n');
    fs.writeFileSync(path.join(tree.workspace, 'parallel.log'), 'parallel Session passed\n');
    const [recorded, otherRecorded] = (await Promise.all([
      call(ctx, agent, 'chatgpt_record', { iteration: 1, changedFiles: ['README.md'], tests: 'fixture check passed', exitStatus: 'ok', command: 'fixture-check', outputFile: 'check.log', exitCode: 0 }),
      call(ctx, other, 'chatgpt_record', { iteration: 1, changedFiles: ['README.md'], tests: 'parallel check passed', exitStatus: 'ok', command: 'parallel-check', outputFile: 'parallel.log', exitCode: 0 }),
    ])).map(valueOf);
    assert.equal(recorded.taskId, session.taskId);
    assert.equal(otherRecorded.taskId, otherSession.taskId);
    assert.equal(recorded.outputAvailable, true);
    assert.equal(otherRecorded.outputAvailable, true);
    assert.notEqual(recorded.outputId, otherRecorded.outputId);

    const endpoint = setup.mcpUrl;
    const base = new URL(endpoint).origin;
    const callback = 'https://chatgpt.com/connector_platform/oauth/callback';
    const registration = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'DSH fixture', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
    assert.equal(registration.status, 201);
    const { client_id: clientId } = await registration.json();
    const verifier = randomBytes(32).toString('base64url');
    const authorization = new URL(`${base}/oauth/authorize`);
    authorization.search = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', scope: 'workspace.read execution.read', state: 'dsh-fixture' }).toString();
    const form = await fetch(authorization);
    const html = await form.text();
    const requestId = html.match(/name="request_id"[^>]*value="([^"]+)"/)?.[1];
    assert.ok(requestId, html);
    const consent = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: requestId, pairing_code: setup.pairingCode }) });
    assert.equal(consent.status, 302);
    const code = new URL(consent.headers.get('location')).searchParams.get('code');
    const exchange = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback, client_id: clientId, code_verifier: verifier }) });
    assert.equal(exchange.status, 200);
    const { access_token: accessToken } = await exchange.json();
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
    const identity = await client.callTool({ name: 'workspace_info', arguments: {} });
    assert.equal(JSON.parse(identity.content[0].text).workspaceName, 'workspace');
    const read = await client.callTool({ name: 'read_file', arguments: { path: 'README.md' } });
    assert.ok(JSON.parse(read.content[0].text).content.includes('DSH plugin fixture'));
    const forbidden = await client.callTool({ name: 'read_file', arguments: { path: '.env' } });
    assert.equal(forbidden.isError, true);
    const record = await client.callTool({ name: 'test_status', arguments: {} });
    assert.equal(JSON.parse(record.content[0].text).executor, 'dsh');
    const outputList = await client.callTool({ name: 'execution_output', arguments: { action: 'list' } });
    assert.notEqual(outputList.isError, true);
    const outputs = JSON.parse(outputList.content[0].text).items;
    assert.equal(outputs.length, 2);
    assert.deepEqual(outputs.map(item => item.id).sort((a, b) => a - b), [recorded.outputId, otherRecorded.outputId].sort((a, b) => a - b));
    assert.equal(outputs.find(item => item.id === recorded.outputId).taskId, session.taskId);
    assert.equal(outputs.find(item => item.id === otherRecorded.outputId).taskId, otherSession.taskId);
    const [firstRead, otherRead] = await Promise.all([recorded, otherRecorded].map(item =>
      client.callTool({ name: 'execution_output', arguments: { action: 'read', id: item.outputId } })));
    assert.notEqual(firstRead.isError, true);
    assert.notEqual(otherRead.isError, true);
    const firstOutput = JSON.parse(firstRead.content[0].text);
    const otherOutput = JSON.parse(otherRead.content[0].text);
    assert.equal(firstOutput.command, 'fixture-check');
    assert.ok(firstOutput.text.includes('pass\n'));
    assert.ok(firstOutput.text.includes('[REDACTED]'));
    assert.ok(!firstOutput.text.includes('d2c_at_secret-token'));
    assert.equal(otherOutput.command, 'parallel-check');
    assert.equal(otherOutput.text, 'parallel Session passed\n');
    const badOutput = await call(ctx, agent, 'chatgpt_record', { iteration: 1, changedFiles: [], tests: 'not run', exitStatus: 'blocked', command: 'cat', outputFile: path.join(tree.root, 'outside.log') });
    assert.equal(badOutput.isError, true);
    const secretOutput = await call(ctx, agent, 'chatgpt_record', { iteration: 1, changedFiles: [], tests: 'not run', exitStatus: 'blocked', command: 'cat', outputFile: '.env' });
    assert.equal(secretOutput.isError, true);
    assert.ok(secretOutput.content[0].text.includes('ACCESS_DENIED_SENSITIVE_FILE'));
    fs.writeFileSync(path.join(tree.workspace, '.d2cignore'), 'private-result.log\n');
    fs.writeFileSync(path.join(tree.workspace, 'private-result.log'), 'private nominated data');
    const ignoredOutput = await call(ctx, agent, 'chatgpt_record', { iteration: 1, changedFiles: [], tests: 'not run', exitStatus: 'blocked', command: 'cat', outputFile: 'private-result.log' });
    assert.equal(ignoredOutput.isError, true);
    const revoked = valueOf(await call(ctx, agent, 'chatgpt_connection', { action: 'unpair' }));
    assert.ok(revoked.revoked > 0);
    const after = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(after.status, 401);
  } finally {
    await client.close();
    await stopFixtureBridge(tree.workspace);
    await dispose();
    if (originalState === undefined) delete process.env.D2C_STATE_DIR; else process.env.D2C_STATE_DIR = originalState;
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('cold native pairing returns a stopped-bridge error without creating a bridge runtime', async () => {
  const tree = testTree();
  const originalState = process.env.D2C_STATE_DIR;
  process.env.D2C_STATE_DIR = tree.stateDir;
  const { ctx, dispose } = await runtime(tree.stateDir);
  try {
    const agent = fixtureAgent(ctx, 'native-cold-pair', tree.workspace);
    const result = await call(ctx, agent, 'chatgpt_connection', { action: 'pair' });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.ok, false);
    assert.match(result.value.data.error, /Bridge is stopped.*setup/i);
    const workspaceId = new Workspace(tree.workspace).id;
    assert.equal(readRuntimeState(workspaceId), null);
    assert.deepEqual(fs.readdirSync(path.join(tree.stateDir, 'runtime')), []);
    assert.equal(fs.existsSync(path.join(tree.stateDir, 'logs', `bridge-${workspaceId}.out.log`)), false);
  } finally {
    await stopFixtureBridge(tree.workspace);
    await dispose();
    if (originalState === undefined) delete process.env.D2C_STATE_DIR; else process.env.D2C_STATE_DIR = originalState;
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
});

test('checkpoint identity survives a new Agent object but separates workspace and session', () => {
  const tree = testTree();
  try {
    const first = { id: 'one', session: { header: { cwd: tree.workspace } } };
    const store = new CheckpointStore(tree.stateDir);
    const saved = store.update(first, { state: 'EXECUTED_SENT', waitingFor: 'GPT_REVIEW', iteration: 1 });
    assert.throws(() => store.start(first, {}), /pending task/);
    assert.equal(store.get({ ...first }).taskId, saved.taskId);
    assert.equal(store.get({ ...first, id: 'two' }), null);
    assert.throws(() => store.update(first, { iteration: -1 }));
    assert.throws(() => store.update(first, { state: 'RESUME' }));
    assert.throws(() => store.update(first, { chatUrl: 'https://user@chatgpt.com/c/id' }));
    assert.equal(store.get(first).checkpoint.state, 'EXECUTED_SENT');
    store.update(first, { state: 'DONE', chatUrl: 'https://chatgpt.com/c/finished-task' });
    const next = store.start(first, {});
    assert.notEqual(next.taskId, saved.taskId);
    assert.equal(next.iteration, 0);
    assert.equal(next.chatUrl, 'https://chatgpt.com/c/finished-task');
    assert.equal(next.checkpoint, undefined);
  } finally { fs.rmSync(tree.root, { recursive: true, force: true }); }
});
