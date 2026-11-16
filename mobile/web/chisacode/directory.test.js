import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentPageInfo,
  archiveMobileAgent,
  deleteMobileAgent,
  directSubagentRows,
  groupSessionRows,
  isReadOnlyRow,
  listArchivedAgents,
  mergeAgentRows,
  regenerateMobileTitle,
  renameMobileAgent,
  subagentSheetItems,
  unarchiveMobileAgent,
  visibleSessionRows,
} from './directory.js';

function row(id, agent = {}) {
  return { sessionId: id, chisacodeAgent: { id, ...agent } };
}

test('agentPageInfo reads pageInfo and degrades to no-more without it', () => {
  assert.deepEqual(
    agentPageInfo({ pageInfo: { nextCursor: 'c1', hasMore: true } }),
    { nextCursor: 'c1', hasMore: true },
  );
  // hasMore without a cursor is unusable — treat as done, not an infinite spinner.
  assert.deepEqual(
    agentPageInfo({ pageInfo: { nextCursor: null, hasMore: true } }),
    { nextCursor: null, hasMore: false },
  );
  assert.deepEqual(agentPageInfo({}), { nextCursor: null, hasMore: false });
  assert.deepEqual(agentPageInfo(undefined), { nextCursor: null, hasMore: false });
});

test('mergeAgentRows appends new rows and lets the daemon copy win on repeats', () => {
  const existing = [row('a', { title: 'old' }), row('b')];
  const incoming = [row('a', { title: 'new' }), row('c')];
  const merged = mergeAgentRows(existing, incoming);
  assert.deepEqual(merged.map((item) => item.sessionId), ['a', 'b', 'c']);
  assert.equal(merged[0].chisacodeAgent.title, 'new');
  // The input arrays are not mutated.
  assert.equal(existing[0].chisacodeAgent.title, 'old');
});

test('groupSessionRows hides subagents and counts them on the loaded parent', () => {
  // Desktop ui-workspace excludes subagent sessions from the sidebar
  // entirely; the drawer mirrors that and only keeps a count hint.
  const parent = row('p1');
  const child = row('s1', { relation: { kind: 'subagent', parentAgentId: 'p1' } });
  const solo = row('x1');
  const groups = groupSessionRows([parent, solo, child]);
  assert.deepEqual(groups.map((group) => group.row.sessionId), ['p1', 'x1']);
  assert.equal(groups[0].subagentCount, 1);
  assert.equal(groups[1].subagentCount, 0);
});

test('groupSessionRows hides orphan subagents (desktop sidebar parity)', () => {
  // Desktop ui-workspace does not list subagent sessions whose parent is
  // gone (deleted/archived). D = P requires the drawer to hide them too.
  const orphan = row('s9', { relation: { kind: 'subagent', parentAgentId: 'missing' } });
  const groups = groupSessionRows([orphan]);
  assert.equal(groups.length, 0);
  const byOrigin = { sessionId: 's10', origin: 'subagent', parentSessionId: 'missing' };
  assert.equal(groupSessionRows([byOrigin]).length, 0);
});

test('groupSessionRows keeps orphan forks top-level (desktop shows them ungrouped)', () => {
  // A fork carries parentSessionId but is a normal session; when its parent
  // is deleted/archived the desktop still lists it, so must the drawer.
  const fork = { sessionId: 'f1', parentSessionId: 'gone-parent', projections: { values: { title: 'SEED' } } };
  const groups = groupSessionRows([fork]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].row.sessionId, 'f1');
  assert.equal(groups[0].subagentCount, 0);
});

test('groupSessionRows keeps forks top-level when their parent is still loaded', () => {
  const parent = { sessionId: 'p1', projections: { values: { title: '原会话' } } };
  const fork = {
    sessionId: 'f1',
    parentSessionId: 'p1',
    projections: { values: { title: '原会话 (1)' } },
  };
  const groups = groupSessionRows([parent, fork]);
  assert.deepEqual(groups.map((group) => group.row.sessionId), ['p1', 'f1']);
  assert.equal(groups[0].subagentCount, 0);
});

test('groupSessionRows leaves non-subagent relations top-level', () => {
  const parent = row('p1');
  const handoff = row('h1', { relation: { kind: 'handoff', parentAgentId: 'p1' } });
  const groups = groupSessionRows([parent, handoff]);
  assert.deepEqual(groups.map((group) => group.row.sessionId), ['p1', 'h1']);
  assert.equal(groups[0].subagentCount, 0);
});

test('groupSessionRows counts host parentSessionId children on the parent', () => {
  const groups = groupSessionRows([
    { sessionId: 'live-1' },
    { sessionId: 'child-1', parentSessionId: 'live-1', origin: 'subagent' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].row.sessionId, 'live-1');
  assert.equal(groups[0].subagentCount, 1);
});

test('visibleSessionRows drops subagents but keeps forks and plain rows', () => {
  const rows = [
    { sessionId: 'p' },
    { sessionId: 's', parentSessionId: 'p', origin: 'subagent' },
    { sessionId: 'f', parentSessionId: 'p' },
  ];
  assert.deepEqual(visibleSessionRows(rows).map((item) => item.sessionId), ['p', 'f']);
});

test('directSubagentRows lists only direct children, never grandchildren', () => {
  const rows = [
    { sessionId: 'root' },
    { sessionId: 'mid', parentSessionId: 'root', origin: 'subagent' },
    { sessionId: 'leaf', parentSessionId: 'mid', origin: 'subagent' },
  ];
  assert.deepEqual(directSubagentRows(rows, 'root').map((item) => item.sessionId), ['mid']);
  assert.deepEqual(directSubagentRows(rows, 'mid').map((item) => item.sessionId), ['leaf']);
  assert.deepEqual(directSubagentRows(rows, 'leaf'), []);
});

test('directSubagentRows dedupes by session id and sorts by recency', () => {
  const rows = [
    { sessionId: 'p' },
    { sessionId: 'old', parentSessionId: 'p', origin: 'subagent', lastActivityAt: '2026-01-01T00:00:00Z' },
    { sessionId: 'new', parentSessionId: 'p', origin: 'subagent', lastActivityAt: '2026-02-01T00:00:00Z' },
    { sessionId: 'old', parentSessionId: 'p', origin: 'subagent', lastActivityAt: '2026-03-01T00:00:00Z' },
  ];
  assert.deepEqual(directSubagentRows(rows, 'p').map((item) => item.sessionId), ['new', 'old']);
});

test('directSubagentRows keeps list order when no timestamps exist', () => {
  const rows = [
    { sessionId: 'p' },
    { sessionId: 'b', parentSessionId: 'p', origin: 'subagent' },
    { sessionId: 'a', parentSessionId: 'p', origin: 'subagent' },
  ];
  assert.deepEqual(directSubagentRows(rows, 'p').map((item) => item.sessionId), ['b', 'a']);
});

test('subagentSheetItems merges loaded rows with catalog entries, deduped and ordered', () => {
  const rows = [
    { sessionId: 'p' },
    { sessionId: 'c1', parentSessionId: 'p', origin: 'subagent', running: true, lastActivityAt: '2026-02-01T00:00:00Z' },
    { sessionId: 'c9', parentSessionId: 'p', origin: 'subagent', lastActivityAt: '2026-01-01T00:00:00Z' },
  ];
  const entries = [
    { kind: 'child', id: 'c2', mode: 'one-shot', activity: 'inactive', hasChildren: false, label: '外部子任务' },
    { kind: 'child', id: 'c1', mode: 'continuable', activity: 'running', hasChildren: true, label: 'c1 label' },
    { kind: 'diagnostic', id: 'c1', reason: 'corrupt' },
  ];
  const items = subagentSheetItems(rows, 'p', entries);
  // Catalog order first (c2 then c1), loaded-only children after (c9); the
  // duplicate diagnostic id never creates a second c1 item.
  assert.deepEqual(items.map((item) => item.sessionId), ['c2', 'c1', 'c9']);
  const c1 = items.find((item) => item.sessionId === 'c1');
  assert.equal(c1.row.sessionId, 'c1');
  assert.equal(c1.mode, 'continuable');
  assert.equal(c1.hasChildren, true);
  assert.equal(c1.running, true);
  assert.equal(items[0].row, null);
  assert.equal(items[0].entry.label, '外部子任务');
});

test('subagentSheetItems appends diagnostic entries last as unreadable items', () => {
  const items = subagentSheetItems(
    [{ sessionId: 'p' }],
    'p',
    [
      { kind: 'diagnostic', id: 'bad', reason: 'corrupt' },
      { kind: 'child', id: 'c1', mode: 'one-shot', activity: 'inactive' },
    ],
  );
  assert.deepEqual(items.map((item) => item.sessionId), ['c1', 'bad']);
  assert.equal(items[1].diagnostic, 'corrupt');
  assert.equal(items[0].diagnostic, '');
});

test('isReadOnlyRow marks host subagents and archived rows', () => {
  assert.equal(isReadOnlyRow({ sessionId: 'a', origin: 'subagent', parentSessionId: 'p' }), true);
  assert.equal(isReadOnlyRow({ sessionId: 'a', archived: true }), true);
});

test('isReadOnlyRow keeps forked sessions writable', () => {
  assert.equal(isReadOnlyRow({ sessionId: 'fork', parentSessionId: 'parent' }), false);
});

test('isReadOnlyRow marks subagents and archived agents read-only', () => {
  assert.equal(isReadOnlyRow(row('a')), false);
  assert.equal(isReadOnlyRow(row('a', { relation: { kind: 'subagent', parentAgentId: 'p' } })), true);
  assert.equal(isReadOnlyRow(row('a', { archivedAt: '2026-08-27T00:00:00Z' })), true);
  assert.equal(isReadOnlyRow({ sessionId: 'legacy' }), false);
});

test('listArchivedAgents asks for archived history and keeps only archived rows', async () => {
  const calls = [];
  const client = {
    async fetchAgentHistory(options) {
      calls.push(options);
      return {
        entries: [
          { agent: { id: 'a1', title: '归档的', archivedAt: '2026-08-26T00:00:00Z' } },
          { agent: { id: 'a2', title: '活跃的' } },
        ],
        pageInfo: { nextCursor: 'c2', hasMore: true },
      };
    },
  };
  const result = await listArchivedAgents(client, { cursor: 'c1', limit: 10 });
  assert.deepEqual(calls, [{
    sort: [{ key: 'updated_at', direction: 'desc' }],
    filter: { includeArchived: true },
    page: { limit: 10, cursor: 'c1' },
  }]);
  assert.deepEqual(result.rows.map((item) => item.sessionId), ['a1']);
  assert.equal(result.nextCursor, 'c2');
  assert.equal(result.hasMore, true);
});

test('listArchivedAgents first page sends no cursor', async () => {
  const calls = [];
  const client = {
    async fetchAgentHistory(options) {
      calls.push(options);
      return { entries: [] };
    },
  };
  await listArchivedAgents(client);
  assert.deepEqual(calls[0].page, { limit: 50 });
});

test('lifecycle actions forward to the daemon and propagate errors', async () => {
  const calls = [];
  const client = {
    async archiveAgent(id) { calls.push(['archive', id]); },
    async deleteAgent(id) { calls.push(['delete', id]); },
    async updateAgent(id, patch) { calls.push(['update', id, patch]); },
    async refreshAgent(id) { calls.push(['refresh', id]); },
  };
  await archiveMobileAgent(client, 'a1');
  await deleteMobileAgent(client, 'a1');
  await renameMobileAgent(client, 'a1', '  新名字  ');
  await regenerateMobileTitle(client, 'a1');
  await unarchiveMobileAgent(client, 'a1');
  assert.deepEqual(calls, [
    ['archive', 'a1'],
    ['delete', 'a1'],
    ['update', 'a1', { name: '新名字' }],
    ['update', 'a1', { regenerateTitle: true }],
    ['refresh', 'a1'],
  ]);

  const failing = {
    async deleteAgent() { throw new Error('daemon 拒绝'); },
  };
  await assert.rejects(() => deleteMobileAgent(failing, 'a1'), /daemon 拒绝/);
});

test('lifecycle actions reject missing agent ids and empty names locally', async () => {
  await assert.rejects(() => archiveMobileAgent({}, ''), /缺少会话 ID/);
  await assert.rejects(() => renameMobileAgent({}, 'a1', '   '), /会话名称不能为空/);
});
