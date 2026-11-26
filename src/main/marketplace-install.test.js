const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-marketplace-install-'));
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: {
    app: {
      isPackaged: false,
      getPath() {
        return userData;
      },
    },
  },
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('network disabled in marketplace-install tests');
};

const { parseAllowBuilds } = require('./marketplace-allowbuilds');
const {
  installPlugin,
  installImportPlugin,
  parseImportRegistrySpec,
  isDroppedInstallSpec,
  uninstallPlugin,
  installMarketplacePlugin,
  updateMarketplacePlugin,
  updateMarketplacePlugins,
  isBuildApprovalFailure,
} = require('./marketplace-install');
const {
  compareVersions,
  isUpgrade,
  checkMarketplacePluginUpdate,
} = require('./marketplace-updates');
const { getMarketplaceDetails } = require('./marketplace-details');

const NPM_ID = '13071301808/dsh-composer-expand';
const GITHUB_ID = '01Virex/dsh-status-rotator';
const PATH_ID = 'DamonKoy/dsh-web-ui#dsh-aionui-panel';
const DROPPED_ID = 'omdsh-dev/dsh-genui';
const NPM_SPEC = 'dsh-composer-expand';
const GITHUB_SPEC = 'github:01Virex/dsh-status-rotator';
const PATH_SPEC = 'github:DamonKoy/dsh-web-ui#path:/packages/dsh-aionui-panel';

let dshHomeDir = '';

function cacheFile() {
  return path.join(userData, 'marketplace-cache.json');
}

function profileDir() {
  return path.join(dshHomeDir, 'profiles', 'web');
}

function writeProfileDep(packageName, spec) {
  const dir = profileDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'web',
    dependencies: { [packageName]: spec },
  }, null, 2)}\n`);
}

function writePlugin(packageName, manifest, files = {}) {
  const dir = path.join(profileDir(), 'node_modules', packageName);
  fs.mkdirSync(dir, { recursive: true });
  // Real installs always carry a version; `version: undefined` drops the key
  // for the versionless-manifest cases the install validation must refuse.
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: packageName,
    version: '0.0.0',
    ...manifest,
  }, null, 2)}\n`);
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

function writeBundlePlugin(packageName) {
  const id = `bundle-${String(packageName).replace(/[^A-Za-z0-9]+/g, '-')}`.slice(0, 48);
  writePlugin(packageName, {
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, {
    'cordis.patch.yml': `- insert:\n    - id: ${id}\n      name: ${packageName}\n`,
  });
}

function writeVersionedBundlePlugin(packageName, version) {
  const id = `bundle-${String(packageName).replace(/[^A-Za-z0-9]+/g, '-')}`.slice(0, 48);
  writePlugin(packageName, {
    version,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, {
    'cordis.patch.yml': `- insert:\n    - id: ${id}\n      name: ${packageName}\n`,
  });
}

function writeLockCommit(owner, repo, commit) {
  fs.mkdirSync(profileDir(), { recursive: true });
  fs.writeFileSync(
    path.join(profileDir(), 'pnpm-lock.yaml'),
    `resolution: https://codeload.github.com/${owner}/${repo}/tar.gz/${commit}\n`,
  );
}

function writeClientPlugin(packageName) {
  writePlugin(packageName, {
    dsh: { client: { platform: 'web', inject: [] } },
    exports: { './client': { default: './lib/client.js' } },
  }, { 'lib/client.js': 'export {}\n' });
}

function writeExportsPlugin(packageName) {
  writePlugin(packageName, {
    exports: { '.': { default: './lib/index.js' } },
  }, { 'lib/index.js': 'module.exports = {}\n' });
}

function writeBarePlugin(packageName) {
  writePlugin(packageName, {});
}

function writeDiskRegistry(plugins) {
  fs.writeFileSync(cacheFile(), `${JSON.stringify({
    version: 3,
    fetchedAt: Date.now(),
    registry: { plugins },
  }, null, 2)}\n`);
}

function githubRow(owner, name, url, installToken) {
  return {
    owner,
    name,
    url,
    category: 'ui',
    description: { en: name, zh: name },
    npm: null,
    stars: 0,
    install: `dsh plugin --profile web add ${installToken}`,
    added: '2026-08-18',
  };
}

// The shipped snapshot row for status-rotator became npm-published in the
// 2026-08-27 refresh; github-channel tests pin the github-only shape here so
// snapshot refreshes cannot flip their resolved spec.
function writeGithubOnlyStatusRotatorRegistry() {
  writeDiskRegistry([githubRow(
    '01Virex',
    'dsh-status-rotator',
    'https://github.com/01Virex/dsh-status-rotator',
    GITHUB_SPEC,
  )]);
}

function recordRunner(onAdd) {
  const calls = [];
  return {
    calls,
    runPlugin: async (args) => {
      calls.push(args.slice());
      if (args[0] === 'add' && typeof onAdd === 'function') {
        onAdd(args[1]);
      }
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  };
}

test.beforeEach(() => {
  dshHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  process.env.DSHD_HOME = dshHomeDir;
});

test.afterEach(() => {
  delete process.env.DSHD_HOME;
  fs.rmSync(dshHomeDir, { recursive: true, force: true });
  try {
    fs.unlinkSync(cacheFile());
  } catch {
    // no cache this test
  }
});

test.after(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(userData, { recursive: true, force: true });
});

test('parseAllowBuilds reads ignored build script names', () => {
  const keys = parseAllowBuilds(`
pnpm: git-hosted plugins build on install
Ignored build scripts: @dsh-external/dsh-loop@0.1.0 foo-bar@2.0.0
Run "pnpm approve-builds" to pick which dependencies should be allowed
`);
  assert.ok(keys.includes('@dsh-external/dsh-loop'));
  assert.ok(keys.includes('foo-bar'));
});

test('parseAllowBuilds reads yaml-style allowBuilds keys', () => {
  const keys = parseAllowBuilds(`
add the exact key under allowBuilds:
  "github.com/owner/repo": false
`);
  assert.ok(keys.includes('github.com/owner/repo'));
});

test('parseAllowBuilds drops path and yaml-like keys', () => {
  const keys = parseAllowBuilds(`
  "../prepare": false
  "good-package": false
  "bad:key": false
`);
  assert.deepEqual(keys, ['good-package']);
});

test('generic dsh workspace guidance is not build approval without an exact key', () => {
  const log = `
GET https://codeload.github.com failed with error (23)
dsh: pnpm failed in profile directory C:/profile/web
dsh: add the exact key pnpm printed above under allowBuilds in C:/profile/web/pnpm-workspace.yaml, then re-run
`;
  assert.deepEqual(parseAllowBuilds(log), []);
  assert.equal(isBuildApprovalFailure(1, []), false);
  assert.equal(isBuildApprovalFailure(1, ['dshbot@git+https://github.com/ChisaAlter/dshbot.git']), true);
  assert.equal(isBuildApprovalFailure(0, ['dshbot']), false);
});

test('marketplace update semver comparison is forwards-only', () => {
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.2') > 0);
  assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.9') > 0);
  assert.equal(compareVersions('latest', '1.0.0'), null);
  assert.equal(isUpgrade('2.0.0', '1.9.9'), false);
  assert.equal(isUpgrade('1.0.0', '2.0.0'), true);
});

test('marketplace update detection compares npm versions and GitHub commits', async () => {
  writeProfileDep('demo', '1.0.0');
  writeVersionedBundlePlugin('demo', '1.0.0');
  const npmStatus = await checkMarketplacePluginUpdate({
    id: 'acme/demo',
    owner: 'acme',
    repo: 'demo',
    packageName: 'demo',
    installSpec: 'demo',
  }, [{ name: 'demo', spec: '1.0.0' }], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '1.2.0' }) }),
  });
  assert.deepEqual(npmStatus, {
    id: 'acme/demo',
    packageName: 'demo',
    kind: 'npm',
    current: '1.0.0',
    latest: '1.2.0',
    updateAvailable: true,
    checkFailed: false,
  });

  const current = '1111111111111111111111111111111111111111';
  const latest = '2222222222222222222222222222222222222222';
  const githubStatus = await checkMarketplacePluginUpdate({
    id: 'acme/git-demo',
    owner: 'acme',
    repo: 'git-demo',
    packageName: '',
    installSpec: 'github:acme/git-demo',
  }, [{ name: 'git-demo', spec: `github:acme/git-demo#${current}` }], {
    lockCommits: new Map([['acme/git-demo', current]]),
    fetchImpl: async () => ({ ok: true, text: async () => latest }),
  });
  assert.equal(githubStatus.current, current);
  assert.equal(githubStatus.latest, latest);
  assert.equal(githubStatus.updateAvailable, true);
  assert.equal(githubStatus.checkFailed, false);

  const failedStatus = await checkMarketplacePluginUpdate({
    id: 'acme/demo',
    owner: 'acme',
    repo: 'demo',
    packageName: 'demo',
    installSpec: 'demo',
  }, [{ name: 'demo', spec: '1.0.0' }], {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(failedStatus.checkFailed, true);
  assert.equal(failedStatus.updateAvailable, false);
});

test('update detection never substitutes npm for a same-named private git dependency', async () => {
  const fetchImpl = async () => { throw new Error('must not probe'); };
  for (const spec of ['git+https://private.example/demo.git', 'git@private.example:demo', 'https://private.example/demo', 'file:../demo']) {
    const status = await checkMarketplacePluginUpdate({ id: 'acme/demo', packageName: 'demo', installSpec: 'demo' },
      [{ name: 'demo', spec }], { fetchImpl });
    assert.equal(status, null);
  }
});

test('GitHub root package does not match a different monorepo subpackage', async () => {
  assert.equal(await checkMarketplacePluginUpdate({ id: 'acme/demo', installSpec: 'github:acme/demo' },
    [{ name: 'sub', spec: 'github:acme/demo#path:/packages/sub' }]), null);
});

test('ambiguous lock commits never select an arbitrary version for a repository', async () => {
  const previous = '1'.repeat(40);
  const other = '2'.repeat(40);
  writeLockCommit('acme', 'demo', previous);
  fs.appendFileSync(path.join(profileDir(), 'pnpm-lock.yaml'), `other: https://codeload.github.com/acme/demo/tar.gz/${other}\n`);
  const result = await checkMarketplacePluginUpdate({ id: 'acme/demo', installSpec: 'github:acme/demo' },
    [{ name: 'demo', spec: `github:acme/demo#${previous}` }], {
      fetchImpl: async () => ({ ok: true, text: async () => other }),
    });
  assert.equal(result.current, null);
  assert.equal(result.updateAvailable, false);
});

test('batch updates validate ids and keep the mutation lock across the whole batch', async () => {
  assert.equal((await updateMarketplacePlugins([])).ok, false);
  assert.equal((await updateMarketplacePlugins([{}])).ok, false);
  assert.equal((await updateMarketplacePlugins(Array(101).fill('a'))).ok, false);
  const result = await updateMarketplacePlugins(['missing/one', 'missing/one', 'missing/two']);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(result.results.length, 2);
});

test('batch updates deduplicate successful writes and serialize against uninstall', async () => {
  writeDiskRegistry([{ ...githubRow('13071301808', NPM_SPEC, `https://github.com/13071301808/${NPM_SPEC}`, NPM_SPEC), npm: NPM_SPEC }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  let adds = 0;
  const result = await updateMarketplacePlugins([NPM_ID, NPM_ID], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '2.0.0' }) }),
    runPlugin: async args => {
      assert.equal((await uninstallPlugin(NPM_SPEC, { runPlugin: async () => { throw new Error('interleaved'); } })).ok, false);
      if (args[0] === 'add') {
        adds++;
        writeProfileDep(NPM_SPEC, '2.0.0');
        writeVersionedBundlePlugin(NPM_SPEC, '2.0.0');
      }
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(adds, 1);
});

test('batch stops after rollback failure and reports thrown CLI errors', async () => {
  writeDiskRegistry([{ ...githubRow('13071301808', NPM_SPEC, `https://github.com/13071301808/${NPM_SPEC}`, NPM_SPEC), npm: NPM_SPEC }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  const result = await updateMarketplacePlugins([NPM_ID, 'missing/second'], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '2.0.0' }) }),
    runPlugin: async () => { throw new Error('disk unavailable'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, true);
  assert.equal(result.results.length, 1);
  assert.match(result.results[0].error, /回滚失败/);
});

test('details fetch only curated public endpoints and cap oversized README bodies', async () => {
  writeDiskRegistry([{ ...githubRow('13071301808', NPM_SPEC, `https://github.com/13071301808/${NPM_SPEC}`, NPM_SPEC), npm: NPM_SPEC }]);
  await assert.rejects(() => getMarketplaceDetails('https://private.example/token'));
  const urls = [];
  const details = await getMarketplaceDetails(NPM_ID, { force: true, fetchImpl: async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return { ok: true, text: async () => url.includes('registry.npmjs.org')
      ? JSON.stringify({ name: NPM_SPEC, version: '2.0.0', engines: { dsh: '>=0.1.0' } })
      : '# README' };
  } });
  assert.equal(urls.length, 2);
  assert.equal(details.readme, '# README');
  assert.deepEqual(details.requirements, ['dsh: >=0.1.0']);
  const oversized = await getMarketplaceDetails(NPM_ID, { force: true, fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(300000) }) });
  assert.equal(oversized.partial, true);
  assert.equal(oversized.readme, '');
});

test('installPlugin rejects non-github specs before invoking the CLI', async () => {
  const result = await installPlugin('file:../local-plugin', { allowBuilds: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /github:owner\/repo/);
});

test('installPlugin rejects a catalog #path: spec before invoking the CLI', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installPlugin(PATH_SPEC, { allowBuilds: [], runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /github:owner\/repo/);
  assert.equal(calls.length, 0);
});

test('installPlugin rejects invalid allowBuilds before invoking the CLI', async () => {
  const result = await installPlugin('github:owner/repo', { allowBuilds: ['../prepare'] });
  assert.equal(result.ok, false);
  assert.match(result.error, /allowBuilds/);
});

test('parseImportRegistrySpec accepts pinned name@semver and rejects loose specs', () => {
  assert.deepEqual(parseImportRegistrySpec('good-plugin@1.2.3'), { name: 'good-plugin', version: '1.2.3' });
  assert.deepEqual(
    parseImportRegistrySpec('@scope/name@^2.0.0-rc.1'),
    { name: '@scope/name', version: '^2.0.0-rc.1' },
  );
  assert.equal(parseImportRegistrySpec('good-plugin'), null);
  assert.equal(parseImportRegistrySpec('good-plugin@latest'), null);
  assert.equal(parseImportRegistrySpec('@scope/name'), null);
  assert.equal(parseImportRegistrySpec('../escape@1.2.3'), null);
  assert.equal(parseImportRegistrySpec('good plugin@1.2.3'), null);
  assert.equal(parseImportRegistrySpec(''), null);
});

test('installImportPlugin adds a registry name@semver spec through the CLI', async () => {
  const { calls, runPlugin } = recordRunner((spec) => {
    writeProfileDep('good-plugin', spec);
    writeClientPlugin('good-plugin');
  });
  const result = await installImportPlugin('good-plugin@1.2.3', { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', 'good-plugin@1.2.3']]);
});

test('installImportPlugin re-adds an already-installed registry name', async () => {
  writeProfileDep('good-plugin', '1.0.0');
  writeClientPlugin('good-plugin');
  const { calls, runPlugin } = recordRunner((spec) => {
    writeProfileDep('good-plugin', spec);
    writeClientPlugin('good-plugin');
  });
  const result = await installImportPlugin('good-plugin@1.2.3', { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', 'good-plugin@1.2.3']]);
});

test('A6: failed import overwrite restores original specs, dependencies and physical installation', async () => {
  writeProfileDep('good-plugin', '^1.0.0');
  writePlugin('good-plugin', { version: '1.0.0', main: 'index.js' }, {
    'index.js': 'module.exports = "working original";\n',
  });
  writePlugin('shared-dependency', { version: '3.0.0' }, { 'data.bin': 'original dependency bytes' });
  fs.writeFileSync(path.join(profileDir(), 'pnpm-lock.yaml'), 'original locked resolution\n');
  fs.writeFileSync(path.join(profileDir(), 'pnpm-workspace.yaml'), 'allowBuilds:\n  trusted: true\n');
  const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'node_modules/good-plugin/package.json', 'node_modules/good-plugin/index.js',
    'node_modules/shared-dependency/package.json', 'node_modules/shared-dependency/data.bin'];
  const original = files.map(file => fs.readFileSync(path.join(profileDir(), file)));
  const calls = [];
  const result = await installImportPlugin('good-plugin@2.0.0', {
    allowBuilds: ['good-plugin'],
    runPlugin: async args => {
      calls.push(args);
      if (args[0] === 'add') {
        writeProfileDep('good-plugin', '2.0.0');
        writePlugin('good-plugin', { version: '2.0.0', main: 'missing.js' }, { 'index.js': 'broken replacement' });
        writePlugin('shared-dependency', { version: '4.0.0' }, { 'data.bin': 'changed dependency' });
        writeClientPlugin('new-dependency');
        fs.writeFileSync(path.join(profileDir(), 'pnpm-lock.yaml'), 'new lock\n');
      } else if (args[0] === 'remove') {
        // Model the destructive remove from the audit without deleting fixture paths.
        writeProfileDep('unrelated', '1.0.0');
        fs.unlinkSync(path.join(profileDir(), 'node_modules/good-plugin/index.js'));
      } else {
        throw new Error('rollback must not require another package-manager command');
      }
      return { ok: true, log: '' };
    },
  });
  assert.equal(result.ok, false);
  for (const [index, file] of files.entries()) {
    assert.deepEqual(fs.readFileSync(path.join(profileDir(), file)), original[index], file);
  }
  assert.equal(fs.existsSync(path.join(profileDir(), 'node_modules/new-dependency')), false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(calls, [['add', 'good-plugin@2.0.0']]);
});

for (const channel of ['import', 'github', 'catalog']) {
  test(`A6: ${channel} overwrite restores an identifiable old plugin after versionless replacement`, async () => {
    const name = channel === 'catalog' ? NPM_SPEC : 'good-plugin';
    const oldSpec = channel === 'github' ? 'github:acme/good-plugin#old' : '^1.0.0';
    writeProfileDep(name, oldSpec);
    writePlugin(name, { version: '1.0.0', main: 'index.js' }, { 'index.js': 'old entry' });
    const options = { runPlugin: async args => {
      assert.equal(args[0], 'add');
      writeProfileDep(name, channel === 'github' ? 'github:acme/good-plugin#new' : '2.0.0');
      writePlugin(name, { version: undefined, main: 'index.js' }, { 'index.js': 'new entry' });
      return { ok: true };
    } };
    const result = channel === 'import' ? await installImportPlugin(`${name}@2.0.0`, options)
      : channel === 'github' ? await installPlugin('github:acme/good-plugin#new', options)
        : await installMarketplacePlugin(NPM_ID, options);
    assert.match(result.error, /name 或 version/);
    assert.equal(result.rolledBack, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'))).dependencies[name], oldSpec);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'node_modules', name, 'package.json'))).version, '1.0.0');
    assert.equal(fs.readFileSync(path.join(profileDir(), 'node_modules', name, 'index.js'), 'utf8'), 'old entry');
    assert.equal(fs.existsSync(path.join(profileDir(), 'pnpm-workspace.yaml')), false);
    assert.equal(fs.readdirSync(profileDir()).some(name => name.startsWith('.install-rollback-')), false);
  });
}

for (const mode of ['failure', 'throw', 'success']) {
  test(`A6: CLI ${mode} after writing an overwrite preserves the appropriate physical version`, async () => {
    writeProfileDep('good-plugin', '~1.0.0');
    writePlugin('good-plugin', { version: '1.0.0', main: 'index.js' }, { 'index.js': 'old' });
    const result = await installImportPlugin('good-plugin@2.0.0', { runPlugin: async args => {
      assert.equal(args[0], 'add');
      writeProfileDep('good-plugin', '2.0.0');
      writePlugin('good-plugin', { version: '2.0.0', main: 'index.js' }, { 'index.js': 'new' });
      fs.writeFileSync(path.join(profileDir(), 'pnpm-lock.yaml'), 'new lock');
      if (mode === 'throw') throw new Error('CLI interrupted after partial write');
      return { ok: mode === 'success', log: mode === 'failure' ? 'download failed' : '' };
    } });
    assert.equal(result.ok, mode === 'success');
    if (mode !== 'success') assert.equal(result.rolledBack, true);
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir(), 'node_modules/good-plugin/package.json')));
    assert.equal(pkg.version, mode === 'success' ? '2.0.0' : '1.0.0');
    assert.equal(fs.readFileSync(path.join(profileDir(), 'node_modules/good-plugin/index.js'), 'utf8'), mode === 'success' ? 'new' : 'old');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'))).dependencies['good-plugin'], mode === 'success' ? '2.0.0' : '~1.0.0');
    assert.equal(fs.existsSync(path.join(profileDir(), 'pnpm-lock.yaml')), mode === 'success');
    assert.equal(fs.readdirSync(profileDir()).some(name => name.startsWith('.install-rollback-')), false);
  });
}

test('A6: pnpm virtual store and package junctions survive a failed overwrite', async t => {
  const name = '@scope/good-plugin';
  writeProfileDep(name, '^1.0.0');
  const modules = path.join(profileDir(), 'node_modules');
  const store = path.join(modules, '.pnpm/good-plugin@1.0.0/node_modules/@scope/good-plugin');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(store, 'index.js'), 'old virtual store bytes');
  fs.mkdirSync(path.join(modules, '@scope'), { recursive: true });
  fs.symlinkSync(store, path.join(modules, name), 'junction');
  const originalLink = fs.readlinkSync(path.join(modules, name));
  const overlay = path.join(dshHomeDir, 'external-overlay');
  fs.mkdirSync(overlay);
  fs.writeFileSync(path.join(overlay, 'keep.txt'), 'external overlay');
  fs.symlinkSync(overlay, path.join(modules, 'overlay'), 'junction');
  const { symlinkSync } = fs;
  const copiedLinkTypes = [];
  t.mock.method(fs, 'symlinkSync', function (source, target, type) {
    copiedLinkTypes.push(type);
    return symlinkSync.call(this, source, target, type);
  });
  const result = await installImportPlugin(`${name}@2.0.0`, { runPlugin: async args => {
    assert.equal(args[0], 'add');
    const snapshot = path.join(profileDir(), fs.readdirSync(profileDir()).find(entry => entry.startsWith('.install-rollback-')));
    const savedModules = path.join(snapshot, 'node_modules');
    assert.equal(fs.lstatSync(path.join(savedModules, name)).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(savedModules, name)), originalLink);
    assert.equal(fs.readFileSync(path.join(savedModules, '.pnpm/good-plugin@1.0.0/node_modules/@scope/good-plugin/index.js'), 'utf8'), 'old virtual store bytes');
    assert.equal(fs.readlinkSync(path.join(savedModules, 'overlay')), overlay);
    writeProfileDep(name, '2.0.0');
    // Simulate an in-place mutation through the link and removal of old bytes.
    fs.writeFileSync(path.join(store, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
    fs.unlinkSync(path.join(store, 'index.js'));
    return { ok: true };
  } });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true, result.error);
  assert.equal(fs.lstatSync(path.join(modules, name)).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(path.join(modules, name)), originalLink);
  assert.equal(fs.readFileSync(path.join(modules, name, 'index.js'), 'utf8'), 'old virtual store bytes');
  assert.equal(fs.readFileSync(path.join(overlay, 'keep.txt'), 'utf8'), 'external overlay');
  assert.equal(fs.readlinkSync(path.join(modules, 'overlay')), overlay);
  if (process.platform === 'win32') assert.deepEqual(copiedLinkTypes, ['junction', 'junction']);
});

test('A6: a committed install cleans the snapshot without deleting a linked external directory', async () => {
  writeProfileDep('good-plugin', '1.0.0');
  writePlugin('good-plugin', { version: '1.0.0', main: 'index.js' }, { 'index.js': 'old' });
  const modules = path.join(profileDir(), 'node_modules');
  const overlay = path.join(dshHomeDir, 'external-overlay');
  fs.mkdirSync(overlay);
  fs.writeFileSync(path.join(overlay, 'keep.txt'), 'external overlay');
  fs.symlinkSync(overlay, path.join(modules, 'overlay'), 'junction');
  const result = await installImportPlugin('good-plugin@2.0.0', { runPlugin: async () => {
    writeProfileDep('good-plugin', '2.0.0');
    writePlugin('good-plugin', { version: '2.0.0', main: 'index.js' }, { 'index.js': 'new' });
    return { ok: true };
  } });
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.readdirSync(profileDir()).some(name => name.startsWith('.install-rollback-')), false);
  assert.equal(fs.readFileSync(path.join(overlay, 'keep.txt'), 'utf8'), 'external overlay');
  assert.equal(fs.readlinkSync(path.join(modules, 'overlay')), overlay);
  assert.equal(fs.readFileSync(path.join(modules, 'good-plugin/index.js'), 'utf8'), 'new');
});

test('A6: a snapshot directory link refuses an occupied ordinary directory before add', { skip: process.platform !== 'win32' }, async t => {
  writeProfileDep('good-plugin', '1.0.0');
  writePlugin('good-plugin', { version: '1.0.0', main: 'index.js' }, { 'index.js': 'old' });
  const modules = path.join(profileDir(), 'node_modules');
  const overlay = path.join(dshHomeDir, 'external-overlay');
  fs.mkdirSync(overlay);
  fs.writeFileSync(path.join(overlay, 'keep.txt'), 'external overlay');
  fs.symlinkSync(overlay, path.join(modules, 'overlay'), 'junction');
  const { cp } = fs.promises;
  let inspected = false;
  t.mock.method(fs.promises, 'cp', async (source, target, options) => {
    if (source === modules) {
      const occupied = path.join(target, 'overlay');
      fs.mkdirSync(occupied, { recursive: true });
      fs.writeFileSync(path.join(occupied, 'unknown.txt'), 'unknown directory');
      await assert.rejects(cp(source, target, options), /refusing to replace unknown content/);
      assert.equal(fs.lstatSync(occupied).isDirectory(), true);
      assert.equal(fs.readFileSync(path.join(occupied, 'unknown.txt'), 'utf8'), 'unknown directory');
      inspected = true;
      throw new Error('refusing to replace unknown content');
    }
    return cp(source, target, options);
  });
  let called = false;
  const result = await installImportPlugin('good-plugin@2.0.0', { runPlugin: async () => { called = true; } });
  assert.equal(inspected, true);
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /未执行安装.*refusing to replace unknown content/);
  assert.equal(fs.readFileSync(path.join(modules, 'good-plugin/index.js'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(overlay, 'keep.txt'), 'utf8'), 'external overlay');
  assert.equal(fs.readlinkSync(path.join(modules, 'overlay')), overlay);
});

test('A6: snapshot copy failure aborts before add and preserves the old installation', async t => {
  writeProfileDep('good-plugin', '1.0.0');
  writeClientPlugin('good-plugin');
  t.mock.method(fs.promises, 'cp', async () => { throw new Error('ENOSPC snapshot'); });
  let called = false;
  const result = await installImportPlugin('good-plugin@2.0.0', { runPlugin: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.match(result.error, /未执行安装.*ENOSPC/);
  assert.equal(called, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'))).dependencies['good-plugin'], '1.0.0');
  assert.equal(fs.existsSync(path.join(profileDir(), 'node_modules/good-plugin/lib/client.js')), true);
  assert.equal(fs.readdirSync(profileDir()).some(name => name.startsWith('.install-rollback-')), false);
});

test('A6: a first install failing validation removes newly created profile files and modules', async () => {
  const result = await installImportPlugin('good-plugin@2.0.0', {
    allowBuilds: ['good-plugin'],
    runPlugin: async args => {
      assert.equal(args[0], 'add');
      writeProfileDep('good-plugin', '2.0.0');
      writeBarePlugin('good-plugin');
      fs.writeFileSync(path.join(profileDir(), 'pnpm-lock.yaml'), 'new lock');
      return { ok: true };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(fs.readdirSync(profileDir()), []);
});

test('A6: loader conflict after overwriting a catalog plugin restores the previous bundle', async () => {
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeBundlePlugin(NPM_SPEC);
  writePlugin('other-plugin', { dsh: { bundle: { patch: 'cordis.patch.yml' } } }, {
    'cordis.patch.yml': '- insert:\n    - id: shared-loader\n      name: other-plugin\n',
  });
  const manifest = path.join(profileDir(), 'package.json');
  const before = { name: 'web', dependencies: { [NPM_SPEC]: '1.0.0', 'other-plugin': '3.0.0' } };
  fs.writeFileSync(manifest, JSON.stringify(before));
  const patchFile = path.join(profileDir(), 'node_modules', NPM_SPEC, 'cordis.patch.yml');
  const originalPatch = fs.readFileSync(patchFile);
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin: async args => {
    assert.equal(args[0], 'add');
    fs.writeFileSync(manifest, JSON.stringify({ ...before, dependencies: { ...before.dependencies, [NPM_SPEC]: '2.0.0' } }));
    fs.writeFileSync(patchFile, `- insert:\n    - id: shared-loader\n      name: ${NPM_SPEC}\n`);
    return { ok: true };
  } });
  assert.equal(result.ok, false);
  assert.match(result.error, /shared-loader/);
  assert.equal(result.rolledBack, true);
  assert.deepEqual(fs.readFileSync(patchFile), originalPatch);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest)), before);
});

test('A6: rollback publication failure retains the physical backup and suppresses approval retry', async t => {
  writeProfileDep('good-plugin', '1.0.0');
  writeClientPlugin('good-plugin');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(from).includes('.install-rollback-') && path.basename(from) === 'node_modules') {
      throw new Error('EACCES restore node_modules');
    }
    return rename(from, to);
  });
  const result = await installImportPlugin('good-plugin@2.0.0', { runPlugin: async () => {
    writeProfileDep('good-plugin', '2.0.0');
    writeBarePlugin('good-plugin');
    return { ok: false, needsAllowBuilds: true, allowBuilds: ['good-plugin'] };
  } });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, false);
  assert.equal(result.needsAllowBuilds, false);
  assert.deepEqual(result.allowBuilds, []);
  assert.match(result.rollbackError, /EACCES.*回滚备份保留/);
  const backup = fs.readdirSync(profileDir()).find(name => name.startsWith('.install-rollback-'));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(profileDir(), backup, 'node_modules/good-plugin/lib/client.js'), 'utf8'), 'export {}\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'))).dependencies['good-plugin'], '1.0.0');
});

test('installImportPlugin still accepts the github channel', async () => {
  const { calls, runPlugin } = recordRunner((spec) => {
    writeProfileDep('good', spec);
    writeClientPlugin('good');
  });
  const result = await installImportPlugin('github:acme/good#0123456789abcdef0123456789abcdef01234567', { runPlugin });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'add');
});

test('installImportPlugin rejects tarballs, dist-tags, and local specs before the CLI', async () => {
  const { calls, runPlugin } = recordRunner();
  for (const spec of [
    'https://example.test/x.tgz',
    'good-plugin@latest',
    'file:../local',
    'git+https://github.com/a/b.git',
    'npm:alias@1.2.3',
    '',
  ]) {
    const result = await installImportPlugin(spec, { runPlugin });
    assert.equal(result.ok, false, `spec should be rejected: ${spec}`);
  }
  assert.equal(calls.length, 0);
});

test('installImportPlugin rejects a DROPPED plugin name before the CLI', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installImportPlugin('@dsh-external/dsh-genui@1.0.0', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /退役/);
  assert.equal(calls.length, 0);
});

test('installImportPlugin rejects first-party dsh-im (Settings → Remote channels)', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installImportPlugin('@xmanrui/dsh-im@3.0.1', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /退役/);
  assert.equal(calls.length, 0);
});

test('dropped basenames are rejected under any scope or GitHub owner (rename bypass)', async () => {
  const { calls, runPlugin } = recordRunner();
  for (const spec of [
    '@changfenhuang/dsh-genui@1.0.0',
    'dsh-genui@1.0.0',
    '@another-scope/dsh-im@9.9.9',
  ]) {
    const result = await installImportPlugin(spec, { runPlugin });
    assert.equal(result.ok, false, `spec should be rejected: ${spec}`);
    assert.match(result.error, /退役/);
  }
  for (const spec of [
    'github:changfenhuang/dsh-genui',
    'github:someone/dsh-genui#0123456789abcdef0123456789abcdef01234567',
  ]) {
    const viaImport = await installImportPlugin(spec, { runPlugin });
    assert.equal(viaImport.ok, false, `import spec should be rejected: ${spec}`);
    assert.match(viaImport.error, /退役/);
    const viaGithub = await installPlugin(spec, { runPlugin });
    assert.equal(viaGithub.ok, false, `github spec should be rejected: ${spec}`);
    assert.match(viaGithub.error, /退役/);
  }
  // The `#path:` monorepo channel only exists for curated catalog rows;
  // its dropped-basename gate is the shared isDroppedInstallSpec predicate.
  assert.equal(isDroppedInstallSpec('github:acme/monorepo#path:/plugins/dsh-genui'), true);
  assert.equal(isDroppedInstallSpec('github:acme/monorepo#path:/plugins/dsh-genui-viewer'), false);
  assert.equal(calls.length, 0);
});

test('segment-exact dropped matching keeps different packages installable', async () => {
  const { calls, runPlugin } = recordRunner((spec) => {
    const name = spec.startsWith('github:') ? 'dsh-im-bridge' : 'dsh-genui-viewer';
    writeProfileDep(name, spec);
    writeClientPlugin(name);
  });
  const bridge = await installPlugin('github:acme/dsh-im-bridge', { runPlugin });
  assert.equal(bridge.ok, true);
  const viewer = await installImportPlugin('dsh-genui-viewer@1.0.0', { runPlugin });
  assert.equal(viewer.ok, true);
  assert.equal(calls.length, 2);
});

test('uninstallPlugin rejects shell syntax before invoking the CLI', async () => {
  const result = await uninstallPlugin('safe-package & calc.exe');
  assert.equal(result.ok, false);
  assert.match(result.error, /包名/);
});

test('installMarketplacePlugin rejects an unknown catalog id before invoking the CLI', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin('missing/plugin', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /未收录/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin rejects a DROPPED catalog plugin before invoking the CLI', async () => {
  // The shipped offline snapshot carries no dropped rows (that invariant has
  // its own test), so seed the dropped row through the disk registry — the
  // live registry can always still list one.
  writeDiskRegistry([{
    ...githubRow('omdsh-dev', 'dsh-genui', 'https://github.com/omdsh-dev/dsh-genui', '@dsh-external/dsh-genui'),
    npm: '@dsh-external/dsh-genui',
  }]);
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin(DROPPED_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /退役|下架|不再/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin rejects a deprecated catalog row before invoking the CLI', async () => {
  writeDiskRegistry([{
    ...githubRow(
      'acme',
      'dsh-olddemo',
      'https://github.com/acme/dsh-olddemo',
      'github:acme/dsh-olddemo',
    ),
    deprecated: true,
  }]);
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin('acme/dsh-olddemo', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /弃用/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin rejects invalid allowBuilds before invoking the CLI', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin(NPM_ID, { allowBuilds: ['../prepare'], runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /allowBuilds/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin installs a curated npm spec through the plugin runner', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeBundlePlugin(NPM_SPEC);
  });
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
  assert.equal(result.spec, NPM_SPEC);
});

test('installMarketplacePlugin rolls back a dependency when no loadable entry is discoverable', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep(NPM_SPEC, 'workspace:*');
  });
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载|插件/);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
});

test('installMarketplacePlugin installs github:owner/repo through the plugin runner', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep('@virex/dsh-status-rotator', 'git+https://github.com/01Virex/dsh-status-rotator.git');
    writeClientPlugin('@virex/dsh-status-rotator');
  });
  const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', GITHUB_SPEC]]);
});

test('installMarketplacePlugin allows a catalog #path: spec that Host installPlugin rejects', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep(
      'dsh-aionui-panel',
      'git+https://github.com/DamonKoy/dsh-web-ui.git#path:/packages/dsh-aionui-panel',
    );
    writeExportsPlugin('dsh-aionui-panel');
  });
  const result = await installMarketplacePlugin(PATH_ID, { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', PATH_SPEC]]);
});

test('installMarketplacePlugin rejects #path: specs with .. or backslash', async () => {
  writeDiskRegistry([
    githubRow(
      'evil',
      'dotdot',
      'https://github.com/evil/dotdot/blob/main/README.md',
      'github:evil/dotdot#path:/packages/../../../tmp',
    ),
    githubRow(
      'evil',
      'backslash',
      'https://github.com/evil/backslash/blob/main/README.md',
      'github:evil/backslash#path:/packages\\windows',
    ),
  ]);
  const { calls, runPlugin } = recordRunner();
  const dotdot = await installMarketplacePlugin('evil/dotdot', { runPlugin });
  const backslash = await installMarketplacePlugin('evil/backslash', { runPlugin });
  assert.equal(dotdot.ok, false);
  assert.equal(backslash.ok, false);
  assert.doesNotMatch(dotdot.error, /未收录/);
  assert.doesNotMatch(backslash.error, /未收录/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin and uninstallPlugin share an in-flight mutex', async () => {
  let releaseAdd;
  let addStarted;
  const started = new Promise((resolve) => {
    addStarted = resolve;
  });
  const first = installMarketplacePlugin(NPM_ID, {
    runPlugin: () => {
      addStarted();
      return new Promise((resolve) => {
        releaseAdd = resolve;
      });
    },
  });
  await started;
  const uninstallCalls = [];
  const busyUninstall = await uninstallPlugin(NPM_SPEC, {
    runPlugin: async (args) => {
      uninstallCalls.push(args.slice());
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  const busyInstall = await installPlugin(GITHUB_SPEC, {
    runPlugin: async () => {
      throw new Error('installPlugin should not run while marketplace install is in flight');
    },
  });
  assert.equal(busyUninstall.ok, false);
  assert.equal(busyUninstall.error, '已有插件正在安装或卸载，请稍后再试');
  assert.equal(busyInstall.ok, false);
  assert.equal(busyInstall.error, '已有插件正在安装或卸载，请稍后再试');
  assert.equal(uninstallCalls.length, 0);
  releaseAdd({ ok: false, code: 1, log: '', needsAllowBuilds: false, allowBuilds: [] });
  const firstResult = await first;
  assert.equal(firstResult.ok, false);
});

test('installMarketplacePlugin removes a package with no loadable dsh entry', async () => {
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载/);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
});

test('installMarketplacePlugin removes a github package with no loadable dsh entry', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep('@virex/dsh-status-rotator', 'git+https://github.com/01Virex/dsh-status-rotator.git');
    writeBarePlugin('@virex/dsh-status-rotator');
  });
  const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载/);
  assert.deepEqual(calls, [['add', GITHUB_SPEC]]);
});

test('installMarketplacePlugin removes a versionless package that would break request inventory', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep(NPM_SPEC, 'workspace:*');
    writePlugin(NPM_SPEC, {
      version: undefined,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, {
      'cordis.patch.yml': `- insert:\n    - id: versionless\n      name: ${NPM_SPEC}\n`,
    });
  });
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /name 或 version/);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
});

test('installPlugin removes a versionless github package that would break request inventory', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep('versionless-plugin', 'git+https://github.com/acme/versionless-plugin.git');
    writePlugin('versionless-plugin', {
      version: undefined,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, {
      'cordis.patch.yml': '- insert:\n    - id: versionless\n      name: versionless-plugin\n',
    });
  });
  const result = await installPlugin('github:acme/versionless-plugin', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /name 或 version/);
  assert.deepEqual(calls, [['add', 'github:acme/versionless-plugin']]);
});

test('installImportPlugin removes a versionless registry package', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep('versionless-plugin', '0.9.0');
    writePlugin('versionless-plugin', {
      version: undefined,
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, {
      'cordis.patch.yml': '- insert:\n    - id: versionless\n      name: versionless-plugin\n',
    });
  });
  const result = await installImportPlugin('versionless-plugin@0.9.0', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /name 或 version/);
  assert.deepEqual(calls, [['add', 'versionless-plugin@0.9.0']]);
});

test('installMarketplacePlugin removes a #path: package with no loadable dsh entry', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep(
      'dsh-aionui-panel',
      'git+https://github.com/DamonKoy/dsh-web-ui.git#path:/packages/dsh-aionui-panel',
    );
    writeBarePlugin('dsh-aionui-panel');
  });
  const result = await installMarketplacePlugin(PATH_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载/);
  assert.deepEqual(calls, [['add', PATH_SPEC]]);
});

test('installMarketplacePlugin installs a GitHub URL when the install command is a tarball', async () => {
  writeDiskRegistry([githubRow(
    'HUITianYi',
    'dsh-whale-desktop-launcher',
    'https://github.com/HUITianYi/dsh-whale-desktop-launcher',
    '"https://github.com/HUITianYi/dsh-whale-desktop-launcher/releases/latest/download/x.tgz"',
  )]);
  const { calls, runPlugin } = recordRunner(() => {
    writeProfileDep('dsh-whale-desktop-launcher', 'github:HUITianYi/dsh-whale-desktop-launcher');
    writeClientPlugin('dsh-whale-desktop-launcher');
  });
  const result = await installMarketplacePlugin('HUITianYi/dsh-whale-desktop-launcher', { runPlugin });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['add', 'github:HUITianYi/dsh-whale-desktop-launcher']]);
  assert.equal(result.spec.includes('.tgz'), false);
});

test('installMarketplacePlugin rejects a github spec whose owner/repo does not match the catalog URL', async () => {
  writeDiskRegistry([githubRow(
    'evil',
    'mismatch',
    'https://example.com/not-github',
    'github:evil/mismatch',
  )]);
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin('evil/mismatch', { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /不受支持/);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin rejects a #path: spec that contains a colon', async () => {
  writeDiskRegistry([githubRow(
    'evil',
    'colon',
    'https://github.com/evil/colon/blob/main/README.md',
    'github:evil/colon#path:/packages:foo',
  )]);
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin('evil/colon', { runPlugin });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test('installMarketplacePlugin removes a github package that landed only in node_modules', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  const { calls, runPlugin } = recordRunner(() => {
    writeBarePlugin('@virex/dsh-status-rotator');
  });
  const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载/);
  assert.deepEqual(calls, [['add', GITHUB_SPEC]]);
});

test('installMarketplacePlugin preserves a github package already in the profile when it is not loadable', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  writeProfileDep('@virex/dsh-status-rotator', GITHUB_SPEC);
  writeBarePlugin('@virex/dsh-status-rotator');
  const { calls, runPlugin } = recordRunner();
  const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /可加载/);
  assert.deepEqual(calls, [['add', GITHUB_SPEC]]);
  assert.equal(result.rolledBack, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'))).dependencies['@virex/dsh-status-rotator'], GITHUB_SPEC);
  assert.equal(fs.existsSync(path.join(profileDir(), 'node_modules/@virex/dsh-status-rotator/package.json')), true);
});

test('installMarketplacePlugin removes a package whose bundle patch only sets patch: true', async () => {
  const { calls, runPlugin } = recordRunner(() => {
    writePlugin(NPM_SPEC, { dsh: { bundle: { patch: true } } });
  });
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
});

test('installMarketplacePlugin removes a package that inserts a duplicate loader id', async () => {
  writeProfileDep('@deepseek-ai/dsh-web-app', 'workspace:*');
  writePlugin('@deepseek-ai/dsh-web-app', {
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, {
    'cordis.patch.yml': '- insert:\n    - id: storage\n      name: @deepseek-ai/dsh-web-app\n',
  });
  const { calls, runPlugin } = recordRunner(() => {
    writePlugin(NPM_SPEC, {
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }, {
      'cordis.patch.yml': '- insert:\n    - id: storage\n      name: dsh-composer-expand\n',
    });
  });
  const result = await installMarketplacePlugin(NPM_ID, { runPlugin });
  assert.equal(result.ok, false);
  assert.match(result.error, /storage/);
  assert.deepEqual(calls, [['add', NPM_SPEC]]);
});

test('updateMarketplacePlugin installs the checked npm version', async () => {
  writeDiskRegistry([{
    ...githubRow(
      '13071301808',
      NPM_SPEC,
      `https://github.com/13071301808/${NPM_SPEC}`,
      NPM_SPEC,
    ),
    npm: NPM_SPEC,
  }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  const calls = [];
  const result = await updateMarketplacePlugin(NPM_ID, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '2.0.0' }) }),
    runPlugin: async (args) => {
      calls.push(args.slice());
      if (args[0] === 'add') {
        writeProfileDep(NPM_SPEC, '2.0.0');
        writeVersionedBundlePlugin(NPM_SPEC, '2.0.0');
      }
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.update.current, '2.0.0');
  assert.deepEqual(calls, [['add', `${NPM_SPEC}@2.0.0`]]);
});

test('updateMarketplacePlugin compares and pins GitHub commits', async () => {
  const previous = '1111111111111111111111111111111111111111';
  const latest = '2222222222222222222222222222222222222222';
  writeGithubOnlyStatusRotatorRegistry();
  writeProfileDep('@virex/dsh-status-rotator', `${GITHUB_SPEC}#${previous}`);
  writeClientPlugin('@virex/dsh-status-rotator');
  writeLockCommit('01Virex', 'dsh-status-rotator', previous);
  const calls = [];
  const result = await updateMarketplacePlugin(GITHUB_ID, {
    fetchImpl: async () => ({ ok: true, text: async () => latest }),
    runPlugin: async (args) => {
      calls.push(args.slice());
      if (args[0] === 'add') {
        writeProfileDep('@virex/dsh-status-rotator', args[1]);
        writeClientPlugin('@virex/dsh-status-rotator');
        writeLockCommit('01Virex', 'dsh-status-rotator', latest);
      }
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.update.current, latest);
  assert.deepEqual(calls, [['add', `${GITHUB_SPEC}#${latest}`]]);
});

test('updateMarketplacePlugin restores the profile after a failed add', async () => {
  writeDiskRegistry([{
    ...githubRow(
      '13071301808',
      NPM_SPEC,
      `https://github.com/13071301808/${NPM_SPEC}`,
      NPM_SPEC,
    ),
    npm: NPM_SPEC,
  }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  const workspace = 'packages: []\n';
  fs.writeFileSync(path.join(profileDir(), 'pnpm-workspace.yaml'), workspace);
  const calls = [];
  const result = await updateMarketplacePlugin(NPM_ID, {
    allowBuilds: [NPM_SPEC],
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '2.0.0' }) }),
    runPlugin: async (args) => {
      calls.push(args.slice());
      if (args[0] === 'add') {
        writeProfileDep(NPM_SPEC, '2.0.0');
        writeVersionedBundlePlugin(NPM_SPEC, '2.0.0');
        return { ok: false, code: 1, log: 'registry failed', needsAllowBuilds: false, allowBuilds: [] };
      }
      if (args[0] === 'install') writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(), 'package.json'), 'utf8'));
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.error, /已恢复原版本/);
  assert.equal(manifest.dependencies[NPM_SPEC], '1.0.0');
  assert.equal(fs.readFileSync(path.join(profileDir(), 'pnpm-workspace.yaml'), 'utf8'), workspace);
  assert.equal(JSON.parse(fs.readFileSync(path.join(profileDir(), 'node_modules', NPM_SPEC, 'package.json'), 'utf8')).version, '1.0.0');
  assert.deepEqual(calls, [['add', `${NPM_SPEC}@2.0.0`], ['install']]);
});

test('updateMarketplacePlugin rolls back a successful command that did not change the version', async () => {
  writeDiskRegistry([{
    ...githubRow(
      '13071301808',
      NPM_SPEC,
      `https://github.com/13071301808/${NPM_SPEC}`,
      NPM_SPEC,
    ),
    npm: NPM_SPEC,
  }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  const calls = [];
  const result = await updateMarketplacePlugin(NPM_ID, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ version: '2.0.0' }) }),
    runPlugin: async (args) => {
      calls.push(args.slice());
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.error, /没有变化/);
  assert.deepEqual(calls, [['add', `${NPM_SPEC}@2.0.0`], ['install']]);
});

test('updateMarketplacePlugin rolls back a github update whose manifest lacks a version', async () => {
  const previous = '1111111111111111111111111111111111111111';
  const latest = '2222222222222222222222222222222222222222';
  writeGithubOnlyStatusRotatorRegistry();
  writeProfileDep('@virex/dsh-status-rotator', `${GITHUB_SPEC}#${previous}`);
  writeClientPlugin('@virex/dsh-status-rotator');
  writeLockCommit('01Virex', 'dsh-status-rotator', previous);
  const calls = [];
  const result = await updateMarketplacePlugin(GITHUB_ID, {
    fetchImpl: async () => ({ ok: true, text: async () => latest }),
    runPlugin: async (args) => {
      calls.push(args.slice());
      if (args[0] === 'add') {
        writeProfileDep('@virex/dsh-status-rotator', args[1]);
        writePlugin('@virex/dsh-status-rotator', {
          version: undefined,
          dsh: { client: { platform: 'web', inject: [] } },
          exports: { './client': { default: './lib/client.js' } },
        }, { 'lib/client.js': 'export {}\n' });
        writeLockCommit('01Virex', 'dsh-status-rotator', latest);
      }
      if (args[0] === 'install') writeClientPlugin('@virex/dsh-status-rotator');
      return { ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.rolledBack, true);
  assert.match(result.error, /name 或 version/);
  assert.deepEqual(calls, [['add', `${GITHUB_SPEC}#${latest}`], ['install']]);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(profileDir(), 'node_modules', '@virex/dsh-status-rotator', 'package.json'), 'utf8',
  ));
  assert.equal(manifest.version, '0.0.0');
});

test('parseAllowBuilds reads ndjson-escaped prepare-not-allowed package names', () => {
  const keys = parseAllowBuilds('{"msg":"The git-hosted package \\"dsh-loop@1.0.0\\" needs to execute build scripts but is not in the allowBuilds allowlist."}');
  assert.ok(keys.includes('dsh-loop'));
});

test('installMarketplacePlugin leaves a floating github ref when no token is stored', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return { ok: true, status: 200, text: async () => 'abc1234567890' };
    }
    throw new Error('unexpected fetch');
  };
  try {
    const { calls, runPlugin } = recordRunner((spec) => {
      writeProfileDep('@virex/dsh-status-rotator', spec);
      writeClientPlugin('@virex/dsh-status-rotator');
    });
    const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin, token: '' });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0], ['add', GITHUB_SPEC]);
    assert.equal(String(calls[0][1]).includes('abc1234567890'), false);
  } finally {
    globalThis.fetch = previous;
  }
});

test('installMarketplacePlugin pins a SHA when a GitHub token is stored', async () => {
  writeGithubOnlyStatusRotatorRegistry();
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return { ok: true, status: 200, text: async () => 'abc1234567890' };
    }
    throw new Error('unexpected fetch');
  };
  try {
    const { calls, runPlugin } = recordRunner((spec) => {
      writeProfileDep('@virex/dsh-status-rotator', spec);
      writeClientPlugin('@virex/dsh-status-rotator');
    });
    const result = await installMarketplacePlugin(GITHUB_ID, { runPlugin, token: 'ghp_test' });
    assert.equal(result.ok, true);
    assert.deepEqual(calls[0], ['add', 'github:01Virex/dsh-status-rotator#abc1234567890']);
  } finally {
    globalThis.fetch = previous;
  }
});

test('rollback snapshot skips dangling symlinks during fs.promises.cp filter', async () => {
  writeDiskRegistry([{
    ...githubRow('13071301808', NPM_SPEC, `https://github.com/13071301808/${NPM_SPEC}`, NPM_SPEC),
    npm: NPM_SPEC,
  }]);
  writeProfileDep(NPM_SPEC, '1.0.0');
  writeVersionedBundlePlugin(NPM_SPEC, '1.0.0');
  const modDir = path.join(profileDir(), 'node_modules', ...NPM_SPEC.split('/'));
  const dangling = path.join(modDir, 'dangling-link');
  const origLstat = fs.promises.lstat;
  const origStat = fs.promises.stat;
  let checkedDangling = false;
  if (process.platform === 'win32') {
    fs.promises.lstat = async (p, ...args) => {
      if (path.normalize(String(p)) === path.normalize(modDir)) {
        checkedDangling = true;
        return { isSymbolicLink: () => true };
      }
      return origLstat.call(fs.promises, p, ...args);
    };
    fs.promises.stat = async (p, ...args) => {
      if (path.normalize(String(p)) === path.normalize(modDir)) {
        const err = new Error('ENOENT dangling target');
        err.code = 'ENOENT';
        throw err;
      }
      return origStat.call(fs.promises, p, ...args);
    };
  } else {
    fs.symlinkSync(path.join(modDir, 'missing-target'), dangling);
    checkedDangling = true;
  }
  try {
    const result = await installMarketplacePlugin(NPM_ID, {
      runPlugin: async () => ({ ok: true, code: 0, log: '', needsAllowBuilds: false, allowBuilds: [] }),
    }).catch(() => null);
    assert.equal(checkedDangling, true);
    assert.notEqual(result, undefined);
  } finally {
    fs.promises.lstat = origLstat;
    fs.promises.stat = origStat;
  }
});
