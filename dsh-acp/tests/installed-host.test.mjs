/** Exercise managed delegation against the desktop's shipped host, not a source checkout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { saveAgentsConfig } from '../lib/presets.js';

const hostRoot = process.env.DSH_INSTALLED_HOST_ROOT;
if (!hostRoot) throw new Error('Set DSH_INSTALLED_HOST_ROOT to the installed desktop vendor/deepseek-harness directory.');
const req = createRequire(path.join(hostRoot, 'packages/subagent/subagent-spawn-in-process/package.json'));
const load = name => import(pathToFileURL(req.resolve(name)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop');
const { default: Subagents } = await load('@deepseek-ai/dsh-subagent');
const Persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const { default: SessionQuery } = await load('@deepseek-ai/dsh-session-query');
const { createUserMessage } = await load('@deepseek-ai/dsh-llm');
const interactions = await Promise.all(['@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-user-questions', '@deepseek-ai/dsh-sandbox-policy'].map(load));
const deps = await Promise.all([
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-working-directory',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-agent',
].map(load));
const pluginRoot = process.env.DSH_TEST_PLUGIN_ROOT || fileURLToPath(new URL('..', import.meta.url));
const plugin = await import(pathToFileURL(path.join(pluginRoot, 'lib/index.js')).href);
const { runtimeBundle } = await import(pathToFileURL(path.join(pluginRoot, 'lib/agent-runtime.js')).href);
const nativeAgentId = process.env.DSH_TEST_NATIVE_AGENT;
const nativeHome = process.env.DSH_NATIVE_HOME;
if (nativeAgentId && !nativeHome) throw new Error('Set DSH_NATIVE_HOME to use the configured native agent through its existing runtime profile.');

test('installed host admits the exact parent, dispatches once and returns a durable configured-agent result', { timeout: nativeAgentId ? 240000 : 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-installed-host-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = nativeAgentId ? nativeHome : root;
  const storeFile = path.join(root, 'acp-agents.json');
  const rpcLog = path.join(root, 'rpc.jsonl');
  const agents = ['unknown-installed-host', 'switched-installed-host'].map(id => ({ id, name: id, enabled: true,
    command: process.execPath, args: [fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url))],
    env: { ACP_TEST_LOG: rpcLog }, models: [{ id: 'default' }] }));
  if (nativeAgentId) {
    const native = JSON.parse(fs.readFileSync(path.join(nativeHome, 'acp-agents.json'), 'utf8')).agents.find(a => a.id === nativeAgentId);
    assert.ok(native?.enabled, 'The selected real agent must already be enabled');
    agents.push(native);
  }
  saveAgentsConfig(agents, storeFile);
  const ctx = new Context();
  const routes = [];
  const server = http.createServer((request, response) => {
    const route = routes.find(entry => request.url.startsWith(entry.path));
    if (route) void route.handler(request, response); else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const calls = () => fs.readFileSync(rpcLog, 'utf8').trim().split('\n').map(JSON.parse);
  async function prompt(agent, text) {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
    await agent.whenIdle();
  }
  let off, timer;
  try {
    // Production plugins only. The installer intentionally omits the development testkit.
    for (const dep of deps) await ctx.plugin(dep.default || dep);
    for (const dep of interactions) await ctx.plugin(dep.default);
    await ctx.plugin(Persistence, { root: path.join(root, 'sessions') });
    await ctx.plugin(SessionQuery);
    await ctx.plugin(AgentLoop, { agents: [] });
    await ctx.plugin(Subagents);
    ctx.provide('connection', { requestRejection: () => undefined });
    ctx.provide('webServer', { getOrigin: () => origin, register: route => { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); } });
    await ctx.plugin(plugin, { storeFile });
    ctx.on('agent/error', ({ error }) => console.error('Installed-host agent error:', error), { global: true });
    const parent = await ctx.agentLoop.create('installed-host-parent', { provider: 'acp:unknown-installed-host', model: 'default' }, { cwd: root });
    assert.equal(ctx.agents.get(parent.id), parent);
    let childId;
    const settled = new Promise((resolve, reject) => {
      off = ctx.on('session/event', (session, event) => {
        if (session.id === parent.id && event.type === 'acp-delegation/end' && event.data.childId === childId) resolve(event.data);
      });
      timer = setTimeout(() => reject(new Error('Installed-host configured task did not settle')), nativeAgentId ? 210000 : 15000);
    });
    // Keep an early admission rejection from becoming an unrelated unhandled timeout.
    settled.catch(() => {});
    const args = nativeAgentId
      ? { agent: nativeAgentId, model: process.env.DSH_TEST_NATIVE_MODEL, prompt: '只读连通验收。不要调用工具，不要读取或修改文件，只回复 ACP_NATIVE_OK。', client_request_id: 'native-installed-contract' }
      : { agent: 'unknown-installed-host', prompt: 'ASYNC_CHILD_WORK', client_request_id: 'installed-contract' };
    const accepted = await ctx.tools.get('acp_delegate').execute(args, { agent: parent, signal: new AbortController().signal });
    childId = accepted.subagentId;
    assert.equal(accepted.status, 'running');
    if (!nativeAgentId) {
      const running = await ctx.tools.get('acp_result').execute({ task_id: accepted.taskId }, { agent: parent, signal: new AbortController().signal });
      assert.equal(running.status, 'running');
      await prompt(parent, 'MCP_REQUEST:{"name":"list_agents","arguments":{}}');
      const listed = calls().findLast(row => row.method === 'fixture/mcp-result').result;
      assert.notEqual(listed.isError, true, JSON.stringify(listed));
      assert.ok(listed.structuredContent.agents.some(child => child.id === childId));
    }
    const outcome = await settled;
    assert.equal(outcome.status, 'completed', outcome.diagnostic);
    const result = await ctx.tools.get('acp_result').execute({ task_id: accepted.taskId }, { agent: parent, signal: new AbortController().signal });
    assert.equal(result.status, 'completed');
    assert.match(JSON.stringify(result.output), nativeAgentId ? /ACP_NATIVE_OK/ : /ASYNC_CHILD_RESULT/);
    if (!nativeAgentId) {
      assert.equal(calls().filter(call => call.method === 'session/prompt' && JSON.stringify(call.params).includes('ASYNC_CHILD_WORK')).length, 1);
    }
    assert.equal(parent.session.snapshotEvents().filter(event => event.type === 'acp-delegation/start').length, 1);
    await parent.whenIdle();
    if (!nativeAgentId) {
      parent.model.select({ provider: 'acp:switched-installed-host', model: 'default' });
      await prompt(parent, 'MCP_REQUEST:{"name":"acp_agents","arguments":{}}');
      const switched = calls().findLast(row => row.method === 'fixture/mcp-result').result;
      assert.notEqual(switched.isError, true, JSON.stringify(switched));
      assert.ok(switched.structuredContent.agents.some(agent => agent.id === 'unknown-installed-host'));
      const signal = new AbortController().signal;
      const waited = await ctx.tools.get('acp_delegate').execute({ agent: 'unknown-installed-host', prompt: 'ASYNC_CHILD_WORK', mode: 'wait', timeout_ms: 5000 }, { agent: parent, signal });
      assert.equal(waited.status, 'completed');
      await ctx.subagents.sendMessage(parent, childId, [{ type: 'text', text: 'INSTALLED_FOLLOWUP' }], { signal });
      await ctx.subagents.waitForTreeWork(parent);
      const followup = await ctx.tools.get('acp_result').execute({ task_id: accepted.taskId }, { agent: parent, signal });
      assert.equal(followup.status, 'completed', 'earlier exact task remains readable');
      await prompt(parent, 'MCP_REQUEST:{"name":"acp_result","arguments":{"agent_id":"' + childId + '"}}');
      const latest = calls().findLast(row => row.method === 'fixture/mcp-result').result;
      assert.match(JSON.stringify(latest.structuredContent.output), /INSTALLED_FOLLOWUP/);
      const cancel = await ctx.tools.get('acp_delegate').execute({ agent: 'unknown-installed-host', prompt: 'WAIT_FOR_CANCEL' }, { agent: parent, signal });
      const cancelled = await ctx.tools.get('acp_cancel').execute({ task_id: cancel.taskId }, { agent: parent, signal });
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(ctx.agents.get(cancel.subagentId), undefined, 'cancellation releases the live child');
      await parent.whenIdle();
    }
  } catch (error) {
    console.error('Installed-host failure state:', fs.existsSync(path.join(root, 'acp-tasks.json')) ? fs.readFileSync(path.join(root, 'acp-tasks.json'), 'utf8') : 'no tasks');
    console.error('ACP request methods:', fs.existsSync(rpcLog) ? fs.readFileSync(rpcLog, 'utf8').trim().split('\n').map(JSON.parse).map(call => call.method) : []);
    const stored = fs.existsSync(path.join(root, 'acp-tasks.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'acp-tasks.json'))) : { tasks: [] };
    for (const id of ['installed-host-parent', ...stored.tasks.map(t => t.childId)]) {
      const a = ctx.agents?.get(id);
      console.error('Agent:', id, a?.status, a?.session.snapshotEvents().map(e => ({ type: e.type, ...(e.type === 'turn/end' ? { reason: e.data.reason } : {}) })));
    }
    throw error;
  } finally {
    clearTimeout(timer); off?.();
    await ctx.fiber.dispose();
    await runtimeBundle().disposeAgentRuntime();
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    fs.rmSync(root, { recursive: true });
  }
});
