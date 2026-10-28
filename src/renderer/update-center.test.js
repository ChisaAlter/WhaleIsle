'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { describe, formatBytes, formatEta } = require('./update-center');

const MB = 1024 * 1024;
const base = {
  current: '0.3.12', route: 'cnb', autoDownload: true, platform: 'win32', checkedAt: 0,
  routes: [{ id: 'cnb', label: 'CNB' }, { id: 'github', label: 'GitHub' }],
  target: { version: '0.3.13', publishedAt: '2026-10-29T08:00:00Z', notesTabs: [] },
  plan: { method: 'full', downloadBytes: 329 * MB, fullBytes: 329 * MB },
  progress: null, error: null, explicit: true,
};
const ids = (actions) => actions.map((action) => action.id);

test('an available delta shows only its size; full download is a quiet link', () => {
  const view = describe({ ...base, phase: 'available', plan: { method: 'delta', downloadBytes: 21 * MB, fullBytes: 329 * MB } });
  assert.equal(view.headline, '新版本 v0.3.13');
  assert.match(view.subline, /需下载 21\.0 MB/);
  assert.doesNotMatch(JSON.stringify(view), /增量/);
  assert.deepEqual(view.actions.map((a) => [a.id, a.kind]), [['download', 'primary'], ['downloadFull', 'link']]);
  assert.equal(view.actions[1].label, '完整下载（329 MB）');
});

test('without a delta there is no alternative method at all', () => {
  const view = describe({ ...base, phase: 'available' });
  assert.deepEqual(ids(view.actions), ['download']);
  assert.match(view.subline, /需下载 329 MB/);
});

test('downloading shows bytes, speed, time left and the resume position', () => {
  const view = describe({ ...base, phase: 'downloading',
    progress: { received: 128 * MB, total: 329 * MB, bytesPerSecond: 4.5 * MB, etaSeconds: 45, resumedFrom: 120 * MB } });
  assert.equal(view.progress.percent, 38);
  assert.equal(view.progress.text, '128 MB / 329 MB · 4.5 MB/s · 剩余约 45 秒 · 从 120 MB 处继续');
  assert.deepEqual(ids(view.actions), ['pause', 'cancel']);
});

test('paused offers resume; ready offers install now or later', () => {
  const paused = describe({ ...base, phase: 'paused', progress: { received: 100 * MB, total: 329 * MB } });
  assert.equal(paused.progress.state, 'paused');
  assert.deepEqual(ids(paused.actions), ['resume', 'cancel']);
  const ready = describe({ ...base, phase: 'ready' });
  assert.equal(ready.headline, 'v0.3.13 已准备好');
  assert.deepEqual(ready.actions.map((a) => a.label), ['安装并重启', '稍后']);
  assert.equal(describe({ ...base, phase: 'ready', platform: 'darwin' }).actions[0].label, '打开安装映像');
});

test('a network failure explains itself and offers the other route and a resume', () => {
  const view = describe({ ...base, phase: 'error', progress: { received: 50 * MB, total: 329 * MB },
    error: { operation: 'download', message: '下载连接中断', network: true, suggestRoute: 'github', canResume: true } });
  assert.match(view.problem.text, /^下载未完成：下载连接中断。网络连接不稳定/);
  assert.deepEqual(view.problem.actions.map((a) => [a.id, a.arg, a.label]), [['setRoute', 'github', '改用 GitHub 线路']]);
  assert.deepEqual(view.actions.map((a) => a.label), ['继续下载']);
  assert.equal(view.progress.state, 'paused');
});

test('up to date shows the last check and the route', () => {
  const at = new Date(2026, 9, 29, 9, 5).getTime();
  const view = describe({ ...base, phase: 'current', target: null, plan: null, checkedAt: at });
  assert.equal(view.headline, '已是最新版本 v0.3.12');
  assert.equal(view.subline, '上次检查 09:05 · 线路 CNB');
  assert.deepEqual(ids(view.actions), ['check']);
});

test('formatting helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(20 * 1024), '20 KB');
  assert.equal(formatBytes(21.4 * MB), '21.4 MB');
  assert.equal(formatEta(30), '剩余约 30 秒');
  assert.equal(formatEta(125), '剩余约 3 分钟');
  assert.equal(formatEta(3700), '剩余约 1 小时 2 分钟');
});
