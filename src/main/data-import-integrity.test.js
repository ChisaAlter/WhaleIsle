'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');
const { runImport, recoverInterruptedImport } = require('./data-import');
const { requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');

function createFileSymlinkOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'file');
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') {
      requirePrerequisite(t, false, `file-symlink creation unavailable (${error.code}): ${error.message}`);
      return false;
    }
    throw error;
  }
}

function requireFileSymlinkOrSkip(t, tree) {
  const probeLink = path.join(tree.root, '.symlink-probe');
  if (!createFileSymlinkOrSkip(t, tree.outside, probeLink)) return false;
  fs.unlinkSync(probeLink);
  return true;
}

const configs = [
  { name: 'mcp', file: 'mcp-servers.yaml', selection: { selectedMcpIds: ['new-server'] },
    source: 'servers:\n  - id: new-server\n    url: https://new.test/mcp\n',
    old: 'servers:\n  - id: old-server\n    url: https://old.test/mcp\n' },
  { name: 'settings', file: 'settings.yaml', selection: { selectedSettingIds: ['ui-theme'] },
    source: 'ui-theme:\n  preference: dark\n', old: 'ui-titlebar:\n  action: copy\n' },
  { name: 'credentials', file: '.credentials.yaml', selection: { selectedSettingIds: ['llm-deepseek'] },
    source: 'version: 1\nrefs:\n  NEW_REF: synthetic-new-key\n',
    old: 'version: 1\nrefs:\n  OLD_REF: synthetic-old-key\nrecords:\n  oauth: synthetic-session\n' },
];

function fixture(t, config) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-config-integrity-')));
  const sourceHome = path.join(root, 'source');
  const destHome = path.join(root, 'dest');
  const userDataDir = path.join(root, 'user-data');
  for (const dir of [sourceHome, destHome, userDataDir]) fs.mkdirSync(dir);
  setDesktopDshHome(destHome);
  const source = path.join(sourceHome, config.file);
  const dest = path.join(destHome, config.file);
  fs.writeFileSync(source, config.source);
  fs.writeFileSync(dest, config.old);
  if (config.name === 'credentials') {
    fs.writeFileSync(path.join(sourceHome, 'settings.yaml'), 'llm-deepseek:\n  apiKeyEnv: NEW_REF\n');
  }
  const outside = path.join(root, 'outside.yaml');
  fs.writeFileSync(outside, config.old);
  t.after(() => {
    t.mock.restoreAll();
    clearDesktopDshHome();
    // The only recursively removed path is the absolute mkdtemp-owned root.
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('dsh-config-integrity-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, source, dest, destHome, sourceHome, userDataDir, outside,
    options: { sourceHome, destHome, userDataDir, agentsSkillsRoot: path.join(root, 'agents'), ...config.selection } };
}

function ioError(code) { return Object.assign(new Error(`injected ${code}`), { code }); }
async function outcome(options) {
  try { return { result: await runImport(options) }; } catch (error) { return { error }; }
}
function assertFailed(value, reason) {
  assert.ok(value.error || value.result?.ok === false, 'import must not claim success');
  const detail = value.error?.message || JSON.stringify(value.result);
  assert.match(detail, reason);
}
function assertOld(tree, config) {
  assert.deepEqual(fs.readFileSync(tree.dest), Buffer.from(config.old), 'destination old bytes survive');
  assert.deepEqual(fs.readFileSync(tree.source), Buffer.from(config.source), 'source bytes unchanged');
  assert.deepEqual(fs.readFileSync(tree.outside), Buffer.from(config.old), 'outside bytes unchanged');
}
function assertNoTemps(tree) {
  assert.deepEqual(fs.readdirSync(tree.destHome).filter((name) => name.includes('.import-tmp')), []);
}

for (const config of configs) {
  for (const side of ['source', 'dest']) {
    test(`${config.name}: ${side} read failure after scan still aborts the real merge`, async (t) => {
      const tree = fixture(t, config);
      const { readFileSync } = fs;
      const { readFile: readFileAsync } = fs.promises;
      let injected = 0;
      let scanned = 0;
      const handleFaultOrScan = (file) => {
        if (file !== tree[side]) return false;
        if (fs.existsSync(path.join(tree.userDataDir, 'import-journal.json'))) {
          injected++;
          throw ioError('EIO');
        }
        scanned++;
        return false;
      };
      t.mock.method(fs, 'readFileSync', function (file, ...args) {
        handleFaultOrScan(file);
        return readFileSync.call(this, file, ...args);
      });
      t.mock.method(fs.promises, 'readFile', async function (file, ...args) {
        handleFaultOrScan(file);
        return readFileAsync.call(this, file, ...args);
      });
      const value = await outcome(tree.options);
      t.mock.restoreAll();
      if (config.name !== 'credentials') assert.ok(scanned > 0, 'scan read succeeded before the fault');
      assert.equal(injected, 1, 'failure occurs only after the copying journal is published');
      assertOld(tree, config);
      assertNoTemps(tree);
      assertFailed(value, /EIO/);
    });

    for (const code of ['EACCES', 'EIO', 'ENOTDIR']) {
      test(`${config.name}: ${side} ${code} read fails closed with old bytes intact`, async (t) => {
        const tree = fixture(t, config);
        const read = fs.readFileSync;
        const readAsync = fs.promises.readFile;
        let injected = 0;
        t.mock.method(fs, 'readFileSync', function (file, ...args) {
          if (file === tree[side]) { injected++; throw ioError(code); }
          return read.call(this, file, ...args);
        });
        t.mock.method(fs.promises, 'readFile', async function (file, ...args) {
          if (file === tree[side]) { injected++; throw ioError(code); }
          return readAsync.call(this, file, ...args);
        });
        const value = await outcome(tree.options);
        t.mock.restoreAll();
        assert.ok(injected > 0, 'fault must reach the production read');
        assertOld(tree, config);
        assertNoTemps(tree);
        assertFailed(value, new RegExp(code));
      });
    }
  }

  for (const fault of ['partial-write', 'rename', 'fsync']) {
    test(`${config.name}: ${fault} failure preserves old bytes and cleans private staging`, async (t) => {
      const tree = fixture(t, config);
      const { openSync, writeFileSync, renameSync, fsyncSync } = fs;
      const handles = new Set();
      let injected = 0;
      const isConfigPath = (file) => typeof file === 'string'
        && (file === tree.dest || file.startsWith(`${tree.dest}.import-tmp`));
      t.mock.method(fs, 'openSync', function (file, ...args) {
        const fd = openSync.call(this, file, ...args);
        if (isConfigPath(file)) handles.add(fd);
        return fd;
      });
      t.mock.method(fs, 'writeFileSync', function (file, data, ...args) {
        if (fault === 'partial-write' && (isConfigPath(file) || handles.has(file))) {
          injected++;
          writeFileSync.call(this, file, Buffer.from(data).subarray(0, 17), ...args);
          throw ioError('ENOSPC');
        }
        return writeFileSync.call(this, file, data, ...args);
      });
      t.mock.method(fs, 'renameSync', function (from, to, ...args) {
        if (fault === 'rename' && to === tree.dest) { injected++; throw ioError('EACCES'); }
        return renameSync.call(this, from, to, ...args);
      });
      t.mock.method(fs, 'fsyncSync', function (fd) {
        if (fault === 'fsync' && handles.has(fd)) { injected++; throw ioError('EIO'); }
        return fsyncSync.call(this, fd);
      });
      const value = await outcome(tree.options);
      t.mock.restoreAll();
      assert.equal(injected, 1, 'fault must reach selected configuration publication');
      assertOld(tree, config);
      assertNoTemps(tree);
      assertFailed(value, /ENOSPC|EACCES|EIO/);
      recoverInterruptedImport(tree.options);
      assertOld(tree, config);
      assertNoTemps(tree);
    });
  }

  test(`${config.name}: real destination file symlink is refused`, async (t) => {
    const tree = fixture(t, config);
    fs.unlinkSync(tree.dest);
    if (!createFileSymlinkOrSkip(t, tree.outside, tree.dest)) return;
    const value = await outcome(tree.options);
    assertOld(tree, config);
    assert.ok(fs.lstatSync(tree.dest).isSymbolicLink(), 'refusal preserves the link itself');
    assertFailed(value, /unsafe-destination/);
    assertNoTemps(tree);
  });

  test(`${config.name}: real destination parent junction is refused`, async (t) => {
    const tree = fixture(t, config);
    const moved = path.join(tree.root, 'outside-dir');
    fs.renameSync(tree.destHome, moved);
    fs.symlinkSync(moved, tree.destHome, 'junction');
    const value = await outcome(tree.options);
    assertOld(tree, config);
    assertNoTemps(tree);
    assertFailed(value, /unsafe-destination/);
  });

  test(`${config.name}: preplanted legacy temp symlink is never opened or removed`, async (t) => {
    const tree = fixture(t, config);
    const legacyTmp = `${tree.dest}.import-tmp`;
    if (!createFileSymlinkOrSkip(t, tree.outside, legacyTmp)) return;
    const value = await outcome(tree.options);
    assert.equal(value.result?.ok, true);
    assert.equal(fs.readFileSync(tree.outside, 'utf8'), config.old);
    assert.ok(fs.lstatSync(legacyTmp).isSymbolicLink());
    assert.equal(fs.readFileSync(tree.source, 'utf8'), config.source);
  });

  test(`${config.name}: absent destination is the permitted ENOENT case`, async (t) => {
    const tree = fixture(t, config);
    fs.unlinkSync(tree.dest);
    const value = await outcome(tree.options);
    assert.equal(value.result?.ok, true);
    const imported = fs.readFileSync(tree.dest, 'utf8');
    assert.ok(imported.includes(config.name === 'mcp' ? 'id: new-server' : config.source.trim()));
    assertNoTemps(tree);
  });

  test(`${config.name}: random staging is exclusive and a collision cannot clobber a link`, async (t) => {
    const tree = fixture(t, config);
    if (!requireFileSymlinkOrSkip(t, tree)) return;
    const { openSync } = fs;
    let planted;
    t.mock.method(fs, 'openSync', function (file, flags, mode) {
      if (typeof file === 'string' && file.startsWith(`${tree.dest}.import-tmp-`)) {
        assert.match(file.slice(`${tree.dest}.import-tmp-`.length), /^[0-9a-f-]{36}$/);
        assert.equal(flags, 'wx');
        assert.equal(mode, 0o600);
        planted = file;
        fs.symlinkSync(tree.outside, file, 'file');
      }
      return openSync.call(this, file, flags, mode);
    });
    const value = await outcome(tree.options);
    t.mock.restoreAll();
    assert.ok(planted, 'fault must reach the exclusive staging open');
    assertOld(tree, config);
    assert.ok(fs.lstatSync(planted).isSymbolicLink(), 'unowned collision must not be cleaned');
    assertFailed(value, /EEXIST/);
  });

  for (const leaf of ['file', 'parent']) {
    test(`${config.name}: ${leaf} inspection error cannot authorize a write`, async (t) => {
      const tree = fixture(t, config);
      const { lstatSync } = fs;
      let injected = 0;
      t.mock.method(fs, 'lstatSync', function (file, ...args) {
        if (file === (leaf === 'file' ? tree.dest : tree.destHome)) {
          injected++;
          throw ioError('EACCES');
        }
        return lstatSync.call(this, file, ...args);
      });
      const value = await outcome(tree.options);
      t.mock.restoreAll();
      assert.ok(injected > 0);
      assertOld(tree, config);
      assertNoTemps(tree);
      assertFailed(value, /EACCES|unsafe-destination/);
    });
  }

  test(`${config.name}: a file hardlink is refused without changing either name`, async (t) => {
    const tree = fixture(t, config);
    fs.unlinkSync(tree.dest);
    fs.linkSync(tree.outside, tree.dest);
    const value = await outcome(tree.options);
    assertOld(tree, config);
    assert.equal(fs.lstatSync(tree.dest).nlink, 2);
    assertNoTemps(tree);
    assertFailed(value, /unsafe-destination/);
  });

  test(`${config.name}: destination link introduced during staging is caught before rename`, async (t) => {
    const tree = fixture(t, config);
    if (!requireFileSymlinkOrSkip(t, tree)) return;
    const { openSync, writeFileSync } = fs;
    let stagedFd;
    let injected = 0;
    t.mock.method(fs, 'openSync', function (file, ...args) {
      const fd = openSync.call(this, file, ...args);
      if (typeof file === 'string' && file.startsWith(`${tree.dest}.import-tmp-`)) stagedFd = fd;
      return fd;
    });
    t.mock.method(fs, 'writeFileSync', function (file, ...args) {
      const result = writeFileSync.call(this, file, ...args);
      if (file === stagedFd) {
        injected++;
        fs.unlinkSync(tree.dest);
        fs.symlinkSync(tree.outside, tree.dest, 'file');
      }
      return result;
    });
    const value = await outcome(tree.options);
    t.mock.restoreAll();
    assert.equal(injected, 1);
    assertOld(tree, config);
    assert.ok(fs.lstatSync(tree.dest).isSymbolicLink());
    assertNoTemps(tree);
    assertFailed(value, /unsafe-destination/);
  });

  test(`${config.name}: successful merge retains old entries and stages away from live file`, async (t) => {
    const tree = fixture(t, config);
    const { openSync, writeFileSync, renameSync } = fs;
    const staging = new Map();
    let publishes = 0;
    t.mock.method(fs, 'openSync', function (file, flags, mode) {
      const fd = openSync.call(this, file, flags, mode);
      if (typeof file === 'string' && file.startsWith(`${tree.dest}.import-tmp-`)) {
        assert.equal(flags, 'wx');
        assert.equal(mode, 0o600);
        staging.set(fd, file);
      }
      return fd;
    });
    t.mock.method(fs, 'writeFileSync', function (file, ...args) {
      if (staging.has(file)) assert.equal(fs.readFileSync(tree.dest, 'utf8'), config.old);
      assert.notEqual(file, tree.dest, 'never truncate the live configuration');
      return writeFileSync.call(this, file, ...args);
    });
    t.mock.method(fs, 'renameSync', function (from, to) {
      if (to === tree.dest) {
        publishes++;
        assert.ok([...staging.values()].includes(from));
        assert.equal(fs.readFileSync(tree.dest, 'utf8'), config.old);
      }
      return renameSync.call(this, from, to);
    });
    const value = await outcome(tree.options);
    t.mock.restoreAll();
    assert.equal(value.result?.ok, true, value.error?.stack);
    assert.equal(publishes, 1);
    const result = fs.readFileSync(tree.dest, 'utf8');
    for (const line of config.old.trim().split('\n')) {
      // MCP's existing renderer quotes URL scalars; compare its retained id.
      if (config.name !== 'mcp' || line.includes('id:')) assert.ok(result.includes(line));
    }
    assert.equal(fs.readFileSync(tree.source, 'utf8'), config.source);
    assert.equal(fs.readFileSync(tree.outside, 'utf8'), config.old);
    assertNoTemps(tree);
  });
}
