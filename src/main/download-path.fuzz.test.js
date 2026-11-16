'use strict';

// Property-based fuzz for download filename hygiene: sanitizeDownloadFilename
// (will-download rename) and the release-asset save paths that share it —
// update.js fullInstallerPath, update-center service paths() and the delta
// installer's dest. None may ever produce a name that escapes its directory,
// hits a Windows device name, or keeps control characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');

const { sanitizeDownloadFilename, downloadSavePath, MAX_DOWNLOAD_NAME_CHARS } = require('./download-path');
const { fullInstallerPath } = require('./update');
const { createUpdateCenter } = require('./update-center/service');
const { installDelta } = require('../launcher/delta/install');
const { withOwnedTempDir } = require('../shared/fs-safe');

const NUM_RUNS = 400;

const nameArb = fc.oneof(
  fc.string({ maxLength: 60 }),
  fc.string({
    unit: fc.constantFrom(
      'a', 'B', '0', '.', ' ', '/', '\\', ':', '*', '?', '"', '<', '>', '|',
      '-', '_', '..', '...', 'CON', 'con', 'nul', 'aux', 'prn', 'com1', 'lpt9',
      'COM¹', 'LPT³', 'conin$', 'conout$', '中', 'é', '🐳', '\x00', '\x1f', '\x7f', '\t', '\n',
    ),
    maxLength: 80,
  }),
  fc.constantFrom(
    '..', '.', '...', 'a/b/c.txt', '..\\..\\evil.exe', 'C:\\win\\x.exe',
    'con', 'CON.txt', 'nul', 'lpt1.png', 'com2', 'file.', 'file ', ' . ',
    'Whale-Isle-Setup.exe', 'release.tar.gz', 'a'.repeat(400), '', '  ',
  ),
);

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?:\.|$)/i;

function assertCleanName(out, input) {
  assert.notEqual(out, '', input);
  assert.equal(out.includes('/'), false, `${input} -> ${out}`);
  assert.equal(out.includes('\\'), false, `${input} -> ${out}`);
  assert.equal(/[\x00-\x1f\x7f]/.test(out), false, `${input} -> ${out}`);
  assert.equal(/[<>:"|?*]/.test(out), false, `${input} -> ${out}`);
  assert.notEqual(out, '.', input);
  assert.notEqual(out, '..', input);
  assert.equal(/[. ]$/.test(out), false, `${input} -> ${out}`);
  assert.equal(WINDOWS_RESERVED.test(out), false, `${input} -> ${out}`);
  assert.equal(Array.from(out).length <= MAX_DOWNLOAD_NAME_CHARS, true, `${input} -> ${out}`);
}

test('sanitizeDownloadFilename: output is a safe leaf on every input', () => {
  fc.assert(fc.property(nameArb, (input) => {
    assertCleanName(sanitizeDownloadFilename(input), input);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('sanitizeDownloadFilename is idempotent', () => {
  fc.assert(fc.property(nameArb, (input) => {
    const once = sanitizeDownloadFilename(input);
    assert.equal(sanitizeDownloadFilename(once), once, input);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('downloadSavePath always resolves inside the downloads directory', async () => {
  await fc.assert(fc.asyncProperty(nameArb, async (input) => {
    await withOwnedTempDir('dshd-fuzz-dl-', async (dir) => {
      const target = downloadSavePath(dir, input);
      assert.equal(path.dirname(target), path.resolve(dir), `${input} -> ${target}`);
    });
  }), { numRuns: 100 });
});

// Regression for #494: the old basename+allow-list kept '.', '..' and '' —
// path.basename returns them for '..'/'.'/slash-only names and the allow-list
// keeps dots — so the installer path landed on userData or the updates dir
// itself. sanitizeDownloadFilename must keep every leaf inside its directory.
const HOSTILE_NAMES = ['..', '.', '/', '\\\\', '..\\..', '', '  ', '...', 'CON', 'nul', 'file.', 'file '];

test('fullInstallerPath keeps dot-only, empty and reserved asset names inside updates/', () => {
  const userDataDir = path.resolve('/tmp/dshd-fuzz-userdata');
  const updatesDir = path.join(userDataDir, 'updates');
  for (const assetName of HOSTILE_NAMES) {
    const result = fullInstallerPath({ assetName }, { userDataDir });
    assert.equal(path.dirname(result), updatesDir, `${assetName} -> ${result}`);
    assertCleanName(path.basename(result), assetName);
  }
  // A missing asset name still falls back to the default installer name.
  assert.equal(fullInstallerPath({}, { userDataDir }), path.join(updatesDir, 'Whale-Isle-Setup.exe'));
});

test('update-center paths() keeps hostile asset names inside updates/', async () => {
  await withOwnedTempDir('dshd-fuzz-uc-', async (dir) => {
    const center = createUpdateCenter({ userDataDir: dir, getRoute: () => 'github' });
    const updatesDir = path.join(dir, 'updates');
    for (const assetName of [...HOSTILE_NAMES, '..\\evil.exe']) {
      const { final, partial } = center._internals.paths({ assetName });
      assert.equal(path.dirname(final), updatesDir, `${assetName} -> ${final}`);
      assert.equal(path.dirname(partial), updatesDir, `${assetName} -> ${partial}`);
      assertCleanName(path.basename(final), assetName);
    }
  });
});

test('delta install writes the artifact inside the delta directory', async () => {
  await withOwnedTempDir('dshd-fuzz-delta-', async (dir) => {
    const deltaDir = path.join(dir, 'deltas');
    const destinations = [];
    const release = {
      tag_name: 'v2.0.0',
      assets: [
        { name: '..\\..\\evil-delta-1.0.0-2.0.0.zip', browser_download_url: 'https://x.test/d.zip' },
        { name: 'SHA512SUMS.txt', browser_download_url: 'https://x.test/sums.txt' },
      ],
    };
    const result = await installDelta('v2.0.0', null, {
      isLauncherPackage: () => true,
      installedInfo: async () => ({ registeredInstall: true, installPath: dir, version: '1.0.0' }),
      route: 'github',
      fetchRelease: async () => release,
      deltaDir,
      update: {
        downloadReleaseAsset: async (_info, dest) => {
          destinations.push(dest);
          fs.writeFileSync(dest, 'zip-bytes');
          return dest;
        },
      },
      applyFile: async () => ({ ok: true, applied: {} }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(destinations.map((dest) => path.dirname(dest)), [deltaDir]);
    assertCleanName(path.basename(destinations[0]), 'delta asset name');
  });
});

test('fullInstallerPath stays inside the updates directory', () => {
  const assetArb = fc.oneof(nameArb, fc.constantFrom(
    'Whale-Isle-Setup-1.2.3.exe', 'Whale-Isle-delta-1.0-2.0.zip', 'SHA512SUMS.txt',
  ));
  fc.assert(fc.property(assetArb, fc.string({ unit: fc.constantFrom('u', '/', 'x', '.', '-'), minLength: 1, maxLength: 12 }),
    (assetName, ud) => {
      const userDataDir = path.resolve('/tmp', ud.replace(/\//g, 'u'));
      const result = fullInstallerPath({ assetName }, { userDataDir });
      const updatesDir = path.join(userDataDir, 'updates');
      assert.equal(path.dirname(result), updatesDir, `${assetName} -> ${result}`);
      assertCleanName(path.basename(result), assetName);
      return true;
    }), { numRuns: NUM_RUNS });
});
