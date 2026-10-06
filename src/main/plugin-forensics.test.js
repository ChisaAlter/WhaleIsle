'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  classifyGenericFailure,
  extractSuspectNames,
  extractEvidence,
  buildForensicsSummary,
  inspectPlugins,
  isPresetPlugin,
  isInBoxPackageName,
} = require('./plugin-forensics');

test('extractSuspectNames reads bundle, package, and compose failures', () => {
  const text = [
    'cannot resolve profile bundle "evil-pack"',
    "Cannot find package 'missing-mod'",
    'ERR_MODULE_NOT_FOUND: Cannot find package "@acme/broken"',
    'failed to compose client package "@acme/compose"',
  ].join('\n');
  assert.deepEqual(extractSuspectNames(text).sort(), [
    '@acme/broken',
    '@acme/compose',
    'evil-pack',
    'missing-mod',
  ]);
});

test('generic crashes are not blamed on a plugin', () => {
  assert.equal(classifyGenericFailure('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'), 'oom');
  assert.equal(classifyGenericFailure('listen EADDRINUSE: address already in use 127.0.0.1:3080'), 'port-in-use');
  assert.equal(classifyGenericFailure("'node' is not recognized as an internal or external command"), 'missing-node');
  const inspected = inspectPlugins({
    logs: 'heap out of memory\ncannot resolve profile bundle "evil-pack"',
    plugins: [{ name: 'evil-pack', spec: '1.0.0' }],
    bundles: ['evil-pack'],
  });
  assert.equal(inspected.genericCause, 'oom');
  assert.deepEqual(inspected.suspects, []);
  assert.equal(inspected.plugins[0].suspect, false);
});

test('listen EACCES（Windows 保留端口）归因为 port-excluded，不指向插件', () => {
  assert.equal(classifyGenericFailure('Error: listen EACCES: permission denied 127.0.0.1:3080'), 'port-excluded');
  const inspected = inspectPlugins({
    logs: [
      'dsh web --host 127.0.0.1 --port 3080',
      'Error: listen EACCES: permission denied 127.0.0.1:3080',
      'cannot resolve profile bundle "evil-pack"',
    ].join('\n'),
    plugins: [{ name: 'evil-pack', spec: '1.0.0' }],
    bundles: ['evil-pack'],
  });
  assert.equal(inspected.genericCause, 'port-excluded');
  assert.deepEqual(inspected.suspects, [], '端口保留时不得把插件列为嫌疑');
  assert.equal(inspected.plugins[0].suspect, false);
});

test('loader application failures identify the leaf plugin rather than the include wrapper', () => {
  const logs = 'failed to apply loader entry include (cordis:include): failed to apply loader entry stats (@acme/stats): invalid stored record';
  assert.deepEqual(extractSuspectNames(logs), ['@acme/stats']);
  const result = inspectPlugins({ logs, plugins: [{ name: '@acme/stats' }] });
  assert.equal(result.plugins[0].suspect, true);
  assert.equal(result.evidence[0].name, '@acme/stats');
});

test('legacy session cache schema failures are not attributed to user plugins', () => {
  const logs = "failed to apply loader entry session-projection-cache (@deepseek-ai/dsh-session-projection-cache): domain 'session_projcache': stored record 'old' in table 'sessions' does not match its schema";
  const result = inspectPlugins({ logs, pluginTreeFailure: true, plugins: [{ name: '@acme/stats' }] });
  assert.equal(result.genericCause, 'session-cache');
  assert.equal(result.desktopRuntimeDamage, false);
  assert.deepEqual(result.suspects, []);
  assert.equal(result.plugins[0].suspect, false);
  assert.equal(classifyGenericFailure("domain 'other': stored record 'old' does not match its schema"), '');
});

test('a broken built-in dshbot mount is desktop runtime damage once absent from the profile', () => {
  const logs = "failed to apply loader entry include (cordis:include): failed to import loader entry dsh-bot (dshbot): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'";
  assert.deepEqual(extractSuspectNames(logs), ['dshbot']);
  // Row still listed: suspect + preset (removal blocked; disable is blocked
  // separately via IPC and config alias-stripping) — not yet damage.
  const listed = inspectPlugins({ logs, pluginTreeFailure: true, plugins: [{ name: 'dshbot' }, { name: 'other-plugin' }], bundles: ['dshbot', 'other-plugin'] });
  assert.equal(listed.desktopRuntimeDamage, false);
  assert.equal(listed.plugins.find(row => row.name === 'dshbot').suspect, true);
  assert.equal(listed.plugins.find(row => row.name === 'dshbot').preset, true);
  assert.equal(listed.plugins.find(row => row.name === 'other-plugin').suspect, false);
  // Absent from the profile: orphan in-box suspect → desktop damage, and
  // the verdict outranks the sticky-skip banner.
  const orphan = inspectPlugins({ logs, pluginTreeFailure: true, plugins: [{ name: 'other-plugin' }], bundles: ['other-plugin'] });
  assert.equal(orphan.desktopRuntimeDamage, true);
  assert.equal(orphan.orphanSuspects.find(row => row.name === 'dshbot').inBox, true);
  assert.equal(isPresetPlugin('dshbot'), true);
});

test('inspectPlugins flags suspects and presets without deleting the latter', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "evil-pack"',
    plugins: [
      { name: 'dsh-usage-panel', spec: 'file:vendor' },
      { name: 'evil-pack', spec: '1.0.0' },
    ],
    bundles: ['dsh-usage-panel', 'evil-pack'],
    disabledPlugins: ['evil-pack'],
  });
  assert.equal(inspected.plugins.find((row) => row.name === 'dsh-usage-panel').preset, true);
  assert.equal(inspected.plugins.find((row) => row.name === 'evil-pack').suspect, true);
  assert.equal(inspected.plugins.find((row) => row.name === 'evil-pack').disabled, true);
  assert.equal(isPresetPlugin('dsh-usage-panel'), true);
  // dshbot is a desktop built-in again — preset marker blocks removal and
  // in-box flags its orphans as desktop runtime damage.
  assert.equal(isPresetPlugin('dshbot'), true);
  // The marketplace is desktop-owned code, not a mounted preset plugin.
  assert.equal(isPresetPlugin('dshmarket'), false);
  assert.equal(isPresetPlugin('evil-pack'), false);
});

test('inspectPlugins surfaces orphan suspects, evidence, and summary', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "ghost-pack"',
    lastStartError: 'failed to compose client package "@acme/broken"',
    pluginTreeFailure: true,
    recovery: { skipUserPlugins: true, reason: 'test', at: '2026-01-01', appVersion: '1.0.0' },
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.orphanSuspects.length, 2);
  assert.ok(inspected.evidence.length >= 2);
  assert.equal(inspected.recovery.skipUserPlugins, true);
  assert.equal(inspected.pluginTreeFailure, true);
  assert.equal(inspected.summary.suspectCount, 4);
  assert.equal(inspected.summary.hasOrphans, true);
  assert.deepEqual(buildForensicsSummary(inspected).suspectCount, 4);
});

test('in-box fork package suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('@deepseek-ai/dsh-client-ui-settings-market'), true);
  assert.equal(isInBoxPackageName('@deepseek-ai/dsh-client-ui-settings-market/client'), true);
  assert.equal(isInBoxPackageName('@acme/unrelated'), false);

  const inspected = inspectPlugins({
    logs: "Cannot find package '@deepseek-ai/dsh-client-ui-settings-market' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  assert.equal(inspected.summary.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find(
    (item) => item.name === '@deepseek-ai/dsh-client-ui-settings-market',
  );
  assert.equal(row.inBox, true);
  assert.equal(row.orphan, true);
});

test('desktop built-in dsh-im suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('@xmanrui/dsh-im'), true);
  assert.equal(isInBoxPackageName('@xmanrui/dsh-im/client'), true);
  assert.equal(isInBoxPackageName('dsh-im'), true);

  const inspected = inspectPlugins({
    logs: "Cannot find package '@xmanrui/dsh-im' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find((item) => item.name === '@xmanrui/dsh-im');
  assert.equal(row.inBox, true);
});

test('desktop built-in usage-panel suspects are flagged as desktop runtime damage', () => {
  assert.equal(isInBoxPackageName('dsh-usage-panel'), true);
  assert.equal(isInBoxPackageName('dsh-usage-panel/client'), true);

  const inspected = inspectPlugins({
    logs: "Cannot find package 'dsh-usage-panel' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find((item) => item.name === 'dsh-usage-panel');
  assert.equal(row.inBox, true);
  assert.equal(row.preset, true);
});

test('desktop built-in remote-workspace suspects are reserved and flagged as runtime damage', () => {
  assert.equal(isPresetPlugin('dsh-remote'), true);
  assert.equal(isInBoxPackageName('dsh-remote'), true);
  assert.equal(isInBoxPackageName('dsh-remote/client'), true);

  const inspected = inspectPlugins({
    logs: "Cannot find package 'dsh-remote' imported from /profiles/web/",
    pluginTreeFailure: true,
    plugins: [{ name: 'good', spec: '1.0.0' }],
    bundles: ['good'],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  const row = inspected.orphanSuspects.find((item) => item.name === 'dsh-remote');
  assert.equal(row.inBox, true);
  assert.equal(row.preset, true);
});

test('desktop install overlay path suspects are flagged as desktop runtime damage', () => {
  assert.equal(
    isInBoxPackageName('file:///dsh-home/profiles/web/desktop-plugins/install-dsh-plugin/install-dsh-plugin.mjs'),
    true,
  );
  assert.equal(
    isInBoxPackageName('C:\\dsh-home\\profiles\\web\\desktop-plugins\\install-dsh-plugin\\install-dsh-plugin.mjs'),
    true,
  );
  assert.equal(isInBoxPackageName('install-dsh-plugin'), false);
});

test('a profile plugin shadowing an in-box name stays a disableable suspect', () => {
  const inspected = inspectPlugins({
    logs: "Cannot find package '@deepseek-ai/dsh-client-ui-settings-market'",
    plugins: [{ name: '@deepseek-ai/dsh-client-ui-settings-market', spec: '1.0.0' }],
    bundles: [],
  });
  assert.equal(inspected.desktopRuntimeDamage, false);
  assert.equal(inspected.summary.desktopRuntimeDamage, false);
  assert.equal(inspected.orphanSuspects.length, 0);
  assert.equal(inspected.plugins[0].suspect, true);
  assert.equal(inspected.plugins[0].inBox, undefined);
});

test('non in-box orphans do not raise the runtime damage flag', () => {
  const inspected = inspectPlugins({
    logs: 'cannot resolve profile bundle "ghost-pack"',
    plugins: [],
    bundles: [],
  });
  assert.equal(inspected.desktopRuntimeDamage, false);
  assert.equal(inspected.orphanSuspects[0].inBox, false);
});

test('the screenshot single-entry web boot audit identifies dsh-tavern and preserves its evidence', () => {
  const line = 'dsh-tavern: import failed (see console for the import error)';
  const lastStartError = ['Web UI failed to load: web boot: 1 entry did not activate', line, 'dsh-tavern'].join('\n');
  assert.deepEqual(extractSuspectNames(lastStartError), ['dsh-tavern']);
  assert.deepEqual(extractEvidence(lastStartError), [{ name: 'dsh-tavern', line }]);
  const inspected = inspectPlugins({
    lastStartError,
    pluginTreeFailure: true,
    plugins: [{ name: 'dsh-tavern', spec: '1.0.0' }, { name: 'healthy-plugin' }],
    bundles: ['dsh-tavern', 'healthy-plugin'],
  });
  assert.deepEqual(inspected.suspects, [{ name: 'dsh-tavern' }]);
  assert.deepEqual(inspected.evidence, [{ name: 'dsh-tavern', line }]);
  assert.equal(inspected.plugins[0].suspect, true);
  assert.equal(inspected.plugins[1].suspect, false);
  assert.equal(inspected.desktopRuntimeDamage, false);
  assert.deepEqual(inspected.orphanSuspects, []);
});

test('web boot audits extract recorded imports, pending service dependencies, and non-active states', () => {
  const lines = [
    '[dsh] broken-import: import failed: client-modules: bundle script /plugins/broken-import failed to load',
    '[dsh] single-service: pending (waiting for service: missing)',
    '[dsh] multiple-services: pending (waiting for services: first, second)',
    '[dsh] broken-apply: failed',
    '[dsh] disposed-plugin: disposed',
    '[dsh] loading-plugin: loading',
    '[dsh] unloading-plugin: unloading',
  ];
  const names = ['broken-import', 'single-service', 'multiple-services', 'broken-apply', 'disposed-plugin', 'loading-plugin', 'unloading-plugin'];
  const corpus = ['[dsh] web boot: 7 entries did not activate', ...lines].join('\n');
  assert.deepEqual(extractSuspectNames(corpus), names);
  assert.deepEqual(extractEvidence(corpus), names.map((name, index) => ({ name, line: lines[index] })));
});

test('ordinary plugin status logs and rows outside a web boot audit are not suspects', () => {
  const states = [
    'plain-import: import failed (see console for the import error)',
    'plain-pending: pending (waiting for service: missing)',
    'plain-failed: failed',
    'plain-disposed: disposed',
    'plain-loading: loading',
    'plain-unloading: unloading',
  ];
  assert.deepEqual(extractEvidence(states.join('\n')), []);
  assert.deepEqual(extractSuspectNames([
    'web boot: 1 entry did not activate',
    'real-failure: failed',
    ...states,
  ].join('\n')), ['real-failure']);
  assert.deepEqual(extractSuspectNames([
    'web boot: 2 entries did not activate',
    'real-failure: failed',
    '[app] healthy-plugin activated',
    'plain-failed: failed',
  ].join('\n')), ['real-failure']);
});

test('client subpath evidence maps to installed scoped and unscoped profile package roots', () => {
  const lines = ['dsh-tavern/client: failed', '@acme/widget/client: disposed', 'dsh-tavern: failed'];
  const inspected = inspectPlugins({
    lastStartError: ['web boot: 3 entries did not activate', ...lines].join('\n'),
    plugins: [{ name: 'dsh-tavern' }, { name: '@acme/widget' }],
    bundles: ['dsh-tavern', '@acme/widget'],
    disabledPlugins: ['@acme/widget'],
  });
  assert.deepEqual(inspected.suspects, [{ name: 'dsh-tavern' }, { name: '@acme/widget' }]);
  assert.deepEqual(inspected.orphanSuspects, []);
  assert.equal(inspected.plugins[0].suspect, true);
  assert.equal(inspected.plugins[1].suspect, true);
  assert.equal(inspected.plugins[1].disabled, true);
  assert.deepEqual(inspected.evidence, [
    { name: 'dsh-tavern', line: lines[0] },
    { name: '@acme/widget', line: lines[1] },
    { name: 'dsh-tavern', line: lines[2] },
  ]);
});

test('recovery reasons retain plugin attribution even without a current failed last-start marker', () => {
  const reason = 'web boot: 1 entry did not activate\ndsh-tavern: import failed (see console for the import error)';
  for (const skipUserPlugins of [true, false]) {
    const inspected = inspectPlugins({
      logs: ['[app] Web UI ready'],
      lastStartError: '',
      recovery: { skipUserPlugins, reason },
      plugins: [{ name: 'dsh-tavern' }],
    });
    assert.deepEqual(inspected.suspects, [{ name: 'dsh-tavern' }]);
    assert.equal(inspected.plugins[0].suspect, true);
    assert.equal(inspected.recovery.reason, reason);
    assert.deepEqual(inspected.evidence, [{
      name: 'dsh-tavern',
      line: 'dsh-tavern: import failed (see console for the import error)',
    }]);
  }
});

test('web boot client failures keep built-in, preset, and official template protections', () => {
  const builtIn = '@deepseek-ai/dsh-client-ui-settings-market/client';
  const inspected = inspectPlugins({
    lastStartError: [
      'web boot: 3 entries did not activate',
      `${builtIn}: failed`,
      'dshbot/client: failed',
      '@deepseek-ai/dsh-web-app/client: disposed',
    ].join('\n'),
    plugins: [{ name: 'dshbot' }, { name: '@deepseek-ai/dsh-web-app' }],
  });
  assert.equal(inspected.desktopRuntimeDamage, true);
  assert.equal(inspected.orphanSuspects[0].name, builtIn);
  assert.equal(inspected.orphanSuspects[0].inBox, true);
  assert.equal(inspected.plugins[0].suspect, true);
  assert.equal(inspected.plugins[0].preset, true);
  assert.equal(inspected.plugins[1].suspect, true);
  assert.equal(inspected.plugins[1].officialTemplate, true);
});

test('generic failure evidence still suppresses plugin blame from web boot audits', () => {
  const lastStartError = 'web boot: 1 entry did not activate\ndsh-tavern: failed';
  for (const [reason, cause] of [
    ['heap out of memory', 'oom'],
    ['listen EACCES: permission denied 127.0.0.1:3080', 'port-excluded'],
    ['listen EADDRINUSE: address already in use', 'port-in-use'],
  ]) {
    const inspected = inspectPlugins({
      lastStartError,
      recovery: { reason },
      plugins: [{ name: 'dsh-tavern' }],
    });
    assert.equal(inspected.genericCause, cause);
    assert.deepEqual(inspected.suspects, []);
    assert.equal(inspected.plugins[0].suspect, false);
    assert.equal(inspected.desktopRuntimeDamage, false);
  }
});
