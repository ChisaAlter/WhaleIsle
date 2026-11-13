/** Real Cordis + AgentLoop + managed subagents + ACP subprocess + HTTP/MCP bridge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as plugin from '../lib/index.js';
import { saveAgentsConfig } from '../lib/presets.js';
import { runtimeBundle } from '../lib/agent-runtime.js';
import { createTaskStore } from '../lib/tasks.js';

if (!process.env.DSH_HARNESS_ROOT) throw new Error('Set DSH_HARNESS_ROOT to a built DeepSeek Harness checkout.');
const req = createRequire(path.join(process.env.DSH_HARNESS_ROOT, 'packages/subagent/subagent-spawn-in-process/package.json'));
const load = (name) => import(pathToFileURL(req.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { mountAgentLoopTestDependencies } = await load('@deepseek-ai/dsh-agent-loop-testkit');
const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop');
const { default: Subagents } = await load('@deepseek-ai/dsh-subagent');
const Persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const SessionQuery = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/session-query/session-query/lib/index.js')).href);
const { createUserMessage } = await load('@deepseek-ai/dsh-llm');
const { installModelSelection } = await load('@deepseek-ai/dsh-agent');
const { default: Approval } = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/interaction/user-approval/lib/index.js')).href);
const { default: Questions } = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/interaction/user-questions/lib/index.js')).href);
const { default: SandboxPolicy, setSandboxMode } = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/sandbox/sandbox-policy/lib/index.js')).href);
const { default: LocalSubprocess } = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/subprocess/subprocess-local/lib/index.js')).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-host-'));
process.env.DSH_HOME = root;
const ctx = new Context();
const routes = [];
const server = http.createServer((request, response) => {
  const route = routes.find((entry) => request.url.startsWith(entry.path));
  if (route) void route.handler(request, response);
  else { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const fixture = fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url));
const storeFile = path.join(root, 'acp-agents.json');
saveAgentsConfig([...['alpha', 'beta'].map((id) => ({
  id, name: id, enabled: true, command: process.execPath, args: [fixture],
  models: [{ id: 'default', name: 'Fixture default' }, ...(id === 'beta' ? [{ id: 'stale-model' }, { id: 'live-model' }] : [])],
  env: { ACP_TEST_LOG: path.join(root, `${id}.jsonl`), ...(id === 'beta' ? { ACP_TEST_NO_IMAGES: '1', ACP_TEST_MODEL_CATALOG: '1', ACP_TEST_STARTUP_CONTROL: path.join(root, 'fail-startup') } : {}) },
})), { id: 'unknown-v2', name: 'Unknown v2', enabled: true, command: process.execPath, args: [fixture], models: [{ id: 'default' }], env: { ACP_TEST_V2: '1', ACP_TEST_LOG: path.join(root, 'unknown-v2.jsonl') } },
{ id: 'unknown-terminal', name: 'Unknown terminal', enabled: true, command: process.execPath, args: [fixture], models: [{ id: 'default' }], env: { ACP_TEST_TERMINAL: '1', ACP_TEST_AUTH_MARKER: path.join(root, 'terminal-auth') } }], storeFile);
const checks = [];
function pass(label) { checks.push(label); console.log(`PASS ${label}`); }
async function prompt(agent, text) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
  await agent.whenIdle();
}
function requests(id) {
  return fs.readFileSync(path.join(root, `${id}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}
async function noticeFor(parent, childId) {
  let off, timer;
  const found = () => parent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === childId);
  try {
    return await new Promise((resolve, reject) => {
      const check = () => { const notice = found(); if (notice) resolve(notice); };
      off = ctx.on('session/event', (session) => { if (session.id === parent.id) check(); });
      timer = setTimeout(() => reject(new Error(`No automatic notice for ${childId}`)), 5000); check();
    });
  } finally { clearTimeout(timer); off?.(); }
}
async function rpc(method, payload = {}) {
  const response = await fetch(`${origin}/dsh-acp-agents/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'integration', method, payload }) });
  const value = await response.json();
  assert.equal(value.result.ok, true, JSON.stringify(value));
  return value.result.value;
}
try {
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
  await ctx.plugin(LocalSubprocess);
  await ctx.plugin(Approval);
  await ctx.plugin(Questions);
  await ctx.plugin(SandboxPolicy);
  await ctx.plugin(Persistence, { root: path.join(root, 'sessions') });
  await ctx.plugin(SessionQuery.default);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Subagents);
  ctx.provide('connection', { requestRejection: () => undefined });
  const imageBytes = Buffer.from('fixture-image-bytes');
  ctx.provide('attachments', { readImage: async ref => ({ ref, data: imageBytes }) });
  ctx.provide('webServer', {
    getOrigin: () => origin,
    register: (route) => { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); },
  });
  await ctx.plugin(plugin, { storeFile });
  assert.ok(ctx.tools.get('acp_agents'));
  assert.ok(ctx.tools.get('acp_delegate'));
  pass('standalone plugin mounts its model routes, tools and HTTP endpoint');
  const catalog = await rpc('catalog');
  assert.deepEqual(catalog.agents.filter((agent) => agent.enabled).map((agent) => agent.id), ['alpha', 'beta', 'unknown-v2', 'unknown-terminal']);
  const login = await rpc('agent/login', { id: 'unknown-terminal', methodId: 'fixture-terminal' });
  const authDeadline = Date.now() + 10000;
  let auth;
  do {
    auth = (await rpc('catalog')).agents.find(agent => agent.id === 'unknown-terminal');
    if (JSON.stringify(auth).includes('FIXTURE_LOGIN_READY')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < authDeadline);
  assert.match(JSON.stringify(auth), /FIXTURE_LOGIN_READY/);
  const answered = await rpc('agent/login/respond', { id: 'unknown-terminal', response: { type: 'terminal', data: 'fixture-accept\r', size: { cols: 100, rows: 30 } } });
  assert.equal(answered.sent, true);
  while (!fs.existsSync(path.join(root, 'terminal-auth')) && Date.now() < authDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(fs.existsSync(path.join(root, 'terminal-auth')));
  pass('unknown Agent terminal login advertises, renders output, resizes and accepts input through the real host PTY');

  const native = await ctx.agentLoop.create('native-v2-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  installModelSelection(native.ctx, { current: { provider: 'acp:unknown-v2', model: 'default' } });
  await prompt(native, 'Start native background work.');
  const nativeDeadline = Date.now() + 10000;
  while (!JSON.stringify(native.session.snapshotEvents()).includes('V2_NATIVE_BACKGROUND_TWO') && Date.now() < nativeDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  await native.whenIdle();
  const nativeEvents = JSON.stringify(native.session.snapshotEvents());
  assert.match(nativeEvents, /V2_FOREGROUND_SETTLED/);
  assert.match(nativeEvents, /V2_NATIVE_BACKGROUND_ONE/);
  assert.match(nativeEvents, /V2_NATIVE_BACKGROUND_TWO/);
  assert.equal(requests('unknown-v2').filter(row => row.method === 'session/prompt').length, 1, 'native output must not cause prompt replay');
  pass('unknown ACP v2 subprocess delivers two post-settle native cycles to a real host without another prompt');
  const synced = await rpc('agent/test', { id: 'beta', cwd: root });
  assert.equal(synced.ok, true, synced.error);
  assert.equal(synced.modelsFound, 2);
  assert.ok(synced.catalog.agents.find(agent => agent.id === 'beta').models.some(model => model.id === 'live-model'));
  pass('CLI synchronization returns schema-valid registry models through the installed host RPC contract');
  assert.equal((await ctx.llm.listModels('acp:alpha'))[0].id, 'default');
  const parent = await ctx.agentLoop.create('integration-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  const selection = { current: { provider: 'acp:alpha', model: 'default' } };
  installModelSelection(parent.ctx, selection);
  await prompt(parent, 'Remember blue skies.');
  selection.current = { provider: 'acp:beta', model: 'default' };
  await prompt(parent, 'Use the previous color.');
  assert.match(JSON.stringify(requests('beta').filter((row) => row.method === 'session/prompt')), /Remember blue skies/);
  selection.current = { provider: 'acp:alpha', model: 'default' };
  await prompt(parent, 'Continue after beta.');
  const alphaTurns = requests('alpha').filter((row) => row.method === 'session/prompt');
  assert.match(JSON.stringify(alphaTurns.at(-1)), /Use the previous color/);
  assert.equal(requests('alpha').filter((row) => row.method === 'session/new').length, 1);
  assert.equal(parent.id, 'integration-parent');
  pass('same-conversation alpha → beta → alpha switch retains context and ACP session');

  const imageParent = await ctx.agentLoop.create('image-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  const image = { type: 'image', attachment: { attachmentId: 'fixture-image', mediaType: 'image/png', name: 'design.png' } };
  imageParent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect the image.' }, image], source: { kind: 'user' } }));
  await imageParent.whenIdle();
  const transmitted = requests('alpha').findLast(row => row.method === 'session/prompt').params.prompt.find(block => block.type === 'image');
  assert.equal(transmitted.data, imageBytes.toString('base64'));
  assert.equal(transmitted.mimeType, 'image/png');
  const noImageParent = await ctx.agentLoop.create('no-image-parent', { provider: 'acp:beta', model: 'default' }, { cwd: root });
  noImageParent.followup(createUserMessage({ content: [image], source: { kind: 'user' } }));
  await noImageParent.whenIdle();
  const textOnlyPrompt = requests('beta').findLast(row => row.method === 'session/prompt').params.prompt;
  assert.equal(textOnlyPrompt.some(block => block.type === 'image'), false);
  assert.match(JSON.stringify(textOnlyPrompt), /image omitted because this model accepts text only/);
  assert.deepEqual((await ctx.llm.listModels('acp:beta')).find(model => model.id === 'default').inputModalities, ['text']);
  pass('image bytes reach negotiated agents; accurate text-only capability invokes the host explicit image-omission path');

  const signal = new AbortController().signal;
  const tool = ctx.tools.get('acp_delegate');
  const beforeRejected = parent.session.snapshotEvents().filter(event => event.type === 'acp-delegation/start').length;
  const childrenBeforeRejected = (await ctx.subagents.listChildren(parent.id, signal)).length;
  const promptCountBeforeRejected = requests('beta').filter(row => row.method === 'session/prompt').length;
  await assert.rejects(tool.execute({ agent: 'beta', prompt: 'Must not dispatch', model: 'stale-model', runtime_mode: 'read-only' }, { agent: parent, signal }), error => {
    assert.equal(error.code, 'ACP_PREPARATION_FAILED'); assert.equal(error.stage, 'model');
    assert.deepEqual(error.availableModels, ['default', 'live-model']);
    assert.match(error.message, /stale-model.*No subagent task was dispatched/s); return true;
  });
  fs.writeFileSync(path.join(root, 'fail-startup'), 'fail');
  try {
    await assert.rejects(tool.execute({ agent: 'beta', prompt: 'Must not dispatch', runtime_mode: 'read-only' }, { agent: parent, signal }), /connection\/authentication.*OAuth token refresh.*ProxyError.*Do not weaken runtime_mode/s);
  } finally { fs.unlinkSync(path.join(root, 'fail-startup')); }
  await assert.rejects(tool.execute({ agent: 'beta', prompt: 'Must not dispatch', reasoning_effort: 'medium' }, { agent: parent, signal }), /does not advertise reasoning effort.*No subagent task was dispatched/s);
  await assert.rejects(tool.execute({ agent: 'beta', prompt: 'Must not dispatch', options: [{ id: 'permission_mode', value: 'full' }] }, { agent: parent, signal }), /cannot raise permissions.*No subagent task was dispatched/s);
  assert.equal(parent.session.snapshotEvents().filter(event => event.type === 'acp-delegation/start').length, beforeRejected);
  assert.equal((await ctx.subagents.listChildren(parent.id, signal)).length, childrenBeforeRejected);
  assert.equal(requests('beta').filter(row => row.method === 'session/prompt').length, promptCountBeforeRejected);
  pass('stale account models and OAuth proxy failures reject before child creation, task rows or prompts');
  const delegated = await tool.execute({ agent: 'beta', prompt: 'Independent child task', description: 'Review' }, { agent: parent, signal });
  assert.equal(delegated.kind, 'activation');
  await ctx.subagents.waitForChildren(parent);
  await noticeFor(parent, delegated.subagentId);
  assert.equal(selection.current.provider, 'acp:alpha');
  const children = await ctx.subagents.listChildren(parent.id, signal);
  assert.ok(children.some((child) => child.id === delegated.subagentId));
  const preparedPrompt = requests('beta').find(row => row.method === 'session/prompt' && JSON.stringify(row.params).includes('Independent child task'));
  assert.equal(requests('beta').filter(row => row.pid === preparedPrompt.pid && row.method === 'session/new').length, 1, 'execution must reuse the prepared ACP session');
  assert.throws(() => process.kill(preparedPrompt.pid, 0), /ESRCH|not found/i, 'settled child must release its actual ACP process');
  pass('model-facing delegation creates a host-managed child without changing the parent route');
  await ctx.subagents.sendMessage(parent, delegated.subagentId, [{ type: 'text', text: 'Review follow-up task' }], { signal });
  await ctx.subagents.waitForChildren(parent);
  assert.match(JSON.stringify(requests('beta').filter((row) => row.method === 'session/prompt').at(-1)), /Review follow-up task/);
  pass('configured-agent child resumes on a follow-up instead of repeating its original task');
  const followupRows = parent.session.snapshotEvents().filter(event => event.type === 'acp-delegation/start' && event.data.childId === delegated.subagentId);
  assert.equal(followupRows.length, 2, 'one fresh row per activation, not per repeated start edge');
  assert.ok(parent.session.snapshotEvents().some(event => event.type === 'acp-delegation/end' && event.data.taskId === followupRows[1].data.taskId));

  const siblings = await Promise.all(['Parallel one', 'Parallel two'].map((text) => tool.execute({ agent: 'beta', prompt: text }, { agent: parent, signal })));
  assert.notEqual(siblings[0].subagentId, siblings[1].subagentId);
  await ctx.subagents.waitForChildren(parent);
  assert.ok(requests('beta').filter((row) => row.method === 'session/new').length >= 4);
  pass('parallel delegations to the same configured agent keep distinct child sessions');

  // Extract only test-generated bridge env from this fixture's session/new request.
  const injected = requests('alpha').find((row) => row.method === 'session/new').params.mcpServers.find((entry) => entry.name === 'whaleisle');
  const bridgeEnv = Object.fromEntries(injected.env.map((entry) => [entry.name, entry.value]));
  const bridge = fileURLToPath(new URL('../lib/vendor/mcp-bridge.cjs', import.meta.url));
  const runBridge = async (name, args) => {
    if (name === 'acp_delegate') {
      await prompt(parent, `MCP_REQUEST:${JSON.stringify({ name, arguments: args })}`);
      return requests('alpha').findLast(row => row.method === 'fixture/mcp-result').result;
    }
    const { stdout } = await promisify(execFile)(process.execPath, [bridge, 'acp-mcp-call', name, JSON.stringify(args)], { env: { ...process.env, ...bridgeEnv }, timeout: 30000, windowsHide: true });
    return JSON.parse(stdout);
  };
  const discovery = await runBridge('acp_agents', {});
  assert.deepEqual(discovery.structuredContent.agents.map(agent => agent.id), ['alpha', 'beta', 'unknown-v2', 'unknown-terminal']);
  const settleDelegate = async (task) => {
    const accepted = await runBridge('acp_delegate', { agent: 'beta', prompt: task });
    assert.equal(accepted.structuredContent.status, 'running');
    assert.match(accepted.structuredContent.next, /end your turn.*not.*poll/i);
    await ctx.subagents.waitForChildren(parent);
    await noticeFor(parent, accepted.structuredContent.subagentId);
    await parent.whenIdle();
    return runBridge('acp_result', { agent_id: accepted.structuredContent.subagentId });
  };
  const result = await settleDelegate('MCP child task');
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.structuredContent.stopReason, 'completed');
  assert.match(JSON.stringify(result.content), /MCP child task/);
  assert.equal(selection.current.provider, 'acp:alpha');
  const notice = parent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled');
  assert.ok(notice, 'host must automatically deliver a settlement notice to the external parent');
  assert.match(JSON.stringify(notice), /MCP child task/);
  assert.match(JSON.stringify(requests('alpha').filter(row => row.method === 'session/prompt').at(-1)), /MCP child task/);
  pass('MCP delegates asynchronously and the real host wakes the ACP parent with the child result');
  const failed = await settleDelegate('FAIL_MODEL_SELECTION');
  assert.equal(failed.isError, true);
  assert.match(JSON.stringify(failed.content), /unavailable for this account/);
  assert.match(JSON.stringify(await noticeFor(parent, failed.structuredContent.subagentId)), /unavailable for this account/, 'automatic notification itself must contain the original model failure');
  assert.equal(parent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === failed.structuredContent.subagentId).length, 1);
  const presentation = parent.session.snapshotEvents().filter((event) => event.type.startsWith('acp-delegation/'));
  assert.ok(presentation.some((event) => event.type === 'acp-delegation/start' && event.data.agentName === 'beta' && event.data.model === 'default'));
  assert.ok(presentation.some((event) => event.type === 'acp-delegation/end' && /unavailable for this account/.test(event.data.diagnostic)));
  pass('failed model selection returns the actual child error and durable Agent/model presentation');
  const transportFailure = await settleDelegate('FAIL_OAUTH_TRANSPORT');
  assert.match(JSON.stringify(await noticeFor(parent, transportFailure.structuredContent.subagentId)), /OAuth refresh failed: ProxyError/);
  pass('post-acceptance transport failures preserve their detailed cause in the automatic result');

  for (const probe of ['TOOL_NO_TERMINAL', 'TOOL_NO_TERMINAL_ERROR']) {
    const value = await settleDelegate(probe);
    assert.equal(value.structuredContent.stopReason, probe.endsWith('ERROR') ? 'error' : 'completed');
    assert.match(JSON.stringify(value.content), probe.endsWith('ERROR') ? /Read backend disconnected/ : /READ_RESULT_READY/);
  }
  pass('missing terminal tool updates release the real host on prompt completion and failure');

  const started = Date.now();
  const delayed = await runBridge('acp_delegate', { agent: 'beta', prompt: 'DELAYED_RESULT' });
  assert.equal(delayed.structuredContent.status, 'running');
  assert.ok(Date.now() - started < 5000, 'delegate must return on acceptance, not after the old 15-second wait');
  const id = delayed.structuredContent.subagentId;
  const listing = await runBridge('list_agents', {});
  assert.equal(listing.structuredContent.agents.find(child => child.id === id).status, 'running');
  const final = await runBridge('acp_result', { agent_id: id, wait_ms: 20000 });
  assert.equal(final.structuredContent.status, 'completed');
  assert.match(JSON.stringify(final.content), /DELAYED_RESULT_READY/);
  await parent.whenIdle();
  assert.equal(parent.session.snapshotEvents().filter(event => event.type === 'user/message'
    && event.data.source?.kind === 'subagent-settled'
    && event.data.source.senderSessionId === id).length, 0, 'an explicit completed wait acknowledges the result without a second completion wake');
  const unrelated = await runBridge('acp_result', { agent_id: parent.id });
  assert.equal(unrelated.isError, true);
  assert.match(JSON.stringify(unrelated.content), /direct child/);
  pass('long MCP delegation returns immediately, retains bounded waits, consumes results once and enforces ownership');

  const asyncParent = await ctx.agentLoop.create('async-external-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  await prompt(asyncParent, 'ASYNC_PARENT_CASE');
  assert.equal(asyncParent.status, 'idle', 'the external parent must yield without holding its HTTP call open');
  await ctx.subagents.waitForChildren(asyncParent);
  await noticeFor(asyncParent, asyncParent.session.snapshotEvents().findLast(event => event.type === 'acp-delegation/start').data.childId);
  await asyncParent.whenIdle();
  const asyncEvents = asyncParent.session.snapshotEvents();
  const asyncDelegations = asyncEvents.filter(event => event.type === 'acp-delegation/start');
  assert.equal(asyncDelegations.length, 1);
  const asyncNotice = asyncEvents.find(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled');
  assert.ok(asyncNotice, 'a parent that ended its ACP prompt must receive completion automatically');
  const asyncText = asyncEvents.filter(event => event.type === 'assistant/message').map(event => JSON.stringify(event.data.message.content)).join('\n');
  assert.match(asyncText, /ASYNC_PARENT_YIELDED/);
  assert.match(asyncText, /ASYNC_CHILD_RESULT/);
  assert.ok(requests('alpha').some(row => row.method === 'session/prompt' && JSON.stringify(row.params).includes('ASYNC_CHILD_RESULT')));
  pass('an external parent calls MCP, ends its ACP turn, then resumes with the child result without any status query');

  const waiting = (await runBridge('acp_delegate', { agent: 'beta', prompt: 'WAIT_FOR_CANCEL' })).structuredContent;
  const deadline = Date.now() + 5000;
  while (!requests('beta').some((row) => row.method === 'session/prompt' && JSON.stringify(row.params).includes('WAIT_FOR_CANCEL'))) {
    if (Date.now() > deadline) throw new Error('Child did not start its cancellation scenario.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  ctx.subagents.interrupt(waiting.subagentId, { kind: 'ancestor', agent: parent });
  await ctx.subagents.waitForChildren(parent);
  assert.ok(requests('beta').some((row) => row.method === 'session/cancel'));
  assert.equal((await runBridge('acp_result', { agent_id: waiting.subagentId })).structuredContent.status, 'cancelled');
  pass('parent can interrupt an asynchronous MCP child through the host lifecycle and read its cancelled state');
  await ctx.subagents.sendMessage(parent, waiting.subagentId, [{ type: 'text', text: 'Continue with a fresh task after cancellation.' }], { signal });
  await ctx.subagents.waitForChildren(parent);
  const continued = await ctx.sessionQuery.observeSession(waiting.subagentId);
  try {
    const end = continued.events.findLast(event => event.type === 'turn/end');
    assert.equal(end.data.reason.kind, 'completed');
    const text = continued.events.filter(event => event.type === 'assistant/message').flatMap(event => event.data.message.content).filter(part => part.type === 'text').map(part => part.text).join('\n');
    assert.match(text, /fresh task after cancellation/);
  } finally { continued[Symbol.dispose](); }
  pass('an interrupted child accepts a new task without replaying the stopped turn error');

  const permissionsParent = await ctx.agentLoop.create('permission-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  setSandboxMode(permissionsParent.session, 'danger-full-access');
  ctx.approval.setPolicy(permissionsParent, 'never');
  await prompt(permissionsParent, 'PERMISSION_PROBE');
  assert.match(JSON.stringify(permissionsParent.session.snapshotEvents().filter((event) => event.type === 'assistant/message')), /PERMISSION_ALLOWED/);
  assert.equal(permissionsParent.session.snapshotEvents().filter((event) => event.type === 'approval/asked').length, 0);
  pass('full-access + never honors the host grant without requesting an automatically rejected approval');

  setSandboxMode(permissionsParent.session, 'workspace-write');
  await prompt(permissionsParent, 'PERMISSION_PROBE');
  assert.match(JSON.stringify(permissionsParent.session.snapshotEvents().filter((event) => event.type === 'assistant/message').at(-1)), /PERMISSION_DENIED/);
  assert.equal(permissionsParent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'completed');
  pass('switching back to a restricted host policy still rejects unapproved external tool calls');
  const interleavedParent = await ctx.agentLoop.create('interleaved-approval-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  ctx.approval.setPolicy(interleavedParent, 'never');
  for (const mode of ['danger-full-access', 'workspace-write']) {
    setSandboxMode(interleavedParent.session, mode);
    let timer;
    try {
      await Promise.race([prompt(interleavedParent, 'PERMISSION_AFTER_OPEN_READ'), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Later permission deadlocked behind an unfinished read tool')), 5000);
      })]);
    } finally { clearTimeout(timer); }
    const events = interleavedParent.session.snapshotEvents();
    assert.equal(events.findLast(event => event.type === 'turn/end').data.reason.kind, 'completed');
    assert.match(JSON.stringify(events.filter(event => event.type === 'assistant/message').at(-1)), mode === 'danger-full-access' ? /PERMISSION_ALLOWED/ : /PERMISSION_DENIED/);
  }
  pass('later MCP approval bypasses an unfinished read tool without bypassing full-access/restricted policy');
  const approvalRequests = [];
  const stopQuestions = ctx.on('user-questions/request', async (request) => {
    approvalRequests.push(request);
    return { answers: request.questions.map(question => ({ id: question.id, selected: ['Allow once'] })) };
  });
  const askingParent = await ctx.agentLoop.create('approval-routing-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  ctx.approval.setPolicy(askingParent, 'ask');
  setSandboxMode(askingParent.session, 'workspace-write');
  const asking = await tool.execute({ agent: 'beta', prompt: 'PERMISSION_AFTER_OPEN_READ' }, { agent: askingParent, signal });
  await ctx.subagents.waitForChildren(askingParent);
  const answeredNotice = await noticeFor(askingParent, asking.subagentId);
  assert.match(JSON.stringify(answeredNotice), /PERMISSION_ALLOWED/);
  assert.equal(approvalRequests.length, 1);
  assert.equal(approvalRequests[0].agent.id, askingParent.id, 'owned children must ask in the live human root');
  assert.ok(askingParent.session.snapshotEvents().some(event => event.type === 'acp-delegation/state' && event.data.pendingInteraction?.kind === 'approval'));
  stopQuestions();
  pass('restricted child approvals route to the human root without waiting behind an unfinished read');
  const planTask = await tool.execute({ agent: 'beta', prompt: 'PERMISSION_PROBE', interaction_mode: 'plan' }, { agent: askingParent, signal });
  await ctx.subagents.waitForChildren(askingParent);
  assert.match(JSON.stringify(await noticeFor(askingParent, planTask.subagentId)), /PERMISSION_DENIED/);
  assert.equal(approvalRequests.length, 1, 'plan mode must not ask to execute a modifying operation');

  const cancelled = await tool.execute({ agent: 'beta', prompt: 'WAIT_FOR_CANCEL', client_request_id: 'cancel-once' }, { agent: parent, signal });
  const same = await tool.execute({ prompt: 'WAIT_FOR_CANCEL', client_request_id: 'cancel-once', agent: 'beta' }, { agent: parent, signal });
  assert.equal(cancelled.taskId, same.taskId);
  const cancelledChild = ctx.agents.get(cancelled.subagentId);
  const cancelPid = requests('beta').findLast(row => row.method === 'session/new').pid;
  cancelledChild.followup(createUserMessage({ content: [{ type: 'text', text: 'must not run after cancel' }], source: { kind: 'user' } }));
  const cancelResult = await ctx.tools.get('acp_cancel').execute({ task_id: cancelled.taskId }, { agent: parent, signal });
  assert.equal(cancelResult.status, 'cancelled');
  assert.equal(ctx.agents.get(cancelled.subagentId), undefined);
  assert.throws(() => process.kill(cancelPid, 0), /ESRCH|not found/i, 'cancellation must release the ACP process before returning');
  const retainedCancelled = await runBridge('acp_result', { task_id: cancelled.taskId });
  assert.equal(retainedCancelled.structuredContent.status, 'cancelled', 'disposed children must retain readable exact-task receipts');
  assert.equal(parent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled' && event.data.source.senderSessionId === cancelled.subagentId).length, 0);
  pass('idempotent native delegation creates one child; cancellation clears queued input and suppresses completion delivery');
  await ctx.sessionPersistence.flush();
  const reader = new Context();
  try {
    await reader.plugin(Persistence, { root: path.join(root, 'sessions') });
    const handle = await reader.sessionPersistence.open(parent.id, 'read');
    try {
      const stored = await handle.read();
      const records = stored.events.filter(event => event.type.startsWith('acp-delegation/'));
      assert.ok(records.length > 0);
      assert.ok(records.every(event => event.ignorable === true));
    } finally { await handle.close(); }
  } finally { await reader.fiber.dispose(); }
  pass('an independent persistence reader restores delegation records after a cold open');

  const recoveryParent = await ctx.agentLoop.create('recovery-parent', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  await prompt(recoveryParent, 'Do not replay this initial task.');
  const staged = createTaskStore(ctx, storeFile);
  const lost = staged.begin(recoveryParent, { childId: 'lost-before-process-start', agentName: 'beta', model: 'default', delivery: 'caller' });
  const recoverable = staged.begin(recoveryParent, { childId: delegated.subagentId, agentName: 'beta', model: 'default', delivery: 'caller' });
  const childPromptCount = requests('beta').filter(row => row.method === 'session/prompt').length;
  await ctx.sessionPersistence.flush();
  await ctx.fiber.dispose();
  const restoredHost = new Context();
  try {
    await mountAgentLoopTestDependencies(restoredHost, { workingDirectory: true });
    await restoredHost.plugin(Approval);
    await restoredHost.plugin(Questions);
    await restoredHost.plugin(SandboxPolicy);
    await restoredHost.plugin(Persistence, { root: path.join(root, 'sessions') });
    await restoredHost.plugin(SessionQuery.default);
    await restoredHost.plugin(AgentLoop, { agents: [] });
    await restoredHost.plugin(Subagents);
    restoredHost.provide('connection', { requestRejection: () => undefined });
    restoredHost.provide('webServer', { getOrigin: () => origin, register: () => () => {} });
    await restoredHost.plugin(plugin, { storeFile });
    await restoredHost.agentLoop.restoreOrCreateConfigured(restoredHost, restoredHost.sessionPersistence, recoveryParent.id, { provider: 'acp:alpha', model: 'default' }, { cwd: root });
    const restoredParent = restoredHost.agents.get(recoveryParent.id);
    await restoredParent.whenIdle();
    const recovered = createTaskStore(restoredHost, storeFile);
    await recovered.recover(restoredParent);
    await restoredParent.whenIdle();
    assert.match(recovered.get(restoredParent.id, lost.taskId).diagnostic, /not replayed/);
    assert.equal(recovered.get(restoredParent.id, recoverable.taskId).status, 'completed');
    assert.equal(requests('beta').filter(row => row.method === 'session/prompt').length, childPromptCount, 'restart must never replay child prompts');
    const notices = restoredParent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source?.kind === 'subagent-settled');
    assert.equal(notices.length, 2, 'one durable delivery per recovered task, even after a second reconciliation');
    assert.match(JSON.stringify(notices), /fresh task|follow-up task/);
    pass('a cold host restores pending results once, reports interrupted startup and never replays child work');
  } finally { await restoredHost.fiber.dispose(); }
  console.log(JSON.stringify({ checks: checks.length, result: 'PASS', environment: 'real host services, scripted ACP subprocess' }));
} finally {
  await ctx.fiber.dispose();
  await runtimeBundle().disposeAgentRuntime();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Integration artifacts: ${root}`);
}
