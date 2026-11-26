import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBotOutboundBridge } from './src/channels/shared/bot-outbound-bridge.mjs';
import { SingleOwnerAccessGate } from './src/channels/shared/single-owner-gate.mjs';
import { OutboundArtifactRegistry } from './src/channels/shared/semantic/artifact.mjs';
import { FeishuHarnessBridge } from './src/channels/feishu/bridge.mjs';

test('createBotOutboundBridge: registerSender fallback without accountId, unregisterSender, and actionHandler lifecycle', async () => {
  const bridge = createBotOutboundBridge(null, { logger: { warn: () => {} } });
  const deliveries = [];
  const disposeSender = bridge.registerSender(
    'feishu',
    async (payload) => {
      deliveries.push(payload);
      return { ok: true, delivered: true, messageId: 'msg-1' };
    },
    { accountId: 'bot-a' },
  );

  // Explicit accountId hits bot-a; omitted accountId falls back to first feishu:* active sender.
  const res1 = await bridge.deliverReply({
    botId: 'bot-a',
    channel: 'feishu',
    targetId: 'oc_1',
    text: 'hello fallback',
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.delivered, true);
  assert.equal(deliveries.length, 1);

  // Unregister removes the sender and subsequent deliverReply reports no_sender.
  disposeSender();
  const res2 = await bridge.deliverReply({
    botId: 'bot-a',
    channel: 'feishu',
    accountId: 'bot-a',
    targetId: 'oc_1',
    text: 'after dispose',
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.delivered, false);
  assert.equal(res2.code, 'channel_not_connected');

  // Action handler lifecycle: unregistered -> registered -> disposed.
  const noHandler = await bridge.dispatchNeedsYouAction({
    action: 'needs_you_approve',
    botId: 'bot-a',
    itemUid: 'ny-1',
    channel: 'feishu',
  });
  assert.equal(noHandler.ok, false);
  assert.equal(noHandler.handled, false);
  assert.equal(noHandler.code, 'no_action_handler');

  const actions = [];
  const disposeHandler = bridge.registerActionHandler(async (event) => {
    actions.push(event);
    return { ok: true, status: event.kind === 'approve' ? 'approved' : 'snoozed' };
  });

  const approved = await bridge.dispatchNeedsYouAction({
    action: 'needs_you_approve',
    botId: 'bot-a',
    itemUid: 'ny-1',
    channel: 'feishu',
    accountId: 'bot-a',
    operatorId: 'ou_owner',
    chatId: 'oc_1',
    messageId: 'om_1',
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.handled, true);
  assert.equal(approved.status, 'approved');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'approve');
  assert.equal(actions[0].itemUid, 'ny-1');

  const missingUid = await bridge.dispatchNeedsYouAction({
    action: 'needs_you_snooze',
    botId: 'bot-a',
    itemUid: '',
  });
  assert.equal(missingUid.ok, false);
  assert.equal(missingUid.code, 'missing_item_uid');

  disposeHandler();
  const afterDispose = await bridge.dispatchNeedsYouAction({
    action: 'needs_you_snooze',
    botId: 'bot-a',
    itemUid: 'ny-2',
  });
  assert.equal(afterDispose.ok, false);
  assert.equal(afterDispose.handled, false);
  assert.equal(afterDispose.code, 'no_action_handler');
});

test('FeishuHarnessBridge.onCardAction dispatches needs_you_approve / needs_you_snooze and enforces owner + P2P boundaries', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'feishu-ny-'));
  t.after(() => rm(home, { recursive: true, force: true }));

  const gate = new SingleOwnerAccessGate({ filePath: join(home, 'access.json'), defaultHome: home });
  const botGate = gate.createBotGate({
    channel: 'feishu',
    botId: 'bot-ny',
    getBotConfig: () => ({ ownerOpenIds: ['ou_owner_1'] }),
    getPreset: () => 'whale-girl',
    home,
  });

  const sentTexts = [];
  const dispatched = [];
  const outboundBridge = createBotOutboundBridge(null, { logger: { warn: () => {} } });
  let handlerEnabled = true;
  outboundBridge.registerActionHandler(async (event) => {
    if (!handlerEnabled) return { handled: false };
    dispatched.push(event);
    return { ok: true };
  });

  const seen = new Set();
  const bridge = new FeishuHarnessBridge({
    botId: 'bot-ny',
    outboundBridge,
    client: {
      im: {
        v1: {
          message: {
            create: async (req) => {
              sentTexts.push(req?.data?.content ?? '');
              return { code: 0, data: { message_id: `out-${sentTexts.length}` } };
            },
          },
        },
      },
    },
    harness: {
      accessGate: botGate,
      ensureRunning: async () => {},
      ask: async () => ({ text: 'ok' }),
    },
    state: {
      hasSeen: (id) => seen.has(id),
      markSeen: async (id) => { seen.add(id); },
      sessionFor: () => 'sess-1',
      setSession: async () => {},
      clearSession: async () => {},
    },
    status: { messagesReceived: 0, messagesReplied: 0, messagesRejected: 0 },
    allowedSenderOpenIds: new Set(['ou_owner_1']),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });

  // 1. Authorized owner approves and snoozes Needs You card without falling through to expired #cardKeys.
  await bridge.onCardAction({
    event_id: 'evt-ny-1',
    operator: { open_id: 'ou_owner_1' },
    action: { value: { action: 'needs_you_approve', botId: 'bot-ny', itemUid: 'item-100' } },
    context: { open_message_id: 'om-ny-1', open_chat_id: 'oc_p2p', chat_type: 'p2p' },
  });
  await bridge.onCardAction({
    event_id: 'evt-ny-2',
    operator: { open_id: 'ou_owner_1' },
    action: { value: { action: 'needs_you_snooze', botId: 'bot-ny', itemUid: 'item-101' } },
    context: { open_message_id: 'om-ny-2', open_chat_id: 'oc_p2p', chat_type: 'p2p' },
  });
  await bridge.waitForIdle();

  assert.equal(dispatched.length, 2);
  assert.deepEqual(
    dispatched.map((item) => [item.action, item.itemUid, item.channel, item.accountId, item.operatorId]),
    [
      ['needs_you_approve', 'item-100', 'feishu', 'bot-ny', 'ou_owner_1'],
      ['needs_you_snooze', 'item-101', 'feishu', 'bot-ny', 'ou_owner_1'],
    ],
  );
  assert.equal(sentTexts.some((body) => body.includes('这个菜单已过期')), false);
  assert.ok(sentTexts.some((body) => body.includes('已批准')));
  assert.ok(sentTexts.some((body) => body.includes('已延后')));

  // 2. Unauthorized operator must be blocked before dispatching.
  const beforeUnauthorized = dispatched.length;
  await bridge.onCardAction({
    event_id: 'evt-ny-3',
    operator: { open_id: 'ou_stranger' },
    action: { value: { action: 'needs_you_approve', botId: 'bot-ny', itemUid: 'item-102' } },
    context: { open_message_id: 'om-ny-3', open_chat_id: 'oc_p2p', chat_type: 'p2p' },
  });
  await bridge.waitForIdle();
  assert.equal(dispatched.length, beforeUnauthorized);

  // 3. Group card action in whale single-owner mode must be blocked before dispatching.
  await bridge.onCardAction({
    event_id: 'evt-ny-4',
    operator: { open_id: 'ou_owner_1' },
    action: { value: { action: 'needs_you_approve', botId: 'bot-ny', itemUid: 'item-103' } },
    context: { open_message_id: 'om-ny-4', open_chat_id: 'oc_group', chat_type: 'group' },
  });
  await bridge.waitForIdle();
  assert.equal(dispatched.length, beforeUnauthorized);

  // 4. Missing desktop action handler notifies user cleanly instead of claiming the menu expired.
  handlerEnabled = false;
  const sentBeforeFallback = sentTexts.length;
  await bridge.onCardAction({
    event_id: 'evt-ny-5',
    operator: { open_id: 'ou_owner_1' },
    action: { value: { action: 'needs_you_approve', botId: 'bot-ny', itemUid: 'item-104' } },
    context: { open_message_id: 'om-ny-5', open_chat_id: 'oc_p2p', chat_type: 'p2p' },
  });
  await bridge.waitForIdle();
  const fallbackMessages = sentTexts.slice(sentBeforeFallback);
  assert.ok(fallbackMessages.some((body) => body.includes('未注册 Needs You 回调处理器')));
  assert.equal(fallbackMessages.some((body) => body.includes('这个菜单已过期')), false);
});

test('OutboundArtifactRegistry.stage reads current turn via Session.snapshotEvents() without .events', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'artifact-snap-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await writeFile(join(workspace, 'report.txt'), 'artifact payload\n', 'utf8');

  const registry = new OutboundArtifactRegistry();
  const fakeSession = {
    header: { id: 'sess-snap-1', cwd: workspace },
    snapshotEvents() {
      return [
        { type: 'turn/start', data: { turn: 0 } },
        { type: 'turn/end', data: { turn: 0 } },
        { type: 'turn/start', data: { turn: 4 } },
      ];
    },
  };
  assert.equal('events' in fakeSession, false);

  const staged = await registry.stage(
    { path: 'report.txt' },
    { agent: { session: fakeSession }, callId: 'call-snap-1' },
  );
  assert.equal(staged.origin.sessionId, 'sess-snap-1');
  assert.equal(staged.origin.turn, 4);
  registry.release(staged);
});
