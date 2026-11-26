/**
 * Dedicated unit tests for `vendor/dsh-project/lib/scope-guard.js` (VEND-08).
 * Does not touch `store-and-tools.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createWorkerScopeGuard } from '../lib/scope-guard.js';

function makeService({ scopeCeiling, writePaths = [], workspace = path.resolve('repo') } = {}) {
  return {
    store: {
      getWorkerInfo(sid) {
        if (sid !== 'worker-1') return null;
        return {
          project: { id: 'proj-1', workspace },
          task: {
            id: 't-1',
            scopeCeiling,
            ...(writePaths.length > 0 ? { writePaths } : {}),
          },
        };
      },
    },
  };
}

const workerAgent = (cwd = path.resolve('repo')) => ({
  id: 'worker-1',
  session: { id: 'worker-1', header: { cwd } },
});

test('development with writePaths blocks shell/terminal tools and unknown-target write aliases', () => {
  const guard = createWorkerScopeGuard(makeService({
    scopeCeiling: 'development',
    writePaths: ['src/allowed.js', 'docs'],
  }));
  const agent = workerAgent();

  // Shell/terminal tools must be denied when writePaths restricts writable scope.
  for (const shellTool of ['bash', 'pwsh', 'run_code', 'shell', 'exec', 'terminal_run', 'job_start', 'custom_bash', 'Bash']) {
    const blocked = guard({ name: shellTool, arguments: { command: 'echo hi > package.json' }, agent });
    assert.match(String(blocked), /not permitted/i, `expected ${shellTool} to be blocked`);
  }

  // Write/edit/delete aliases outside writePaths must be denied.
  for (const toolName of [
    'write', 'write_file', 'fs_write', 'create_file',
    'edit', 'edit_file', 'fs_edit', 'multi_edit', 'replace_file',
    'str_replace_editor', 'str_replace_based_edit_tool',
    'delete', 'delete_file', 'remove_file', 'rm', 'unlink',
  ]) {
    const blocked = guard({ name: toolName, arguments: { file_path: 'src/other.js' }, agent });
    assert.match(String(blocked), /restricts writePaths/i, `expected ${toolName} outside writePaths to be blocked`);

    const blockedFilePathCamel = guard({ name: toolName, arguments: { filePath: 'src/other.js' }, agent });
    assert.match(String(blockedFilePathCamel), /restricts writePaths/i, `expected ${toolName} (filePath) outside writePaths to be blocked`);

    const allowed = guard({ name: toolName, arguments: { file_path: 'src/allowed.js' }, agent });
    assert.equal(allowed, undefined, `expected ${toolName} inside writePaths to be allowed`);
  }

  // Path traversal and .git escapes remain blocked.
  assert.match(String(guard({ name: 'write_file', arguments: { file_path: 'docs/../src/other.js' }, agent })), /not permitted/i);
  assert.match(String(guard({ name: 'write_file', arguments: { file_path: '.git/config' }, agent })), /not permitted/i);

  // multi_edit with per-edit target paths checks every entry.
  assert.match(String(guard({
    name: 'multi_edit',
    arguments: { edits: [{ path: 'src/allowed.js' }, { path: 'src/other.js' }] },
    agent,
  })), /not permitted/i);
  assert.equal(guard({
    name: 'multi_edit',
    arguments: { edits: [{ path: 'src/allowed.js' }, { path: 'docs/notes.md' }] },
    agent,
  }), undefined);
});

test('development without writePaths permits shell and file writes across workspace', () => {
  const guard = createWorkerScopeGuard(makeService({ scopeCeiling: 'development', writePaths: [] }));
  const agent = workerAgent();
  assert.equal(guard({ name: 'bash', arguments: { command: 'npm test' }, agent }), undefined);
  assert.equal(guard({ name: 'write_file', arguments: { file_path: 'src/anything.js' }, agent }), undefined);
});

test('docs ceiling enforces all write/edit/delete aliases and blocks non-doc extensions', () => {
  const guard = createWorkerScopeGuard(makeService({
    scopeCeiling: 'docs',
    writePaths: ['docs/guide.md'],
  }));
  const agent = workerAgent();

  assert.match(String(guard({ name: 'edit_file', arguments: { path: 'src/app.js' }, agent })), /not permitted/i);
  assert.match(String(guard({ name: 'rm', arguments: { path: 'docs/other.md' }, agent })), /outside allowed writePaths/i);
  assert.equal(guard({ name: 'edit_file', arguments: { path: 'docs/guide.md' }, agent }), undefined);
});
