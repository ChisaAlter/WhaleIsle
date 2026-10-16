'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  OFFICE_OVERLAY_FILENAME,
  OFFICE_SKILL_FOLDERS,
  requiredEnginePackage,
  officeRuntimeCandidates,
  officeRuntimeEnv,
  readRuntimeManifest,
  ensureDesktopOfficeRuntime,
} = require('./office-runtime');

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-office-test-'));
}

function writePayload(root) {
  const source = path.join(root, 'payload', 'primary-runtime');
  fs.mkdirSync(path.join(source, 'dependencies', 'node', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(source, 'runtime.json'), `${JSON.stringify({
    desktopVersion: '0.0.0-test',
    platform: process.platform,
    arch: process.arch,
    payloadDigest: 'sha256-test',
    python: '3.12.14',
    node: '24.21.0',
    pnpm: '11.0.9',
    pythonPackages: {},
  })}\n`, 'utf8');
  fs.writeFileSync(
    path.join(source, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    'stub\n',
    'utf8',
  );
  const assetRoot = path.join(path.dirname(source), 'office-skills');
  for (const folder of OFFICE_SKILL_FOLDERS) {
    fs.mkdirSync(path.join(assetRoot, folder), { recursive: true });
    fs.writeFileSync(path.join(assetRoot, folder, 'SKILL.md'), '---\ndescription: stub\n---\n', 'utf8');
  }
  return source;
}

/** A harness root with the kit + required native engine stubbed in node_modules. */
function writeHarnessFixture(root, { engineVersion = '0.1.1', kitVersion = '0.1.1' } = {}) {
  const harnessRoot = path.join(root, 'harness');
  fs.mkdirSync(path.join(harnessRoot, 'apps', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(harnessRoot, 'apps', 'cli', 'package.json'), '{"name":"cli"}\n', 'utf8');
  const kitDir = path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'libreoffice-kit');
  fs.mkdirSync(path.join(kitDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(kitDir, 'package.json'), `${JSON.stringify({
    name: '@deepseek-ai/libreoffice-kit', version: kitVersion,
  })}\n`, 'utf8');
  fs.writeFileSync(path.join(kitDir, 'lib', 'cli.js'), '// stub\n', 'utf8');
  // Also stand in for skill-office so the CLI anchor resolves the plugin name.
  const skillDir = path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'dsh-skill-office');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'package.json'), '{"name":"@deepseek-ai/dsh-skill-office","version":"0.0.0"}\n', 'utf8');
  const engineName = requiredEnginePackage();
  if (engineName) {
    const engineDir = path.join(harnessRoot, 'node_modules', ...engineName.split('/'));
    fs.mkdirSync(path.join(engineDir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(engineDir, 'package.json'), `${JSON.stringify({
      name: engineName, version: engineVersion,
    })}\n`, 'utf8');
    fs.writeFileSync(path.join(engineDir, 'prebuilds.json'), `${JSON.stringify({
      version: engineVersion,
      schemaVersion: 1,
      status: 'built',
      platform: `${process.platform}-${process.arch}`,
      engine: { kind: 'native' },
    })}\n`, 'utf8');
    fs.writeFileSync(
      path.join(engineDir, 'bin', process.platform === 'win32' ? 'libreoffice-kit.exe' : 'libreoffice-kit'),
      'stub\n',
      'utf8',
    );
  }
  return harnessRoot;
}

function options(home, extra = {}) {
  const profileDir = path.join(home, 'profiles', 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  return {
    profileDir,
    harnessRoot: extra.harnessRoot !== undefined ? extra.harnessRoot : writeHarnessFixture(home),
    dshHome: home,
    isPackaged: false,
    env: {},
    ...extra,
  };
}

test('Office asset requirements match the current bundled provider', () => {
  const assets = path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'packages', 'skill', 'skill-office', 'assets');
  const bundled = fs.readdirSync(assets, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(assets, entry.name, 'SKILL.md')))
    .map((entry) => entry.name);
  assert.deepEqual([...OFFICE_SKILL_FOLDERS].sort(), bundled.sort());
});

test('writes the office overlay with absolute source/root/assetRoot/node/cli', () => {
  const home = tempHome();
  const source = writePayload(home);
  const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source }));
  assert.equal(result.ok, true);
  assert.equal(result.present, true);
  assert.equal(path.basename(result.overlayFile), OFFICE_OVERLAY_FILENAME);
  const overlay = fs.readFileSync(result.overlayFile, 'utf8');
  assert.match(overlay, /id: workspace-dependencies/);
  assert.match(overlay, /id: skill-office/);
  assert.match(overlay, /name: "@deepseek-ai\/dsh-tool-workspace-dependencies"/);
  assert.match(overlay, /name: "@deepseek-ai\/dsh-skill-office"/);
  for (const key of ['source', 'root', 'assetRoot', 'node', 'cli']) {
    assert.match(overlay, new RegExp(`${key}: `), `missing ${key}`);
  }
  assert.equal(result.source, source);
  assert.equal(result.root, path.join(home, 'dsh-runtimes', 'dsh-primary-runtime'));
  assert.equal(result.assetRoot, path.join(path.dirname(source), 'office-skills'));
  assert.equal(path.basename(result.cli), 'cli.js');
  assert.equal(result.payloadDigest, 'sha256-test');
});

test('every bundled Office skill is required before writing the overlay', (t) => {
  const home = tempHome();
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = writePayload(home);
  const config = options(home, { bundledRuntimeDir: source });
  for (const folder of OFFICE_SKILL_FOLDERS) {
    const skill = path.join(path.dirname(source), 'office-skills', folder, 'SKILL.md');
    const contents = fs.readFileSync(skill);
    fs.unlinkSync(skill);
    const result = ensureDesktopOfficeRuntime(config);
    assert.equal(result.ok, false, folder);
    assert.ok(result.error.includes(skill), result.error);
    fs.writeFileSync(skill, contents);
  }
});

test('dev without a payload only warns and leaves no overlay', () => {
  const home = tempHome();
  const result = ensureDesktopOfficeRuntime(options(home, {
    bundledRuntimeDir: path.join(home, 'absent-payload'),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.present, false);
  assert.match(result.warning, /prepare:office-runtime/);
  const overlayFile = path.join(home, 'profiles', 'web', 'desktop-plugins', 'office', OFFICE_OVERLAY_FILENAME);
  assert.equal(fs.existsSync(overlayFile), false);
});

test('Windows packaged without a payload fails as runtime damage', () => {
  const home = tempHome();
  const result = ensureDesktopOfficeRuntime(options(home, {
    isPackaged: true,
    platform: 'win32',
    bundledRuntimeDir: undefined,
    resourcesPath: path.join(home, 'resources'),
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Office 运行时/);
});

test('Mac packaged without the Windows-only Office payload stays bootable without an overlay', () => {
  const home = tempHome();
  const result = ensureDesktopOfficeRuntime(options(home, {
    isPackaged: true, platform: 'darwin', bundledRuntimeDir: undefined,
    resourcesPath: path.join(home, 'resources'),
  }));
  assert.equal(result.ok, true);
  assert.equal(result.present, false);
  assert.match(result.warning, /Office 技能不可用/);
  const overlayFile = path.join(home, 'profiles', 'web', 'desktop-plugins', 'office', OFFICE_OVERLAY_FILENAME);
  assert.equal(fs.existsSync(overlayFile), false);
});

test('Mac packaged still rejects an explicitly configured missing Office runtime', () => {
  const home = tempHome();
  const result = ensureDesktopOfficeRuntime(options(home, {
    isPackaged: true, platform: 'darwin', bundledRuntimeDir: undefined,
    resourcesPath: path.join(home, 'resources'),
    env: { DSH_PRIMARY_RUNTIME: path.join(home, 'explicit-missing-runtime') },
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /Office 运行时/);
});

test('empty DSH_PRIMARY_RUNTIME disables the rows and removes a stale overlay', () => {
  const home = tempHome();
  const source = writePayload(home);
  const first = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source }));
  assert.equal(fs.existsSync(first.overlayFile), true);
  const second = ensureDesktopOfficeRuntime(options(home, {
    bundledRuntimeDir: source,
    env: { DSH_PRIMARY_RUNTIME: '' },
  }));
  assert.equal(second.ok, true);
  assert.equal(second.disabled, true);
  assert.equal(fs.existsSync(first.overlayFile), false);
});

test('DSH_PRIMARY_RUNTIME overrides the bundled directory', () => {
  const home = tempHome();
  const override = writePayload(path.join(home, 'override-base'));
  const result = ensureDesktopOfficeRuntime(options(home, {
    bundledRuntimeDir: path.join(home, 'nonexistent'),
    env: { DSH_PRIMARY_RUNTIME: override },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.source, override);
});

test('platform mismatch blocks the overlay', () => {
  const home = tempHome();
  const source = writePayload(home);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'runtime.json'), 'utf8'));
  manifest.platform = process.platform === 'win32' ? 'linux' : 'win32';
  fs.writeFileSync(path.join(source, 'runtime.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source }));
  assert.equal(result.ok, false);
  assert.match(result.error, /平台不匹配/);
});

test('missing standalone node, office-skills, or kit cli fail with actionable errors', () => {
  for (const remove of ['node', 'skills', 'kit']) {
    const home = tempHome();
    const source = writePayload(home);
    const harnessRoot = writeHarnessFixture(home);
    if (remove === 'node') {
      fs.rmSync(path.join(source, 'dependencies'), { recursive: true });
    } else if (remove === 'skills') {
      fs.rmSync(path.join(path.dirname(source), 'office-skills'), { recursive: true });
    } else {
      fs.rmSync(path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib'), { recursive: true });
    }
    const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source, harnessRoot }));
    assert.equal(result.ok, false, `${remove} must fail`);
    assert.match(result.error, /Office/);
  }
});

test('win-x64-style targets fail when the declared native engine is missing', () => {
  const home = tempHome();
  const engineName = requiredEnginePackage();
  if (!engineName) {
    // Host target legitimately resolves WASM; nothing to assert.
    return;
  }
  const source = writePayload(home);
  const harnessRoot = writeHarnessFixture(home);
  fs.rmSync(path.join(harnessRoot, 'node_modules', ...engineName.split('/')), { recursive: true });
  const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source, harnessRoot }));
  assert.equal(result.ok, false);
  assert.match(result.error, /原生引擎包/);
  assert.match(result.error, new RegExp(engineName.replace(/[/]/g, '\\/')));
});

test('engine manifest drift (version/platform/status) fails validation', () => {
  const home = tempHome();
  const engineName = requiredEnginePackage();
  if (!engineName) return;
  const source = writePayload(home);
  const harnessRoot = writeHarnessFixture(home);
  const engineDir = path.join(harnessRoot, 'node_modules', ...engineName.split('/'));
  const prebuilds = JSON.parse(fs.readFileSync(path.join(engineDir, 'prebuilds.json'), 'utf8'));
  prebuilds.status = 'staged';
  fs.writeFileSync(path.join(engineDir, 'prebuilds.json'), `${JSON.stringify(prebuilds)}\n`, 'utf8');
  const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source, harnessRoot }));
  assert.equal(result.ok, false);
  assert.match(result.error, /引擎清单无效/);
});

test('pre-extract packaged harness computes the flattened cli path without existence checks', () => {
  const home = tempHome();
  const source = writePayload(home);
  const harnessRoot = path.join(home, 'harness-not-extracted');
  const result = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source, harnessRoot }));
  assert.equal(result.ok, true);
  assert.equal(
    result.cli,
    path.join(harnessRoot, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'),
  );
});

test('overlay rewrite is stable across repeated ensures', () => {
  const home = tempHome();
  const source = writePayload(home);
  const first = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source }));
  const contents = fs.readFileSync(first.overlayFile, 'utf8');
  const second = ensureDesktopOfficeRuntime(options(home, { bundledRuntimeDir: source }));
  assert.equal(fs.readFileSync(second.overlayFile, 'utf8'), contents);
});

test('officeRuntimeEnv declares the bundled payload and respects the override', () => {
  const home = tempHome();
  const source = writePayload(home);
  assert.deepEqual(
    officeRuntimeEnv({ env: {}, isPackaged: false, bundledRuntimeDir: source }),
    { DSH_BUNDLED_PRIMARY_RUNTIME: source },
  );
  // A user override (or empty-string opt-out) suppresses the carrier default.
  for (const env of [{ DSH_PRIMARY_RUNTIME: 'x' }, { DSH_PRIMARY_RUNTIME: '' }]) {
    assert.deepEqual(
      officeRuntimeEnv({ env, isPackaged: false, bundledRuntimeDir: source }),
      {},
    );
  }
  // Packaged resolves the resources/runtime payload, not the dev build dir.
  const packaged = path.join(home, 'resources', 'runtime', 'primary-runtime');
  fs.mkdirSync(packaged, { recursive: true });
  fs.writeFileSync(path.join(packaged, 'runtime.json'), '{}\n', 'utf8');
  assert.deepEqual(
    officeRuntimeEnv({
      env: {},
      isPackaged: true,
      resourcesPath: path.join(home, 'resources'),
    }),
    { DSH_BUNDLED_PRIMARY_RUNTIME: packaged },
  );
  // Missing payload declares nothing.
  assert.deepEqual(
    officeRuntimeEnv({ env: {}, isPackaged: false, bundledRuntimeDir: path.join(home, 'absent') }),
    {},
  );
});

test('officeRuntimeCandidates honors explicit env over bundled paths', () => {
  const { candidates, disabled } = officeRuntimeCandidates({ env: { DSH_PRIMARY_RUNTIME: 'relative/dir' } });
  assert.equal(disabled, false);
  assert.equal(path.isAbsolute(candidates[0]), true);
  assert.equal(officeRuntimeCandidates({ env: { DSH_PRIMARY_RUNTIME: '  ' } }).disabled, true);
});

test('readRuntimeManifest requires runtime.json and a matching payloadDigest', () => {
  const home = tempHome();
  assert.throws(() => readRuntimeManifest(home), /runtime\.json/);
  const source = writePayload(home);
  const manifest = readRuntimeManifest(source);
  assert.equal(manifest.payloadDigest, 'sha256-test');
});
