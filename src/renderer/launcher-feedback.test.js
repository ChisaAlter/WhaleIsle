'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = [process.env.ELECTRON_PATH, path.join(__dirname, '../../node_modules/electron/dist/electron.exe'), path.join(__dirname, '../../node_modules/electron/dist/electron')].find(file => file && fs.existsSync(file));

async function runFixture(bootOnly = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'launcher-feedback.child.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, DSHD_FEEDBACK_BOOT_ONLY: bootOnly ? '1' : '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('feedback fixture timeout')); }, 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find(text => text.startsWith('FEEDBACK_RESULT:'));
      if (code !== 0 || !line) return reject(new Error(`feedback fixture ${code}: ${stderr}\n${stdout}`));
      try { resolve(JSON.parse(line.slice('FEEDBACK_RESULT:'.length))); } catch (error) { reject(error); }
    });
  });
}

test('real Electron: floating results preserve layout, safe confirmation and task cancellation', { skip: !electron }, async () => {
  const result = await runFixture();
  assert.equal(result.checkCalls, result.cases.length, 'both entry points share one pending request');
  for (const item of result.cases) {
    assert.equal(item.pending.modalHidden, true, 'query loads inside existing buttons');
    assert.equal(item.pending.button.busy, 'true');
    assert.equal(item.pending.versionsBusy, 'true');
    assert.equal(item.pending.button.disabled, true);
    assert.equal(item.pending.button.spinner, true, 'the button carries its own spinner');
    assert.equal(item.pending.button.scrolling, false, 'labels that fit stay still');
    assert.equal(item.overflow.scrolling, true, 'overflow scrolls in both themes and window sizes');
    assert.equal(item.overflow.animation, 'shell-button-scroll');
    assert.equal(item.overflow.color, item.pending.button.expectedColor);
    assert.equal(item.overflow.width, item.before.button.width);
    assert.equal(item.overflow.height, item.before.button.height);
    assert.equal(item.pending.button.labelColor, item.pending.button.expectedColor, 'pending text uses the current theme foreground');
    assert.equal(item.pending.button.spinnerColor, item.pending.button.expectedColor, 'the spinner uses the current theme foreground');
    assert.equal(item.current.button.labelColor, item.current.button.expectedColor, 'completion text stays visible after the busy overlay');
    assert.match(item.pending.button.text, /^检查(中…?)?$/, 'the button names its pending step');
    assert.equal(item.pending.button.width, item.before.button.width, 'loading keeps the button width');
    assert.equal(item.pending.button.height, item.before.button.height);
    assert.equal(item.current.homeTop, item.before.homeTop);
    assert.equal(item.current.extraLines, 0);
    assert.equal(item.current.centered, true);
    assert.equal(item.current.floating, true);
    assert.equal(item.current.modalHidden, true, 'operation results do not take over confirmation');
    assert.equal(item.current.toastCount, 0, 'an up-to-date result answers on the button');
    assert.equal(item.current.button.text, '已是最新');
    assert.equal(item.current.versionsText, '已是最新');
    assert.equal(item.current.cancelVisible, false);
    assert.equal(item.current.okVisible, false);
    assert.equal(item.current.button.disabled, false);
    assert.equal(item.current.focus, 'btn-check-update', 'results do not steal focus');
    assert.equal(item.dismissed.toastCount, 0, 'passive refresh does not repeat the result');
    assert.equal(item.dismissed.focus, 'btn-check-update');
  }
  const outcome = status => result.outcomes.find(item => item.status === status);
  assert.equal(outcome('none').versionsText, '暂无更新');
  assert.equal(outcome('none').toastCount, 0);
  assert.match(outcome('error').body, /^更新检查失败：/);
  assert.match(outcome('error').body, /超时/);
  assert.equal(outcome('error').role, 'alert');
  assert.equal(outcome('error').noticeCloseControls, 0, 'transient notices have no close control');
  assert.equal(outcome('available').toastCount, 0, 'one actionable update pane supplies the result');
  assert.match(outcome('available').updateText, /0\.3\.4/);
  assert.equal(outcome('available').updateVisible, true);
  assert.match(outcome('invalid').body, /^更新检查未完成：/);
  assert.deepEqual(result.confirmSafe, { title: '确认删除', focus: 'app-confirm-cancel' });
  assert.equal(result.confirmRetry, 'shell-feedback-action');
  assert.equal(result.retryCalls, 1);
  assert.deepEqual(result.confirmAfterToastEscape, { title: '确认删除', hidden: false, answer: null, toasts: 0 });
  assert.equal(result.confirmAnswer, false);
  assert.deepEqual(result.pluginFailure, { disabled: false, busy: null, body: 'fixture scan failed' });
  assert.equal(result.scan.scanText, '扫描完成');
  assert.equal(result.scan.toastCount, 0, 'the lists show what a scan found');
  assert.equal(result.scan.extraLines, 0);
  assert.match(result.settings.body, /fixture settings save failed/);
  assert.ok(result.installTabTargets.includes('btn-install-cancel'), 'confirmation does not trap a parallel task cancellation');
  assert.ok(result.installTabTargets.some(target => target.includes('shell-feedback-close')), 'pending task panel keeps its own hide control');
  assert.equal(result.installCancelCalls, 1);
  assert.equal(result.installSummaryPending, true);
  for (const terminal of [result.installTerminal, result.importTerminal]) {
    assert.equal(terminal.summaryVisible, true, 'pending dismissal retains terminal review entry');
    assert.equal(terminal.busy, 'false');
    assert.equal(terminal.cancelHidden, true);
    assert.equal(terminal.restored, true);
  }
  assert.match(result.installTerminal.failure, /fixture install failure/);
  assert.match(result.importTerminal.failure, /未完成的导入事务/);
  assert.match(result.importRefused.feedback, /取消被拒绝：.*fixture cancellation refused/);
  assert.equal(result.importRefused.toastCount, 0, 'the visible import pane carries the refusal');
  assert.equal(result.importRefused.retryable, true);
  assert.equal(result.importRefused.buttonBusy, 'true', 'a cancellation refusal does not finish the import');
  assert.equal(result.importCalls.length, 1);
  assert.deepEqual(result.importCancelCalls, result.importCalls, 'cancel names its actual operation');
  assert.equal(result.boot.floatingFailure, true);
  assert.deepEqual(result.boot.longFailure, result.boot.before, 'long failure copy leaves the boot brand in place');
  assert.deepEqual(result.boot.afterSave, result.boot.before, 'log-save feedback leaves the boot scene in place');
  assert.match(result.boot.saved.text, /^日志已保存：C:\\fixture\\boot\.log$/);
  assert.doesNotMatch(result.boot.saved.ticker, /日志已保存/);
  assert.equal(result.boot.saved.logCount, 1, 'operation feedback does not alter business logs');
  assert.deepEqual(result.errors, []);
  assert.equal(result.recoveryPrompt.title, '插件加载失败');
  assert.match(result.recoveryPrompt.body, /dsh-tavern/);
  assert.equal(result.recoveryPrompt.focus, 'app-confirm-cancel');
  assert.equal(result.recoveryPrompt.centered, true);
  assert.equal(result.recoveryCancelled.calls, 0, 'cancel changes no plugins');
  assert.equal(result.recoveryCancelled.modalHidden, true, 'same failure refresh does not nag');
  assert.equal(result.recoveryCancelled.guidanceVisible, true, 'recovery remains reachable after cancellation');
  assert.equal(result.recoveryCancelled.lastStartAt, 'skip-completed-1');
  assert.equal(result.recoveryCancelled.recoveryAt, 'original-failure-1', 'a successful skip start is not a new plugin failure');
  assert.equal(result.recoveryPending.calls, 1, 'double clicks do not duplicate recovery');
  assert.deepEqual(result.recoveryPending.names, ['dsh-tavern']);
  assert.equal(result.recoveryPending.controlsDisabled, true);
  assert.equal(result.recoveryPending.cancelVisible || result.recoveryPending.okVisible, false);
  assert.equal(result.recoverySuccess.title, '已禁用并启动鲸屿');
  assert.equal(result.recoverySuccess.guidanceVisible, false);
  assert.equal(result.recoveryStickyRefresh.lastStartAt, 'skip-completed-2');
  assert.equal(result.recoveryStickyRefresh.recoveryAt, 'original-failure-2');
  assert.equal(result.recoveryStickyRefresh.title, '插件加载失败');
  assert.equal(result.recoveryStickyRefresh.modalHidden, false);
  assert.equal(result.recoveryStickyRefresh.calls, 1, 'a status refresh cannot commit a plugin recovery');
  assert.equal(result.recoveryStickyConfirmed.calls, result.recoveryStickyConfirmed.callsBefore + 1, 'confirming the same failed attempt after skip succeeds is not obsolete');
  assert.deepEqual(result.recoveryStickyConfirmed.names, ['dsh-tavern']);
  assert.match(result.recoveryStillSkipped.body, /仍以跳过用户插件模式启动/);
  assert.equal(result.recoveryStillSkipped.title, '插件已禁用，仍需排查', 'the operation result remains authoritative when status refresh fails');
  assert.match(result.statusReadFailure.body, /暂时无法读取桌面状态/);
  assert.equal(result.nonPluginFailure.modalHidden, true);
  assert.equal(result.nonPluginFailure.guidanceVisible, false, 'port failures never suggest disabling plugins');
  assert.equal(result.stopFailure.toastCount, 1, 'a failed close raises one floating result');
  assert.doesNotMatch(result.stopFailure.status, /busy|桌面端正在处理任务/, 'the status line stays short');
  assert.equal(result.stopFailure.verdict, '桌面端正在处理任务，请稍后重试。', 'diagnostics show the translated reason, not the code');
});

test('real Electron: boot controls keep async feedback in place and preserve cancellation', { skip: !electron }, async () => {
  const { boot } = await runFixture(true);
  for (const action of [boot.saveCancelled, boot.saveFailed, boot.cancelFailed, boot.cancelSucceeded, boot.openFailed, boot.openSucceeded]) {
    assert.equal(action.calls, 1, 'two gestures only dispatch one IPC call');
    assert.equal(action.pending.busy, 'true');
    assert.equal(action.pending.disabled, true);
    assert.equal(action.pending.width, action.before.width, 'loading keeps the button width');
    assert.equal(action.pending.height, action.before.height);
    assert.match(action.pending.text, /^(保存|取消|打开)(中…?)?$/, 'the button names its pending step');
    assert.equal(action.after.text, action.before.text, 'the caption returns afterwards');
    assert.deepEqual(action.geometry, boot.before);
    assert.deepEqual(action.afterGeometry, boot.before);
    assert.equal(action.after.busy, null);
  }
  assert.equal(boot.saveCancelled.after.disabled, false);
  assert.equal(boot.saveCancelled.toasts, 0, 'SaveDialog cancellation cannot claim a successful save');
  for (const action of [boot.saveFailed, boot.cancelFailed, boot.openFailed]) assert.equal(action.after.disabled, false, 'failed operations allow the original retry');
  assert.match(boot.saveFailed.toast, /保存日志失败：.*fixture save disconnected/);
  assert.match(boot.cancelFailed.toast, /取消失败：.*fixture cancellation disconnected/);
  assert.match(boot.openFailed.toast, /打开启动器失败：.*fixture launcher unavailable/);
  assert.equal(boot.cancelSucceeded.after.hidden, true, 'accepted cancellation ends the scheduled recovery');
  assert.equal(boot.openSucceeded.after.disabled, false);
  assert.equal(boot.openSucceeded.toasts, 0);
});
