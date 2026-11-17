'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { isLegacyNotificationShortcut, migrateLegacyNotificationShortcut, notifyShortcutMoved } = require('./legacy-notification-shortcut');

const details = {
  target: 'C:\\Repo\\node_modules\\electron\\dist\\electron.exe',
  args: '', icon: '', iconIndex: 0, appUserModelId: 'ai.deepseek.harness.gui',
};
const source = 'C:\\AppData\\Microsoft\\Windows\\Start Menu\\Programs\\Electron.lnk';
const userData = 'C:\\AppData\\Deepseek-Harness-Desktop';

function error(code) { return Object.assign(new Error(code), { code }); }
function fixture() {
  const entries = new Map();
  const calls = [];
  const key = file => file.toLowerCase();
  function set(file, kind = 'file', bytes = Buffer.from('original shortcut')) {
    entries.set(key(file), { kind, bytes, dev: 1, ino: entries.size + 1, mtimeMs: 1 });
  }
  set(source); set(details.target); set(userData, 'directory');
  const io = {
    async lstat(file) {
      calls.push(['lstat', file]);
      const entry = entries.get(key(file));
      if (!entry) throw error('ENOENT');
      return { ...entry, size: entry.bytes.length,
        isFile: () => entry.kind === 'file', isDirectory: () => entry.kind === 'directory',
        isSymbolicLink: () => entry.kind === 'symlink' };
    },
    async realpath(file) {
      calls.push(['realpath', file]);
      const entry = entries.get(key(file));
      if (!entry) throw error('ENOENT');
      return entry.realpath || file;
    },
    async mkdir(file, options) {
      calls.push(['mkdir', file]);
      if (entries.has(key(file))) {
        if (options?.recursive && entries.get(key(file)).kind === 'directory') return;
        throw error('EEXIST');
      }
      set(file, 'directory');
    },
    async rmdir(file) {
      calls.push(['rmdir', file]);
      if ([...entries.keys()].some(name => name.startsWith(key(file) + '\\'))) throw error('ENOTEMPTY');
      entries.delete(key(file));
    },
    async rename(from, to) {
      calls.push(['rename', from, to]);
      if (entries.has(key(to))) throw error('EEXIST');
      if (!entries.has(key(from))) throw error('ENOENT');
      entries.set(key(to), entries.get(key(from))); entries.delete(key(from));
    },
  };
  const options = {
    platform: 'win32', isPackaged: true, appDataDir: 'C:\\AppData', userDataDir: userData,
    readShortcutLink: () => ({ ...details }), io, createBackupId: () => 'unique-backup',
    notifyShortcutMoved: async (from, to) => { calls.push(['notify', from, to]); return true; },
  };
  return { entries, calls, key, set, io, options };
}

test('legacy shortcut identity is the unchanged installer/window GUI AppID', () => {
  assert.equal(details.appUserModelId, require('../../package.json').build.appId);
  assert.equal(details.appUserModelId, require('./window-app-details').windowsAppDetails({ isPackaged: true, execPath: 'C:\\Whale Isle.exe' }).appId);
  assert.equal(isLegacyNotificationShortcut(details), true);
  assert.equal(isLegacyNotificationShortcut({ ...details, icon: details.target.toUpperCase() }), true);
});

for (const [label, patch] of [
  ['another AppID', { appUserModelId: 'another.electron.app' }],
  ['slim AppID', { appUserModelId: 'ai.deepseek.harness.launcher' }],
  ['missing AppID', { appUserModelId: undefined }],
  ['application arguments', { args: '--app=C:\\personal' }],
  ['whitespace arguments', { args: ' ' }],
  ['custom icon', { icon: 'C:\\Icons\\custom.ico' }],
  ['another icon resource', { iconIndex: 1 }],
  ['installed Whale executable', { target: 'C:\\软件\\Whale Isle\\Whale Isle.exe' }],
  ['relative executable', { target: 'electron.exe' }],
  ['drive-relative executable', { target: 'C:electron.exe' }],
  ['parent traversal', { target: 'C:\\Repo\\..\\electron.exe' }],
  ['extended/device path', { target: '\\\\?\\C:\\Repo\\electron.exe' }],
  ['network executable', { target: '\\\\server\\share\\electron.exe' }],
  ['alternate data stream', { target: 'C:\\Repo\\electron.exe:stream' }],
  ['trailing path alias', { target: 'C:\\Repo.\\electron.exe' }],
]) {
  test(`legacy migration preserves ${label}`, async () => {
    const f = fixture(); f.options.readShortcutLink = () => ({ ...details, ...patch });
    assert.equal(isLegacyNotificationShortcut({ ...details, ...patch }), false);
    assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'preserved', reason: 'different-shortcut' });
    assert.equal(f.entries.has(f.key(source)), true);
    assert.equal(f.calls.some(([name]) => name === 'rename' || name === 'mkdir'), false);
    assert.equal(f.calls.some(([name]) => name === 'notify'), false);
  });
}

test('source, non-Windows and slim startup perform no shortcut or filesystem calls', async () => {
  for (const patch of [{ isPackaged: false }, { platform: 'darwin' }, { platform: 'linux' }, { launcher: true }]) {
    const f = fixture(); f.options.readShortcutLink = () => { throw new Error('unexpected shortcut read'); };
    assert.deepEqual(await migrateLegacyNotificationShortcut({ ...f.options, ...patch }), { status: 'not-applicable' });
    assert.equal(f.calls.length, 0);
  }
});

test('requiring the migration and taking no-op paths never loads Koffi', async () => {
  const sourceText = await fs.readFile(path.join(__dirname, 'legacy-notification-shortcut.js'), 'utf8');
  let nativeLoads = 0;
  const module = { exports: {} };
  vm.runInNewContext(sourceText, {
    module, process, setTimeout, clearTimeout,
    require(name) {
      if (name === 'koffi') { nativeLoads += 1; throw new Error('unexpected native load'); }
      return require(name);
    },
  });
  for (const patch of [{ isPackaged: false }, { platform: 'darwin' }, { platform: 'linux' }, { launcher: true }]) {
    const f = fixture(); await module.exports.migrateLegacyNotificationShortcut({ ...f.options, ...patch });
    assert.equal(f.calls.length, 0);
  }
  const absent = fixture(); absent.entries.delete(absent.key(source));
  await module.exports.migrateLegacyNotificationShortcut(absent.options);
  const other = fixture(); other.options.readShortcutLink = () => ({ ...details, appUserModelId: 'another.app' });
  await module.exports.migrateLegacyNotificationShortcut(other.options);
  assert.equal(nativeLoads, 0);
});

test('a matching shortcut is moved intact into a unique backup without a shortcut extension', async () => {
  const f = fixture(); const original = f.entries.get(f.key(source));
  const unknown = 'C:\\AppData\\Microsoft\\Windows\\Start Menu\\Programs\\Other Electron.lnk';
  const pinned = 'C:\\AppData\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\Electron.lnk';
  f.set(unknown); f.set(pinned);
  const result = await migrateLegacyNotificationShortcut(f.options);
  assert.equal(result.status, 'migrated');
  assert.equal(result.backupPath, userData + '\\legacy-system-shortcuts\\unique-backup\\Electron.lnk.backup');
  assert.equal(path.win32.extname(result.backupPath), '.backup');
  assert.equal(f.entries.has(f.key(source)), false);
  assert.equal(f.entries.get(f.key(result.backupPath)), original);
  assert.equal(f.entries.has(f.key(unknown)), true); assert.equal(f.entries.has(f.key(pinned)), true);
  assert.equal(result.shellNotified, true);
  assert.deepEqual(f.calls.filter(([name]) => name === 'notify'), [['notify', source, result.backupPath]]);
  assert.ok(f.calls.findIndex(([name]) => name === 'rename') < f.calls.findIndex(([name]) => name === 'notify'));
  assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'absent' });
  assert.equal(f.calls.filter(([name]) => name === 'notify').length, 1);
});

test('Shell retires the old entry without registering its backup, using targeted asynchronous FLUSH', async () => {
  const destination = userData + '\\legacy-system-shortcuts\\unique-backup\\Electron.lnk.backup';
  const calls = [];
  const result = await notifyShortcutMoved(source, destination, {
    platform: 'win32', loadApi: () => ({ async(...args) {
      const callback = args.pop(); calls.push(args); setImmediate(() => callback(null));
    } }),
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[2, 0x1005, source, null]]);
});

test('non-Windows, unsafe and same-path Shell delivery never loads the native library', async () => {
  const destination = userData + '\\legacy-system-shortcuts\\unique-backup\\Electron.lnk.backup';
  const loadApi = () => { throw new Error('native library must not load'); };
  for (const [from, to, platform] of [[source, destination, 'linux'], [source, destination, 'darwin'],
    ['Electron.lnk', destination, 'win32'], [source, '\\\\server\\Electron.lnk', 'win32'],
    [source, source.toUpperCase(), 'win32']]) {
    assert.equal(await notifyShortcutMoved(from, to, { platform, loadApi }), false);
  }
});

test('a failed or missing Shell callback never loses the completed backup', async () => {
  for (const notify of [async () => false, async () => { throw new Error('private path'); },
    (from, to) => notifyShortcutMoved(from, to, { platform: 'win32', loadApi: () => ({ async() {} }) })]) {
    const f = fixture(); const original = f.entries.get(f.key(source)); f.options.notifyShortcutMoved = notify;
    const result = await migrateLegacyNotificationShortcut(f.options);
    assert.equal(result.status, 'migrated'); assert.equal(result.shellNotified, false);
    assert.equal(f.entries.has(f.key(source)), false); assert.equal(f.entries.get(f.key(result.backupPath)), original);
  }
});

test('Shell loading and callback errors return safe false and clear the deadline', async () => {
  const destination = userData + '\\legacy-system-shortcuts\\unique-backup\\Electron.lnk.backup';
  for (const loadApi of [() => { throw new Error('private path'); }, () => ({ async() { throw new Error('private path'); } }),
    () => ({ async(...args) { setImmediate(() => args.at(-1)(new Error('private path'))); } })]) {
    assert.equal(await notifyShortcutMoved(source, destination, { platform: 'win32', loadApi }), false);
  }
});

test('a late Shell callback after the deadline cannot turn a timeout into success', async () => {
  const destination = userData + '\\legacy-system-shortcuts\\unique-backup\\Electron.lnk.backup';
  let callback;
  const result = await notifyShortcutMoved(source, destination, {
    platform: 'win32', loadApi: () => ({ async(...args) { callback = args.at(-1); } }),
  });
  assert.equal(result, false); callback(null); callback(new Error('late failure'));
  await new Promise(resolve => setImmediate(resolve));
});

test('FLUSH startup waiting ends at 500ms while preserving bytes and rejecting late delivery success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(); const original = f.entries.get(f.key(source));
  let entered, callback; const reachedNative = new Promise(resolve => { entered = resolve; });
  f.options.notifyShortcutMoved = (from, to) => notifyShortcutMoved(from, to, {
    platform: 'win32', loadApi: () => ({ async(event, flags, oldPath, newPath, done) {
      assert.deepEqual([event, flags, oldPath, newPath], [2, 0x1005, source, null]);
      callback = done; entered();
    } }),
  });
  let settled = false;
  const pending = migrateLegacyNotificationShortcut(f.options).then(result => { settled = true; return result; });
  await reachedNative;
  t.mock.timers.tick(499); await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.equal(result.status, 'migrated'); assert.equal(result.shellNotified, false);
  assert.equal(f.entries.has(f.key(source)), false);
  assert.equal(f.entries.get(f.key(result.backupPath)), original);
  callback(null); callback(new Error('late failure'));
  await Promise.resolve();
  assert.equal(result.shellNotified, false);
  assert.equal(f.entries.get(f.key(result.backupPath)), original);
});

test('missing, unreadable and non-regular shortcut entries never move', async () => {
  const absent = fixture(); absent.entries.delete(absent.key(source));
  assert.deepEqual(await migrateLegacyNotificationShortcut(absent.options), { status: 'absent' });
  for (const kind of ['directory', 'symlink']) {
    const f = fixture(); f.set(source, kind);
    assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'preserved', reason: 'not-regular-file' });
  }
  const unreadable = fixture(); unreadable.options.readShortcutLink = () => { throw error('EACCES'); };
  assert.deepEqual(await migrateLegacyNotificationShortcut(unreadable.options), { status: 'failed', reason: 'read-failed' });
  assert.equal(unreadable.entries.has(unreadable.key(source)), true);
});

test('a deleted source executable does not retain its obsolete notification shortcut', async () => {
  const missing = fixture(); missing.entries.delete(missing.key(details.target));
  assert.equal((await migrateLegacyNotificationShortcut(missing.options)).status, 'migrated');
  assert.equal(missing.entries.has(missing.key(source)), false);
});

test('existing linked and redirected executable targets preserve the shortcut', async () => {
  for (const patch of [{ kind: 'symlink' }, { kind: 'directory' }, { realpath: 'C:\\Other\\electron.exe' }]) {
    const f = fixture(); Object.assign(f.entries.get(f.key(details.target)), patch);
    assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'preserved', reason: 'different-target' });
    assert.equal(f.entries.has(f.key(source)), true);
    if (patch.kind) assert.equal(f.calls.some(([name, file]) => name === 'realpath' && file === details.target), false);
  }
});

test('unsafe backup roots and occupied unique backup directories cannot overwrite anything', async () => {
  const root = userData + '\\legacy-system-shortcuts';
  for (const patch of [{ kind: 'symlink' }, { realpath: 'C:\\Outside' }]) {
    const f = fixture(); f.set(root, 'directory'); Object.assign(f.entries.get(f.key(root)), patch);
    assert.equal((await migrateLegacyNotificationShortcut(f.options)).status, 'failed');
    assert.equal(f.entries.has(f.key(source)), true);
    assert.equal(f.calls.some(([name]) => name === 'rename'), false);
  }
  const f = fixture(); f.set(root, 'directory'); f.set(root + '\\unique-backup', 'directory');
  const existing = root + '\\unique-backup\\Electron.lnk.backup'; f.set(existing);
  const originalBackup = f.entries.get(f.key(existing));
  assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'failed', reason: 'backup-failed' });
  assert.equal(f.entries.get(f.key(existing)), originalBackup);
  assert.equal(f.entries.has(f.key(source)), true);
});

test('a shortcut changed during inspection stays in the Start Menu', async () => {
  const f = fixture(); let reads = 0;
  f.options.readShortcutLink = () => ({ ...details, args: reads++ === 0 ? '' : '--changed' });
  assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'preserved', reason: 'shortcut-changed' });
  assert.equal(f.entries.has(f.key(source)), true);
  assert.equal(f.calls.some(([name]) => name === 'rename'), false);
  assert.equal(f.calls.some(([name]) => name === 'notify'), false);
});

test('an asynchronous rename failure preserves the shortcut and returns no private error text', async () => {
  const f = fixture(); f.io.rename = async () => { throw new Error('private path or credential must not be logged'); };
  assert.deepEqual(await migrateLegacyNotificationShortcut(f.options), { status: 'failed', reason: 'move-failed' });
  assert.equal(f.entries.has(f.key(source)), true);
  assert.equal(f.calls.some(([name]) => name === 'notify'), false);
});

test('desktop startup awaits migration before continuing preparation and logs only status', async () => {
  // Post-#439 the whenReady sequence is the body of runAppReady in app-ready.js.
  const sourceText = (await fs.readFile(path.join(__dirname, 'app-ready.js'), 'utf8')).replace(/\r\n/g, '\n');
  const marker = 'const shortcutMigration =';
  const start = sourceText.indexOf(marker);
  const snippet = sourceText.slice(start, sourceText.indexOf('const homeEnv =', start));
  let release; const pending = new Promise(resolve => { release = resolve; });
  const events = [];
  const boot = vm.runInNewContext(`async function boot() { ${snippet}\nevents.push('continue'); }\nboot`, {
    app: { isPackaged: true, getPath: name => name === 'appData' ? 'C:\\AppData' : userData },
    require: () => ({ isLauncherPackage: () => false }), shell: { readShortcutLink() {} },
    migrateLegacyNotificationShortcut: () => { events.push('migration'); return pending; },
    dsh: { log: message => events.push(message) }, events,
  });
  const started = boot(); assert.deepEqual(events, ['migration']);
  release({ status: 'migrated', backupPath: 'private backup path' }); await started;
  assert.deepEqual(events, ['migration', '[legacy-notification-shortcut] migrated', 'continue']);
});

test('Windows real Electron shortcut API and async migration preserve exact fixture bytes', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dshd-legacy-shortcut-test-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'dshd-legacy-shortcut-test-'));
    return fs.rm(root, { recursive: true, force: true });
  });
  await Promise.all(['appdata', 'userdata', 'session'].map(name => fs.mkdir(path.join(root, name))));
  const script = path.join(root, 'shortcut-fixture.cjs');
  await fs.writeFile(script, `
    const { app, shell } = require('electron');
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const assert = require('node:assert/strict');
    const { isLegacyNotificationShortcut, migrateLegacyNotificationShortcut } = require(${JSON.stringify(path.join(__dirname, 'legacy-notification-shortcut.js'))});
    const root = ${JSON.stringify(root)};
    const appDataDir = path.join(root, 'appdata'), userDataDir = path.join(root, 'userdata');
    app.setPath('appData', appDataDir); app.setPath('userData', userDataDir);
    app.setPath('sessionData', path.join(root, 'session'));
    app.whenReady().then(async () => {
      const shortcut = path.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
      await fs.mkdir(path.dirname(shortcut), { recursive: true }); await fs.mkdir(userDataDir, { recursive: true });
      assert.equal(shell.writeShortcutLink(shortcut, { target: process.execPath, args: '', icon: '', iconIndex: 0, appUserModelId: ${JSON.stringify(details.appUserModelId)} }), true);
      const read = shell.readShortcutLink(shortcut); assert.equal(isLegacyNotificationShortcut(read), true);
      const original = await fs.readFile(shortcut);
      const result = await migrateLegacyNotificationShortcut({ isPackaged: true, appDataDir, userDataDir, readShortcutLink: file => shell.readShortcutLink(file) });
      assert.equal(result.status, 'migrated'); assert.deepEqual(await fs.readFile(result.backupPath), original);
      assert.equal(path.basename(result.backupPath), 'Electron.lnk.backup');
      assert.equal(result.shellNotified, true);
      await assert.rejects(fs.stat(shortcut), { code: 'ENOENT' });
      console.log('DSHD_SHORTCUT_FIXTURE ' + JSON.stringify({ realReaderMatched: true, exactBytesPreserved: true, sourceGone: true, shellNotified: true, notificationsInitialized: false, windowsCreated: false }));
      app.exit(0);
    }).catch(() => { console.error('DSHD_SHORTCUT_FIXTURE failed'); app.exit(1); });
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const { stdout } = await promisify(execFile)(require('electron'), [script, `--user-data-dir=${path.join(root, 'userdata')}`], { env, timeout: 25000, windowsHide: true });
  assert.match(stdout, /DSHD_SHORTCUT_FIXTURE /);
  const record = JSON.parse(stdout.split('DSHD_SHORTCUT_FIXTURE ')[1].split(/\r?\n/)[0]);
  assert.equal(record.realReaderMatched, true); assert.equal(record.exactBytesPreserved, true);
  assert.equal(record.sourceGone, true); assert.equal(record.notificationsInitialized, false); assert.equal(record.windowsCreated, false);
  assert.equal(record.shellNotified, true);
});
