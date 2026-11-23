'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BOTS_LIB_DIR = path.resolve(__dirname, '../../vendor/dsh-whale/lib/bots');

function importBotsModule(filename) {
  return import(pathToFileURL(path.join(BOTS_LIB_DIR, filename)).href);
}

/**
 * Helper that guarantees a freshly created temp root is removed even on failure,
 * after all registered cleanup callbacks (e.g. closing SQLite handles) complete.
 */
async function withTempWorkspace(prefix, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `whale-bots-${prefix}-`));
  const closers = [];
  const registerClose = (closer) => closers.push(closer);
  try {
    return await fn({ root, registerClose });
  } finally {
    for (let i = closers.length - 1; i >= 0; i -= 1) {
      try {
        closers[i]();
      } catch {
        // Ensure remaining resources still close before directory cleanup.
      }
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false, `temp workspace must be cleaned up: ${root}`);
  }
}

/** Build a minimal syntactically valid PNG header with custom width/height. */
function makeSyntheticPng(width, height, extraBytes = 32) {
  const buf = Buffer.alloc(24 + extraBytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('db.js: schema migration, WAL, nested savepoints, bots/settings/chats CRUD', async () => {
  const { openBotsDatabase, withTransaction, BOTS_SCHEMA_VERSION } = await importBotsModule('db.js');

  await withTempWorkspace('db', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());

    assert.equal(handle.dbPath, path.join(root, 'data', 'bots', 'bots.db'));
    const versionRow = handle.db.prepare('PRAGMA user_version').get();
    assert.equal(versionRow.user_version, BOTS_SCHEMA_VERSION);
    const modeRow = handle.db.prepare('PRAGMA journal_mode').get();
    assert.equal(String(modeRow.journal_mode).toLowerCase(), 'wal');

    const tables = handle.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const required of [
      'bots', 'bot_global_settings', 'bot_chats',
      'bot_items', 'bot_item_links', 'bot_item_events',
      'bot_groups', 'bot_group_messages', 'bot_group_operations',
      'bot_group_pending', 'bot_group_worker_operations', 'bot_group_sidebar',
      'bot_requests', 'bot_conversation_acts_for', 'bot_run_resends',
      'bot_request_outcomes', 'bot_work', 'bot_automations', 'bot_access_requests',
    ]) {
      assert.ok(tables.includes(required), `missing table ${required}`);
    }

    // Bots CRUD + sidebar ordering + case-insensitive name uniqueness.
    const b1 = handle.bots.insertBot({ id: 'b1', folder: 'alpha', name: 'Alpha', sidebarOrder: 2 }, 100);
    const b2 = handle.bots.insertBot({ id: 'b2', folder: 'beta', name: 'Beta', sidebarOrder: 1 }, 200);
    const b3 = handle.bots.insertBot({ id: 'b3', folder: 'gamma', name: 'Gamma' }, 300);
    assert.deepEqual(handle.bots.listBots().map((b) => b.id), ['b3', 'b2', 'b1']);
    assert.equal(handle.bots.getBotByName('alpha').id, b1.id);
    assert.equal(handle.bots.getBotByFolder('beta').id, b2.id);
    assert.throws(() => handle.bots.insertBot({ id: 'b4', folder: 'dup', name: 'ALPHA' }, 400));

    const updated = handle.bots.updateBot('b3', { paused: true }, 500);
    assert.equal(updated.paused, true);
    assert.equal(updated.updatedAt, 500);
    assert.equal(b3.createdAt, updated.createdAt);

    // Nested transaction rollback leaves outer work intact.
    withTransaction(handle.db, () => {
      handle.bots.setSetting('outerKey', 'kept', 600);
      assert.throws(() => {
        withTransaction(handle.db, () => {
          handle.bots.setSetting('innerKey', 'rolled-back', 601);
          throw new Error('abort-inner');
        });
      }, /abort-inner/);
    });
    assert.equal(handle.bots.getSetting('outerKey'), 'kept');
    assert.equal(handle.bots.getSetting('innerKey', null), null);

    // Global config defaults & updates.
    assert.equal(handle.bots.getGlobalConfig().botsEnabled, true);
    const cfg = handle.bots.updateGlobalConfig({ botsEnabled: false, petBotId: 'b1' }, 700);
    assert.equal(cfg.botsEnabled, false);
    assert.equal(cfg.petBotId, 'b1');

    // Chats CRUD.
    handle.bots.upsertChat({
      sessionId: 'sess-home',
      botId: 'b1',
      kind: 'home',
      origin: 'home',
      title: 'Alpha Home',
      externalSource: 'im',
      externalId: 'chat-42',
    }, 800);
    assert.equal(handle.bots.findExternalChat('im', 'chat-42').sessionId, 'sess-home');
    handle.bots.markChatSeen('sess-home', 850);
    assert.equal(handle.bots.getChat('sess-home').seenAt, 850);
    handle.bots.closeChat('sess-home', 900);
    assert.equal(handle.bots.listChats('b1', { includeClosed: false }).length, 0);
    assert.equal(handle.bots.listChats('b1', { includeClosed: true }).length, 1);
    assert.equal(handle.bots.deleteBot('b2'), true);
  });
});

test('items-store.js: all 22 operations, ask validation, auto-resume, snooze conflict, owner cancel guard, and stale counts', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const { createItemsStore, BotItemError } = await importBotsModule('items-store.js');

  await withTempWorkspace('items', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());
    const store = createItemsStore(handle.db);

    const botActor = { kind: 'bot', botId: 'bot-a', chatId: 'chat-home' };
    const otherChatActor = { kind: 'bot', botId: 'bot-a', chatId: 'chat-side' };
    const ownerActor = { kind: 'owner', device: 'desktop' };
    const t0 = 1_700_000_000_000;

    // 1. add + get + byNumber + links + linksTo + linkedDispatchRefs
    const added = store.add({
      ownerBotId: 'bot-a',
      chatId: 'chat-home',
      source: { kind: 'home', title: 'Main' },
      title: 'Ship release notes',
      description: 'Draft v2 notes',
      doneMeans: 'PR merged',
      links: [{ kind: 'pr', ref: 'org/repo#12' }],
    }, botActor, t0);
    assert.equal(added.item.number, 1);
    assert.equal(store.get(added.item.uid).title, 'Ship release notes');
    assert.equal(store.byNumber(1).uid, added.item.uid);
    assert.equal(store.links(added.item.uid).length, 1);
    assert.equal(store.linksTo('pr', 'org/repo#12').length, 1);

    // 2. set with ask validation -> needs_you
    assert.throws(() => store.set(added.item.uid, { status: 'canceled' }, botActor, t0 + 1), (err) => {
      assert.ok(err instanceof BotItemError);
      assert.equal(err.code, 'invalid_argument');
      return true;
    });
    assert.throws(() => store.set(added.item.uid, {
      status: 'needs_you',
      ask: { questions: [{ prompt: 'Pick?', options: [{ label: 'A' }, { label: 'a' }] }] },
    }, botActor, t0 + 2), (err) => err.code === 'invalid_argument');

    const askPayload = {
      questions: [{
        prompt: 'Which release channel?',
        options: [{ label: 'Stable', detail: 'Default users' }, { label: 'Beta' }],
        recommended: 0,
      }],
    };
    const asked = store.set(added.item.uid, {
      description: '',
      status: 'needs_you',
      ask: askPayload,
    }, botActor, t0 + 1000);
    assert.equal(asked.item.description, null);
    assert.equal(asked.item.status, 'needs_you');
    assert.ok(asked.item.questionEvent > 0);
    assert.equal(store.needsYou({ ownerBotId: 'bot-a', now: t0 + 1000 }).length, 1);

    // Same-chat bot writes should not owe mail; cross-chat bot writes owe mail.
    assert.equal(store.owedMail(0).length, 0);
    const sideComment = store.comment(added.item.uid, { text: 'Side note from side chat' }, otherChatActor, t0 + 1500);
    assert.equal(sideComment.deduplicated, false);
    const mailBatch1 = store.owedMail(0);
    assert.equal(mailBatch1.length, 1);
    assert.equal(mailBatch1[0].chatId, 'chat-home');
    assert.equal(store.markMailSent(mailBatch1[0].eventIds), 1);
    assert.equal(store.owedMail(0).length, 0);

    // 3. ownerSnooze optimistic lock check (`item_changed`) + valid snooze
    const staleOthersId = asked.item.othersLastEventId;
    // Bot transitions status after owner last saw `staleOthersId`
    const moved = store.set(added.item.uid, { status: 'working' }, botActor, t0 + 2000);
    const backToNeedsYou = store.set(added.item.uid, {
      status: 'needs_you',
      comment: 'Still need confirmation',
    }, botActor, t0 + 2500);
    assert.throws(() => store.ownerSnooze({
      items: [{ uid: added.item.uid, othersLastEventId: staleOthersId }],
      until: t0 + 10_000,
    }, ownerActor, t0 + 3000), (err) => err instanceof BotItemError && err.code === 'item_changed');

    // Valid snooze with current othersLastEventId hides item from needsYou until expiry
    const snoozeUntil = t0 + 3600_000;
    store.ownerSnooze({
      items: [{ uid: added.item.uid, othersLastEventId: backToNeedsYou.item.othersLastEventId }],
      until: snoozeUntil,
    }, ownerActor, t0 + 3000);
    assert.equal(store.needsYou({ ownerBotId: 'bot-a', now: t0 + 4000 }).length, 0);
    assert.equal(store.needsYou({ ownerBotId: 'bot-a', now: snoozeUntil + 1 }).length, 1);
    assert.equal(moved.item.status, 'working');

    // 4. ownerComment idempotency (requestId) + auto-answer needs_you -> working + unsnooze
    const ans1 = store.ownerComment(added.item.uid, {
      text: 'Go with Stable',
      requestId: 'req-answer-1',
    }, ownerActor, t0 + 5000);
    assert.equal(ans1.deduplicated, false);
    assert.equal(ans1.item.status, 'working');
    assert.equal(ans1.item.snoozedUntil, null);
    assert.equal(ans1.item.questionEvent, null);
    assert.equal(ans1.event.data.answers, backToNeedsYou.item.questionEventId);
    assert.equal(ans1.events.length, 2);
    assert.equal(ans1.events[0].action, ans1.events[1].action);

    const ansDup = store.ownerComment(added.item.uid, {
      text: 'Go with Stable',
      requestId: 'req-answer-1',
    }, ownerActor, t0 + 5100);
    assert.equal(ansDup.deduplicated, true);
    assert.equal(ansDup.event.id, ans1.event.id);

    // 5. link + linkStartedWorker + events/eventsBefore + list + viewRows + latestEventId
    const second = store.add({
      ownerBotId: 'bot-a',
      chatId: 'chat-home',
      source: { kind: 'home', title: null },
      title: 'Fix flaky CI',
      status: 'planned',
    }, botActor, t0 + 6000);
    const linked = store.link(second.item.uid, [{ kind: 'file', ref: 'src/ci.js' }], botActor, t0 + 6100);
    assert.equal(linked.added.length, 1);
    const started = store.linkStartedWorker(second.item.uid, 'disp-99', 'chat-home', t0 + 6200);
    assert.equal(started.linked, true);
    assert.equal(started.statusChanged, true);
    assert.equal(started.item.status, 'working');
    assert.deepEqual(store.linkedDispatchRefs([second.item.uid])[second.item.uid], ['disp-99']);

    const evPage = store.events(added.item.uid, { after: 'e1', limit: 3 });
    assert.equal(evPage.events.length, 3);
    assert.equal(evPage.hasMore, true);
    const evBefore = store.eventsBefore(added.item.uid, { before: evPage.events[2].eventId, limit: 2 });
    assert.equal(evBefore.events.length, 2);
    assert.ok(store.latestEventId('bot-a') >= evPage.events[2].id);

    const listed = store.list({ ownerBotId: 'bot-a', limit: 1 });
    assert.equal(listed.items.length, 1);
    assert.ok(listed.nextCursor);
    const page2 = store.list({ ownerBotId: 'bot-a', limit: 5, cursor: listed.nextCursor });
    assert.equal(page2.items.length, 1);

    const views = store.viewRows({ ownerBotId: 'bot-a', now: t0 + 7000 });
    assert.equal(views.length, 2);

    // 6. ownerStatus cancel prevents bot reopen; owner can reopen; close rejects already-closed
    store.ownerStatus([added.item.uid], { status: 'canceled', reason: 'Superseded by v3' }, ownerActor, t0 + 8000);
    assert.throws(() => store.set(added.item.uid, { status: 'working' }, botActor, t0 + 8100), (err) => {
      assert.equal(err.code, 'item_closed');
      return true;
    });
    const reopened = store.ownerStatus(added.item.uid, { status: 'working' }, ownerActor, t0 + 8200);
    assert.equal(reopened.updated[0].status, 'working');
    store.close(added.item.uid, { status: 'done', note: 'Shipped' }, botActor, t0 + 8300);
    assert.throws(() => store.close(added.item.uid, { status: 'done' }, botActor, t0 + 8400), (err) => err.code === 'item_closed');

    // 7. needsYouCounts + staleInMs + active dispatch exemption
    const third = store.add({
      ownerBotId: 'bot-a',
      chatId: 'chat-home',
      source: { kind: 'home', title: null },
      title: 'Waiting approval',
      status: 'needs_you',
      comment: 'Approve deploy?',
    }, botActor, t0 + 9000);
    const counts = store.needsYouCounts(
      [{ id: 'bot-a', itemsStale: 3 }],
      t0 + 10_000,
      { activeDispatchRefs: ['disp-99'] },
    );
    assert.equal(counts.counts['bot-a'], 1);
    assert.equal(counts.staleCounts['bot-a'], 0);
    // `second` is working with active dispatch `disp-99` so skipped; `third` goes stale in 3d - 1s
    assert.equal(counts.staleInMs, (3 * 86_400_000) - 1000);
    assert.ok(third.item.uid);
  });
});

test('groups-store.js: 6 tables, revision lock, idempotent messages, threads, stop watermark, member removal freeze', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const { createGroupsStore, BotGroupError, isStoppedAt } = await importBotsModule('groups-store.js');

  await withTempWorkspace('groups', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());
    const store = createGroupsStore(handle.db);

    const g1 = store.createGroup({
      id: 'grp-1',
      name: 'Release Crew',
      botIds: ['bot-1', 'bot-2'],
      replyMode: { kind: 'bot', botId: 'bot-2' },
      memberSessionIds: { 'bot-1': 's-b1', 'bot-2': 's-b2' },
    }, 1000);
    assert.equal(g1.revision, 1);

    // Revision conflict guard.
    assert.throws(() => store.updateGroup('grp-1', { name: 'Wrong' }, { expectedRevision: 99 }), (err) => {
      assert.ok(err instanceof BotGroupError);
      assert.equal(err.code, 'revision_conflict');
      return true;
    });

    // Idempotent message append + sidebar latest compaction + operation lookup.
    const longText = `Hello   world   ${'x'.repeat(600)}`;
    const m1 = store.appendMessage('grp-1', {
      id: 'msg-1',
      authorName: 'Bot Two',
      authorBotId: 'bot-2',
      text: longText,
      turns: [{ botId: 'bot-2', text: 'working' }],
    }, { operationId: 'op-1', tie: 1, now: 1100 });
    assert.equal(m1.deduplicated, false);
    const m1Dup = store.appendMessage('grp-1', {
      id: 'msg-1',
      authorName: 'Bot Two',
      text: 'ignored',
    }, { operationId: 'op-1', now: 1200 });
    assert.equal(m1Dup.deduplicated, true);
    assert.equal(m1Dup.message.sequence, m1.message.sequence);
    assert.equal(store.getMessageByOperation('op-1').id, 'msg-1');
    assert.equal(store.getGroup('grp-1').latest.text.length, 500);

    // Threads & pagination.
    const { thread } = store.createThread('grp-1', { threadId: 'th-1', title: 'Hotfix', now: 1300 });
    assert.equal(thread.id, 'th-1');
    const tMsg1 = store.appendMessage('grp-1', { id: 'msg-t1', threadId: 'th-1', authorName: 'Owner', text: 'First' }, { now: 1400 });
    const tMsg2 = store.appendMessage('grp-1', { id: 'msg-t2', threadId: 'th-1', authorName: 'Bot One', authorBotId: 'bot-1', text: 'Second' }, { now: 1500 });
    const tMsg3 = store.appendMessage('grp-1', { id: 'msg-t3', threadId: 'th-1', authorName: 'Owner', text: 'Third' }, { now: 1600 });

    const pageLast2 = store.readMessages('grp-1', { threadId: 'th-1', limit: 2 });
    assert.deepEqual(pageLast2.messages.map((m) => m.id), ['msg-t2', 'msg-t3']);
    assert.equal(pageLast2.hasMore, true);
    const pagePrev = store.readMessages('grp-1', { threadId: 'th-1', beforeSequence: tMsg2.message.sequence, limit: 2 });
    assert.deepEqual(pagePrev.messages.map((m) => m.id), ['msg-t1']);
    assert.equal(pagePrev.hasMore, false);
    const pageAfter = store.readMessages('grp-1', { threadId: 'th-1', afterSequence: tMsg1.message.sequence, limit: 10 });
    assert.deepEqual(pageAfter.messages.map((m) => m.id), ['msg-t2', 'msg-t3']);
    assert.ok(tMsg3.message.sequence > tMsg2.message.sequence);

    // Pending & worker binding.
    store.enqueuePending('op-1', 'grp-1', { targetBotIds: ['bot-1', 'bot-2'], byBot: { 'bot-1': 'ctx1', 'bot-2': 'ctx2' } });
    store.enqueuePending('op-only-b2', 'grp-1', { botId: 'bot-2', history: [] });
    store.bindWorker('disp-grp-1', 'op-1');
    assert.equal(store.getWorkerOperation('disp-grp-1'), 'op-1');
    assert.deepEqual(store.listWorkersForOperation('op-1'), ['disp-grp-1']);

    // Stop watermark.
    const stopped = store.setStoppedThrough('grp-1', { botId: 'bot-1', sequence: tMsg2.message.sequence, now: 1700 });
    assert.equal(isStoppedAt(stopped, 'bot-1', tMsg2.message.sequence), true);
    assert.equal(isStoppedAt(stopped, 'bot-1', tMsg3.message.sequence), false);
    const stoppedAll = store.setStoppedThrough('grp-1', { botId: null, sequence: tMsg3.message.sequence, now: 1750 });
    assert.equal(isStoppedAt(stoppedAll, 'bot-2', tMsg3.message.sequence), true);

    // Member removal: archives formerSessionIds, resets replyMode, revokes & freezes messages, purges pending.
    const updated = store.updateGroup('grp-1', { botIds: ['bot-1'] }, {
      expectedRevision: stoppedAll.revision,
      frozenItemsByBot: { 'bot-2': { 'msg-1': [{ kind: 'text', body: 'frozen snapshot' }] } },
      now: 1800,
    });
    assert.deepEqual(updated.replyMode, { kind: 'mentions' });
    assert.deepEqual(updated.formerSessionIds['bot-2'], ['s-b2']);
    assert.equal(updated.memberSessionIds['bot-2'], undefined);
    const mainMsgs = store.readMessages('grp-1', { threadId: '' }).messages;
    assert.equal(mainMsgs[0].revoked, true);
    assert.deepEqual(mainMsgs[0].frozenItems, [{ kind: 'text', body: 'frozen snapshot' }]);
    assert.equal(store.getPending('op-only-b2'), null);
    assert.deepEqual(store.getPending('op-1').context.targetBotIds, ['bot-1']);

    // Reorder + deleteGroup cleans all 6 tables.
    store.createGroup({ id: 'grp-2', name: 'Ops', botIds: ['bot-1'] }, 1900);
    const reordered = store.reorderGroups(['grp-2', 'grp-1']);
    assert.deepEqual(reordered.map((g) => g.id), ['grp-2', 'grp-1']);
    assert.equal(store.deleteGroup('grp-1'), true);
    assert.equal(store.getGroup('grp-1'), null);
    assert.equal(store.getWorkerOperation('disp-grp-1'), null);
    assert.equal(store.listPending('grp-1').length, 0);
  });
});

test('groups-store.js: replyMode accepts string shortcuts and canonical objects (BotGroupDialog regression)', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const { createGroupsStore, BotGroupError } = await importBotsModule('groups-store.js');

  await withTempWorkspace('groups-reply-mode', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());
    const store = createGroupsStore(handle.db);
    const botIds = ['bot-a', 'bot-b'];

    // String shortcuts previously threw `Invalid replyMode` from the create dialog.
    assert.deepEqual(store.createGroup({ id: 'g-str-bot', name: 'S1', botIds, replyMode: 'bot' }, 1000).replyMode, { kind: 'bot', botId: 'bot-a' });
    assert.deepEqual(store.createGroup({ id: 'g-str-all', name: 'S2', botIds, replyMode: 'all' }, 1000).replyMode, { kind: 'all' });
    assert.deepEqual(store.createGroup({ id: 'g-str-men', name: 'S3', botIds, replyMode: ' mentions ' }, 1000).replyMode, { kind: 'mentions' });

    // Canonical objects (what BotGroupDialog now submits).
    assert.deepEqual(store.createGroup({ id: 'g-obj-bot', name: 'O1', botIds, replyMode: { kind: 'bot', botId: 'bot-b' } }, 1000).replyMode, { kind: 'bot', botId: 'bot-b' });
    assert.deepEqual(store.createGroup({ id: 'g-obj-all', name: 'O2', botIds, replyMode: { kind: 'all' } }, 1000).replyMode, { kind: 'all' });
    assert.deepEqual(store.createGroup({ id: 'g-obj-men', name: 'O3', botIds, replyMode: { kind: 'mentions' } }, 1000).replyMode, { kind: 'mentions' });
    assert.deepEqual(store.createGroup({ id: 'g-obj-out', name: 'O4', botIds, replyMode: { kind: 'bot', botId: 'stranger' } }, 1000).replyMode, { kind: 'mentions' });
    assert.deepEqual(store.createGroup({ id: 'g-none', name: 'O5', botIds }, 1000).replyMode, { kind: 'bot', botId: 'bot-a' });

    // Updates accept both shapes too.
    const g = store.getGroup('g-obj-all');
    const viaString = store.updateGroup('g-obj-all', { replyMode: 'bot' }, { expectedRevision: g.revision, now: 1100 });
    assert.deepEqual(viaString.replyMode, { kind: 'bot', botId: 'bot-a' });
    const viaObject = store.updateGroup('g-obj-all', { replyMode: { kind: 'all' } }, { expectedRevision: viaString.revision, now: 1200 });
    assert.deepEqual(viaObject.replyMode, { kind: 'all' });

    for (const bad of ['everyone', 42, { kind: 'nobody' }]) {
      assert.throws(() => store.createGroup({ name: 'Bad', botIds, replyMode: bad }, 1300), (err) => {
        assert.ok(err instanceof BotGroupError);
        assert.equal(err.code, 'invalid_argument');
        assert.match(err.message, /Invalid replyMode/u);
        return true;
      });
    }
  });
});

test('work-store.js: work generation/forget, request cycle & depth guards, acts_for, resends, outcomes, automations, access requests', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const { createWorkStore, BotWorkError } = await importBotsModule('work-store.js');

  await withTempWorkspace('work', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());
    const store = createWorkStore(handle.db);

    // 1. bot_work generation & forget
    const w1 = store.startWork({
      botId: 'bot-1', source: 'app', externalId: 'sess-1', taskId: 't-1', dispatchId: 'd-1',
    }, 100);
    assert.equal(w1.generation, 1);
    assert.equal(store.getCurrentWork('bot-1', 'app', 'sess-1').id, w1.id);

    const w2 = store.startWork({
      botId: 'bot-1', source: 'app', externalId: 'sess-1', taskId: 't-2', dispatchId: 'd-2',
    }, 200);
    assert.equal(w2.generation, 2);
    assert.equal(store.getWorkById(w1.id).closeReason, 'superseded');
    assert.equal(store.getWorkByDispatch('d-2').id, w2.id);

    const fg = store.forgetWork('bot-1', 'app', 'sess-1', { now: 300 });
    assert.equal(fg.forgotten.closeReason, 'owner_reset');
    assert.equal(fg.nextGeneration, 3);
    assert.equal(store.getCurrentWork('bot-1', 'app', 'sess-1'), null);

    const w3 = store.startWork({
      botId: 'bot-1', source: 'app', externalId: 'sess-1', taskId: 't-3', dispatchId: 'd-3',
    }, 400);
    assert.equal(w3.generation, 3);
    assert.equal(store.closeWorkByDispatch('d-3', { reason: 'task_gone', now: 500 }).closeReason, 'task_gone');

    // 2. bot_requests: sendKey idempotency, depth cap, self-loop & multi-hop cycle prevention
    const r1 = store.createRequest({
      rootKey: 'rk-1', fromBotId: 'bot-a', toBotId: 'bot-b', purpose: 'question', depth: 1, sendKey: 'sk-1',
    }, 600);
    assert.equal(r1.deduplicated, false);
    const r1Dup = store.createRequest({
      rootKey: 'rk-1', fromBotId: 'bot-a', toBotId: 'bot-b', purpose: 'question', depth: 1, sendKey: 'sk-1',
    }, 601);
    assert.equal(r1Dup.deduplicated, true);
    assert.equal(r1Dup.request.messageId, r1.request.messageId);

    store.createRequest({ rootKey: 'rk-1', fromBotId: 'bot-b', toBotId: 'bot-c', purpose: 'handoff', depth: 2 }, 610);
    assert.throws(() => store.createRequest({
      rootKey: 'rk-1', fromBotId: 'bot-c', toBotId: 'bot-a', purpose: 'question', depth: 3,
    }, 620), (err) => err instanceof BotWorkError && err.code === 'loop_detected');
    assert.throws(() => store.createRequest({
      rootKey: 'rk-2', fromBotId: 'bot-x', toBotId: 'bot-y', purpose: 'status', depth: 7, maxDepth: 6,
    }, 630), (err) => err.code === 'depth_exceeded');

    // 3. acts_for, resends, outcomes
    store.setActsFor('sess-ext', [{ role: 'member', id: 'u1' }], { source: 'im' }, 700);
    assert.equal(store.getActsFor('sess-ext').actsFor[0].id, 'u1');
    assert.equal(store.recordRunResend('run-1', 'sess-a', 710).recorded, true);
    assert.equal(store.recordRunResend('run-1', 'sess-b', 711).recorded, false);
    store.setRequestOutcome(r1.request.messageId, 'answered', 720);
    assert.equal(store.getRequestOutcome(r1.request.messageId).outcome, 'answered');

    // 4. automations
    const auto = store.upsertAutomation({ id: 'auto-1', botId: 'bot-1', schedule: '0 9 * * *', prompt: 'Brief' }, 800);
    assert.equal(auto.enabled, true);
    const updatedAuto = store.updateAutomationRunState('auto-1', { lastRunAt: 850, lastStatus: 'ok' }, 860);
    assert.equal(updatedAuto.lastStatus, 'ok');
    assert.equal(store.listAutomations({ botId: 'bot-1', enabledOnly: true }).length, 1);

    // 5. access requests & token redeem
    const acc = store.createAccessRequest({
      botId: 'bot-1', source: 'im', requesterId: 'user-9', requesterName: 'Bob', expiresAt: 2000,
    }, 900);
    const granted = store.redeemAccessToken(acc.token, { decision: 'granted', now: 1000 });
    assert.equal(granted.status, 'granted');
    assert.throws(() => store.decideAccessRequest(acc.id, { decision: 'declined', now: 1100 }), (err) => err.code === 'already_decided');

    const exp = store.createAccessRequest({
      botId: 'bot-1', source: 'im', requesterId: 'user-10', expiresAt: 1000,
    }, 900);
    assert.throws(() => store.decideAccessRequest(exp.id, { decision: 'granted', now: 1500 }), (err) => err.code === 'already_decided');
  });
});

test('fs-home.js: slug/Windows reserved names, ownership lock, SOUL optimistic lock, PNG avatar, traversal guard, linked skills, MCP cred stripping, safe delete', async () => {
  const fsHome = await importBotsModule('fs-home.js');

  await withTempWorkspace('fshome', async ({ root }) => {
    // 1. Folder name normalization & Windows reserved names
    assert.equal(fsHome.botFolderName('CON'), 'con-bot');
    assert.equal(fsHome.botFolderName('nul'), 'nul-bot');
    assert.equal(fsHome.botFolderName('COM1'), 'com1-bot');
    assert.equal(fsHome.botFolderName('LPT9'), 'lpt9-bot');
    assert.equal(fsHome.botFolderName('中文名'), 'bot');
    assert.ok(fsHome.botFolderName('a'.repeat(80)).length <= 40);

    const botsRoot = fsHome.botsRootDir(root);
    const metaRoot = fsHome.botMetaDir(root);
    const r1 = fsHome.reserveBotFolder(botsRoot, 'Release Helper');
    const r2 = fsHome.reserveBotFolder(botsRoot, 'Release Helper');
    assert.equal(r1.folder, 'release-helper');
    assert.equal(r2.folder, 'release-helper-2');

    // 2. initBotHome + ownership lock
    const bot = { id: 'bot-owned-1', name: 'Release Helper', agent: 'dsh', avatar: 'mascot:M1', members: [] };
    const initRes = fsHome.initBotHome(r1.homeDir, bot);
    assert.ok(initRes.changed.includes('bot.json'));
    assert.equal(fs.readFileSync(path.join(r1.homeDir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
    // Re-writing unchanged managed files reports no changes
    assert.deepEqual(fsHome.writeManagedFiles(r1.homeDir, bot).changed, []);
    // Another bot id is rejected by bot.json ownership lock
    assert.throws(() => fsHome.assertFolderOwnedByBot(r1.homeDir, 'bot-intruder'), (err) => err.code === 'bot_folder_not_owned');

    // 3. SOUL.md optimistic lock
    const soul0 = fsHome.readSoul(r1.homeDir);
    const soul1 = fsHome.writeSoul(r1.homeDir, '# Updated\n', { expectedSignature: soul0.signature, botId: bot.id });
    assert.notEqual(soul1.signature, soul0.signature);
    assert.throws(
      () => fsHome.writeSoul(r1.homeDir, '# Stale write\n', { expectedSignature: soul0.signature, botId: bot.id }),
      (err) => err.code === 'changed-on-disk',
    );

    // 4. Avatar PNG validation
    const validPng = makeSyntheticPng(512, 512);
    const savedAvatar = fsHome.saveAvatar(r1.homeDir, validPng, { botId: bot.id });
    assert.match(savedAvatar.avatar, /^upload:[0-9a-f]{16}$/);
    assert.equal(fsHome.readAvatar(r1.homeDir).buffer.equals(validPng), true);
    assert.throws(() => fsHome.saveAvatar(r1.homeDir, makeSyntheticPng(512, 600)), (err) => err.code === 'invalid_avatar');
    assert.throws(() => fsHome.saveAvatar(r1.homeDir, makeSyntheticPng(256, 256)), (err) => err.code === 'invalid_avatar');
    assert.throws(() => fsHome.saveAvatar(r1.homeDir, makeSyntheticPng(2048, 2048)), (err) => err.code === 'invalid_avatar');
    assert.throws(() => fsHome.saveAvatar(r1.homeDir, Buffer.from('not a png')), (err) => err.code === 'invalid_avatar');

    // 5. Safe home file access & traversal prevention
    fsHome.writeHomeFile(r1.homeDir, 'memory/release.md', '- 2026-11-21 Release checklist\n', { botId: bot.id });
    assert.match(fsHome.readHomeFile(r1.homeDir, 'memory/release.md'), /Release checklist/);
    assert.ok(fsHome.listHomeFiles(r1.homeDir).some((e) => e.name === 'SOUL.md'));
    assert.throws(() => fsHome.readHomeFile(r1.homeDir, '../outside.txt'), (err) => err.code === 'path_traversal');
    assert.throws(() => fsHome.writeHomeFile(r1.homeDir, path.join(root, 'abs.txt'), 'bad'), (err) => err.code === 'path_traversal');

    // Symlink / junction escape check
    const outsideDir = path.join(root, 'outside-secret');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'top-secret', 'utf8');
    const escapeLink = path.join(r1.homeDir, 'escape-link');
    fs.symlinkSync(outsideDir, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => fsHome.readHomeFile(r1.homeDir, 'escape-link/secret.txt'), (err) => err.code === 'path_traversal');
    fs.unlinkSync(escapeLink);

    // 6. Linked project skills via junction / symlink
    const projSkills = path.join(root, 'repo-a', 'skills');
    fs.mkdirSync(path.join(projSkills, 'deploy-check'), { recursive: true });
    fs.writeFileSync(path.join(projSkills, 'deploy-check', 'SKILL.md'), '# deploy-check\n', 'utf8');
    const sync1 = fsHome.syncLinkedSkills(metaRoot, bot.id, [projSkills]);
    assert.equal(sync1.linked.length, 1);
    for (const linkedRoot of sync1.roots) {
      assert.equal(fs.existsSync(path.join(linkedRoot, 'deploy-check', 'SKILL.md')), true);
    }
    // Removing project unlinks without deleting source skill directory
    const sync2 = fsHome.syncLinkedSkills(metaRoot, bot.id, []);
    assert.equal(sync2.linked.length, 0);
    assert.equal(fs.existsSync(path.join(projSkills, 'deploy-check', 'SKILL.md')), true);

    // 7. Per-bot MCP tools credential stripping
    const toolsRes = fsHome.writeBotToolsConfig(r1.homeDir, metaRoot, bot.id, {
      servers: [
        { name: 'linear', transport: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer super-secret-key' } },
        { name: 'local-tool', transport: 'stdio', command: 'node', args: ['server.js'] },
      ],
    });
    assert.equal(toolsRes.credentialIds.length, 1);
    const onDiskConfig = fsHome.readBotToolsConfig(r1.homeDir);
    assert.equal(onDiskConfig.servers[0].headers, undefined);
    assert.equal(onDiskConfig.servers[0].credential, toolsRes.credentialIds[0]);
    const creds = fsHome.readBotToolCredentials(metaRoot, bot.id);
    assert.equal(creds[toolsRes.credentialIds[0]].headers.Authorization, 'Bearer super-secret-key');

    // 8. Delete home defaults to preserving folder; deleteFolder: true enforces ownership
    assert.deepEqual(fsHome.deleteBotHome(r1.homeDir, bot.id), { deleted: false, preserved: true });
    assert.equal(fs.existsSync(r1.homeDir), true);
    assert.throws(() => fsHome.deleteBotHome(r1.homeDir, 'wrong-bot', { deleteFolder: true }), (err) => err.code === 'bot_folder_not_owned');
    assert.deepEqual(fsHome.deleteBotHome(r1.homeDir, bot.id, { deleteFolder: true }), { deleted: true, preserved: false });
    assert.equal(fs.existsSync(r1.homeDir), false);
  });
});

test('memory-service.js: 200-line cap, tamper restore, source tagging, secret redaction, 90d undo, and tidy-up guardrails', async () => {
  const fsHome = await importBotsModule('fs-home.js');
  const { createMemoryService, readMemoryForPrompt, BotMemoryError } = await importBotsModule('memory-service.js');

  await withTempWorkspace('memory', async ({ root }) => {
    const homeDir = path.join(root, 'data', 'bots', 'alpha');
    const metaRoot = fsHome.botMetaDir(root);
    fs.mkdirSync(path.join(homeDir, 'memory'), { recursive: true });

    let clock = Date.UTC(2026, 10, 21, 12, 0, 0);
    const svc = createMemoryService({ metaRoot, now: () => clock });
    const botId = 'bot-mem-1';

    // 1. 200-line prompt loading truncation
    const manyLines = ['# Memory', ...Array.from({ length: 205 }, (_, i) => `- 2026-11-21 Fact ${i + 1}`)].join('\n') + '\n';
    fs.writeFileSync(path.join(homeDir, 'MEMORY.md'), manyLines, 'utf8');
    const promptView = readMemoryForPrompt(homeDir);
    assert.equal(promptView.loadedLines, 200);
    assert.equal(promptView.truncatedLines, 6);
    assert.match(promptView.text, /\(6 more lines in MEMORY\.md not loaded\)/);

    // 2. Turn reconciliation: auto-restore unauthorized deletion + external source tagging + anti-spoofing
    const baseMemory = [
      '# Memory',
      '- 2026-11-01 User prefers concise replies',
      '- 2026-11-02 Release branch is main · from: GitHub #10',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(homeDir, 'MEMORY.md'), baseMemory, 'utf8');
    const snapBefore = svc.snapshotMemory(homeDir);

    // Simulate agent accidentally deleting fact 1 and adding a spoofed-source fact during an external turn
    const mutatedByAgent = [
      '# Memory',
      '- 2026-11-02 Release branch is main · from: GitHub #10',
      '- 2026-11-21 Deploy window is Tuesday · from: Owner Direct',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(homeDir, 'MEMORY.md'), mutatedByAgent, 'utf8');

    const recon = svc.reconcileTurnMemory({
      botId,
      homeDir,
      beforeText: snapBefore.text,
      sourceLabel: 'Slack, Dana',
      forgottenKeys: [],
    });
    assert.equal(recon.kept.length, 1);
    assert.match(recon.kept[0], /User prefers concise replies/);
    assert.equal(recon.added.length, 1);
    assert.match(recon.added[0], /Deploy window is Tuesday - from: Owner Direct · from: Slack, Dana$/);
    // Old line kept original source unchanged
    assert.match(recon.text, /Release branch is main · from: GitHub #10/);

    // Authorized forgetFact is respected
    const forgot = svc.forgetFact({ botId, homeDir, fact: 'User prefers concise replies' });
    assert.equal(forgot.removed.length, 1);
    assert.equal(fs.readFileSync(path.join(homeDir, 'MEMORY.md'), 'utf8').includes('User prefers concise replies'), false);

    // 3. Undo & supersede protection
    const addedFact = svc.addFact({ botId, homeDir, text: 'Prefers pnpm over npm' });
    const edited = svc.editFact({ botId, homeDir, match: 'Prefers pnpm over npm', nextText: 'Prefers bun over npm' });
    // Undoing the older `addFact` skips the key because `editFact` superseded it
    const undoOld = svc.undoChange({ botId, homeDir, changeId: addedFact.changeId });
    assert.ok(undoOld.skippedKeys.length >= 1);
    assert.match(fs.readFileSync(path.join(homeDir, 'MEMORY.md'), 'utf8'), /Prefers bun over npm/);
    // Undoing the latest `forgetFact` restores the deleted fact
    const undoForget = svc.undoChange({ botId, homeDir, changeId: forgot.changeId });
    assert.equal(undoForget.revertedRemoved.length, 1);
    assert.match(fs.readFileSync(path.join(homeDir, 'MEMORY.md'), 'utf8'), /User prefers concise replies/);
    assert.ok(edited.changeId);

    // 4. Secret redaction makes history non-undoable
    const secretEntry = svc.addFact({
      botId,
      homeDir,
      text: 'Do not use sk-proj-ABCDEF1234567890SECRETKEY in CI',
    });
    const hist = svc.listHistory(botId);
    const savedSecret = hist.find((h) => h.id === secretEntry.changeId);
    assert.equal(savedSecret.redacted, true);
    assert.equal(savedSecret.undoable, false);
    assert.equal(savedSecret.added[0].includes('sk-proj-ABCDEF'), false);
    assert.throws(() => svc.undoChange({ botId, homeDir, changeId: secretEntry.changeId }), (err) => {
      assert.ok(err instanceof BotMemoryError);
      assert.equal(err.code, 'not_undoable');
      return true;
    });

    // 5. Tidy-up guardrails & success path
    const tidyBaseLines = [
      '# Memory',
      ...Array.from({ length: 10 }, (_, i) => `- 2026-11-10 Stable fact number ${i + 1}`),
      '',
    ].join('\n');
    fs.writeFileSync(path.join(homeDir, 'MEMORY.md'), tidyBaseLines, 'utf8');
    const tidySnap = svc.snapshotMemory(homeDir);

    // Reject delete ratio > 20% (3/10 removed)
    assert.throws(() => svc.applyTidyUpResult({
      botId,
      homeDir,
      beforeSnapshot: tidySnap,
      proposedMemory: ['# Memory', ...Array.from({ length: 7 }, (_, i) => `- 2026-11-10 Stable fact number ${i + 1}`)].join('\n') + '\n',
    }), (err) => err.code === 'delete_ratio_exceeded');

    // Reject invalid topic name
    assert.throws(() => svc.applyTidyUpResult({
      botId,
      homeDir,
      beforeSnapshot: tidySnap,
      proposedMemory: tidyBaseLines,
      topicFiles: { '../escape': '- 2026-11-10 Stable fact number 1\n' },
    }), (err) => err.code === 'invalid_topic_name');

    // Reject fabricated line in topic
    assert.throws(() => svc.applyTidyUpResult({
      botId,
      homeDir,
      beforeSnapshot: tidySnap,
      proposedMemory: tidyBaseLines,
      topicFiles: { ops: '- 2026-11-10 Hallucinated fact never in MEMORY\n' },
    }), (err) => err.code === 'fabricated_topic_line');

    // Valid tidy-up via BEGIN/END protocol (2/10 removed = 20% <= limit, moved into topic & archived)
    const rawTidy = [
      'BEGIN MEMORY.md',
      '# Memory',
      ...Array.from({ length: 8 }, (_, i) => `- 2026-11-10 Stable fact number ${i + 1}`),
      'END MEMORY.md',
      'BEGIN memory/ops.md',
      '# Ops',
      '- 2026-11-10 Stable fact number 9',
      'END memory/ops.md',
      'BEGIN REPLACED',
      '- 2026-11-10 Stable fact number 10',
      'END REPLACED',
    ].join('\n');
    const tidyRes = svc.applyTidyUpResult({
      botId,
      homeDir,
      beforeSnapshot: tidySnap,
      rawOutput: rawTidy,
    });
    assert.equal(tidyRes.ok, true);
    assert.equal(tidyRes.archivedCount, 2);
    assert.deepEqual(tidyRes.topicsWritten, ['ops']);
    assert.match(fs.readFileSync(path.join(homeDir, 'memory', 'archive.md'), 'utf8'), /Stable fact number 10/);
    assert.match(fs.readFileSync(path.join(homeDir, 'memory', 'ops.md'), 'utf8'), /Stable fact number 9/);

    // Reject concurrent modification with old snapshot
    assert.throws(() => svc.applyTidyUpResult({
      botId,
      homeDir,
      beforeSnapshot: tidySnap,
      proposedMemory: tidyBaseLines,
    }), (err) => err.code === 'concurrent_modification');

    // 90-day retention pruning
    clock += 91 * 24 * 60 * 60 * 1000;
    assert.equal(svc.listHistory(botId).length, 0);
  });
});

test('legacy-migration.js: lossless read-only migration from data/whale/ and idempotency', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const {
    migrateLegacyWhaleIfNeeded,
    LEGACY_WHALE_BOT_ID,
    legacyWhaleDir,
  } = await importBotsModule('legacy-migration.js');

  await withTempWorkspace('migration', async ({ root, registerClose }) => {
    const legacyDir = legacyWhaleDir(root);
    fs.mkdirSync(path.join(legacyDir, 'memory'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'skills', 'daily-brief'), { recursive: true });
    fs.mkdirSync(path.join(legacyDir, 'stickers'), { recursive: true });

    const legacySettings = {
      name: '小鲸鱼',
      personality: 'genki',
      userTitle: '船长',
      personaText: '总是用海洋比喻打气。',
      modelProvider: 'deepseek',
      modelModel: 'deepseek-reasoner',
      modelReasoningEffort: 'high',
      imDefault: true,
      sessionId: 'session-whale-legacy-123',
      taskRootDir: 'D:/projects',
    };
    const settingsRaw = `${JSON.stringify(legacySettings, null, 2)}\n`;
    const memoryRaw = '# 鲸鱼娘的长期记忆\n\n- 2026-10-01 船长喜欢简洁总结\n';
    const topicRaw = '# Fact\n喜欢深色主题\n';
    const skillRaw = '# daily-brief skill\n';
    const stickerBuf = Buffer.from('fake-sticker-bytes');

    fs.writeFileSync(path.join(legacyDir, 'settings.json'), settingsRaw, 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'MEMORY.md'), memoryRaw, 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'memory', 'theme.md'), topicRaw, 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'skills', 'daily-brief', 'SKILL.md'), skillRaw, 'utf8');
    fs.writeFileSync(path.join(legacyDir, 'stickers', 'happy.png'), stickerBuf);

    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());

    const res = migrateLegacyWhaleIfNeeded({
      dshHome: root,
      db: handle.db,
      botsStore: handle.bots,
      now: 1_700_000_000_000,
    });
    assert.equal(res.migrated, true);
    assert.equal(res.bot.id, LEGACY_WHALE_BOT_ID);
    assert.equal(res.bot.avatar, 'mascot:W1');
    assert.equal(res.bot.name, '小鲸鱼');
    assert.equal(res.bot.chatSessionId, 'session-whale-legacy-123');
    assert.equal(res.bot.launch.model, 'deepseek/deepseek-reasoner');
    assert.equal(res.bot.launch.options.reasoningEffort, 'high');
    assert.equal(res.bot.imDefault, true);
    assert.equal(handle.bots.getGlobalConfig().petBotId, LEGACY_WHALE_BOT_ID);
    assert.equal(handle.bots.getChat('session-whale-legacy-123').kind, 'home');

    // Verify copied files in new bot home
    assert.match(fs.readFileSync(path.join(res.homeDir, 'SOUL.md'), 'utf8'), /总是用海洋比喻打气/);
    assert.match(fs.readFileSync(path.join(res.homeDir, 'SOUL.md'), 'utf8'), /船长/);
    assert.equal(fs.readFileSync(path.join(res.homeDir, 'MEMORY.md'), 'utf8'), memoryRaw);
    assert.equal(fs.readFileSync(path.join(res.homeDir, 'memory', 'theme.md'), 'utf8'), topicRaw);
    assert.equal(fs.readFileSync(path.join(res.homeDir, 'skills', 'daily-brief', 'SKILL.md'), 'utf8'), skillRaw);
    assert.equal(fs.readFileSync(path.join(res.homeDir, 'stickers', 'happy.png')).equals(stickerBuf), true);

    // Verify legacy directory remained 100% untouched (read-only)
    assert.equal(fs.readFileSync(path.join(legacyDir, 'settings.json'), 'utf8'), settingsRaw);
    assert.equal(fs.readFileSync(path.join(legacyDir, 'MEMORY.md'), 'utf8'), memoryRaw);
    assert.equal(fs.readFileSync(path.join(legacyDir, 'memory', 'theme.md'), 'utf8'), topicRaw);
    assert.equal(fs.readFileSync(path.join(legacyDir, 'skills', 'daily-brief', 'SKILL.md'), 'utf8'), skillRaw);

    // Idempotency on second call
    const second = migrateLegacyWhaleIfNeeded({
      dshHome: root,
      db: handle.db,
      botsStore: handle.bots,
      now: 1_700_000_005_000,
    });
    assert.equal(second.migrated, false);
    assert.equal(second.reason, 'already-migrated');
    assert.equal(handle.bots.listBots().length, 1);
  });
});

test('db.js v2 migration: fresh v0->v2 and v1->v2 idempotent upgrade with FTS5 and all v2 tables', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { openBotsDatabase, botsDbPath, BOTS_SCHEMA_VERSION } = await importBotsModule('db.js');
  assert.equal(BOTS_SCHEMA_VERSION, 2);

  const v2Tables = [
    'automation_claims', 'webhook_events', 'memory_index_meta', 'memory_fts',
    'tool_wal', 'bot_budgets', 'bot_usage_daily', 'crew_adoptions',
  ];

  // 1. Fresh v0 -> v2 migration + FTS5 query check
  await withTempWorkspace('db-v0-v2', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());

    assert.equal(handle.db.prepare('PRAGMA user_version').get().user_version, 2);
    const tables = handle.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const t of v2Tables) {
      assert.ok(tables.includes(t), `v0->v2 missing table ${t}`);
    }

    handle.db.prepare(
      'INSERT INTO memory_fts (entry_id, scope, scope_id, bot_id, source_file, fact_date, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('e1', 'bot', 'b1', 'b1', 'MEMORY.md', '2026-11-22', 'Prefer pnpm and zero regressions');
    const hit = handle.db.prepare("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH 'pnpm'").get();
    assert.equal(hit.entry_id, 'e1');
  });

  // 2. Existing v1 -> v2 upgrade preserves v1 data and is idempotent on re-open
  await withTempWorkspace('db-v1-v2', async ({ root, registerClose }) => {
    const dbFile = botsDbPath(root);
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const legacy = new DatabaseSync(dbFile);
    legacy.exec(`
      CREATE TABLE bots (id TEXT PRIMARY KEY, folder TEXT NOT NULL UNIQUE, name TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE bot_global_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE bot_chats (
        session_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'side',
        title TEXT, origin TEXT NOT NULL DEFAULT 'side', external_source TEXT, external_id TEXT,
        record TEXT NOT NULL DEFAULT '{}', closed_at INTEGER, seen_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO bots (id, folder, name, record, created_at, updated_at)
      VALUES ('b-old', 'old-bot', 'Old Bot', '{"id":"b-old","folder":"old-bot","name":"Old Bot"}', 100, 100);
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const upgraded = openBotsDatabase({ dshHome: root });
    try {
      assert.equal(upgraded.db.prepare('PRAGMA user_version').get().user_version, 2);
      assert.equal(upgraded.bots.getBot('b-old').name, 'Old Bot');
      const tables = upgraded.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map((r) => r.name);
      for (const t of v2Tables) {
        assert.ok(tables.includes(t), `v1->v2 missing table ${t}`);
      }
    } finally {
      upgraded.close();
    }

    // Second open at v2 is a no-op
    const reopened = openBotsDatabase({ dshHome: root });
    registerClose(() => reopened.close());
    assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(reopened.bots.getBot('b-old').name, 'Old Bot');
  });
});

test('launch-route.js: resolves flat UI shape, legacy nested shape, slash prefix, and fallback default', async () => {
  const { resolveBotLaunchRoute } = await importBotsModule('launch-route.js');

  // Flat UI format
  assert.deepEqual(
    resolveBotLaunchRoute({ provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }),
    { provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' },
  );
  // Flat with redundant provider/ prefix
  assert.deepEqual(
    resolveBotLaunchRoute({ provider: 'deepseek', model: 'deepseek/deepseek-chat', effort: 'medium' }),
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
  );
  // Legacy nested format (provider/model + options.reasoningEffort)
  assert.deepEqual(
    resolveBotLaunchRoute({ model: 'openai/gpt-5', options: { reasoningEffort: 'high' } }),
    { provider: 'openai', model: 'gpt-5', reasoningEffort: 'high' },
  );
  // Legacy nested format (options.provider + options.effort)
  assert.deepEqual(
    resolveBotLaunchRoute({ model: 'claude-sonnet', options: { provider: 'anthropic', effort: 'low' } }),
    { provider: 'anthropic', model: 'claude-sonnet', reasoningEffort: 'low' },
  );
  // Launch only overrides effort; provider/model come from fallbackDefault
  assert.deepEqual(
    resolveBotLaunchRoute({ reasoningEffort: 'high' }, { provider: 'deepseek', model: 'deepseek-chat', defaultEffort: 'low' }),
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  );
  // Null launch uses fallbackDefault (including string spec)
  assert.deepEqual(
    resolveBotLaunchRoute(null, 'deepseek/deepseek-chat'),
    { provider: 'deepseek', model: 'deepseek-chat' },
  );
  // Incomplete without fallback returns null
  assert.equal(resolveBotLaunchRoute({ provider: 'deepseek', model: '' }), null);
  assert.equal(resolveBotLaunchRoute({ model: 'bare-model-without-provider' }), null);
  assert.equal(resolveBotLaunchRoute(null, null), null);
});

test('work-store.js v2: ACCESS_DECISIONS normalization + claims, webhooks, tool_wal, budgets/usage, crew_adoptions', async () => {
  const { openBotsDatabase } = await importBotsModule('db.js');
  const {
    createWorkStore,
    ACCESS_DECISIONS,
    normalizeAccessDecision,
  } = await importBotsModule('work-store.js');

  assert.deepEqual([...ACCESS_DECISIONS], ['granted', 'declined']);
  assert.equal(normalizeAccessDecision('denied'), 'declined');
  assert.equal(normalizeAccessDecision(' DENIED '), 'declined');
  assert.equal(normalizeAccessDecision('granted'), 'granted');

  await withTempWorkspace('work-v2', async ({ root, registerClose }) => {
    const handle = openBotsDatabase({ dshHome: root });
    registerClose(() => handle.close());
    const store = createWorkStore(handle.db);

    // 1. ACCESS_DECISIONS entry normalization ('denied' -> 'declined')
    const acc1 = store.createAccessRequest({ botId: 'b1', source: 'im', requesterId: 'u1' }, 100);
    const dec1 = store.decideAccessRequest(acc1.id, { decision: 'denied', now: 110 });
    assert.equal(dec1.status, 'declined');
    const acc2 = store.createAccessRequest({ botId: 'b1', source: 'im', requesterId: 'u2' }, 120);
    const dec2 = store.redeemAccessToken(acc2.token, { decision: 'DENIED', now: 130 });
    assert.equal(dec2.status, 'declined');

    // 2. automation_claims: unique (automation_id, slot_at) + startup interrupted recovery
    const c1 = store.claimAutomationSlot({ automationId: 'a1', botId: 'b1', slotAt: 1000, triggerKind: 'schedule' }, 1005);
    assert.equal(c1.claimed, true);
    assert.equal(c1.claim.status, 'claimed');
    const c1Dup = store.claimAutomationSlot({ automationId: 'a1', botId: 'b1', slotAt: 1000, triggerKind: 'schedule' }, 1006);
    assert.equal(c1Dup.claimed, false);
    assert.equal(c1Dup.claim.claimId, c1.claim.claimId);
    const running = store.updateAutomationClaim(c1.claim.claimId, { status: 'running', runId: 'r1', sessionId: 's1' }, 1010);
    assert.equal(running.status, 'running');
    assert.equal(running.finishedAt, null);
    const recovered = store.markInterruptedAutomationClaims(2000);
    assert.equal(recovered.count, 1);
    assert.deepEqual(recovered.claimIds, [c1.claim.claimId]);
    assert.equal(store.getAutomationClaim(c1.claim.claimId).status, 'interrupted');
    assert.equal(store.getAutomationClaim(c1.claim.claimId).finishedAt, 2000);

    // 3. webhook_events: idempotency on (webhook_id, event_id) + pruning
    const w1 = store.recordWebhookEvent({
      botId: 'b1', webhookId: 'wh-1', eventId: 'ev-1', signatureTs: 1700, payloadSha256: 'abc123',
    }, 10_000);
    assert.equal(w1.duplicate, false);
    const w1Dup = store.recordWebhookEvent({
      botId: 'b1', webhookId: 'wh-1', eventId: 'ev-1', signatureTs: 1700, payloadSha256: 'abc123',
    }, 10_005);
    assert.equal(w1Dup.duplicate, true);
    assert.equal(w1Dup.event.id, w1.event.id);
    const dispatched = store.updateWebhookEventStatus(w1.event.id, 'dispatched', { automationId: 'a1' });
    assert.equal(dispatched.status, 'dispatched');
    assert.equal(dispatched.automationId, 'a1');
    assert.equal(store.pruneWebhookEvents(1000, 12_000), 1);
    assert.equal(store.listWebhookEvents({ botId: 'b1' }).length, 0);

    // 4. tool_wal: idempotency + stale intent -> unknown (never replays)
    const wal1 = store.appendToolWalIntent({
      botId: 'b1', sessionId: 's1', toolName: 'bot_reply', action: 'reply',
      idempotencyKey: 'idem-1', effect: 'external', argsDigest: 'sha-1',
    }, 3000);
    assert.equal(wal1.deduplicated, false);
    const wal1Dup = store.appendToolWalIntent({
      botId: 'b1', sessionId: 's1', toolName: 'bot_reply', action: 'reply',
      idempotencyKey: 'idem-1', effect: 'external', argsDigest: 'sha-1',
    }, 3001);
    assert.equal(wal1Dup.deduplicated, true);
    assert.equal(wal1Dup.entry.walId, wal1.entry.walId);
    const wal2 = store.appendToolWalIntent({
      botId: 'b1', sessionId: 's1', toolName: 'bot_tools_manage', action: 'add',
      effect: 'code', argsDigest: 'sha-2',
    }, 3002);
    store.resolveToolWal(wal1.entry.walId, { status: 'committed', resultSummary: 'sent' }, 3010);
    const stale = store.markStaleToolWalUnknown(4000);
    assert.equal(stale.count, 1);
    assert.deepEqual(stale.walIds, [wal2.entry.walId]);
    assert.equal(store.getToolWal(wal2.entry.walId).status, 'unknown');

    // 5. bot_budgets & bot_usage_daily
    const budget = store.setBotBudget('b1', { dailyLimitUsd: 5.5, dailyLimitTokens: 200_000, offPeakOnly: true }, 5000);
    assert.equal(budget.dailyLimitUsd, 5.5);
    assert.equal(budget.offPeakOnly, true);
    assert.equal(budget.pauseOnExceed, true);
    assert.equal(budget.alertThresholdPct, 80);
    store.upsertBotUsageDaily({
      dayUtc: '2026-11-22', botId: 'b1', sourceKind: 'bot_chats',
      inputTokens: 1000, cacheReadTokens: 500, outputTokens: 200, costUsd: 0.25, peakCostUsd: 0.25,
    }, 5100);
    store.upsertBotUsageDaily({
      dayUtc: '2026-11-22', botId: 'b1', sourceKind: 'bot_chats', mode: 'add',
      inputTokens: 500, outputTokens: 100, costUsd: 0.1, offPeakCostUsd: 0.1,
    }, 5200);
    store.upsertBotUsageDaily({
      dayUtc: '2026-11-22', botId: 'b1', sourceKind: 'bot_work',
      inputTokens: 2000, outputTokens: 400, costUsd: 0.5, offPeakCostUsd: 0.5,
    }, 5300);
    const sum = store.sumBotUsageForDay('b1', '2026-11-22');
    assert.equal(sum.inputTokens, 3500);
    assert.equal(sum.cacheReadTokens, 500);
    assert.equal(sum.outputTokens, 700);
    assert.equal(sum.totalTokens, 4700);
    assert.ok(Math.abs(sum.costUsd - 0.85) < 1e-9);
    assert.equal(store.deleteBotBudget('b1'), true);

    // 6. crew_adoptions
    const adopted = store.adoptCrewSession({
      sessionId: 'sess-normal-1', botId: 'b1', workspaceId: 'ws-1', cwd: '/repo', title: 'Fix API',
    }, 6000);
    assert.equal(adopted.status, 'active');
    assert.equal(store.listCrewAdoptions({ botId: 'b1' }).length, 1);
    const released = store.releaseCrewSession('sess-normal-1', 6100);
    assert.equal(released.status, 'released');
    assert.equal(store.listCrewAdoptions({ botId: 'b1', status: 'active' }).length, 0);
    assert.equal(store.listCrewAdoptions({ botId: 'b1', status: 'all' }).length, 1);
  });
});

test('fs-home.js v2: decisions TSV, CREW/plan docs, daily memory, meta paths, and path-traversal guards', async () => {
  const fsHome = await importBotsModule('fs-home.js');

  await withTempWorkspace('fshome-v2', async ({ root }) => {
    const botsRoot = fsHome.botsRootDir(root);
    const metaRoot = fsHome.botMetaDir(root);
    const { homeDir } = fsHome.reserveBotFolder(botsRoot, 'Captain');
    const bot = { id: 'bot-cap-1', name: 'Captain', agent: 'dsh', members: [] };
    fsHome.initBotHome(homeDir, bot);

    // 1. decisions/<itemUid>.tsv append, tab/newline sanitization & traversal guard
    fsHome.appendDecisionTsv(homeDir, 'item_42', {
      ts: '2026-11-22T01:00:00.000Z',
      actor: 'bot',
      phase: 'verify',
      decision: 'pass',
      evidence: 'exit=0\t12 tests',
      notes: 'line1\nline2',
    }, { botId: bot.id });
    fsHome.appendDecisionTsv(homeDir, 'item_42', {
      ts: '2026-11-22T02:00:00.000Z',
      actor: 'owner',
      phase: 'ship',
      decision: 'approved',
      evidence: 'pr#99',
      notes: 'lgtm',
    }, { botId: bot.id });
    const tsv = fsHome.readDecisionTsv(homeDir, 'item_42');
    assert.equal(tsv.header, fsHome.DECISIONS_TSV_HEADER);
    assert.equal(tsv.rows.length, 2);
    assert.equal(tsv.rows[0].evidence, 'exit=0 12 tests');
    assert.equal(tsv.rows[0].notes, 'line1 line2');
    assert.equal(tsv.rows[1].decision, 'approved');
    assert.throws(() => fsHome.resolveDecisionTsvPath(homeDir, '../escape'), (err) => err.code === 'path_traversal');
    assert.throws(() => fsHome.appendDecisionTsv(homeDir, 'a/b', { decision: 'x' }), (err) => err.code === 'path_traversal');

    // 2. CREW.md & plan.md
    assert.equal(fsHome.readCrewMd(homeDir), '');
    fsHome.writeCrewMd(homeDir, '# Crew\n- Worker A\n', { botId: bot.id });
    fsHome.writePlanMd(homeDir, '# Plan\n1. Ship Wave 1\n', { botId: bot.id });
    assert.match(fsHome.readCrewMd(homeDir), /Worker A/);
    assert.match(fsHome.readPlanMd(homeDir), /Ship Wave 1/);

    // 3. memory/YYYY-MM-DD.md
    fsHome.appendDailyMemory(homeDir, 'Verified schema v2', { date: '2026-11-22', botId: bot.id });
    assert.equal(fsHome.readDailyMemory(homeDir, '2026-11-22'), '- Verified schema v2\n');
    assert.throws(() => fsHome.dailyMemoryRelPath('../2026-11-22'), (err) => err.code === 'invalid_argument');

    // 4. _meta paths: team-memory, webhook credentials, im-routes, prompt snapshots ring buffer, worktrees
    fsHome.writeTeamMemory(metaRoot, 'grp-1', '# Team Memory\n- Shared fact\n');
    assert.match(fsHome.readTeamMemory(metaRoot, 'grp-1'), /Shared fact/);
    assert.throws(() => fsHome.teamMemoryPath(metaRoot, '../escape'), (err) => err.code === 'path_traversal');

    fsHome.writeWebhookCredentials(metaRoot, { wh1: { secret: 's3cr3t' } });
    assert.equal(fsHome.readWebhookCredentials(metaRoot).wh1.secret, 's3cr3t');

    fsHome.writeImRoutes(metaRoot, { routes: { 'feishu:acc1': bot.id } });
    assert.equal(fsHome.readImRoutes(metaRoot).routes['feishu:acc1'], bot.id);

    const snaps = Array.from({ length: 15 }, (_, i) => ({ seq: i + 1, hash: `h${i + 1}` }));
    fsHome.writePromptSnapshots(metaRoot, 'bot/with:chars', snaps, { maxEntries: 10 });
    const storedSnaps = fsHome.readPromptSnapshots(metaRoot, 'bot/with:chars');
    assert.equal(storedSnaps.length, 10);
    assert.equal(storedSnaps[0].seq, 6);
    assert.equal(storedSnaps[9].seq, 15);

    const wtPath = fsHome.resolveWorktreePath(metaRoot, 'disp-abc123');
    assert.ok(wtPath.endsWith(path.join('_meta', 'worktrees', 'disp-abc123')));
    assert.throws(() => fsHome.resolveWorktreePath(metaRoot, '..\\outside'), (err) => err.code === 'path_traversal');
  });
});

test('preset.js, package.json exports, shared RPC/constants, and model-tool-effects v2 contracts', async () => {
  const whaleRoot = path.resolve(__dirname, '../../vendor/dsh-whale');
  const pkg = JSON.parse(fs.readFileSync(path.join(whaleRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['./bot-tools'], './lib/bots/bot-tools-plugin.js');
  assert.equal(pkg.exports['./worker-tools'], './lib/bots/worker-tools-plugin.js');
  assert.equal(fs.existsSync(path.join(whaleRoot, pkg.exports['./bot-tools'])), true);
  assert.equal(fs.existsSync(path.join(whaleRoot, pkg.exports['./worker-tools'])), true);

  const preset = await import(pathToFileURL(path.join(whaleRoot, 'lib', 'preset.js')).href);
  const home = path.resolve(os.tmpdir(), 'fake-dsh-home');

  // whale-girl stays backward compatible
  const whaleDef = preset.whalePresetDefinition(home);
  assert.equal(whaleDef.id, 'whale-girl');
  assert.ok(whaleDef.plugins.some((p) => p.name === 'dsh-whale/tools'));

  // dsh-bot switches to dsh-whale/bot-tools & includes _meta/bot-linked-skills
  const botDef = preset.botPresetDefinition(home);
  assert.equal(botDef.id, 'dsh-bot');
  assert.equal(botDef.order, 91);
  assert.ok(botDef.plugins.some((p) => p.name === 'dsh-whale/bot-tools'));
  assert.ok(!botDef.plugins.some((p) => p.name === 'dsh-whale/tools'));
  const botSkillsPlugin = botDef.plugins.find((p) => p.id === 'skill-filesystem');
  assert.ok(botSkillsPlugin.config.customSkillDirs.some((d) => d.endsWith(path.join('_meta', 'bot-linked-skills'))));

  // dsh-bot-worker hidden preset (order: 92) with fs, fs-search, shell, worker-tools
  const workerDef = preset.botWorkerPresetDefinition(home);
  assert.equal(workerDef.id, 'dsh-bot-worker');
  assert.equal(workerDef.order, 92);
  assert.equal(workerDef.hidden, true);
  for (const requiredPlugin of [
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-shell',
    'dsh-whale/worker-tools',
  ]) {
    assert.ok(workerDef.plugins.some((p) => p.name === requiredPlugin), `missing worker plugin ${requiredPlugin}`);
  }
  assert.ok(!workerDef.plugins.some((p) => p.name === 'dsh-whale/bot-tools' || p.name === 'dsh-whale/tools'));

  // Shared RPC methods & domain constants
  const shared = await import(pathToFileURL(path.join(whaleRoot, 'src', 'shared', 'index.js')).href);
  for (const [key, method] of [
    ['PROMPT_INSPECT', 'bots.prompt.inspect'],
    ['PROMPT_DIFF', 'bots.prompt.diff'],
    ['BUDGET_GET', 'bots.budget.get'],
    ['BUDGET_SET', 'bots.budget.set'],
    ['CREW_ADOPT', 'bots.crew.adopt'],
    ['CREW_RELEASE', 'bots.crew.release'],
    ['CREW_LIST', 'bots.crew.list'],
    ['DECISIONS_READ', 'bots.decisions.read'],
    ['GROUPS_APPROVE_PLAN', 'bots.groups.approvePlan'],
    ['MEMORY_SEARCH', 'bots.memory.search'],
    ['CONNECTORS_SET_ROUTE', 'bots.connectors.setRoute'],
    ['SKILL_RECORD_DRAFT', 'bots.skill.recordDraft'],
  ]) {
    assert.equal(shared.RPC_METHODS[key], method);
  }
  assert.equal(shared.BOT_IM_CHANNELS.length, 9);
  assert.deepEqual([...shared.BOT_MEMORY_SCOPES], ['bot', 'team', 'project']);
  assert.deepEqual([...shared.BOT_PERMISSION_MODES], ['read-only', 'workspace-write', 'auto-review', 'full-access']);

  // model-tool-effects safety levels for new bot tools
  const { effectOf, BOT_TOOLS } = require('../shared/model-tool-effects');
  assert.equal(effectOf('bot_memory_search', 'search'), 'read');
  assert.equal(effectOf('bot_decision_append', 'append'), 'local');
  assert.equal(effectOf('bot_crew_adopt', 'adopt'), 'local');
  assert.equal(effectOf('bot_crew_adopt', 'release'), 'local');
  assert.equal(BOT_TOOLS.bot_tools_manage.actions.add.level, 'code');
  assert.equal(BOT_TOOLS.bot_reply.actions.reply.level, 'external');
});
