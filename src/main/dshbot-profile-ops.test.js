'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const profileOpsUrl = pathToFileURL(path.join(
  __dirname, '..', '..', 'vendor', 'dshbot', 'lib', 'profile-ops.js',
)).href;

async function fixture({ sessions = [], items = [], createdIds = [], resolveError, writable = true } = {}) {
  const { createProfileOperations } = await import(profileOpsUrl);
  let catalog = { items, sections: [], tasks: [], routines: [], audit: [] };
  let revision = 0;
  const stored = new Map(sessions.map((session) => [session.id, session]));
  const calls = { resolve: [], create: [], presentation: [], attach: [], rename: [] };
  const workspaces = new Map([
    ['workspace-home', { path: '/home', attachSession: async (id) => calls.attach.push(id) }],
    ['workspace-next', { path: '/next', attachSession: async (id) => calls.attach.push(id) }],
  ]);
  const controller = {
    async resolveAgent(id) {
      calls.resolve.push(id);
      if (resolveError) return { error: resolveError };
      const session = stored.get(id);
      return session ? { agent: { id, session } }
        : { error: Object.assign(new Error('Session not found'), { code: 'session/not-found' }) };
    },
    async create(request) {
      calls.create.push(request);
      // alpha.3 creates a different conversation if this identity is non-blank.
      const existing = stored.get(request.sessionId);
      const id = createdIds.shift() ?? (existing ? 'unexpected-replacement' : request.sessionId);
      stored.set(id, { id, header: { cwd: workspaces.get(request.workspaceId)?.path ?? request.cwd },
        events: [], snapshotEvents() { return this.events; } });
      calls.presentation.push({ sessionId: id, presentation: request.presentation });
      return { sessionId: id };
    },
    async setPresentation(request) { calls.presentation.push(request); },
    async rename(request) { calls.rename.push(request); },
    async inspect(id) { const session = stored.get(id); return { meta: session.header, events: session.events }; },
    async list() { return { items: [...stored.keys()].map((sessionId) => ({ sessionId })) }; },
  };
  const services = {
    sessionController: controller,
    workspaceRegistry: { get: (id) => workspaces.get(id) },
    sessionProjections: { stateOf: (session) => session.preset },
    agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
  };
  const ctx = {
    get: (name) => services[name],
    settings: { writable, describe: () => [{ ns: 'dsh-bot', revision, value: structuredClone(catalog) }] },
    llm: { resolveCallConfig: async () => {} },
  };
  const scope = {
    get: () => structuredClone(catalog),
    async set(next, previous) {
      assert.deepEqual(previous, catalog);
      catalog = structuredClone(next);
      revision++;
    },
  };
  return { ops: createProfileOperations(ctx, scope, { now: () => 1000 }), calls, controller,
    catalog: () => structuredClone(catalog), revision: () => revision };
}

function existingSession({ cwd = '/home', preset } = {}) {
  const events = [{ type: 'user/message', data: { content: [{ type: 'text', text: 'Keep this history' }] } }];
  return { id: 'session-existing', header: { cwd }, preset, events, snapshotEvents() { return events; } };
}

test('bot/create adopts an existing non-blank Session without replacing history or composition', async () => {
  const session = existingSession({ preset: 'original-preset' });
  const original = structuredClone({ header: session.header, events: session.events, preset: session.preset });
  const f = await fixture({ sessions: [session] });
  const result = await f.ops.create({ revision: 0, id: 'bot-one', name: 'Bot',
    sessionId: session.id, workspaceId: 'workspace-home' });
  assert.equal(result.sessionId, session.id);
  assert.equal(f.catalog().items[0].sessionId, session.id);
  assert.deepEqual(f.calls.resolve, [session.id]);
  assert.deepEqual(f.calls.create, []);
  assert.deepEqual(f.calls.attach, [session.id]);
  assert.equal(f.calls.presentation[0].sessionId, session.id);
  assert.equal(f.calls.presentation[0].presentation.owner, 'dshbot:bot-one');
  assert.deepEqual({ header: session.header, events: session.events, preset: session.preset }, original);
});

test('new Bot and workspace-change bindings use the Session ID returned by create', async () => {
  const f = await fixture({ createdIds: ['session-created', 'session-moved'] });
  const created = await f.ops.create({ revision: 0, id: 'bot-one', name: 'Bot', scratchCwd: '/home' });
  assert.equal(created.sessionId, 'session-created');
  assert.equal(created.item.sessionId, 'session-created');
  assert.equal(f.catalog().items[0].sessionId, 'session-created');
  assert.equal(f.calls.presentation[0].sessionId, 'session-created');
  const moved = await f.ops.update({ ...created.item, revision: f.revision(), workspaceId: 'workspace-next' });
  assert.equal(moved.sessionId, 'session-moved');
  assert.equal(moved.item.sessionId, 'session-moved');
  assert.equal(f.catalog().items[0].sessionId, 'session-moved');
  assert.deepEqual(f.calls.presentation.at(-1), { sessionId: 'session-created', presentation: null });
  assert.equal(f.calls.rename.at(-1).sessionId, 'session-moved');
});

test('Bot adoption rejects cwd and room-preset conflicts without changing the original Session', async () => {
  for (const conflict of ['cwd', 'preset']) {
    const session = existingSession({ preset: 'ordinary' });
    const items = conflict === 'preset' ? [{ id: 'member-a', kind: 'bot' }, { id: 'member-b', kind: 'bot' }] : [];
    const f = await fixture({ sessions: [session], items });
    const input = { revision: 0, name: 'Bot', sessionId: session.id, scratchCwd: conflict === 'cwd' ? '/other' : '/home',
      ...(conflict === 'preset' ? { kind: 'room', memberBotIds: ['member-a', 'member-b'], maxRounds: 1, maxSpeaks: 2 } : {}) };
    await assert.rejects(f.ops.create(input), conflict === 'cwd' ? /belongs to/ : /agent preset/);
    assert.deepEqual(f.calls.create, []);
    assert.deepEqual(f.calls.presentation, []);
    assert.deepEqual(f.catalog().items, items);
    assert.equal(session.events[0].data.content[0].text, 'Keep this history');
  }
});

test('Session recovery failures roll back the Bot catalog instead of creating a replacement', async () => {
  for (const code of ['session/writer-held', 'session/agent-busy', 'gateway/internal']) {
    const session = existingSession();
    const error = Object.assign(new Error(code), { code });
    const f = await fixture({ sessions: [session], resolveError: error });
    await assert.rejects(f.ops.create({ revision: 0, name: 'Bot', sessionId: session.id, scratchCwd: '/home' }),
      (actual) => actual === error);
    assert.deepEqual(f.calls.create, []);
    assert.deepEqual(f.calls.presentation, []);
    assert.deepEqual(f.catalog().items, []);
    assert.equal(session.events[0].data.content[0].text, 'Keep this history');
  }
});

test('read-only Bot catalog denies adoption before resolving or changing a Session', async () => {
  const f = await fixture({ writable: false });
  await assert.rejects(f.ops.create({ revision: 0, name: 'Bot', scratchCwd: '/home' }), /read-only/);
  assert.deepEqual(f.calls.resolve, []);
  assert.deepEqual(f.calls.create, []);
  assert.deepEqual(f.calls.presentation, []);
});
