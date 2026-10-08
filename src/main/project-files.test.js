'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const modulePromise = import(pathToFileURL(path.join(__dirname, '../../vendor/dsh-project/lib/files.js')).href);

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-project-files-'));
  const home = path.join(folder, 'home'), outside = path.join(folder, 'outside');
  fs.mkdirSync(home); fs.mkdirSync(outside);
  t.after(() => {
    assert.ok(path.resolve(folder).startsWith(path.join(os.tmpdir(), 'whale-project-files-')));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return { folder, home, outside };
}

test('Project directory and docs components reject a linked replacement root', async (t) => {
  const { home, outside } = fixture(t);
  const { projectDirectory, safeProjectSubdirectory } = await modulePromise;
  fs.writeFileSync(path.join(outside, 'sentinel'), 'user data');
  fs.symlinkSync(outside, path.join(home, 'projects'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(projectDirectory(home, 'project-one'), /link/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
  fs.unlinkSync(path.join(home, 'projects'));
  const project = await projectDirectory(home, 'project-one');
  fs.symlinkSync(outside, path.join(project, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safeProjectSubdirectory(home, 'project-one', 'docs', 'report'), /link/);
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
});

test('docs access does not widen through replaced workspace roots and remains available without a worktree', async (t) => {
  const { folder, home, outside } = fixture(t);
  const { safeProjectSubdirectory, checkedFile } = await modulePromise;
  const artifacts = await safeProjectSubdirectory(home, 'project-two', 'docs');
  const delivered = path.join(artifacts, 'result.txt'); fs.writeFileSync(delivered, 'result');
  const removedWorkspace = path.join(folder, 'removed-worktree');
  const result = await checkedFile(delivered, [removedWorkspace, artifacts]);
  assert.equal(result.size, 6);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  const swappedWorkspace = path.join(folder, 'swapped-workspace');
  fs.symlinkSync(outside, swappedWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(checkedFile(path.join(outside, 'private.txt'), [swappedWorkspace]), /replaced/);
  fs.mkdirSync(path.join(artifacts, '.git'));
  fs.writeFileSync(path.join(artifacts, '.git', 'config'), 'private git configuration');
  await assert.rejects(checkedFile(path.join(artifacts, '.git', 'config'), [artifacts]), /authorized/);
});

test('only one concurrent Project writer wins normal startup and dead-owner repair', async (t) => {
  const { home } = fixture(t);
  const { acquireWriter } = await modulePromise;
  const attempts = await Promise.allSettled([acquireWriter(home, 'first'), acquireWriter(home, 'second')]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  await attempts.find(item => item.status === 'fulfilled').value();
  const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(exited.status, 0);
  fs.writeFileSync(path.join(home, 'project-writer.lock'), JSON.stringify({ pid: exited.pid, generation: 'dead-owner' }));
  const repairs = await Promise.allSettled([acquireWriter(home, 'repair-one'), acquireWriter(home, 'repair-two'), acquireWriter(home, 'repair-three')]);
  assert.equal(repairs.filter(item => item.status === 'fulfilled').length, 1);
  await repairs.find(item => item.status === 'fulfilled').value();
});
