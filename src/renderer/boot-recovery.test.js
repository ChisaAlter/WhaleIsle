'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skipStartingCopy,
  startupErrorLabel,
  retryActionLabel,
  downloadLogLabel,
  openLauncherLabel,
  showLauncherBridge,
  isImportantBootLog,
} = require('./boot-recovery');

test('skip starting copy matches the spec', () => {
  assert.deepEqual(skipStartingCopy(), {
    status: '正在以官方组合启动',
    hint: '第三方插件导致上次启动失败，已暂时跳过',
  });
});

test('recovery-fail label is 桌面端启动失败 and retry stays 重试', () => {
  assert.equal(startupErrorLabel(), '桌面端启动失败');
  assert.equal(retryActionLabel(false), '重试');
  assert.equal(retryActionLabel(true), '立即重启');
  assert.equal(downloadLogLabel(), '下载日志');
});

test('launcher bridge shows only on a settled startup failure', () => {
  assert.equal(openLauncherLabel(), '回启动器排查');
  assert.equal(showLauncherBridge('error'), true);
  // Starting / ready / stopping never show the bridge — plugin-level
  // recovery lives on the launcher Recovery Board, reached from failures.
  for (const state of ['idle', 'starting', 'ready', 'stopping']) {
    assert.equal(showLauncherBridge(state), false, state);
  }
  // An error is not settled while auto-recovery is in flight; once the
  // restart has run its course (monitoring / exhausted / cancelled) the
  // bridge comes back.
  assert.equal(showLauncherBridge('error', 'scheduled'), false);
  assert.equal(showLauncherBridge('error', 'restarting'), false);
  assert.equal(showLauncherBridge('error', 'monitoring'), true);
  assert.equal(showLauncherBridge('error', 'exhausted'), true);
  assert.equal(showLauncherBridge('error', 'cancelled'), true);
});

test('boot page error actions are transient-only plus the launcher bridge', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  const actions = html.slice(html.indexOf('id="actions"'), html.indexOf('</div>', html.indexOf('id="actions"')));
  assert.match(actions, /id="retry"/);
  assert.match(actions, /id="cancel-restart"/);
  assert.match(actions, /id="open-launcher"[^>]*hidden/);
  assert.match(actions, /id="save-log"/);
  // No plugin-level recovery controls on the boot page — the Recovery Board
  // owns attribution / per-plugin disable / skip.
  assert.doesNotMatch(actions, /disable|skip|forensic/i);
});

test('boot log filter keeps plugin-tree lines', () => {
  assert.equal(isImportantBootLog('plugin tree failed to load'), true);
  assert.equal(isImportantBootLog('cannot get property "tools" without inject'), true);
  assert.equal(isImportantBootLog('cannot resolve profile bundle "ghost"'), true);
  assert.equal(isImportantBootLog('listening on 127.0.0.1'), false);
});

test('boot.html keeps the scene clean and moves the full log into a drawer', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  // Bottom ticker: latest line + counter + the open affordance.
  assert.match(html, /id="ticker-inner"/);
  assert.match(html, /id="ticker-line"/);
  assert.match(html, /id="ticker-count"/);
  const drawer = html.indexOf('id="logdrawer"');
  assert.ok(drawer > 0, 'logdrawer exists');
  // The full log list lives inside the drawer only.
  assert.ok(html.indexOf('id="log"') > drawer, 'id="log" inside logdrawer');
  assert.ok(html.indexOf('id="log-close"') > drawer, 'id="log-close" inside logdrawer');
  // The core keeps brand + status + failure/actions; no log list — hints and
  // recovery copy ride the bottom ticker line instead of centre rows.
  const core = html.slice(html.indexOf('class="core"'), drawer);
  assert.match(core, /id="status"/);
  assert.match(core, /id="failure"/);
  assert.match(core, /id="actions"/);
  assert.doesNotMatch(core, /id="log"|id="ticker"/);
});

test('boot.js wires the log drawer toggle', () => {
  const js = fs.readFileSync(path.join(__dirname, 'boot.js'), 'utf8');
  for (const id of ['logdrawer', 'ticker-inner', 'ticker-line', 'ticker-count', 'log-count', 'log-close']) {
    assert.match(js, new RegExp(`getElementById\\('${id}'\\)`), id);
  }
  assert.match(js, /Escape/);
});

test('boot.html loads recovery and shared floating feedback before boot.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  const recovery = html.indexOf('src="boot-recovery.js"');
  const boot = html.indexOf('src="boot.js"');
  const feedback = html.indexOf('src="feedback.js"');
  assert.ok(recovery >= 0);
  assert.ok(boot > recovery);
  assert.ok(feedback > recovery && boot > feedback);
  assert.match(html, /href="feedback\.css"/);
});
