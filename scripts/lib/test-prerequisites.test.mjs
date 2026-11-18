import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  harnessDependencies,
  harnessBuild,
  harnessWorkspace,
  electronBinary,
  packagedExecutable,
  allPrerequisites,
  prerequisitesRequired,
  requirePrerequisite,
  prerequisiteSkip,
  gateTests,
} = require('./test-prerequisites.cjs');

const fakeT = () => ({ skipped: undefined, skip(message) { this.skipped = message; } });
const existsOnly = (...present) => file => present.some(entry => file.endsWith(entry));
const none = () => false;

test('requirePrerequisite returns true and never touches the context when satisfied', () => {
  const t = fakeT();
  assert.equal(requirePrerequisite(t, { ok: true }), true);
  assert.equal(requirePrerequisite(t, true), true);
  assert.equal(t.skipped, undefined);
});

test('a missing prerequisite skips the case with the reason visible', () => {
  const t = fakeT();
  const check = { ok: false, reason: 'Harness 构建产物缺失：vendor/deepseek-harness/apps/cli/lib/bin.js，先运行 npm run setup' };
  assert.equal(requirePrerequisite(t, check), false);
  assert.equal(t.skipped, check.reason);
});

test('WHALE_REQUIRE_TEST_PREREQS=1 turns a missing prerequisite into a failure', t => {
  process.env.WHALE_REQUIRE_TEST_PREREQS = '1';
  t.after(() => { delete process.env.WHALE_REQUIRE_TEST_PREREQS; });
  const check = { ok: false, reason: '缺什么、用什么补齐' };
  assert.throws(() => requirePrerequisite(t, check), error => {
    assert.equal(error.code, 'ERR_ASSERTION');
    assert.match(error.message, /缺什么、用什么补齐/);
    return true;
  });
  assert.equal(t.skipped, undefined);
});

test('prerequisiteSkip feeds the { skip } option and never skips in required mode', () => {
  const check = { ok: false, reason: 'why' };
  assert.equal(prerequisiteSkip({ ok: true }), false);
  assert.equal(prerequisiteSkip(check), 'why');
  assert.equal(prerequisiteSkip(check, { env: { WHALE_REQUIRE_TEST_PREREQS: '1' } }), false);
});

test('prerequisitesRequired only honors the explicit 1', () => {
  assert.equal(prerequisitesRequired({}), false);
  assert.equal(prerequisitesRequired({ WHALE_REQUIRE_TEST_PREREQS: '1' }), true);
  assert.equal(prerequisitesRequired({ WHALE_REQUIRE_TEST_PREREQS: 'true' }), false);
});

test('harnessDependencies marks the pnpm-installed workspace', () => {
  const root = path.join('/harness');
  const full = existsOnly(path.join(root, 'node_modules'), path.join(root, 'apps/cli/node_modules'));
  assert.equal(harnessDependencies({ harnessRoot: root, existsSync: full }).ok, true);
  const partial = harnessDependencies({ harnessRoot: root, existsSync: existsOnly(path.join(root, 'node_modules')) });
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /apps\/cli\/node_modules/);
  assert.match(partial.reason, /npm run setup/);
});

test('harnessBuild checks the CLI lib plus caller entries', () => {
  const root = path.join('/harness');
  const missing = harnessBuild({ harnessRoot: root, existsSync: none });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /apps\/cli\/lib\/bin\.js/);
  const extra = harnessBuild({ entries: ['packages/boot/app-boot/lib/index.js'], harnessRoot: root, existsSync: none });
  assert.match(extra.reason, /app-boot/);
});

test('harnessWorkspace fails on either missing half', () => {
  const root = path.join('/harness');
  const depsOnly = harnessWorkspace({ harnessRoot: root, existsSync: existsOnly(path.join(root, 'node_modules'), path.join(root, 'apps/cli/node_modules')) });
  assert.equal(depsOnly.ok, false);
  const builtOnly = harnessWorkspace({ harnessRoot: root, existsSync: existsOnly(path.join(root, 'apps/cli/lib/bin.js')) });
  assert.equal(builtOnly.ok, false);
  const full = harnessWorkspace({
    harnessRoot: root,
    existsSync: existsOnly(path.join(root, 'node_modules'), path.join(root, 'apps/cli/node_modules'), path.join(root, 'apps/cli/lib/bin.js')),
  });
  assert.equal(full.ok, true);
});

test('electronBinary prefers ELECTRON_PATH and reports per-platform candidates', () => {
  const env = { ELECTRON_PATH: '/opt/electron' };
  const found = electronBinary({ env, existsSync: existsOnly('/opt/electron') });
  assert.equal(found.ok, true);
  assert.equal(found.binary, '/opt/electron');
  const missing = electronBinary({ env: {}, platform: 'darwin', existsSync: none });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /Electron\.app/);
  assert.match(missing.reason, /electron\/install\.js/);
});

test('packagedExecutable reports the unpacked output for supported platforms', () => {
  const win = packagedExecutable({ productName: 'Whale Isle', platform: 'win32', existsSync: none });
  assert.equal(win.ok, false);
  assert.match(win.reason, /npm run dist/);
  const found = packagedExecutable({
    productName: 'Whale Isle', platform: 'win32',
    existsSync: existsOnly(path.join('dist', 'win-unpacked', 'Whale Isle.exe')),
  });
  assert.equal(found.ok, true);
  const mac = packagedExecutable({ productName: 'Whale Isle', platform: 'darwin', existsSync: existsOnly(path.join('dist', 'mac', 'Whale Isle.app', 'Contents', 'MacOS', 'Whale Isle')) });
  assert.equal(mac.ok, true);
  assert.match(mac.binary, /Whale Isle\.app/);
});

test('allPrerequisites returns the first failing check', () => {
  const failed = { ok: false, reason: 'second' };
  assert.equal(allPrerequisites({ ok: true }).ok, true);
  assert.equal(allPrerequisites({ ok: true }, failed, { ok: false, reason: 'third' }), failed);
});

test('gateTests keeps the original test when the prerequisite holds', () => {
  const named = () => {};
  assert.equal(gateTests(named, { ok: true }), named);
});

test('gateTests replaces bodies so each case reports the missing prerequisite', () => {
  const registered = [];
  const fakeTest = (name, options, fn) => {
    const body = fn ?? options;
    registered.push({ name, body });
    return { name };
  };
  const hook = () => {};
  fakeTest.before = hook;
  const gated = gateTests(fakeTest, { ok: false, reason: '需要 npm run setup' });
  gated('case one', () => { throw new Error('must not run'); });
  gated('case two', { timeout: 1000 }, () => { throw new Error('must not run'); });
  const t = fakeT();
  for (const entry of registered) entry.body(t);
  assert.equal(t.skipped, '需要 npm run setup');
  assert.equal(registered.length, 2);
  assert.equal(gated.before, fakeTest.before);
});

test('gateTests fails every registered case in required mode', () => {
  const registered = [];
  const fakeTest = (name, options, fn) => registered.push(fn ?? options);
  const gated = gateTests(fakeTest, { ok: false, reason: '缺前提' }, { env: { WHALE_REQUIRE_TEST_PREREQS: '1' } });
  gated('case', () => {});
  assert.throws(() => registered[0](fakeT()), /缺前提/);
});
