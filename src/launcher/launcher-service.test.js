'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const path = require('node:path');

test('status resolves plain forensics with one config/start snapshot and observes the next change', async () => {
  const filename = path.join(__dirname, 'launcher-service.js');
  let config = { downloadRoute: 'github', disabledPlugins: ['@sample/disabled'] };
  let lastStart = { ok: false, error: 'first error', logTail: [] };
  let configReads = 0;
  let startReads = 0;
  let releaseTail;
  const tailGate = new Promise((resolve) => { releaseTail = resolve; });
  const configIO = { loadConfig: () => { configReads += 1; return { ...config }; } };
  const scans = [];
  const scanResult = {
    sourceHome: 'C:/isolated-source', destHome: 'C:/isolated-dest', homeDir: 'C:/isolated-home',
    destEmpty: true, sourceHasData: false, sessions: [], plugins: [], skills: [], mcp: [],
    settings: [], presets: [], skillRoots: [], extraSkillDirs: [], hasAttachments: false,
  };
  const mocks = {
    electron: { app: {}, dialog: {} },
    '../main/window': {},
    '../main/update': { currentVersion: () => '1.0.0' },
    '../main/data-import': { scanImportAsync: async (options) => { scans.push(options); return scanResult; } },
    '../main/marketplace-install': {},
    '../main/plugins': { listInstalledPlugins: () => ({ plugins: [], bundles: [] }), OFFICIAL_TEMPLATE_BUNDLES: new Set() },
    '../main/profile-ops': {},
    '../main/task-protection': {},
    '../main/plugin-forensics': { inspectPlugins: async (input) => {
      await tailGate;
      return { ...input, recovery: input.recovery, summary: { error: input.lastStartError } };
    } },
    '../main/plugin-tree-failure': { isPluginTreeFailure: () => false },
    '../main/launcher-gate': {
      readLastDesktopStart: () => { startReads += 1; return { ...lastStart }; },
      peekParkedUpdateCheck: () => null,
    },
    '../main/config': configIO,
    './release-source': { listRoutes: () => [] },
    './runtime-install': {
      installedInfo: () => null,
      configuredRoute: (deps) => (deps.loadConfig || configIO.loadConfig)().downloadRoute,
    },
    './forensics-log': { bootLogPath: () => 'unused', readBootLogTailAsync: async () => assert.fail('full desktop must use current-start evidence') },
    './product': { isLauncherPackage: () => false, desktopStateDir: () => __dirname },
    '../main/import-guard': {},
  };
  const realLoad = Module._load;
  const cached = require.cache[filename];
  let createLauncherService;
  try {
    Module._load = function(id, parent, isMain) {
      if (parent?.filename === filename && Object.hasOwn(mocks, id)) return mocks[id];
      return realLoad.call(this, id, parent, isMain);
    };
    delete require.cache[filename];
    ({ createLauncherService } = require(filename));
  } finally {
    Module._load = realLoad;
    if (cached) require.cache[filename] = cached;
    else delete require.cache[filename];
  }
  const service = createLauncherService({
    dsh: { logs: ['historical crash line'], currentStartLogs: () => ['latest crash line'], snapshot: () => ({ state: 'ready' }) },
    configPayload: (value) => value,
    taskProtection: {},
    statusContributors: [() => ({ components: [{ id: 'sample', state: 'running' }] })],
  });
  const pending = service.status();
  config = { ...config, downloadRoute: 'cnb' };
  lastStart = { ...lastStart, error: 'second error' };
  releaseTail();
  const first = await pending;
  assert.equal(first.config.downloadRoute, 'github');
  assert.equal(first.downloadRoute, 'github');
  assert.equal(first.lastStart.error, 'first error');
  assert.equal(first.forensics.lastStartError, 'first error');
  assert.ok(first.forensics.logs.includes('latest crash line'));
  assert.ok(!first.forensics.logs.includes('historical crash line'));
  assert.equal(first.components[0].state, 'running');
  assert.deepEqual(JSON.parse(JSON.stringify(first)).forensics, first.forensics);
  assert.equal(configReads, 1);
  assert.equal(startReads, 1);
  const second = await service.status();
  assert.equal(second.downloadRoute, 'cnb');
  assert.equal(second.forensics.lastStartError, 'second error');
  assert.equal(configReads, 2);
  assert.equal(startReads, 2);
  assert.equal(await service.scanImport('C:/isolated-source'), scanResult);
  assert.equal(await service.scanImport({ sourceHome: 'C:/other-source', extraSkillDirs: ['C:/skills'] }), scanResult);
  assert.deepEqual(scans, [{ sourceHome: 'C:/isolated-source' }, {
    sourceHome: 'C:/other-source', extraSkillDirs: ['C:/skills'],
  }]);
});
