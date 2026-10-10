'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Pins that make `npm test` require `vendor/deepseek-harness/node_modules`.
 * These pass on a prepared developer machine and fail on a clean CI checkout.
 */
function listVendorHarnessRootPins(source) {
  const pins = [];
  const joined = /DSH_HARNESS_ROOT\s*=\s*path\.join\([^;]*['"]vendor['"]\s*,\s*['"]deepseek-harness['"]/g;
  const literal = /DSH_HARNESS_ROOT\s*=\s*[^;\n]*vendor[/\\]deepseek-harness/g;
  for (const re of [joined, literal]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) pins.push(match[0]);
  }
  return pins;
}

function walkTestFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTestFiles(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function fakePng(width, height) {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf.write('PNG', 1, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('macOS icon check rejects the 386px capture that failed v0.2.3 packing', () => {
  const { assertMacReleaseIcon } = require('../../scripts/check-mac-icon');
  assert.throws(
    () => assertMacReleaseIcon(fakePng(386, 386), 'assets/icon.png'),
    /386x386/,
  );
});

test('macOS release icon meets electron-builder minimum dimensions', () => {
  const { assertMacReleaseIcon, MIN_MAC_ICON_PX } = require('../../scripts/check-mac-icon');
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'icon.png'));
  const size = assertMacReleaseIcon(png, 'assets/icon.png');
  assert.ok(size.width >= MIN_MAC_ICON_PX);
  assert.ok(size.height >= MIN_MAC_ICON_PX);
});

test('icon renderer writes a display-independent PNG size', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'render-icon.js'), 'utf8');
  assert.match(source, /PNG_SIZE = 1024/);
  assert.match(source, /resize\(\{[\s\S]*width:\s*PNG_SIZE[\s\S]*height:\s*PNG_SIZE/);
  assert.match(source, /assertMacReleaseIcon/);
});

test('a vendor DSH_HARNESS_ROOT pin is visible to the isolation scan', () => {
  const tagged = `process.env.${'DSH_HARNESS' + '_ROOT'} = path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness');\n`;
  assert.equal(listVendorHarnessRootPins(tagged).length, 1);
});

test('desktop unit tests do not pin DSH_HARNESS_ROOT to vendor/deepseek-harness', () => {
  const hits = [];
  for (const file of walkTestFiles(path.join(ROOT, 'src'))) {
    const pins = listVendorHarnessRootPins(fs.readFileSync(file, 'utf8'));
    for (const pin of pins) hits.push(`${path.relative(ROOT, file).replaceAll('\\', '/')}: ${pin}`);
  }
  assert.deepEqual(hits, []);
});

test('setup-harness uses the lockfile-installed pnpm executable', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'setup-harness.js'), 'utf8');
  assert.match(source, /node_modules['"], ['"]pnpm['"], ['"]bin['"], ['"]pnpm\.mjs/);
  const installed = require('pnpm/package.json');
  const declared = require('../../package.json').devDependencies.pnpm;
  assert.equal(installed.version, declared);
  const entry = path.join(ROOT, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs');
  const result = require('node:child_process').spawnSync(process.execPath, [entry, '--version'], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), declared);
});

test('setup-harness builds the official DSH client profile', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'setup-harness.js'), 'utf8');
  assert.match(source, /'run', 'build:official'/);
  assert.doesNotMatch(source, /'run', 'build'\]/);
});

test('electron-builder app-builder-lib resolves @electron/get with ElectronDownloadCacheMode', () => {
  const builderPkg = path.dirname(require.resolve('electron-builder/package.json'));
  const libEntry = require.resolve('app-builder-lib', { paths: [builderPkg] });
  const from = path.join(path.dirname(libEntry), 'util');
  const resolved = require.resolve('@electron/get', { paths: [from] });
  const get = require(resolved);
  assert.equal(
    typeof get.ElectronDownloadCacheMode?.ReadWrite,
    'number',
    `@electron/get at ${resolved} must export ElectronDownloadCacheMode (NSIS/DMG tool download)`,
  );
});

test('pnpm workspace pins app-builder-lib away from @electron/get 3.0.0', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(yaml, /allowBuilds:/);
  assert.match(yaml, /\bnode-pty:/);
  assert.match(yaml, /app-builder-lib>@electron\/get:\s*5\.1\.0/);
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  assert.match(
    lock,
    /app-builder-lib@26\.15\.3[\s\S]*?'@electron\/get': 5\.1\.0/,
  );
  assert.doesNotMatch(
    lock,
    /app-builder-lib@26\.15\.3\(dmg-builder@26\.15\.3\)[\s\S]*?'@electron\/get': 3\.0\.0/,
  );
});
