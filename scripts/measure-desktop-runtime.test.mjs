import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, summary, measurementEnv } from './measure-desktop-runtime.mjs';

const report = { ok: true, platform: 'linux', arch: 'x64', startupMs: 30000, restartMs: 1000,
  mainThreadLagMs: 201, peakWorkingSetMiB: 512 };

test('runtime budgets preserve the boundary and flag the observed excess', () => {
  const rows = assess(report);
  assert.equal(rows.find(row => row.metric === 'startupMs').exceeded, false);
  assert.equal(rows.find(row => row.metric === 'mainThreadLagMs').exceeded, true);
  assert.match(summary(report, rows), /OVER BUDGET/);
});

test('missing, negative and nonfinite measurements cannot look healthy', () => {
  for (const value of [undefined, -1, NaN, Infinity]) assert.throws(() => assess({ ...report, restartMs: value }));
  assert.throws(() => assess({ ...report, ok: false, error: 'restart refused' }), /restart refused/);
});

test('trend deltas compare only successful same-platform reports', () => {
  const previous = { ...report, startupMs: 29000 };
  assert.equal(assess(report, undefined, previous)[0].delta, 1000);
  for (const prior of [{ ...previous, platform: 'darwin' }, { ...previous, arch: 'arm64' }, { ...previous, ok: false }]) {
    assert.equal(assess(report, undefined, prior)[0].delta, null);
  }
});

test('ambient smoke and Node-mode flags cannot run another driver or disable Electron', () => {
  const base = { ELECTRON_RUN_AS_NODE: '1', DSH_SMOKE: '1', DSH_QA_SHELL: '1', DSH_REMOTE_PHONE_HOST: '1', DISPLAY: ':99' };
  assert.deepEqual(measurementEnv(base), { DISPLAY: ':99' });
  assert.equal(base.DSH_SMOKE, '1');
});
