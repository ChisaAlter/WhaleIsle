'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { hashRuntimeArchive, writeRuntimeArchiveIdentity } = require('../shared/harness-runtime-identity');

const TEST_ARCHIVE_SHA256 = 'a'.repeat(64);

const electronStub = { app: {} };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return electronStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  packagedHarnessRoot,
  tarCommand,
  hasBuiltHarness,
  canReuseExtractedHarness,
  packagedRuntimeIdentity,
  writeRuntimeStamp,
  ensurePackagedHarness,
  retireStaleExtract,
  sweepStaleExtracts,
  settleBackgroundWork,
  STALE_SUFFIX,
} = require('./harness-extract');
Module._load = originalLoad;

/**
 * Point the module at a temp packaged layout: `resources/vendor` for the
 * archive + pin, `userData/runtime/<version>` for the extract.
 * @param {import('node:test').TestContext} t
 * @returns {{ root: string, resources: string, userData: string, dest: string, loose: string, logs: string[] }}
 */
function packagedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-extract-'));
  const resources = path.join(root, 'resources');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(resources, 'vendor'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const previousResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
  // harness-extract captured electronStub.app by reference at require time,
  // so the fixture mutates that object instead of replacing it.
  Object.assign(electronStub.app, {
    isPackaged: true,
    getPath: () => userData,
    getVersion: () => '9.9.9',
  });
  t.after(async () => {
    Object.defineProperty(process, 'resourcesPath', { value: previousResourcesPath, configurable: true });
    for (const key of Object.keys(electronStub.app)) delete electronStub.app[key];
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    resources,
    userData,
    dest: path.join(userData, 'runtime', '9.9.9'),
    loose: path.join(resources, 'vendor', 'deepseek-harness'),
    logs: [],
  };
}

test('installed runtime takes precedence over same-version userData without repairing or extracting it', async t => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.loose);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, '.dsh-runtime-links.json'), 'invalid legacy manifest');
  assert.equal(packagedHarnessRoot(), fixture.loose);
  assert.equal(await ensurePackagedHarness(line => fixture.logs.push(line)), fixture.loose);
  assert.deepEqual(fixture.logs, []);
  assert.equal(fs.readFileSync(path.join(fixture.dest, '.dsh-runtime-links.json'), 'utf8'), 'invalid legacy manifest');
});

function seedBuiltHarness(root) {
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n');
  const pkg = path.join(root, 'packages', 'client', 'ui-user-terminal', 'lib');
  fs.mkdirSync(path.join(pkg, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'client.js'), 'export {}\n');
  for (const name of ['ghostty-vt.wasm', 'ghostty-write-pty.wasm', 'SymbolsNerdFontMono-Regular.woff2']) {
    fs.writeFileSync(path.join(pkg, 'assets', name), 'x');
  }
}

test('tarCommand uses PATH tar outside Windows', () => {
  assert.equal(tarCommand('linux'), 'tar');
  assert.equal(tarCommand('darwin'), 'tar');
});

test('tarCommand prefers the Windows system tar for local absolute paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-tar-test-'));
  const system32 = path.join(root, 'System32');
  const executable = path.join(system32, 'tar.exe');
  fs.mkdirSync(system32, { recursive: true });
  fs.writeFileSync(executable, '');
  const previousSystemRoot = process.env.SystemRoot;
  const previousWindir = process.env.WINDIR;
  process.env.SystemRoot = root;
  delete process.env.WINDIR;
  t.after(() => {
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
    if (previousWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = previousWindir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(tarCommand('win32'), executable);
});

test('tarCommand falls back to PATH when system tar is unavailable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-system-tar-'));
  const previousSystemRoot = process.env.SystemRoot;
  const previousWindir = process.env.WINDIR;
  process.env.SystemRoot = root;
  delete process.env.WINDIR;
  t.after(() => {
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
    if (previousWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = previousWindir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(tarCommand('win32'), 'tar');
});

test('hasBuiltHarness requires Ghostty assets beside terminal client.js', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n');
  assert.equal(hasBuiltHarness(root), false);

  seedBuiltHarness(root);
  assert.equal(hasBuiltHarness(root), true);
});

test('a built extract without a stamp is not reused across same-version overlays', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.0-rc.7"}\n');
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
    TEST_ARCHIVE_SHA256,
  );
  assert.equal(hasBuiltHarness(root), true);
  assert.equal(canReuseExtractedHarness(root, identity), false);
});

test('an extract matching the packaged pin and archive content digest is reused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
    TEST_ARCHIVE_SHA256,
  );
  writeRuntimeStamp(root, identity);
  assert.equal(canReuseExtractedHarness(root, identity), true);
});

test('an extract is refreshed when the packaged archive size changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resized-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  writeRuntimeStamp(root, packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
    TEST_ARCHIVE_SHA256,
  ));
  const next = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949441,
    TEST_ARCHIVE_SHA256,
  );
  assert.equal(canReuseExtractedHarness(root, next), false);
});

test('legacy stamps without an archive digest cannot reuse an extract', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  writeRuntimeStamp(root, { sha: 'same', npm: 'same', archiveBytes: 123 });
  assert.equal(canReuseExtractedHarness(root, packagedRuntimeIdentity({ sha: 'same', npm: 'same' }, 123, TEST_ARCHIVE_SHA256)), false);
});

test('same-version overlays refresh equal-size archives and then reuse without rehashing', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  const html = path.join(tree, 'apps/web/dist/index.html');
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'same', npm: 'same' }));
  const pack = async content => {
    fs.writeFileSync(html, content);
    const result = spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString());
    return writeRuntimeArchiveIdentity(archive);
  };
  const first = await pack('<html>v1</html>\n');
  await ensurePackagedHarness();
  const second = await pack('<html>v2</html>\n');
  assert.equal(first.archiveBytes, second.archiveBytes);
  assert.notEqual(first.archiveSha256, second.archiveSha256);
  await ensurePackagedHarness();
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'apps/web/dist/index.html'), 'utf8'), '<html>v2</html>\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.dest, '.dshd-runtime.json'), 'utf8')).archiveSha256, second.archiveSha256);
  t.mock.method(fs, 'createReadStream', () => { throw new Error('unchanged startup must not stream the archive'); });
  assert.equal(await ensurePackagedHarness(), fixture.dest);
  t.mock.restoreAll();
});

test('a legacy stamp refreshes once and records the packaged digest', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  assert.equal(spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true }).status, 0);
  const manifest = await writeRuntimeArchiveIdentity(archive);
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'same', npm: 'same' }));
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'legacy-marker'), 'old');
  writeRuntimeStamp(fixture.dest, { sha: 'same', npm: 'same', archiveBytes: manifest.archiveBytes });
  await ensurePackagedHarness();
  assert.equal(fs.existsSync(path.join(fixture.dest, 'legacy-marker')), false);
  assert.equal(canReuseExtractedHarness(fixture.dest, packagedRuntimeIdentity({ sha: 'same', npm: 'same' }, manifest.archiveBytes, manifest.archiveSha256)), true);
});

test('a packaged digest mismatch preserves the old runtime before extraction', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'keep.txt'), 'old-runtime');
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  fs.writeFileSync(archive, 'archive-v1');
  await writeRuntimeArchiveIdentity(archive);
  fs.writeFileSync(archive, 'archive-v2');
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'same', npm: 'same' }));
  await assert.rejects(ensurePackagedHarness(), /归档校验失败/);
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'keep.txt'), 'utf8'), 'old-runtime');
  assert.equal(fs.existsSync(`${fixture.dest}.previous`), false);
});

test('ensurePackagedHarness reuses only a stamped matching extract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'harness-extract.js'), 'utf8');
  assert.match(source, /canReuseExtractedHarness\(dest,/);
  assert.doesNotMatch(
    source,
    /if \(hasBuiltHarness\(dest\)\) \{\s*return dest;\s*\}\s*const loose/,
  );
});

function seedReusableLinkedRuntime(fixture) {
  seedBuiltHarness(fixture.dest);
  fs.mkdirSync(path.join(fixture.dest, 'physical'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dest, '.dsh-runtime-links.json'), JSON.stringify({
    version: 1, links: [{ path: 'node_modules/proof', target: 'physical' }],
  }));
  const pin = { sha: 'current', npm: 'current' };
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify(pin));
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'deepseek-harness.tar'), 'archive');
  writeRuntimeStamp(fixture.dest, packagedRuntimeIdentity(pin, 7, createHash('sha256').update('archive').digest('hex')));
}

test('packaged startup checks and repairs links without synchronous realpath on the UI thread', async (t) => {
  const fixture = packagedFixture(t);
  seedReusableLinkedRuntime(fixture);
  const realpathSync = fs.realpathSync;
  t.mock.method(fs, 'realpathSync', (file, ...args) => {
    if (String(file).startsWith(fixture.dest)) throw new Error('synchronous runtime link I/O on UI thread');
    return realpathSync(file, ...args);
  });
  const realpath = fs.promises.realpath;
  let timerRanDuringIO = false;
  t.mock.method(fs.promises, 'realpath', async (...args) => {
    await new Promise(resolve => setTimeout(() => { timerRanDuringIO = true; resolve(); }, 10));
    return realpath(...args);
  });
  assert.equal(await ensurePackagedHarness(), fixture.dest);
  assert.equal(timerRanDuringIO, true);
  assert.equal(await realpath(path.join(fixture.dest, 'node_modules/proof')), await realpath(path.join(fixture.dest, 'physical')));
  t.mock.restoreAll();
});

test('cancelling a slow startup link check stops preparation without re-extracting or deleting the runtime', async (t) => {
  const fixture = packagedFixture(t);
  seedReusableLinkedRuntime(fixture);
  const controller = new AbortController();
  const realpath = fs.promises.realpath;
  t.mock.method(fs.promises, 'realpath', async (...args) => {
    await new Promise(resolve => setTimeout(() => { controller.abort(); resolve(); }, 10));
    return realpath(...args);
  });
  await assert.rejects(ensurePackagedHarness(() => {}, { signal: controller.signal }), { code: 'DSH_CANCELLED' });
  assert.equal(hasBuiltHarness(fixture.dest), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, 'node_modules/proof')), false);
  t.mock.restoreAll();
});

test('failed async final-path link creation restores the previous runtime before returning', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'keep.txt'), 'old-runtime');
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  fs.mkdirSync(path.join(tree, 'physical'));
  fs.writeFileSync(path.join(tree, '.dsh-runtime-links.json'), JSON.stringify({
    version: 1, links: [{ path: 'node_modules/proof', target: 'physical' }],
  }));
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  const packed = spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true });
  assert.equal(packed.status, 0, packed.stderr?.toString());
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'new', npm: 'new' }));
  const symlink = fs.promises.symlink;
  t.mock.method(fs.promises, 'symlink', async (target, from, type) => {
    if (from.startsWith(fixture.dest + path.sep)) {
      await new Promise(resolve => setTimeout(resolve, 10));
      throw Object.assign(new Error('final junction locked'), { code: 'EPERM' });
    }
    return symlink(target, from, type);
  });
  await assert.rejects(ensurePackagedHarness(), /final junction locked/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'keep.txt'), 'utf8'), 'old-runtime');
  assert.equal(canReuseExtractedHarness(fixture.dest, packagedRuntimeIdentity({ sha: 'new', npm: 'new' }, fs.statSync(archive).size)), false);
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['9.9.9']);
});

test('ensurePackagedHarness keeps and reuses a bootable extract when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  const logs = [];
  const resolved = await ensurePackagedHarness((line) => logs.push(line));
  assert.equal(resolved, fixture.dest);
  assert.equal(hasBuiltHarness(fixture.dest), true);
  assert.match(logs.join('\n'), /降级复用/);
});

test('ensurePackagedHarness prefers the loose runtime when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.loose);
  const resolved = await ensurePackagedHarness(() => {});
  assert.equal(resolved, fixture.loose);
});

test('ensurePackagedHarness throws without deleting a partial extract when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  // Partial extract: bin.js only, not a bootable runtime.
  fs.mkdirSync(path.join(fixture.dest, 'apps', 'cli', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dest, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  await assert.rejects(
    () => ensurePackagedHarness(() => {}),
    /缺少运行时归档/,
  );
  assert.equal(fs.existsSync(path.join(fixture.dest, 'apps', 'cli', 'lib', 'bin.js')), true);
});

test('ensurePackagedHarness throws before touching the extract when the pin is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'deepseek-harness.tar'), 'not-a-real-archive');
  await assert.rejects(
    () => ensurePackagedHarness(() => {}),
    /harness-upstream\.json/,
  );
  assert.equal(hasBuiltHarness(fixture.dest), true);
});

test('ensurePackagedHarness re-extracts a stale extract only when the archive exists', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  fs.mkdirSync(path.join(tree, 'physical'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'physical', 'proof.txt'), 'relocated');
  fs.writeFileSync(path.join(tree, '.dsh-runtime-links.json'), JSON.stringify({
    version: 1, links: [{ path: 'node_modules/proof', target: 'physical' }],
  }));
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  const packed = spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true });
  if (packed.status !== 0) {
    t.skip('tar unavailable for archive fixture');
    return;
  }
  fs.writeFileSync(
    path.join(fixture.resources, 'vendor', 'harness-upstream.json'),
    JSON.stringify({ sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' }),
  );
  // Stale extract: bootable but with no stamp, so it must be replaced.
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'stale-marker.txt'), 'old');
  const resolved = await ensurePackagedHarness(() => {});
  assert.equal(resolved, fixture.dest);
  assert.equal(hasBuiltHarness(fixture.dest), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, 'stale-marker.txt')), false);
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    fs.statSync(archive).size,
    await hashRuntimeArchive(archive),
  );
  assert.equal(canReuseExtractedHarness(fixture.dest, identity), true);
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'node_modules', 'proof', 'proof.txt'), 'utf8'), 'relocated');
  // CI's TEMP may contain RUNNER~1 while the junction resolves to runneradmin.
  assert.equal(fs.realpathSync.native(path.join(fixture.dest, 'node_modules', 'proof')), fs.realpathSync.native(path.join(fixture.dest, 'physical')));
  // The stale tree was retired by rename and deleted in the background, so
  // nothing but the fresh extract remains once that work settles.
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.join(fixture.userData, 'runtime')), ['9.9.9']);
});

test('ensurePackagedHarness never deletes a stale extract synchronously', () => {
  // fs.rmSync of a ~57k-file runtime blocked the Electron main thread 16–46 s
  // and Windows reported the window 未响应 (WER AppHangTransient).
  const source = fs.readFileSync(path.join(__dirname, 'harness-extract.js'), 'utf8');
  assert.doesNotMatch(source, /\brmSync\(/);
  assert.match(source, /await fsp.rename\(dest, retired\)/);
});

test('retireStaleExtract renames first and removes the retired tree off the caller path', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-runtime-'));
  t.after(async () => {
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dest = path.join(root, 'runtime', '1.0.0');
  seedBuiltHarness(dest);
  const logs = [];
  const retired = await retireStaleExtract(dest, (line) => logs.push(line));
  assert.equal(fs.existsSync(dest), false, 'dest is free for the fresh extract immediately');
  assert.ok(retired && retired.startsWith(`${dest}${STALE_SUFFIX}`));
  await settleBackgroundWork();
  assert.equal(fs.existsSync(retired), false);
  assert.deepEqual(logs, []);
});

test('sweepStaleExtracts removes retired trees left behind by an interrupted run', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-runtime-'));
  t.after(async () => {
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtime = path.join(root, 'runtime');
  const keep = path.join(runtime, '1.0.0');
  const leftover = path.join(runtime, `1.0.0${STALE_SUFFIX}abc-123`);
  seedBuiltHarness(keep);
  seedBuiltHarness(leftover);
  fs.writeFileSync(path.join(runtime, 'notes.stale-file.txt'), 'file, not a dir');
  const swept = await sweepStaleExtracts(runtime, () => {});
  assert.deepEqual(swept, [leftover]);
  await settleBackgroundWork();
  assert.equal(fs.existsSync(leftover), false);
  assert.equal(hasBuiltHarness(keep), true);
  assert.equal(fs.existsSync(path.join(runtime, 'notes.stale-file.txt')), true);
  assert.deepEqual(await sweepStaleExtracts(path.join(root, 'missing'), () => {}), []);
});

test('failed extraction preserves the previous runtime and never stamps a partial tree', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'keep.txt'), 'old-runtime');
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'deepseek-harness.tar'), 'broken archive');
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'new', npm: 'new' }));
  await assert.rejects(ensurePackagedHarness(() => {}));
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'keep.txt'), 'utf8'), 'old-runtime');
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['9.9.9']);
});

test('low space rejects before retiring an existing runtime or spawning tar', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'deepseek-harness.tar'), 'archive');
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'new', npm: 'new' }));
  const old = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 1, bsize: 4096 });
  t.after(() => { fs.statfsSync = old; });
  await assert.rejects(ensurePackagedHarness(() => {}), { code: 'ENOSPC' });
  assert.equal(hasBuiltHarness(fixture.dest), true);
});

test('tar timeout kills the child, waits for close and reports elapsed activity', async () => {
  const { EventEmitter } = require('node:events');
  const { runTar } = require('./harness-extract');
  const child = new EventEmitter(); child.stderr = new EventEmitter();
  let killed = false; let closed = false;
  child.kill = () => { killed = true; setTimeout(() => { closed = true; child.emit('close', null); }, 10); return true; };
  const logs = [];
  await assert.rejects(runTar([], { spawn: () => child, timeoutMs: 35, heartbeatMs: 5, log: (line) => logs.push(line) }), /解压超时/);
  assert.equal(killed, true);
  assert.equal(closed, true, 'no cleanup/retry while the extractor is still writing');
  assert.ok(logs.some((line) => /已用时/.test(line)));
});

test('tar cancellation kills and waits for the writer before settling', async () => {
  const { EventEmitter } = require('node:events');
  const { runTar } = require('./harness-extract');
  const child = new EventEmitter(); child.stderr = new EventEmitter();
  const abort = new AbortController();
  child.kill = () => { setImmediate(() => child.emit('close', null)); return true; };
  const pending = runTar([], { spawn: () => child, signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { code: 'DSH_CANCELLED' });
});

test('interrupted replacement restores a previous runtime before sweeping leftovers', async (t) => {
  const fixture = packagedFixture(t);
  const { recoverRuntimeReplacement } = require('./harness-extract');
  seedBuiltHarness(`${fixture.dest}.previous`);
  fs.writeFileSync(path.join(`${fixture.dest}.previous`, 'keep.txt'), 'previous');
  seedBuiltHarness(fixture.dest); // new files exist but no completion stamp
  await recoverRuntimeReplacement(fixture.dest, () => {});
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'keep.txt'), 'utf8'), 'previous');
  assert.equal(fs.existsSync(`${fixture.dest}.previous`), false);
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['9.9.9']);
});

test('a refused promotion rolls the previous runtime back without losing its files', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  const packed = spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true });
  assert.equal(packed.status, 0);
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'harness-upstream.json'), JSON.stringify({ sha: 'new', npm: 'new' }));
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'keep.txt'), 'old-runtime');
  const rename = fs.promises.rename;
  fs.promises.rename = async (from, to) => {
    if (from.startsWith(`${fixture.dest}.extract-`) && to === fixture.dest) {
      throw Object.assign(new Error('promotion locked'), { code: 'EPERM' });
    }
    return rename(from, to);
  };
  try {
    await assert.rejects(ensurePackagedHarness(() => {}), /promotion locked/);
  } finally { fs.promises.rename = rename; }
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'keep.txt'), 'utf8'), 'old-runtime');
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['9.9.9']);
});
