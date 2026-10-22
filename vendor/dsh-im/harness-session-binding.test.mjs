import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { adoptRegisteredWorkspaceSession } from './src/channels/shared/harness-session-binding.mjs';
import { HarnessClient } from './src/channels/shared/harness-client.mjs';
import { BotWorkspaceStore, createBotWorkspaceScope } from './src/channels/shared/bot-workspace-store.mjs';
import { ConversationStateStore } from './src/channels/shared/conversation-state-store.mjs';
import { runWorkspaceCommand } from './src/channels/shared/workspace-command.mjs';
import { createHarnessAuthTransport } from './plugin-src/host/harness-auth-transport.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(packageRoot, '../..');
const workspacePath = resolve(packageRoot);

function bindingClient({ items = [{ workspaceId: 'workspace-1', path: workspacePath, sessionIds: ['history-1'] }],
  archivedSessionIds = [], summaries = [{ sessionId: 'history-1', projections: { values: { title: 'Existing conversation' } } }],
  history = { events: [{ type: 'user/message' }] }, historyError } = {}) {
  const calls = [];
  return {
    calls,
    async ensureRunning(options) { calls.push({ method: 'ensureRunning', options }); },
    async rpc(method, payload, timeout, options) {
      calls.push({ method, payload, timeout, options });
      if (method === 'workspace.list') return { items, archivedSessionIds };
      if (method === 'session.list') return { items: summaries };
      if (method === 'session.history') {
        if (historyError) throw historyError;
        return history;
      }
      throw new Error(`Unexpected mutating RPC ${method}`);
    },
  };
}

test('adoption opens the original history without creating or unarchiving a Session', async () => {
  const client = bindingClient({ archivedSessionIds: ['history-1'] });
  const options = { signal: new AbortController().signal };
  assert.deepEqual(await adoptRegisteredWorkspaceSession(client, 'history-1', options, 1234), {
    sessionId: 'history-1', workspace: workspacePath, title: 'Existing conversation', archived: true,
  });
  assert.deepEqual(client.calls.map(call => call.method), ['ensureRunning', 'workspace.list', 'session.list', 'session.history']);
  assert.deepEqual(client.calls.at(-1).payload, { sessionId: 'history-1', maxMessages: 1 });
  for (const call of client.calls) assert.equal(call.options, options);
  for (const call of client.calls.slice(1)) assert.equal(call.timeout, 1234);
});

for (const [name, fixture, code] of [
  ['unregistered', { items: [] }, 'session-not-registered'],
  ['ambiguous workspace', { items: [
    { workspaceId: 'workspace-1', path: workspacePath, sessionIds: ['history-1'] },
    { workspaceId: 'workspace-2', path: workspacePath, sessionIds: ['history-1'] },
  ] }, 'session-workspace-ambiguous'],
  ['unavailable summary', { summaries: [] }, 'session-summary-unavailable'],
  ['subagent', { summaries: [{ sessionId: 'history-1', origin: 'subagent' }] }, 'session-subagent-unsupported'],
]) {
  test(`adoption rejects ${name} before opening or mutating the Session`, async () => {
    const client = bindingClient(fixture);
    await assert.rejects(adoptRegisteredWorkspaceSession(client, 'history-1'), { code });
    assert.equal(client.calls.some(call => ['session.history', 'session.create'].includes(call.method)), false);
  });
}

test('adoption propagates access denial and rejects an invalid history response', async () => {
  const denied = Object.assign(new Error('Access denied'), { code: 'access/denied' });
  await assert.rejects(adoptRegisteredWorkspaceSession(bindingClient({ historyError: denied }), 'history-1'), error => error === denied);
  await assert.rejects(adoptRegisteredWorkspaceSession(bindingClient({ history: {} }), 'history-1'), /invalid response for session.history/);
});

// Uses the same opt-in as host-protocol-live.test.mjs. It boots the repository's
// real built Host, authenticates through the production transport, and scripts
// only the model response; no IM account or external provider is contacted.
test('/session binds a cold historical Session through the real Host without replacement Sessions', {
  skip: process.env.DSH_IM_LIVE_TEST !== '1', timeout: 120_000,
}, async () => {
  const scratchRoot = join(repository, '.tmp');
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, 'im-session-adoption-'));
  const home = join(root, 'home'), directory = join(root, 'workspace');
  await mkdir(home); await mkdir(directory);
  const harnessRoot = resolve(packageRoot, '../deepseek-harness');
  const cliRequire = createRequire(join(harnessRoot, 'apps/cli/package.json'));
  const anchors = [cliRequire, ...['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(name => createRequire(cliRequire.resolve(`${name}/package.json`)))];
  anchors.push(createRequire(anchors[1].resolve('@deepseek-ai/dsh-storage-domain/package.json')));
  const resolvePackage = name => {
    for (const anchor of anchors) try { return anchor.resolve(name); }
    catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
    throw new Error(`Missing built Harness dependency ${name}`);
  };
  const { boot, loadOverlayPatches, bundlePatchPaths } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
  const { LlmAdapter } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-llm')).href);
  const { provideCmdline } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/dsh-cmdline')).href);
  const { disposeProfileApplication } = await import(pathToFileURL(join(harnessRoot, 'apps/cli/lib/profile-boot.js')).href);
  class LocalModel extends LlmAdapter {
    requests = 0;
    async resolveModel(provider, id) { return { provider, id, name: id }; }
    async *stream() {
      this.requests++;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'Historical answer preserved.' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Historical answer preserved.' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  const model = new LocalModel();
  const config = join(home, 'cordis.yml');
  await writeFile(config, '[]\n');
  const web = dirname(cliRequire.resolve('@deepseek-ai/dsh-web-app/package.json'));
  const manifest = JSON.parse(await readFile(join(web, 'package.json'), 'utf8'));
  const patches = [
    ...loadOverlayPatches('im-session-adoption', join(harnessRoot, 'packages/bundle/base/cordis.patch.yml')),
    ...bundlePatchPaths(web, manifest.dsh.bundle).flatMap(path => loadOverlayPatches('im-session-adoption', path)),
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'mcp-servers-file', config: { path: join(home, 'mcp-servers.yaml'), watch: false } },
    { id: 'agent-default-model', config: { provider: 'im-adoption', model: 'local' } },
    ...['hmr', 'web-runtime', 'session-telemetry-otel', 'modules', 'session-log-download', 'open-in-app', 'client-hmr', 'directory-picker'].map(id => ({ id, disabled: true })),
  ];
  const prior = Object.fromEntries(['DSH_HOME', 'DSHD_HOME', 'DSH_TELEMETRY_DISABLED'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { DSH_HOME: home, DSHD_HOME: home, DSH_TELEMETRY_DISABLED: '1' });
  let ctx;
  const bootHost = async () => {
    const host = await boot('im-session-adoption', config, patches, ctx => {
      provideCmdline(ctx, { args: ['--no-open', '--host', '127.0.0.1', '--port', '0'], exit: () => {} });
      ctx.loader.internal = { version: 'v2', import: name => import(pathToFileURL(resolvePackage(name)).href) };
    });
    host.llm.registerAdapter(['im-adoption'], model);
    return host;
  };
  const clientFor = ctx => {
    const baseUrl = `http://127.0.0.1:${ctx.webServer.port}`;
    return new HarnessClient({ baseUrl, workspace: directory, ...createHarnessAuthTransport(ctx, baseUrl) });
  };
  try {
    ctx = await bootHost();
    let client = clientFor(ctx);
    const sessionId = await client.createSession();
    await client.rpc('session.rename', { sessionId, title: 'Historical conversation' });
    assert.equal(await client.ask(sessionId, 'Keep this original user message.'), 'Historical answer preserved.');
    const before = await ctx.sessionController.inspect(sessionId);
    const messages = before.events.filter(event => ['user/message', 'assistant/message'].includes(event.type));
    assert.ok(messages.some(event => JSON.stringify(event.data).includes('Keep this original user message.')));
    assert.ok(messages.some(event => JSON.stringify(event.data).includes('Historical answer preserved.')));
    await ctx.sessions.flush(ctx.agents.get(sessionId).session);
    await disposeProfileApplication(ctx); ctx = undefined;
    ctx = await bootHost(); client = clientFor(ctx);
    assert.equal(ctx.agents.get(sessionId), undefined, 'the original Session starts cold');
    const ids = async () => (await client.rpc('session.list', {})).items.map(item => item.sessionId).sort();
    const beforeIds = await ids();
    const beforeRequests = model.requests;
    const workspaces = await new BotWorkspaceStore(join(home, 'bot-workspaces.json'), { defaultWorkspace: home }).load();
    await workspaces.ensure('bot-1');
    const state = await new ConversationStateStore(join(home, 'conversation-state.json')).load();
    await state.setSession('prior-chat', 'prior-workspace-session');
    const scope = createBotWorkspaceScope(client, { botId: 'bot-1', workspaces, state });
    const bound = await runWorkspaceCommand(`/session ${sessionId}`, scope.harness, 'chat-1');
    assert.match(bound.message, new RegExp(`ID：${sessionId}`));
    assert.equal(state.sessionFor('chat-1'), sessionId);
    assert.equal(workspaces.workspaceFor('bot-1'), directory, 'binding adopts the original registered workspace');
    assert.equal(state.sessionFor('prior-chat'), null, 'a workspace switch clears the old workspace mappings');
    assert.deepEqual(await ids(), beforeIds, 'adoption creates no empty replacement Session');
    assert.deepEqual((await ctx.sessionController.inspect(sessionId)).events.filter(event => ['user/message', 'assistant/message'].includes(event.type)), messages);
    assert.equal(model.requests, beforeRequests, 'binding does not submit a model prompt');
    await ctx.workspaceController.archiveSession({ sessionId });
    const archived = await client.adoptWorkspaceSession(sessionId);
    assert.equal(archived.archived, true);
    assert.ok(ctx.workspaceRegistry.archivedSessionIds.includes(sessionId), 'adoption does not restore an archived Session');
    const child = ctx.sessions.create('im-adoption-child', { meta: { cwd: directory, origin: 'subagent', parentSession: sessionId } });
    await ctx.sessions.flush(child);
    await ctx.workspaceRegistry.create(directory);
    await assert.rejects(client.adoptWorkspaceSession(child.id), { code: 'session-subagent-unsupported' });
    const rejected = await runWorkspaceCommand(`/session ${child.id}`, scope.harness, 'child-chat');
    assert.match(rejected.message, /子代理会话不能绑定/);
    assert.equal(state.sessionFor('child-chat'), null);
    const unregistered = ctx.sessions.create('im-adoption-unregistered', { meta: { cwd: home } });
    await ctx.sessions.flush(unregistered);
    await assert.rejects(client.adoptWorkspaceSession(unregistered.id), { code: 'session-not-registered' });
    const missing = await runWorkspaceCommand('/session no-such-session', scope.harness, 'missing-chat');
    assert.match(missing.message, /未找到该会话/);
    assert.equal(state.sessionFor('missing-chat'), null);
  } finally {
    if (ctx) await disposeProfileApplication(ctx);
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    assert.ok(root.startsWith(`${scratchRoot}${sep}im-session-adoption-`));
    await rm(root, { recursive: true, force: true });
  }
});
