'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  shouldShowRecovery,
  recoveryVerdict,
  desktopRuntimeDamageVerdict,
  sortPluginRows,
  pluginErrorLabel,
  disableableSuspectNames,
  startupRecoveryGuidance,
} = require('./launcher-recovery');

test('shouldShowRecovery covers sticky skip, last failure, suspects, and generic causes', () => {
  assert.equal(shouldShowRecovery(null, { skipUserPlugins: true }, null, null), true);
  assert.equal(shouldShowRecovery({ ok: false, error: 'boom' }, null, null, null), true);
  assert.equal(shouldShowRecovery(null, null, { genericCause: 'oom' }, null), true);
  assert.equal(shouldShowRecovery(null, null, { suspects: [{ name: 'evil' }] }, null), true);
  assert.equal(shouldShowRecovery(null, null, null, { state: 'error' }), true);
  assert.equal(shouldShowRecovery({ ok: null }, null, { plugins: [] }, { state: 'ready' }), false);
});

test('recoveryVerdict explains sticky skip and suspects', () => {
  assert.match(
    recoveryVerdict(null, { skipUserPlugins: true }, null),
    /跳过用户插件/,
  );
  assert.match(
    recoveryVerdict(null, null, { suspects: [{ name: 'evil-pack' }] }),
    /evil-pack/,
  );
  assert.match(
    recoveryVerdict({ ok: false, error: 'tree failed' }, null, null),
    /上次启动失败/,
  );
});

test('sortPluginRows prioritizes orphans and suspects', () => {
  const rows = sortPluginRows([
    { name: 'zeta', suspect: false },
    { name: 'alpha', suspect: true },
    { name: 'orphan', orphan: true, suspect: true },
  ]);
  assert.deepEqual(rows.map((row) => row.name), ['orphan', 'alpha', 'zeta']);
});

test('in-box runtime damage outranks sticky skip and blames no plugin', () => {
  const forensics = {
    desktopRuntimeDamage: true,
    orphanSuspects: [
      { name: '@deepseek-ai/dsh-client-ui-settings-market', inBox: true },
      { name: 'ghost-pack', inBox: false },
    ],
  };
  const verdict = recoveryVerdict(null, { skipUserPlugins: true }, forensics);
  assert.match(verdict, /内置组件损坏/);
  assert.match(verdict, /@deepseek-ai\/dsh-client-ui-settings-market/);
  assert.doesNotMatch(verdict, /ghost-pack/);
  assert.doesNotMatch(verdict, /恢复完整插件/);
  assert.match(verdict, /setup:harness/);
  assert.equal(desktopRuntimeDamageVerdict(forensics), verdict);

  const rows = sortPluginRows([
    { name: 'orphan', orphan: true, suspect: true },
    { name: '@deepseek-ai/dsh-client-ui-settings-market', orphan: true, suspect: true, inBox: true },
  ]);
  assert.equal(rows[0].name, '@deepseek-ai/dsh-client-ui-settings-market');
});

test('pluginErrorLabel maps known codes', () => {
  assert.equal(pluginErrorLabel('official-template'), '官方模板插件不可禁用。');
  assert.equal(pluginErrorLabel('unknown-code'), 'unknown-code');
});

test('session cache diagnosis outranks sticky skip without recommending plugin removal', () => {
  const verdict = recoveryVerdict(null, { skipUserPlugins: true }, { genericCause: 'session-cache' });
  assert.match(verdict, /会话缓存/);
  assert.match(verdict, /不要删除/);
  assert.doesNotMatch(verdict, /恢复完整插件/);
});

test('port-excluded diagnosis outranks sticky skip: a reserved port is not a plugin problem', () => {
  const verdict = recoveryVerdict(null, { skipUserPlugins: true }, { genericCause: 'port-excluded' });
  assert.match(verdict, /系统保留/);
  assert.match(verdict, /listen EACCES/);
  assert.doesNotMatch(verdict, /恢复完整插件/);
});

function failedPluginStatus(extra = {}) {
  return {
    lastStart: { ok: false, at: '2026-10-06T10:00:00Z' },
    desktop: { state: 'error' },
    forensics: { pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }] },
    ...extra,
  };
}

test('startup guidance names only installed disableable users and asks before changing them', () => {
  const status = failedPluginStatus();
  status.forensics.plugins.push(
    { name: 'healthy-user' },
    { name: 'disabled-user', suspect: true, disabled: true },
    { name: 'preset', suspect: true, preset: true },
    { name: 'official', suspect: true, officialTemplate: true },
    { name: 'missing', suspect: true, orphan: true },
    { name: 'builtin', suspect: true, inBox: true },
  );
  assert.deepEqual(disableableSuspectNames(status.forensics), ['dsh-tavern']);
  const guidance = startupRecoveryGuidance(status);
  assert.equal(guidance.kind, 'disable');
  assert.deepEqual(guidance.names, ['dsh-tavern']);
  assert.equal(guidance.confirmText, '禁用并启动鲸屿');
  assert.match(guidance.body, /不会卸载.*删除/);
});

test('automatic skip retains the targeted recommendation even after successful boot', () => {
  const status = failedPluginStatus({ lastStart: { ok: true }, desktop: { state: 'ready' }, recovery: { skipUserPlugins: true } });
  assert.equal(startupRecoveryGuidance(status).kind, 'disable');
  assert.match(recoveryVerdict(status.lastStart, status.recovery, status.forensics), /dsh-tavern.*禁用并启动鲸屿/);
  assert.equal(startupRecoveryGuidance({ ...status, recovery: { skipUserPlugins: false } }), null);
});

test('unknown plugin failures offer explicit skip, while generic and built-in failures never do', () => {
  const status = failedPluginStatus();
  status.forensics.plugins = [];
  const guidance = startupRecoveryGuidance(status);
  assert.equal(guidance.kind, 'skip');
  assert.deepEqual(guidance.names, []);
  assert.equal(startupRecoveryGuidance({ ...status, recovery: { skipUserPlugins: true } }), null);
  for (const genericCause of ['oom', 'port-excluded', 'port-in-use', 'missing-node', 'session-cache']) {
    const forensics = { ...failedPluginStatus().forensics, genericCause };
    assert.deepEqual(disableableSuspectNames(forensics), []);
    assert.equal(startupRecoveryGuidance({ ...status, forensics }), null);
  }
  assert.equal(startupRecoveryGuidance({ ...status, forensics: { ...status.forensics, desktopRuntimeDamage: true } }), null);
});
