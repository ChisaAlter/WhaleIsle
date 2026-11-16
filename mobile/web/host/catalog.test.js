import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archivedSessionRows,
  heldSessionRow,
  liveSessionRows,
  withHeldLiveRow,
  workspaceChoices,
  workspaceDrawerSections,
  workspaceIdFromCreate,
  browseStartPath,
  insertSessionMove,
  presetChoices,
} from './catalog.js';

const sessions = {
  items: [
    {
      sessionId: 'live-1',
      blank: false,
      running: true,
      cwd: 'C:\\proj',
      updatedAt: 1767225600000,
      projections: { values: { title: '正在做的事' } },
    },
    { sessionId: 'blank-1', blank: true, running: false },
    {
      sessionId: 'titled-blank',
      blank: true,
      running: false,
      projections: { values: { title: '验证连接并生成验证码' } },
    },
    { sessionId: 'bot-1', blank: false, origin: 'dshbot', projections: { values: { title: 'bot' } } },
    {
      sessionId: 'arch-1',
      blank: false,
      projections: { values: { title: '旧会话' } },
    },
    {
      sessionId: 'child-1',
      blank: false,
      parentSessionId: 'live-1',
      origin: 'subagent',
      projections: { values: { title: '子任务' } },
    },
  ],
};

const workspaces = {
  items: [
    {
      workspaceId: 'ws-1',
      title: 'proj',
      path: 'C:\\proj',
      sessionIds: ['live-1', 'blank-1', 'arch-1', 'child-1', 'titled-blank'],
    },
  ],
  archivedSessionIds: ['arch-1'],
};

test('liveSessionRows hides blank, dshbot, and archived sessions', () => {
  const rows = liveSessionRows({ sessions, workspaces });
  assert.deepEqual(rows.map((row) => row.sessionId).sort(), ['child-1', 'live-1', 'titled-blank']);
  const live = rows.find((row) => row.sessionId === 'live-1');
  assert.equal(live.workspaceId, 'ws-1');
  assert.equal(live.cwd, 'C:\\proj');
  assert.equal(live.running, true);
  assert.equal(live.lastActivityAt, new Date(1767225600000).toISOString());
  const titled = rows.find((row) => row.sessionId === 'titled-blank');
  assert.equal(titled.blank, false);
  assert.equal(titled.projections.values.title, '验证连接并生成验证码');
});

test('archivedSessionRows only returns archived ids', () => {
  const rows = archivedSessionRows({ sessions, workspaces });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionId, 'arch-1');
  assert.equal(rows[0].archived, true);
});

test('archivedSessionRows keeps summary-less archived ids as 缺失会话', () => {
  const rows = archivedSessionRows({
    sessions,
    workspaces: { ...workspaces, archivedSessionIds: ['arch-1', 'ghost-1'] },
  });
  assert.deepEqual(rows.map((row) => row.sessionId), ['arch-1', 'ghost-1']);
  assert.equal(rows[1].projections.values.title, '缺失会话');
  assert.equal(rows[1].archived, true);
  assert.equal(rows[1].blank, false);
});

test('workspaceDrawerSections groups live rows under workspace.sessionIds order', () => {
  const live = [
    ...liveSessionRows({ sessions, workspaces }),
  ].reverse();
  const { sections, ungrouped } = workspaceDrawerSections(live, workspaces);
  assert.equal(sections[0].workspace.workspaceId, 'ws-1');
  assert.deepEqual(sections[0].rows.map((row) => row.sessionId), ['live-1', 'child-1', 'titled-blank']);
  assert.deepEqual(ungrouped, []);
});

test('browseStartPath uses the parent of the first registered workspace', () => {
  assert.equal(browseStartPath(workspaces), 'C:\\');
  assert.equal(browseStartPath({ items: [{ path: 'C:/Ai/Deepseek-Harness-Desktop' }] }), 'C:/Ai');
  assert.equal(browseStartPath({ items: [] }), '');
  assert.equal(browseStartPath(null), '');
});

test('presetChoices reads host roster.presets and hides broken rows', () => {
  assert.deepEqual(presetChoices({
    presets: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Broken', broken: true },
    ],
  }), [{ id: 'a', name: 'Alpha' }]);
  assert.deepEqual(presetChoices({ items: [{ id: 'legacy', name: 'L' }] }), []);
  assert.deepEqual(presetChoices([{ id: 'raw', name: 'Raw' }]), []);
  assert.deepEqual(presetChoices({ presets: [] }), []);
});

test('insertSessionMove steps one slot inside workspace.sessionIds', () => {
  const live = liveSessionRows({ sessions, workspaces });
  const row = { sessionId: 'child-1', workspaceId: 'ws-1' };
  assert.deepEqual(insertSessionMove(row, 'up', workspaces, live), {
    workspaceId: 'ws-1',
    sessionId: 'child-1',
    beforeSessionId: 'live-1',
  });
  assert.deepEqual(insertSessionMove(row, 'down', workspaces, live), {
    workspaceId: 'ws-1',
    sessionId: 'titled-blank',
    beforeSessionId: 'child-1',
  });
  assert.equal(insertSessionMove({ sessionId: 'live-1', workspaceId: 'ws-1' }, 'up', workspaces, live), null);
  assert.equal(insertSessionMove({ sessionId: 'lone', workspaceId: '' }, 'down', workspaces, live), null);
});

test('heldSessionRow keeps the open blank session that liveSessionRows hides', () => {
  const held = heldSessionRow({ sessions, workspaces, sessionId: 'blank-1' });
  assert.equal(held.sessionId, 'blank-1');
  assert.equal(held.blank, true);
  assert.equal(held.workspaceId, 'ws-1');
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: 'bot-1' }), null);
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: 'arch-1' }), null);
  assert.equal(heldSessionRow({ sessions, workspaces, sessionId: '' }), null);
});

test('withHeldLiveRow only inserts a non-blank held session', () => {
  const live = liveSessionRows({ sessions, workspaces });
  const blankHeld = heldSessionRow({ sessions, workspaces, sessionId: 'blank-1' });
  assert.deepEqual(withHeldLiveRow(live, blankHeld).map((row) => row.sessionId).sort(), live.map((row) => row.sessionId).sort());
  const promoted = { ...blankHeld, blank: false, projections: { values: { title: '连接完成并给出验证码' } } };
  const next = withHeldLiveRow(live, promoted);
  assert.equal(next.some((row) => row.sessionId === 'blank-1'), true);
  assert.equal(next.find((row) => row.sessionId === 'blank-1').blank, false);
});

test('workspaceIdFromCreate reads harness workspace.create nested view', () => {
  assert.equal(
    workspaceIdFromCreate({
      workspace: { workspaceId: '8b5c28dd-d551-42e0-8f65-35171c62c43e', path: 'C:\\tmp' },
      created: true,
    }),
    '8b5c28dd-d551-42e0-8f65-35171c62c43e',
  );
  assert.equal(workspaceIdFromCreate({ workspaceId: 'flat-id' }), 'flat-id');
  assert.equal(workspaceIdFromCreate({ workspace: { id: 'legacy' } }), 'legacy');
  assert.equal(workspaceIdFromCreate({ created: false }), '');
  assert.equal(workspaceIdFromCreate(null), '');
});

test('workspaceChoices maps host workspace.list plus the no-directory sentinel in the scratch cwd', () => {
  const { choices, noFolder } = workspaceChoices(workspaces, { home: 'C:\\Users\\t', scratchCwd: 'C:\\dsh\\none' });
  assert.equal(choices[0].id, 'ws-1');
  assert.equal(choices[0].cwd, 'C:\\proj');
  assert.equal(noFolder.id, '');
  assert.equal(noFolder.name, '无工作区文件夹');
  // Describe fallback when the baseline carries no scratch cwd.
  assert.equal(noFolder.cwd, 'C:\\dsh\\none');
  // The Workspace baseline value wins: it is what the desktop lists against.
  const fromBaseline = workspaceChoices({ ...workspaces, scratchCwd: 'C:\\dsh-home\\no-workspace' }, { scratchCwd: 'C:\\dsh\\none' });
  assert.equal(fromBaseline.noFolder.cwd, 'C:\\dsh-home\\no-workspace');
  assert.equal(fromBaseline.scratchCwd, 'C:\\dsh-home\\no-workspace');
  assert.equal(workspaceChoices(workspaces).noFolder.cwd, '');
});

test('desktop parity: only Workspace members and scratch-cwd tasks are listed; deleted-Workspace orphans hide until re-added', () => {
  const SCRATCH = 'C:\\dsh-home\\no-workspace';
  const catalog = {
    items: [
      { sessionId: 'member', blank: false, cwd: 'C:\\proj', projections: { values: { title: '成员' } } },
      { sessionId: 'task', blank: false, cwd: SCRATCH, projections: { values: { title: '无目录任务' } } },
      { sessionId: 'orphan', blank: false, cwd: 'C:\\deleted', projections: { values: { title: '孤儿' } } },
      { sessionId: 'orphan-archived', blank: false, cwd: 'C:\\deleted', projections: { values: { title: '孤儿归档' } } },
      { sessionId: 'task-archived', blank: false, cwd: SCRATCH, projections: { values: { title: '任务归档' } } },
    ],
  };
  const registered = {
    items: [{ workspaceId: 'ws-1', title: 'proj', path: 'C:\\proj', sessionIds: ['member'] }],
    archivedSessionIds: ['orphan-archived', 'task-archived', 'ghost'],
    scratchCwd: SCRATCH,
  };
  const live = liveSessionRows({ sessions: catalog, workspaces: registered });
  assert.deepEqual(live.map((row) => row.sessionId).sort(), ['member', 'task']);
  const { sections, ungrouped } = workspaceDrawerSections(live, registered);
  assert.deepEqual(sections[0].rows.map((row) => row.sessionId), ['member']);
  assert.deepEqual(ungrouped.map((row) => row.sessionId), ['task']);
  // Archived: orphan hidden, scratch task and the summary-less placeholder kept.
  assert.deepEqual(
    archivedSessionRows({ sessions: catalog, workspaces: registered }).map((row) => row.sessionId),
    ['task-archived', 'ghost'],
  );
  // Before the baseline supplies the scratch cwd nothing unaccounted is listed.
  const pending = { ...registered, scratchCwd: '' };
  assert.deepEqual(liveSessionRows({ sessions: catalog, workspaces: pending }).map((row) => row.sessionId), ['member']);
  // Registering the directory again brings its sessions back under that Workspace.
  const readded = {
    ...registered,
    items: [...registered.items, { workspaceId: 'ws-2', title: 'deleted', path: 'C:\\deleted', sessionIds: ['orphan', 'orphan-archived'] }],
  };
  const back = liveSessionRows({ sessions: catalog, workspaces: readded });
  assert.deepEqual(back.map((row) => row.sessionId).sort(), ['member', 'orphan', 'task']);
  assert.deepEqual(
    archivedSessionRows({ sessions: catalog, workspaces: readded }).map((row) => row.sessionId),
    ['orphan-archived', 'task-archived', 'ghost'],
  );
});
