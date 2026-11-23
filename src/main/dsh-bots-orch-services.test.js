'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BOTS_LIB_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/lib/bots');
const SHARED_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/src/shared');

function importBots(filename) {
  return import(pathToFileURL(path.join(BOTS_LIB_DIR, filename)).href);
}

function importShared(filename) {
  return import(pathToFileURL(path.join(SHARED_DIR, filename)).href);
}

async function withTempDir(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `whale-bots-orch-${prefix}-`));
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

function createFakeEventBus() {
  const emitted = [];
  return {
    emitted,
    emit(evt) { emitted.push(evt); },
    close() {},
  };
}

// ============================================================================
// 1. Automations Service: RRULE/Cron, NO_REPLY, Home/Group delivery, Grace, Shared-turn
// ============================================================================

test('automations-service: RRULE & Cron parsing, timezone support, and strict validation', async () => {
  const { parseScheduleExpression, computeNextRunAt } = await importBots('automations-service.js');

  // Strict rejection of malformed / unknown RRULE fields (never silently drop)
  const badExprs = [
    '',
    'FREQ=DAILY;UNKNOWN=1',
    'FREQ=YEARLY',
    'BYHOUR=9;BYMINUTE=0',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;INTERVAL=-2',
    'FREQ=WEEKLY;BYDAY=XX',
    'FREQ=DAILY;BYHOUR=25',
    'FREQ=DAILY;BYMINUTE=60',
    'FREQ=MONTHLY;BYMONTHDAY=0',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=DAILY;FREQ=WEEKLY',
    '0 9 * *', // invalid 4-field cron
    '60 9 * * *', // invalid minute
  ];
  for (const expr of badExprs) {
    assert.throws(
      () => parseScheduleExpression(expr),
      (err) => err.code === 'invalid_argument',
      `Expected invalid_argument for "${expr}"`,
    );
  }

  // Invalid timezone rejected strictly
  assert.throws(
    () => computeNextRunAt({ schedule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', timezone: 'Mars/Phobos' }, Date.UTC(2026, 4, 1, 0, 0)),
    (err) => err.code === 'invalid_argument',
  );

  // DAILY in Asia/Shanghai (UTC+8): 2026-05-01 00:30 UTC == 08:30 CST -> next 09:00 CST == 01:00 UTC
  const nowDaily = Date.UTC(2026, 4, 1, 0, 30, 0);
  const nextDaily = computeNextRunAt({
    schedule: 'RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    timezone: 'Asia/Shanghai',
  }, nowDaily);
  assert.equal(nextDaily, Date.UTC(2026, 4, 1, 1, 0, 0));

  // WEEKLY with BYDAY=MO,FR in UTC: 2026-05-02 is Saturday -> next Monday 2026-05-04 09:30 UTC
  const nowSat = Date.UTC(2026, 4, 2, 12, 0, 0);
  const nextWeekly = computeNextRunAt({
    schedule: 'FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30',
    timezone: 'UTC',
  }, nowSat);
  assert.equal(nextWeekly, Date.UTC(2026, 4, 4, 9, 30, 0));

  // MONTHLY with BYMONTHDAY=-1 (last day of month) in UTC: Feb 2026 has 28 days
  const nowFeb = Date.UTC(2026, 1, 10, 10, 0, 0);
  const nextMonthEnd = computeNextRunAt({
    schedule: 'FREQ=MONTHLY;BYMONTHDAY=-1;BYHOUR=18;BYMINUTE=0',
    timezone: 'UTC',
  }, nowFeb);
  assert.equal(nextMonthEnd, Date.UTC(2026, 1, 28, 18, 0, 0));

  // HOURLY with INTERVAL=2 in UTC
  const anchorHour = Date.UTC(2026, 4, 1, 8, 0, 0);
  const nextHourly = computeNextRunAt({
    schedule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=15',
    timezone: 'UTC',
    anchorAt: anchorHour,
  }, Date.UTC(2026, 4, 1, 8, 30, 0));
  assert.equal(nextHourly, Date.UTC(2026, 4, 1, 10, 15, 0));

  // MINUTELY with INTERVAL=15
  const anchorMin = Date.UTC(2026, 4, 1, 8, 0, 0);
  const nextMinutely = computeNextRunAt({
    schedule: 'FREQ=MINUTELY;INTERVAL=15',
    timezone: 'UTC',
    anchorAt: anchorMin,
  }, Date.UTC(2026, 4, 1, 8, 1, 0));
  assert.equal(nextMinutely, Date.UTC(2026, 4, 1, 8, 15, 0));

  // 5-field Cron used by built-in templates: Mondays at 09:00 UTC (`0 9 * * 1`)
  const nextCronMon = computeNextRunAt({
    schedule: '0 9 * * 1',
    timezone: 'UTC',
  }, nowSat);
  assert.equal(nextCronMon, Date.UTC(2026, 4, 4, 9, 0, 0));
});

test('automations-service: NO_REPLY quiet suppression, Home/Group delivery, missed-run grace, once cleanup, and shared-turn merge', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createWorkStore } = await importBots('work-store.js');
  const { createAutomationsService } = await importBots('automations-service.js');

  await withTempDir('auto', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const workStore = createWorkStore(dbHandle.db);
    const eventBus = createFakeEventBus();

    const bot = dbHandle.bots.insertBot({
      id: 'bot-auto-1',
      name: 'AutoBot',
      hostId: 'local',
      folder: 'auto-bot',
      agent: 'deepseek-harness',
      chatSessionId: 'home-sess-1',
      paused: false,
      createdAt: 1000,
      updatedAt: 1000,
    }, 1000);

    const turnQueue = [];
    const calls = [];
    const groupPosts = [];
    const sessionRuntime = {
      async openHomeChat(botId) {
        return { ok: true, botId, sessionId: 'home-sess-1' };
      },
      async startSideChat(botId, opts) {
        return { ok: true, botId, sessionId: `side-${calls.length + 1}`, title: opts.title };
      },
      async runSingleTurn(sessionId, prompt, opts) {
        calls.push({ sessionId, prompt, opts });
        const next = turnQueue.shift();
        if (typeof next === 'function') return next(sessionId, prompt);
        return next ?? { ok: true, reply: 'All clear' };
      },
    };
    const fakeGroupsService = {
      async postAutomationResult(payload) {
        groupPosts.push(payload);
        return { message: { id: `gmsg-${groupPosts.length}` } };
      },
    };

    const svc = createAutomationsService({
      botsStore: dbHandle.bots,
      workStore,
      sessionRuntime,
      eventBus,
      groupsService: fakeGroupsService,
      missedRunGraceMs: 15 * 60_000,
      enableScheduler: false,
    });
    onClose(() => svc.close());

    // 1. RRULE creates real nextRunAt
    const t0 = Date.UTC(2026, 4, 1, 8, 0, 0);
    const daily = svc.create({
      botId: bot.id,
      name: 'Daily Digest',
      prompt: 'Summarize PRs',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      timezone: 'UTC',
      runsIn: 'new',
      resultsTo: 'chat',
    }, t0);
    assert.equal(daily.nextRunAt, Date.UTC(2026, 4, 1, 9, 0, 0));

    // 2. NO_REPLY suppresses Home Chat delivery and settles as `completed`
    turnQueue.push({ ok: true, reply: 'NO_REPLY' });
    const quietRes = await svc.runNow(daily.id, { now: Date.UTC(2026, 4, 1, 9, 0, 0) });
    assert.equal(quietRes.ok, true);
    assert.equal(quietRes.quiet, true);
    assert.equal(quietRes.status, 'completed');
    assert.equal(quietRes.delivered, false);
    assert.equal(calls.length, 1); // Only side chat ran, NO home chat call!
    assert.equal(workStore.getAutomation(daily.id).lastStatus, 'completed');
    assert.equal(workStore.getAutomation(daily.id).nextRunAt, Date.UTC(2026, 4, 2, 9, 0, 0));

    // 3. Non-quiet result in `runsIn: 'new'` + `resultsTo: 'chat'` delivers summary to Home Chat
    calls.length = 0;
    turnQueue.push({ ok: true, reply: '3 PRs need attention.' }); // side chat reply
    turnQueue.push({ ok: true, reply: 'Delivered.' }); // home chat delivery
    const loudRes = await svc.runNow(daily.id, { now: Date.UTC(2026, 4, 2, 9, 0, 0) });
    assert.equal(loudRes.ok, true);
    assert.equal(loudRes.quiet, false);
    assert.equal(loudRes.delivered, true);
    assert.equal(loudRes.deliveredTo.kind, 'chat');
    assert.equal(loudRes.deliveredTo.sessionId, 'home-sess-1');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].sessionId, 'home-sess-1');
    assert.match(calls[1].prompt, /3 PRs need attention/);

    // 4. Group target delivery when `groupId` is configured
    const grpAuto = svc.create({
      botId: bot.id,
      name: 'Team Standup',
      prompt: 'Collect standup',
      rrule: 'FREQ=DAILY;BYHOUR=10;BYMINUTE=0',
      timezone: 'UTC',
      runsIn: 'new',
      groupId: 'grp-standup',
    }, t0);
    turnQueue.push({ ok: true, reply: 'Standup ready!' });
    const grpRes = await svc.runNow(grpAuto.id, { now: Date.UTC(2026, 4, 1, 10, 0, 0) });
    assert.equal(grpRes.ok, true);
    assert.equal(grpRes.delivered, true);
    assert.equal(grpRes.deliveredTo.kind, 'group');
    assert.equal(groupPosts.length, 1);
    assert.equal(groupPosts[0].groupId, 'grp-standup');
    assert.equal(groupPosts[0].text, 'Standup ready!');

    // 5. Missed-Run Grace: 20 minutes late (> 15m grace) -> skipped & advanced, NOT executed
    calls.length = 0;
    const missedNow = Date.UTC(2026, 4, 2, 10, 20, 0); // grpAuto nextRunAt is 2026-05-02 10:00
    const tickRes = await svc.tick(missedNow);
    assert.equal(tickRes.triggered.includes(grpAuto.id), false);
    assert.ok(tickRes.skippedMissed.some((s) => s.automationId === grpAuto.id));
    assert.equal(calls.length, 0);
    const afterMiss = workStore.getAutomation(grpAuto.id);
    assert.equal(afterMiss.lastStatus, 'missed');
    assert.equal(afterMiss.nextRunAt, Date.UTC(2026, 4, 3, 10, 0, 0));

    // 6. One-shot `once` auto-disables / cleans up after execution
    const onceKeep = svc.create({
      botId: bot.id,
      name: 'Remind once',
      prompt: 'Check deploy',
      once: { by: Date.UTC(2026, 4, 1, 11, 0, 0) },
      runsIn: 'chat',
    }, t0);
    turnQueue.push({ ok: true, reply: 'Deploy healthy' });
    const onceRes = await svc.runNow(onceKeep.id, { now: Date.UTC(2026, 4, 1, 11, 0, 0) });
    assert.equal(onceRes.ok, true);
    assert.equal(onceRes.cleanedUp, false);
    assert.equal(workStore.getAutomation(onceKeep.id).enabled, false);
    assert.equal(workStore.getAutomation(onceKeep.id).nextRunAt, null);

    const onceClean = svc.create({
      botId: bot.id,
      name: 'Ephemeral wait',
      prompt: 'Check once and clean',
      once: { by: Date.UTC(2026, 4, 1, 11, 5, 0), deleteAfterRun: true },
      runsIn: 'chat',
    }, t0);
    turnQueue.push({ ok: true, reply: 'NO_REPLY' });
    const cleanRes = await svc.runNow(onceClean.id, { now: Date.UTC(2026, 4, 1, 11, 5, 0) });
    assert.equal(cleanRes.ok, true);
    assert.equal(cleanRes.cleanedUp, true);
    assert.equal(workStore.getAutomation(onceClean.id), null);

    // 7. Shared-turn merged answer settles as `completed` instead of false failure
    const sharedAuto = svc.create({
      botId: bot.id,
      name: 'Shared chat check',
      prompt: 'Any blockers?',
      intervalMinutes: 30,
      runsIn: 'chat',
    }, t0);
    turnQueue.push({ ok: false, answeredInTurn: true, reason: 'merged', reply: 'Combined answer in shared turn' });
    const mergedRes = await svc.runNow(sharedAuto.id, { now: t0 + 30 * 60_000 });
    assert.equal(mergedRes.ok, true);
    assert.equal(mergedRes.merged, true);
    assert.equal(mergedRes.status, 'completed');
    assert.equal(mergedRes.error, null);
    assert.equal(workStore.getAutomation(sharedAuto.id).lastStatus, 'completed');
  });
});

// ============================================================================
// 2. Groups Service: Per-Group queue, resumePending, stop cancel, anti-injection, @Name handoff
// ============================================================================

test('groups-service: per-group serial queue, resumePending + dead turn sweep, stop real cancel, anti-injection prompt, and @Name handoff', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createGroupsStore } = await importBots('groups-store.js');
  const {
    createGroupsService,
    extractHandoffMentions,
    excerptAroundMention,
  } = await importBots('groups-service.js');

  // Unit check: mention extraction ignores fenced/tilde code blocks, inline code, and blockquotes
  const members = [
    { id: 'b1', name: 'Alice' },
    { id: 'b2', name: 'Bob' },
    { id: 'b3', name: 'Carol' },
  ];
  const fencedReply = [
    'Here is an example:',
    '```js',
    '// @Bob inside backtick fence should be ignored',
    '```',
    '~~~txt',
    '@Carol inside tilde fence should be ignored',
    '~~~',
    'Inline `@Bob` should be ignored.',
    '> @Carol inside blockquote should be ignored',
    'Please ask @Bob to verify the migration.',
  ].join('\n');
  const extracted = extractHandoffMentions(fencedReply, members, 'b1');
  assert.deepEqual(extracted.map((x) => x.botId), ['b2']);

  // Unit check: long reply excerpt centers around mention location
  const longPrefix = 'A'.repeat(2000);
  const longSuffix = 'Z'.repeat(2000);
  const longText = `${longPrefix} CRITICAL_CONTEXT @Bob NEXT_ACTION ${longSuffix}`;
  const mIdx = longText.indexOf('@Bob');
  const excerpt = excerptAroundMention(longText, mIdx, mIdx + 4, { limit: 500, before: 80, after: 80 });
  assert.equal(excerpt.excerpted, true);
  assert.match(excerpt.text, /CRITICAL_CONTEXT @Bob NEXT_ACTION/);
  assert.match(excerpt.text, /earlier text omitted/);
  assert.match(excerpt.text, /later text omitted/);

  await withTempDir('groups', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const groupsStore = createGroupsStore(dbHandle.db);
    const eventBus = createFakeEventBus();

    const alice = dbHandle.bots.insertBot({ id: 'b-alice', name: 'Alice', hostId: 'local', folder: 'alice', agent: 'deepseek-harness', paused: false, createdAt: 1, updatedAt: 1 }, 1);
    const bob = dbHandle.bots.insertBot({ id: 'b-bob', name: 'Bob', hostId: 'local', folder: 'bob', agent: 'deepseek-harness', paused: false, createdAt: 1, updatedAt: 1 }, 1);
    const carol = dbHandle.bots.insertBot({ id: 'b-carol', name: 'Carol', hostId: 'local', folder: 'carol', agent: 'deepseek-harness', paused: true, createdAt: 1, updatedAt: 1 }, 1);

    const promptsSeen = [];
    const startedSessions = [];
    const cancelledSessions = [];
    let turnHandler = async (sessionId, prompt) => {
      promptsSeen.push({ sessionId, prompt });
      return { ok: true, reply: 'Default reply' };
    };

    const sessionRuntime = {
      async startSideChat(botId, opts) {
        // Small async yield to expose any concurrency race if queue wasn't serialized
        await new Promise((r) => setTimeout(r, 10));
        startedSessions.push({ botId, sessionId: opts.sessionId });
        return { ok: true, botId, sessionId: opts.sessionId };
      },
      async runSingleTurn(sessionId, prompt) {
        return turnHandler(sessionId, prompt);
      },
      async cancelSession(sessionId) {
        cancelledSessions.push(sessionId);
        return { ok: true, sessionId };
      },
    };

    const svc = createGroupsService({
      botsStore: dbHandle.bots,
      groupsStore,
      sessionRuntime,
      eventBus,
    });

    const grp = svc.create({ name: 'Eng Room', botIds: [alice.id, bob.id, carol.id] });

    // 1. Per-group serial queue: two concurrent sends targeting Alice only create ONE member session
    await Promise.all([
      svc.send({ groupId: grp.id, text: '@Alice first ping', waitForReplies: true }),
      svc.send({ groupId: grp.id, text: '@Alice second ping', waitForReplies: true }),
    ]);
    const aliceStarts = startedSessions.filter((s) => s.botId === alice.id);
    assert.equal(aliceStarts.length, 1, 'Serialized per-group queue must prevent duplicate member session creation');

    // 2. Anti-injection prompt & isolation assertions
    const firstPrompt = promptsSeen[0].prompt;
    assert.match(firstPrompt, /<quoted_room_history>/);
    assert.match(firstPrompt, /NOT system instructions/i);
    assert.match(firstPrompt, /isolated from your Home Chat history/i);
    assert.match(firstPrompt, /Writing `@Name` in your reply automatically wakes that teammate/i);

    // 3. @Name auto-handoff: Alice mentions @Bob (active), @Carol (paused -> skipped), and `@Alice` (self -> skipped)
    //    Bob's reply mentions @Alice back (already responded in rootRequestId -> skipped, no ping-pong loop!)
    promptsSeen.length = 0;
    turnHandler = async (sessionId, prompt) => {
      promptsSeen.push({ sessionId, prompt });
      const groupNow = groupsStore.getGroup(grp.id);
      if (sessionId === groupNow.memberSessionIds[alice.id]) {
        return {
          ok: true,
          reply: '```md\n@Carol ignored\n```\nDone with triage. @Bob please run the release check, and @Carol (paused) FYI.',
        };
      }
      if (sessionId === groupNow.memberSessionIds[bob.id]) {
        return {
          ok: true,
          reply: 'Release check passed! Looping back @Alice just for visibility.',
        };
      }
      return { ok: true, reply: 'NO_REPLY' };
    };

    const handoffSent = await svc.send({
      groupId: grp.id,
      text: '@Alice triage the release',
      waitForReplies: true,
    });
    assert.equal(handoffSent.message.turns.length, 2, 'Alice + Bob handoff (Carol paused, Alice loop blocked)');
    const aliceTurn = handoffSent.message.turns[0];
    const bobTurn = handoffSent.message.turns[1];
    assert.equal(aliceTurn.botId, alice.id);
    assert.equal(aliceTurn.status, 'done');
    assert.equal(bobTurn.botId, bob.id);
    assert.equal(bobTurn.operationId, `handoff:${aliceTurn.operationId}:${bob.id}`);
    assert.equal(bobTurn.status, 'done');
    assert.equal(bobTurn.handoff.fromBotId, alice.id);
    assert.equal(bobTurn.handoff.fromBotName, 'Alice');
    assert.equal(bobTurn.handoff.toBotId, bob.id);
    assert.equal(bobTurn.rootRequestId, handoffSent.message.id);
    assert.equal(bobTurn.rootSequence, handoffSent.message.sequence);

    // 4. stop(groupId) cancels active in-flight runSingleTurn via sessionRuntime.cancelSession
    let releaseStuckTurn;
    const stuckStarted = new Promise((resolve) => {
      turnHandler = async (sessionId) => {
        resolve(sessionId);
        await new Promise((r) => { releaseStuckTurn = r; });
        return { ok: true, reply: 'Late reply after stop' };
      };
    });
    const pendingSend = svc.send({ groupId: grp.id, text: '@Alice long running task', waitForReplies: false });
    const activeSid = await stuckStarted;
    await pendingSend;

    cancelledSessions.length = 0;
    const stopRes = await svc.stop(grp.id);
    assert.equal(stopRes.ok, true);
    assert.deepEqual(stopRes.cancelledSessionIds, [activeSid]);
    assert.deepEqual(cancelledSessions, [activeSid]);
    releaseStuckTurn();
    await new Promise((r) => setTimeout(r, 20));
    const afterStopMsgs = svc.read({ groupId: grp.id }).messages;
    const stoppedMsg = afterStopMsgs.at(-1);
    assert.equal(stoppedMsg.turns[0].status, 'stopped');

    // 5. resumePending() recovers persisted pending deliveries & sweeps orphaned `Starting…` dead turns
    const grp2 = svc.create({ name: 'Recovery Room', botIds: [alice.id, bob.id] });
    const appended = groupsStore.appendMessage(grp2.id, {
      id: 'msg-crash-1',
      rootRequestId: 'msg-crash-1',
      threadId: '',
      author: { kind: 'owner' },
      authorName: 'Owner',
      text: '@Alice @Bob recover after crash',
      turns: [
        { operationId: 'op-live-pending', botId: alice.id, botName: 'Alice', sessionId: 'bot-group-member-rec-a', status: 'running', reply: null },
        { operationId: 'op-dead-orphan', botId: bob.id, botName: 'Bob', sessionId: 'bot-group-member-rec-b', status: 'Starting…', reply: null },
      ],
    }, { operationId: 'op-live-pending' });

    groupsStore.enqueuePending('op-live-pending', grp2.id, {
      messageId: appended.message.id,
      rootRequestId: appended.message.id,
      rootSequence: appended.message.sequence,
      botId: alice.id,
      sessionId: 'bot-group-member-rec-a',
      threadId: '',
      quotedHistory: '<quoted_room_history>\n[]\n</quoted_room_history>',
      triggerText: '@Alice recover after crash',
      authorName: 'Owner',
    });

    turnHandler = async () => ({ ok: true, reply: 'Recovered successfully!' });
    const resumeRes = await svc.resumePending({ waitForReplies: true });
    assert.equal(resumeRes.resumedCount, 1);
    assert.equal(resumeRes.cleanedDeadCount, 1);
    assert.deepEqual(resumeRes.operations, ['op-live-pending']);
    assert.equal(groupsStore.listPending(grp2.id).length, 0);

    const recoveredMsg = svc.read({ groupId: grp2.id }).messages.find((m) => m.id === 'msg-crash-1');
    assert.equal(recoveredMsg.turns.find((t) => t.operationId === 'op-live-pending').status, 'done');
    assert.equal(recoveredMsg.turns.find((t) => t.operationId === 'op-live-pending').reply, 'Recovered successfully!');
    assert.equal(recoveredMsg.turns.find((t) => t.operationId === 'op-dead-orphan').status, 'stopped');
    assert.equal(recoveredMsg.turns.find((t) => t.operationId === 'op-dead-orphan').error, 'interrupted_on_restart');
  });
});

// ============================================================================
// 3. Look-Around Service: Read-only policy, history injection, armedAt, circuit breaker, replace old open
// ============================================================================

test('look-around-service: read-only tool policy, history prompt injection, armedAt gate, circuit breaker, and open replacement', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const {
    createLookAroundService,
    isLookAroundToolAllowed,
    evaluateLookAroundToolPolicy,
  } = await importBots('look-around-service.js');

  // 1. Code-level read-only tool policy
  for (const allowedTool of ['read_file', 'grep_search', 'list_dir', 'git_diff', 'bot_suggest', 'bot_item_list', 'bot_work_list']) {
    assert.equal(isLookAroundToolAllowed(allowedTool, { path: 'README.md' }), true, `${allowedTool} must be allowed`);
  }
  const blockedTools = [
    'write_file',
    'edit_file',
    'run_command',
    'bash',
    'powershell',
    'bot_work_start',
    'bot_tools_manage',
    'bot_reply',
    'bot_send',
    'bot_create_offer',
    'bot_automation_create',
    'bot_item_add',
    'unknown_custom_mutator',
  ];
  for (const tool of blockedTools) {
    assert.equal(isLookAroundToolAllowed(tool, {}), false, `${tool} must be blocked`);
    assert.ok(evaluateLookAroundToolPolicy(tool, {}).reason);
  }
  // Dangerous arguments rejected even on read-only tools
  assert.equal(isLookAroundToolAllowed('git_diff', { flags: '--output=/tmp/x' }), false);
  assert.equal(isLookAroundToolAllowed('grep_search', { query: 'foo $(rm -rf /)' }), false);
  assert.equal(isLookAroundToolAllowed('read_file', { path: 'a.txt', write: true }), false);
  assert.equal(isLookAroundToolAllowed('read_file', { path: 'a.txt', mode: 'w' }), false);
  assert.equal(isLookAroundToolAllowed('git_log', { args: '--join' }), false);
  assert.equal(isLookAroundToolAllowed('git_show', { args: '-X POST' }), false);

  await withTempDir('lookaround', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const eventBus = createFakeEventBus();

    const bot = dbHandle.bots.insertBot({
      id: 'bot-la-1',
      name: 'Watcher',
      hostId: 'local',
      folder: 'watcher',
      agent: 'deepseek-harness',
      paused: false,
      lookAround: { on: true, every: 'every-4h', weekdaysOnly: false, focus: 'PR hygiene' },
      createdAt: Date.UTC(2026, 4, 1, 0, 0),
      updatedAt: Date.UTC(2026, 4, 1, 0, 0),
    }, Date.UTC(2026, 4, 1, 0, 0));

    const capturedPrompts = [];
    let sweepBehavior = async (b, prompt) => {
      capturedPrompts.push(prompt);
      return { ok: true, summary: 'ok' };
    };
    const sessionRuntime = {
      async openHomeChat(botId) { return { ok: true, botId, sessionId: 'home-la' }; },
      async startSideChat(botId) { return { ok: true, botId, sessionId: 'side-la' }; },
      async runSingleTurn() { return { ok: true, reply: 'started' }; },
    };

    const svc = createLookAroundService({
      dshHome: root,
      botsStore: dbHandle.bots,
      sessionRuntime,
      eventBus,
      runSweep: (b, p) => sweepBehavior(b, p),
      maxConsecutiveFailures: 3,
      enableScheduler: false,
    });
    onClose(() => svc.close());

    // 2. armedAt gate: fresh bot is NOT armed, nextRunAt is null, tick skips it
    const tBase = new Date(2026, 4, 4, 7, 0, 0).getTime(); // Monday 07:00 local
    const tDue = new Date(2026, 4, 4, 9, 0, 0).getTime(); // Monday 09:00 local (past 08:00 slot)
    assert.equal(svc.getState(bot.id, tBase).armed, false);
    assert.equal(svc.getState(bot.id, tBase).nextRunAt, null);
    const unarmedTick = await svc.tick(tDue);
    assert.deepEqual(unarmedTick.triggered, []);
    assert.deepEqual(unarmedTick.skippedUnarmed, [bot.id]);

    // After markFirstOwnerChat -> armed, nextRunAt populated, tick triggers sweep
    const armed = svc.markFirstOwnerChat(bot.id, tBase);
    assert.equal(armed.newlyArmed, true);
    assert.equal(svc.markFirstOwnerChat(bot.id, tBase + 1000).newlyArmed, false); // idempotent
    assert.ok(svc.getState(bot.id, tBase).nextRunAt !== null);

    // 3. Seed open / started / dismissed history and verify prompt injection + old open replacement
    const sOpen = svc.addSuggestion(bot.id, {
      title: 'Old Open PR #10',
      why: 'Waiting 2 days',
      ask: 'Review PR #10',
      link: 'https://github.com/acme/app/pull/10',
    }, { now: tBase });
    const sStarted = svc.addSuggestion(bot.id, {
      title: 'Adopted Security Patch',
      why: 'CVE fix',
      ask: 'Apply patch',
    }, { now: tBase });
    await svc.startSuggestion(bot.id, sStarted.suggestion.id, { now: tBase + 1000 });
    const sDismissed = svc.addSuggestion(bot.id, {
      title: 'Noisy Lint Nudge',
      why: 'Minor style',
      ask: 'Reformat',
    }, { now: tBase });
    svc.dismissSuggestion(bot.id, sDismissed.suggestion.id, tBase + 2000);

    sweepBehavior = async (b, prompt) => {
      capturedPrompts.push(prompt);
      svc.addSuggestion(b.id, {
        title: 'Fresh Open PR #11',
        why: 'Just opened',
        ask: 'Review PR #11',
        link: 'https://github.com/acme/app/pull/11',
      }, { now: tDue });
      return { ok: true, summary: '1 fresh' };
    };

    const run1 = await svc.lookNow(bot.id, tDue);
    assert.equal(run1.ok, true);
    assert.equal(run1.replacedCount, 1);

    // Prompt must contain all three history blocks
    const lastPrompt = capturedPrompts.at(-1);
    assert.match(lastPrompt, /history\.open/);
    assert.match(lastPrompt, /Old Open PR #10/);
    assert.match(lastPrompt, /history\.started/);
    assert.match(lastPrompt, /Adopted Security Patch/);
    assert.match(lastPrompt, /history\.dismissed/);
    assert.match(lastPrompt, /Noisy Lint Nudge/);

    // Old open suggestion became `replaced`, fresh suggestion remains `open`
    const stAfter = svc.getState(bot.id, tDue);
    assert.equal(stAfter.openSuggestions.length, 1);
    assert.equal(stAfter.openSuggestions[0].title, 'Fresh Open PR #11');
    const oldEntry = stAfter.suggestions.find((s) => s.id === sOpen.suggestion.id);
    assert.equal(oldEntry.status, 'replaced');

    // 4. Circuit breaker: 3 consecutive failures auto-disable Look Around
    sweepBehavior = async () => ({ ok: false, summary: 'upstream error' });
    const f1 = await svc.lookNow(bot.id, tDue + 10_000);
    assert.equal(f1.circuitTripped, false);
    assert.equal(f1.consecutiveFailures, 1);
    const f2 = await svc.lookNow(bot.id, tDue + 20_000);
    assert.equal(f2.circuitTripped, false);
    assert.equal(f2.consecutiveFailures, 2);
    const f3 = await svc.lookNow(bot.id, tDue + 30_000);
    assert.equal(f3.circuitTripped, true);
    assert.equal(f3.consecutiveFailures, 3);
    assert.equal(dbHandle.bots.getBot(bot.id).lookAround.on, false);
    assert.equal(svc.getState(bot.id, tDue + 30_000).trippedReason, 'consecutive_failures');
  });
});

// ============================================================================
// 4. Service Helpers: Structured import/shared-setup.json & Atomic Rollback
// ============================================================================

test('service-helpers: structured import/shared-setup.json contract and atomic createBotFromTemplateWithRollback', async () => {
  const { openBotsDatabase } = await importBots('db.js');
  const { createWorkStore } = await importBots('work-store.js');
  const { botsRootDir, botMetaDir } = await importBots('fs-home.js');
  const {
    BOT_SHARED_SETUP_JSON_FILE,
    createBotFromTemplateWithRollback,
    provisionPackageAssets,
  } = await importBots('service-helpers.js');
  const { BOT_SHARED_SETUP_FILE, botTemplate } = await importShared('index.js');

  await withTempDir('helpers', async ({ root, onClose }) => {
    const dbHandle = openBotsDatabase({ dshHome: root });
    onClose(() => dbHandle.close());
    const workStore = createWorkStore(dbHandle.db);
    const botsRoot = botsRootDir(root);
    const metaRoot = botMetaDir(root);

    // 1. Template creation writes structured `import/shared-setup.json` + readable `shared-setup.md`
    const created = await createBotFromTemplateWithRollback(
      { botsRoot, metaRoot, botsStore: dbHandle.bots, workStore },
      { name: 'PR Guardian', fromTemplate: { templateId: 'pr-review' }, locale: 'en-US' },
    );
    assert.ok(created.bot.id);
    const setupJsonPath = path.join(created.homeDir, BOT_SHARED_SETUP_JSON_FILE);
    const setupMdPath = path.join(created.homeDir, BOT_SHARED_SETUP_FILE);
    assert.equal(fs.existsSync(setupJsonPath), true);
    assert.equal(fs.existsSync(setupMdPath), true);

    const setup = JSON.parse(fs.readFileSync(setupJsonPath, 'utf8'));
    assert.equal(setup.schemaVersion, 1);
    assert.equal(setup.source, 'template');
    assert.equal(setup.templateId, 'pr-review');
    assert.deepEqual(setup.connectors, ['github']);
    assert.ok(Array.isArray(setup.firstSteps) && setup.firstSteps.length >= 2);
    assert.ok(typeof setup.firstChat === 'string' && setup.firstChat.length > 0);
    assert.equal(setup.eventsSuggested.length, 1);
    assert.equal(setup.eventsSuggested[0].source, 'github');
    assert.equal(setup.eventsSuggested[0].event, 'review_requested');
    assert.ok(setup.eventsSuggested[0].name.length > 0);
    assert.ok(setup.eventsSuggested[0].prompt.length > 0);

    // Template with schedules creates paused automations & lists them in `schedulesOff`
    const depCreated = await createBotFromTemplateWithRollback(
      { botsRoot, metaRoot, botsStore: dbHandle.bots, workStore },
      { name: 'Dep Watcher', fromTemplate: { templateId: 'dependency-updates' } },
    );
    const depSetup = JSON.parse(fs.readFileSync(path.join(depCreated.homeDir, BOT_SHARED_SETUP_JSON_FILE), 'utf8'));
    assert.equal(depSetup.schedulesOff.length, 1);
    assert.equal(depSetup.schedulesOff[0].rrule, '0 9 * * 1');
    assert.equal(depCreated.createdAutomationIds.length, 1);
    assert.equal(workStore.listAutomations({ botId: depCreated.bot.id }).length, 1);

    // 2. Package provisioning writes structured `import/shared-setup.json` with toolsToSignIn & sharerNote
    const pkgHome = path.join(botsRoot, 'pkg-bot');
    fs.mkdirSync(pkgHome, { recursive: true });
    const pkgBot = { id: 'pkg-bot-1', name: 'PkgBot' };
    provisionPackageAssets(pkgHome, metaRoot, pkgBot, {
      manifest: {
        schemaVersion: 1,
        name: 'PkgBot',
        purpose: 'Imported helper',
        agentHint: 'deepseek-harness',
        skills: [],
        tools: [{ id: 't1', name: 'LinearMCP', url: 'https://mcp.linear.app', headerNames: ['Authorization'] }],
        connectors: [{ kind: 'linear' }],
        schedules: [{ id: 's1', name: 'Daily sync', prompt: 'Sync', rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', results: 'chat' }],
        eventSuggestions: [{ id: 'e1', name: 'On assign', source: 'linear', event: 'assigned', prompt: 'Triage', results: 'chat' }],
        memory: [],
        setupNote: 'Remember to sign in to LinearMCP first.',
      },
      files: { 'SOUL.md': '# PkgBot\n' },
    }, workStore);
    const pkgSetup = JSON.parse(fs.readFileSync(path.join(pkgHome, BOT_SHARED_SETUP_JSON_FILE), 'utf8'));
    assert.equal(pkgSetup.source, 'package');
    assert.equal(pkgSetup.toolsToSignIn.length, 1);
    assert.equal(pkgSetup.toolsToSignIn[0].name, 'LinearMCP');
    assert.equal(pkgSetup.sharerNote, 'Remember to sign in to LinearMCP first.');
    assert.equal(pkgSetup.needsSetup, 'Remember to sign in to LinearMCP first.');
    assert.equal(pkgSetup.eventsSuggested.length, 1);
    assert.equal(pkgSetup.schedulesOff.length, 1);

    // 3. Failure rollback: error during openHomeChat rolls back directory, automations, and DB bot row
    const botsCountBefore = dbHandle.bots.listBots().length;
    const autosCountBefore = workStore.listAutomations().length;
    const dirsBefore = new Set(fs.readdirSync(botsRoot));

    await assert.rejects(
      () => createBotFromTemplateWithRollback(
        {
          botsRoot,
          metaRoot,
          botsStore: dbHandle.bots,
          workStore,
          sessionRuntime: {
            async openHomeChat() {
              throw new Error('simulated_session_boot_failure');
            },
          },
        },
        { name: 'Doomed Bot', fromTemplate: { templateId: 'dependency-updates' } },
      ),
      /simulated_session_boot_failure/,
    );

    assert.equal(dbHandle.bots.listBots().length, botsCountBefore, 'DB bot row must be rolled back');
    assert.equal(workStore.listAutomations().length, autosCountBefore, 'Created automations must be rolled back');
    assert.deepEqual(new Set(fs.readdirSync(botsRoot)), dirsBefore, 'Half-created bot folder must be rolled back');

    // Verify template catalog still intact
    assert.ok(botTemplate('pr-review'));
  });
});
