import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { runtimeArchiveEntries, writeRuntimeArchive } = require('./runtime-archive.js');
const tar = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-runtime-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function tree(root, files, time) {
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    fs.utimesSync(file, time, time);
  }
  return root;
}

const files = {
  'apps/web/index.js': 'web',
  'node_modules/.dsh-instances/b/index.js': 'b',
  'node_modules/.dsh-instances/a/index.js': 'a',
  'packages/client/lib/client.js': 'client',
  'package.json': '{}',
};

test('runtime entries put the third-party store first, parents before children', (t) => {
  const root = tree(scratch(t), files, 1_700_000_000);
  assert.deepEqual(runtimeArchiveEntries(root), [
    './node_modules',
    './node_modules/.dsh-instances',
    './node_modules/.dsh-instances/a',
    './node_modules/.dsh-instances/a/index.js',
    './node_modules/.dsh-instances/b',
    './node_modules/.dsh-instances/b/index.js',
    './apps',
    './apps/web',
    './apps/web/index.js',
    './package.json',
    './packages',
    './packages/client',
    './packages/client/lib',
    './packages/client/lib/client.js',
  ]);
});

test('identical runtimes copied at different times produce identical archives', (t) => {
  const root = scratch(t);
  const first = tree(path.join(root, 'one'), files, 1_700_000_000);
  const second = tree(path.join(root, 'two'), files, 1_800_000_000);
  writeRuntimeArchive(first, path.join(root, 'one.tar'), { tar, log() {} });
  writeRuntimeArchive(second, path.join(root, 'two.tar'), { tar, log() {} });
  assert.ok(fs.readFileSync(path.join(root, 'one.tar')).equals(fs.readFileSync(path.join(root, 'two.tar'))));
  assert.equal(fs.existsSync(path.join(root, 'one.tar.entries')), false);

  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  execFileSync(tar, ['-xf', path.join(root, 'one.tar'), '-C', out]);
  for (const [name, body] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(out, name), 'utf8'), body);
  const listed = execFileSync(tar, ['-tf', path.join(root, 'one.tar')], { encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.equal(listed[0].replace(/\/$/, ''), './node_modules');
});

test('changed content gets a new mtime while unchanged files keep theirs', (t) => {
  const root = scratch(t);
  const before = tree(path.join(root, 'before'), files, 1_700_000_000);
  const after = tree(path.join(root, 'after'), { ...files, 'apps/web/index.js': 'web v2' }, 1_800_000_000);
  writeRuntimeArchive(before, path.join(root, 'before.tar'), { tar, log() {} });
  writeRuntimeArchive(after, path.join(root, 'after.tar'), { tar, log() {} });
  const mtime = (dir, name) => fs.statSync(path.join(dir, name)).mtimeMs;
  assert.equal(mtime(before, 'packages/client/lib/client.js'), mtime(after, 'packages/client/lib/client.js'));
  assert.notEqual(mtime(before, 'apps/web/index.js'), mtime(after, 'apps/web/index.js'));
  assert.ok(mtime(after, 'apps/web/index.js') < Date.now());
});
