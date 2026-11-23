'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BOTS_LIB_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/lib/bots');
const DSH_IM_SHARED_DIR = path.resolve(__dirname, '../../vendor/dsh-im/src/channels/shared');
const DSH_IM_HOST_INDEX = path.resolve(__dirname, '../../vendor/dsh-im/plugin-src/host/index.mjs');

function importBots(file) {
  return import(pathToFileURL(path.join(BOTS_LIB_DIR, file)).href);
}

function importImShared(file) {
  return import(pathToFileURL(path.join(DSH_IM_SHARED_DIR, file)).href);
}

async function withTempDir(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `whale-w2c-${prefix}-`));
  const closers = [];
  const onClose = (cb) => closers.push(cb);
  try {
    return await fn({ root, onClose });
  } finally {
    for (let i = closers.length - 1; i >= 0; i -= 1) {
      try { await closers[i](); } catch { /* Best-effort test teardown. */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, `Temp root leaked: ${root}`);
  }
}

function makeFakeSsePair(url = '/dsh-bots/events', headers = {}) {
  const req = new EventEmitter();
  req.url = url;
  req.headers = headers;
  const res = new EventEmitter();
  res.chunks = [];
  res.statusCode = null;
  res.writableEnded = false;
  res.destroyed = false;
  res.writeHead = (code) => { res.statusCode = code; };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    if (res.writableEnded || res.destroyed) throw new Error('closed');
    res.chunks.push(String(chunk));
    return true;
  };
  res.end = () => {
    res.writableEnded = true;
    res.emit('close');
  };
  return { req, res };
}

test('9-channel dsh-im config inspection, multi-bot im-routes.json routing, legacy fallback, and legacy-compat launch route', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createWorkStore } = await importBots('work-store.js');
  const { createBotsEventBus } = await importBots('event-bus.js');
  const { createConnectorsService, inspectLocalImChannels } = await importBots('connectors-service.js');
  const { createLegacyCompat } = await importBots('legacy-compat.js');
  const { botMetaDir, imRoutesPath } = await importBots('fs-home.js');
  const {
    currentWhaleSessionResolution,
    resolveImBotRoute,
    sharedWhaleSessionId,
    whaleSessionResolution,
  } = await importImShared('whale-session.mjs');

  await withTempDir('im-routes', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });

    // Populate configs across real dsh-im paths (integrations/dsh-im/ and integrations/dsh-<kind>/)
    fs.mkdirSync(path.join(dshHome, 'integrations', 'dsh-feishu'), { recursive: true });
    fs.writeFileSync(
      path.join(dshHome, 'integrations', 'dsh-feishu', 'config.json'),
      JSON.stringify({ version: 2, bots: [{ id: 'fs-acc-1', appId: 'cli_a', botName: 'Feishu Alpha' }] }),
      'utf8',
    );
    fs.mkdirSync(path.join(dshHome, 'integrations', 'dsh-weixin'), { recursive: true });
    fs.writeFileSync(
      path.join(dshHome, 'integrations', 'dsh-weixin', 'config.json'),
      JSON.stringify({ version: 1, accounts: [{ botId: 'wx_123', accountId: 'wx-acct-1' }] }),
      'utf8',
    );
    fs.mkdirSync(path.join(dshHome, 'integrations', 'dsh-im', 'whatsapp'), { recursive: true });
    fs.writeFileSync(
      path.join(dshHome, 'integrations', 'dsh-im', 'whatsapp', 'config.json'),
      JSON.stringify({ version: 1, bots: [{ botId: 'wa_1', name: 'WA Bot' }] }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(dshHome, 'integrations', 'dsh-im', 'config.json'),
      JSON.stringify({ channels: { qq: { enabled: true, bots: [{ botId: 'qq_1' }] }, telegram: { enabled: true } } }),
      'utf8',
    );

    const inspected = inspectLocalImChannels(dshHome);
    assert.equal(inspected.length, 9);
    assert.deepEqual(
      inspected.map((c) => c.kind),
      ['feishu', 'wecom', 'dingtalk', 'telegram', 'discord', 'slack', 'qq', 'weixin', 'whatsapp'],
    );
    assert.equal(inspected.find((c) => c.kind === 'feishu').configured, true);
    assert.equal(inspected.find((c) => c.kind === 'feishu').accounts[0].accountId, 'fs-acc-1');
    assert.equal(inspected.find((c) => c.kind === 'weixin').configured, true);
    assert.equal(inspected.find((c) => c.kind === 'whatsapp').configured, true);
    assert.equal(inspected.find((c) => c.kind === 'qq').configured, true);
    assert.equal(inspected.find((c) => c.kind === 'telegram').configured, true);
    assert.equal(inspected.find((c) => c.kind === 'discord').configured, false);

    // Setup bots store + connectors + legacy compat
    const dbHandle = openBotsDatabase({ dshHome });
    onClose(() => dbHandle.close());
    const workStore = createWorkStore(dbHandle.db);
    const eventBus = createBotsEventBus();
    onClose(() => eventBus.close());

    const botA = dbHandle.bots.insertBot({
      id: 'bot-a',
      name: 'Captain',
      folder: 'captain',
      chatSessionId: 'sess-home-a',
      imDefault: true,
      launch: { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
    });
    const botB = dbHandle.bots.insertBot({
      id: 'bot-b',
      name: 'OpsBot',
      folder: 'ops-bot',
      chatSessionId: 'sess-home-b',
      imDefault: false,
    });
    dbHandle.bots.updateGlobalConfig({ petBotId: botA.id });

    const connectors = createConnectorsService({ dshHome, botsStore: dbHandle.bots, workStore, eventBus });
    const legacy = createLegacyCompat({
      dshHome,
      botsStore: dbHandle.bots,
      botsService: {
        updateBot: async (id, patch) => dbHandle.bots.updateBot(id, patch),
        updateGlobalSettings: (patch) => dbHandle.bots.updateGlobalConfig(patch),
      },
      sessionRuntime: {
        openHomeChat: async (botId) => ({ sessionId: dbHandle.bots.getBot(botId).chatSessionId, created: false }),
        applyLaunchModel: async () => {},
      },
    });

    // Legacy settings projection writes data/whale/settings.json using unified resolveBotLaunchRoute
    legacy.syncLegacySettingsProjection(botA);
    const legacySettings = legacy.getLegacySettings();
    assert.equal(legacySettings.modelProvider, 'deepseek');
    assert.equal(legacySettings.modelModel, 'deepseek-reasoner');
    assert.equal(legacySettings.modelReasoningEffort, 'high');

    // Before im-routes.json exists, whale-session.mjs falls back 100% to data/whale/settings.json
    assert.equal(resolveImBotRoute({ home: dshHome, channel: 'feishu' }), null);
    const fallbackRes = currentWhaleSessionResolution(null, { home: dshHome, channel: 'feishu' });
    assert.equal(fallbackRes.sessionId, 'sess-home-a');

    // Configure multi-bot IM routes: channel-level feishu -> botA, specific feishu:fs-acc-1 -> botB
    connectors.setChannelBotRoute({ channel: 'feishu', botId: botA.id });
    connectors.setChannelBotRoute({ channel: 'feishu', accountId: 'fs-acc-1', botId: botB.id });
    assert.equal(fs.existsSync(imRoutesPath(botMetaDir(dshHome))), true);

    const routeList = connectors.listChannelBotRoutes();
    assert.equal(routeList.items.length, 2);

    // Exact account match routes to botB; channel-level match routes to botA; unmapped channel falls back to settings.json
    const exactMatch = currentWhaleSessionResolution(null, { home: dshHome, channel: 'feishu', accountId: 'fs-acc-1' });
    assert.equal(exactMatch.sessionId, 'sess-home-b');
    assert.equal(exactMatch.botId, 'bot-b');
    assert.equal(exactMatch.routeKey, 'feishu:fs-acc-1');

    const channelMatch = currentWhaleSessionResolution('dsh-bot', { home: dshHome, channel: 'feishu', accountId: 'other-acc' });
    assert.equal(channelMatch.sessionId, 'sess-home-a');
    assert.equal(channelMatch.routeKey, 'feishu');

    const harnessStub = { agentPresetSettings: async () => ({ agentPreset: 'whale-girl' }) };
    const sharedB = await sharedWhaleSessionId(harnessStub, { home: dshHome, channel: 'feishu', accountId: 'fs-acc-1' });
    assert.equal(sharedB, 'sess-home-b');

    const unmapped = await whaleSessionResolution(harnessStub, { home: dshHome, channel: 'telegram' });
    assert.equal(unmapped.sessionId, 'sess-home-a');

    // Legacy compat resolves routed bot and syncs sessionId updates into im-routes.json
    assert.equal(legacy.resolveImBot({ channel: 'feishu', accountId: 'fs-acc-1' }).id, 'bot-b');
    assert.equal(legacy.resolveImBot({ channel: 'discord' }).id, 'bot-a');
    const updatedBotB = dbHandle.bots.updateBot('bot-b', { chatSessionId: 'sess-home-b-v2' });
    assert.equal(legacy.syncImRoutesForBot(updatedBotB), true);
    assert.equal(
      currentWhaleSessionResolution(null, { home: dshHome, channel: 'feishu', accountId: 'fs-acc-1' }).sessionId,
      'sess-home-b-v2',
    );

    // Unbinding route removes it cleanly and falls back to channel route
    connectors.setChannelBotRoute({ channel: 'feishu', accountId: 'fs-acc-1', botId: null });
    assert.equal(
      currentWhaleSessionResolution(null, { home: dshHome, channel: 'feishu', accountId: 'fs-acc-1' }).sessionId,
      'sess-home-a',
    );
  });
});

test('dsh-im bot-outbound-bridge mounts on host startup, builds Needs You cards, and reports honest delivery results', async () => {
  const {
    createBotOutboundBridge,
    getActiveBotOutboundBridge,
    setActiveBotOutboundBridge,
  } = await importImShared('bot-outbound-bridge.mjs');
  const { createImHostPlugin } = await import(pathToFileURL(DSH_IM_HOST_INDEX).href);

  // 1. Disconnected channel reports honest delivered: false
  const deliveredPayloads = [];
  const bridge = createBotOutboundBridge(null);
  const disconnected = await bridge.deliverReply({
    botId: 'bot-1',
    channel: 'feishu',
    targetId: 'oc_123',
    text: 'Hello',
  });
  assert.equal(disconnected.ok, false);
  assert.equal(disconnected.delivered, false);
  assert.equal(disconnected.code, 'channel_not_connected');

  // 2. Feishu Needs You card builds Schema 2.0 interactive card JSON and delivers
  bridge.registerSender('feishu', async (payload) => {
    deliveredPayloads.push(payload);
    return { messageId: 'om_card_1' };
  });
  const cardRes = await bridge.sendNeedsYouCard({
    botId: 'bot-1',
    channel: 'feishu',
    targetId: 'oc_123',
    item: { uid: 'item-42', title: '批准发版', summary: 'v2.3.0 准备就绪', botName: 'Release Captain' },
  });
  assert.equal(cardRes.ok, true);
  assert.equal(cardRes.delivered, true);
  assert.equal(cardRes.messageId, 'om_card_1');
  assert.equal(cardRes.cardKind, 'needs_you');
  const cardJson = JSON.parse(deliveredPayloads[0].card.content);
  assert.equal(cardJson.schema, '2.0');
  assert.match(cardJson.header.title.content, /批准发版/);

  // 3. Telegram sender reuses TelegramApi with injected fetchImpl
  const tgRequests = [];
  bridge.registerSender('telegram', {
    token: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ12345',
    fetchImpl: async (url, init) => {
      tgRequests.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const tgRes = await bridge.deliverReply({
    botId: 'bot-1',
    channel: 'telegram',
    targetId: '987654',
    text: 'Build succeeded',
  });
  assert.equal(tgRes.ok, true);
  assert.equal(tgRes.delivered, true);
  assert.equal(tgRequests.length, 1);
  assert.equal(tgRequests[0].body.chat_id, '987654');

  // 4. Host plugin startup mounts outbound bridge and cleans up on effect dispose
  const disposes = [];
  const fakeCtx = {
    effect: (fn) => {
      const clean = fn();
      if (typeof clean === 'function') disposes.push(clean);
    },
    logger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
  };
  const noop = async () => {};
  const hostPlugin = createImHostPlugin({
    applyFeishu: noop, applyWeixin: noop, applyDingtalk: noop, applyWecom: noop,
    applyQq: noop, applySlack: noop, applyTelegram: noop, applyDiscord: noop,
    applyWhatsapp: noop, applyOffice: noop,
    singleOwnerGate: { status: () => ({}) },
  });
  await hostPlugin.apply(fakeCtx, {});
  const mounted = getActiveBotOutboundBridge(fakeCtx);
  assert.ok(mounted && typeof mounted.deliverReply === 'function' && typeof mounted.sendNeedsYouCard === 'function');
  for (const fn of disposes) fn();
  assert.equal(getActiveBotOutboundBridge(), null);
  setActiveBotOutboundBridge(null);
});

test('Webhook HMAC-SHA256 verification: valid signature, ±300s skew, replay blocking, and 30 req/min rate limit', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createWorkStore } = await importBots('work-store.js');
  const { createBotsEventBus } = await importBots('event-bus.js');
  const { createConnectorsService, signWebhookPayload } = await importBots('connectors-service.js');
  const { botMetaDir, readWebhookCredentials } = await importBots('fs-home.js');

  await withTempDir('webhooks', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const workStore = createWorkStore(dbHandle.db);
    const eventBus = createBotsEventBus();
    onClose(() => eventBus.close());

    const bot = dbHandle.bots.insertBot({ id: 'bot-wh', name: 'HookBot', folder: 'hook-bot' });
    const connectors = createConnectorsService({
      dshHome: root,
      botsStore: dbHandle.bots,
      workStore,
      eventBus,
    });

    const created = connectors.createWebhook(bot.id, { name: 'CI Deploy', automationId: 'auto-1' });
    const webhookId = created.webhook.id;
    const secret = created.secret;
    assert.ok(secret && secret.length === 64);
    assert.equal(created.webhook.hasSecret, true);
    assert.equal('secret' in created.webhook, false);

    // Raw secret lives ONLY in _meta/bot-credentials/webhooks.json, never on bot record
    const storedCreds = readWebhookCredentials(botMetaDir(root));
    assert.equal(storedCreds[webhookId].secret, secret);
    const rawBot = dbHandle.bots.getBot(bot.id);
    assert.equal(rawBot.connectors.webhooks[0].secret, undefined);

    const nowMs = 1_760_000_000_000;
    const tsSec = Math.floor(nowMs / 1000);
    const rawBody = JSON.stringify({ ref: 'refs/heads/main', commit: 'abc123' });
    const validSig = signWebhookPayload({ secret, timestamp: tsSec, rawBody });

    // 1. Valid signed webhook accepted
    const okRes = connectors.verifyInboundWebhook({
      webhookId,
      timestamp: tsSec,
      signature: `sha256=${validSig}`,
      eventId: 'evt-1',
      rawBody,
      now: nowMs,
    });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.status, 200);
    assert.equal(okRes.botId, bot.id);
    assert.equal(okRes.automationId, 'auto-1');

    // 2. Replay with same (webhookId, eventId) rejected with 409 duplicate_event
    const replayRes = connectors.verifyInboundWebhook({
      webhookId,
      timestamp: tsSec,
      signature: validSig,
      eventId: 'evt-1',
      rawBody,
      now: nowMs + 1000,
    });
    assert.equal(replayRes.ok, false);
    assert.equal(replayRes.status, 409);
    assert.equal(replayRes.code, 'duplicate_event');

    // 3. Invalid signature rejected with 401
    const badSig = connectors.verifyInboundWebhook({
      webhookId,
      timestamp: tsSec,
      signature: '0'.repeat(64),
      eventId: 'evt-2',
      rawBody,
      now: nowMs + 2000,
    });
    assert.equal(badSig.ok, false);
    assert.equal(badSig.status, 401);
    assert.equal(badSig.code, 'invalid_signature');

    // 4. Timestamp outside ±300s window rejected with 401
    const staleTs = tsSec - 305;
    const staleSig = signWebhookPayload({ secret, timestamp: staleTs, rawBody });
    const staleRes = connectors.verifyInboundWebhook({
      webhookId,
      timestamp: staleTs,
      signature: staleSig,
      eventId: 'evt-3',
      rawBody,
      now: nowMs + 3000,
    });
    assert.equal(staleRes.ok, false);
    assert.equal(staleRes.status, 401);
    assert.equal(staleRes.code, 'timestamp_out_of_window');

    // 5. Per-hook rate limit (30 req/min) blocks 31st call in same minute and recovers after 60s
    const hook2 = connectors.createWebhook(bot.id, { name: 'RateTest' });
    const t0 = nowMs + 100_000;
    const s0 = Math.floor(t0 / 1000);
    const sig2 = signWebhookPayload({ secret: hook2.secret, timestamp: s0, rawBody });
    for (let i = 0; i < 30; i += 1) {
      const r = connectors.verifyInboundWebhook({
        webhookId: hook2.webhook.id,
        timestamp: s0,
        signature: sig2,
        eventId: `rate-evt-${i}`,
        rawBody,
        now: t0 + i * 10,
      });
      assert.equal(r.ok, true, `Request #${i + 1} should succeed`);
    }
    const limited = connectors.verifyInboundWebhook({
      webhookId: hook2.webhook.id,
      timestamp: s0,
      signature: sig2,
      eventId: 'rate-evt-30',
      rawBody,
      now: t0 + 500,
    });
    assert.equal(limited.ok, false);
    assert.equal(limited.status, 429);
    assert.equal(limited.code, 'rate_limited');

    const afterWindow = t0 + 61_000;
    const sAfter = Math.floor(afterWindow / 1000);
    const sigAfter = signWebhookPayload({ secret: hook2.secret, timestamp: sAfter, rawBody });
    const recovered = connectors.verifyInboundWebhook({
      webhookId: hook2.webhook.id,
      timestamp: sAfter,
      signature: sigAfter,
      eventId: 'rate-evt-31',
      rawBody,
      now: afterWindow,
    });
    assert.equal(recovered.ok, true);

    // 6. Delete webhook wipes stored secret
    const del = connectors.deleteWebhook(bot.id, webhookId);
    assert.equal(del.deleted, true);
    assert.equal(readWebhookCredentials(botMetaDir(root))[webhookId], undefined);
  });
});

test('Group Coordinator Plan-Gate (awaiting_approval -> approveGroupPlan concurrency<=3, depth<=6, cycle guard) + image passthrough', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createGroupsStore } = await importBots('groups-store.js');
  const { createBotsEventBus } = await importBots('event-bus.js');
  const { createGroupsService, validatePlanSteps } = await importBots('groups-service.js');

  await withTempDir('groups-plan-gate', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const groupsStore = createGroupsStore(dbHandle.db);
    const eventBus = createBotsEventBus();
    onClose(() => eventBus.close());

    const coord = dbHandle.bots.insertBot({ id: 'b-coord', name: 'Coordinator', folder: 'coord' });
    const members = [];
    for (let i = 1; i <= 5; i += 1) {
      members.push(dbHandle.bots.insertBot({ id: `b-w${i}`, name: `Worker${i}`, folder: `w${i}` }));
    }

    let inFlight = 0;
    let peakConcurrency = 0;
    const turnLog = [];
    const sessionToBot = new Map();

    const sessionRuntime = {
      async startSideChat(botId, opts) {
        sessionToBot.set(opts.sessionId, botId);
        return { sessionId: opts.sessionId };
      },
      async runSingleTurn(sessionId, prompt, opts = {}) {
        const botId = sessionToBot.get(sessionId);
        turnLog.push({ botId, prompt, images: opts.images ?? null });
        if (botId === coord.id && prompt.includes('Coordinator Plan Phase 1')) {
          return {
            ok: true,
            reply: JSON.stringify({
              summary: 'Split across 5 workers',
              steps: members.map((m, idx) => ({
                stepId: `s${idx + 1}`,
                botId: m.id,
                task: `Subtask ${idx + 1}`,
                dependsOn: idx === 4 ? ['s1'] : [],
              })),
            }),
          };
        }
        if (botId === coord.id && prompt.includes('Coordinator Phase 2 Summary')) {
          return { ok: true, reply: 'All 5 worker tasks completed and summarized.' };
        }
        inFlight += 1;
        peakConcurrency = Math.max(peakConcurrency, inFlight);
        await new Promise((r) => setTimeout(r, 25));
        inFlight -= 1;
        return { ok: true, reply: `Done by ${botId}` };
      },
    };

    const groupsService = createGroupsService({
      botsStore: dbHandle.bots,
      groupsStore,
      sessionRuntime,
      eventBus,
    });

    const grp = groupsService.create({
      name: 'Fleet Room',
      botIds: [coord.id, ...members.map((m) => m.id)],
      replyMode: { kind: 'coordinator', coordinatorBotId: coord.id },
    });
    assert.deepEqual(grp.replyMode, { kind: 'coordinator', coordinatorBotId: coord.id });
    assert.equal(grp.memberSessionIds.__replyModeCoordinatorBotId__, undefined);

    // Phase 1: send message with image attachment -> stops at awaiting_approval without running workers
    const p1 = await groupsService.send({
      groupId: grp.id,
      text: 'Audit release checklist',
      images: [{ path: '/tmp/screenshot.png', name: 'screenshot.png', mimeType: 'image/png' }],
      waitForReplies: true,
    });
    assert.equal(p1.message.planGate.status, 'awaiting_approval');
    assert.equal(p1.message.planGate.steps.length, 5);
    assert.equal(p1.message.images.length, 1);
    assert.equal(turnLog.length, 1);
    assert.equal(turnLog[0].botId, coord.id);
    assert.equal(turnLog[0].images.length, 1);
    assert.equal(turnLog[0].images[0].path, '/tmp/screenshot.png');

    // Phase 2: approveGroupPlan runs all 5 workers with concurrency <= 3, then coordinator summary
    const p2 = await groupsService.approveGroupPlan(grp.id, p1.message.id);
    assert.equal(p2.planGate.status, 'completed');
    assert.equal(p2.results.length, 5);
    assert.ok(peakConcurrency >= 2 && peakConcurrency <= 3, `Expected concurrency <= 3, got ${peakConcurrency}`);
    assert.match(p2.summary, /summarized/);
    // Every member step also received the image attachment passthrough
    const workerTurns = turnLog.filter((t) => t.botId !== coord.id);
    assert.equal(workerTurns.length, 5);
    assert.ok(workerTurns.every((t) => Array.isArray(t.images) && t.images[0].name === 'screenshot.png'));

    // Depth > 6 rejected
    assert.throws(
      () => validatePlanSteps({
        coordinatorBotId: coord.id,
        memberBotIds: grp.botIds,
        steps: [{ stepId: 'deep', botId: 'b-w1', task: 'Too deep', depth: 7 }],
      }),
      (err) => err.code === 'depth_exceeded',
    );

    // 7-hop dependency chain rejected as depth_exceeded
    assert.throws(
      () => validatePlanSteps({
        coordinatorBotId: coord.id,
        memberBotIds: grp.botIds,
        steps: [
          { stepId: 'c1', botId: 'b-w1', task: 't1', depth: 1 },
          { stepId: 'c2', botId: 'b-w2', task: 't2', dependsOn: ['c1'] },
          { stepId: 'c3', botId: 'b-w3', task: 't3', dependsOn: ['c2'] },
          { stepId: 'c4', botId: 'b-w4', task: 't4', dependsOn: ['c3'] },
          { stepId: 'c5', botId: 'b-w5', task: 't5', dependsOn: ['c4'] },
          { stepId: 'c6', botId: 'b-w1', task: 't6', dependsOn: ['c5'] },
          { stepId: 'c7', botId: 'b-w2', task: 't7', dependsOn: ['c6'] },
        ],
      }),
      (err) => err.code === 'depth_exceeded',
    );

    // Bot delegation cycle (b-w1 -> b-w2 -> b-w1) rejected as loop_detected
    assert.throws(
      () => validatePlanSteps({
        coordinatorBotId: coord.id,
        memberBotIds: grp.botIds,
        steps: [
          { stepId: 'l1', fromBotId: 'b-w1', botId: 'b-w2', task: 'hop 1' },
          { stepId: 'l2', fromBotId: 'b-w2', botId: 'b-w1', task: 'hop 2' },
        ],
      }),
      (err) => err.code === 'loop_detected',
    );

    // Step dependency cycle (s1 <-> s2) rejected as loop_detected
    assert.throws(
      () => validatePlanSteps({
        coordinatorBotId: coord.id,
        memberBotIds: grp.botIds,
        steps: [
          { stepId: 's1', botId: 'b-w1', task: 'a', dependsOn: ['s2'] },
          { stepId: 's2', botId: 'b-w2', task: 'b', dependsOn: ['s1'] },
        ],
      }),
      (err) => err.code === 'loop_detected',
    );
  });
});

test('event-bus tracks active desktop SSE clients and foreground state for external push suppression', async () => {
  const {
    createBotsEventBus,
    hasActiveDesktopClient,
    shouldSuppressExternalPush,
  } = await importBots('event-bus.js');

  const bus = createBotsEventBus();
  try {
    assert.equal(bus.hasActiveDesktopClient(), false);
    assert.equal(bus.shouldSuppressExternalPush(), false);
    assert.equal(hasActiveDesktopClient(bus), false);
    assert.equal(shouldSuppressExternalPush(bus), false);

    // Mobile-only SSE stream does NOT count as active desktop client
    const mobile = makeFakeSsePair('/dsh-bots/events?client=mobile');
    bus.handleStream(mobile.req, mobile.res);
    assert.equal(bus.clientCount(), 1);
    assert.equal(bus.hasActiveDesktopClient(), false);
    assert.equal(bus.shouldSuppressExternalPush(), false);

    // Desktop SSE stream activates foreground suppression
    const desktop = makeFakeSsePair('/dsh-bots/events?client=desktop');
    bus.handleStream(desktop.req, desktop.res);
    assert.equal(bus.clientCount(), 2);
    assert.equal(bus.hasActiveDesktopClient(), true);
    assert.equal(bus.shouldSuppressExternalPush(), true);
    assert.equal(hasActiveDesktopClient(), true);
    assert.equal(shouldSuppressExternalPush(), true);

    // Critical or forced external pushes bypass suppression
    assert.equal(bus.shouldSuppressExternalPush({ forceExternal: true }), false);
    assert.equal(bus.shouldSuppressExternalPush({ urgency: 'critical' }), false);

    // Blurring desktop window disables suppression while keeping client connected
    bus.setDesktopForeground(false);
    assert.equal(bus.hasActiveDesktopClient(), true);
    assert.equal(bus.shouldSuppressExternalPush(), false);

    bus.setDesktopForeground(true);
    assert.equal(bus.shouldSuppressExternalPush(), true);

    // Closing desktop SSE stream clears active desktop state
    desktop.res.end();
    assert.equal(bus.hasActiveDesktopClient(), false);
    assert.equal(bus.shouldSuppressExternalPush(), false);
    assert.equal(bus.clientCount(), 1);
  } finally {
    bus.close();
  }
  assert.equal(hasActiveDesktopClient(), false);
  assert.equal(shouldSuppressExternalPush(), false);
});
