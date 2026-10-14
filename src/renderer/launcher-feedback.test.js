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
    assert.equal(item.pending.button.color, 'rgba(0, 0, 0, 0)');
    assert.equal(item.pending.button.spinner, '""');
    assert.deepEqual([item.pending.button.width, item.pending.button.height, item.pending.button.text], [item.before.button.width, item.before.button.height, item.before.button.text]);
    assert.equal(item.current.homeTop, item.before.homeTop);
    assert.equal(item.current.extraLines, 0);
    assert.equal(item.current.centered, true);
    assert.equal(item.current.floating, true);
    assert.equal(item.current.modalHidden, true, 'operation results do not take over confirmation');
    assert.match(item.current.body, /^已是最新版本：.*0\.3\.3/);
    assert.equal(item.current.cancelVisible, false);
    assert.equal(item.current.okVisible, false);
    assert.equal(item.current.button.disabled, false);
    assert.equal(item.current.focus, 'btn-check-update', 'results do not steal focus');
    assert.equal(item.dismissed.toastCount, 0, 'passive refresh does not repeat the result');
    assert.equal(item.dismissed.focus, 'btn-check-update');
  }
  const outcome = status => result.outcomes.find(item => item.status === status);
  assert.match(outcome('none').body, /^暂无可用更新：/);
  assert.doesNotMatch(outcome('none').body, /最新版本/);
  assert.match(outcome('error').body, /^更新检查失败：/);
  assert.match(outcome('error').body, /超时/);
  assert.equal(outcome('error').role, 'alert');
  assert.equal(outcome('available').toastCount, 0, 'one actionable update pane supplies the result');
  assert.match(outcome('available').updateText, /0\.3\.4/);
  assert.equal(outcome('available').updateVisible, true);
  assert.match(outcome('invalid').body, /^更新检查未完成：/);
  assert.deepEqual(result.confirmSafe, { title: '确认删除', focus: 'app-confirm-cancel' });
  assert.equal(result.confirmRetry, 'shell-feedback-action');
  assert.equal(result.retryCalls, 1);
  assert.equal(result.confirmToastClose, 'shell-feedback-close');
  assert.deepEqual(result.confirmAfterToastEscape, { title: '确认删除', hidden: false, answer: null, toasts: 0 });
  assert.equal(result.confirmAnswer, false);
  assert.equal(result.progress.modalHidden, true);
  assert.equal(result.progress.summaryVisible, true, 'Escape hides presentation and keeps task recovery');
  assert.equal(result.progress.restored, true);
  assert.match(result.progress.body, /42%/);
  assert.deepEqual(result.pluginFailure, { disabled: false, busy: null, body: 'fixture scan failed' });
  assert.match(result.scan.body, /^扫描完成：/);
  assert.equal(result.scan.extraLines, 0);
  assert.match(result.settings.body, /fixture settings save failed/);
  assert.ok(result.installTabTargets.includes('btn-install-cancel'), 'confirmation does not trap a parallel task cancellation');
  assert.ok(result.installTabTargets.some(target => target.includes('shell-feedback-close')));
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
});

test('real Electron: boot controls keep async feedback in place and preserve cancellation', { skip: !electron }, async () => {
  const { boot } = await runFixture(true);
  for (const action of [boot.saveCancelled, boot.saveFailed, boot.cancelFailed, boot.cancelSucceeded, boot.openFailed, boot.openSucceeded]) {
    assert.equal(action.calls, 1, 'two gestures only dispatch one IPC call');
    assert.equal(action.pending.busy, 'true');
    assert.equal(action.pending.disabled, true);
    assert.deepEqual([action.pending.width, action.pending.height, action.pending.text], [action.before.width, action.before.height, action.before.text]);
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
