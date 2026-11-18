import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWhaleIsleMcp } from '../lib/mcp-server.js';
import { TEAM_TOOLS, executeTeamTool, listTeamMembers, teamEnabled } from '../lib/team.js';
import { createAcpAgentsManager } from '../lib/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Host doubles that record the exact caller each Team operation receives. */
function host({ enabled = true } = {}) {
  const lead = { id: 'lead-session', status: 'idle', session: { snapshotEvents: () => [] } };
  const worker = { id: 'worker-session', status: 'running', session: { snapshotEvents: () => [] } };
  const agents = new Map([[lead.id, lead], [worker.id, worker]]);
  const calls = [];
  const board = [{ id: '1', revision: 2, subject: 'Parser', description: 'd', status: 'in_progress', ownerId: worker.id, ownerName: 'worker', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] },
    { id: '2', revision: 1, subject: 'Docs', description: 'd', status: 'pending', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [] }];
  const agentTeams = {
    enabled,
    isEnabled(agent) { calls.push(['isEnabled', agent.id]); return this.enabled; },
    async createTask(caller, request) { calls.push(['createTask', caller.id, request]); return { id: '3', revision: 1, status: 'pending', blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [], ...request }; },
    listTasks(caller) { calls.push(['listTasks', caller.id]); return board; },
    getTask(caller, id) { calls.push(['getTask', caller.id, id]); return board.find((task) => task.id === id); },
    async updateTask(caller, request) { calls.push(['updateTask', caller.id, request]); return { ...board[1], revision: 2, status: 'in_progress', ownerId: caller.id, ownerName: 'worker' }; },
  };
  const subagents = {
    rootOf: () => lead,
    resolveName: async (_caller, name) => ({ lead: lead.id, worker: worker.id })[name] ?? name,
    listDescendants: async () => [
      { kind: 'child', id: worker.id, path: 'worker', mode: 'continuable', label: 'Parser work', parentId: lead.id, depth: 1 },
      { kind: 'child', id: 'one-shot', path: 'once', mode: 'one-shot', parentId: lead.id, depth: 1 },
    ],
    interrupt: (id, authority) => calls.push(['interrupt', id, authority.agent.id]),
    sendMessage: async (sender, target) => { calls.push(['sendMessage', sender.id, target]); return 'message-1'; },
  };
  const ctx = { agents, agentTeams, subagents, get(name) { return this[name]; } };
  return { ctx, lead, worker, calls, agentTeams };
}

test('Team tools are published only when the host mounts Agent Teams, with the native schemas', async () => {
  const listed = async (ctx) => (await createWhaleIsleMcp({ ctx }).dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {})).body.result.tools.map((tool) => tool.name);
  assert.ok(!(await listed({})).some((name) => name.startsWith('team_')));
  const names = await listed(host().ctx);
  for (const tool of TEAM_TOOLS) assert.ok(names.includes(tool.name), tool.name);
  assert.deepEqual(TEAM_TOOLS.find((tool) => tool.name === 'team_task_update').inputSchema.properties.action.enum,
    ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete']);
});

test('every Team operation is authorized as the exact calling Agent, and owners are names', async () => {
  const { ctx, worker, calls } = host();
  const signal = new AbortController().signal;
  const created = await executeTeamTool(ctx, 'team_task_create', { subject: 'S', description: 'D', write_scopes: ['src'] }, worker, signal);
  assert.equal(created.id, '3');
  const claimed = await executeTeamTool(ctx, 'team_task_update', { task_id: '2', expected_revision: 1, action: 'claim' }, worker, signal);
  assert.equal(claimed.owner, 'worker');
  assert.equal(claimed.ownerId, undefined, 'session ids are replaced by names like the native tools');
  await executeTeamTool(ctx, 'team_task_update', { task_id: '1', expected_revision: 2, action: 'reassign', owner: 'lead' }, worker, signal);
  assert.deepEqual(calls.filter(([kind]) => ['createTask', 'updateTask'].includes(kind)).map(([kind, caller, request]) => [kind, caller, request.owner]),
    [['createTask', worker.id, undefined], ['updateTask', worker.id, undefined], ['updateTask', worker.id, 'lead-session']]);
  const page = await executeTeamTool(ctx, 'team_task_list', { owner: 'worker', limit: 1 }, worker, signal);
  assert.deepEqual(page.tasks.map((task) => [task.id, task.owner]), [['1', 'worker']]);
  assert.equal(page.nextCursor, undefined);
  const unowned = await executeTeamTool(ctx, 'team_task_list', { unowned: true }, worker, signal);
  assert.deepEqual(unowned.tasks.map((task) => task.id), ['2']);
  await assert.rejects(executeTeamTool(ctx, 'team_task_list', { owner: 'worker', unowned: true }, worker, signal), /cannot be combined/);
  await assert.rejects(executeTeamTool(ctx, 'team_task_list', { limit: 101 }, worker, signal), /limit/);
  await assert.rejects(executeTeamTool(ctx, 'team_task_create', { subject: 'S', description: 'D', blocked_by: 'x' }, worker, signal), /blocked_by/);
});

test('Team mode is read from the caller tree on every call', async () => {
  const fixture = host({ enabled: false });
  const signal = new AbortController().signal;
  await assert.rejects(executeTeamTool(fixture.ctx, 'team_task_list', {}, fixture.worker, signal), /turned off/);
  fixture.agentTeams.enabled = true;
  assert.equal((await executeTeamTool(fixture.ctx, 'team_task_list', {}, fixture.worker, signal)).tasks.length, 2);
  fixture.agentTeams.isEnabled = () => { throw Object.assign(new Error('no live root'), { code: 'UNAUTHORIZED' }); };
  assert.equal(teamEnabled(fixture.ctx, fixture.worker), false, 'an independently resumed child has no Team mode');
  fixture.agentTeams.isEnabled = () => { throw new Error('projection failed'); };
  assert.throws(() => teamEnabled(fixture.ctx, fixture.worker), /projection failed/);
});

test('team members are the root as lead plus continuable descendants, with the caller marked', async () => {
  const { ctx, worker } = host();
  const members = await listTeamMembers(ctx, worker, new AbortController().signal);
  assert.deepEqual(members.map(({ name, status, self }) => [name, status, self === true]),
    [['lead', 'inactive', false], ['worker', 'running', true]]);
});

test('MCP send_message and interrupt_agent resolve names inside the caller tree', async () => {
  const { ctx, lead, worker, calls } = host();
  const mcp = createWhaleIsleMcp({ ctx, tasks: { latest: () => undefined } });
  const token = mcp.issueToken({ dshSession: lead.session });
  const session = mcp.sessionFor(token);
  session.dshSession = { id: lead.id };
  session.signal = new AbortController().signal;
  const call = async (name, args) => (await mcp.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, session)).body.result;
  assert.equal((await call('send_message', { agent_id: 'worker', message: 'go' })).isError, undefined);
  assert.equal((await call('interrupt_agent', { agent_id: 'worker' })).isError, undefined);
  const outside = await call('interrupt_agent', { agent_id: 'someone-else' });
  assert.equal(outside.isError, true);
  assert.deepEqual(calls.filter(([kind]) => ['sendMessage', 'interrupt'].includes(kind)), [['sendMessage', lead.id, worker.id], ['interrupt', worker.id, lead.id]]);
  const listed = await call('list_agents', {});
  assert.deepEqual(listed.structuredContent.agents.map((agent) => agent.name), ['lead', 'worker']);
});

test('acp_delegate rejects invalid teammate names before any preparation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-team-name-'));
  const storeFile = path.join(dir, 'acp-agents.json');
  const { saveAgentsConfig } = await import('../lib/presets.js');
  saveAgentsConfig([{ id: 'reviewer', name: 'Reviewer', command: 'node', enabled: true, models: [{ id: 'default' }] }], storeFile);
  const subagents = { getProvider: () => ({}), startActivation: async () => assert.fail('must not start') };
  const manager = createAcpAgentsManager({ subagents }, { storeFile });
  const parent = { id: 'parent', session: { header: { cwd: dir }, snapshotEvents: () => [], append() {} } };
  try {
    for (const name of ['lead', 'Upper', '1st', 'x'.repeat(33), 'has space']) {
      await assert.rejects(manager.delegate({ agent: 'reviewer', prompt: 'p', name }, parent, new AbortController().signal, 'caller', subagents), /name must be/, name);
    }
  } finally { await manager.dispose(); fs.rmSync(dir, { recursive: true }); }
});
