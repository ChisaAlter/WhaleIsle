'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PACKAGED_P0_STEPS, runPackagedP0, verifyPackagedRuntime } = require('./packaged-p0');

function step(result, name) {
  return result.steps.find((row) => row.name === name);
}

function passingDeps(overrides = {}) {
  const siblingPath = overrides.siblingPath || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-sib-'));
  const userData = overrides.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-ud-'));
  const appVersion = overrides.appVersion || '0.2.7';
  const stampPath = path.join(userData, 'runtime', appVersion, '.dshd-runtime.json');
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  if (overrides.stampExists !== false) {
    fs.writeFileSync(stampPath, '{"sha":"x","npm":"0.1.1-rc.1","archiveBytes":1}\n');
  }
  return {
    siblingPath,
    gitBranchList: async (cwd) => {
      assert.equal(cwd, siblingPath);
      return {
        ok: true,
        branches: [
          { name: 'master', isCurrent: true },
          { name: '111', isCurrent: false },
        ],
      };
    },
    pty: {
      create: async (input) => {
        assert.equal(input.cwd, siblingPath);
        return { id: 'pty-sib' };
      },
      kill: async () => {},
    },
    fetch: async (url) => {
      assert.match(String(url), /\/plugins\/@deepseek-ai\/dsh-client-ui-user-terminal\/assets\/ghostty-vt\.wasm$/);
      return { status: 200 };
    },
    host: '127.0.0.1',
    port: 3080,
    userData,
    appVersion,
    bootLogs: ['[dsh] Web UI 就绪'],
    ...overrides,
    siblingPath,
    userData,
    appVersion,
  };
}

test('packaged P0 steps cover sibling git, PTY, wasm, no-open, and stamp', () => {
  assert.deepEqual(PACKAGED_P0_STEPS, [
    'packaged.sibling.exists',
    'packaged.git.branchList',
    'packaged.pty.create',
    'packaged.ghostty.wasm',
    'packaged.boot.noOpen',
    'packaged.runtime.stamp',
  ]);
});

test('runPackagedP0 passes sibling git, PTY, wasm 200, no --no-open, and stamp', async () => {
  const deps = passingDeps();
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, true);
    for (const name of PACKAGED_P0_STEPS) {
      const row = step(result, name);
      assert.ok(row, name);
      assert.equal(row.ok, true, `${name}: ${row.detail}`);
    }
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('unregistered sibling fails git or pty and overall ok is false', async () => {
  const siblingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-unreg-'));
  const deps = passingDeps({
    siblingPath,
    gitBranchList: async () => ({ ok: false, message: 'Git status is unavailable.' }),
    pty: {
      create: async () => {
        throw new Error('ptyCreate requires a project cwd');
      },
      kill: async () => {},
    },
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.sibling.exists').ok, true);
    assert.equal(step(result, 'packaged.git.branchList').ok, false);
    assert.equal(step(result, 'packaged.pty.create').ok, false);
    assert.match(step(result, 'packaged.pty.create').detail, /ptyCreate requires a project cwd/);
  } finally {
    fs.rmSync(siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('gitBranchList without a current branch fails closed', async () => {
  const deps = passingDeps({
    gitBranchList: async () => ({ ok: true, branches: [{ name: 'master', isCurrent: false }] }),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.git.branchList').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('missing sibling fails closed', async () => {
  const deps = passingDeps({
    siblingPath: path.join(os.tmpdir(), `dsh-p0-missing-${Date.now()}`),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.sibling.exists').ok, false);
  } finally {
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('ghostty wasm not 200 fails closed', async () => {
  const deps = passingDeps({
    fetch: async () => ({ status: 404 }),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.ghostty.wasm').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('boot logs with unknown option --no-open fail closed', async () => {
  const deps = passingDeps({
    bootLogs: ["error: unknown option '--no-open'"],
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.boot.noOpen').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('missing packaged runtime stamp after start fails closed', async () => {
  const deps = passingDeps({ stampExists: false });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.runtime.stamp').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('packaged P0 is wired into smoke when DSH_SMOKE_SIBLING is set', () => {
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /runPackagedP0/);
  assert.match(smoke, /DSH_SMOKE_SIBLING/);
  assert.match(smoke, /packagedP0/);
  assert.doesNotMatch(smoke, /DSH_QA === '1' \|\| process\.env\.DSH_SMOKE_SIBLING/);
});

test('qa:packaged is a local rehearsal script and not a GitHub Release job', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['qa:packaged'], 'node scripts/run-packaged-p0.mjs');
  // smoke:packaged IS the windows release acceptance gate (ci-isolation
  // pins its placement); the sibling-repo P0 drill stays a local rehearsal.
  const release = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.doesNotMatch(release, /\bqa:packaged\b/);
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'run-packaged-p0.mjs'), 'utf8');
  assert.match(runner, /DSH_SMOKE_SIBLING/);
  assert.match(runner, /0\.1\.0-rc\.7/);
  assert.match(runner, /\.dshd-runtime\.json/);
  assert.match(runner, /ws-p0/);
  assert.match(runner, /sessionIds/);
  assert.match(runner, /createdAt/);
  assert.match(runner, /Quit Whale Isle\.exe first/);
  assert.match(runner, /npm run dist/);
  assert.match(runner, /Node version in root \.nvmrc/);
  const sourceQa = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'run-source-qa.mjs'), 'utf8');
  assert.doesNotMatch(sourceQa, /DSH_SMOKE_SIBLING/);
});

function runtimeFixture(t, mode = 'installed') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resourcesPath = path.join(root, 'resources'), userData = path.join(root, 'profile');
  const vendor = path.join(resourcesPath, 'vendor');
  const runtimeRoot = mode === 'installed' ? path.join(vendor, 'deepseek-harness') : path.join(userData, 'runtime', '0.3.5');
  const expectedPin = { sha: 'a'.repeat(40), npm: '0.2.1-alpha.1' };
  const expectedArchiveIdentity = { version: 1, archiveBytes: 10, archiveSha256: 'b'.repeat(64) };
  const write = (base, relative, value) => {
    const file = path.join(base, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write(vendor, 'harness-upstream.json', expectedPin);
  write(vendor, 'deepseek-harness-runtime.json', expectedArchiveIdentity);
  write(runtimeRoot, 'package.json', { version: expectedPin.npm });
  for (const entry of ['apps/cli/lib/bin.js', 'apps/web/dist/index.html', 'packages/client/ui-user-terminal/lib/client.js',
    ...require('../shared/ghostty-assets').GHOSTTY_ASSET_FILES.map(name => `packages/client/ui-user-terminal/lib/assets/${name}`)]) write(runtimeRoot, entry, 'fixture');
  write(runtimeRoot, '.dsh-runtime-links.json', { version: 1, links: [] });
  if (mode === 'extracted') {
    write(vendor, 'deepseek-harness.tar', '0123456789');
    write(runtimeRoot, '.dshd-runtime.json', { ...expectedPin, archiveBytes: 10, archiveSha256: expectedArchiveIdentity.archiveSha256 });
  }
  return { resourcesPath, runtimeRoot, userData, appVersion: '0.3.5', expectedPin, expectedArchiveIdentity, write, vendor };
}

test('NSIS runtime identity accepts the selected installed tree while leaving a stale userData overlay unselected', async t => {
  const deps = runtimeFixture(t);
  const stale = path.join(deps.userData, 'runtime', deps.appVersion);
  deps.write(stale, 'package.json', { version: '0.1.0-rc.7' });
  const runtime = await verifyPackagedRuntime(deps);
  assert.equal(runtime.mode, 'installed');
  assert.equal(fs.existsSync(path.join(deps.runtimeRoot, '.dshd-runtime.json')), false);
  const p0Deps = passingDeps({ ...deps, stampExists: false });
  t.after(() => fs.rmSync(p0Deps.siblingPath, { recursive: true, force: true }));
  const result = await runPackagedP0(p0Deps);
  assert.equal(result.ok, true);
  assert.equal(result.runtime.mode, 'installed');
  await assert.rejects(verifyPackagedRuntime({ ...deps, runtimeRoot: stale }), /root mismatch/);
});

test('selected runtime rejects wrong pin, package version and equal-size archive identity changes', async t => {
  const deps = runtimeFixture(t);
  await assert.rejects(verifyPackagedRuntime({ ...deps, expectedPin: { ...deps.expectedPin, sha: 'c'.repeat(40) } }), /pin mismatch/);
  await assert.rejects(verifyPackagedRuntime({ ...deps, expectedArchiveIdentity: { ...deps.expectedArchiveIdentity, archiveSha256: 'c'.repeat(64) } }), /archive identity mismatch/);
  deps.write(deps.runtimeRoot, 'package.json', { version: '0.1.0-rc.7' });
  await assert.rejects(verifyPackagedRuntime(deps), /package version mismatch/);
});

test('selected installed runtime rejects incomplete or invalid dependency link trees', async t => {
  const deps = runtimeFixture(t);
  deps.write(deps.runtimeRoot, '.dsh-runtime-links.json', { version: 1, links: [{ path: 'node_modules/a', target: '../outside' }] });
  await assert.rejects(verifyPackagedRuntime(deps), /Invalid runtime link path/);
  deps.write(deps.runtimeRoot, '.dsh-runtime-links.json', { version: 1, links: [] });
  fs.unlinkSync(path.join(deps.runtimeRoot, 'apps/cli/lib/bin.js'));
  await assert.rejects(verifyPackagedRuntime(deps), /ENOENT/);
});

test('tar-extracted runtime still requires an exact completed stamp and rejects a stale same-version overlay', async t => {
  const deps = runtimeFixture(t, 'extracted');
  assert.equal((await verifyPackagedRuntime(deps)).mode, 'extracted');
  deps.write(deps.runtimeRoot, '.dshd-runtime.json', { ...deps.expectedPin, archiveBytes: 10, archiveSha256: 'c'.repeat(64) });
  await assert.rejects(verifyPackagedRuntime(deps), /stamp mismatch: archiveSha256/);
  fs.unlinkSync(path.join(deps.runtimeRoot, '.dshd-runtime.json'));
  await assert.rejects(verifyPackagedRuntime(deps), /ENOENT/);
});
