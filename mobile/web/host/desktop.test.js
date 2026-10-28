import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childPath,
  diffView,
  fileArgs,
  fileEntries,
  filePage,
  fileReadArgs,
  fileSize,
  imagePreview,
  isImagePath,
  mcpRequest,
  mcpRows,
  mcpTestMessage,
  parentPath,
  pathSegments,
  pluginResultMessage,
  pluginView,
  skillRows,
  skillScope,
} from './desktop.js';

test('file requests stay scoped to the open session', () => {
  assert.deepEqual(fileArgs('s1', ''), { args: { workspaceFileScopeId: 's1', path: '.' } });
  assert.deepEqual(fileReadArgs('s1', 'src/a.js', 201), {
    args: { workspaceFileScopeId: 's1', path: 'src/a.js', range: { offset: 201, limit: 200 } },
  });
  assert.throws(() => fileArgs('', 'x'), /先打开/);
});

test('fileEntries sorts folders first and refuses traversal names', () => {
  const rows = fileEntries({
    entries: [
      { name: 'b.txt', type: 'file', size: 10 },
      { name: 'src', type: 'directory' },
      { name: '..', type: 'directory' },
      { name: 'A.md', type: 'file' },
      { name: 'sock', type: 'other' },
    ],
  }, 'pkg');
  assert.deepEqual(rows.map((row) => [row.path, row.kind]), [
    ['pkg/src', 'directory'], ['pkg/A.md', 'file'], ['pkg/b.txt', 'file'], ['pkg/sock', 'other'],
  ]);
  assert.throws(() => childPath('', 'a/b'), /无效/);
});

test('path helpers build breadcrumbs and parents', () => {
  assert.equal(parentPath('a/b/c'), 'a/b');
  assert.equal(parentPath('a'), '');
  assert.deepEqual(pathSegments('a/b').map((part) => part.path), ['', 'a', 'a/b']);
  assert.equal(isImagePath('x/Logo.PNG'), true);
  assert.equal(isImagePath('x/logo.svg'), false);
  assert.equal(fileSize(2048), '2 KB');
  assert.equal(fileSize(undefined), '大小未知');
});

test('file pages and images keep the service metadata', () => {
  assert.deepEqual(filePage({ text: 'a\nb', offset: 1, lines: 2, bytes: 4, eof: true }, 'f'), {
    kind: 'text', path: 'f', text: 'a\nb', offset: 1, lines: 2, bytes: 4, eof: true,
  });
  assert.equal(imagePreview({ mediaType: 'image/png', data: 'aGk=', bytes: 2 }, 'p.png').kind, 'image');
  assert.throws(() => imagePreview({ mediaType: 'text/plain', data: 'x' }, 'p'), /图片无效/);
});

test('diffView counts lines and rejects a non-diff answer', () => {
  const view = diffView({
    files: [{ path: 'a.js', status: 'modified', hunks: [{ header: '@@', lines: [{ kind: 'add', text: 'x' }, { kind: 'del', text: 'y' }, { kind: 'add', text: 'z' }] }] }],
    truncated: true,
  });
  assert.equal(view.files[0].additions, 2);
  assert.equal(view.files[0].deletions, 1);
  assert.equal(view.truncated, true);
  assert.throws(() => diffView(null), /无法读取差异/);
});

test('MCP rows expose health, tools and writability', () => {
  const [row] = mcpRows({ servers: [{ id: 'm1', writable: true, enabled: false, fiberPhase: 'failed', spec: { serverName: 'fs', transport: 'stdio' }, connection: { health: 'failed', lastError: 'ENOENT', tools: ['mcp__fs__read'] } }] });
  assert.deepEqual(row, { id: 'm1', name: 'fs', transport: 'stdio', enabled: false, writable: true, health: 'failed', lastError: 'ENOENT', tools: ['mcp__fs__read'] });
  assert.deepEqual(mcpRequest('setEnabled', 'm1', true), ['mcpServers.setEnabled', { args: { request: { id: 'm1', enabled: true } } }]);
  assert.deepEqual(mcpRequest('retry', 'm1'), ['mcpServers.retry', { args: { request: { id: 'm1' } } }]);
  assert.equal(mcpTestMessage({ ok: true, toolCount: 3, elapsedMs: 41.2 }), '连接正常 · 3 个工具 · 41 ms');
});

test('skills and plugins keep only identified rows', () => {
  assert.deepEqual(skillScope('/w', ''), { cwd: '/w' });
  assert.deepEqual(skillScope('/w', 's'), { cwd: '/w', sessionId: 's' });
  assert.equal(skillRows({ skills: [{ name: 'a', groups: ['x', 1] }, { description: 'nameless' }] })[0].groups.length, 1);
  const view = pluginView({
    inventory: { managementAvailable: true },
    plugins: [{ entryId: 'p1', moduleName: 'mod', patchId: 'x', enabled: true }, { moduleName: 'no id' }],
    bundles: [{ name: 'b', availability: 'missing' }],
  });
  assert.equal(view.manageable, true);
  assert.equal(view.plugins.length, 1);
  assert.equal(view.plugins[0].editable, true);
  assert.equal(view.bundles[0].editable, false);
  assert.equal(view.bundles[0].readOnlyReason, '插件包未安装');
  assert.equal(pluginResultMessage({ application: 'restart-required', restartReason: '内核插件' }), '修改已保存，电脑端重启后生效：内核插件');
});
