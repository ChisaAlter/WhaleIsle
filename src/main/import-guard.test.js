const { test } = require('node:test');
const assert = require('node:assert/strict');

const importGuard = require('./import-guard');
const { disablePlugins, enablePlugin } = require('./profile-ops');

test('the maintenance slot admits exactly one owner and refuses a second', () => {
  const a = importGuard.acquireMaintenance('import');
  assert.ok(a, 'first acquire wins');
  assert.equal(importGuard.acquireMaintenance('install'), null, 'a second kind is refused while held');
  assert.equal(importGuard.isMaintenanceHeld(), true);
  assert.equal(importGuard.maintenanceOwner().kind, 'import');
  importGuard.releaseMaintenance(a);
  assert.equal(importGuard.isMaintenanceHeld(), false);
  const b = importGuard.acquireMaintenance('install');
  assert.ok(b, 'after release a different kind may acquire');
  importGuard.releaseMaintenance(b);
});

test('releaseMaintenance ignores a stale token and keeps the current owner', () => {
  const a = importGuard.acquireMaintenance('import');
  const stale = { kind: 'ghost' };
  assert.equal(importGuard.releaseMaintenance(stale), false);
  assert.equal(importGuard.isMaintenanceHeld(), true, 'a foreign token must not drop ownership');
  importGuard.releaseMaintenance(a);
  assert.equal(importGuard.isMaintenanceHeld(), false);
});

test('profile mutations refuse while the maintenance slot is held', async () => {
  const token = importGuard.acquireMaintenance('import');
  try {
    const off = await disablePlugins(['some-plugin'], { dsh: {}, configIO: { load: () => ({}), save: () => ({}) } });
    assert.equal(off.ok, false);
    assert.equal(off.error, 'maintenance-in-progress');
    assert.equal(off.owner, 'import');
    const on = await enablePlugin('some-plugin', { dsh: {}, configIO: { load: () => ({}), save: () => ({}) } });
    assert.equal(on.ok, false);
    assert.equal(on.error, 'maintenance-in-progress');
  } finally {
    importGuard.releaseMaintenance(token);
  }
});

test('optional Project disable and enable preserve ordinary profile manifest and user patch', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-profile-ops-'));
  setDesktopDshHome(home);
  try {
    const profile = path.join(home, 'profiles', 'web'); fs.mkdirSync(profile, { recursive: true });
    const manifest = JSON.stringify({ dependencies: { 'user-plugin': '1.0.0' }, dsh: { profile: { bundles: ['user-plugin'] } } });
    fs.writeFileSync(path.join(profile, 'package.json'), manifest);
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '# preserve user\n');
    let config = { disabledPlugins: [] };
    const io = { load: () => config, save: patch => { config = { ...config, ...patch }; } }, dsh = { state: 'idle' };
    assert.equal((await disablePlugins(['dsh-project'], { dsh, configIO: io })).ok, true);
    assert.deepEqual(config.disabledPlugins, ['dsh-project']);
    assert.equal((await enablePlugin('dsh-project', { dsh, configIO: io })).ok, true);
    assert.deepEqual(config.disabledPlugins, []);
    assert.equal(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'), manifest);
    assert.equal(fs.readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8'), '# preserve user\n');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    clearDesktopDshHome();
    assert.ok(path.resolve(home).startsWith(path.join(os.tmpdir(), 'project-profile-ops-')));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('holdsMaintenance distinguishes the live owner token from foreign callers', () => {
  const owner = importGuard.acquireMaintenance('start');
  try {
    assert.equal(importGuard.holdsMaintenance(owner), true, 'the live owner token delegates');
    assert.equal(importGuard.holdsMaintenance(null), false, 'no token is not the owner');
    assert.equal(importGuard.holdsMaintenance({ kind: 'start' }), false, 'a lookalike object is not the owner');
    assert.equal(importGuard.holdsMaintenance('start'), false, 'a kind string is not the owner');
  } finally {
    importGuard.releaseMaintenance(owner);
  }
  assert.equal(importGuard.holdsMaintenance(owner), false, 'a released token stops delegating');
});

test('profile mutations ACQUIRE the slot while running and release on settle', async () => {
  // A profile op admitted first must hold ownership across its work — the
  // slot is observed held from inside the op's config read (which runs
  // after acquisition), and free again once it settles.
  const seenHeld = [];
  const io = {
    load: () => { seenHeld.push(importGuard.isMaintenanceHeld()); return {}; },
    save: () => ({}),
  };
  const dsh = { kernel: { running: false } };
  // A missing name releases the just-acquired slot on its early return.
  await disablePlugins([], { dsh, configIO: io });
  assert.equal(importGuard.isMaintenanceHeld(), false, 'early-return path releases the slot');
  // A guard-rejected name (builtin) also releases before returning.
  await disablePlugins(['dshbot'], { dsh, configIO: io });
  assert.equal(importGuard.isMaintenanceHeld(), false, 'guard-rejected path releases the slot');
  // slot is free again for a fresh operation.
  const token = importGuard.acquireMaintenance('import');
  assert.ok(token, 'slot is free again after profile ops settled');
  importGuard.releaseMaintenance(token);
});
