import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  attachImmutableSpeaker,
  createSpeakerMetadata,
  formatSpeakerRpcId,
  isSingleOwnerChannel,
  isWhalePolicyEnforced,
  MAX_PENDING_PAIRINGS,
  PAIRING_TTL_MS,
  parseSpeakerFromRpcId,
  resolveLegacyOwnerCandidates,
  SINGLE_OWNER_CHANNELS,
  SingleOwnerAccessGate,
} from './src/channels/shared/single-owner-gate.mjs';
import {
  createSingleOwnerRpcHandler,
  SINGLE_OWNER_ENDPOINTS,
} from './plugin-src/host/channels/shared/single-owner-rpc.mjs';
import { createImHostPlugin } from './plugin-src/host/index.mjs';
import { HarnessClient } from './src/channels/shared/harness-client.mjs';
import { TextHarnessBridge } from './src/channels/shared/text-harness-bridge.mjs';
import { runWorkspaceCommand } from './src/channels/shared/workspace-command.mjs';
import { runPresetCommand } from './src/channels/shared/preset-command.mjs';
import { DiscordRuntime } from './src/channels/discord/discord-runtime.mjs';
import { WeixinHarnessBridge } from './src/channels/weixin/weixin-bridge.mjs';
import { WecomHarnessBridge } from './src/channels/wecom/wecom-bridge.mjs';
import { QqHarnessBridge } from './src/channels/qq/qq-bridge.mjs';
import { DingtalkHarnessBridge } from './src/channels/dingtalk/dingtalk-bridge.mjs';
import { FeishuHarnessBridge } from './src/channels/feishu/bridge.mjs';
import { createFeishuTaskBinding } from './plugin-src/host/channels/feishu/whale-tasks.mjs';

async function createTempHome(t, { whaleEnabled = true, imDefault = true, sessionId = 'whale-resident' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-im-sog-'));
  const home = join(root, 'dsh-home');
  await mkdir(join(home, 'data', 'whale'), { recursive: true });
  await writeFile(join(root, 'config.json'), JSON.stringify({ whaleAssistantEnabled: whaleEnabled }));
  await writeFile(join(home, 'data', 'whale', 'settings.json'), JSON.stringify({ imDefault, sessionId }));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return { root, home };
}

test('9 IM channels are covered by SingleOwnerAccessGate and AI Office Connector stays excluded', async (t) => {
  assert.deepEqual([...SINGLE_OWNER_CHANNELS].sort(), [
    'dingtalk', 'discord', 'feishu', 'qq', 'slack', 'telegram', 'wecom', 'weixin', 'whatsapp',
  ]);
  assert.equal(isSingleOwnerChannel('office'), false);
  for (const ch of SINGLE_OWNER_CHANNELS) assert.equal(isSingleOwnerChannel(ch), true);

  const { home } = await createTempHome(t);
  const gate = await new SingleOwnerAccessGate({ path: join(home, 'integrations', 'im-access.json'), home }).load();
  const seen = new Map();
  const spy = (ch) => async (_ctx, cfg) => { seen.set(ch, cfg); };
  const plugin = createImHostPlugin({
    singleOwnerGate: gate,
    applyFeishu: spy('feishu'),
    applyWeixin: spy('weixin'),
    applyDingtalk: spy('dingtalk'),
    applyWecom: spy('wecom'),
    applyQq: spy('qq'),
    applySlack: spy('slack'),
    applyTelegram: spy('telegram'),
    applyDiscord: spy('discord'),
    applyWhatsapp: spy('whatsapp'),
    applyOffice: spy('office'),
  });
  await plugin.apply({
    connection: { rpc: { intercept: () => () => {} } },
    credentials: {},
    webServer: { port: 3210, register: () => () => {} },
    typertGateway: { registerRpc: () => () => {} },
    tools: { register: () => {} },
    systemPrompt: { add: () => () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }, { dshHome: home });

  for (const ch of SINGLE_OWNER_CHANNELS) {
    assert.equal(seen.get(ch)?.singleOwnerGate, gate, `${ch} should receive shared singleOwnerGate`);
  }
  assert.equal(seen.get('office')?.singleOwnerGate, undefined, 'office must remain independent');
});

test('legacy migration auto-upgrades single explicit non-* ID and fails closed on *, multi, or empty', async (t) => {
  const { home } = await createTempHome(t);
  const gate = await new SingleOwnerAccessGate({ path: join(home, 'integrations', 'im-access.json'), home }).load();

  assert.equal(
    resolveLegacyOwnerCandidates('telegram', { accessMode: 'private-allowlist', allowedUsers: ['123456'] }).singleCandidate,
    '123456',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('feishu', { ownerOpenIds: ['ou_sole_1'] }).singleCandidate,
    'ou_sole_1',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('weixin', { ownerUserId: 'wx_sole_1' }).singleCandidate,
    'wx_sole_1',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('whatsapp', { accessMode: 'private-allowlist', allowedNumbers: ['+8613800001111'] }).singleCandidate,
    '+8613800001111',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('dingtalk', { approvedSenders: [{ staffId: 'dt_staff_1' }] }).singleCandidate,
    'dt_staff_1',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('qq', { ownerUserOpenid: 'qq_sole_1' }).singleCandidate,
    'qq_sole_1',
  );
  assert.equal(
    resolveLegacyOwnerCandidates('telegram', { accessMode: 'compatible', allowedUsers: ['123456'] }).singleCandidate,
    null,
  );
  assert.equal(
    resolveLegacyOwnerCandidates('feishu', { ownerOpenIds: ['*'] }).singleCandidate,
    null,
  );
  assert.equal(
    resolveLegacyOwnerCandidates('feishu', { ownerOpenIds: ['ou_1', 'ou_2'] }).singleCandidate,
    null,
  );
  assert.equal(
    resolveLegacyOwnerCandidates('whatsapp', { accessMode: 'open', accountJid: '123@s.whatsapp.net' }).singleCandidate,
    null,
  );
  assert.equal(
    resolveLegacyOwnerCandidates('qq', { ownerUserOpenid: '' }).singleCandidate,
    null,
  );

  // Single explicit ID auto-migrates smoothly to sole owner.
  const singleGate = gate.createBotGate({
    channel: 'telegram',
    botId: 'tg-single',
    getBotConfig: () => ({ accessMode: 'private-allowlist', allowedUsers: ['999000111'] }),
    getPreset: () => 'whale-girl',
    home,
  });
  const ownerRes = await singleGate.evaluateInbound({
    senderId: '999000111',
    chatType: 'private',
    displayName: 'Alice',
  });
  assert.equal(ownerRes.allowed, true);
  assert.equal(ownerRes.owner?.source, 'migrated');
  assert.deepEqual(ownerRes.speaker, { role: 'owner', chat: 'private' });

  // Non-owner DM against a bot with an established owner is rejected silently without overwriting owner.
  const intruderRes = await singleGate.evaluateInbound({
    senderId: '888000222',
    chatType: 'private',
    displayName: 'Bob',
  });
  assert.equal(intruderRes.allowed, false);
  assert.equal(intruderRes.reason, 'not-owner');
  assert.equal(intruderRes.replyText, null);
  assert.equal(intruderRes.speaker.role, 'none');

  // Wildcard / multi / empty fail-closed and issue a 6-char pairing code on first private DM.
  for (const [botId, botConfig] of [
    ['tg-wild', { accessMode: 'compatible', allowedUsers: ['*'] }],
    ['tg-multi', { accessMode: 'private-allowlist', allowedUsers: ['1001', '1002'] }],
    ['tg-empty', { accessMode: 'private-allowlist', allowedUsers: [] }],
  ]) {
    const botGate = gate.createBotGate({
      channel: 'telegram',
      botId,
      getBotConfig: () => botConfig,
      getPreset: () => 'whale-girl',
      home,
    });
    const dmRes = await botGate.evaluateInbound({
      senderId: 'raw_sender_xyz',
      chatType: 'private',
      displayName: 'Candidate',
    });
    assert.equal(dmRes.allowed, false, `${botId} must fail closed`);
    assert.equal(dmRes.reason, 'pairing-required');
    assert.match(dmRes.pairing?.code ?? '', /^[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(dmRes.replyText?.includes(dmRes.pairing.code));
    assert.equal(dmRes.replyText.includes('raw_sender_xyz'), false, 'reply must not echo raw platform ID');
  }
});

test('strict P2P-only, pending pairing TTL/cap, approve/reject/revoke, and zero raw ID exposure in RPC', async (t) => {
  const { home } = await createTempHome(t);
  let clockMs = 1_700_000_000_000;
  const storePath = join(home, 'integrations', 'im-access.json');
  const gate = await new SingleOwnerAccessGate({
    path: storePath,
    clock: () => clockMs,
    home,
  }).load();
  const botGate = gate.createBotGate({
    channel: 'slack',
    botId: 'slack-1',
    getBotConfig: () => ({ allowedSenders: ['*'] }),
    getPreset: () => 'whale-girl',
    home,
  });

  // Group message is silently rejected and does not enqueue a pairing request.
  const grp = await botGate.evaluateInbound({
    senderId: 'U_GROUP_SECRET_1',
    chatType: 'group',
    displayName: 'GroupUser',
  });
  assert.equal(grp.allowed, false);
  assert.equal(grp.replyText, null);
  assert.equal(grp.reason, 'group-forbidden');
  assert.equal(gate.publicStatus({ channel: 'slack', botId: 'slack-1' }).pending.length, 0);

  // Fill up to MAX_PENDING_PAIRINGS, then verify cap blocks flood.
  let firstCode = '';
  let firstReqId = '';
  for (let i = 0; i < MAX_PENDING_PAIRINGS; i += 1) {
    const res = await botGate.evaluateInbound({
      senderId: `U_RAW_SECRET_${i}`,
      chatType: 'private',
      displayName: `User ${i}`,
    });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, 'pairing-required');
    if (i === 0) {
      firstCode = res.pairing.code;
      firstReqId = res.pairing.requestId;
    }
  }
  const flooded = await botGate.evaluateInbound({
    senderId: 'U_RAW_FLOOD_OVERFLOW',
    chatType: 'private',
    displayName: 'Flooder',
  });
  assert.equal(flooded.allowed, false);
  assert.equal(flooded.reason, 'pairing-flood-limit');
  assert.equal(flooded.replyText, null);

  // Verify RPC status exposes ZERO raw platform IDs anywhere in JSON.
  const rpc = createSingleOwnerRpcHandler(gate);
  const statusRes = await rpc(SINGLE_OWNER_ENDPOINTS.status, { channel: 'slack', botId: 'slack-1' });
  assert.equal(statusRes.ok, true);
  const serializedStatus = JSON.stringify(statusRes);
  assert.equal(serializedStatus.includes('U_RAW_SECRET_0'), false);
  assert.equal(serializedStatus.includes('U_GROUP_SECRET_1'), false);
  assert.equal(statusRes.value.pending.length, MAX_PENDING_PAIRINGS);

  // Reject request #1 (U_RAW_SECRET_1) via RPC.
  const secondReqId = statusRes.value.pending[1].requestId;
  const rejRes = await rpc(SINGLE_OWNER_ENDPOINTS.reject, {
    channel: 'slack',
    botId: 'slack-1',
    requestId: secondReqId,
    confirm: true,
  });
  assert.equal(rejRes.ok, true);
  assert.equal(JSON.stringify(rejRes).includes('U_RAW_SECRET_1'), false);

  // Approve request #0 by case-insensitive short code via RPC.
  const appRes = await rpc(SINGLE_OWNER_ENDPOINTS.approve, {
    channel: 'slack',
    botId: 'slack-1',
    code: firstCode.toLowerCase(),
    confirm: true,
  });
  assert.equal(appRes.ok, true);
  assert.match(appRes.value.owner.senderKey, /^im_owner_[a-f0-9]{32}$/);
  assert.equal(JSON.stringify(appRes).includes('U_RAW_SECRET_0'), false);
  assert.equal(appRes.value.pending.length, 0, 'approving sole owner clears remaining pending requests');

  // Owner is now admitted in private DM, still rejected in group!
  const allowedDm = await botGate.evaluateInbound({ senderId: 'U_RAW_SECRET_0', chatType: 'private' });
  assert.equal(allowedDm.allowed, true);
  assert.deepEqual(allowedDm.speaker, { role: 'owner', chat: 'private' });
  const deniedGroup = await botGate.evaluateInbound({ senderId: 'U_RAW_SECRET_0', chatType: 'group' });
  assert.equal(deniedGroup.allowed, false);
  assert.equal(deniedGroup.reason, 'group-forbidden');

  // Verify persistence across reload from disk.
  const reloaded = await new SingleOwnerAccessGate({ path: storePath, clock: () => clockMs, home }).load();
  assert.equal(reloaded.publicStatus({ channel: 'slack', botId: 'slack-1' }).owner?.senderKey, appRes.value.owner.senderKey);
  assert.equal(reloaded.isOwner({ channel: 'slack', botId: 'slack-1', senderId: 'U_RAW_SECRET_0' }), true);

  // Revoke owner via opaque senderKey.
  const revRes = await rpc(SINGLE_OWNER_ENDPOINTS.revoke, {
    channel: 'slack',
    botId: 'slack-1',
    senderKey: appRes.value.owner.senderKey,
    confirm: true,
  });
  assert.equal(revRes.ok, true);
  assert.equal(revRes.value.owner, null);

  // Pending pairing TTL expiry after PAIRING_TTL_MS.
  const freshDm = await botGate.evaluateInbound({ senderId: 'U_TTL_TEST', chatType: 'private' });
  assert.equal(freshDm.reason, 'pairing-required');
  assert.notEqual(freshDm.pairing.requestId, firstReqId);
  clockMs += PAIRING_TTL_MS + 1_000;
  const afterExpiry = gate.publicStatus({ channel: 'slack', botId: 'slack-1' });
  assert.equal(afterExpiry.pending.length, 0, 'expired pending pairing must be pruned');
  const staleApprove = await rpc(SINGLE_OWNER_ENDPOINTS.approve, {
    channel: 'slack',
    botId: 'slack-1',
    code: freshDm.pairing.code,
    confirm: true,
  });
  assert.equal(staleApprove.ok, false);
});

test('irreversible speaker taint metadata, rpcId encoding, and HarnessClient fail-closed guard', async () => {
  const msg = { content: 'hi' };
  attachImmutableSpeaker(msg, { role: 'guest', chat: 'group' });
  assert.deepEqual(msg.speaker, { role: 'guest', chat: 'group' });
  assert.throws(() => attachImmutableSpeaker(msg, { role: 'owner', chat: 'private' }), /Refusing to upgrade/);
  assert.throws(() => { msg.speaker = { role: 'owner', chat: 'private' }; }, TypeError);

  const rpcId = formatSpeakerRpcId('feishu', { role: 'owner', chat: 'private' }, '11111111-2222-3333-4444-555555555555');
  assert.equal(rpcId, 'feishu-owner-private-11111111-2222-3333-4444-555555555555');
  assert.deepEqual(parseSpeakerFromRpcId(rpcId), { role: 'owner', chat: 'private' });

  const sent = [];
  const client = new HarnessClient({
    baseUrl: 'http://127.0.0.1:1',
    autostart: false,
    promptIdPrefix: 'telegram',
    controlExecutor: async (endpoint, payload) => { sent.push({ endpoint, payload }); return { ok: true }; },
  });
  await assert.rejects(
    () => client.ask('s1', 'hi', { speaker: createSpeakerMetadata({ role: 'none', chat: 'private' }) }),
    /not authorized/i,
  );
  assert.equal(sent.length, 0);
});

test('whale-enforced bots block workspace/session/preset slash commands while non-whale presets preserve them', async (t) => {
  const { home } = await createTempHome(t, { whaleEnabled: true, imDefault: true });
  assert.equal(isWhalePolicyEnforced({ preset: null, home }), true);
  assert.equal(isWhalePolicyEnforced({ preset: 'whale-girl', home }), true);
  assert.equal(isWhalePolicyEnforced({ preset: 'standard', home }), false);

  const whaleHarness = {
    agentPreset: () => 'whale-girl',
    currentWorkspace: () => home,
    listWorkspaces: async () => [{ path: home }],
    listWorkspaceSessions: async () => ({ sessions: [] }),
    agentPresetSettings: async () => ({
      agentPreset: 'standard',
      agentPresetCatalog: { defaultId: 'standard', items: [{ id: 'standard', label: 'Standard' }] },
    }),
    setAgentPreset: async () => ({
      agentPreset: 'standard',
      agentPresetCatalog: { defaultId: 'standard', items: [{ id: 'standard', label: 'Standard' }] },
    }),
    accessGate: { isWhaleEnforced: () => true },
  };
  const stdHarness = {
    ...whaleHarness,
    agentPreset: () => 'standard',
    accessGate: { isWhaleEnforced: () => false },
  };

  for (const cmd of ['/workspace C:\\other', '/workspacelist', '/sessionlist', '/session 1']) {
    const res = await runWorkspaceCommand(cmd, whaleHarness, 'dm:1');
    assert.equal(res.handled, true);
    assert.match(res.message, /鲸鱼娘单人私人助理模式/);
  }
  for (const cmd of ['/presetlist', '/preset standard']) {
    const res = await runPresetCommand(cmd, whaleHarness);
    assert.equal(res.handled, true);
    assert.match(res.message, /鲸鱼娘单人私人助理模式/);
  }

  const wsList = await runWorkspaceCommand('/workspacelist', stdHarness, 'dm:1');
  assert.equal(wsList.handled, true);
  assert.doesNotMatch(wsList.message, /鲸鱼娘单人私人助理模式/);
  const presetList = await runPresetCommand('/presetlist', stdHarness);
  assert.equal(presetList.handled, true);
  assert.doesNotMatch(presetList.message, /鲸鱼娘单人私人助理模式/);
});

test('channel bridges and consolidated Feishu whale-tasks enforce SingleOwnerAccessGate and reject wildcard *', async (t) => {
  const { home } = await createTempHome(t, { whaleEnabled: true, imDefault: true });
  const gate = await new SingleOwnerAccessGate({ path: join(home, 'integrations', 'im-access.json'), home }).load();

  // 1) TextHarnessBridge (Telegram / WhatsApp / Slack / Discord)
  const tgReplies = [];
  const tgPrompts = [];
  const seenIds = new Set();
  const tgAccessGate = gate.createBotGate({
    channel: 'telegram',
    botId: 'tg-bridge',
    getBotConfig: () => ({ accessMode: 'private-allowlist', allowedUsers: ['90001'] }),
    getPreset: () => 'whale-girl',
    home,
  });
  const tgBridge = new TextHarnessBridge({
    descriptor: { key: 'telegram', label: 'Telegram' },
    bot: {
      sendText: async (_target, text) => { tgReplies.push(text); return { ok: true }; },
    },
    harness: {
      accessGate: tgAccessGate,
      agentPreset: () => 'whale-girl',
      workspace: () => home,
      ask: async (prompt, opts) => { tgPrompts.push({ prompt, speaker: opts?.speaker }); return { text: 'ok', sessionId: 'whale-resident' }; },
    },
    state: {
      get: () => null,
      sessionIdFor: () => 'whale-resident',
      setSessionId: async () => {},
      hasSeen: (id) => seenIds.has(id),
      markSeen: async (id) => { seenIds.add(id); },
      setConnectionTestTarget: async () => {},
    },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });

  // Group rejected silently
  await tgBridge.accept({ messageId: 'm1', kind: 'group', conversationId: 'g1', replyTarget: { chatId: 'g1' }, senderId: '90001', content: 'hi', addressed: true });
  assert.equal(tgPrompts.length, 0);
  assert.equal(tgReplies.length, 0);

  // /new blocked in whale mode for owner
  await tgBridge.accept({ messageId: 'm2', kind: 'direct', conversationId: 'c1', replyTarget: { chatId: 'c1' }, senderId: '90001', content: '/new' });
  assert.equal(tgPrompts.length, 0);
  assert.match(tgReplies.at(-1), /鲸鱼娘只有一条常驻对话/);

  // Stranger DM rejected before reaching Harness
  await tgBridge.accept({ messageId: 'm3', kind: 'direct', conversationId: 'c2', replyTarget: { chatId: 'c2' }, senderId: '90002', content: 'hello' });
  assert.equal(tgPrompts.length, 0);

  // 2) DiscordRuntime + Weixin/Wecom/QQ/DingTalk/Feishu bridge classes
  const discordGate = gate.createBotGate({
    channel: 'discord',
    botId: 'dc-1',
    getBotConfig: () => ({ allowedSenders: ['dc_owner'] }),
    getPreset: () => 'whale-girl',
    home,
  });
  const discordRuntime = new DiscordRuntime({
    config: { botId: 'dc-1', groupPolicy: 'open' },
    token: 'fake-token',
    harness: { accessGate: discordGate, agentPreset: () => 'whale-girl' },
    state: {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  assert.equal(typeof discordRuntime, 'object');
  assert.equal((await discordGate.evaluateInbound({ senderId: 'dc_owner', chatType: 'group' })).reason, 'group-forbidden');
  assert.equal(typeof WeixinHarnessBridge, 'function');
  assert.equal(typeof WecomHarnessBridge, 'function');
  assert.equal(typeof QqHarnessBridge, 'function');
  assert.equal(typeof DingtalkHarnessBridge, 'function');
  assert.equal(typeof FeishuHarnessBridge, 'function');

  // Weixin: non-owner DM gets pairing code and never hits harness
  const wxReplies = [];
  const wxSeen = new Set();
  const wxGate = gate.createBotGate({
    channel: 'weixin',
    botId: 'wx-1',
    getBotConfig: () => ({ ownerUserId: '' }),
    getPreset: () => 'whale-girl',
    home,
  });
  const wxBridge = new WeixinHarnessBridge({
    api: { sendText: async (opts) => { wxReplies.push(opts); return { ok: true }; } },
    baseUrl: 'https://ilink.example.invalid',
    token: 'wx-token',
    ownerUserId: 'wx_configured_owner',
    harness: { accessGate: wxGate, agentPreset: () => 'whale-girl' },
    state: {
      hasSeen: (id) => wxSeen.has(id),
      markSeen: async (id) => { wxSeen.add(id); },
      setContextToken: async () => {},
      contextTokenFor: () => 'ctx-1',
    },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  await wxBridge.accept({
    message_id: 'wxm-1',
    from_user_id: 'wx_stranger_raw',
    context_token: 'ctx-1',
    item_list: [{ type: 1, text_item: { text: '你好' } }],
  });
  assert.equal(wxReplies.length, 1);
  assert.match(wxReplies[0].text, /配对码/);
  assert.equal(wxReplies[0].text.includes('wx_stranger_raw'), false);

  // Feishu consolidated createFeishuTaskBinding: rejects '*' wildcard and syncs owner from SingleOwnerAccessGate!
  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });
  const fsGate = gate.createBotGate({
    channel: 'feishu',
    botId: 'fs-1',
    getBotConfig: () => ({ id: 'fs-1', appId: 'cli_1', createdAt: '1', connectedAt: '1', ownerOpenIds: ['*'] }),
    getPreset: () => 'whale-girl',
    home,
  });
  const registeredChannels = new Map();
  const ownerSyncLog = [];
  const fakeWhaleTasks = {
    available: true,
    registerChannel: (key, ch) => { registeredChannels.set(key, ch); return () => registeredChannels.delete(key); },
    assertImRoute: () => {},
    setOwner: async (botId, userId) => { ownerSyncLog.push(['set', botId, userId]); },
    revokeOwner: async (botId) => { ownerSyncLog.push(['revoke', botId]); },
  };
  const binding = createFeishuTaskBinding(
    { get: (k) => (k === 'whaleTasks' ? fakeWhaleTasks : undefined), on: () => () => {} },
    {
      botId: 'fs-1',
      botConfig: { id: 'fs-1', appId: 'cli_1', createdAt: '1', connectedAt: '1', ownerOpenIds: ['*'] },
      workspaces: { has: () => true, agentPresetFor: () => 'whale-girl' },
      configStore: { list: () => [{ id: 'fs-1', appId: 'cli_1', createdAt: '1', connectedAt: '1', ownerOpenIds: ['*'] }] },
      accessGate: fsGate,
    },
  );
  const ac = new AbortController();
  binding.attach({ client: {}, signal: ac.signal, allowedSenderOpenIds: new Set(['*']) });
  assert.ok(registeredChannels.get('feishu:fs-1'));
  // Pair and approve via SingleOwnerAccessGate -> triggers onOwnerChange sync to whaleTasks!
  const fsPair = await fsGate.evaluateInbound({ senderId: 'ou_real_owner', chatType: 'private' });
  assert.equal(fsPair.reason, 'pairing-required');
  const approved = await gate.approvePairing({ channel: 'feishu', botId: 'fs-1', code: fsPair.pairing.code });
  assert.equal(fsGate.isOwner('ou_real_owner'), true);
  assert.equal(fsGate.isOwner('ou_other'), false);
  assert.deepEqual(ownerSyncLog.at(-1), ['set', 'fs-1', 'ou_real_owner']);
  // Revoking via SingleOwnerAccessGate syncs revokeOwner to whaleTasks!
  await gate.revokeOwner({ channel: 'feishu', botId: 'fs-1', senderKey: approved.owner.senderKey });
  assert.equal(fsGate.isOwner('ou_real_owner'), false);
  assert.deepEqual(ownerSyncLog.at(-1), ['revoke', 'fs-1']);
});

test('Wecom, QQ, DingTalk, and Feishu bridges enforce fail-closed P2P, pairing, menu restrictions, and zero raw-ID leakage', async (t) => {
  const { home } = await createTempHome(t, { sessionId: 'session-whale-1' });
  const prevDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevDshHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevDshHome;
  });
  const gate = new SingleOwnerAccessGate({ path: join(home, 'gate-bridges.json'), home });

  // Stable migrated senderKey & registered bot config visibility before any inbound message
  gate.registerBotConfigSource('feishu', () => [{ id: 'fs-mig', ownerOpenIds: ['ou_legacy_only'] }]);
  const st1 = gate.publicStatus({ channel: 'feishu', botId: 'fs-mig' });
  const st2 = gate.publicStatus({ channel: 'feishu', botId: 'fs-mig' });
  assert.equal(st1.owner?.source, 'migrated');
  assert.equal(st1.owner.senderKey, st2.owner.senderKey, 'migrated senderKey must remain stable across polls');
  const listed = gate.listPublicStatuses();
  assert.ok(listed.some((row) => row.channel === 'feishu' && row.botId === 'fs-mig' && row.owner?.senderKey === st1.owner.senderKey));

  // 1. WeCom bridge: group & unknown chattype rejected fail-closed; unpaired single DM gets pairing code; approved owner passes
  const wcSent = [];
  const wcSeen = new Set();
  const wcSpeakers = [];
  const wcGate = gate.createBotGate({ channel: 'wecom', botId: 'wc-1', getBotConfig: () => ({}), getPreset: () => 'whale-girl', home });
  const wcBridge = new WecomHarnessBridge({
    client: {
      replyStream: async (_f, _id, text) => { wcSent.push(text); },
      sendMessage: async (_chatId, body) => { wcSent.push(body?.markdown?.content ?? body?.text?.content ?? ''); },
    },
    harness: {
      accessGate: wcGate,
      agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }),
      ensureRunning: async () => {},
      ask: async (_sid, _text, opts) => { wcSpeakers.push(opts?.speaker); return { text: 'ok' }; },
      sessionExists: async () => true,
      createSession: async () => 'session-whale-1',
    },
    state: { hasSeen: (id) => wcSeen.has(id), markSeen: async (id) => { wcSeen.add(id); }, sessionFor: () => 'session-whale-1', setSession: async () => {} },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  // Group & unknown chattype rejected silently
  await wcBridge.accept({ headers: { req_id: 'r1' }, body: { msgid: 'wc-g1', chattype: 'group', chatid: 'g1', from: { userid: 'wc_u1' }, msgtype: 'text', text: { content: 'hi' } } });
  await wcBridge.accept({ headers: { req_id: 'r2' }, body: { msgid: 'wc-u1', chattype: 'channel', chatid: 'c1', from: { userid: 'wc_u1' }, msgtype: 'text', text: { content: 'hi' } } });
  assert.equal(wcSent.length, 0);
  // Single DM unpaired -> pairing reply
  await wcBridge.accept({ headers: { req_id: 'r3' }, body: { msgid: 'wc-p1', chattype: 'single', chatid: 'u1', from: { userid: 'wc_u1', name: 'Alice' }, msgtype: 'text', text: { content: 'hello' } } });
  assert.equal(wcSent.length, 1);
  assert.match(wcSent[0], /配对码/);
  const wcPending = gate.publicStatus({ channel: 'wecom', botId: 'wc-1' }).pending[0];
  await gate.approvePairing({ channel: 'wecom', botId: 'wc-1', code: wcPending.code });
  await wcBridge.accept({ headers: { req_id: 'r4' }, body: { msgid: 'wc-p2', chattype: 'single', chatid: 'u1', from: { userid: 'wc_u1' }, msgtype: 'text', text: { content: 'hi again' } } });
  assert.equal(wcSpeakers.length, 1);
  assert.deepEqual(wcSpeakers[0], { role: 'owner', chat: 'private' });

  // 2. QQ bridge: group & unknown kind rejected fail-closed; unpaired c2c gets pairing code; approved owner works even if legacy ownerUserOpenid='*'
  const qqSent = [];
  const qqSeen = new Set();
  const qqSpeakers = [];
  const qqGate = gate.createBotGate({ channel: 'qq', botId: 'qq-1', getBotConfig: () => ({ ownerUserOpenid: '*' }), getPreset: () => 'whale-girl', home });
  const qqBridge = new QqHarnessBridge({
    bot: { sendText: async (_t, text) => { qqSent.push(text); return { providerMessageIds: ['m1'] }; } },
    ownerUserOpenid: '*',
    harness: {
      accessGate: qqGate,
      agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }),
      ensureRunning: async () => {},
      ask: async (_sid, _text, opts) => { qqSpeakers.push(opts?.speaker); return { text: 'ok' }; },
      sessionExists: async () => true,
    },
    state: { hasSeen: (id) => qqSeen.has(id), markSeen: async (id) => { qqSeen.add(id); }, sessionFor: () => 'session-whale-1', setSession: async () => {} },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  await qqBridge.accept({ messageId: 'qq-g1', kind: 'group', groupOpenid: 'grp1', senderId: 'qq_u1', content: 'hi', replyTarget: { scope: 'group', targetId: 'grp1' } });
  await qqBridge.accept({ messageId: 'qq-x1', kind: 'guild', senderId: 'qq_u1', content: 'hi', replyTarget: { scope: 'guild', targetId: 'ch1' } });
  assert.equal(qqSent.length, 0);
  await qqBridge.accept({ messageId: 'qq-p1', kind: 'c2c', senderId: 'qq_u1', content: 'hello', replyTarget: { scope: 'c2c', targetId: 'qq_u1' } });
  assert.equal(qqSent.length, 1);
  assert.match(qqSent[0], /配对码/);
  const qqPending = gate.publicStatus({ channel: 'qq', botId: 'qq-1' }).pending[0];
  await gate.approvePairing({ channel: 'qq', botId: 'qq-1', code: qqPending.code });
  await qqBridge.accept({ messageId: 'qq-p2', kind: 'c2c', senderId: 'qq_u1', content: 'hi owner', replyTarget: { scope: 'c2c', targetId: 'qq_u1' } });
  assert.deepEqual(qqSpeakers, [{ role: 'owner', chat: 'private' }]);

  // 3. DingTalk bridge: group ('2') & unknown conversationType rejected; unpaired single ('1') gets pairing code; approved owner works
  const dtSent = [];
  const dtSeen = new Set();
  const dtSpeakers = [];
  const dtGate = gate.createBotGate({ channel: 'dingtalk', botId: 'dt-1', getBotConfig: () => ({ approvedSenders: [] }), getPreset: () => 'whale-girl', home });
  const dtBridge = new DingtalkHarnessBridge({
    api: { sendText: async ({ text }) => { dtSent.push(text); return { ok: true }; } },
    clientId: 'dt-client',
    clientSecret: 'dt-secret',
    harness: {
      accessGate: dtGate,
      agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }),
      ensureRunning: async () => {},
      ask: async (_sid, _text, opts) => { dtSpeakers.push(opts?.speaker); return { text: 'ok' }; },
      sessionExists: async () => true,
    },
    state: { hasSeen: (id) => dtSeen.has(id), markSeen: async (id) => { dtSeen.add(id); }, sessionFor: () => 'session-whale-1', setSession: async () => {} },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  const webhook = 'https://oapi.dingtalk.com/robot/sendBySession?session=test123';
  await dtBridge.accept({ msgId: 'dt-g1', conversationType: '2', conversationId: 'cg1', senderStaffId: 'staff_1', msgtype: 'text', text: { content: 'hi' }, sessionWebhook: webhook, isInAtList: true });
  await dtBridge.accept({ msgId: 'dt-x1', conversationType: '9', conversationId: 'cx1', senderStaffId: 'staff_1', msgtype: 'text', text: { content: 'hi' }, sessionWebhook: webhook });
  assert.equal(dtSent.length, 0);
  await dtBridge.accept({ msgId: 'dt-p1', conversationType: '1', senderStaffId: 'staff_1', senderNick: 'Bob', msgtype: 'text', text: { content: 'hello' }, sessionWebhook: webhook });
  assert.equal(dtSent.length, 1);
  assert.match(dtSent[0], /配对码/);
  const dtPending = gate.publicStatus({ channel: 'dingtalk', botId: 'dt-1' }).pending[0];
  await gate.approvePairing({ channel: 'dingtalk', botId: 'dt-1', code: dtPending.code });
  await dtBridge.accept({ msgId: 'dt-p2', conversationType: '1', senderStaffId: 'staff_1', msgtype: 'text', text: { content: 'owner ping' }, sessionWebhook: webhook });
  assert.deepEqual(dtSpeakers, [{ role: 'owner', chat: 'private' }]);

  // 4. Feishu bridge: never leaks raw user_id into displayName, blocks /m -> 1/2/3 menu bypass & preset_default card action
  const fsSent = [];
  const fsSeen = new Set();
  const fsBridgeGate = gate.createBotGate({ channel: 'feishu', botId: 'fs-bridge', getBotConfig: () => ({ ownerOpenIds: [] }), getPreset: () => 'whale-girl', home });
  let clearCalls = 0;
  let presetDefaultCalled = false;
  const fsBridge = new FeishuHarnessBridge({
    client: {
      im: {
        v1: {
          message: {
            create: async (req) => {
              fsSent.push(req?.data?.content ?? '');
              return { code: 0, data: { message_id: `fs-out-${fsSent.length}` } };
            },
          },
        },
      },
    },
    harness: {
      accessGate: fsBridgeGate,
      agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }),
      setAgentPreset: async () => { presetDefaultCalled = true; },
      ensureRunning: async () => {},
      listWorkspaces: async () => ['/tmp/ws'],
      listWorkspaceSessions: async () => ({ workspace: '/tmp/ws', sessions: [] }),
      sessionExists: async () => true,
      ask: async () => ({ text: 'ok' }),
    },
    state: {
      hasSeen: (id) => fsSeen.has(id),
      markSeen: async (id) => { fsSeen.add(id); },
      sessionFor: () => 'session-whale-1',
      setSession: async () => {},
      clearSession: async () => { clearCalls += 1; },
    },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    allowedSenderOpenIds: new Set(['*']),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  await fsBridge.accept({
    sender: { sender_id: { open_id: 'ou_secret_open', user_id: 'raw_feishu_uid_999' } },
    message: { message_id: 'fsm-1', chat_id: 'oc_p2p', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'hello' }) },
  });
  const fsPublic = gate.publicStatus({ channel: 'feishu', botId: 'fs-bridge' });
  assert.equal(fsPublic.pending.length, 1);
  assert.equal(JSON.stringify(fsPublic).includes('raw_feishu_uid_999'), false, 'Feishu raw user_id must never leak via displayName');
  assert.equal(JSON.stringify(fsPublic).includes('ou_secret_open'), false);
  await gate.approvePairing({ channel: 'feishu', botId: 'fs-bridge', code: fsPublic.pending[0].code });
  // Open /m menu, then reply "2" (new) and "1" (workspaces): both must be blocked in Whale single-owner mode!
  await fsBridge.accept({
    sender: { sender_id: { open_id: 'ou_secret_open' } },
    message: { message_id: 'fsm-2', chat_id: 'oc_p2p', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '/m' }) },
  });
  const sentBeforePick = fsSent.length;
  await fsBridge.accept({
    sender: { sender_id: { open_id: 'ou_secret_open' } },
    message: { message_id: 'fsm-3', chat_id: 'oc_p2p', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '2' }) },
  });
  assert.equal(clearCalls, 0, '/m -> 2 must NOT clear session in Whale mode');
  assert.ok(fsSent.slice(sentBeforePick).some((body) => body.includes('常驻对话') || body.includes('单人私人助理')));
  // Card action preset_default must also be blocked!
  await fsBridge.onCardAction({
    operator: { open_id: 'ou_secret_open' },
    action: { value: { action: 'preset_default' } },
    context: { open_message_id: 'fs-out-2', open_chat_id: 'oc_p2p' },
  });
  await fsBridge.waitForIdle();
  assert.equal(presetDefaultCalled, false);
});

test('Audit regression [P1 #12]: isWhalePolicyEnforced covers dsh-bot and enforces single-owner private DM & group-forbidden policy', async (t) => {
  const { home } = await createTempHome(t, { whaleEnabled: false, imDefault: false });
  assert.equal(isWhalePolicyEnforced({ preset: 'dsh-bot', home }), true);
  assert.equal(isWhalePolicyEnforced({ preset: 'dsh-bot-worker', home }), true);
  assert.equal(isWhalePolicyEnforced({ preset: 'standard', home }), false);

  const gate = new SingleOwnerAccessGate({ filePath: join(home, 'access.json'), defaultHome: home });
  const groupDecision = await gate.evaluateInbound({
    channel: 'feishu',
    botId: 'bot-dsh',
    botConfig: { id: 'bot-dsh', appId: 'app-1' },
    senderId: 'ou_stranger',
    chatType: 'group',
    preset: 'dsh-bot',
    home,
  });
  assert.equal(groupDecision.enforced, true);
  assert.equal(groupDecision.allowed, false);
  assert.equal(groupDecision.reason, 'group-forbidden');

  const dmDecision = await gate.evaluateInbound({
    channel: 'feishu',
    botId: 'bot-dsh',
    botConfig: { id: 'bot-dsh', appId: 'app-1' },
    senderId: 'ou_stranger',
    chatType: 'private',
    preset: 'dsh-bot',
    home,
  });
  assert.equal(dmDecision.enforced, true);
  assert.equal(dmDecision.allowed, false);
  assert.equal(dmDecision.reason, 'pairing-required');
});
