'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertHarnessRuntime,
  assertNodeModulesManifests,
  assertVendoredPluginRuntimeDeps,
  collectFiles,
  collectPnpmFlattenFiles,
  copyFiles,
  deployCliEntries,
  nodeBinaryHasExternalDylibs,
  nodePtyPrebuildRelative,
  repairFlattenedCommanderEsm,
  repairFlattenedVersionIsolation,
  resolveDeployDir,
  resolveResourcesDir,
  restoreVendoredPluginNodeModules,
  installPluginRuntimeDeps,
  missingPluginRuntimeClosure,
} = require('../../scripts/after-pack');

const RC7_PIN = { npm: '0.1.0-rc.7' };

test('afterPack records the completed tar content identity before removing the assembly tree', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../scripts/after-pack.js'), 'utf8');
  const createTar = source.indexOf("execFileSync('tar', ['-cf'");
  const recordDigest = source.indexOf('await writeRuntimeArchiveIdentity(archive)', createTar);
  const removeTree = source.indexOf('fs.rmSync(longPath(harnessDest)', createTar);
  assert.ok(createTar >= 0 && recordDigest > createTar && removeTree > recordDigest);
});

function writeRuntimeVersions(root, npm) {
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ version: npm })}\n`);
  fs.mkdirSync(path.join(root, 'apps', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'package.json'), `${JSON.stringify({ version: npm })}\n`);
}

function writeNodePtyPrebuild(root, platform = process.platform, arch = process.arch) {
  const relative = nodePtyPrebuildRelative(platform, arch);
  const file = path.join(root, 'node_modules', 'node-pty', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'node-pty', 'package.json'), '{"name":"node-pty"}\n');
  fs.writeFileSync(file, 'native');
}

function makeFixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-test-'));
  const source = path.join(workspace, 'source');
  const shared = path.join(workspace, 'shared');
  const destination = path.join(workspace, 'destination');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'package.json'), '{"name":"shared"}\n');
  fs.writeFileSync(path.join(shared, 'index.js'), 'module.exports = true;\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return { source, shared, destination };
}

function linkPackage(source, shared, branch) {
  const nodeModules = path.join(source, branch, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.symlinkSync(shared, path.join(nodeModules, 'shared'), 'junction');
}

test('deployCliEntries excludes runtime state and separately assembled directories', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-entries-'));
  for (const name of ['.dsh-home', '.cache', 'node_modules', 'vendor', 'config', 'lib']) {
    fs.mkdirSync(path.join(workspace, name), { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, 'package.json'), '{}\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  assert.deepEqual(
    deployCliEntries(workspace).map(({ name }) => name).sort(),
    ['config', 'lib', 'package.json'],
  );
});

test('collectFiles deduplicates a linked package flattened to the same destination', (t) => {
  const fixture = makeFixture(t);
  linkPackage(fixture.source, fixture.shared, 'a');
  linkPackage(fixture.source, fixture.shared, 'b');

  const files = collectFiles(fixture.source, fixture.destination, false, true);
  const destinations = files.map(({ dest }) => path.relative(fixture.destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [path.join('node_modules', 'shared', 'index.js'), path.join('node_modules', 'shared', 'package.json')],
  );
});

test('collectFiles keeps shipped preset SKILL.md while stripping other markdown', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-skills-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'source');
  const destination = path.join(workspace, 'destination');
  const skill = path.join(
    source,
    'apps',
    'cli',
    'config',
    'agent-presets',
    'cordis',
    'skills',
    'editing-cordis-compositions',
    'SKILL.md',
  );
  const readme = path.join(source, 'apps', 'cli', 'README.md');
  const preset = path.join(source, 'apps', 'cli', 'config', 'agent-presets', 'cordis', 'preset.yml');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.dirname(readme), { recursive: true });
  fs.writeFileSync(skill, '# editing cordis compositions\n');
  fs.writeFileSync(readme, '# cli docs\n');
  fs.writeFileSync(preset, 'id: cordis\n');

  const files = collectFiles(source, destination, false, true);
  const destinations = files.map(({ dest }) => path.relative(destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('apps', 'cli', 'config', 'agent-presets', 'cordis', 'preset.yml'),
      path.join(
        'apps',
        'cli',
        'config',
        'agent-presets',
        'cordis',
        'skills',
        'editing-cordis-compositions',
        'SKILL.md',
      ),
    ],
  );
});

test('collectFiles keeps preset SKILL.md when rooted at the deploy config directory', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-deploy-skills-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'config');
  const destination = path.join(workspace, 'destination');
  const skill = path.join(
    source,
    'agent-presets',
    'cordis',
    'skills',
    'cordis-plugin-development',
    'SKILL.md',
  );
  const readme = path.join(source, 'README.md');
  const preset = path.join(source, 'agent-presets', 'cordis', 'preset.yml');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '# cordis plugin development\n');
  fs.writeFileSync(readme, '# config docs\n');
  fs.writeFileSync(preset, 'id: cordis\n');

  const files = collectFiles(source, destination, true, false);
  const destinations = files.map(({ dest }) => path.relative(destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('agent-presets', 'cordis', 'preset.yml'),
      path.join('agent-presets', 'cordis', 'skills', 'cordis-plugin-development', 'SKILL.md'),
    ],
  );
});

test('collectFiles preserves a linked package copied to distinct destinations', (t) => {
  const fixture = makeFixture(t);
  linkPackage(fixture.source, fixture.shared, 'a');
  linkPackage(fixture.source, fixture.shared, 'b');

  const files = collectFiles(fixture.source, fixture.destination, false, false);
  const destinations = files.map(({ dest }) => path.relative(fixture.destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('a', 'node_modules', 'shared', 'index.js'),
      path.join('a', 'node_modules', 'shared', 'package.json'),
      path.join('b', 'node_modules', 'shared', 'index.js'),
      path.join('b', 'node_modules', 'shared', 'package.json'),
    ],
  );
});

test('collectFiles filters workspace source trees but keeps package src and tests', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-source-filter-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destination = path.join(workspace, 'destination');
  const koffi = path.join(
    workspace,
    'node_modules',
    '.pnpm',
    'koffi@3.1.1',
    'node_modules',
    'koffi',
  );
  const files = new Map([
    [path.join('apps', 'cli', 'src', 'index.js'), 'workspace src'],
    [path.join('packages', 'shared', 'tests', 'index.js'), 'workspace tests'],
    [path.join('node_modules', '.pnpm', 'koffi@3.1.1', 'node_modules', 'koffi', 'package.json'), '{"name":"koffi"}\n'],
    [path.join('node_modules', '.pnpm', 'koffi@3.1.1', 'node_modules', 'koffi', 'src', 'koffi', 'index.js'), 'koffi runtime'],
    [path.join('node_modules', '.pnpm', 'koffi@3.1.1', 'node_modules', 'koffi', 'tests', 'runtime.js'), 'koffi tests'],
  ]);
  for (const [relative, content] of files) {
    const file = path.join(workspace, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const linkedKoffi = path.join(workspace, 'apps', 'desktop-host', 'node_modules', 'koffi');
  fs.mkdirSync(path.dirname(linkedKoffi), { recursive: true });
  fs.symlinkSync(koffi, linkedKoffi, process.platform === 'win32' ? 'junction' : 'dir');

  const destinations = collectFiles(workspace, destination, false, true)
    .map(({ dest }) => path.relative(destination, dest));

  assert.equal(destinations.includes(path.join('apps', 'cli', 'src', 'index.js')), false);
  assert.equal(destinations.includes(path.join('packages', 'shared', 'tests', 'index.js')), false);
  assert.equal(
    destinations.includes(path.join('node_modules', 'koffi', 'src', 'koffi', 'index.js')),
    true,
  );
  assert.equal(
    destinations.includes(path.join('node_modules', 'koffi', 'tests', 'runtime.js')),
    true,
  );
});

test('resolveDeployDir ignores local caches unless a deploy directory is explicit', () => {
  assert.equal(resolveDeployDir(undefined), null);
  assert.equal(resolveDeployDir(''), null);
  assert.equal(resolveDeployDir('off'), null);
  assert.equal(resolveDeployDir('.pack-release'), path.resolve('.pack-release'));
});

const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');

function writeDesktopForkPackages(root) {
  for (const pkg of DESKTOP_PACKAGES) {
    const dir = path.join(root, 'node_modules', ...pkg.name.split('/'));
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: pkg.name, main: 'lib/index.js' })}\n`,
    );
    fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export {}\n');
  }
}

function writeGhosttyTerminalPackage(root) {
  const base = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal', 'lib');
  fs.mkdirSync(path.join(base, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(base, 'client.js'), 'export {}\n');
  for (const name of ['ghostty-vt.wasm', 'ghostty-write-pty.wasm', 'SymbolsNerdFontMono-Regular.woff2']) {
    fs.writeFileSync(path.join(base, 'assets', name), 'asset');
  }
}

function writeMcpSdk(root) {
  const sdk = path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
}

function writeAjv(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'ajv', version })}\n`);
}

function writePinRuntimeFiles(root) {
  const files = new Map([
    [path.join('apps', 'cli', 'lib', 'bin.js'), 'export {}\n'],
    [path.join('apps', 'web', 'dist', 'index.html'), '<!doctype html>\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js'), 'export {}\n'],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'),
      'export {}\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
      'conversation.chat.user-actions\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
      'conversation.chat.user-actions\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
      'fork accepts atSeq or beforeSeq\n',
    ],
    [path.join('node_modules', '@deepseek-ai', 'dsh-mcp-servers-file', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-host-mcp-servers', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-host-skill-inventory', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'client.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'client.js'), 'export {}\n'],
    [path.join('node_modules', 'koffi', 'src', 'koffi', 'index.js'), 'export default {}\n'],
  ]);
  for (const [relative, content] of files) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

test('assertHarnessRuntime accepts a complete compatible host', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  writeMcpSdk(root);
  writeAjv(path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv'), '8.17.1');

  assert.doesNotThrow(() => assertHarnessRuntime(root, RC7_PIN));
});

test('assertHarnessRuntime rejects a host missing the Koffi ESM runtime entry', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-koffi-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  writeMcpSdk(root);
  writeAjv(path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv'), '8.17.1');
  fs.rmSync(path.join(root, 'node_modules', 'koffi', 'src', 'koffi', 'index.js'));

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /koffi.*src.*koffi.*index\.js/i,
  );
});

test('assertHarnessRuntime rejects a runtime missing a registered desktop fork package', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-fork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeDesktopForkPackages(root);
  // A stale deploy dir from before the desktop-owned market shipped: the
  // package is absent while every older gate file still exists.
  fs.rmSync(
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-market'),
    { recursive: true, force: true },
  );
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeGhosttyTerminalPackage(root);

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-client-ui-settings-market/,
  );
});

test('assertHarnessRuntime rejects a fork package whose runtime entry is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-fork-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDesktopForkPackages(root);
  fs.rmSync(
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-market', 'lib', 'index.js'),
    { force: true },
  );
  const { assertDesktopForkRuntime } = require('../../scripts/after-pack');
  assert.throws(
    () => assertDesktopForkRuntime(root),
    /dsh-client-ui-settings-market\/lib\/index\.js/,
  );
});

test('assertHarnessRuntime rejects a host missing Ghostty terminal assets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ghostty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  const terminalClient = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal', 'lib', 'client.js');
  fs.mkdirSync(path.dirname(terminalClient), { recursive: true });
  fs.writeFileSync(terminalClient, 'export {}\n');
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /ghostty-vt\.wasm/,
  );
});

test('assertHarnessRuntime rejects a host missing MCP settings runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  fs.rmSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-mcp-servers-file'), { recursive: true, force: true });

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-mcp-servers-file/,
  );
});

test('assertHarnessRuntime rejects stale deploy output before archiving', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-stale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>\n');

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-app-boot.*index\.js/,
  );
});

test('assertHarnessRuntime rejects pin.npm mismatch', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, '0.1.0-rc.5');
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  assert.throws(
    () => assertHarnessRuntime(root, { npm: '0.1.0-rc.7' }),
    /0\.1\.0-rc\.7/,
  );
});

test('assertHarnessRuntime rejects a missing node-pty prebuild', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-pty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /node-pty/,
  );
});

test('resolveResourcesDir uses Contents/Resources inside the macOS .app', () => {
  const darwin = resolveResourcesDir({
    electronPlatformName: 'darwin',
    appOutDir: path.join('dist', 'mac-arm64'),
    packager: { appInfo: { productFilename: 'Deepseek-Harness-Desktop' } },
  });
  assert.equal(
    darwin,
    path.join('dist', 'mac-arm64', 'Deepseek-Harness-Desktop.app', 'Contents', 'Resources'),
  );
});

test('resolveResourcesDir prefers electron-builder getResourcesDir', () => {
  const expected = path.join('out', 'Resources');
  assert.equal(
    resolveResourcesDir({
      electronPlatformName: 'darwin',
      appOutDir: path.join('dist', 'mac'),
      packager: {
        getResourcesDir: (appOutDir) => {
          assert.equal(appOutDir, path.join('dist', 'mac'));
          return expected;
        },
      },
    }),
    expected,
  );
});

test('resolveResourcesDir uses the unpacked resources folder on Windows', () => {
  assert.equal(
    resolveResourcesDir({
      electronPlatformName: 'win32',
      appOutDir: path.join('dist', 'win-unpacked'),
    }),
    path.join('dist', 'win-unpacked', 'resources'),
  );
});

test('restoreVendoredPluginNodeModules copies dropped plugin node_modules', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-nm-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const projectDir = path.join(workspace, 'project');
  const resources = path.join(workspace, 'resources');
  const srcNm = path.join(projectDir, 'vendor', 'dshmarket', 'node_modules', 'undici');
  const destPkg = path.join(resources, 'vendor', 'dshmarket');
  fs.mkdirSync(srcNm, { recursive: true });
  fs.mkdirSync(destPkg, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'vendor', 'dshmarket', 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );
  fs.writeFileSync(path.join(srcNm, 'package.json'), '{"name":"undici"}\n');
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );

  const result = restoreVendoredPluginNodeModules(projectDir, resources, 'dshmarket');
  assert.equal(result.restored, true);
  assertVendoredPluginRuntimeDeps(resources, 'dshmarket');
  assert.equal(
    fs.existsSync(path.join(destPkg, 'node_modules', 'undici', 'package.json')),
    true,
  );
});

test('assertVendoredPluginRuntimeDeps rejects a packaged plugin without its dependencies', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-missing-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  fs.mkdirSync(destPkg, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );
  assert.throws(
    () => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'),
    /undici/,
  );
});

test('assertVendoredPluginRuntimeDeps rejects a dependency whose export file is missing', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-export-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs', require: './index.js' } },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'index.js'), 'module.exports = {}\n');
  assert.throws(
    () => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'),
    /js-yaml\.mjs/,
  );
});

test('installPluginRuntimeDeps runs npm install when export files are missing', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-npm-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
  })}\n`);
  let ran = '';
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: true,
    run: (dir) => {
      ran = dir;
      fs.mkdirSync(path.join(dir, 'node_modules', 'js-yaml', 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs'),
        'export default {}\n',
      );
    },
  });
  assert.equal(result.installed, true);
  assert.equal(ran, destPkg);
  assertVendoredPluginRuntimeDeps(workspace, 'dshmarket');
});

test('a verified dsh-im tree is reused instead of deleted and reinstalled', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-reuse-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(path.join(destPkg, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(yamlDir, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({
      name: 'dsh-im',
      exports: { '.': './lib/index.js' },
      dependencies: { 'js-yaml': '4.1.1' },
    })}\n`,
  );
  fs.writeFileSync(path.join(destPkg, 'lib', 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'dist', 'js-yaml.mjs'), 'export default {}\n');

  assert.deepEqual(missingPluginRuntimeClosure(destPkg), []);
  let ran = false;
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: false,
    verify: missingPluginRuntimeClosure,
    run: () => {
      ran = true;
    },
  });
  assert.equal(result.installed, false);
  assert.equal(result.reason, 'verified-complete');
  assert.equal(ran, false);
  // The healthy tree is still on disk after the check.
  assert.equal(fs.existsSync(path.join(destPkg, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs')), true);
});

test('a deep missing dependency still forces the repair install', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-repair-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  const nestedDir = path.join(yamlDir, 'node_modules', 'argparse');
  fs.mkdirSync(path.join(destPkg, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(yamlDir, 'dist'), { recursive: true });
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({
      name: 'dsh-im',
      exports: { '.': './lib/index.js' },
      dependencies: { 'js-yaml': '4.1.1' },
    })}\n`,
  );
  fs.writeFileSync(path.join(destPkg, 'lib', 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
    dependencies: { argparse: '2.0.1' },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'dist', 'js-yaml.mjs'), 'export default {}\n');
  // argparse exists as a directory but its declared entry file was dropped:
  // the shallow predicate sees a package.json and would wrongly call this whole.
  fs.writeFileSync(
    path.join(nestedDir, 'package.json'),
    `${JSON.stringify({ name: 'argparse', main: './index.js' })}\n`,
  );

  const missing = missingPluginRuntimeClosure(destPkg);
  assert.equal(missing.some(entry => entry.includes('argparse')), true, JSON.stringify(missing));
  let ran = false;
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: false,
    verify: missingPluginRuntimeClosure,
    run: () => {
      ran = true;
      // A real install would restore the dropped entry file.
      fs.writeFileSync(path.join(nestedDir, 'index.js'), 'module.exports = {}\n');
    },
  });
  assert.equal(result.installed, true);
  assert.equal(ran, true);
});

test('installPluginRuntimeDeps fails closed when the install does not repair the tree', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-nofix-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(path.join(destPkg, 'lib'), { recursive: true });
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({
      name: 'dsh-im',
      exports: { '.': './lib/index.js' },
      dependencies: { 'js-yaml': '4.1.1' },
    })}\n`,
  );
  fs.writeFileSync(path.join(destPkg, 'lib', 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    main: './index.js',
  })}\n`);

  assert.throws(
    () => installPluginRuntimeDeps(destPkg, {
      skipIfComplete: false,
      verify: missingPluginRuntimeClosure,
      // npm can exit 0 while still leaving the entry file absent.
      run: () => {},
    }),
    /still incomplete after install/,
  );
});

test('assertVendoredPluginRuntimeDeps accepts a hoisted nested dependency', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-hoist-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  const argparseDir = path.join(destPkg, 'node_modules', 'argparse');
  fs.mkdirSync(path.join(yamlDir, 'dist'), { recursive: true });
  fs.mkdirSync(argparseDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
    dependencies: { argparse: '2.0.1' },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'dist', 'js-yaml.mjs'), 'export default {}\n');
  fs.writeFileSync(
    path.join(argparseDir, 'package.json'),
    `${JSON.stringify({ name: 'argparse', main: './index.js' })}\n`,
  );
  fs.writeFileSync(path.join(argparseDir, 'index.js'), 'module.exports = {}\n');
  assert.doesNotThrow(() => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'));
});

/** Build a linear chain of packages named depth-0 → depth-N inside `rootDir`. */
function writeDependencyChain(rootDir, depthCount, { breakAt } = {}) {
  const writePackage = (dir, name, dependency) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
      name,
      main: './index.js',
      ...(dependency ? { dependencies: { [dependency]: '1.0.0' } } : {}),
    })}\n`);
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {}\n');
  };
  let current = rootDir;
  for (let level = 0; level <= depthCount; level += 1) {
    const name = `depth-${level}`;
    const isBroken = breakAt === level;
    writePackage(current, name, level === depthCount ? null : `depth-${level + 1}`);
    if (isBroken) {
      // The package exists and resolves, but its declared entry never shipped:
      // exactly the hole a fixed-depth walk can miss.
      fs.rmSync(path.join(current, 'index.js'));
    }
    if (level === depthCount) break;
    current = path.join(current, 'node_modules', `depth-${level + 1}`);
  }
}

test('the closure audit finds a missing entry deeper than the old fixed depth', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-deep-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  // Broken at level 6, well past the previous DEFAULT_CLOSURE_DEPTH = 3.
  writeDependencyChain(destPkg, 6, { breakAt: 6 });
  const missing = missingPluginRuntimeClosure(destPkg);
  assert.equal(
    missing.some(entry => entry.includes('depth-6/index.js')),
    true,
    JSON.stringify(missing),
  );
});

test('a dependency cycle terminates and still checks every package once', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-cycle-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  const alpha = path.join(destPkg, 'node_modules', 'alpha');
  const beta = path.join(alpha, 'node_modules', 'beta');
  fs.mkdirSync(beta, { recursive: true });
  fs.writeFileSync(path.join(destPkg, 'package.json'), `${JSON.stringify({
    name: 'dsh-im',
    main: './index.js',
    dependencies: { alpha: '1.0.0' },
  })}\n`);
  fs.writeFileSync(path.join(destPkg, 'index.js'), 'module.exports = {}\n');
  // alpha → beta → alpha: a real resolvable cycle (alpha is hoisted to the
  // root, so beta's `require('alpha')` climbs back to the same directory).
  fs.writeFileSync(path.join(alpha, 'package.json'), `${JSON.stringify({
    name: 'alpha',
    main: './index.js',
    dependencies: { beta: '1.0.0' },
  })}\n`);
  fs.writeFileSync(path.join(alpha, 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(beta, 'package.json'), `${JSON.stringify({
    name: 'beta',
    main: './index.js',
    dependencies: { alpha: '1.0.0' },
  })}\n`);
  fs.writeFileSync(path.join(beta, 'index.js'), 'module.exports = {}\n');

  const missing = missingPluginRuntimeClosure(destPkg);
  assert.deepEqual(missing, [], JSON.stringify(missing));
});

test('a symlink loop does not hang or duplicate entries', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-linkloop-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  const loop = path.join(destPkg, 'node_modules', 'loop');
  fs.mkdirSync(loop, { recursive: true });
  fs.writeFileSync(path.join(destPkg, 'package.json'), `${JSON.stringify({
    name: 'dsh-im',
    main: './index.js',
    dependencies: { loop: '1.0.0' },
  })}\n`);
  fs.writeFileSync(path.join(destPkg, 'index.js'), 'module.exports = {}\n');
  fs.writeFileSync(path.join(loop, 'package.json'), `${JSON.stringify({
    name: 'loop',
    main: './index.js',
    dependencies: { loop: '1.0.0' },
  })}\n`);
  fs.writeFileSync(path.join(loop, 'index.js'), 'module.exports = {}\n');
  try {
    // The package resolves itself first at its own node_modules, then falls
    // back through the ancestor chain; both land on the same canonical dir.
    fs.mkdirSync(path.join(loop, 'node_modules'), { recursive: true });
    fs.symlinkSync(loop, path.join(loop, 'node_modules', 'loop'), 'junction');
  } catch {
    // Symlink creation needs privileges on Windows; fall back to the hoisted
    // self-reference, which exercises the same canonical-dedupe path.
    fs.mkdirSync(path.join(loop, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(loop, 'node_modules', 'loop.json'),
      '{}\n',
    );
  }

  const missing = missingPluginRuntimeClosure(destPkg);
  assert.equal(missing.filter(entry => entry.includes('loop')).length, 0, JSON.stringify(missing));
});

test('the closure audit reports incomplete instead of healthy when the budget runs out', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-budget-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dsh-im');
  writeDependencyChain(destPkg, 5);
  const missing = missingPluginRuntimeClosure(destPkg, { maxPackages: 2 });
  assert.ok(
    missing.includes('<closure-incomplete>'),
    `budget exhaustion must stay fail-closed: ${JSON.stringify(missing)}`,
  );
});

test('installPluginRuntimeDeps skipIfComplete does not run npm when export files exist', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-skip-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml', 'dist');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(
    path.join(destPkg, 'node_modules', 'js-yaml', 'package.json'),
    `${JSON.stringify({
      name: 'js-yaml',
      exports: { '.': { import: './dist/js-yaml.mjs' } },
    })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'js-yaml.mjs'), 'export default {}\n');
  let ran = false;
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: true,
    run: () => {
      ran = true;
    },
  });
  assert.equal(result.installed, false);
  assert.equal(ran, false);
});

test('collectPnpmFlattenFiles nests ajv@8 under MCP SDK when top-level is ajv@6', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv-flatten-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const nmDest = path.join(workspace, 'dest', 'node_modules');
  const storeDir = path.join(workspace, 'src', 'node_modules', '.pnpm');
  const sdkEntry = path.join(storeDir, '@modelcontextprotocol+sdk@1.29.0', 'node_modules');
  const sdkDir = path.join(sdkEntry, '@modelcontextprotocol', 'sdk');
  const siblingAjv = path.join(sdkEntry, 'ajv');
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(path.join(sdkDir, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
  fs.writeFileSync(path.join(sdkDir, 'index.js'), 'module.exports = {}\n');
  writeAjv(siblingAjv, '8.17.1');
  fs.writeFileSync(path.join(siblingAjv, 'index.js'), 'module.exports = 8\n');
  writeAjv(path.join(nmDest, 'ajv'), '6.15.0');
  fs.writeFileSync(path.join(nmDest, 'ajv', 'index.js'), 'module.exports = 6\n');

  const files = collectPnpmFlattenFiles(storeDir, nmDest);
  for (const item of files) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    fs.copyFileSync(item.src, item.dest);
  }

  const nested = JSON.parse(fs.readFileSync(path.join(
    nmDest, '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv', 'package.json',
  ), 'utf8'));
  const top = JSON.parse(fs.readFileSync(path.join(nmDest, 'ajv', 'package.json'), 'utf8'));
  assert.equal(nested.version, '8.17.1');
  assert.equal(top.version, '6.15.0');
});

test('repairFlattenedVersionIsolation restores SDK ajv@8 after flat copy', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv-repair-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  const sdkEntry = path.join(storeDir, '@modelcontextprotocol+sdk@1.29.0', 'node_modules');
  const sdkDir = path.join(sdkEntry, '@modelcontextprotocol', 'sdk');
  const siblingAjv = path.join(sdkEntry, 'ajv');
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(path.join(sdkDir, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
  fs.writeFileSync(path.join(sdkDir, 'index.js'), 'module.exports = {}\n');
  writeAjv(siblingAjv, '8.17.1');
  fs.writeFileSync(path.join(siblingAjv, 'index.js'), 'module.exports = 8\n');

  const flatDestNm = path.join(harnessDest, 'node_modules');
  fs.mkdirSync(path.join(flatDestNm, '@modelcontextprotocol', 'sdk'), { recursive: true });
  fs.copyFileSync(path.join(sdkDir, 'package.json'), path.join(flatDestNm, '@modelcontextprotocol', 'sdk', 'package.json'));
  fs.copyFileSync(path.join(sdkDir, 'index.js'), path.join(flatDestNm, '@modelcontextprotocol', 'sdk', 'index.js'));
  writeAjv(path.join(flatDestNm, 'ajv'), '6.15.0');
  fs.writeFileSync(path.join(flatDestNm, 'ajv', 'index.js'), 'module.exports = 6\n');

  await repairFlattenedVersionIsolation(harnessSrc, harnessDest);

  const nested = JSON.parse(fs.readFileSync(path.join(
    flatDestNm, '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv', 'package.json',
  ), 'utf8'));
  assert.equal(nested.version, '8.17.1');
});

test('assertHarnessRuntime rejects MCP SDK resolving ajv major 6', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv6-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  writeMcpSdk(root);
  writeAjv(path.join(root, 'node_modules', 'ajv'), '6.15.0');

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /拍平丢掉了 SDK 嵌套 ajv@8/,
  );
});

function writeCommanderCjs(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'commander',
    version,
    main: 'index.js',
  })}\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { Command: class Command {} };\n');
}

function writeCommanderEsm(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'commander',
    version,
    type: 'module',
    exports: { '.': { import: './index.js', require: './index.js' } },
  })}\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), 'export class Command {}\n');
}

test('repairFlattenedCommanderEsm replaces CJS top-level commander with store ESM', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  writeCommanderCjs(path.join(storeDir, 'commander@2.20.3', 'node_modules', 'commander'), '2.20.3');
  writeCommanderEsm(path.join(storeDir, 'commander@15.0.1', 'node_modules', 'commander'), '15.0.1');
  writeCommanderCjs(path.join(harnessDest, 'node_modules', 'commander'), '2.20.3');

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.ok(copied > 0);
  const dest = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(dest.version, '15.0.1');
  assert.equal(dest.type, 'module');
});

test('repairFlattenedCommanderEsm leaves an already-ESM commander in place', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-ok-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  writeCommanderEsm(path.join(harnessSrc, 'node_modules', '.pnpm', 'commander@14.0.0', 'node_modules', 'commander'), '14.0.0');
  writeCommanderEsm(path.join(harnessDest, 'node_modules', 'commander'), '15.0.1');
  fs.writeFileSync(path.join(harnessDest, 'node_modules', 'commander', 'marker.txt'), 'keep\n');

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.equal(copied, 0);
  const dest = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(dest.version, '15.0.1');
  assert.equal(
    fs.readFileSync(path.join(harnessDest, 'node_modules', 'commander', 'marker.txt'), 'utf8'),
    'keep\n',
  );
});

function writeCliManifest(dir, commanderRange) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/dsh-cli',
    version: '0.1.6',
    dependencies: commanderRange ? { commander: commanderRange } : {},
  })}\n`);
}

test('repairFlattenedCommanderEsm nests declared-range commander under apps/cli', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-range-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  writeCliManifest(path.join(harnessSrc, 'apps', 'cli'), '^15.0.0');
  writeCommanderEsm(path.join(storeDir, 'commander@9.5.0', 'node_modules', 'commander'), '9.5.0');
  writeCommanderEsm(path.join(storeDir, 'commander@15.0.0', 'node_modules', 'commander'), '15.0.0');
  writeCommanderEsm(path.join(harnessDest, 'node_modules', 'commander'), '9.5.0');
  fs.mkdirSync(path.join(harnessDest, 'apps', 'cli'), { recursive: true });

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.ok(copied > 0);
  const nested = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'apps', 'cli', 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(nested.version, '15.0.0');
  const top = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(top.version, '9.5.0');
});

test('repairFlattenedCommanderEsm skips nesting when top-level satisfies the CLI range', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-satisfied-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  writeCliManifest(path.join(harnessSrc, 'apps', 'cli'), '^15.0.0');
  writeCommanderEsm(path.join(harnessSrc, 'node_modules', '.pnpm', 'commander@15.0.0', 'node_modules', 'commander'), '15.0.0');
  writeCommanderEsm(path.join(harnessDest, 'node_modules', 'commander'), '15.0.1');
  fs.mkdirSync(path.join(harnessDest, 'apps', 'cli'), { recursive: true });

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.equal(copied, 0);
  assert.ok(!fs.existsSync(path.join(harnessDest, 'apps', 'cli', 'node_modules', 'commander')));
});

test('repairFlattenedCommanderEsm throws when the store lacks the declared range', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-missing-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  writeCliManifest(path.join(harnessSrc, 'apps', 'cli'), '^15.0.0');
  writeCommanderEsm(path.join(harnessSrc, 'node_modules', '.pnpm', 'commander@9.5.0', 'node_modules', 'commander'), '9.5.0');
  writeCommanderEsm(path.join(harnessDest, 'node_modules', 'commander'), '9.5.0');
  fs.mkdirSync(path.join(harnessDest, 'apps', 'cli'), { recursive: true });

  await assert.rejects(
    () => repairFlattenedCommanderEsm(harnessSrc, harnessDest),
    /commander 不满足 apps\/cli 声明/,
  );
});

test('copyFiles deduplicates duplicate destinations preferring hoisted sources', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-dedupe-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const storeDir = path.join(workspace, 'src', 'node_modules', '.pnpm', 'pkg@2.0.0', 'node_modules', 'pkg');
  const hoistedDir = path.join(workspace, 'src', 'apps', 'cli', 'node_modules', 'pkg');
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(hoistedDir, { recursive: true });
  const storeFile = path.join(storeDir, 'package.json');
  const hoistedFile = path.join(hoistedDir, 'package.json');
  fs.writeFileSync(storeFile, `{"name":"pkg","version":"2.0.0"}${' '.repeat(64)}\n`);
  fs.writeFileSync(hoistedFile, '{"name":"pkg","version":"1.0.0"}\n');
  const dest = path.join(workspace, 'out', 'node_modules', 'pkg', 'package.json');

  // .pnpm store 条目在前：竞态下它曾是最后落笔者，会把 hoisted 内容截成尾部碎片
  const copied = await copyFiles([
    { src: storeFile, dest },
    { src: hoistedFile, dest },
  ]);
  assert.equal(copied, 1);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"name":"pkg","version":"1.0.0"}\n');
});

test('copyFiles keeps first hoisted source when duplicate destinations have no store path', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-dedupe-first-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const aDir = path.join(workspace, 'a');
  const bDir = path.join(workspace, 'b');
  fs.mkdirSync(aDir, { recursive: true });
  fs.mkdirSync(bDir, { recursive: true });
  const aFile = path.join(aDir, 'package.json');
  const bFile = path.join(bDir, 'package.json');
  fs.writeFileSync(aFile, '{"name":"pkg","version":"1.0.0"}\n');
  fs.writeFileSync(bFile, `{"name":"pkg","version":"2.0.0"}${' '.repeat(64)}\n`);
  const dest = path.join(workspace, 'out', 'node_modules', 'pkg', 'package.json');

  const copied = await copyFiles([
    { src: aFile, dest },
    { src: bFile, dest },
  ]);
  assert.equal(copied, 1);
  assert.equal(fs.readFileSync(dest, 'utf8'), '{"name":"pkg","version":"1.0.0"}\n');
});

test('assertNodeModulesManifests rejects manifests with trailing corruption', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-manifests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkgDir = path.join(root, 'node_modules', 'broken');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"ok","version":"1.0.0"}\n{"name":"pk');

  assert.throws(() => assertNodeModulesManifests(root), /损坏的 package\.json/);
});

test('assertNodeModulesManifests accepts a clean node_modules tree', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-manifests-ok-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkgDir = path.join(root, 'node_modules', 'pkg');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"pkg","version":"1.0.0"}\n');

  assertNodeModulesManifests(root);
});

test('nodeBinaryHasExternalDylibs flags shim binaries but not standalone builds', () => {
  const shim = [
    '/opt/homebrew/opt/node/bin/node:',
    '\t/opt/homebrew/opt/node/lib/libnode.137.dylib',
    '\t/opt/homebrew/opt/icu4c/lib/libicui18n.78.dylib',
    '\t/usr/lib/libSystem.B.dylib',
  ].join('\n');
  const standalone = [
    'node:',
    '\t/usr/lib/libSystem.B.dylib',
    '\t/usr/lib/libc++.1.dylib',
  ].join('\n');
  assert.equal(nodeBinaryHasExternalDylibs(shim), true);
  assert.equal(nodeBinaryHasExternalDylibs(standalone), false);
});
