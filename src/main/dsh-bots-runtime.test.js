'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
require('../../scripts/lib/harness-peer-hook.cjs');

const BOTS_LIB_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/lib/bots');
const WHALE_IM_SESSION = path.resolve(__dirname, '../../vendor/dsh-im/src/channels/shared/whale-session.mjs');

function importBots(filename) {
  return import(pathToFileURL(path.join(BOTS_LIB_DIR, filename)).href);
}

async function withTempDir(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `whale-bots-rt-${prefix}-`));
  const closers = [];
  const onClose = (cb) => closers.push(cb);
  try {
    return await fn({ root, onClose });
  } finally {
    for (let i = closers.length - 1; i >= 0; i -= 1) {
      try { await closers[i](); } catch { /* Best-effort teardown. */ }
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, `Temp root leaked: ${root}`);
  }
}

function makeSyntheticPng(width, height) {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function createMockHarness(replyBuilder = (sid, text) => `Reply(${sid}): ${text.slice(0, 40)}`) {
  const sessions = new Map();
  const prompted = [];
  const listeners = new Map();
  const controller = {
    async list(_req, signal) {
      signal.throwIfAborted();
      return [...sessions.values()];
    },
    async create(spec, signal) {
      signal.throwIfAborted();
      const row = { sessionId: spec.sessionId, id: spec.sessionId, cwd: spec.cwd, agentPreset: spec.agentPreset, presentation: spec.presentation };
      sessions.set(spec.sessionId, row);
      return row;
    },
    async setPresentation({ sessionId, presentation }, signal) {
      signal.throwIfAborted();
      const row = sessions.get(sessionId);
      if (row) row.presentation = presentation;
    },
    async selectModel(spec, signal) {
      signal.throwIfAborted();
      return { selected: spec };
    },
    async prompt(spec, signal) {
      signal.throwIfAborted();
      prompted.push(spec);
      return { ok: true };
    },
    async runTurnForTest(sessionId, promptText) {
      prompted.push({ sessionId, text: promptText });
      return { ok: true, reply: replyBuilder(sessionId, promptText) };
    },
    async modelCatalog() {
      return {
        default: { provider: 'deepseek', model: 'deepseek-chat' },
        groups: [{
          id: 'deepseek',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }],
        }],
      };
    },
  };
  const ctx = {
    on(event, fn) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return () => set.delete(fn);
    },
    emit(event, ...args) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    systemPrompt: {
      sections: [],
      section(def) { this.sections.push(def); },
    },
    get(key) {
      if (key === 'sessionController') return controller;
      return undefined;
    },
  };
  return { ctx, controller, sessions, prompted };
}

function startHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => { void handler(req, res); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function rpcPost(baseUrl, method, params = {}, headers = {}) {
  const res = await fetch(`${baseUrl}/dsh-bots/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ method, params }),
  });
  return { status: res.status, body: await res.json() };
}

test('HTTP RPC, SSE events, mascot assets whitelist, auth rejection, and botsEnabled gate', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { createBotsHttpHandler } = await importBots('rpc-router.js');

  await withTempDir('http', async ({ root, onClose }) => {
    const mock = createMockHarness();
    const runtime = createBotsRuntime({ ctx: mock.ctx, dshHome: root, enableSchedulers: false, getController: () => mock.controller });
    onClose(() => runtime.close());

    let rejectCode;
    const httpRouter = createBotsHttpHandler(runtime, { requestRejection: () => rejectCode });
    const srv = await startHttpServer(httpRouter.handler);
    onClose(() => srv.close());

    // 1. Whitelisted mascot assets serve with correct headers; traversal blocked
    const svgRes = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/M1.svg`);
    assert.equal(svgRes.status, 200);
    assert.match(svgRes.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(svgRes.headers.get('cache-control'), /immutable/);
    assert.match(await svgRes.text(), /<svg/);

    const webpRes = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/M1-rim.webp`);
    assert.equal(webpRes.status, 200);
    assert.equal(webpRes.headers.get('content-type'), 'image/webp');

    const badRes = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/..%2F..%2Fpackage.json`);
    assert.equal(badRes.status, 404);
    const badNameRes = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/secret.txt`);
    assert.equal(badNameRes.status, 404);

    // 1b. W1-W8 Whale mascot assets (.svg/.webp/-rim.webp) serve cleanly over the mascot route whitelist
    for (const id of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']) {
      const wSvg = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/${id}.svg`);
      assert.equal(wSvg.status, 200, `${id}.svg must return 200`);
      assert.match(wSvg.headers.get('content-type'), /image\/svg\+xml/);
      const wWebp = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/${id}.webp`);
      assert.equal(wWebp.status, 200, `${id}.webp must return 200`);
      assert.equal(wWebp.headers.get('content-type'), 'image/webp');
      const wRim = await fetch(`${srv.baseUrl}/dsh-bots/assets/mascots/${id}-rim.webp`);
      assert.equal(wRim.status, 200, `${id}-rim.webp must return 200`);
      assert.equal(wRim.headers.get('content-type'), 'image/webp');
    }

    // 2. Auth rejection blocks RPC and SSE
    rejectCode = 401;
    const unauthRpc = await fetch(`${srv.baseUrl}/dsh-bots/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'bots.list' }),
    });
    assert.equal(unauthRpc.status, 401);
    const unauthSse = await fetch(`${srv.baseUrl}/dsh-bots/events`);
    assert.equal(unauthSse.status, 401);
    rejectCode = undefined;

    // 3. SSE streams initial `ready` and `bots:changed` after mutation
    const sseEvents = [];
    const ac = new AbortController();
    const ssePromise = fetch(`${srv.baseUrl}/dsh-bots/events`, { signal: ac.signal }).then(async (res) => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        if (buf.includes('event: bots:changed')) {
          sseEvents.push(buf);
          ac.abort();
          break;
        }
      }
    }).catch(() => null);

    await new Promise((r) => setTimeout(r, 40));
    const created = await rpcPost(srv.baseUrl, 'bots.create', { name: 'Alpha' });
    assert.equal(created.body.ok, true);
    runtime.eventBus.flushNow();
    await ssePromise;
    assert.ok(sseEvents.length > 0 && sseEvents[0].includes('event: ready') && sseEvents[0].includes('event: bots:changed'));

    // 4. `botsEnabled: false` rejects mutations with `bots_disabled`, keeps list/settings allowed
    const disabled = await rpcPost(srv.baseUrl, 'bots.settings.update', { botsEnabled: false, sidebarProjectsFirst: true });
    assert.equal(disabled.body.ok, true);
    assert.equal(disabled.body.result.botsEnabled, false);
    assert.equal(disabled.body.result.sidebarProjectsFirst, true);

    const blockedCreate = await rpcPost(srv.baseUrl, 'bots.create', { name: 'Blocked' });
    assert.equal(blockedCreate.body.ok, false);
    assert.equal(blockedCreate.body.error.code, 'bots_disabled');

    const stillList = await rpcPost(srv.baseUrl, 'bots.list');
    assert.equal(stillList.body.ok, true);
    assert.equal(stillList.body.result.bots.length, 1);
  });
});

test('Lifecycle, template provisioning, SOUL optimistic lock, avatar, memory, tidy-up, items, look-around, automations, groups, share/import', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');

  await withTempDir('lifecycle', async ({ root, onClose }) => {
    const mock = createMockHarness((sid, text) => `Handled ${sid}: ${text.slice(0, 30)}`);
    let tidyCalls = 0;
    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome: root,
      userHomeDir: path.join(root, 'fake-user-home'),
      enableSchedulers: false,
      getController: () => mock.controller,
      runLookAroundSweep: async (bot) => {
        runtime.lookAroundService.addSuggestion(bot.id, {
          title: 'Review PR #42',
          why: 'Waiting on reviewer for 2 days',
          ask: 'Please review PR #42 and leave feedback',
          link: 'https://github.com/org/repo/pull/42',
        });
        return { ok: true, summary: '1 suggestion' };
      },
      runTidyUpModel: async () => {
        tidyCalls += 1;
        return [
          'BEGIN MEMORY.md',
          '# Memory',
          '- 2026-11-01 Fact one',
          '- 2026-11-02 Fact two',
          '- 2026-11-03 Fact three',
          '- 2026-11-04 Fact four',
          'END MEMORY.md',
          'BEGIN memory/ops.md',
          '# Ops',
          '- 2026-11-05 Fact five',
          'END memory/ops.md',
          'BEGIN REPLACED',
          '- 2026-11-05 Fact five',
          'END REPLACED',
        ].join('\n');
      },
    });
    onClose(() => runtime.close());
    const call = (method, params) => runtime.http.invokeRpc(method, params);

    // 1. Create from built-in template -> writes skills, shared-setup.md, paused schedules, opens Home Chat, sends kickoff
    const tplRes = await call('bots.create', { name: 'PR Reviewer', fromTemplate: { templateId: 'pr-review' } });
    const bot1 = tplRes.bot;
    assert.ok(bot1.id);
    assert.ok(fs.existsSync(path.join(bot1.homePath, 'shared-setup.md')));
    assert.ok(fs.existsSync(path.join(bot1.homePath, 'skills', 'pr-review-checklist', 'SKILL.md')));
    assert.ok(mock.sessions.has(tplRes.sessionId));
    assert.equal(mock.sessions.get(tplRes.sessionId).presentation.owner, 'dsh-bots:home');

    // 2. SOUL optimistic lock (`changed-on-disk`)
    const soul0 = await call('bots.soul.read', { botId: bot1.id });
    const soul1 = await call('bots.soul.write', { botId: bot1.id, content: '# PR Reviewer\n\nReviews PRs carefully.\n', expectedSignature: soul0.signature });
    assert.equal(soul1.description, 'Reviews PRs carefully.');
    await assert.rejects(
      () => call('bots.soul.write', { botId: bot1.id, content: '# Stale', expectedSignature: soul0.signature }),
      (err) => err.code === 'changed-on-disk' && err.data?.diskSignature === soul1.signature,
    );

    // 3. Avatar upload + read
    const pngBase64 = makeSyntheticPng(512, 512).toString('base64');
    const up = await call('bots.avatar.upload', { botId: bot1.id, base64Png: `data:image/png;base64,${pngBase64}` });
    assert.match(up.avatar, /^upload:[0-9a-f]{16}$/);
    const rd = await call('bots.avatar.read', { botId: bot1.id });
    assert.match(rd.dataUrl, /^data:image\/png;base64,/);

    // 4. Memory CRUD + Tidy-up + Undo
    for (const label of ['Fact one', 'Fact two', 'Fact three', 'Fact four', 'Fact five']) {
      await call('bots.memory.add', { botId: bot1.id, text: label, date: '2026-11-01' });
    }
    const memList = await call('bots.memory.list', { botId: bot1.id });
    assert.equal(memList.facts.length, 5);
    const tidy = await call('bots.tidyUp.now', { botId: bot1.id });
    assert.equal(tidy.ok, true);
    assert.equal(tidyCalls, 1);
    assert.deepEqual(tidy.topicsWritten, ['ops']);
    const tidyStatus = await call('bots.tidyUp.get', { botId: bot1.id });
    assert.equal(tidyStatus.lastStatus, 'ok');
    const undone = await call('bots.tidyUp.undo', { botId: bot1.id });
    assert.equal(undone.ok, true);

    // 5. Work Items owner RPC flow
    const addedItem = await call('bots.items.add', {
      ownerBotId: bot1.id,
      chatId: tplRes.sessionId,
      source: { kind: 'home', title: null },
      title: 'Approve hotfix',
      status: 'needs_you',
      comment: 'Ship now?',
      actor: { kind: 'bot', botId: bot1.id, chatId: tplRes.sessionId },
    });
    const ownerList = await call('bots.items.owner.list', { botId: bot1.id });
    assert.equal(ownerList.items.length, 1);
    const ownerAns = await call('bots.items.owner.comment', {
      uid: addedItem.item.uid,
      text: 'Yes ship it',
      requestId: 'req-owner-1',
    });
    assert.equal(ownerAns.item.status, 'working');

    // 6. Look Around + Up Next
    const sweep = await call('bots.lookAround.lookNow', { botId: bot1.id });
    assert.equal(sweep.ok, true);
    const upNext = await call('bots.upNext.list', { botId: bot1.id });
    assert.equal(upNext.openSuggestions.length, 1);
    const startedSug = await call('bots.suggestions.start', { botId: bot1.id, suggestionId: upNext.openSuggestions[0].id });
    assert.equal(startedSug.ok, true);

    // 7. Automations + sendRunAgain idempotency
    const auto = await call('bots.automations.create', {
      botId: bot1.id,
      name: 'Morning check',
      prompt: 'Check build status',
      intervalMinutes: 60,
    });
    const runRes = await call('bots.automations.runNow', { id: auto.id });
    assert.equal(runRes.ok, true);
    const resend1 = await call('bots.sendRunAgain', { runId: 'failed-run-1', automationId: auto.id });
    const resend2 = await call('bots.sendRunAgain', { runId: 'failed-run-1', automationId: auto.id });
    assert.equal(resend1.deduplicated, false);
    assert.equal(resend2.deduplicated, true);

    // 8. Connectors & Access Request auto-grant to bot.members
    const accReq = runtime.workStore.createAccessRequest({
      botId: bot1.id, source: 'feishu', requesterId: 'ou_123', requesterName: 'Alice',
    });
    await call('bots.access.decide', { id: accReq.id, decision: 'granted' });
    assert.ok(runtime.botsStore.getBot(bot1.id).members.some((m) => m.id === 'ou_123'));

    // 9. Multi-Bot Group Chat send + reply + thread + stop
    const bot2Res = await call('bots.create', { name: 'Release Captain', skipKickoff: true });
    const grp = await call('bots.groups.create', { botIds: [bot1.id, bot2Res.bot.id] });
    assert.equal(grp.name, 'PR Reviewer & Release Captain');
    const sent = await call('bots.groups.send', {
      groupId: grp.id,
      text: '@Release Captain summarize status',
      waitForReplies: true,
    });
    assert.deepEqual(sent.targetBotIds, [bot2Res.bot.id]);
    assert.equal(sent.message.turns.length, 1);
    assert.equal(sent.message.turns[0].status, 'done');
    assert.match(sent.message.turns[0].reply, /Handled bot-group-member-/);

    // 10. Share package hard-blocks plaintext secrets (`secret_detected`) + external import scan (fake ~/.orca/bots/)
    await call('bots.soul.write', {
      botId: bot1.id,
      content: '# PR Reviewer\n\nReviews PRs.\nMy key is sk-proj-SECRET1234567890ABCD\n',
    });
    await assert.rejects(
      () => call('bots.share.prepare', { botId: bot1.id }),
      (err) => err.code === 'secret_detected',
    );
    await call('bots.soul.write', {
      botId: bot1.id,
      content: '# PR Reviewer\n\nReviews PRs carefully without plaintext secrets.\n',
    });
    const prepared = await call('bots.share.prepare', { botId: bot1.id });
    assert.equal(prepared.packageJson.includes('sk-proj-SECRET1234567890ABCD'), false);
    const reviewed = await call('bots.share.review', { packageJson: prepared.packageJson });
    assert.equal(reviewed.ok, true);

    const fakeOrcaBot = path.join(root, 'fake-user-home', '.orca', 'bots', 'leader');
    fs.mkdirSync(fakeOrcaBot, { recursive: true });
    fs.writeFileSync(path.join(fakeOrcaBot, 'bot.json'), JSON.stringify({ id: 'orca-1', name: 'Leader' }), 'utf8');
    fs.writeFileSync(path.join(fakeOrcaBot, 'SOUL.md'), '# Leader\n\nCoordinates engineering.\n', 'utf8');
    const sources = await call('bots.import.sources');
    const orcaSrc = sources.find((s) => s.sourceKind === 'orca' && s.name === 'Leader');
    assert.ok(orcaSrc);
    const imported = await call('bots.import.execute', { sourceId: orcaSrc.id });
    assert.equal(imported.ok, true);
    assert.equal(imported.bot.name, 'Leader');

    // 11. Delete bot preserves Home folder by default
    const delRes = await call('bots.delete', { botId: imported.bot.id });
    assert.equal(delRes.deleted, true);
    assert.equal(delRes.folderPreserved, true);
    assert.equal(fs.existsSync(delRes.folderPath), true);
  });
});

test('Prompt hooks, tamper restore, all 25 native tools, Harness-governed auto-run & fail-closed cross-boundary confirms, plus legacy pet/dsh-im compat', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { installBotPromptAndTurnHooks } = await importBots('prompt-engine.js');
  const { buildBotToolDefinitions } = await importBots('bot-tools-registry.js');
  const { currentWhaleSessionResolution } = await import(pathToFileURL(WHALE_IM_SESSION).href);

  await withTempDir('tools-compat', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    const mock = createMockHarness();
    const runtime = createBotsRuntime({ ctx: mock.ctx, dshHome, enableSchedulers: false, getController: () => mock.controller });
    onClose(() => runtime.close());

    const disposeHooks = installBotPromptAndTurnHooks(mock.ctx, runtime);
    onClose(() => disposeHooks());

    const created = await runtime.botsService.createBot({ name: '鲸鱼娘', imDefault: true, skipKickoff: true });
    const bot = created.bot;
    const sid = created.sessionId;
    await runtime.botsService.memoryAdd(bot.id, { text: 'Owner hates long walls of text', date: '2026-11-01' });

    // 1. Prompt assembly includes WhaleIsle identity, SOUL.md, and fenced MEMORY.md
    assert.match(bot.avatar, /^mascot:W[1-8]$/);
    const assembleCtx = { agent: { id: sid, session: { id: sid, header: { cwd: bot.homePath } } } };
    const renderedPrompts = mock.ctx.systemPrompt.sections.map((s) => s.text(assembleCtx)).join('\n');
    assert.match(renderedPrompts, /You are 鲸鱼娘/);
    assert.match(renderedPrompts, /WhaleIsle/);
    assert.equal(renderedPrompts.includes('Orca'), false);
    assert.match(renderedPrompts, /Owner hates long walls of text/);

    // 2. Turn-end hook restores unauthorized deletion and clears firstRun after real owner turn
    mock.ctx.emit('session/event', { id: sid }, { type: 'turn/start', data: {} });
    mock.ctx.emit('session/event', { id: sid }, { type: 'user/message', data: { content: [{ type: 'text', text: 'Hi there' }] } });
    // Agent deletes fact directly on disk without calling `bot_memory_forget`
    fs.writeFileSync(path.join(bot.homePath, 'MEMORY.md'), '# Memory\n\n', 'utf8');
    mock.ctx.emit('session/event', { id: sid }, { type: 'assistant/message', data: { content: [{ type: 'text', text: 'Hello!' }] } });
    mock.ctx.emit('session/event', { id: sid }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    assert.match(fs.readFileSync(path.join(bot.homePath, 'MEMORY.md'), 'utf8'), /Owner hates long walls of text/);
    assert.equal(runtime.botsStore.getBot(bot.id).firstRun, false);

    // 3. All 25 native tools registered; cross-boundary tools fail closed on decline,
    // while Harness-governed/local bot tools run directly without desktop confirm popups.
    const confirmCalls = [];
    let allowConfirm = false;
    const defs = buildBotToolDefinitions(() => runtime, {
      confirmAction: async (req) => {
        confirmCalls.push({ tool: req.tool, action: req.action, effect: req.effect });
        return allowConfirm ? { ok: true } : { ok: false };
      },
    });
    assert.equal(defs.length, 25);
    const byName = new Map(defs.map((d) => [d.name, d]));
    const execCtx = { agent: { id: sid, session: { id: sid } } };
    const nonOwnerImCtx = {
      agent: {
        id: sid,
        session: {
          id: sid,
          snapshotEvents: () => [
            { seq: 1, type: 'turn/start', data: {} },
            { seq: 2, type: 'user/message', data: { source: { kind: 'dsh-im:inbound', rpcId: 'feishu-guest-private-123' } } },
          ],
        },
      },
    };

    // Read-only bot_tools_manage list works without confirmation
    const listToolsRes = await byName.get('bot_tools_manage').execute({ action: 'list' }, execCtx);
    assert.equal(listToolsRes.ok, true);
    assert.equal(confirmCalls.length, 0);

    // Cross-boundary & worker tools require desktop confirm and fail closed when declined
    const desktopGuardedCalls = [
      ['bot_tools_manage', { action: 'add', server: { name: 'mcp1', url: 'https://example.com' } }, 'add', 'code'],
      ['bot_reply', { text: 'External reply' }, 'reply', 'external'],
      ['bot_work_start', { cwd: root, prompt: 'Run tests' }, 'start', 'code'],
    ];
    for (const [name, args, expAction, expEffect] of desktopGuardedCalls) {
      const res = await byName.get(name).execute(args, execCtx);
      assert.equal(res.ok, false, `${name} must fail closed when declined`);
      const last = confirmCalls.at(-1);
      assert.deepEqual(last, { tool: name, action: expAction, effect: expEffect });
    }
    assert.equal((await runtime.botsService.toolsList(bot.id)).servers.length, 0);
    assert.equal(runtime.workStore.listWork({ botId: bot.id }).length, 0);

    // Non-owner IM turn stays blocked for Harness-governed/local bot tools without desktop prompts
    const secondBot = await runtime.botsService.createBot({ name: 'Helper', skipKickoff: true });
    const harnessGovernedCalls = [
      ['bot_send', { toBotId: secondBot.bot.id, purpose: 'question', text: 'Status?' }],
      ['bot_automation_create', { action: 'create', name: 'Job', prompt: 'Check' }],
      ['bot_new_chat', { title: 'Side topic' }],
    ];
    const confirmCountBefore = confirmCalls.length;
    for (const [name, args] of [...harnessGovernedCalls, ['bot_work_start', { cwd: root, prompt: 'Run tests' }], ['bot_tools_manage', { action: 'list' }]]) {
      const blockedRes = await byName.get(name).execute(args, nonOwnerImCtx);
      assert.equal(blockedRes.ok, false, `${name} must refuse non-owner IM turns`);
      assert.match(blockedRes.detail, /非主人 IM/);
    }
    assert.equal(confirmCalls.length, confirmCountBefore);
    assert.equal(runtime.workStore.listWork({ botId: bot.id }).length, 0);
    assert.equal(runtime.automationsService.list({ botId: bot.id }).length, 0);

    // Owner turns run Harness-governed/local bot tools directly with 0 desktop confirm popups
    for (const [name, args] of harnessGovernedCalls) {
      const okRes = await byName.get(name).execute(args, execCtx);
      assert.equal(okRes.ok, true, `${name} must run without desktop confirmation in owner turns`);
    }
    assert.equal(confirmCalls.length, confirmCountBefore);
    assert.equal(runtime.automationsService.list({ botId: bot.id }).length, 1);

    // When desktop confirm approves, cross-boundary & worker tools execute cleanly
    allowConfirm = true;
    const workOk = await byName.get('bot_work_start').execute({ cwd: root, prompt: 'Run tests' }, execCtx);
    assert.equal(workOk.ok, true);
    assert.equal(runtime.workStore.listWork({ botId: bot.id }).length, 1);
    const replyOk = await byName.get('bot_reply').execute({ text: 'External reply' }, execCtx);
    assert.equal(replyOk.ok, true);
    const toolAddOk = await byName.get('bot_tools_manage').execute({ action: 'add', server: { name: 'mcp1', url: 'https://example.com' } }, execCtx);
    assert.equal(toolAddOk.ok, true);
    assert.equal((await runtime.botsService.toolsList(bot.id)).servers.length, 1);

    // 4. Legacy pet + dsh-im `whale-session.mjs` zero-change compatibility
    const ensured = await runtime.legacyCompat.ensurePetSession();
    assert.equal(ensured.ok, true);
    assert.equal(ensured.sessionId, sid);
    await runtime.legacyCompat.updateLegacySettings({ imDefault: true, name: '大肥鱼助理' });

    const imResolved = currentWhaleSessionResolution(null, { home: dshHome });
    assert.equal(imResolved.sessionId, sid);
  });
});

test('Phase 3 fixes: legacy model selectModel contract, kickoff state progression, and lazy bots.db open', async () => {
  const { createBotsRuntime, mountBotsIntoHost } = await importBots('runtime.js');
  const { botsDbPath } = await importBots('db.js');

  await withTempDir('phase3-fixes', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });

    // 1. Lazy DB opening: mountBotsIntoHost does NOT create or lock bots.db until accessed
    const lazyHome = path.join(root, 'lazy-home');
    fs.mkdirSync(path.join(lazyHome, 'data', 'whale'), { recursive: true });
    fs.writeFileSync(
      path.join(lazyHome, 'data', 'whale', 'settings.json'),
      JSON.stringify({ name: '老鲸鱼', sessionId: 'legacy-sess-1', imDefault: true }),
      'utf8',
    );
    const lazyMock = createMockHarness();
    let registeredBotsRoute = null;
    lazyMock.ctx.effect = (fn) => fn();
    lazyMock.ctx.webServer = { register: (r) => { registeredBotsRoute = r; return () => {}; } };
    lazyMock.ctx.connection = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
    const handle = mountBotsIntoHost(lazyMock.ctx, { home: lazyHome });
    assert.equal(handle.instance, null);
    assert.equal(fs.existsSync(botsDbPath(lazyHome)), false);

    // First `/dsh-bots/rpc` call lazily opens bots.db and runs legacy migration automatically
    const srv = await startHttpServer(registeredBotsRoute.handler);
    onClose(() => srv.close());
    onClose(() => handle.close());
    const listRes = await rpcPost(srv.baseUrl, 'bots.list');
    assert.equal(listRes.body.ok, true);
    assert.equal(fs.existsSync(botsDbPath(lazyHome)), true);
    assert.equal(listRes.body.result.bots.length, 1);
    assert.equal(listRes.body.result.bots[0].name, '老鲸鱼');

    // 2. Legacy model selectModel contract + rejection rollback + empty-model default fallback
    const selectCalls = [];
    const mock = createMockHarness();
    mock.controller.selectModel = async (req, signal) => {
      signal.throwIfAborted();
      selectCalls.push(req);
      if (req.model === 'invalid') throw new Error('model unavailable');
      return { selected: req };
    };
    mock.controller.modelCatalog = async () => ({
      default: { provider: 'global', model: 'default' },
      groups: [],
    });

    // Fresh empty DSH_HOME produces 0 bots (no phantom migration from blank shell)
    const { hasPreExistingLegacyWhaleData } = await importBots('legacy-migration.js');
    const freshHome = path.join(root, 'fresh-empty-home');
    fs.mkdirSync(path.join(freshHome, 'data', 'whale'), { recursive: true });
    fs.writeFileSync(
      path.join(freshHome, 'data', 'whale', 'settings.json'),
      JSON.stringify({ name: '鲸鱼娘', personality: 'natural', sessionId: '', personaText: '', modelModel: '' }),
      'utf8',
    );
    assert.equal(hasPreExistingLegacyWhaleData(freshHome), false);
    const freshRuntime = createBotsRuntime({ ctx: mock.ctx, dshHome: freshHome, enableSchedulers: false, getController: () => mock.controller });
    onClose(() => freshRuntime.close());
    assert.equal(freshRuntime.botsStore.listBots().length, 0);
    assert.equal(freshRuntime.migration.migrated, false);

    const runtime = createBotsRuntime({ ctx: mock.ctx, dshHome, enableSchedulers: false, getController: () => mock.controller });
    onClose(() => runtime.close());
    const created = await runtime.botsService.createBot({ name: 'KickoffBot' });
    const botId = created.bot.id;
    const homeSid = created.sessionId;
    await runtime.sessionRuntime.takeOverWorkspace(botId, { cwd: root });

    // 3. Kickoff state is exposed as `running` during first turn and transitions to `ready` on turn/end
    await new Promise((r) => setTimeout(r, 20));
    const beforeEnd = (await runtime.botsService.listBotsView()).bots.find((b) => b.id === botId);
    assert.equal(beforeEnd.kickoff.status, 'running');
    assert.equal(beforeEnd.kickoff.step, 'first-message');
    mock.ctx.emit('session/event', { id: homeSid }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    const afterEnd = (await runtime.botsService.listBotsView()).bots.find((b) => b.id === botId);
    assert.equal(afterEnd.kickoff.status, 'ready');
    assert.equal(afterEnd.kickoff.step, 'done');

    // Legacy model edits pass clean `model: 'new'` (never 'p/new'), reject invalid without saving, and fall back to default
    selectCalls.length = 0;
    await runtime.legacyCompat.updateLegacySettings({ model: { provider: 'p', model: 'new', reasoningEffort: 'high' } });
    assert.deepEqual(selectCalls[0], {
      sessionId: homeSid,
      provider: 'p',
      model: 'new',
      reasoningEffort: 'high',
      saveAsDefault: false,
    });
    await assert.rejects(
      () => runtime.legacyCompat.updateLegacySettings({ model: { provider: 'p', model: 'invalid' } }),
      /model unavailable/,
    );
    assert.equal(runtime.legacyCompat.getLegacySettings().modelModel, 'new');
    const projectedAfterReject = JSON.parse(fs.readFileSync(path.join(dshHome, 'data', 'whale', 'settings.json'), 'utf8'));
    assert.equal(projectedAfterReject.modelModel, 'new');

    await runtime.legacyCompat.updateLegacySettings({ model: { provider: '', model: '' } });
    assert.equal(selectCalls.at(-1).provider, 'global');
    assert.equal(selectCalls.at(-1).model, 'default');
    const projectedAfterClear = JSON.parse(fs.readFileSync(path.join(dshHome, 'data', 'whale', 'settings.json'), 'utf8'));
    assert.equal(projectedAfterClear.modelModel, '');
  });
});

test('Wave 3 E2E: signed webhooks, prompt inspect/diff, budget fuse, crew, decisions, MCP problems, FTS5 memory, group approvePlan, 9-channel routes, owedMail wake & bridges', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { createBotsHttpHandler } = await importBots('rpc-router.js');
  const { installBotPromptAndTurnHooks } = await importBots('prompt-engine.js');
  const { signWebhookPayload } = await importBots('connectors-service.js');

  await withTempDir('wave3-e2e', async ({ root, onClose }) => {
    const woke = [];
    const mock = createMockHarness((sid, text) => {
      if (text.includes('Phase 1') || text.includes('plan')) {
        return JSON.stringify({ plan: [{ botId: 'member-placeholder', task: 'check logs' }] });
      }
      return `Done(${sid})`;
    });
    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome: root,
      enableSchedulers: false,
      getController: () => mock.controller,
      wakeBot: async (payload) => { woke.push(payload); return { ok: true }; },
    });
    onClose(() => runtime.close());
    const disposeHooks = installBotPromptAndTurnHooks(mock.ctx, runtime);
    onClose(() => disposeHooks());

    let rejectCode;
    const httpRouter = createBotsHttpHandler(runtime, { requestRejection: () => rejectCode });
    const srv = await startHttpServer(httpRouter.handler);
    onClose(() => srv.close());
    const call = (method, params) => runtime.http.invokeRpc(method, params);

    const b1 = (await call('bots.create', { name: 'Captain', skipKickoff: true })).bot;
    const b2 = (await call('bots.create', { name: 'Scout', skipKickoff: true })).bot;

    // 1. Signed inbound webhook pre-auth: 401 on bad signature, 200 fresh + automation trigger, 200 idempotent replay
    const hook = await call('bots.connectors.webhooks.create', { botId: b1.id, name: 'CI Hook' });
    const whAuto = await call('bots.automations.create', {
      botId: b1.id, name: 'On CI', prompt: 'Inspect CI payload', triggers: [{ kind: 'webhook', webhookId: hook.webhook.id }],
    });
    const rawPayload = JSON.stringify({ build: 99 });
    const ts = String(Math.floor(Date.now() / 1000));
    rejectCode = 401;
    const badWh = await fetch(`${srv.baseUrl}/dsh-bots/webhooks/${hook.webhook.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whale-timestamp': ts, 'x-whale-signature': 'sha256=deadbeef', 'x-whale-event-id': 'evt-1' },
      body: rawPayload,
    });
    assert.equal(badWh.status, 401);
    const sig = `sha256=${signWebhookPayload({ secret: hook.secret, timestamp: ts, rawBody: rawPayload })}`;
    const okWh = await fetch(`${srv.baseUrl}/dsh-bots/webhooks/${hook.webhook.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whale-timestamp': ts, 'x-whale-signature': sig, 'x-whale-event-id': 'evt-1' },
      body: rawPayload,
    });
    assert.equal(okWh.status, 200);
    const okBody = await okWh.json();
    assert.equal(okBody.duplicate, false);
    assert.equal(okBody.matched, 1);
    const replayWh = await fetch(`${srv.baseUrl}/dsh-bots/webhooks/${hook.webhook.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whale-timestamp': ts, 'x-whale-signature': sig, 'x-whale-event-id': 'evt-1' },
      body: rawPayload,
    });
    assert.equal(replayWh.status, 200);
    assert.equal((await replayWh.json()).duplicate, true);
    rejectCode = undefined;
    assert.ok((await call('bots.automations.claims', { automationId: whAuto.id })).claims.length >= 1);

    // 2. Prompt inspect & diff across 2 turns
    const assembleCtx = { agent: { id: b1.chatSessionId, session: { id: b1.chatSessionId, header: { cwd: b1.homePath } } } };
    for (const [note, toolName] of [['Alpha rule', 'bot_list'], ['Beta rule', 'bot_memory_search']]) {
      await call('bots.memory.add', { botId: b1.id, text: note, date: '2026-11-22' });
      mock.ctx.systemPrompt.sections.forEach((s) => s.text(assembleCtx));
      mock.ctx.emit('session/event', { id: b1.chatSessionId }, { type: 'turn/start', data: {} });
      mock.ctx.emit('session/event', { id: b1.chatSessionId }, { type: 'tool/call', data: { name: toolName } });
      mock.ctx.emit('session/event', { id: b1.chatSessionId }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    }
    const inspected = await call('bots.prompt.inspect', { botId: b1.id });
    assert.ok(inspected.snapshots.length >= 2 && inspected.systemPrompt.includes('Beta rule'));
    const diffed = await call('bots.prompt.diff', { botId: b1.id, fromIdx: 0, toIdx: 1 });
    assert.equal(diffed.changed, true);
    assert.ok(diffed.addedTools.includes('bot_memory_search'));

    // 3. Crew adoption, Decisions TSV, Per-Bot MCP problems, FTS5 search & team memory
    const adopted = await call('bots.crew.adopt', { botId: b1.id, sessionId: 'plain-sess-1', title: 'Fix CI' });
    assert.equal(adopted.ok, true);
    assert.equal((await call('bots.crew.list', { botId: b1.id })).adoptions.length, 1);
    assert.equal((await call('bots.crew.release', { sessionId: 'plain-sess-1' })).ok, true);

    await call('bots.decisions.append', { botId: b1.id, itemUid: 'item-1', actor: 'captain', phase: 'verify', decision: 'approved', evidence: 'ok' });
    assert.equal((await call('bots.decisions.read', { botId: b1.id, itemUid: 'item-1' })).rows.length, 1);

    fs.mkdirSync(path.join(b1.homePath, '.whale'), { recursive: true });
    fs.writeFileSync(path.join(b1.homePath, '.whale', 'bot-tools.json'), JSON.stringify({
      servers: [{ name: 'bad-mcp', url: 'ftp://invalid', headers: { Authorization: 'Bearer tok-leak' } }],
    }), 'utf8');
    const probs = await call('bots.tools.problems', { botId: b1.id });
    assert.ok(probs.problems.some((p) => p.code === 'inline_credentials_detected'));
    assert.ok(probs.problems.some((p) => p.code === 'invalid_url'));

    await call('bots.memory.teamWrite', { groupId: 'grp-team', content: '- 2026-11-22 Deploy window is Friday\n' });
    assert.match((await call('bots.memory.teamRead', { groupId: 'grp-team' })).content, /Deploy window/);
    const memHits = await call('bots.memory.search', { botId: b1.id, query: 'Beta' });
    assert.ok(memHits.hits.some((h) => h.body.includes('Beta rule')));

    // 4. 9-channel connectors.setRoute, webhooks list/delete, Group approvePlan + images + mobile alias
    await call('bots.connectors.setRoute', { channel: 'telegram', botId: b1.id });
    assert.equal((await call('bots.connectors.routes')).routes.telegram.botId, b1.id);
    assert.equal((await call('bots.connectors.list', { botId: b1.id })).imChannels.length, 9);
    assert.equal((await call('bots.connectors.webhooks.list', { botId: b1.id })).webhooks.length, 1);
    assert.equal((await call('bots.connectors.webhooks.delete', { botId: b1.id, webhookId: hook.webhook.id })).deleted, true);

    const grp = await call('bots.groups.create', {
      botIds: [b1.id, b2.id], replyMode: { kind: 'coordinator', coordinatorBotId: b1.id },
    });
    const planMsg = await call('bots.groups.send', {
      groupId: grp.id, text: 'Run release plan', images: [{ name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }], waitForReplies: true,
    });
    assert.equal(planMsg.message.planGate.status, 'awaiting_approval');
    const approved = await call('bots.groups.approvePlan', {
      groupId: grp.id, messageId: planMsg.message.id, steps: [{ botId: b2.id, task: 'Verify release' }],
    });
    assert.equal(approved.message.planGate.status, 'completed');
    assert.ok((await call('bots.groups.messages', { groupId: grp.id })).messages.length >= 1);

    // 5. ownerComment (mobile alias) triggers owedMail wake + safe bridges + Budget fuse
    const item = await call('bots.items.add', {
      ownerBotId: b1.id, chatId: b1.chatSessionId, source: { kind: 'home', title: null }, title: 'Confirm rollout', status: 'needs_you',
      actor: { kind: 'bot', botId: b1.id, chatId: b1.chatSessionId },
    });
    assert.equal((await call('bots.items.detail', { uid: item.item.uid })).item.uid, item.item.uid);
    await call('bots.items.ownerComment', { uid: item.item.uid, text: 'Proceed now', requestId: 'mob-1' });
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(woke.length >= 1);
    assert.equal(runtime.itemsStore.owedMail().length, 0);

    assert.equal((await call('bots.skill.recordDraft', { botId: b1.id })).reason, 'capture_unavailable');
    await assert.rejects(() => call('bots.skill.recordSave', { botId: b1.id, name: 'bad', skillMd: 'token sk-proj-SECRET1234567890ABCD' }), (e) => e.code === 'secret_detected');
    const savedSkill = await call('bots.skill.recordSave', { botId: b1.id, name: 'Export Report', skillMd: '# Export Report\n1. Open report.' });
    assert.equal(savedSkill.path, 'skills/export-report/SKILL.md');
    assert.equal((await call('bots.voice.state')).reason, 'voice_unavailable');
    assert.equal((await call('bots.voice.toggle', { enabled: true })).reason, 'voice_unavailable');
    const offerBot = await call('bots.createOffer', { purpose: 'Monitor logs', fromBotId: b1.id, skipKickoff: true });
    assert.ok(offerBot.bot.id);

    await call('bots.budget.set', { botId: b1.id, dailyLimitUsd: 0.01, pauseOnExceed: true });
    assert.equal((await call('bots.budget.get', { botId: b1.id })).dailyLimitUsd, 0.01);
    runtime.budgetService.recordUsage({ botId: b1.id, costUsd: 0.02, inputTokens: 1000, outputTokens: 200 });
    const usage = await call('bots.budget.usage', { botId: b1.id });
    assert.equal(usage.exceeded, true);
    assert.ok(usage.nextPeakSwitchMs === null || (usage.nextPeakSwitchMs >= 0 && usage.nextPeakSwitchMs <= 7 * 86_400_000));
    assert.equal((await call('bots.automations.runNow', { id: whAuto.id })).reason, 'skipped_budget');
    assert.equal((await call('bots.lookAround.lookNow', { botId: b1.id })).reason, 'budget_exceeded');
  });
});

test('Wave 3 lifecycle: IM bridge lazy symbol resolution and zero lingering timers after close()', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const IM_SYM = Symbol.for('whaleisle.dsh-im.bot-outbound-bridge');

  await withTempDir('wave3-timers', async ({ root, onClose }) => {
    const activeIntervals = new Set();
    const origSetInterval = globalThis.setInterval;
    const origClearInterval = globalThis.clearInterval;
    globalThis.setInterval = (...args) => {
      const h = origSetInterval(...args);
      activeIntervals.add(h);
      return h;
    };
    globalThis.clearInterval = (h) => {
      activeIntervals.delete(h);
      return origClearInterval(h);
    };
    const prevBridge = globalThis[IM_SYM];
    onClose(() => {
      globalThis.setInterval = origSetInterval;
      globalThis.clearInterval = origClearInterval;
      if (prevBridge === undefined) delete globalThis[IM_SYM];
      else globalThis[IM_SYM] = prevBridge;
    });

    delete globalThis[IM_SYM];
    const mock = createMockHarness();
    const runtime = createBotsRuntime({ ctx: mock.ctx, dshHome: root, enableSchedulers: true, getController: () => mock.controller });
    assert.ok(activeIntervals.size >= 3, 'Schedulers must register intervals when enabled');
    assert.equal(runtime.imOutboundBridge.sendText, undefined);

    const delivered = [];
    globalThis[IM_SYM] = { deliverReply: async (p) => { delivered.push(p); return { ok: true, delivered: true }; } };
    const sendRes = await runtime.imOutboundBridge.sendText({ botId: 'b1', channel: 'feishu', chatId: 'oc_1', text: 'hello' });
    assert.equal(sendRes.delivered, true);
    assert.equal(delivered[0].targetId, 'oc_1');

    runtime.close();
    assert.equal(activeIntervals.size, 0, 'close() must clear all scheduler intervals with zero leaks');
  });
});

test('Wave 2 wiring: owedMail delivery & restart recovery, snooze no-mail, item-close monthly journal + 24h backfill', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');

  await withTempDir('wave2-mail-journal', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    let activeController = createMockHarness();
    const runtime1 = createBotsRuntime({
      ctx: activeController.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => activeController?.controller ?? null,
    });
    const call1 = (method, params) => runtime1.http.invokeRpc(method, params);

    const created = await call1('bots.create', { name: 'MailBot', skipKickoff: true });
    const bot = created.bot;
    const homeSid = created.sessionId;
    const side = await call1('bots.session.start', { botId: bot.id, title: 'Feature Thread' });

    // 1. Add needs_you item on side chat, snooze must NOT queue or send owed mail
    const added = await call1('bots.items.add', {
      ownerBotId: bot.id,
      chatId: side.sessionId,
      source: { kind: 'chat', title: 'Feature Thread' },
      title: 'Deploy v2',
      status: 'needs_you',
      comment: 'Ready to deploy?',
      actor: { kind: 'bot', botId: bot.id, chatId: side.sessionId },
    });
    const promptCountBeforeSnooze = activeController.prompted.length;
    await call1('bots.items.owner.snooze', {
      items: [{ uid: added.item.uid }],
      until: Date.now() + 3_600_000,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runtime1.itemsStore.owedMail().length, 0);
    assert.equal(activeController.prompted.length, promptCountBeforeSnooze);

    // 2. Owner comment with askedInConversation + plain + files routes mail to askedInConversation and marks sent
    const askedSide = await call1('bots.session.start', { botId: bot.id, title: 'Asked Conv' });
    const commentRes = await call1('bots.items.owner.comment', {
      uid: added.item.uid,
      text: 'Hold for QA signoff',
      plain: true,
      askedInConversation: askedSide.sessionId,
      files: ['qa-report.md'],
      requestId: 'req-mail-1',
    });
    assert.equal(commentRes.item.status, 'needs_you'); // plain comment does not resolve needs_you
    await runtime1.sessionRuntime.sendOwedMail();
    const mailPrompt = activeController.prompted.find((p) => p.sessionId === askedSide.sessionId && String(p.requestId || '').startsWith('bot-item-mail-'));
    assert.ok(mailPrompt, 'owed mail should route to askedInConversation');
    assert.equal(runtime1.itemsStore.owedMail().length, 0);

    // 3. Owner answer with questionEventId resolves needs_you -> working
    const qEventId = commentRes.item.questionEventId;
    const ansRes = await call1('bots.items.owner.comment', {
      uid: added.item.uid,
      text: 'QA passed, ship it',
      questionEventId: qEventId,
      requestId: 'req-mail-2',
    });
    assert.equal(ansRes.item.status, 'working');
    await runtime1.sessionRuntime.sendOwedMail();
    assert.equal(runtime1.itemsStore.owedMail().length, 0);

    // 4. Close item with PR link -> automatically appends to memory/journal/YYYY-MM.md (zero LLM)
    await call1('bots.items.link', {
      uid: added.item.uid,
      links: [{ kind: 'pr', ref: 'org/repo#99' }],
      actor: { kind: 'bot', botId: bot.id, chatId: side.sessionId },
    });
    await call1('bots.items.done', {
      uid: added.item.uid,
      note: 'Shipped cleanly',
      actor: { kind: 'bot', botId: bot.id, chatId: side.sessionId },
    });
    const ym = new Date().toISOString().slice(0, 7);
    const journalPath = path.join(bot.homePath, 'memory', 'journal', `${ym}.md`);
    assert.equal(fs.existsSync(journalPath), true, 'closing item must create monthly journal');
    const journalText = fs.readFileSync(journalPath, 'utf8');
    assert.match(journalText, /item #1/);
    assert.match(journalText, /PR org\/repo#99/);
    assert.match(journalText, /Deploy v2/);

    // 5. Simulate controller offline -> owner status queues owedMail -> restart recovers mail & backfills deleted journal
    const item2 = await call1('bots.items.add', {
      ownerBotId: bot.id,
      chatId: homeSid,
      source: { kind: 'home', title: null },
      title: 'Restart Recovery Item',
      status: 'planned',
      actor: { kind: 'bot', botId: bot.id, chatId: homeSid },
    });
    activeController = null; // Controller temporarily unavailable
    const refusalProbe = await runtime1.sessionRuntime.runSingleTurn(homeSid, 'ping');
    assert.equal(refusalProbe.ok, false);
    assert.equal(refusalProbe.error, 'session-controller-unavailable');
    assert.equal(refusalProbe.refusal?.code, 'session-controller-unavailable');
    assert.equal(refusalProbe.refusal?.recoverable, true);

    await call1('bots.items.owner.comment', {
      uid: item2.item.uid,
      text: 'Please pick this up on restart',
      requestId: 'req-restart-mail',
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runtime1.itemsStore.owedMail().length, 1, 'owed mail remains queued when controller is offline');

    // Remove journal to verify startup 24h backfill restores it
    fs.unlinkSync(journalPath);
    assert.equal(fs.existsSync(journalPath), false);
    runtime1.close();

    // Restart runtime with live controller -> startRecovery drains owedMail + backfills 24h journal
    const mock2 = createMockHarness();
    const runtime2 = createBotsRuntime({
      ctx: mock2.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock2.controller,
    });
    onClose(() => runtime2.close());
    const recovered = await runtime2.recoveryPromise;
    assert.equal(recovered.ok, true);
    assert.equal(recovered.mail.deliveredGroups, 1);
    assert.equal(runtime2.itemsStore.owedMail().length, 0);
    assert.ok(mock2.prompted.some((p) => p.sessionId === homeSid && String(p.requestId || '').startsWith('bot-item-mail-')));
    assert.equal(fs.existsSync(journalPath), true, 'startup backfillJournal24h must restore 24h closed items');
    assert.match(fs.readFileSync(journalPath, 'utf8'), /Deploy v2/);
  });
});

test('Wave 2 wiring: deleteBot cascade cleanup, bots.groups.items, bots.chat.delete, bots.work.stop, template rollback, tools version lock', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');

  await withTempDir('wave2-crud-groups', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    const cancelledByController = [];
    const mock = createMockHarness();
    mock.controller.cancel = async ({ sessionId }) => {
      cancelledByController.push(sessionId);
      return { ok: true };
    };
    let releaseWorkerTurn = null;
    mock.controller.runTurnForTest = (sessionId, promptText, signal) => new Promise((resolve) => {
      mock.prompted.push({ sessionId, text: promptText });
      if (promptText.includes('LONG_RUNNING_TASK')) {
        releaseWorkerTurn = () => resolve({ ok: true, reply: 'late finish' });
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'aborted', reason: 'aborted', reply: '' }));
        return;
      }
      resolve({ ok: true, reply: `OK(${sessionId})` });
    });

    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock.controller,
    });
    onClose(() => runtime.close());
    const call = (method, params) => runtime.http.invokeRpc(method, params);

    // 1. Template creation writes import/shared-setup.json and rolls back cleanly on failure
    const tplCreated = await call('bots.create', { name: 'TplBot', fromTemplate: { templateId: 'pr-review' }, skipKickoff: true });
    assert.ok(fs.existsSync(path.join(tplCreated.bot.homePath, 'import', 'shared-setup.json')));
    const botsCountBeforeFail = runtime.botsStore.listBots().length;
    await assert.rejects(
      () => runtime.botsService.createBot({
        name: 'RollbackBot',
        fromTemplate: { templateId: 'pr-review' },
        skipKickoff: true,
        _onBeforeCommit: () => { throw new Error('simulated_provision_failure'); },
      }),
      /simulated_provision_failure/,
    );
    assert.equal(runtime.botsStore.listBots().length, botsCountBeforeFail);
    assert.equal(fs.existsSync(path.join(dshHome, 'data', 'bots', 'rollbackbot')), false);

    // 2. Tools optimistic version lock + serialized queue
    const tools0 = await call('bots.tools.list', { botId: tplCreated.bot.id });
    assert.ok(typeof tools0.version === 'string' && tools0.version.length > 0);
    const tools1 = await call('bots.tools.add', {
      botId: tplCreated.bot.id,
      expectedVersion: tools0.version,
      server: { name: 'gh', url: 'https://server.smithery.ai/@owner/mcp', headers: { Authorization: 'Bearer secret123' } },
    });
    assert.notEqual(tools1.version, tools0.version);
    await assert.rejects(
      () => call('bots.tools.remove', { botId: tplCreated.bot.id, name: 'gh', expectedVersion: tools0.version }),
      (err) => err.code === 'changed-on-disk',
    );

    // 3. bots.chat.delete refuses active Home Chat, cancels & deletes side chat
    await assert.rejects(
      () => call('bots.chat.delete', { botId: tplCreated.bot.id, sessionId: tplCreated.sessionId }),
      (err) => err.code === 'cannot_delete_home_chat',
    );
    const side = await call('bots.session.start', { botId: tplCreated.bot.id, title: 'Temp Side' });
    const delChat = await call('bots.chat.delete', { botId: tplCreated.bot.id, sessionId: side.sessionId });
    assert.equal(delChat.deleted, true);
    assert.equal(runtime.botsStore.getChat(side.sessionId), null);
    assert.ok(cancelledByController.includes(side.sessionId));

    // 4. bots.work.stop cancels running worker session and closes bot_work
    const workerSide = await runtime.sessionRuntime.startSideChat(tplCreated.bot.id, {
      title: 'Worker · repo',
      kind: 'worker',
      origin: 'work',
      dispatchId: 'disp-stop-1',
      taskId: 'task-stop-1',
    });
    const workRow = runtime.workStore.startWork({
      botId: tplCreated.bot.id,
      source: 'app',
      externalId: tplCreated.sessionId,
      taskId: 'task-stop-1',
      dispatchId: 'disp-stop-1',
    });
    const runningPromise = runtime.sessionRuntime.runSingleTurn(workerSide.sessionId, 'LONG_RUNNING_TASK');
    const stopRes = await call('bots.work.stop', { botId: tplCreated.bot.id, workId: workRow.id });
    assert.equal(stopRes.ok, true);
    assert.ok(stopRes.cancelledSessionIds.includes(workerSide.sessionId));
    assert.ok(stopRes.work.closedAt);
    const turnResult = await runningPromise;
    assert.equal(turnResult.ok, false);
    assert.equal(turnResult.reason, 'aborted');
    if (releaseWorkerTurn) releaseWorkerTurn();

    // 5. bots.groups.items (group scope vs all scope, botId filter, onlyNeedsYou) + bots.items.list pagination/uids
    const bot2 = await call('bots.create', { name: 'PeerBot', skipKickoff: true });
    const grp = await call('bots.groups.create', { botIds: [tplCreated.bot.id, bot2.bot.id] });
    await call('bots.groups.send', { groupId: grp.id, text: '@PeerBot check this', waitForReplies: true });
    const freshGrp = runtime.groupsStore.getGroup(grp.id);
    const peerGroupSid = freshGrp.memberSessionIds[bot2.bot.id];
    assert.ok(peerGroupSid);

    const grpItem = await call('bots.items.add', {
      ownerBotId: bot2.bot.id,
      chatId: peerGroupSid,
      source: { kind: 'chat', title: grp.name },
      title: 'Group-scoped item',
      status: 'needs_you',
      comment: 'Confirm group scope?',
      actor: { kind: 'bot', botId: bot2.bot.id, chatId: peerGroupSid },
    });
    const homeItem = await call('bots.items.add', {
      ownerBotId: tplCreated.bot.id,
      chatId: tplCreated.sessionId,
      source: { kind: 'home', title: null },
      title: 'Home-only item',
      status: 'working',
      actor: { kind: 'bot', botId: tplCreated.bot.id, chatId: tplCreated.sessionId },
    });

    // 5b. bots.groups.stop really cancels in-flight group member turn and returns cancelledSessionIds
    const groupSendPending = call('bots.groups.send', {
      groupId: grp.id,
      text: '@PeerBot LONG_RUNNING_TASK please wait',
      waitForReplies: true,
    });
    await new Promise((r) => setTimeout(r, 25));
    const grpStopRes = await call('bots.groups.stop', { groupId: grp.id });
    assert.equal(grpStopRes.ok, true);
    assert.ok(Array.isArray(grpStopRes.cancelledSessionIds));
    assert.ok(grpStopRes.cancelledSessionIds.includes(peerGroupSid));
    await groupSendPending;

    const scopeGroup = await call('bots.groups.items', { groupId: grp.id, scope: 'group' });
    assert.equal(scopeGroup.items.length, 1);
    assert.equal(scopeGroup.items[0].uid, grpItem.item.uid);
    assert.equal(scopeGroup.counts.needsYou, 1);

    const scopeAll = await call('bots.groups.items', { groupId: grp.id, scope: 'all' });
    assert.equal(scopeAll.items.length, 2);
    assert.equal(scopeAll.counts.total, 2);

    const onlyNeeds = await call('bots.groups.items', { groupId: grp.id, scope: 'all', onlyNeedsYou: true });
    assert.equal(onlyNeeds.items.length, 1);
    assert.equal(onlyNeeds.items[0].uid, grpItem.item.uid);

    const byUids = await call('bots.items.list', { uids: [homeItem.item.uid] });
    assert.equal(byUids.items.length, 1);
    assert.equal(byUids.items[0].uid, homeItem.item.uid);

    // 6. deleteBot full cascade cleanup (automations, groups, work, look-around, memory history, chats)
    await call('bots.automations.create', {
      botId: tplCreated.bot.id,
      name: 'Hourly check',
      prompt: 'Check CI status',
      intervalMinutes: 60,
    });
    await call('bots.memory.add', { botId: tplCreated.bot.id, text: 'Will be cleaned', date: '2026-11-23' });
    await call('bots.lookAround.set', { botId: tplCreated.bot.id, on: true });
    runtime.lookAroundService.markFirstOwnerChat(tplCreated.bot.id);
    assert.ok(runtime.workStore.listAutomations({ botId: tplCreated.bot.id }).length > 0);
    assert.ok(runtime.workStore.listWork({ botId: tplCreated.bot.id }).length > 0);

    const delBotRes = await call('bots.delete', { botId: tplCreated.bot.id });
    assert.equal(delBotRes.deleted, true);
    assert.equal(delBotRes.folderPreserved, true);
    assert.equal(runtime.botsStore.getBot(tplCreated.bot.id), null);
    assert.equal(runtime.botsStore.listChats(tplCreated.bot.id, { includeClosed: true }).length, 0);
    assert.equal(runtime.workStore.listAutomations({ botId: tplCreated.bot.id }).length, 0);
    assert.equal(runtime.workStore.listWork({ botId: tplCreated.bot.id }).length, 0);
    const updatedGrp = runtime.groupsStore.getGroup(grp.id);
    assert.deepEqual(updatedGrp.botIds, [bot2.bot.id]);
    const lookAroundJson = JSON.parse(fs.readFileSync(path.join(dshHome, 'data', 'bots', '_meta', 'bot-look-around.json'), 'utf8'));
    assert.equal(Object.prototype.hasOwnProperty.call(lookAroundJson, tplCreated.bot.id), false);
    const histFile = path.join(dshHome, 'data', 'bots', '_meta', 'bot-memory-history', `${encodeURIComponent(tplCreated.bot.id)}.json`);
    assert.equal(fs.existsSync(histFile), false);

    // Deleting the last remaining member dissolves the group cleanly
    await call('bots.delete', { botId: bot2.bot.id });
    assert.equal(runtime.groupsStore.getGroup(grp.id), null);
  });
});

test('Wave 2 wiring: Look-Around read-only tool guard, first owner chat arming, group bot_create_offer guard, bot_send actionable refusals, bot_reply confirm + real dsh-im delivery', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { buildBotToolDefinitions } = await importBots('bot-tools-registry.js');
  const shared = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-whale/src/shared/index.js')).href);

  // Verify shared/index.js re-exports
  assert.equal(typeof shared.botItemAskAdvice, 'function');
  assert.equal(typeof shared.scanBotText, 'function');
  assert.equal(typeof shared.botToolUrlAuthority, 'function');
  assert.equal(typeof shared.isSafeBotPackageToolUrl, 'function');
  assert.ok(Array.isArray(shared.BOT_TEXT_SCAN_KINDS));

  await withTempDir('wave2-tools-security', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    const mock = createMockHarness();
    const imDeliveries = [];
    const imService = {
      async sendReply(payload) {
        imDeliveries.push(payload);
        return { messageId: `im-msg-${imDeliveries.length}`, ok: true };
      },
    };
    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock.controller,
      imService,
    });
    onClose(() => runtime.close());

    const botA = await runtime.botsService.createBot({ name: 'Alpha', skipKickoff: true });
    const botB = await runtime.botsService.createBot({ name: 'Beta', skipKickoff: true });
    const botPaused = await runtime.botsService.createBot({ name: 'Sleeper', skipKickoff: true });
    await runtime.botsService.updateBot(botPaused.bot.id, { paused: true });

    // 1. First real owner chat arms Look Around periodic sweep
    assert.equal(runtime.lookAroundService.getState(botA.bot.id).armed, false);
    // Kickoff message must NOT arm
    mock.ctx.emit('session/event', { id: botA.sessionId }, {
      type: 'user/message',
      data: { source: { kind: 'user', rpcId: 'bot-kickoff-1' }, content: [{ type: 'text', text: shared.BOT_CREATED_KICKOFF }] },
    });
    assert.equal(runtime.lookAroundService.getState(botA.bot.id).armed, false);
    // Real owner chat message arms Look Around
    mock.ctx.emit('session/event', { id: botA.sessionId }, {
      type: 'user/message',
      data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我看下今天 PR' }] },
    });
    assert.equal(runtime.lookAroundService.getState(botA.bot.id).armed, true);

    const confirmCalls = [];
    let allowConfirm = false;
    const defs = buildBotToolDefinitions(() => runtime, {
      confirmAction: async (req) => {
        confirmCalls.push(req);
        return allowConfirm ? { ok: true } : { ok: false };
      },
    });
    const byName = new Map(defs.map((d) => [d.name, d]));

    // 2. Look-Around read-only code-level guard blocks all write/side-effect/offer tools, allows read-only & bot_suggest
    const lookSession = await runtime.sessionRuntime.startSideChat(botA.bot.id, {
      title: 'Look Around',
      kind: 'look-around',
      origin: 'automation',
    });
    const lookExec = { agent: { id: lookSession.sessionId, session: { id: lookSession.sessionId } } };
    for (const [toolName, args] of [
      ['bot_work_start', { cwd: root, prompt: 'edit code' }],
      ['bot_send', { toBotId: botB.bot.id, purpose: 'question', text: 'hi' }],
      ['bot_reply', { text: 'external' }],
      ['bot_create_offer', { name: 'Gamma', purpose: 'helper' }],
      ['bot_item_add', { title: 'Mutate item' }],
      ['bot_tools_manage', { action: 'list' }],
      ['bot_automation_create', { action: 'create', name: 'A', prompt: 'P' }],
    ]) {
      const blocked = await byName.get(toolName).execute(args, lookExec);
      assert.equal(blocked.ok, false, `${toolName} must be blocked in Look Around`);
      assert.match(blocked.detail, /Look Around read-only policy/);
    }
    const allowedSuggest = await byName.get('bot_suggest').execute({
      title: 'Check open PRs',
      why: '2 PRs waiting',
      ask: 'Review PR #10 and #11',
    }, lookExec);
    assert.equal(allowedSuggest.ok, true);
    const allowedList = await byName.get('bot_item_list').execute({}, lookExec);
    assert.equal(allowedList.ok, true);

    // 3. Group chat forbids bot_create_offer; Home chat rejects duplicate name
    const grp = runtime.groupsService.create({ botIds: [botA.bot.id, botB.bot.id] });
    const grpMember = await runtime.sessionRuntime.startSideChat(botA.bot.id, {
      title: `${grp.name} · Alpha`,
      kind: 'group-member',
      origin: 'group',
      groupId: grp.id,
    });
    const grpExec = { agent: { id: grpMember.sessionId, session: { id: grpMember.sessionId } } };
    const offerInGroup = await byName.get('bot_create_offer').execute({ name: 'NewSpec', purpose: 'Writes docs' }, grpExec);
    assert.equal(offerInGroup.ok, false);
    assert.match(offerInGroup.detail, /group chat/i);

    const homeExec = { agent: { id: botA.sessionId, session: { id: botA.sessionId } } };
    const dupOffer = await byName.get('bot_create_offer').execute({ name: 'Beta', purpose: 'Duplicate' }, homeExec);
    assert.equal(dupOffer.ok, false);
    assert.match(dupOffer.detail, /already exists/i);

    // 4. bot_send actionable refusals: unknown lists available bots, self-send blocked, paused blocked, worker handoff blocked
    const unknownSend = await byName.get('bot_send').execute({ toBotId: 'Ghost', purpose: 'question', text: 'hi' }, homeExec);
    assert.equal(unknownSend.ok, false);
    assert.match(unknownSend.detail, /Beta/);

    const selfSend = await byName.get('bot_send').execute({ toBotId: botA.bot.id, purpose: 'question', text: 'hi' }, homeExec);
    assert.equal(selfSend.ok, false);
    assert.match(selfSend.detail, /yourself/i);

    const pausedSend = await byName.get('bot_send').execute({ toBotId: botPaused.bot.id, purpose: 'question', text: 'hi' }, homeExec);
    assert.equal(pausedSend.ok, false);
    assert.match(pausedSend.detail, /paused/i);

    const workerSess = await runtime.sessionRuntime.startSideChat(botA.bot.id, {
      title: 'Worker · repo',
      kind: 'worker',
      origin: 'work',
    });
    const workerExec = { agent: { id: workerSess.sessionId, session: { id: workerSess.sessionId } } };
    const workerHandoff = await byName.get('bot_send').execute({ toBotId: botB.bot.id, purpose: 'handoff', text: 'take over' }, workerExec);
    assert.equal(workerHandoff.ok, false);
    assert.match(workerHandoff.detail, /worker/i);

    // 5. bot_reply preserves confirmModelAction + isNonOwnerImTurn, validates choices/files, and delivers via dsh-im
    const conflictReply = await byName.get('bot_reply').execute({
      text: 'Conflict',
      choices: ['Yes', 'No'],
      files: ['report.pdf'],
    }, homeExec);
    assert.equal(conflictReply.ok, false);
    assert.match(conflictReply.detail, /choices_files_conflict/);

    // Declined desktop confirm -> fail closed, 0 IM deliveries
    allowConfirm = false;
    const declinedReply = await byName.get('bot_reply').execute({
      text: 'Status update',
      channel: 'feishu',
      choices: ['Approve', 'Reject'],
    }, homeExec);
    assert.equal(declinedReply.ok, false);
    assert.equal(imDeliveries.length, 0);
    assert.equal(confirmCalls.at(-1).tool, 'bot_reply');

    // Approved desktop confirm -> real dsh-im delivery with choices & react
    allowConfirm = true;
    const deliveredReply = await byName.get('bot_reply').execute({
      text: 'Ready to merge?',
      channel: 'feishu',
      choices: ['Merge', 'Wait'],
      react: '👍',
    }, homeExec);
    assert.equal(deliveredReply.ok, true);
    const parsedReply = JSON.parse(deliveredReply.detail);
    assert.equal(parsedReply.transport, 'dsh-im');
    assert.equal(parsedReply.channel, 'feishu');
    assert.equal(imDeliveries.length, 1);
    assert.deepEqual(imDeliveries[0].choices, ['Merge', 'Wait']);
    assert.equal(imDeliveries[0].react, '👍');

    // External channel when dsh-im is unavailable returns actionable error (not silent pet fallback)
    runtime.imService = null;
    const unavailableReply = await byName.get('bot_reply').execute({
      text: 'Ping Slack',
      channel: 'slack',
    }, homeExec);
    assert.equal(unavailableReply.ok, false);
    assert.match(unavailableReply.detail, /dsh-im delivery service is unavailable/i);
  });
});

test('Wave 3 RPC contracts: owner.snooze single/uids/items, work.stop sessionId/taskId fallback, upNext seen/unread per-suggestion toggle', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');

  await withTempDir('wave3-rpc-contracts', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    const mock = createMockHarness();
    let releaseTurn = null;
    const origPrompt = mock.controller.prompt;
    mock.controller.prompt = async (params, signal) => {
      const txt = params?.content?.[0]?.text ?? '';
      if (txt.includes('HOLD_WORKER')) {
        return await new Promise((resolve, reject) => {
          releaseTurn = () => resolve({ ok: true });
          signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
        });
      }
      return origPrompt(params, signal);
    };

    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock.controller,
    });
    onClose(() => runtime.close());
    const call = (method, params) => runtime.http.invokeRpc(method, params);

    const created = await call('bots.create', { name: 'ContractBot', skipKickoff: true });
    const botId = created.bot.id;

    // 1. bots.items.owner.snooze supports single { uid }, { uids }, and { items } without emitting owedMail
    const addItem = async (title) => (await call('bots.items.add', {
      ownerBotId: botId,
      chatId: created.sessionId,
      source: { kind: 'home', title: null },
      title,
      status: 'needs_you',
      comment: 'Waiting for owner',
      actor: { kind: 'bot', botId, chatId: created.sessionId },
    })).item;

    const itemSingle = await addItem('Snooze via single uid');
    const itemUids = await addItem('Snooze via uids array');
    const itemObjects = await addItem('Snooze via items array');
    const until = Date.now() + 3_600_000;

    const resSingle = await call('bots.items.owner.snooze', { uid: itemSingle.uid, until });
    assert.equal(resSingle.items.length, 1);
    assert.equal(resSingle.items[0].uid, itemSingle.uid);

    const resUids = await call('bots.items.owner.snooze', { uids: [itemUids.uid], until });
    assert.equal(resUids.items.length, 1);
    assert.equal(resUids.items[0].uid, itemUids.uid);

    const resItems = await call('bots.items.owner.snooze', {
      items: [{ uid: itemObjects.uid, othersLastEventId: 0 }],
      until,
    });
    assert.equal(resItems.items.length, 1);
    assert.equal(resItems.items[0].uid, itemObjects.uid);
    assert.equal(runtime.itemsStore.owedMail().length, 0);

    // 2. bots.work.stop supports { botId, sessionId } and { botId, workId: taskId } fallbacks
    const workerBySid = await runtime.sessionRuntime.startSideChat(botId, {
      title: 'Worker · sid',
      kind: 'worker',
      origin: 'work',
      dispatchId: 'disp-sid-1',
      taskId: 'task-sid-1',
    });
    const workBySid = runtime.workStore.startWork({
      botId,
      source: 'app',
      externalId: created.sessionId,
      taskId: 'task-sid-1',
      dispatchId: 'disp-sid-1',
    });
    const turnSid = runtime.sessionRuntime.runSingleTurn(workerBySid.sessionId, 'HOLD_WORKER');
    const stoppedBySid = await call('bots.work.stop', { botId, sessionId: workerBySid.sessionId });
    assert.equal(stoppedBySid.ok, true);
    assert.equal(stoppedBySid.workId, workBySid.id);
    assert.ok(stoppedBySid.cancelledSessionIds.includes(workerBySid.sessionId));
    assert.ok(stoppedBySid.work.closedAt);
    assert.equal((await turnSid).reason, 'aborted');
    if (releaseTurn) releaseTurn();

    const workerByTask = await runtime.sessionRuntime.startSideChat(botId, {
      title: 'Worker · task',
      kind: 'worker',
      origin: 'work',
      dispatchId: 'disp-task-2',
      taskId: 'task-lookup-2',
    });
    const workByTask = runtime.workStore.startWork({
      botId,
      source: 'app',
      externalId: created.sessionId,
      taskId: 'task-lookup-2',
      dispatchId: 'disp-task-2',
    });
    const stoppedByTask = await call('bots.work.stop', { botId, workId: 'task-lookup-2' });
    assert.equal(stoppedByTask.ok, true);
    assert.equal(stoppedByTask.workId, workByTask.id);
    assert.ok(stoppedByTask.cancelledSessionIds.includes(workerByTask.sessionId));
    assert.ok(stoppedByTask.work.closedAt);

    // 3. bots.upNext.list exposes seen/unread booleans; seen/unseen supports per-suggestion id/ids and bot-wide fallback
    const s1 = (await call('bots.suggest', {
      botId,
      title: 'Suggestion One',
      why: 'Reason 1',
      ask: 'Do task 1',
    })).suggestion;
    const s2 = (await call('bots.suggest', {
      botId,
      title: 'Suggestion Two',
      why: 'Reason 2',
      ask: 'Do task 2',
    })).suggestion;
    const list0 = await call('bots.upNext.list', { botId });
    assert.equal(list0.openSuggestions.length, 2);
    for (const s of list0.openSuggestions) {
      assert.equal(s.seen, false);
      assert.equal(s.unread, true);
    }

    await call('bots.upNext.seen', { botId, id: s1.id });
    const list1 = await call('bots.upNext.list', { botId });
    const map1 = new Map(list1.openSuggestions.map((s) => [s.id, s]));
    assert.equal(map1.get(s1.id).seen, true);
    assert.equal(map1.get(s1.id).unread, false);
    assert.equal(map1.get(s2.id).seen, false);
    assert.equal(map1.get(s2.id).unread, true);
    assert.equal(list1.unseenCount, 1);

    await call('bots.upNext.unseen', { botId, ids: [s1.id] });
    const list2 = await call('bots.upNext.list', { botId });
    assert.equal(list2.openSuggestions.find((s) => s.id === s1.id).seen, false);
    assert.equal(list2.openSuggestions.find((s) => s.id === s1.id).unread, true);
    assert.equal(list2.unseenCount, 2);

    // Bot-wide legacy signature { id: botId } marks all open suggestions seen
    await call('bots.upNext.seen', { id: botId });
    const list3 = await call('bots.upNext.list', { botId });
    assert.ok(list3.openSuggestions.every((s) => s.seen === true && s.unread === false));
    assert.equal(list3.unseenCount, 0);
  });
});

test('Audit regressions: P0-2 internal source.kind + call-origin, P0-3 cwd/verifyCmd guards, P1 #9/#25/#29', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { buildBotToolDefinitions } = await importBots('bot-tools-registry.js');
  const { createMailReconciler } = await importBots('mail-reconciler.js');
  const { classifyCallOrigin, isUnattendedPulseTurn } = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-whale/lib/call-origin.js')).href);
  const { isTrustedOwnerMessage } = await import(pathToFileURL(path.resolve(__dirname, '../../vendor/dsh-whale/lib/memory-store.js')).href);

  await withTempDir('audit-regressions', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });
    const workDir = path.join(root, 'workspace');
    fs.mkdirSync(workDir, { recursive: true });

    const followups = [];
    const promptFallbacks = [];
    const mock = createMockHarness();
    mock.controller.runTurnForTest = undefined;
    mock.controller.resolveAgent = async (sid) => ({
      agent: {
        id: sid,
        followup(msg) {
          followups.push({ sid, msg });
          mock.ctx.emit('session/event', { id: sid }, { type: 'user/message', data: { source: msg.source } });
          mock.ctx.emit('session/event', { id: sid }, { type: 'assistant/message', data: { content: [{ type: 'text', text: 'done' }] } });
          mock.ctx.emit('session/event', { id: sid }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
        },
      },
    });
    mock.controller.prompt = async (spec) => {
      promptFallbacks.push(spec);
      return { ok: true };
    };

    const bridgeSent = [];
    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock.controller,
      imOutboundBridge: {
        async sendText(msg) {
          bridgeSent.push(msg);
          return { ok: true, delivered: true, channel: msg.channel || 'feishu', messageId: 'm-1' };
        },
      },
    });
    onClose(() => runtime.close());
    await runtime.recoveryPromise;

    const botA = await runtime.botsService.createBot({ name: 'BotA', skipKickoff: true });
    const botB = await runtime.botsService.createBot({ name: 'BotB', skipKickoff: true });

    // [P0-2] Webhook/folder/bot-send runSingleTurn injects dsh-bots:* via followup (never controller.prompt),
    // and call-origin + isTrustedOwnerMessage classify it as unattended/untrusted.
    const autoWh = runtime.automationsService.create({
      botId: botA.bot.id,
      name: 'WH',
      prompt: 'Inspect webhook',
      triggers: [{ kind: 'webhook', webhookId: 'wh-1' }],
    });
    await runtime.automationsService.triggerWebhook({ automationId: autoWh.id, payload: { evil: true } });
    assert.equal(promptFallbacks.length, 0);
    const whMsg = followups.at(-1).msg;
    assert.equal(whMsg.source.kind, 'dsh-bots:webhook');
    assert.equal(isTrustedOwnerMessage({ type: 'user/message', data: { source: whMsg.source } }), false);
    const whExec = {
      agent: {
        id: botA.sessionId,
        session: {
          snapshotEvents: () => [
            { seq: 1, type: 'turn/start', data: {} },
            { seq: 2, type: 'user/message', data: { source: whMsg.source } },
          ],
        },
      },
    };
    assert.equal(classifyCallOrigin(whExec).kind, 'pulse');
    assert.equal(isUnattendedPulseTurn(whExec), true);

    const defs = buildBotToolDefinitions(() => runtime, { confirmAction: async () => ({ ok: true }) });
    const byName = new Map(defs.map((d) => [d.name, d]));
    const execA = { agent: { id: botA.sessionId, session: { id: botA.sessionId } } };
    const execB = { agent: { id: botB.sessionId, session: { id: botB.sessionId } } };

    // bot_work_start blocked in unattended webhook turn
    const unattendedWork = await byName.get('bot_work_start').execute({ cwd: workDir, prompt: 'Run' }, whExec);
    assert.equal(unattendedWork.ok, false);
    assert.match(unattendedWork.detail, /无人值守/);

    // bot_send injects dsh-bots:bot-send
    const sendRes = await byName.get('bot_send').execute({
      toBotId: botB.bot.id,
      purpose: 'question',
      text: 'Status?',
      awaitReply: true,
    }, execA);
    assert.equal(sendRes.ok, true);
    assert.equal(followups.at(-1).msg.source.kind, 'dsh-bots:bot-send');

    // [P0-3] cwd sensitive boundary + verifyCmd injection guard
    const homeBlocked = await byName.get('bot_work_start').execute({ cwd: os.homedir(), prompt: 'x' }, execA);
    assert.equal(homeBlocked.ok, false);
    assert.match(homeBlocked.detail, /broad base directory|sensitive/i);
    const metaBlocked = await byName.get('bot_work_start').execute({ cwd: path.join(dshHome, 'data', 'bots', '_meta'), prompt: 'x' }, execA);
    assert.equal(metaBlocked.ok, false);
    assert.match(metaBlocked.detail, /metadata directory/i);

    for (const badCmd of ['node -e 1 && echo pwned', 'echo a | cat', 'bash -c "echo hi"', 'node $(whoami)']) {
      const badVerify = await byName.get('bot_work_start').execute({ cwd: workDir, prompt: 'x', verifyCmd: badCmd }, execA);
      assert.equal(badVerify.ok, false, `Must reject verifyCmd: ${badCmd}`);
    }

    // [P1 #9] bot_automation_create cross-bot update/delete blocked; resolveCallerBot has no cross-session fallback
    const autoB = runtime.automationsService.create({ botId: botB.bot.id, name: 'BJob', prompt: 'Ping' });
    const crossUpdate = await byName.get('bot_automation_create').execute({ action: 'update', id: autoB.id, name: 'Hacked' }, execA);
    assert.equal(crossUpdate.ok, false);
    assert.match(crossUpdate.detail, /another bot/);
    const crossDelete = await byName.get('bot_automation_create').execute({ action: 'delete', id: autoB.id }, execA);
    assert.equal(crossDelete.ok, false);
    assert.match(crossDelete.detail, /another bot/);
    assert.ok(runtime.workStore.getAutomation(autoB.id));

    const foreignExec = { agent: { id: 'unrelated-session-xyz', session: { id: 'unrelated-session-xyz' } } };
    const noFallback = await byName.get('bot_chats').execute({}, foreignExec);
    assert.equal(noFallback.ok, false);
    assert.match(noFallback.detail, /Caller bot context unavailable/);

    // [P1 #25] deliverReplyViaBridge passes caller.chat.externalId when args.chatId is omitted
    const imChat = runtime.botsStore.upsertChat({
      botId: botA.bot.id,
      sessionId: `${botA.sessionId}-feishu-1`,
      kind: 'im',
      title: 'Feishu Chat',
      externalSource: 'feishu',
      externalId: 'oc_feishu_chat_999',
    }, Date.now());
    const imExec = { agent: { id: imChat.sessionId, session: { id: imChat.sessionId } } };
    const bridgeReply = await byName.get('bot_reply').execute({ text: 'Reply without explicit chatId' }, imExec);
    assert.equal(bridgeReply.ok, true);
    assert.equal(bridgeSent.length, 1);
    assert.equal(bridgeSent[0].chatId, 'oc_feishu_chat_999');

    // [P1 #29] mail-reconciler paginates >50 owed actions and startup with wakeBot runs single drain
    const item = runtime.itemsStore.add({
      ownerBotId: botA.bot.id,
      chatId: botA.sessionId,
      source: { kind: 'home', title: null },
      title: 'Paged Item',
      status: 'working',
    }, { kind: 'bot', botId: botA.bot.id, chatId: botA.sessionId }).item;
    for (let i = 0; i < 55; i += 1) {
      runtime.itemsStore.ownerComment(item.uid, { text: `msg-${i}`, requestId: `req-page-${i}` });
    }
    const wokeActions = [];
    const pagedReconciler = createMailReconciler({
      itemsStore: runtime.itemsStore,
      botsStore: runtime.botsStore,
      sessionRuntime: runtime.sessionRuntime,
      wakeBot: async (payload) => {
        wokeActions.push(payload.group.action);
        return { ok: true };
      },
    });
    const recRes = await pagedReconciler.reconcileOwedMail();
    assert.equal(recRes.ok, true);
    assert.equal(recRes.totalGroups, 55);
    assert.equal(wokeActions.length, 55);
    assert.equal(runtime.itemsStore.owedMail().length, 0);

    // Startup single-drain test with pre-populated owed mail and wakeBot
    runtime.itemsStore.ownerComment(item.uid, { text: 'wake-once', requestId: 'req-wake-once' });
    runtime.close();

    const startupWakes = [];
    const mockStartup = createMockHarness();
    const runtimeWake = createBotsRuntime({
      ctx: mockStartup.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mockStartup.controller,
      wakeBot: async (payload) => {
        startupWakes.push(payload);
        return { ok: true };
      },
    });
    onClose(() => runtimeWake.close());
    await runtimeWake.recoveryPromise;
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(startupWakes.length, 1);
    assert.equal(mockStartup.prompted.filter((p) => String(p.requestId || '').startsWith('bot-item-mail-')).length, 0);
  });
});

test('Right-panel RPCs: dismiss idempotency, non-blocking background start/lookNow/runNow, and session error propagation', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { createBotsHttpHandler } = await importBots('rpc-router.js');

  await withTempDir('right-panel-nonblocking', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });

    let activeController = null;
    const mock = createMockHarness();
    let pendingTurn = null;
    const baseRunTurn = mock.controller.runTurnForTest.bind(mock.controller);
    mock.controller.runTurnForTest = async (sid, promptText) => {
      if (pendingTurn) {
        const current = pendingTurn;
        return current.promise;
      }
      return baseRunTurn(sid, promptText);
    };
    activeController = mock.controller;

    let pendingSweep = null;
    const reportedErrors = [];
    const runtime = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => activeController,
      onError: (err, ctx) => reportedErrors.push({ err, ctx }),
      runLookAroundSweep: async (bot) => {
        if (pendingSweep) return pendingSweep.promise;
        runtime.lookAroundService.addSuggestion(bot.id, {
          title: 'Sync Sweep Suggestion',
          why: 'Immediate sweep',
          ask: 'Inspect immediately',
        });
        return { ok: true, summary: 'done' };
      },
    });
    onClose(() => runtime.close());
    await runtime.recoveryPromise;

    const events = [];
    const unsub = runtime.eventBus.subscribe((ev) => events.push(ev));
    onClose(unsub);

    const httpRouter = createBotsHttpHandler(runtime, { requestRejection: () => undefined });
    const srv = await startHttpServer(httpRouter.handler);
    onClose(() => srv.close());

    const call = async (method, params = {}) => {
      const { body } = await rpcPost(srv.baseUrl, method, params);
      assert.equal(body.ok, true, `${method} failed: ${JSON.stringify(body.error)}`);
      return body.result;
    };

    const created = await call('bots.create', { name: 'PanelBot', skipKickoff: true });
    const botId = created.bot.id;

    // 1. HTTP RPC bots.suggestions.dismiss removes open suggestion + repeat dismiss is idempotent without duplicate dismissals
    const sDismiss = (await call('bots.suggest', {
      botId,
      title: 'Dismiss Me',
      why: 'No longer relevant',
      ask: 'Skip it',
    })).suggestion;
    assert.equal((await call('bots.upNext.list', { botId })).openSuggestions.length, 1);

    const d1 = await call('bots.suggestions.dismiss', { botId, suggestionId: sDismiss.id });
    assert.equal(d1.ok, true);
    assert.equal(d1.suggestion.status, 'dismissed');
    assert.equal((await call('bots.upNext.list', { botId })).openSuggestions.length, 0);

    const d2 = await call('bots.suggestions.dismiss', { botId, suggestionId: sDismiss.id });
    assert.equal(d2.ok, true);
    assert.equal(d2.alreadyDismissed, true);

    const lookAroundFile = path.join(dshHome, 'data', 'bots', '_meta', 'bot-look-around.json');
    const persistedAfterDismiss = JSON.parse(fs.readFileSync(lookAroundFile, 'utf8'));
    assert.equal(persistedAfterDismiss[botId].dismissals.filter((d) => d.title === 'Dismiss Me').length, 1);

    // 2. bots.suggestions.start with background: true returns immediately before slow turn resolves & emits lookAround event
    const sStart = (await call('bots.suggest', {
      botId,
      title: 'Start Me Fast',
      why: 'Needs action',
      ask: 'Run background check',
    })).suggestion;

    let resolveStartTurn;
    pendingTurn = { promise: new Promise((r) => { resolveStartTurn = r; }) };
    events.length = 0;

    const bgStart = await call('bots.suggestions.start', {
      botId,
      suggestionId: sStart.id,
      background: true,
    });
    assert.equal(bgStart.ok, true);
    assert.equal(bgStart.started, true);
    assert.equal(bgStart.background, true);
    assert.equal(bgStart.suggestion.status, 'started');
    assert.ok(bgStart.sessionId);

    // Immediately removed from openSuggestions and lookAround event emitted before turn resolves
    assert.equal((await call('bots.upNext.list', { botId })).openSuggestions.length, 0);
    runtime.eventBus.flushNow();
    assert.ok(events.some((ev) => Array.isArray(ev.kinds) && ev.kinds.includes('lookAround')));

    // Repeat start on already-started suggestion is cleanly rejected as alreadyResolved
    const dupStart = await call('bots.suggestions.start', {
      botId,
      suggestionId: sStart.id,
      background: true,
    });
    assert.equal(dupStart.ok, false);
    assert.equal(dupStart.alreadyResolved, true);
    assert.equal(dupStart.status, 'started');

    resolveStartTurn({ ok: true, reply: 'background start done' });
    pendingTurn = null;
    await new Promise((r) => setTimeout(r, 25));

    // 3. bots.suggestions.start propagates session open failure WITHOUT mutating suggestion to started
    const sOffline = (await call('bots.suggest', {
      botId,
      title: 'Offline Bot Suggestion',
      why: 'Controller offline test',
      ask: 'Try when controller is down',
    })).suggestion;
    activeController = null;
    const failedStart = await call('bots.suggestions.start', {
      botId,
      suggestionId: sOffline.id,
      background: true,
    });
    assert.equal(failedStart.ok, false);
    assert.equal(failedStart.error, 'session-controller-unavailable');
    assert.equal((await call('bots.upNext.list', { botId })).openSuggestions.some((s) => s.id === sOffline.id), true);
    activeController = mock.controller;

    // 4. bots.lookAround.lookNow with background: true returns immediately, reports alreadyRunning while in flight, then settles
    let resolveSweep;
    pendingSweep = { promise: new Promise((r) => { resolveSweep = r; }) };
    const bgLook = await call('bots.lookAround.lookNow', { botId, background: true });
    assert.equal(bgLook.ok, true);
    assert.equal(bgLook.started, true);
    assert.equal(bgLook.background, true);
    assert.ok(bgLook.runId);
    assert.equal((await call('bots.upNext.list', { botId })).running, true);

    const dupLook = await call('bots.lookAround.lookNow', { botId, background: true });
    assert.equal(dupLook.ok, true);
    assert.equal(dupLook.alreadyRunning, true);

    events.length = 0;
    resolveSweep({ ok: true, summary: 'bg sweep finished' });
    pendingSweep = null;
    await new Promise((r) => setTimeout(r, 30));
    runtime.eventBus.flushNow();

    const stateAfterLook = await call('bots.upNext.list', { botId });
    assert.equal(stateAfterLook.running, false);
    assert.ok(stateAfterLook.runs.some((r) => r.id === bgLook.runId && r.ok === true));
    assert.ok(events.some((ev) => Array.isArray(ev.kinds) && ev.kinds.includes('lookAround')));

    // 5. bots.automations.runNow with background: true returns immediately, reports alreadyRunning, and settles
    const auto = await call('bots.automations.create', {
      botId,
      name: 'BG Auto',
      prompt: 'Run async check',
      intervalMinutes: 60,
    });
    let resolveAutoTurn;
    pendingTurn = { promise: new Promise((r) => { resolveAutoTurn = r; }) };

    const bgAuto = await call('bots.automations.runNow', { id: auto.id, background: true });
    assert.equal(bgAuto.ok, true);
    assert.equal(bgAuto.started, true);
    assert.equal(bgAuto.background, true);
    assert.equal(bgAuto.automationId, auto.id);

    const dupAuto = await call('bots.automations.runNow', { id: auto.id, background: true });
    assert.equal(dupAuto.ok, true);
    assert.equal(dupAuto.alreadyRunning, true);

    resolveAutoTurn({ ok: true, reply: 'auto completed' });
    pendingTurn = null;
    await new Promise((r) => setTimeout(r, 30));

    const updatedAuto = runtime.workStore.getAutomation(auto.id);
    assert.equal(updatedAuto.lastStatus, 'completed');
    const claims = (await call('bots.automations.claims', { automationId: auto.id })).claims;
    assert.ok(claims.some((c) => c.claimId === bgAuto.claimId && c.status === 'completed'));

    // 6. ensureControllerSession adopts minted sessionId returned by controller.create
    const origCreate = mock.controller.create;
    mock.controller.create = async (spec, signal) => {
      const mintedId = 'minted-side-session-1';
      return origCreate({ ...spec, sessionId: mintedId }, signal);
    };
    const sideMinted = await runtime.sessionRuntime.startSideChat(botId, { title: 'Minted Side' });
    assert.equal(sideMinted.ok, true);
    assert.match(sideMinted.sessionId, /^minted-/);
    assert.equal(runtime.botsStore.getChat(sideMinted.sessionId)?.botId, botId);
    mock.controller.create = origCreate;

    assert.equal(reportedErrors.length, 0);
  });
});

test('Bot mail pipeline regressions: internal notice channel, coalescing, inbox pruning, close cleanup, and unpause routing', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');
  const { createBotsHttpHandler } = await importBots('rpc-router.js');

  await withTempDir('mail-pipeline-regressions', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });

    const followups = [];
    const promptCalls = [];
    /** @type {Map<string, { id: string, inbox: { nextTurn: any[], remove: (id: string) => boolean }, followup: (msg: any) => void }>} */
    const liveAgents = new Map();
    const getOrSeedAgent = (sid) => {
      let agent = liveAgents.get(sid);
      if (!agent) {
        /** @type {any[]} */
        const nextTurn = [];
        agent = {
          id: sid,
          inbox: {
            nextTurn,
            remove(id) {
              const idx = nextTurn.findIndex((m) => m.id === id);
              if (idx === -1) return false;
              nextTurn.splice(idx, 1);
              return true;
            },
          },
          followup(msg) {
            followups.push({ sid, msg });
          },
        };
        liveAgents.set(sid, agent);
      }
      return agent;
    };

    const mock = createMockHarness();
    mock.controller.runTurnForTest = undefined;
    mock.controller.prompt = async (spec) => {
      promptCalls.push(spec);
      return { ok: true };
    };
    mock.controller.resolveAgent = async (sid) => ({ agent: getOrSeedAgent(sid) });

    const rt = createBotsRuntime({
      ctx: mock.ctx,
      dshHome,
      enableSchedulers: false,
      getController: () => mock.controller,
    });
    onClose(() => rt.close());
    await rt.recoveryPromise;

    const call = (method, params) => rt.http.invokeRpc(method, params);
    const created = await call('bots.create', { name: 'CoalesceBot', skipKickoff: true });
    const botId = created.bot.id;
    const homeSid = created.sessionId;
    const agent = getOrSeedAgent(homeSid);

    // 1. Add needs_you item + quick-answer via RPC `answers` alias -> switches to working; duplicate click is idempotent
    const added = await call('bots.items.add', {
      ownerBotId: botId,
      chatId: homeSid,
      source: { kind: 'home', title: null },
      title: 'Refactor mail queue',
      status: 'needs_you',
      comment: 'Proceed with notice channel?',
      actor: { kind: 'bot', botId, chatId: homeSid },
    });
    const qEvId = added.item.questionEventId;
    const firstQuick = await call('bots.items.owner.comment', {
      uid: added.item.uid,
      text: 'Yes, proceed',
      answers: qEvId,
      requestId: 'rpc-quick-1',
    });
    assert.equal(firstQuick.item.status, 'working');
    const dupQuick = await call('bots.items.owner.comment', {
      uid: added.item.uid,
      text: 'Yes, proceed',
      questionEventId: qEvId,
      requestId: 'rpc-quick-2',
    });
    assert.equal(dupQuick.deduplicated, true);

    // Add a second distinct owner comment on the same item, then drain
    await call('bots.items.owner.comment', {
      uid: added.item.uid,
      text: 'Also prune duplicate inbox notices',
      requestId: 'rpc-follow-1',
    });
    // Wait briefly for any async fire-and-forget trigger, then reset to test explicit coalesced drain cleanly
    await new Promise((r) => setTimeout(r, 25));
    followups.length = 0;

    // Seed 2 more owed comments directly so we guarantee multiple owed events exist before single drain
    rt.itemsStore.ownerComment(added.item.uid, { text: 'Coalesce note A', requestId: 'c-a' });
    rt.itemsStore.ownerComment(added.item.uid, { text: 'Coalesce note B', requestId: 'c-b' });
    // Seed stale unconsumed inbox notices for this item AND an unrelated item + user message
    agent.inbox.nextTurn.push(
      { id: 'stale-v2', role: 'user', source: { kind: 'dsh-bots:mail', itemUid: added.item.uid }, content: [{ type: 'text', text: 'old v2' }] },
      { id: 'stale-legacy', role: 'user', source: { rpcId: 'bot-item-mail-12' }, content: [{ type: 'text', text: `Item: #${added.item.number} "Refactor mail queue"` }] },
      { id: 'keep-other-item', role: 'user', source: { kind: 'dsh-bots:mail', itemUid: 'other-uid-999' }, content: [{ type: 'text', text: 'Item: #99 "Other"' }] },
      { id: 'keep-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'owner hello' }] },
    );

    const drainRes = await rt.sessionRuntime.sendOwedMail();
    assert.equal(drainRes.ok, true);
    assert.equal(drainRes.deliveredGroups, 1, 'multiple owed events for same item+session must coalesce into 1 notice');
    assert.equal(followups.length, 1);
    assert.equal(promptCalls.length, 0, 'must deliver via liveAgent.followup, never controller.prompt');
    const deliveredMsg = followups[0].msg;
    assert.equal(deliveredMsg.source.kind, 'dsh-bots:mail');
    assert.equal(deliveredMsg.source.form, 'notice');
    assert.ok(deliveredMsg.source.summary);
    assert.deepEqual(deliveredMsg.source.itemUids, [added.item.uid]);
    assert.equal(deliveredMsg.source.eventIds.length, 2);
    assert.match(deliveredMsg.content[0].text, /Coalesce note A/);
    assert.match(deliveredMsg.content[0].text, /Coalesce note B/);
    assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), ['keep-other-item', 'keep-user']);

    // 2. Closing an item (`canceled`) auto-reconciles owed mail AND prunes stale inbox notices for that item
    rt.itemsStore.ownerComment(added.item.uid, { text: 'Ignore this suggestion', requestId: 'c-cancel-before' });
    agent.inbox.nextTurn.push(
      { id: 'stale-after-cancel-v2', role: 'user', source: { kind: 'dsh-bots:mail', itemUids: [added.item.uid] }, content: [{ type: 'text', text: 'stale' }] },
      { id: 'stale-after-cancel-legacy', role: 'user', source: { rpcId: 'bot-item-mail-55' }, content: [{ type: 'text', text: `Item: #${added.item.number} (${added.item.uid})` }] },
    );
    await call('bots.items.owner.status', { uid: added.item.uid, status: 'canceled', reason: 'Ignore suggestion' });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(rt.itemsStore.owedMail().length, 0);
    assert.deepEqual(agent.inbox.nextTurn.map((m) => m.id), ['keep-other-item', 'keep-user']);

    const afterCancelDrain = await rt.sessionRuntime.sendOwedMail();
    assert.equal(afterCancelDrain.deliveredGroups, 0);
    assert.equal(followups.length, 1);

    // 3. Unpause via both RPC (`bots.update`) and `botsService.updateBot` obeys `hasCustomWakeBot` routing
    const wakes = [];
    const dshHome2 = path.join(root, 'dsh-home-wake');
    fs.mkdirSync(dshHome2, { recursive: true });
    const mockWake = createMockHarness();
    const wakeRt = createBotsRuntime({
      ctx: mockWake.ctx,
      dshHome: dshHome2,
      enableSchedulers: false,
      getController: () => mockWake.controller,
      wakeBot: async (payload) => {
        wakes.push(payload);
        return { ok: true };
      },
    });
    onClose(() => wakeRt.close());
    await wakeRt.recoveryPromise;
    const httpWake = createBotsHttpHandler(wakeRt, { requestRejection: () => undefined });
    const srv = await startHttpServer(httpWake.handler);
    onClose(() => srv.close());

    const created2 = await wakeRt.botsService.createBot({ name: 'WakePauseBot', skipKickoff: true });
    await wakeRt.botsService.updateBot(created2.bot.id, { paused: true });
    const item2 = wakeRt.itemsStore.add({
      ownerBotId: created2.bot.id,
      chatId: created2.sessionId,
      source: { kind: 'home', title: null },
      title: 'Wait until unpaused',
      status: 'planned',
    }, { kind: 'bot', botId: created2.bot.id, chatId: created2.sessionId }).item;
    wakeRt.itemsStore.ownerComment(item2.uid, { text: 'Wake via custom reconciler on RPC unpause', requestId: 'u-1' });
    assert.equal(wakes.length, 0);

    const unpauseRpc = await rpcPost(srv.baseUrl, 'bots.update', { botId: created2.bot.id, patch: { paused: false } });
    assert.equal(unpauseRpc.status, 200);
    assert.equal(unpauseRpc.body.ok, true);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(wakes.length, 1);
    assert.equal(mockWake.prompted.filter((p) => String(p.requestId || '').startsWith('bot-item-mail-')).length, 0);

    // Direct botsService.updateBot unpause must also honor custom wakeBot without calling sendOwedMail
    await wakeRt.botsService.updateBot(created2.bot.id, { paused: true });
    wakeRt.itemsStore.ownerComment(item2.uid, { text: 'Wake via custom reconciler on direct unpause', requestId: 'u-2' });
    await wakeRt.botsService.updateBot(created2.bot.id, { paused: false });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(wakes.length, 2);
    assert.equal(mockWake.prompted.filter((p) => String(p.requestId || '').startsWith('bot-item-mail-')).length, 0);
  });
});

test('agent/created resume prunes persisted closed-item & duplicate mail, and listChats deduplicates bot_work against worker chats', async () => {
  const { createBotsRuntime } = await importBots('runtime.js');

  await withTempDir('stale-mail-and-worker-dedupe', async ({ root, onClose }) => {
    const dshHome = path.join(root, 'dsh-home');
    fs.mkdirSync(dshHome, { recursive: true });

    const { ctx, controller } = createMockHarness();
    const rt = createBotsRuntime({ ctx, dshHome, enableSchedulers: false, getController: () => controller });
    onClose(() => rt.close());
    await rt.recoveryPromise;

    const created = await rt.botsService.createBot({ name: 'Claude Duts', skipKickoff: true });
    const botId = created.bot.id;
    const homeSid = created.sessionId;

    // 1. Seed canceled Item #1 + open Item #2, then simulate an agent resuming from disk with persisted stale & duplicate mail
    const closedItem = rt.itemsStore.add({
      ownerBotId: botId,
      chatId: homeSid,
      source: { kind: 'home', title: null },
      title: '反思提案：汇报先状态一句话',
      status: 'needs_you',
    }, { kind: 'orca', why: 'tidy_up_reflection' }).item;
    rt.itemsStore.set(closedItem.uid, { status: 'canceled', reason: '忽略此类建议' }, { kind: 'bot', botId, chatId: homeSid });

    const openItem = rt.itemsStore.add({
      ownerBotId: botId,
      chatId: homeSid,
      source: { kind: 'home', title: null },
      title: '持续跟进项',
      status: 'working',
    }, { kind: 'bot', botId, chatId: homeSid }).item;

    const resumedQueue = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `legacy-canceled-${i + 5}`,
        role: 'user',
        source: { kind: 'user', rpcId: `bot-item-mail-${i + 5}` },
        content: [{
          type: 'text',
          text: `[WhaleIsle: Work Item update]\nItem: #${closedItem.number} "反思提案：汇报先状态一句话" (canceled)\n- Owner commented: 忽略此类建议\nReview the item update and continue or reply on the Work Item as needed.`,
        }],
      })),
      {
        id: 'dup-open-old',
        role: 'user',
        source: { kind: 'dsh-bots:mail', itemUid: openItem.uid },
        content: [{ type: 'text', text: `[WhaleIsle: Work Item update]\nItem: #${openItem.number} "持续跟进项" (working)\n- Owner commented: old` }],
      },
      {
        id: 'dup-open-new',
        role: 'user',
        source: { kind: 'dsh-bots:mail', itemUid: openItem.uid },
        content: [{ type: 'text', text: `[WhaleIsle: Work Item update]\nItem: #${openItem.number} "持续跟进项" (working)\n- Owner commented: newest` }],
      },
      {
        id: 'real-owner-msg',
        role: 'user',
        source: { kind: 'user', rpcId: 'user-msg-1' },
        content: [{ type: 'text', text: '帮我看一下最新进展' }],
      },
    ];
    const resumedAgent = {
      id: homeSid,
      inbox: {
        nextTurn: resumedQueue,
        remove(id) {
          const idx = this.nextTurn.findIndex((m) => m.id === id);
          if (idx < 0) return false;
          this.nextTurn.splice(idx, 1);
          return true;
        },
      },
      followup: async () => {},
    };

    ctx.emit('agent/created', { agent: resumedAgent, source: 'resume' });
    assert.deepEqual(
      resumedAgent.inbox.nextTurn.map((m) => m.id),
      ['dup-open-new', 'real-owner-msg'],
      'agent/created must prune all 6 persisted canceled-item notices and collapse duplicate open-item mail while preserving owner messages',
    );

    // 2. Legacy unlinked worker chat + bot_work created 2.8s apart (exact Claude Duts DB shape) must dedupe into ONE titled worker chat
    const baseTs = 1795334951372;
    rt.botsStore.upsertChat({
      sessionId: 'bot-chat-legacy-worker',
      botId,
      kind: 'worker',
      origin: 'work',
      title: 'ChisaBot 仓库摸底（只读）',
      createdAt: baseTs,
      updatedAt: baseTs + 10_000,
    }, baseTs);
    const legacyWork = rt.workStore.startWork({
      botId,
      source: 'app',
      externalId: homeSid,
      taskId: 'task-2876d023-f5b',
      dispatchId: 'disp-7aa4f809-fde',
    }, baseTs + 2814);
    rt.workStore.closeWork(legacyWork.id, { reason: 'owner_reset', now: baseTs + 50_000 });

    // 3. Explicitly linked running worker chat (new bot_work_start shape) must also appear ONCE with running metadata
    const activeWorkId = 'work-explicit-active';
    rt.botsStore.upsertChat({
      sessionId: 'bot-chat-explicit-worker',
      botId,
      kind: 'worker',
      origin: 'work',
      title: '重构队列模块',
      workId: activeWorkId,
      dispatchId: 'disp-explicit-1',
      taskId: 'task-explicit-1',
      createdAt: baseTs + 100_000,
      updatedAt: baseTs + 100_000,
    }, baseTs + 100_000);
    rt.workStore.startWork({
      id: activeWorkId,
      botId,
      source: 'app',
      externalId: homeSid,
      taskId: 'task-explicit-1',
      dispatchId: 'disp-explicit-1',
    }, baseTs + 100_500);

    // 4. Orphan closed bot_work tombstone (worker chat deleted) must NOT leak as an unclickable raw task-xxxx row
    const orphanWork = rt.workStore.startWork({
      botId,
      source: 'app',
      externalId: homeSid,
      taskId: 'task-orphan-9999',
      dispatchId: 'disp-orphan-9999',
    }, baseTs + 900_000);
    rt.workStore.closeWork(orphanWork.id, { reason: 'task_gone', now: baseTs + 901_000 });

    const tree = rt.sessionRuntime.buildChatTree(botId);
    const homeRow = tree.chats.find((c) => c.origin === 'home');
    const legacyWorkerRow = tree.chats.find((c) => c.sessionId === 'bot-chat-legacy-worker');
    const explicitWorkerRow = tree.chats.find((c) => c.sessionId === 'bot-chat-explicit-worker');
    assert.ok(homeRow && legacyWorkerRow && explicitWorkerRow);
    assert.equal(homeRow.running.length, 0, 'open worker chat must not duplicate into homeRow.running');
    assert.equal(homeRow.finished.length, 0, 'paired legacy worker and orphan closed tombstone must not duplicate into homeRow.finished');
    assert.equal(legacyWorkerRow.title, 'ChisaBot 仓库摸底（只读）');
    assert.equal(legacyWorkerRow.workState, 'done');
    assert.equal(legacyWorkerRow.taskId, 'task-2876d023-f5b');
    assert.equal(explicitWorkerRow.workState, 'running');
    assert.equal(explicitWorkerRow.workId, activeWorkId);
    assert.equal(explicitWorkerRow.live, 'replying');

    // 5. Deleting a running worker chat stops its linked bot_work row too
    await rt.sessionRuntime.deleteChat(botId, 'bot-chat-explicit-worker');
    const stoppedWork = rt.workStore.getWorkById(activeWorkId);
    assert.ok(stoppedWork?.closedAt, 'deleteChat on a worker chat must close its linked bot_work row');
    const treeAfterDelete = rt.sessionRuntime.buildChatTree(botId);
    const homeAfterDelete = treeAfterDelete.chats.find((c) => c.origin === 'home');
    assert.equal(homeAfterDelete.running.length, 0);
    assert.equal(homeAfterDelete.finished.length, 0, 'deleted worker chat must not leave a ghost task-xxxx row under Home Chat');
  });
});
