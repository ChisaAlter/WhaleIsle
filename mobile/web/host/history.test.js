import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_PAGE_MESSAGES, historyQuery, hostHistoryPage, mergeApprovalPending, mergeLatestHistory, mergeOlderHistory, pendingFromHistoryEvents, runningFromHistoryEvents } from './history.js';

const seqs = (events) => events.map((entry) => entry.event.seq);
const ev = (seq) => ({ event: { type: 'assistant/message', seq } });

test('mergeLatestHistory keeps pages the user loaded above a refreshed tail', () => {
  const loaded = [ev(10), ev(11), ev(20), ev(21), ev(22)];
  const page = hostHistoryPage({ hasMore: true, events: [ev(21), ev(22), ev(23)] });
  const merged = mergeLatestHistory(loaded, page);
  assert.deepEqual(seqs(merged.events), [10, 11, 20, 21, 22, 23]);
  assert.equal(merged.contiguous, true);
  assert.equal(merged.keptOlder, true);
});

test('mergeLatestHistory reports a gap when a small window misses events', () => {
  const merged = mergeLatestHistory([ev(1), ev(2)], hostHistoryPage({ hasMore: true, events: [ev(40), ev(41)] }));
  assert.equal(merged.contiguous, false);
});

test('mergeLatestHistory replaces the log when the page is the whole session or nothing is loaded', () => {
  assert.deepEqual(seqs(mergeLatestHistory([ev(1), ev(2)], hostHistoryPage({ hasMore: false, events: [ev(1), ev(2), ev(3)] })).events), [1, 2, 3]);
  const fresh = mergeLatestHistory([], hostHistoryPage({ hasMore: true, events: [ev(9)] }));
  assert.deepEqual(seqs(fresh.events), [9]);
  assert.equal(fresh.keptOlder, false);
});

test('historyQuery pages like dsh web (50 messages)', () => {
  assert.deepEqual(historyQuery('s1'), { sessionId: 's1', maxMessages: HISTORY_PAGE_MESSAGES });
  assert.deepEqual(historyQuery('s1', { beforeSeq: 9 }), { sessionId: 's1', maxMessages: 50, beforeSeq: 9 });
});

test('hostHistoryPage maps hasMore onto beforeSeq of the oldest event', () => {
  const page = hostHistoryPage({
    hasMore: true,
    events: [
      { event: { type: 'user/message', seq: 40 } },
      { event: { type: 'assistant/message', seq: 41 } },
    ],
    projections: { asOfSeq: 41, values: { title: 't' } },
  });
  assert.equal(page.hasOlder, true);
  assert.equal(page.beforeSeq, 40);
  assert.equal(page.events.length, 2);
});

test('runningFromHistoryEvents uses the newest turn/start or turn/end', () => {
  assert.equal(runningFromHistoryEvents([]), null);
  assert.equal(runningFromHistoryEvents([{ event: { type: 'user/message', seq: 1 } }]), null);
  assert.equal(runningFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'assistant/message', seq: 2 } },
  ]), true);
  assert.equal(runningFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'assistant/message', seq: 2 } },
    { event: { type: 'turn/end', seq: 3 } },
  ]), false);
});

test('mergeOlderHistory prepends and dedups by seq', () => {
  const current = [{ event: { seq: 10 } }, { event: { seq: 11 } }];
  const older = [{ event: { seq: 8 } }, { event: { seq: 10 } }, { event: { seq: 9 } }];
  const merged = mergeOlderHistory(older, current);
  assert.deepEqual(merged.map((entry) => entry.event.seq), [8, 9, 10, 11]);
});

test('pendingFromHistoryEvents keeps unanswered approval/asked', () => {
  const pending = pendingFromHistoryEvents([
    { event: { type: 'turn/start', seq: 1 } },
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh', reason: 'outside workspace' } } },
  ], 's1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].approvalId, 'a1');
  assert.equal(pending[0].sessionId, 's1');
  assert.equal(pending[0].title, 'pwsh');
  assert.equal(pending[0].command, 'outside workspace');
});

test('pendingFromHistoryEvents drops asked after approval/decided', () => {
  const pending = pendingFromHistoryEvents([
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh' } } },
    { event: { type: 'approval/decided', seq: 3, data: { id: 'a1', outcome: 'rejected' } } },
  ]);
  assert.deepEqual(pending, []);
});

test('mergeApprovalPending prefers live mux rpcId over history stubs', () => {
  const fromHistory = pendingFromHistoryEvents([
    { event: { type: 'approval/asked', seq: 2, data: { id: 'a1', toolName: 'pwsh', reason: 'r' } } },
  ], 's1');
  const merged = mergeApprovalPending([
    { rpcId: 'live-rpc', approvalId: 'a1', title: 'pwsh', command: 'r', sessionId: 's1' },
  ], fromHistory);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rpcId, 'live-rpc');
});
