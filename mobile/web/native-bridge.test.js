import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNativeBootstrapEpoch, projectNativeApproval, projectNativeRows, projectNativeSnapshot, validateNativeAction } from './native-bridge.js';

// #442: the native bootstrap/action bridge moved from app.js to app/native.js,
// and renderComposer to app/composer.js; the assertions below pin those files.
const splitSource = (...files) => files.map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');

test('native snapshots wait for a valid per-document bootstrap epoch', () => {
  const epoch = '572d2231-8950-47fe-8052-8b2933574781';
  assert.equal(isNativeBootstrapEpoch(epoch), true);
  assert.equal(isNativeBootstrapEpoch(epoch.toUpperCase()), true);
  assert.equal(isNativeBootstrapEpoch(''), false);
  assert.equal(isNativeBootstrapEpoch('not-a-uuid'), false);
  assert.equal(isNativeBootstrapEpoch('00000000-0000-0000-0000-000000000000'), false);
  const app = splitSource('./app.js', './app/native.js');
  assert.match(app, /if \(!nativeAndroidApp \|\| !nativeSnapshotEpoch \|\| nativeSnapshotQueued\) return;/);
  assert.match(app, /if \(!nativeSnapshotEpoch \|\| typeof bridge\?\.postMessage !== 'function'\) return;/);
  assert.match(app, /window\.__dshdNativeBootstrap = \(epoch\) => \{[\s\S]*?scheduleNativeSnapshot\(\);\s*return true;/);
  assert.match(app, /seq: \+\+nativeSnapshotSeq, epoch: nativeSnapshotEpoch/);
  const state = { sessionId: '', sessions: [], timelinePage: {}, permission: {}, pendingApprovals: [] };
  const inputs = { state, rows: [], title: '', draft: '', model: '', permission: '', readOnly: '' };
  assert.equal(projectNativeSnapshot(inputs).epoch, '');
  assert.equal(projectNativeSnapshot({ ...inputs, epoch }).epoch, epoch);
});

test('native draft keeps web composer current without publishing a timeline snapshot per keypress', () => {
  const app = splitSource('./app.js', './app/native.js', './app/composer.js');
  assert.match(app, /function renderComposer\(\{ nativeSnapshot = true \} = \{\}\)/);
  assert.match(app, /if \(nativeSnapshot\) scheduleNativeSnapshot\(\)/);
  assert.match(app, /case 'draft':\s*draft\.value = action\.text;[\s\S]*?draftStore\?\.save\(action\.sessionId, action\.text\);\s*renderComposer\(\{ nativeSnapshot: false \}\);/);
  assert.match(app, /if \(action\.type !== 'draft'\) scheduleNativeSnapshot\(\)/);
});

test('native timeline only projects explicit plain text, never image data or tool payloads', () => {
  const rows = projectNativeRows([
    { id: 'u', role: 'user', text: '', images: [{ data: 'BASE64_SECRET' }] },
    { id: 't', role: 'tool', text: 'read_file', call: { argsRaw: 'PASSWORD_SECRET', result: 'OUTPUT_SECRET' }, detail: { body: 'DETAIL_SECRET' } },
    { id: 'p', role: 'turn-process', toolCalls: 2, messages: 1, subagents: 0, rows: [{ text: 'NESTED_SECRET' }] },
    { id: 'r', role: 'reasoning', text: 'PRIVATE_REASONING_SECRET', running: true },
    { id: 'a', role: 'assistant', text: '完成', running: false },
  ]);
  assert.deepEqual(rows.map(({ role, text }) => [role, text]), [
    ['user', '图片附件'], ['tool', 'read_file · 完成'], ['meta', '2 次工具调用 · 1 条消息'],
    ['meta', '思考中…'], ['assistant', '完成'],
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /BASE64_SECRET|PASSWORD_SECRET|OUTPUT_SECRET|DETAIL_SECRET|NESTED_SECRET|PRIVATE_REASONING_SECRET/);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'role', 'text', 'running']);
});

test('older WebViews without Array.findLastIndex still project the newest assistant reply', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'findLastIndex');
  Object.defineProperty(Array.prototype, 'findLastIndex', { configurable: true, value: undefined });
  try {
    const reply = 'x'.repeat(10_000);
    const rows = projectNativeRows([
      { id: 'answer', role: 'assistant', text: reply },
      { id: 'status', role: 'meta', text: '完成' },
    ]);
    assert.equal(rows[0].text, reply);
    assert.equal(rows[1].text, '完成');
  } finally {
    if (descriptor) Object.defineProperty(Array.prototype, 'findLastIndex', descriptor);
    else delete Array.prototype.findLastIndex;
  }
});

test('snapshot has a bounded primitive schema and keeps credentials out', () => {
  const state = {
    connected: true, route: 'chat', transport: 'chisacode', connPhase: 'offline',
    hostName: '我的电脑', connLabel: '等待连接', sessionId: 's1',
    sessions: [{ sessionId: 's1', projections: { values: { title: 'Task' } }, running: true, cwd: 'C:\\repo' }],
    events: [{ token: 'EVENT_SECRET' }], chisacode: { key: 'CLIENT_SECRET' },
    timelinePage: { hasOlder: true }, permission: { planOn: true },
    pendingApprovals: [{ approvalId: 'a1', title: '执行命令', command: 'npm test', actions: [{ id: 'once', label: '允许一次' }] }],
  };
  const inputs = { state, rows: [{ id: 'm', role: 'assistant', text: '好' }], title: 'Task', draft: '草稿', model: 'model', permission: '默认' };
  const snapshot = projectNativeSnapshot({ ...inputs, readOnly: '' });
  assert.equal(snapshot.offline, true);
  assert.equal(snapshot.seq, 0);
  assert.equal(snapshot.sessions[0].title, 'Task');
  assert.equal(snapshot.approval.id, 'a1');
  assert.equal(snapshot.draft, '草稿');
  assert.equal(snapshot.readOnly, '');
  const archived = projectNativeSnapshot({ ...inputs, readOnly: '归档会话（只读）' });
  assert.equal(archived.readOnly, '归档会话（只读）');
  assert.equal(archived.approval, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /EVENT_SECRET|CLIENT_SECRET|"events"|"chisacode"/);
  assert.deepEqual(projectNativeApproval({ approvalId: 'legacy', legacy: true }).actions.map(({ id }) => id), ['rejected', 'allowed-once']);
  assert.equal(projectNativeApproval(state.pendingApprovals[0], true), null);
  assert.equal(projectNativeSnapshot({ ...inputs, state: { ...state, sessions: [{ sessionId: 'secret-id-123' }] } }).sessions[0].title, '未命名会话');
});

test('long histories stay below the Android receiver limit and preserve the newest reply', () => {
  const repeated = '\\'.repeat(8_000);
  const state = {
    connected: true, route: 'chat', sessionId: 'current',
    sessions: Array.from({ length: 500 }, (_, index) => ({
      sessionId: `session-${index}`, title: '\\'.repeat(256), cwd: '\\'.repeat(256),
    })),
    pendingApprovals: [], timelinePage: {}, permission: {},
  };
  const rows = Array.from({ length: 199 }, (_, index) => ({ id: `old-${index}`, role: 'assistant', text: repeated }));
  rows.push({ id: 'newest', role: 'assistant', text: '最新答复' + 'x'.repeat(31_000) });
  const snapshot = projectNativeSnapshot({ state, rows, title: 'long', draft: '', model: '', permission: '', readOnly: '' });
  assert.ok(JSON.stringify(snapshot).length <= 1_400_000);
  assert.equal(snapshot.rows.at(-1).id, 'newest');
  assert.ok(snapshot.rows.at(-1).text.endsWith('x'));
  assert.equal(snapshot.rows.length <= 200, true);
});

test('model and permission choices only expose bounded routable identifiers', () => {
  const state = {
    connected: true, route: 'chat', sessionId: 's1', sessions: [], pendingApprovals: [],
    timelinePage: {}, permission: { current: 'workspace-write', planOn: false },
    modelCatalog: {
      current: { provider: 'deepseek', model: 'v4', reasoningEffort: 'high', token: 'SECRET' },
      rows: [
        { provider: 'deepseek', id: 'v4', name: 'DeepSeek V4', reasoning: { efforts: [{ id: 'high', name: '高' }] }, apiKey: 'SECRET' },
        { provider: 'disabled', id: 'no', routable: false },
      ],
    },
  };
  const snapshot = projectNativeSnapshot({ state, rows: [], title: 'hi', draft: '', model: 'DeepSeek V4', permission: '可写入工作区',
    readOnly: '', permissionOptions: [{ id: 'workspace-write', label: '可写入工作区' }], seq: 4 });
  assert.equal(snapshot.seq, 4);
  assert.deepEqual(snapshot.modelCurrent, { provider: 'deepseek', id: 'v4', reasoningEffort: 'high' });
  assert.deepEqual(snapshot.modelOptions, [{ provider: 'deepseek', id: 'v4', label: 'DeepSeek V4', efforts: [{ id: 'high', label: '高' }] }]);
  assert.deepEqual(snapshot.permissionOptions, [{ id: 'workspace-write', label: '可写入工作区' }]);
  assert.equal(snapshot.permissionCurrent, 'workspace-write');
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET/);
});

const base = {
  connected: true, offline: false, sessions: [{ sessionId: 's1' }, { sessionId: 'archived', archived: true }],
  sessionId: 's1', running: true, readOnly: false, hasOlder: true, olderLoading: false,
  error: 'history failed', pending: false, sendBusy: false,
  approval: { sessionId: 's1', approvalId: 'approval-1', actions: [{ id: 'once', behavior: 'allow' }] },
  modelOptions: [{ provider: 'deepseek', id: 'v4', reasoning: { efforts: [{ id: 'high' }] } }, { provider: 'no', id: 'x', routable: false }],
  permissionOptions: [{ id: 'workspace-write' }], planOn: true,
};
const accept = (payload, context = base) => validateNativeAction(JSON.stringify(payload), context);

test('native actions enforce whitelist, current session, live ownership and pending approval identity', () => {
  assert.deepEqual(accept({ type: 'open', sessionId: 's1' }), { type: 'open', sessionId: 's1' });
  assert.equal(accept({ type: 'open', sessionId: 'archived' }), null);
  assert.equal(accept({ type: 'open', sessionId: 'unknown' }), null);
  assert.equal(accept({ type: 'send', sessionId: 'other', text: 'hi' }), null);
  assert.equal(accept({ type: 'send', sessionId: 's1', text: ' ' }), null);
  assert.deepEqual(accept({ type: 'send', sessionId: 's1', text: 'hello' }), { type: 'send', sessionId: 's1', text: 'hello' });
  assert.equal(accept({ type: 'send', sessionId: 's1', text: 'hello', privileged: true }), null);
  assert.equal(accept({ type: 'delete', sessionId: 's1' }), null);
  assert.equal(validateNativeAction('{', base), null);
  assert.equal(accept({ type: 'new' }, { ...base, offline: true }), null);
  assert.deepEqual(accept({ type: 'draft', sessionId: 's1', text: 'offline work' }, { ...base, offline: true }),
    { type: 'draft', sessionId: 's1', text: 'offline work' });
  assert.deepEqual(accept({ type: 'refresh' }, { ...base, connected: false }), { type: 'refresh' });
  assert.equal(accept({ type: 'cancel', sessionId: 's1' }, { ...base, running: false }), null);
  assert.equal(accept({ type: 'older', sessionId: 's1' }, { ...base, olderLoading: true }), null);
  assert.equal(accept({ type: 'retry', sessionId: 's1' }, { ...base, error: '' }), null);
  assert.deepEqual(accept({ type: 'draft', sessionId: 's1', text: 'x' }, { ...base, pending: true }),
    { type: 'draft', sessionId: 's1', text: 'x' });
  assert.equal(accept({ type: 'send', sessionId: 's1', text: 'x' }, { ...base, readOnly: true }), null);
  assert.equal(accept({ type: 'approve', sessionId: 's1', approvalId: 'wrong', actionId: 'once' }), null);
  assert.equal(accept({ type: 'approve', sessionId: 's1', approvalId: 'approval-1', actionId: 'not-offered' }), null);
  assert.deepEqual(accept({ type: 'approve', sessionId: 's1', approvalId: 'approval-1', actionId: 'once' }, { ...base, pending: true }),
    { type: 'approve', sessionId: 's1', approvalId: 'approval-1', actionId: 'once' });
  assert.equal(accept({ type: 'approve', sessionId: 's1', approvalId: 'approval-1', actionId: 'once' }, { ...base, approval: { ...base.approval, sessionId: 'other' } }), null);
  assert.deepEqual(accept({ type: 'model', sessionId: 's1', provider: 'deepseek', model: 'v4', reasoningEffort: 'high' }),
    { type: 'model', sessionId: 's1', provider: 'deepseek', model: 'v4', reasoningEffort: 'high' });
  assert.equal(accept({ type: 'model', sessionId: 's1', provider: 'no', model: 'x' }), null);
  assert.equal(accept({ type: 'model', sessionId: 's1', provider: 'deepseek', model: 'v4', reasoningEffort: 'unknown' }), null);
  assert.deepEqual(accept({ type: 'permission', sessionId: 's1', id: 'workspace-write' }),
    { type: 'permission', sessionId: 's1', id: 'workspace-write' });
  assert.equal(accept({ type: 'permission', sessionId: 's1', id: 'dangerous-custom' }), null);
  assert.deepEqual(accept({ type: 'planOff', sessionId: 's1' }), { type: 'planOff', sessionId: 's1' });
  assert.equal(accept({ type: 'planOff', sessionId: 's1' }, { ...base, planOn: false }), null);
  assert.deepEqual(accept({ type: 'slash', sessionId: 's1', line: '/help' }), { type: 'slash', sessionId: 's1', line: '/help' });
  assert.equal(accept({ type: 'slash', sessionId: 's1', line: 'npm test' }), null);
  assert.equal(accept({ type: 'model', sessionId: 's1', provider: 'deepseek', model: 'v4' }, { ...base, pending: true }), null);
  assert.equal(accept({ type: 'permission', sessionId: 'other', id: 'workspace-write' }), null);
});
