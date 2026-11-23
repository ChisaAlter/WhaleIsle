'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

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

    // Cross-boundary tools still require desktop confirm and fail closed when declined
    const desktopGuardedCalls = [
      ['bot_tools_manage', { action: 'add', server: { name: 'mcp1', url: 'https://example.com' } }, 'add', 'code'],
      ['bot_reply', { text: 'External reply' }, 'reply', 'external'],
    ];
    for (const [name, args, expAction, expEffect] of desktopGuardedCalls) {
      const res = await byName.get(name).execute(args, execCtx);
      assert.equal(res.ok, false, `${name} must fail closed when declined`);
      const last = confirmCalls.at(-1);
      assert.deepEqual(last, { tool: name, action: expAction, effect: expEffect });
    }
    assert.equal(runtime.botsService.toolsList(bot.id).servers.length, 0);

    // Non-owner IM turn stays blocked for Harness-governed/local bot tools without desktop prompts
    const secondBot = await runtime.botsService.createBot({ name: 'Helper', skipKickoff: true });
    const harnessGovernedCalls = [
      ['bot_work_start', { cwd: root, prompt: 'Run tests' }],
      ['bot_send', { toBotId: secondBot.bot.id, purpose: 'question', text: 'Status?' }],
      ['bot_automation_create', { action: 'create', name: 'Job', prompt: 'Check' }],
      ['bot_new_chat', { title: 'Side topic' }],
    ];
    const confirmCountBefore = confirmCalls.length;
    for (const [name, args] of harnessGovernedCalls) {
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
    assert.equal(runtime.workStore.listWork({ botId: bot.id }).length, 1);
    assert.equal(runtime.automationsService.list({ botId: bot.id }).length, 1);

    // When desktop confirm approves, cross-boundary tools execute cleanly
    allowConfirm = true;
    const replyOk = await byName.get('bot_reply').execute({ text: 'External reply' }, execCtx);
    assert.equal(replyOk.ok, true);
    const toolAddOk = await byName.get('bot_tools_manage').execute({ action: 'add', server: { name: 'mcp1', url: 'https://example.com' } }, execCtx);
    assert.equal(toolAddOk.ok, true);
    assert.equal(runtime.botsService.toolsList(bot.id).servers.length, 1);

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
    lazyMock.ctx.connection = { requestRejection: () => undefined };
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
