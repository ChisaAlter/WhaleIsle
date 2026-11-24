'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BOTS_LIB_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/lib/bots');
const PRESET_LIB = path.resolve(__dirname, '../../vendor/dsh-whale/lib/preset.js');

function importBots(filename) {
  return import(pathToFileURL(path.join(BOTS_LIB_DIR, filename)).href);
}

async function withTempDir(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `whale-bots-w2a-${prefix}-`));
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

function createMockRuntimeHarness(root, { turnBehavior = null } = {}) {
  const sessions = new Map();
  const createdSpecs = [];
  const turns = [];
  const toolErrors = [];
  const petNotes = [];
  const events = [];

  const controller = {
    async list(_req, signal) {
      signal?.throwIfAborted?.();
      return [...sessions.values()];
    },
    async create(spec, signal) {
      signal?.throwIfAborted?.();
      createdSpecs.push(spec);
      const row = { sessionId: spec.sessionId, id: spec.sessionId, cwd: spec.cwd, agentPreset: spec.agentPreset, presentation: spec.presentation };
      sessions.set(spec.sessionId, row);
      return row;
    },
    async setPresentation({ sessionId, presentation }) {
      const row = sessions.get(sessionId);
      if (row) row.presentation = presentation;
    },
    async selectModel(spec) { return { selected: spec }; },
    async prompt() { return { ok: true }; },
    async runTurnForTest(sessionId, promptText) {
      turns.push({ sessionId, promptText });
      if (typeof turnBehavior === 'function') {
        return turnBehavior(sessionId, promptText);
      }
      return { ok: true, reply: `Turn OK (${sessionId}): ${promptText.slice(0, 60)}` };
    },
  };

  return { sessions, createdSpecs, turns, toolErrors, petNotes, events, controller };
}

async function buildTestRuntime(root, onClose, opts = {}) {
  const { openBotsDatabase } = await importBots('db.js');
  const { createItemsStore } = await importBots('items-store.js');
  const { createWorkStore } = await importBots('work-store.js');
  const { createMemoryService } = await importBots('memory-service.js');
  const { createSessionRuntime } = await importBots('session-runtime.js');
  const { createBotsService } = await importBots('service.js');
  const { createAutomationsService } = await importBots('automations-service.js');
  const { createGroupsStore } = await importBots('groups-store.js');
  const { botMetaDir } = await importBots('fs-home.js');

  const dshHome = path.join(root, 'dsh-home');
  fs.mkdirSync(dshHome, { recursive: true });
  const dbHandle = openBotsDatabase({ dshHome });
  const { db, bots: botsStore } = dbHandle;
  const itemsStore = createItemsStore(db);
  const groupsStore = createGroupsStore(db);
  const workStore = createWorkStore(db);
  const memoryService = createMemoryService({ metaRoot: botMetaDir(dshHome), db });
  const mock = createMockRuntimeHarness(root, { turnBehavior: opts.turnBehavior });
  const eventBus = { emit: (ev) => mock.events.push(ev), close: () => {} };

  const sessionRuntime = createSessionRuntime({
    ctx: null,
    dshHome,
    botsStore,
    itemsStore,
    workStore,
    eventBus,
    getController: () => mock.controller,
  });
  const botsService = createBotsService({
    ctx: null,
    dshHome,
    db,
    botsStore,
    itemsStore,
    groupsStore,
    workStore,
    memoryService,
    sessionRuntime,
    eventBus,
  });
  const automationsService = createAutomationsService({
    botsStore,
    workStore,
    sessionRuntime,
    eventBus,
    itemsStore,
    enableScheduler: false,
    enableFolderWatcher: opts.enableFolderWatcher ?? false,
    watchFactory: opts.watchFactory,
    folderDebounceMs: opts.folderDebounceMs,
    budgetGuard: opts.budgetGuard,
    imOutboundBridge: opts.imOutboundBridge,
    notifyPet: (kind, text) => mock.petNotes.push({ kind, text }),
  });

  const runtime = {
    dshHome,
    dbHandle,
    db,
    botsStore,
    itemsStore,
    groupsStore,
    workStore,
    memoryService,
    sessionRuntime,
    botsService,
    automationsService,
    eventBus,
    legacyCompat: { notifyPet: (kind, text) => mock.petNotes.push({ kind, text }) },
    onToolError: (err) => mock.toolErrors.push(err),
    imOutboundBridge: opts.imOutboundBridge ?? null,
    mock,
  };

  onClose(() => {
    automationsService.close();
    sessionRuntime.close();
    dbHandle.close();
  });
  return runtime;
}

function initTempGitRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@whaleisle.local'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Whale Test'], { cwd: repoDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# test repo\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir, stdio: 'ignore' });
}

test('cron-rrule: 5-field Cron, RRule, timezone conversion, macros, and missed-slot coalescing', async () => {
  const {
    parseCronExpression,
    parseRRuleExpression,
    parseScheduleExpression,
    computeNextScheduleAt,
    collectDueScheduleSlots,
  } = await importBots('cron-rrule.js');

  // 1. Standard 5-field cron (UTC)
  const baseUtc = Date.UTC(2026, 10, 22, 8, 5, 0); // Sun 2026-11-22 08:05 UTC
  const nextQuarter = computeNextScheduleAt('*/15 * * * *', { afterMs: baseUtc, timezone: 'UTC' });
  assert.equal(nextQuarter, Date.UTC(2026, 10, 22, 8, 15, 0));

  // Weekday cron skips Sunday to Monday
  const nextWeekday = computeNextScheduleAt('30 9 * * 1-5', { afterMs: baseUtc, timezone: 'UTC' });
  assert.equal(nextWeekday, Date.UTC(2026, 10, 23, 9, 30, 0));

  // Sunday as 7 and macro @daily
  assert.equal(parseCronExpression('0 12 * * 7').dow.has(0), true);
  assert.equal(computeNextScheduleAt('@daily', { afterMs: baseUtc, timezone: 'UTC' }), Date.UTC(2026, 10, 23, 0, 0, 0));

  // 2. Timezone (Asia/Shanghai = UTC+8): 09:00 CST = 01:00 UTC
  const beforeShanghai9 = Date.UTC(2026, 10, 23, 0, 30, 0); // 08:30 CST Monday
  const shanghai9 = computeNextScheduleAt('0 9 * * MON-FRI', { afterMs: beforeShanghai9, timezone: 'Asia/Shanghai' });
  assert.equal(shanghai9, Date.UTC(2026, 10, 23, 1, 0, 0));

  // 3. RRule (FREQ/INTERVAL/BYDAY/BYHOUR/BYMINUTE + UNTIL)
  const parsedRr = parseRRuleExpression('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=10;BYMINUTE=15');
  assert.equal(parsedRr.freq, 'WEEKLY');
  assert.equal(parsedRr.byDay.has(1) && parsedRr.byDay.has(3) && parsedRr.byDay.has(5), true);

  const nextRr = computeNextScheduleAt(parsedRr, { afterMs: baseUtc, timezone: 'UTC' });
  assert.equal(nextRr, Date.UTC(2026, 10, 23, 10, 15, 0)); // Mon 10:15 UTC

  const dailyEvery2 = computeNextScheduleAt('FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0', {
    afterMs: Date.UTC(2026, 10, 22, 9, 0, 0),
    anchorMs: Date.UTC(2026, 10, 22, 9, 0, 0),
    timezone: 'UTC',
  });
  assert.equal(dailyEvery2, Date.UTC(2026, 10, 24, 9, 0, 0));

  const pastUntil = computeNextScheduleAt('FREQ=DAILY;BYHOUR=9;BYMINUTE=0;UNTIL=20261122T080000Z', {
    afterMs: baseUtc,
    timezone: 'UTC',
  });
  assert.equal(pastUntil, null);

  assert.throws(() => parseScheduleExpression('invalid cron'));
  assert.throws(() => parseRRuleExpression('FREQ=SECONDLY'));

  // 4. Missed-slot coalescing (sleep 09:00..12:30 on hourly cron -> 4 missed slots coalesced into 12:00)
  const coalesced = collectDueScheduleSlots({
    schedule: '0 * * * *',
    timezone: 'UTC',
    dueAt: Date.UTC(2026, 10, 22, 9, 0, 0),
    nowMs: Date.UTC(2026, 10, 22, 12, 30, 0),
  });
  assert.equal(coalesced.coalescedCount, 4);
  assert.equal(coalesced.slotAt, Date.UTC(2026, 10, 22, 12, 0, 0));
  assert.equal(coalesced.nextRunAt, Date.UTC(2026, 10, 22, 13, 0, 0));

  // Interval coalescing
  const intCoalesced = collectDueScheduleSlots({
    intervalMinutes: 30,
    dueAt: 1_000_000,
    nowMs: 1_000_000 + 3 * 30 * 60_000 + 5_000,
  });
  assert.equal(intCoalesced.coalescedCount, 4);
  assert.equal(intCoalesced.slotAt, 1_000_000 + 3 * 30 * 60_000);
  assert.equal(intCoalesced.nextRunAt, 1_000_000 + 4 * 30 * 60_000);
});

test('automations-service: claim deduplication, startup interrupted recovery, sleep coalescing, budgetGuard, webhook & resultsTo', async () => {
  const { createAutomationsService } = await importBots('automations-service.js');

  await withTempDir('automations', async ({ root, onClose }) => {
    let budgetDecision = { allowed: true };
    const imDeliveries = [];
    const rt = await buildTestRuntime(root, onClose, {
      budgetGuard: async (ctx) => (typeof budgetDecision === 'function' ? budgetDecision(ctx) : budgetDecision),
      imOutboundBridge: {
        async sendText(msg) {
          imDeliveries.push(msg);
          return { ok: true, delivered: true, channel: msg.channel, messageId: `im-msg-${imDeliveries.length}` };
        },
      },
    });
    const createdBot = await rt.botsService.createBot({ name: 'OpsCaptain', skipKickoff: true });
    const bot = createdBot.bot;

    // 1. Pre-seed stale claimed & running automation claims, then construct a fresh service to verify startup recovery
    const c1 = rt.workStore.claimAutomationSlot({ automationId: 'auto-stale', botId: bot.id, slotAt: 1000, triggerKind: 'schedule' }, 1000);
    const c2 = rt.workStore.claimAutomationSlot({ automationId: 'auto-stale', botId: bot.id, slotAt: 2000, triggerKind: 'schedule' }, 2000);
    rt.workStore.updateAutomationClaim(c2.claim.claimId, { status: 'running' }, 2001);

    const recoveredSvc = createAutomationsService({
      botsStore: rt.botsStore,
      workStore: rt.workStore,
      sessionRuntime: rt.sessionRuntime,
      eventBus: rt.eventBus,
      itemsStore: rt.itemsStore,
      enableScheduler: false,
      enableFolderWatcher: false,
    });
    onClose(() => recoveredSvc.close());
    assert.equal(recoveredSvc.getStartupRecovery().count, 2);
    assert.equal(rt.workStore.getAutomationClaim(c1.claim.claimId).status, 'interrupted');
    assert.equal(rt.workStore.getAutomationClaim(c2.claim.claimId).status, 'interrupted');

    // 2. Claim-before-dispatch prevents duplicate execution of the exact same slotAt
    const hourly = rt.automationsService.create({
      botId: bot.id,
      name: 'Hourly Digest',
      prompt: 'Summarize system health',
      schedule: '0 * * * *',
      timezone: 'UTC',
      resultsTo: 'item',
    }, Date.UTC(2026, 10, 22, 8, 10, 0));
    assert.equal(hourly.nextRunAt, Date.UTC(2026, 10, 22, 9, 0, 0));

    const firstSlot = await rt.automationsService.runNow(hourly.id, {
      now: Date.UTC(2026, 10, 22, 9, 0, 0),
      triggerKind: 'schedule',
      slotAt: Date.UTC(2026, 10, 22, 9, 0, 0),
    });
    assert.equal(firstSlot.ok, true);
    assert.equal(firstSlot.routed.kind, 'item');
    assert.ok(firstSlot.routed.itemUid);

    const dupSlot = await rt.automationsService.runNow(hourly.id, {
      now: Date.UTC(2026, 10, 22, 9, 0, 5),
      triggerKind: 'schedule',
      slotAt: Date.UTC(2026, 10, 22, 9, 0, 0),
    });
    assert.equal(dupSlot.deduplicated, true);
    assert.equal(dupSlot.alreadyClaimed, true);

    // 3. Sleep coalescing: nextRunAt is 10:00, wake up at 13:20 -> 4 missed slots (10, 11, 12, 13) run ONCE with coalescedCount=4
    const turnsBefore = rt.mock.turns.length;
    const tickRes = await rt.automationsService.tick(Date.UTC(2026, 10, 22, 13, 20, 0));
    assert.equal(tickRes.length, 1);
    assert.equal(tickRes[0].ok, true);
    assert.equal(tickRes[0].coalescedCount, 4);
    assert.equal(rt.mock.turns.length, turnsBefore + 1);
    assert.match(rt.mock.turns.at(-1).promptText, /Coalesced 4 missed scheduled slots/);
    const updatedHourly = rt.workStore.getAutomation(hourly.id);
    assert.equal(updatedHourly.nextRunAt, Date.UTC(2026, 10, 22, 14, 0, 0));

    // 4. BudgetGuard blocks & defers off_peak_only automation -> status = skipped_budget
    const deferUntil = Date.UTC(2026, 10, 22, 18, 0, 0);
    budgetDecision = { allowed: false, reason: 'off_peak_only', offPeakDeferred: true, deferUntilMs: deferUntil };
    const turnsBeforeBudget = rt.mock.turns.length;
    const skipped = await rt.automationsService.tick(Date.UTC(2026, 10, 22, 14, 5, 0));
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].skipped, true);
    assert.equal(skipped[0].reason, 'skipped_budget');
    assert.equal(skipped[0].deferUntilMs, deferUntil);
    assert.equal(rt.mock.turns.length, turnsBeforeBudget);
    assert.equal(rt.workStore.getAutomationClaim(skipped[0].claimId).status, 'skipped_budget');
    assert.equal(rt.workStore.getAutomation(hourly.id).nextRunAt, deferUntil);

    // 5. Webhook trigger + resultsTo IM bridge
    budgetDecision = { allowed: true };
    const hookAuto = rt.automationsService.create({
      botId: bot.id,
      name: 'Deploy Hook',
      prompt: 'Inspect deploy event',
      triggers: [{ kind: 'webhook', webhookId: 'wh-deploy' }],
      resultsTo: { kind: 'im', channel: 'feishu', chatId: 'oc_123' },
    });
    const whRes = await rt.automationsService.triggerWebhook({
      botId: bot.id,
      webhookId: 'wh-deploy',
      eventId: 'evt-99',
      payload: { sha: 'abc123' },
    });
    assert.equal(whRes.matched, 1);
    assert.equal(whRes.dispatches[0].ok, true);
    assert.equal(whRes.dispatches[0].triggerKind, 'webhook');
    assert.match(rt.mock.turns.at(-1).promptText, /<webhook_trigger untrusted="true"/);
    assert.equal(imDeliveries.length, 1);
    assert.equal(imDeliveries[0].channel, 'feishu');
  });
});

test('folder-watcher: debounces bursts, ignores .git and node_modules, syncs & closes cleanly', async () => {
  const { createFolderWatcher, shouldIgnoreWatchedPath } = await importBots('folder-watcher.js');

  assert.equal(shouldIgnoreWatchedPath('.git/HEAD'), true);
  assert.equal(shouldIgnoreWatchedPath('packages/a/.git/index'), true);
  assert.equal(shouldIgnoreWatchedPath('node_modules/foo/bar.js'), true);
  assert.equal(shouldIgnoreWatchedPath('src\\node_modules\\x.js'), true);
  assert.equal(shouldIgnoreWatchedPath('src/index.js'), false);

  await withTempDir('folder-watch', async ({ root, onClose }) => {
    const watchDir = path.join(root, 'watched');
    fs.mkdirSync(watchDir, { recursive: true });

    const watchers = [];
    const watchFactory = (targetPath, _opts, listener) => {
      const handle = {
        targetPath,
        listener,
        closed: false,
        on() {},
        close() { this.closed = true; },
      };
      watchers.push(handle);
      return handle;
    };

    const fired = [];
    const fw = createFolderWatcher({
      debounceMs: 40,
      watchFactory,
      onChange: (ev) => fired.push(ev),
    });
    onClose(() => fw.close());

    fw.syncWatches([
      { id: 'auto-1', botId: 'bot-1', enabled: true, triggers: [{ kind: 'folder', path: watchDir }] },
      { id: 'auto-off', botId: 'bot-1', enabled: false, triggers: [{ kind: 'folder', path: watchDir }] },
    ]);
    assert.equal(watchers.length, 1);
    assert.deepEqual(fw.listWatches()[0].automationIds, ['auto-1']);

    // Ignored paths produce 0 events
    watchers[0].listener('change', '.git/COMMIT_EDITMSG');
    watchers[0].listener('change', 'node_modules/lodash/index.js');
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(fired.length, 0);

    // Burst of 3 real changes coalesces into 1 debounced event
    watchers[0].listener('change', 'src/a.js');
    watchers[0].listener('change', 'src/b.js');
    watchers[0].listener('rename', 'src/a.js');
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(fired.length, 1);
    assert.equal(fired[0].automationId, 'auto-1');
    assert.deepEqual(fired[0].changedPaths.sort(), ['src/a.js', 'src/b.js']);

    // Removing automation closes the underlying watcher
    fw.syncWatches([]);
    assert.equal(watchers[0].closed, true);
    assert.equal(fw.listWatches().length, 0);
  });
});

test('tool-wal: intent -> committed idempotency, failure tracking, and crash-orphan UNKNOWN no-replay guard', async () => {
  const { createToolWalManager } = await importBots('tool-wal.js');

  await withTempDir('tool-wal', async ({ root, onClose }) => {
    const rt = await buildTestRuntime(root, onClose);
    const wal = createToolWalManager({ workStore: rt.workStore });

    // 1. First execution commits; second with same idempotencyKey deduplicates without re-running fn
    let execCount = 0;
    const first = await wal.executeWithWal({
      botId: 'bot-1',
      sessionId: 'sess-1',
      toolName: 'bot_reply',
      action: 'reply',
      effect: 'external',
      idempotencyKey: 'reply-key-1',
      args: { text: 'Hello' },
    }, async () => {
      execCount += 1;
      return { delivered: true };
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, 'committed');
    assert.equal(execCount, 1);

    const second = await wal.executeWithWal({
      botId: 'bot-1',
      sessionId: 'sess-1',
      toolName: 'bot_reply',
      action: 'reply',
      effect: 'external',
      idempotencyKey: 'reply-key-1',
      args: { text: 'Hello' },
    }, async () => {
      execCount += 1;
      return { delivered: true };
    });
    assert.equal(second.ok, true);
    assert.equal(second.deduplicated, true);
    assert.equal(second.status, 'committed');
    assert.equal(execCount, 1);

    // 2. Simulate crash leaving an unresolved `intent` -> recovery marks `unknown`, retry MUST NOT replay
    const crashIntent = wal.beginIntent({
      botId: 'bot-1',
      sessionId: 'sess-1',
      toolName: 'bot_reply',
      action: 'reply',
      effect: 'external',
      idempotencyKey: 'reply-crash-1',
      args: { text: 'Critical wire transfer' },
    });
    assert.equal(crashIntent.entry.status, 'intent');

    const recovered = wal.recoverStaleIntents();
    assert.equal(recovered.count, 1);
    assert.equal(wal.get(crashIntent.entry.walId).status, 'unknown');

    let replayed = false;
    const blocked = await wal.executeWithWal({
      botId: 'bot-1',
      sessionId: 'sess-1',
      toolName: 'bot_reply',
      action: 'reply',
      effect: 'external',
      idempotencyKey: 'reply-crash-1',
      args: { text: 'Critical wire transfer' },
    }, async () => {
      replayed = true;
      return { delivered: true };
    });
    assert.equal(replayed, false);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.replayBlocked, true);
    assert.equal(blocked.status, 'UNKNOWN');

    // 3. Failure resolves status = failed and blocks silent replay on same key
    const failed = await wal.executeWithWal({
      botId: 'bot-1',
      sessionId: 'sess-1',
      toolName: 'bot_reply',
      action: 'reply',
      effect: 'external',
      idempotencyKey: 'reply-fail-1',
      args: { text: 'Oops' },
    }, async () => {
      throw new Error('network down');
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.status, 'failed');
    assert.equal(wal.get(failed.walId).status, 'failed');
  });
});

test('worktree-runner: real Git worktree isolation, concurrency limit (<=3), verification command, and cleanup', async () => {
  const { createWorktreeRunner, BOT_WORKER_MAX_CONCURRENCY } = await importBots('worktree-runner.js');
  const { botMetaDir } = await importBots('fs-home.js');

  assert.equal(BOT_WORKER_MAX_CONCURRENCY, 3);

  await withTempDir('worktree', async ({ root, onClose }) => {
    const rt = await buildTestRuntime(root, onClose);
    const repoDir = path.join(root, 'sample-repo');
    initTempGitRepo(repoDir);

    const runner = createWorktreeRunner({
      metaRoot: botMetaDir(rt.dshHome),
      workStore: rt.workStore,
    });
    onClose(() => runner.cleanupAll());

    const detected = await runner.detectGitRepository(repoDir);
    assert.equal(detected.isGitRepo, true);
    assert.ok(detected.headSha);

    // Prepare isolated worktree
    const prepared = await runner.prepareWorkerCwd({
      botId: 'bot-wt',
      cwd: repoDir,
      dispatchId: 'disp-wt-1',
      useWorktree: true,
    });
    assert.equal(prepared.isolatedWorktree, true);
    assert.ok(fs.existsSync(path.join(prepared.cwd, 'README.md')));
    assert.notEqual(path.resolve(prepared.cwd), path.resolve(repoDir));

    // Real verify command pass & fail
    const okVerify = await runner.verifyWorkerResult(`"${process.execPath}" -e "console.log('verify-ok')"`, { cwd: prepared.cwd });
    assert.equal(okVerify.ok, true);
    assert.equal(okVerify.exitCode, 0);
    assert.match(okVerify.tail, /verify-ok/);

    const badVerify = await runner.verifyWorkerResult(`"${process.execPath}" -e "console.error('verify-boom'); process.exit(2)"`, { cwd: prepared.cwd });
    assert.equal(badVerify.ok, false);
    assert.equal(badVerify.exitCode, 2);
    assert.match(badVerify.tail, /verify-boom/);

    // Cleanup removes worktree directory
    const cleaned = await runner.cleanupWorktree('disp-wt-1');
    assert.equal(cleaned.removed, true);
    assert.equal(fs.existsSync(prepared.cwd), false);

    // Per-bot concurrency cap (3 open workers allowed, 4th rejected)
    for (let i = 1; i <= 3; i += 1) {
      rt.workStore.startWork({
        botId: 'bot-wt',
        source: 'app',
        externalId: `sess-${i}`,
        taskId: `task-${i}`,
        dispatchId: `disp-c-${i}`,
      });
    }
    await assert.rejects(
      () => runner.prepareWorkerCwd({ botId: 'bot-wt', cwd: repoDir, dispatchId: 'disp-c-4', useWorktree: false }),
      (err) => err.code === 'worker_concurrency_exceeded',
    );
  });
});

test('bot-tools-registry & plugins: dsh-bot-worker empirical verify/needs_you, bot_reply WAL/honest delivery, new tools, worker stripping & read-only enforcement', async () => {
  const {
    buildBotToolDefinitions,
    registerBotTools,
    registerWorkerTools,
    WORKER_ALLOWED_TOOLS,
  } = await importBots('bot-tools-registry.js');
  const { readDecisionTsv } = await importBots('fs-home.js');
  const { BOT_WORKER_PRESET_ID } = await import(pathToFileURL(PRESET_LIB).href);

  // Verify plugin entrypoints stay strictly isolated (no legacy whale_* tool imports)
  const botPluginSrc = fs.readFileSync(path.join(BOTS_LIB_DIR, 'bot-tools-plugin.js'), 'utf8');
  assert.match(botPluginSrc, /registerBotTools/);
  assert.equal(/from\s+['"]\.\.\/tools\.js['"]/.test(botPluginSrc), false);
  const workerPluginSrc = fs.readFileSync(path.join(BOTS_LIB_DIR, 'worker-tools-plugin.js'), 'utf8');
  assert.match(workerPluginSrc, /registerWorkerTools/);
  assert.equal(workerPluginSrc.includes('registerBotTools'), false);

  await withTempDir('tools-full', async ({ root, onClose }) => {
    const imSent = [];
    let activeBridge = null;
    const rt = await buildTestRuntime(root, onClose, {
      turnBehavior: async (sessionId, promptText) => {
        if (promptText.includes('FAIL_SEND_TARGET')) return { ok: false, error: 'target-crashed', reply: '' };
        return { ok: true, reply: `Done ${sessionId}` };
      },
    });
    const repoDir = path.join(root, 'worker-repo');
    initTempGitRepo(repoDir);

    const created = await rt.botsService.createBot({ name: 'Captain', skipKickoff: true });
    const bot = created.bot;
    const sid = created.sessionId;
    const peer = await rt.botsService.createBot({ name: 'Deckhand', skipKickoff: true });
    const execCtx = { agent: { id: sid, session: { id: sid } } };

    // 1. Plugin tool registration isolation:
    // bot-tools registers ONLY bot_* (25 tools, 0 whale_*); worker-tools registers ONLY WORKER_ALLOWED_TOOLS (4 tools)
    const botToolNames = [];
    registerBotTools({ tools: { register: (t) => { botToolNames.push(t.name); return () => {}; } } }, { getRuntime: () => rt });
    assert.equal(botToolNames.length, 25);
    assert.equal(botToolNames.every((n) => n.startsWith('bot_')), true);
    assert.equal(botToolNames.some((n) => n.startsWith('whale_')), false);

    const workerToolNames = [];
    registerWorkerTools({ tools: { register: (t) => { workerToolNames.push(t.name); return () => {}; } } }, { getRuntime: () => rt });
    assert.deepEqual([...workerToolNames].sort(), [...WORKER_ALLOWED_TOOLS].sort());
    for (const forbidden of ['bot_reply', 'bot_send', 'bot_work_start', 'bot_tools_manage', 'bot_automation_create', 'bot_crew_adopt', 'bot_new_chat']) {
      assert.equal(workerToolNames.includes(forbidden), false, `Worker must strip ${forbidden}`);
    }

    const defs = buildBotToolDefinitions(() => rt, {
      confirmAction: async () => ({ ok: true }),
      imOutboundBridge: {
        async sendText(msg) {
          if (!activeBridge) return activeBridge;
          return activeBridge(msg);
        },
      },
    });
    const byName = new Map(defs.map((d) => [d.name, d]));

    // 2. bot_work_start with Git worktree + empirical verifyCmd PASS -> writes decisions TSV, uses dsh-bot-worker preset
    const passItem = rt.itemsStore.add({
      ownerBotId: bot.id, chatId: sid, source: { kind: 'home', title: null }, title: 'Ship feature A', status: 'planned',
    }, { kind: 'bot', botId: bot.id, chatId: sid }).item;

    const passRes = await byName.get('bot_work_start').execute({
      cwd: repoDir,
      prompt: 'Implement feature A',
      itemUid: passItem.uid,
      doneMeans: 'Verification script exits 0',
      verifyCmd: `"${process.execPath}" -e "console.log('tests passed')"`,
      awaitCompletion: true,
    }, execCtx);
    assert.equal(passRes.ok, true);
    const passPayload = JSON.parse(passRes.detail);
    assert.equal(passPayload.preset, BOT_WORKER_PRESET_ID);
    assert.equal(passPayload.isolatedWorktree, true);
    assert.equal(passPayload.passed, true);
    assert.equal(passPayload.exitCode, 0);
    assert.equal(fs.existsSync(passPayload.cwd), false, 'Ephemeral worktree must be reclaimed after completion');
    const passTsv = readDecisionTsv(bot.homePath, passItem.uid);
    assert.equal(passTsv.rows.length, 1);
    assert.equal(passTsv.rows[0].decision, 'verified');
    assert.equal(rt.itemsStore.get(passItem.uid).status, 'working');

    // 3. bot_work_start empirical verifyCmd FAIL -> writes failed TSV & automatically moves item to needs_you with exit code + evidence
    const failItem = rt.itemsStore.add({
      ownerBotId: bot.id, chatId: sid, source: { kind: 'home', title: null }, title: 'Fix regression B', status: 'planned',
    }, { kind: 'bot', botId: bot.id, chatId: sid }).item;

    const failRes = await byName.get('bot_work_start').execute({
      cwd: repoDir,
      prompt: 'Fix regression B',
      itemUid: failItem.uid,
      verifyCmd: `"${process.execPath}" -e "console.error('AssertionError: expected 1 got 2'); process.exit(3)"`,
      awaitCompletion: true,
    }, execCtx);
    assert.equal(failRes.ok, true);
    const failPayload = JSON.parse(failRes.detail);
    assert.equal(failPayload.passed, false);
    assert.equal(failPayload.exitCode, 3);
    assert.equal(rt.itemsStore.get(failItem.uid).status, 'needs_you');
    const failEvents = rt.itemsStore.events(failItem.uid).events;
    assert.ok(failEvents.some((e) => e.kind === 'commented' && /exitCode=3/.test(e.data?.text || '') && /AssertionError/.test(e.data?.text || '')));
    const failTsv = readDecisionTsv(bot.homePath, failItem.uid);
    assert.equal(failTsv.rows.length, 1);
    assert.equal(failTsv.rows[0].decision, 'failed');

    // 4. bot_reply honest delivery without bridge vs real IM bridge + WAL deduplication + crash UNKNOWN block
    const noBridgeDefs = buildBotToolDefinitions(() => rt, { confirmAction: async () => ({ ok: true }) });
    const noBridgeReply = noBridgeDefs.find((d) => d.name === 'bot_reply');
    const honestRes = await noBridgeReply.execute({ text: 'Hello external IM', channel: 'feishu' }, execCtx);
    assert.equal(honestRes.ok, true);
    const honestData = JSON.parse(honestRes.detail);
    assert.equal(honestData.delivered, false);
    assert.equal(honestData.reason, 'im_bridge_unavailable');

    activeBridge = async (msg) => {
      imSent.push(msg);
      return { ok: true, delivered: true, channel: msg.channel || 'feishu', messageId: `m-${imSent.length}` };
    };
    const imOk1 = await byName.get('bot_reply').execute({
      text: 'Real IM reply', channel: 'feishu', idempotencyKey: 'idem-im-1',
    }, execCtx);
    assert.equal(imOk1.ok, true);
    assert.equal(JSON.parse(imOk1.detail).delivered, true);
    assert.equal(imSent.length, 1);

    // Same idempotencyKey deduplicates without sending a second IM message
    const imOk2 = await byName.get('bot_reply').execute({
      text: 'Real IM reply', channel: 'feishu', idempotencyKey: 'idem-im-1',
    }, execCtx);
    assert.equal(imOk2.ok, true);
    assert.equal(JSON.parse(imOk2.detail).deduplicated, true);
    assert.equal(imSent.length, 1);

    // Stale unknown WAL entry blocks replay
    rt.workStore.appendToolWalIntent({
      botId: bot.id, sessionId: sid, toolName: 'bot_reply', action: 'reply', effect: 'external',
      idempotencyKey: 'idem-im-crash', argsDigest: 'deadbeef',
    });
    rt.workStore.markStaleToolWalUnknown();
    const imBlocked = await byName.get('bot_reply').execute({
      text: 'Crash retry', channel: 'feishu', idempotencyKey: 'idem-im-crash',
    }, execCtx);
    assert.equal(imBlocked.ok, false);
    assert.equal(JSON.parse(imBlocked.detail).status, 'UNKNOWN');
    assert.equal(imSent.length, 1);

    // 5. bot_send failure is recorded (never silently swallowed)
    const sendFail = await byName.get('bot_send').execute({
      toBotId: peer.bot.id, purpose: 'handoff', text: 'FAIL_SEND_TARGET please check', awaitReply: true,
    }, execCtx);
    assert.equal(sendFail.ok, true);
    const sendData = JSON.parse(sendFail.detail);
    assert.equal(sendData.delivery.ok, false);
    assert.equal(rt.workStore.getRequestOutcome(sendData.request.messageId).outcome, 'failed');
    assert.ok(rt.mock.toolErrors.some((e) => e.toolName === 'bot_send'));

    // 6. New tools: bot_memory_search, bot_decision_append, bot_crew_adopt
    await rt.botsService.memoryAdd(bot.id, { text: 'Always run eslint before merging PRs', date: '2026-11-20' });
    const memHit = await byName.get('bot_memory_search').execute({ query: 'eslint merging' }, execCtx);
    assert.equal(memHit.ok, true);
    assert.ok(JSON.parse(memHit.detail).results.some((r) => r.body.includes('eslint')));

    const decRes = await byName.get('bot_decision_append').execute({
      itemUid: `#${passItem.number}`, phase: 'review', decision: 'approved', evidence: 'PR #12 green',
    }, execCtx);
    assert.equal(decRes.ok, true);
    assert.equal(readDecisionTsv(bot.homePath, passItem.uid).rows.length, 2);

    const adoptRes = await byName.get('bot_crew_adopt').execute({
      action: 'adopt', sessionId: 'plain-sess-42', cwd: repoDir, title: 'Frontend refactor',
    }, execCtx);
    assert.equal(adoptRes.ok, true);
    assert.equal(rt.workStore.listCrewAdoptions({ botId: bot.id }).length, 1);
    const releaseRes = await byName.get('bot_crew_adopt').execute({ action: 'release', sessionId: 'plain-sess-42' }, execCtx);
    assert.equal(releaseRes.ok, true);
    assert.equal(rt.workStore.listCrewAdoptions({ botId: bot.id }).length, 0);

    // 7. permissionMode === 'read-only' allows read tools and blocks ALL write/dispatch/outbound tools
    rt.botsStore.updateBot(bot.id, { permissionMode: 'read-only' });

    const roList = await byName.get('bot_list').execute({}, execCtx);
    assert.equal(roList.ok, true);
    const roSearch = await byName.get('bot_memory_search').execute({ query: 'eslint' }, execCtx);
    assert.equal(roSearch.ok, true);
    const roMcpList = await byName.get('bot_tools_manage').execute({ action: 'list' }, execCtx);
    assert.equal(roMcpList.ok, true);
    const roCrewList = await byName.get('bot_crew_adopt').execute({ action: 'list' }, execCtx);
    assert.equal(roCrewList.ok, true);

    const roBlockedCalls = [
      ['bot_work_start', { cwd: repoDir, prompt: 'Edit code' }],
      ['bot_send', { toBotId: peer.bot.id, purpose: 'status', text: 'Hi' }],
      ['bot_reply', { text: 'External msg' }],
      ['bot_new_chat', { title: 'New chat' }],
      ['bot_automation_create', { action: 'create', name: 'Cron', prompt: 'Ping' }],
      ['bot_item_add', { title: 'Blocked item' }],
      ['bot_decision_append', { itemUid: passItem.uid, phase: 'review', decision: 'approved' }],
      ['bot_crew_adopt', { action: 'adopt', sessionId: 'plain-sess-99' }],
      ['bot_tools_manage', { action: 'add', server: { name: 'x', url: 'https://x.test' } }],
      ['bot_memory_forget', { fact: 'Always run eslint before merging PRs' }],
    ];
    for (const [toolName, args] of roBlockedCalls) {
      const blocked = await byName.get(toolName).execute(args, execCtx);
      assert.equal(blocked.ok, false, `read-only must block ${toolName}`);
      assert.match(blocked.detail, /read-only/);
    }
  });
});

test('Audit regressions [P1 #27/#28/#29]: long-gap RRule skip, folder-watcher recovery & self-write suppression, and non-destructive null clear', async () => {
  const { computeNextScheduleAt } = await importBots('cron-rrule.js');
  const { createFolderWatcher } = await importBots('folder-watcher.js');

  // [P1 #27] RRule without BYDAY/BYHOUR across >41.67 days (Jan 31 -> Mar 31, INTERVAL=2, DAILY;INTERVAL=60)
  const jan31 = Date.UTC(2026, 0, 31, 9, 15, 0);
  const nextMonthly31 = computeNextScheduleAt('FREQ=MONTHLY', { afterMs: jan31, anchorMs: jan31, timezone: 'Asia/Shanghai' });
  assert.equal(nextMonthly31, Date.UTC(2026, 2, 31, 9, 15, 0));

  const jan10 = Date.UTC(2026, 0, 10, 8, 30, 0);
  const nextBiMonthly = computeNextScheduleAt('FREQ=MONTHLY;INTERVAL=2', { afterMs: jan10, anchorMs: jan10, timezone: 'Asia/Shanghai' });
  assert.equal(nextBiMonthly, Date.UTC(2026, 2, 10, 8, 30, 0));

  const nextDaily60 = computeNextScheduleAt('FREQ=DAILY;INTERVAL=60', { afterMs: jan10, anchorMs: jan10, timezone: 'UTC' });
  assert.equal(nextDaily60, jan10 + 60 * 86_400_000);

  // [P1 #28] folder-watcher fallback try/catch, error cleanup + recreation, and self-write suppression
  await withTempDir('folder-regressions', async ({ root, onClose }) => {
    const watchDir = path.join(root, 'watched');
    fs.mkdirSync(watchDir, { recursive: true });

    const errors = [];
    let failFallback = true;
    const handles = [];
    const events = [];
    const fw = createFolderWatcher({
      debounceMs: 20,
      selfWriteSuppressMs: 120,
      onError: (err) => errors.push(err),
      onChange: (ev) => events.push(ev),
      watchFactory: (p, opts, listener) => {
        if (failFallback) {
          if (opts?.recursive) throw Object.assign(new Error('no recursive'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' });
          throw new Error('fallback also failed');
        }
        const listeners = {};
        const handle = {
          closed: false,
          listener,
          on(ev, fn) { listeners[ev] = fn; },
          emitError(err) { listeners.error?.(err); },
          close() { this.closed = true; },
        };
        handles.push(handle);
        return handle;
      },
    });
    onClose(() => fw.close());

    const subs = [{ id: 'a1', botId: 'b1', enabled: true, triggers: [{ kind: 'folder', path: watchDir }] }];
    assert.doesNotThrow(() => fw.syncWatches(subs));
    assert.equal(fw.listWatches().length, 0);
    assert.equal(errors.length, 1);

    failFallback = false;
    fw.syncWatches(subs);
    assert.equal(fw.listWatches().length, 1);
    assert.equal(handles.length, 1);

    // Emit error -> closes & removes zombie handle so next syncWatches recreates it
    handles[0].emitError(new Error('inotify watch died'));
    assert.equal(handles[0].closed, true);
    assert.equal(fw.listWatches().length, 0);

    fw.syncWatches(subs);
    assert.equal(fw.listWatches().length, 1);
    assert.equal(handles.length, 2);

    // Trigger real event, then immediate self-write during suppression window -> ignored
    handles[1].listener('change', 'input.txt');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(events.length, 1);
    handles[1].listener('change', 'output-by-self.txt');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(events.length, 1, 'self-write inside suppression window must not retrigger');

    // Explicit suppressSelfWrite
    fw.suppressSelfWrite(path.join(watchDir, 'suppressed.txt'), 200);
    await new Promise((r) => setTimeout(r, 110));
    handles[1].listener('change', 'suppressed.txt');
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(events.length, 1);
  });

  // [P1 #29] persistAutomationState clears nextRunAt/lastError to null without deleting row
  await withTempDir('auto-null-clear', async ({ root, onClose }) => {
    const rt = await buildTestRuntime(root, onClose);
    const bot = (await rt.botsService.createBot({ name: 'NullClearBot', skipKickoff: true })).bot;
    const auto = rt.automationsService.create({
      botId: bot.id,
      name: 'OnceFail',
      prompt: 'Run once',
      once: { by: Date.now() + 60_000 },
    });
    rt.workStore.upsertAutomation({ ...auto, lastError: 'old-err' });
    const origDelete = rt.workStore.deleteAutomation;
    let deletedCalled = false;
    rt.workStore.deleteAutomation = (...args) => {
      deletedCalled = true;
      return origDelete(...args);
    };
    const updated = rt.automationsService.update(auto.id, { enabled: false, lastError: null, nextRunAt: null });
    assert.equal(deletedCalled, false);
    assert.equal(updated.lastError, null);
    assert.equal(updated.nextRunAt, null);
    assert.ok(rt.workStore.getAutomation(auto.id));
  });
});
