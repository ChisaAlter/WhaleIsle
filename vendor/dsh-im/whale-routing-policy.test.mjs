import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStateStore } from './src/channels/shared/conversation-state-store.mjs';
import { askInWorkspaceSession } from './src/channels/shared/workspace-session.mjs';
import { selectConversationSession } from './src/channels/shared/session-binding.mjs';
import { whaleSessionResolution } from './src/channels/shared/whale-session.mjs';
const providers = ['shared/conversation-state-store.mjs', 'feishu/state-store.mjs', 'weixin/state-store.mjs', 'dingtalk/state-store.mjs', 'wecom/state-store.mjs', 'qq/state-store.mjs'];

test('every shipped state store retains automatic and manual provenance across reload', async t => {
  const home = await mkdtemp(join(tmpdir(), 'im-route-store-')); t.after(() => rm(home, { recursive: true, force: true }));
  for (const [index, file] of providers.entries()) {
    const mod = await import(`./src/channels/${file}`); const Store = Object.values(mod).find(value => typeof value === 'function' && value.prototype?.sessionFor);
    const target = join(home, `${index}.json`); const state = await new Store(target).load();
    await state.setSession('auto', 'whale', { kind: 'whale-auto', preset: 'whale-girl' });
    await state.setSession('manual', 'other');
    const restored = await new Store(target).load(); assert.equal(restored.bindingFor('auto').kind, 'whale-auto'); assert.equal(restored.bindingFor('manual').kind, 'manual');
    await restored.clearSession('auto'); assert.equal(restored.bindingFor('auto'), null); assert.equal(restored.sessionFor('manual'), 'other');
  }
});

test('disable clears only old automatic whale, and ambiguous legacy whale requires review', async t => {
  const home = await mkdtemp(join(tmpdir(), 'im-route-policy-')); t.after(() => rm(home, { recursive: true, force: true }));
  const state = await new ConversationStateStore(join(home, 'state.json')).load();
  await state.setSession('a', 'whale', { kind: 'whale-auto', preset: 'whale-girl' });
  await state.setSession('b', 'ordinary', { kind: 'manual' });
  const off = { sessionId: null, residentId: 'whale', preset: null };
  assert.equal((await selectConversationSession({}, state, 'a', off)).sessionId, null);
  assert.equal((await selectConversationSession({}, state, 'b', off)).sessionId, 'ordinary');
  await writeFile(join(home, 'legacy.json'), JSON.stringify({ version: 1, sessions: { x: 'whale', y: 'ordinary' } }));
  const legacy = await new ConversationStateStore(join(home, 'legacy.json')).load();
  await assert.rejects(selectConversationSession({}, legacy, 'x', off), { code: 'whale-binding-review' });
  assert.equal(legacy.sessionFor('x'), 'whale'); assert.equal((await selectConversationSession({}, legacy, 'y', off)).sessionId, 'ordinary');
});

test('explicit preset invalidates automatic prior preset while valid manual bindings survive shared default', async t => {
  const home = await mkdtemp(join(tmpdir(), 'im-route-preset-')); t.after(() => rm(home, { recursive: true, force: true }));
  const state = await new ConversationStateStore(join(home, 'state.json')).load();
  await state.setSession('a', 'whale', { kind: 'whale-auto', preset: 'whale-girl' });
  assert.equal((await selectConversationSession({}, state, 'a', { preset: 'standard', residentId: 'whale', sessionId: null })).sessionId, null);
  await state.setSession('a', 'manual-other', { kind: 'manual' });
  assert.equal((await selectConversationSession({}, state, 'a', { preset: null, residentId: 'whale', sessionId: 'whale' })).sessionId, 'manual-other');
});

test('corrupt whale or desktop settings do not block unrelated presets or verified manual non-whale sessions', async t => {
  const base = await mkdtemp(join(tmpdir(), 'im-route-corrupt-')); const home = join(base, 'home');
  await mkdir(join(home, 'data/whale'), { recursive: true });
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(async () => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await rm(base, { recursive: true, force: true }); });
  for (const corrupt of ['whale', 'desktop']) {
    await writeFile(join(base, 'config.json'), corrupt === 'desktop' ? '{broken' : '{}');
    await writeFile(join(home, 'data/whale/settings.json'), corrupt === 'whale' ? '{broken' : JSON.stringify({ sessionId: 'resident', imDefault: true }));
    const state = await new ConversationStateStore(join(home, `${corrupt}.json`)).load();
    await state.setSession('auto', 'resident', { kind: 'whale-auto', preset: 'whale-girl' });
    await state.setSession('manual', 'manual-standard'); let preset = 'standard'; let creates = 0;
    const harness = { agentPresetSettings: async () => ({ agentPreset: preset }), sessionPreset: async id => id === 'manual-standard' ? 'standard' : 'whale-girl',
      workspaceSession: id => ({ sessionExists: async () => true, ask: async () => id }), createSession: async () => { creates++; return 'new-standard'; } };
    assert.equal((await whaleSessionResolution(harness)).sessionId, null);
    assert.equal((await askInWorkspaceSession({ harness, state, key: 'auto', text: 'hi' })).answer, 'new-standard');
    assert.equal(creates, 1);
    preset = null;
    assert.equal((await askInWorkspaceSession({ harness, state, key: 'manual', text: 'hi' })).answer, 'manual-standard');
    await assert.rejects(whaleSessionResolution(harness), SyntaxError);
    preset = 'whale-girl'; await assert.rejects(whaleSessionResolution(harness), SyntaxError);
    await state.setSession('manual-whale', 'resident');
    await assert.rejects(askInWorkspaceSession({ harness, state, key: 'manual-whale', text: 'hi' }), SyntaxError);
    // An unclassified legacy whale still needs an explicit binding decision, even for a non-whale preset.
    preset = 'standard';
    const legacy = { sessionFor: () => 'resident', bindingFor: () => null };
    await assert.rejects(selectConversationSession(harness, legacy, 'legacy', await whaleSessionResolution(harness)), { code: 'whale-binding-review' });
  }
});

test('two default chats share resident identity; switching preset makes next automatic route effective', async t => {
  const base = await mkdtemp(join(tmpdir(), 'im-route-runtime-')); t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'); await mkdir(join(home, 'data/whale'), { recursive: true });
  await writeFile(join(home, 'data/whale/settings.json'), JSON.stringify({ imDefault: true, sessionId: 'resident' }));
  const before = process.env.DSH_HOME; process.env.DSH_HOME = home;
  t.after(() => { if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before; });
  const state = await new ConversationStateStore(join(home, 'state.json')).load(); let preset = null; let creates = 0;
  const harness = { agentPresetSettings: async () => ({ agentPreset: preset }),
    workspaceSession: id => ({ sessionExists: async () => true, ask: async () => id }), createSession: async () => { creates++; return 'standard-new'; } };
  assert.equal((await askInWorkspaceSession({ harness, state, key: 'a', text: 'a' })).answer, 'resident');
  assert.equal((await askInWorkspaceSession({ harness, state, key: 'b', text: 'b' })).answer, 'resident'); assert.equal(creates, 0);
  preset = 'standard'; assert.equal((await askInWorkspaceSession({ harness, state, key: 'a', text: 'new' })).answer, 'standard-new'); assert.equal(creates, 1);
  assert.equal(state.sessionFor('b'), 'resident', 'unvisited chats retain history mappings until individually resolved');
});

test('Audit regression [P0-4]: dsh-bot multi-bot routes in im-routes.json resolve via { channel, accountId } across workspace-session and model-command', async (t) => {
  const { askInWorkspaceSession } = await import('./src/channels/shared/workspace-session.mjs');
  const { runModelCommand } = await import('./src/channels/shared/model-command.mjs');
  const { sharedWhaleSessionId } = await import('./src/channels/shared/whale-session.mjs');

  const dir = await mkdtemp(join(tmpdir(), 'dsh-im-multibot-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(join(home, 'data', 'bots', '_meta'), { recursive: true });
  await writeFile(join(home, 'data', 'bots', '_meta', 'im-routes.json'), JSON.stringify({
    routes: {
      'feishu:bot-alpha': { enabled: true, botId: 'bot-alpha', sessionId: 'sess-alpha-home' },
      'dingtalk:client-beta': { enabled: true, botId: 'bot-beta', sessionId: 'sess-beta-home' },
    },
  }));

  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });

  const asked = [];
  const modelsChecked = [];
  const harness = {
    agentPresetSettings: async () => ({ agentPreset: 'dsh-bot' }),
    accessGate: { channel: 'feishu', botId: 'bot-alpha' },
    workspaceSession(sid) {
      return {
        sessionId: sid,
        sessionExists: async () => sid === 'sess-alpha-home' || sid === 'sess-beta-home',
        models: async () => {
          modelsChecked.push(sid);
          return {
            current: { provider: 'deepseek', model: 'deepseek-chat' },
            groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
            failures: [],
          };
        },
        ask: async (text) => { asked.push({ sid, text }); return { text: `ok:${sid}`, artifacts: [] }; },
      };
    },
    createSession: async () => { throw new Error('must not create per-chat session for dsh-bot route'); },
  };

  assert.equal(await sharedWhaleSessionId(harness, { channel: 'feishu', accountId: 'bot-alpha' }), 'sess-alpha-home');
  assert.equal(await sharedWhaleSessionId(harness), 'sess-alpha-home');

  const state = await new ConversationStateStore(join(dir, 'state.json')).load();
  const reply = await askInWorkspaceSession({
    harness,
    state,
    key: 'chat-1',
    channel: 'dingtalk',
    accountId: 'client-beta',
    text: 'hello beta',
  });
  assert.equal(reply.answer.text, 'ok:sess-beta-home');
  assert.deepEqual(asked, [{ sid: 'sess-beta-home', text: 'hello beta' }]);

  const modelRes = await runModelCommand('/models', harness, state, 'chat-1', {
    channel: 'dingtalk',
    accountId: 'client-beta',
  });
  assert.equal(modelRes.handled, true);
  assert.match(modelRes.message, /deepseek-chat/);
  assert.deepEqual(modelsChecked, ['sess-beta-home']);
});
