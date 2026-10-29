'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWorkspaceAuthority } = require('./workspace-authority');
const { openWorkspacePath, setWorkspaceAuthority } = require('./git');

test('Finder opens the authorized workspace root, including a non-Git workspace, but rejects escapes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-reveal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const boot = path.join(dir, 'boot');
  const active = path.join(dir, 'active');
  const outside = path.join(dir, 'outside');
  for (const folder of [boot, active, outside, path.join(active, '.git')]) fs.mkdirSync(folder);
  fs.symlinkSync(outside, path.join(active, 'escape'), 'dir');
  setWorkspaceAuthority(createWorkspaceAuthority({ workspace: boot, extraWorkspaces: [active] }));
  t.after(() => setWorkspaceAuthority(null));
  const opened = [];
  const electron = require.resolve('electron');
  const previous = require.cache[electron];
  require.cache[electron] = { exports: { shell: { openPath: async target => { opened.push(target); return ''; } } } };
  t.after(() => { if (previous) require.cache[electron] = previous; else delete require.cache[electron]; });
  assert.equal((await openWorkspacePath(active, '.')).ok, true);
  assert.deepEqual(opened, [fs.realpathSync.native(active)]);
  for (const relative of ['../outside', 'escape', '.git']) {
    assert.equal((await openWorkspacePath(active, relative)).ok, false, relative);
  }
  assert.equal((await openWorkspacePath(outside, '.')).ok, false);
  assert.equal(opened.length, 1);
});
