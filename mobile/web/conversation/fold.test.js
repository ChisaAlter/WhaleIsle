import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvents, toolDetailView } from './fold.js';

test('foldEvents builds user, assistant, and tool bubbles', () => {
  const rows = foldEvents([
    {
      event: {
        type: 'user/message',
        seq: 1,
        time: 1,
        data: { id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
      },
    },
    {
      event: { type: 'assistant/chunk', seq: 2, time: 2, data: { chunk: { type: 'text', text: '帮' } } },
    },
    {
      event: { type: 'assistant/chunk', seq: 3, time: 3, data: { chunk: { type: 'text', text: '你' } } },
    },
    {
      event: {
        type: 'assistant/message',
        seq: 4,
        time: 4,
        data: { message: { content: [{ type: 'text', text: '帮你' }] } },
      },
    },
    {
      event: { type: 'tool/call', seq: 5, time: 5, data: { name: 'read_file', callId: 'c1' } },
      view: { for: 'call', view: { card: 'read_file' } },
    },
  ]);
  assert.equal(rows[0].role, 'user');
  assert.equal(rows[0].text, '你好');
  assert.deepEqual(rows[0].images, []);
  assert.equal(rows[1].role, 'assistant');
  assert.equal(rows[1].text, '帮你');
  assert.equal(rows[2].role, 'tool');
  assert.equal(rows[2].card, 'read_file');
});

test('foldEvents keeps attachment-only history images for lazy reads', () => {
  const rows = foldEvents([{
    event: {
      type: 'user/message', seq: 3,
      data: {
        source: { kind: 'user' },
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png' } },
        ],
      },
    },
  }]);
  assert.deepEqual(rows[0].images, [{ mediaType: 'image/png', data: '', attachmentId: 'att-1' }]);
});

// 对应 Android Fold.kt imagesFromBlocks。
test('foldEvents keeps image blocks on user bubbles', () => {
  const rows = foldEvents([
    {
      event: {
        type: 'user/message',
        seq: 1,
        data: {
          id: 'm1',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: '看这张图' },
            { type: 'image', mediaType: 'image/png', data: 'aGk=' },
            { type: 'image', mediaType: 'image/jpeg' },
          ],
        },
      },
    },
  ]);
  assert.equal(rows[0].text, '看这张图');
  assert.deepEqual(rows[0].images, [{ mediaType: 'image/png', data: 'aGk=' }]);
});

test('foldEvents renders ChisaCode projected timeline entries', () => {
  const rows = foldEvents([
    { seqStart: 1, item: { type: 'user_message', messageId: 'u1', text: '检查远程' } },
    { seqStart: 2, item: { type: 'assistant_message', messageId: 'a1', text: '正在检查' } },
    {
      seqStart: 3,
      item: {
        type: 'tool_call',
        callId: 'tool-1',
        name: 'read',
        status: 'completed',
      },
    },
    { seqStart: 4, item: { type: 'error', message: '连接中断' } },
  ]);

  assert.deepEqual(rows.map(row => [row.role, row.text, row.card || '']), [
    ['user', '检查远程', ''],
    ['assistant', '正在检查', ''],
    ['tool', 'read', '完成'],
    ['error', '连接中断', ''],
  ]);
});

test('foldEvents keeps todo, compaction, turn_changes, and unknown items visible', () => {
  const rows = foldEvents([
    {
      seqStart: 1,
      item: {
        type: 'todo',
        items: [
          { text: '写测试', completed: true },
          { text: '跑测试', completed: false },
        ],
      },
    },
    { seqStart: 2, item: { type: 'compaction', status: 'completed' } },
    {
      seqStart: 3,
      item: {
        type: 'turn_changes',
        changeSummary: '改了两个文件',
        changedFiles: [{ path: 'a.js', additions: 3, deletions: 1 }],
      },
    },
    { seqStart: 4, item: { type: 'reasoning', text: '思考中' } },
    { seqStart: 5, item: { type: 'generative_ui', title: '图表' } },
    { seqStart: 6, item: { type: 'brand_new_kind' } },
  ]);

  assert.equal(rows[0].role, 'todo');
  assert.deepEqual(rows[0].items, [
    { text: '写测试', completed: true },
    { text: '跑测试', completed: false },
  ]);
  assert.deepEqual([rows[1].role, rows[1].text], ['meta', '上下文已压缩']);
  assert.equal(rows[2].role, 'changes');
  assert.deepEqual(rows[2].files, [{ path: 'a.js', additions: 3, deletions: 1 }]);
  assert.deepEqual([rows[3].role, rows[3].text], ['reasoning', '思考中']);
  assert.match(rows[4].text, /图表/);
  assert.deepEqual([rows[5].role, rows[5].text], ['meta', '暂不支持的消息类型：brand_new_kind']);
});

test('toolDetailView summarizes each detail shape and keeps unknowns visible', () => {
  assert.deepEqual(toolDetailView({ type: 'shell', command: 'npm test', output: 'ok' }), {
    summary: 'npm test', body: 'ok', bodyKind: 'code',
  });
  assert.deepEqual(toolDetailView({ type: 'edit', filePath: 'a.js', unifiedDiff: '+x' }), {
    summary: 'a.js', body: '+x', bodyKind: 'code',
  });
  assert.deepEqual(
    toolDetailView({ type: 'search', query: 'foo', numMatches: 2, numFiles: 1, filePaths: ['a.js'] }),
    { summary: 'foo — 2 处匹配 · 1 个文件', body: 'a.js', bodyKind: 'code' },
  );
  assert.deepEqual(toolDetailView({ type: 'plan', text: '# plan' }), {
    summary: '', body: '# plan', bodyKind: 'markdown',
  });
  assert.equal(
    toolDetailView({ type: 'sub_agent', description: '子任务', childSessionId: 'c1' }).childSessionId,
    'c1',
  );
  assert.deepEqual(toolDetailView({ type: 'mystery', input: { a: 1 } }), {
    summary: 'mystery', body: JSON.stringify({ a: 1 }, null, 2), bodyKind: 'code',
  });
  assert.equal(toolDetailView(null), null);
});
