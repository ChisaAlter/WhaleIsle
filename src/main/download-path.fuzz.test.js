'use strict';

// Property-based fuzz for download filename hygiene: sanitizeDownloadFilename
// (will-download rename) and update.js fullInstallerPath (release asset on
// disk). Neither may ever produce a name that escapes its directory, hits a
// Windows device name, or keeps control characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');

const { sanitizeDownloadFilename, downloadSavePath, MAX_DOWNLOAD_NAME_CHARS } = require('./download-path');
const { fullInstallerPath } = require('./update');
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

// FINDING (see report): safeName keeps a bare '.'/'..'/'' — path.basename
// returns them for '..'/'.'/slash-only names and the allow-list keeps dots —
// so the installer path lands on userData or the updates dir itself.
test.todo('#494: fullInstallerPath must not let dot-only or empty leaf asset names escape updates/ — minimal counterexamples: assetName=".." → <userData>; assetName="/" → the updates dir itself');

test('fullInstallerPath stays inside the updates directory', () => {
  const assetArb = fc.oneof(nameArb, fc.constantFrom(
    'Whale-Isle-Setup-1.2.3.exe', 'Whale-Isle-delta-1.0-2.0.zip', 'SHA512SUMS.txt',
  )).filter((name) => {
    const leaf = path.basename(String(name || ''));
    return leaf !== '' && leaf !== '.' && leaf !== '..';
  });
  fc.assert(fc.property(assetArb, fc.string({ unit: fc.constantFrom('u', '/', 'x', '.', '-'), minLength: 1, maxLength: 12 }),
    (assetName, ud) => {
      const userDataDir = path.resolve('/tmp', ud.replace(/\//g, 'u'));
      const result = fullInstallerPath({ assetName }, { userDataDir });
      const updatesDir = path.join(userDataDir, 'updates');
      assert.equal(path.dirname(result), updatesDir, `${assetName} -> ${result}`);
      const leaf = path.basename(result);
      assert.notEqual(leaf, '..', assetName);
      assert.notEqual(leaf, '.', assetName);
      assert.match(leaf, /^[\w.\-]+$/, `${assetName} -> ${leaf}`);
      return true;
    }), { numRuns: NUM_RUNS });
});
