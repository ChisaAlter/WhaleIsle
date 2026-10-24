'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-link-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'vendor');
  const profileDir = path.join(root, 'profile');
  const link = path.join(profileDir, 'node_modules', 'dsh-task-control');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'package.json'), '{}');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const file = path.join(__dirname, 'task-control-overlay.js');
  const realRequire = createRequire(file);
  const io = { ...fs, ...overrides };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, __dirname, process,
    require(name) {
      if (name === 'fs') return io;
      if (name === './plugins') return {};
      if (name === './plugin-runtime-files') return { missingDeclaredEntries: () => [], missingRuntimeFiles: () => [] };
      if (name === './desktop-plugin-link') {
        const helperModule = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'desktop-plugin-link.js'), 'utf8'), {
          module: helperModule, process, require: n => n === 'node:fs' ? io : realRequire(n),
        });
        return helperModule.exports;
      }
      return realRequire(name);
    },
  });
  return { sourceDir, profileDir, link, ensure: () => module.exports.ensureDesktopTaskControl({ sourceDir, profileDir }) };
}

test('valid built-in junction is reused without unlink or recreation', t => {
  const f = fixture(t, { unlinkSync: () => assert.fail('must not unlink a valid junction'), symlinkSync: () => assert.fail('must not recreate a valid junction') });
  fs.symlinkSync(f.sourceDir, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.ensure().ok, true);
});

test('link inspection preserves EACCES instead of reporting a later EEXIST', t => {
  const denied = Object.assign(new Error('link is unreadable'), { code: 'EACCES' });
  const f = fixture(t, {
    lstatSync: () => { throw denied; },
    symlinkSync: () => { throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); },
  });
  assert.throws(f.ensure, error => error === denied);
});

test('EEXIST is accepted only after rechecking a concurrently created correct link', t => {
  const f = fixture(t, { symlinkSync(source, link, type) {
    fs.symlinkSync(source, link, type);
    throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
  } });
  assert.equal(f.ensure().ok, true);
  assert.equal(fs.realpathSync(f.link), fs.realpathSync(f.sourceDir));
});

test('ordinary content occupying a plugin link is never deleted', t => {
  const f = fixture(t);
  fs.mkdirSync(f.link);
  fs.writeFileSync(path.join(f.link, 'keep.txt'), 'keep');
  assert.throws(f.ensure, /refusing to replace unknown content/);
  assert.equal(fs.readFileSync(path.join(f.link, 'keep.txt'), 'utf8'), 'keep');
});

test('a stale link is replaced without deleting its target', t => {
  const f = fixture(t);
  const stale = path.join(f.profileDir, 'old');
  fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, 'keep.txt'), 'keep');
  fs.symlinkSync(stale, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(f.ensure().ok, true);
  assert.equal(fs.realpathSync(f.link), fs.realpathSync(f.sourceDir));
  assert.equal(fs.readFileSync(path.join(stale, 'keep.txt'), 'utf8'), 'keep');
});

test('dangling links are repaired', t => {
  const f = fixture(t);
  const absent = path.join(f.profileDir, 'absent');
  fs.mkdirSync(absent);
  fs.symlinkSync(absent, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmdirSync(absent);
  assert.equal(f.ensure().ok, true);
  assert.equal(fs.realpathSync(f.link), fs.realpathSync(f.sourceDir));
});

test('EEXIST with a wrong concurrent target still blocks startup', t => {
  const conflict = Object.assign(new Error('already exists'), { code: 'EEXIST' });
  const f = fixture(t, { symlinkSync(source, link, type) {
    fs.symlinkSync(path.dirname(source), link, type);
    throw conflict;
  } });
  assert.throws(f.ensure, error => error === conflict);
});

test('unreadable existing target propagates the original error without unlinking', t => {
  const denied = Object.assign(new Error('target is unreadable'), { code: 'EACCES' });
  const f = fixture(t, { statSync(file, options) {
    if (file === f.link) throw denied;
    return fs.statSync(file, options);
  }, unlinkSync: () => assert.fail('must preserve the link on read failure') });
  fs.symlinkSync(f.sourceDir, f.link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(f.ensure, error => error === denied);
});

test('Windows source path casing does not recreate a valid link', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t, { unlinkSync: () => assert.fail('same directory identity') });
  fs.symlinkSync(f.sourceDir.toUpperCase(), f.link, 'junction');
  assert.equal(f.ensure().ok, true);
});

test('all built-in profile links use the shared preparation', () => {
  for (const name of ['task-control-overlay', 'platform-session-overlay', 'usage-panel-preset', 'dsh-im-desktop', 'dsh-whale-desktop', 'dsh-remote-desktop']) {
    const source = fs.readFileSync(path.join(__dirname, `${name}.js`), 'utf8');
    assert.match(source, /require\('\.\/desktop-plugin-link'\)/, name);
    assert.doesNotMatch(source, /fs\.symlinkSync\(/, name);
  }
});
