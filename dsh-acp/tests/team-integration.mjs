/** Real Cordis + subagents + Agent Teams + ACP subprocesses through the HTTP/MCP bridge. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as plugin from '../lib/index.js';
import { saveAgentsConfig } from '../lib/presets.js';
import { runtimeBundle } from '../lib/agent-runtime.js';
import { allowDesktopConfirm } from './confirm-stub.mjs';

if (!process.env.DSH_HARNESS_ROOT) throw new Error('Set DSH_HARNESS_ROOT to a built DeepSeek Harness checkout.');
const req = createRequire(path.join(process.env.DSH_HARNESS_ROOT, 'packages/subagent/subagent-spawn-in-process/package.json'));
const load = (name) => import(pathToFileURL(req.resolve(name)).href);
// DSH_TEAM_MODULES points at compiled agent-team.mjs/tool-agent-team.mjs when the
// harness checkout has not built its Team packages.
const teamModule = (name, file) => process.env.DSH_TEAM_MODULES
  ? import(pathToFileURL(path.join(process.env.DSH_TEAM_MODULES, file)).href)
  : import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, `packages/team/${name}/lib/index.js`)).href);
const { Context } = await load('@deepseek-ai/cordis');
const { default: AgentLoop } = await load('@deepseek-ai/dsh-agent-loop');
const { default: Subagents } = await load('@deepseek-ai/dsh-subagent');
const Persistence = await load('@deepseek-ai/dsh-session-persistence-jsonl');
const SessionQuery = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/session-query/session-query/lib/index.js')).href);
const { createUserMessage } = await load('@deepseek-ai/dsh-llm');
const dependencies = await Promise.all([
  '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-working-directory',
  '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-user-approval', '@deepseek-ai/dsh-user-questions',
].map(load));
const { default: SandboxPolicy } = await import(pathToFileURL(path.join(process.env.DSH_HARNESS_ROOT, 'packages/sandbox/sandbox-policy/lib/index.js')).href);
const { default: TeamService } = await teamModule('agent-team', 'agent-team.mjs');
const TeamTools = await teamModule('tool-agent-team', 'tool-agent-team.mjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-team-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = root;
const ctx = new Context();
const routes = [];
const server = http.createServer((request, response) => {
  const route = routes.find((entry) => request.url.startsWith(entry.path));
  if (route) void route.handler(request, response);
  else { response.writeHead(404); response.end(); }
});
let origin;
const fixture = fileURLToPath(new URL('./agent-fixture.cjs', import.meta.url));
const storeFile = path.join(root, 'acp-agents.json');

const checks = [];
const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };
const log = (id) => fs.existsSync(path.join(root, `${id}.jsonl`))
  ? fs.readFileSync(path.join(root, `${id}.jsonl`), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
const mcpResults = (id) => log(id).filter((row) => row.method === 'fixture/mcp-result').map((row) => row.result);
const call = (name, args) => `MCP_REQUEST:${JSON.stringify({ name, arguments: args })}`;
async function prompt(agent, text) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
  await agent.whenIdle();
}
/** Run one MCP call through the lead's ACP turn and return its MCP result. */
async function leadCall(lead, name, args) {
  const before = mcpResults('alpha').length;
  await prompt(lead, call(name, args));
  const results = mcpResults('alpha');
  assert.equal(results.length, before + 1, `${name} must reach the MCP bridge once; last turn: ${JSON.stringify(lead.session.snapshotEvents().filter((event) => event.type === 'turn/end').at(-1)?.data)}`);
  return results.at(-1);
}
/** Wait until a delegated child has settled the given number of task rows. */
async function settled(lead, childId, count = 1) {
  await until(() => lead.session.snapshotEvents().filter((event) => event.type === 'acp-delegation/end' && event.data.childId === childId).length >= count, `child ${childId} settles`);
}
async function until(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

let disposeConfirm;
try {
  disposeConfirm = await allowDesktopConfirm();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  saveAgentsConfig(['alpha', 'beta'].map((id) => ({
    id, name: id, enabled: true, command: process.execPath, args: [fixture],
    models: [{ id: 'default', name: 'Fixture default' }], env: { ACP_TEST_LOG: path.join(root, `${id}.jsonl`) },
  })), storeFile);
  for (const dependency of dependencies) await ctx.plugin(dependency.default || dependency);
  await ctx.plugin(SandboxPolicy);
  await ctx.plugin(Persistence, { root: path.join(root, 'sessions') });
  await ctx.plugin(SessionQuery.default);
  await ctx.plugin(AgentLoop, { agents: [] });
  await ctx.plugin(Subagents);
  await ctx.plugin(TeamService);
  await ctx.plugin(TeamTools);
  ctx.provide('connection', { requestRejection: () => undefined });
  ctx.provide('webServer', {
    getOrigin: () => origin,
    register: (route) => { routes.push(route); return () => routes.splice(routes.indexOf(route), 1); },
  });
  await ctx.plugin(plugin, { storeFile });
  await until(() => ctx.get('agentTeams') && ctx.tools.get('acp_delegate'), 'services mounted');

  const lead = await ctx.agentLoop.create('team-lead', { provider: 'acp:alpha', model: 'default' }, { cwd: root });
  const signal = new AbortController().signal;

  // Team off: tools are listed, guidance is absent and calls are refused by mode.
  const refused = await leadCall(lead, 'team_task_list', {});
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /Agent Teams is turned off/);
  const offPrompt = log('alpha').findLast((row) => row.method === 'session/prompt');
  assert.doesNotMatch(JSON.stringify(offPrompt), /Agent Teams is enabled/);
  pass('with Team mode off, ACP agents receive no Team guidance and Team calls are refused');

  await ctx.agentTeams.setEnabled(lead, true, signal);
  const created = await leadCall(lead, 'team_task_create', { subject: 'Implement parser', description: 'Write the parser.', write_scopes: ['src/parser'] });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  const task = created.structuredContent;
  assert.equal(task.status, 'pending');
  assert.equal(task.revision, 1);
  assert.deepEqual(ctx.agentTeams.listTasks(lead).map((item) => item.id), [task.id]);
  assert.match(JSON.stringify(log('alpha').findLast((row) => row.method === 'session/prompt')), /Agent Teams is enabled/);
  pass('an ACP lead receives Team guidance and creates a task on the host board');

  // The lead delegates a named ACP teammate whose own turn claims the task.
  const delegated = await leadCall(lead, 'acp_delegate', { agent: 'beta', name: 'worker', description: 'Parser work',
    prompt: call('team_task_update', { task_id: task.id, expected_revision: 1, action: 'claim' }) });
  assert.equal(delegated.structuredContent.status, 'running', JSON.stringify(delegated));
  assert.equal(delegated.structuredContent.name, 'worker');
  const workerId = delegated.structuredContent.subagentId;
  await settled(lead, workerId);
  const claimed = mcpResults('beta').at(-1);
  assert.equal(claimed.isError, undefined, JSON.stringify(claimed));
  assert.equal(claimed.structuredContent.status, 'in_progress');
  assert.equal(claimed.structuredContent.owner, 'worker');
  assert.equal(ctx.agentTeams.getTask(lead, task.id).ownerId, workerId);
  pass('a named ACP teammate claims a ready task as itself through the host Team service');

  // A second teammate cannot take an owned task, and a stale revision is rejected.
  const rival = await leadCall(lead, 'acp_delegate', { agent: 'beta', name: 'rival', description: 'Rival',
    prompt: call('team_task_update', { task_id: task.id, expected_revision: 2, action: 'claim' }) });
  assert.equal(rival.structuredContent.status, 'running');
  await settled(lead, rival.structuredContent.subagentId);
  const rejected = mcpResults('beta').at(-1);
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /owned by another member/);
  assert.equal(ctx.agentTeams.getTask(lead, task.id).ownerId, workerId);
  pass('another ACP teammate cannot claim a task owned by a different member');

  // Members see the whole team by name; the lead messages the worker by name to complete its task.
  const members = await leadCall(lead, 'list_agents', {});
  const names = members.structuredContent.agents.map((agent) => agent.name);
  assert.deepEqual(names.slice(0, 1), ['lead']);
  assert.ok(names.includes('worker') && names.includes('rival'), names.join(','));
  assert.equal(members.structuredContent.agents.find((agent) => agent.name === 'lead').self, true);
  const sent = await leadCall(lead, 'send_message', { agent_id: 'worker',
    message: call('team_task_update', { task_id: task.id, expected_revision: 2, action: 'complete' }) });
  assert.equal(sent.isError, undefined, JSON.stringify(sent));
  await until(() => ctx.agentTeams.getTask(lead, task.id).status === 'completed', 'worker completes its task');
  await settled(lead, workerId, 2);
  pass('Team members are listed by name and a teammate addressed by name completes its claimed task');

  // The same board is visible through the host's native Team tool.
  const native = await ctx.tools.get('team_task_list').execute({}, { agent: lead, signal });
  assert.deepEqual(native.tasks.map((item) => [item.id, item.status, item.owner]), [[task.id, 'completed', 'worker']]);
  pass('ACP and native Team tools operate on one shared host board');

  // Turning Team off again refuses ACP mutations without touching the board.
  await ctx.agentTeams.setEnabled(lead, false, signal);
  const afterOff = await leadCall(lead, 'team_task_create', { subject: 'Late', description: 'Should not exist.' });
  assert.equal(afterOff.isError, true);
  assert.match(afterOff.content[0].text, /Agent Teams is turned off/);
  await ctx.agentTeams.setEnabled(lead, true, signal);
  assert.deepEqual(ctx.agentTeams.listTasks(lead).map((item) => item.id), [task.id]);
  pass('disabling Team mode refuses later ACP task mutations and keeps existing tasks');

  console.log(JSON.stringify({ checks: checks.length, result: 'PASS', environment: 'real host subagents and Agent Teams, scripted ACP subprocesses' }));
} finally {
  await disposeConfirm?.();
  await ctx.fiber.dispose();
  await runtimeBundle().disposeAgentRuntime();
  await new Promise((resolve) => server.close(resolve));
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  fs.rmSync(root, { recursive: true });
}
