'use strict';

// Bound-handler regression driven through a real Electron BrowserWindow:
// the actual launcher.html + the actual preload bridge + fixture shell: IPC.
// Asserts DOM and IPC effects — not pure-function behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ELECTRON = [
  process.env.ELECTRON_PATH,
  path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
  path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron'),
].find((p) => p && fs.existsSync(p));

const CHILD = path.join(__dirname, 'launcher-bound.child.cjs');

function runBound(env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON, [CHILD], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('bound harness timed out')); }, 45000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const marker = out.indexOf('BOUND_RESULT:');
      const errMarker = out.indexOf('BOUND_ERROR:');
      if (errMarker >= 0) return reject(new Error('bound harness error: ' + out.slice(errMarker + 12)));
      if (marker < 0) return reject(new Error(`no BOUND_RESULT (code ${code}): ${out.slice(-500)}`));
      try { resolve(JSON.parse(out.slice(marker + 13))); } catch (e) { reject(e); }
    });
    child.on('error', reject);
  });
}

const hasElectron = Boolean(ELECTRON);

test('home component controls track lifecycle and keep rollback separate; available update appears once', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_COMPONENTS_HOME: '1' });
  assert.equal(r.absent.hidden, true);
  assert.equal(r.stopped.hidden, false);
  assert.equal(r.stopped.homeStart, true);
  assert.equal(r.stopped.rowStart, '启动');
  assert.equal(r.stopped.rowOpen, false);
  assert.equal(r.stopped.rollbackVisible, false);
  assert.ok(r.stopped.brand > 0);
  assert.equal(r.starting.homeDisabled, true);
  assert.equal(r.running.homeStart, false);
  assert.equal(r.running.homeStop, true);
  assert.equal(r.running.homeOpen, true);
  assert.equal(r.stopping.homeDisabled, true);
  assert.equal(r.stoppedAgain.homeStart, true);
  assert.equal(r.stoppedAgain.homeStop, false);
  assert.equal(r.stoppedAgain.rowStart, '启动');
  assert.equal(r.catalogStopped.rollbackVisible, false);
  assert.equal(r.catalogStopped.rowStart, '启动');
  assert.equal(r.update.updateVisible, true);
  assert.equal(r.update.updateCount, 1);
  assert.equal(r.update.extraFeedbackNodes, 0);
  assert.equal(r.update.noticeVisible, true);
  assert.equal(r.update.noticeTitle, '发现新版本');
  assert.match(r.update.noticeBody, /最新版本 v0\.3\.3/);
  assert.equal(r.removed.hidden, true);
  for (const op of ['component-start', 'component-stop', 'component-open']) assert.equal(r.calls.filter(call => call.op === op).length, 1, op);
  assert.equal(r.calls.filter(call => call.op === 'component-rollback').length, 0, 'cancel preserves the current version');
});

test('component feedback preserves buttons and layout, shows real modal progress once, and restores focus', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_COMPONENT_FEEDBACK: '1' });
  for (const [before, pending] of [[r.startBefore, r.starting], [r.installBefore, r.installing],
    [r.updateBefore, r.updating], [r.refreshBefore, r.refreshing], [r.uninstallBefore, r.uninstallReading]]) {
    assert.equal(pending.sameButton, true, 'operation preserves its original button DOM');
    assert.equal(pending.caption, before.caption, 'loading does not replace the original caption');
    assert.equal(pending.width, before.width, 'spinner preserves button width');
    assert.equal(pending.height, before.height, 'spinner preserves button height');
    assert.equal(pending.busy, 'true');
    assert.equal(pending.extraFeedbackNodes, 0, 'no extra inline operation text surface');
  }
  assert.equal(r.starting.homeHeight, r.startBefore.homeHeight, 'starting does not grow the home component card');
  assert.equal(r.failedPhase.homeHeight, r.startBefore.homeHeight, 'a failed progress event does not grow the card');
  assert.equal(r.starting.controls.every(button => button.disabled), true, 'conflicting controls lock in both views');
  assert.equal(r.starting.controls.filter(button => button.action === 'start').every(button => button.busy === 'true'), true);
  assert.equal(r.failedPhase.noticeVisible, false, 'failure phase waits for the operation outcome');
  assert.equal(r.failedPhase.notices.length, 0);
  assert.equal(r.failed.notices.length, 1, 'failed phase and failed reply produce one result');
  assert.equal(r.failed.noticeTitle, '鲸桥操作未完成');
  assert.match(r.failed.noticeBody, /组件进程启动失败/);
  assert.equal(r.failed.cancelHidden, true, 'failure result is a single-button notice');

  for (const progress of [r.installing, r.downloading, r.verifying, r.updating]) {
    assert.equal(progress.noticeVisible, true);
    assert.equal(progress.loadingDialog, true);
    assert.equal(progress.okHidden, true);
    assert.equal(progress.cancelHidden, true);
    assert.equal(progress.extraFeedbackNodes, 0);
  }
  assert.match(r.downloading.noticeBody, /正在下载组件 42%/);
  assert.match(r.verifying.noticeBody, /正在校验组件 60%/);
  assert.equal(r.installed.noticeTitle, '鲸桥安装完成');
  assert.match(r.installed.noticeBody, /当前版本为 v1\.0\.3/);
  assert.equal(r.installed.loadingDialog, false);
  assert.match(r.updating.noticeBody, /正在下载组件 51%/);
  assert.equal(r.updateFailed.noticeTitle, '鲸桥操作未完成');
  assert.equal(r.updateFailed.notices.filter(notice => notice.body === 'fixture package refused').length, 1);
  assert.equal(r.updateFailed.notices.length, 3, 'update has one result after the earlier failure and install result');

  assert.equal(r.persistentErrorInline, false, 'catalog error stays available without a raw inline message');
  assert.equal(r.statusDetails.noticeTitle, '鲸桥状态');
  assert.equal(r.statusDetails.noticeBody, 'fixture catalog is unavailable');
  assert.equal(r.refreshed.busy, null);
  assert.equal(r.refreshed.sameButton, true, 'refresh keeps its static control');
  assert.equal(r.calls.filter(call => call.op === 'component-list' && call.refresh).length, 1, 'duplicate refresh is not issued');

  assert.match(r.uninstallReading.loadingLabel, /读取鲸桥状态/);
  assert.equal(r.uninstallReading.noticeVisible, false);
  assert.equal(r.uninstallReading.controls.every(button => button.disabled), true, 'preflight locks conflicting actions before confirmation');
  assert.match(r.uninstallConfirm.noticeBody, /当前默认模型使用鲸桥/);
  assert.equal(r.uninstallsAfterCancel, 0, 'cancelling the first confirmation leaves the component installed');
  assert.equal(r.uninstallCancelled.noticeVisible, false);
  assert.equal(r.uninstallCancelled.controls.every(button => !button.disabled), true);
  assert.equal(r.keepDataConfirm.noticeTitle, '是否同时删除鲸桥配置？');
  assert.equal(r.keepDataConfirm.cancelHidden, false);
  const uninstall = r.calls.filter(call => call.op === 'component-uninstall');
  assert.equal(uninstall.length, 1);
  assert.deepEqual(uninstall[0].argument, { id: 'whalebridge', removeData: false }, 'keep configuration choice is preserved');
  assert.equal(r.calls.filter(call => call.op === 'component-uninstall-info').length, 2, 'each intentional uninstall reads status once');
  assert.equal(r.calls.filter(call => call.op === 'component-start').length, 2, 'double click is guarded; later intentional start still works');

  for (const result of [r.failureDismissed, r.installDismissed, r.updateDismissed, r.uninstallCancelled, r.finalState]) {
    assert.equal(result.focusConnected, true, 'completed operation focuses current DOM');
    assert.equal(result.focusVisible, true, 'completed operation never focuses a hidden modal or menu button');
    assert.equal(result.focusTag, 'BUTTON');
    assert.equal(Boolean(result.focusAction || result.focusRefresh), true, 'focus returns to an actionable component control');
  }
  assert.equal(r.switchedTab.focusTab, 'components', 'completion does not take focus from a user-selected tab');
  assert.equal(r.switchedTab.noticeVisible, false, 'ordinary start completion is reflected by the persistent state');
  assert.equal(r.finalState.noticeVisible, false);
  assert.equal(r.finalState.extraFeedbackNodes, 0);
});

test('home uses one guarded start action and hides stale diagnostics throughout deferred startup', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_STARTUP_FLOW: '1' });
  assert.equal(r.initial.duplicateRetry, false);
  assert.equal(r.initial.diagnosticsOpen, false);
  assert.doesNotMatch(r.initial.visibleText, /EEXIST|fixture|未检测到插件/);
  assert.match(r.initial.startText, /重试/);
  assert.equal(r.startsWhilePending, 1);
  assert.equal(r.pending.startDisabled, true);
  assert.equal(r.pending.skipDisabled, true);
  assert.equal(r.pending.fullDisabled, true);
  assert.equal(r.pending.diagnosticsHidden, true);
  assert.match(r.pending.startText, /启动中/);
  assert.match(r.pending.status, /[1-9]\d* 秒/);
  assert.doesNotMatch(r.pending.status, /未运行|失败|EEXIST/);
  assert.equal(r.failed.startDisabled, false);
  assert.equal(r.rejected.startDisabled, false);
  assert.match(r.rejected.detail, /fixture transport failure/);
  assert.match(r.failed.detail, /EEXIST/);
  assert.doesNotMatch(r.failed.visibleText, /EEXIST|fixture/);
  assert.equal(r.readyHome.startHidden, true);
  assert.equal(r.readyHome.stopHidden, false);
  assert.equal(r.readyHome.diagnosticsHidden, true);
  assert.equal(r.stops, 1);
  assert.equal(r.stopping.stopDisabled, true);
  assert.match(r.stopping.stopText, /关闭中/);
  assert.equal(r.stopping.startHidden, true);
  assert.equal(r.stopped.startDisabled, false);
  assert.equal(r.stopped.startHidden, false);
  for (const layout of r.layouts) {
    assert.equal(layout.reachable, true, `main action reachable at ${layout.zoom}x`);
    assert.equal(layout.rawErrorCount, 1, 'raw error only appears in diagnostics');
  }
  assert.ok(r.layouts[1].width < r.layouts[0].width, 'zoom changes actual viewport geometry');
});

test('bound handlers: delayed cancel A->B keeps B live and refuses the stale write', { skip: !hasElectron }, async () => {
  const r = await runBound();
  assert.equal(r.scan.hasShell, true, 'real preload bridge exposed window.shell');
  assert.equal(r.scan.importBtn && r.scan.cancelBtn && r.scan.routePicker, true, 'launcher DOM bound');
  assert.equal(r.delayedCancel.staleWriteRefused, true,
    'a delayed cancel for A must not overwrite B in-flight progress');
  assert.match(r.delayedCancel.dom.importResult, /正在导入/, 'B stays in-flight');
  assert.notEqual(r.delayedCancel.opA, r.delayedCancel.opB, 'A and B are distinct operation ids');
  assert.equal(r.delayedCancel.dom.cancelHidden, false, 'cancel stays available for the live run');
});

test('bound handlers: a resolved {ok:false} route-save is refused and the same route retries', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_ROUTE_FAIL_ONCE: '1' });
  assert.equal(r.routeRetry.firstIssued, true, 'first pick issues a save');
  // The first save resolved {ok:false}; the same route pick must issue again —
  // the resolved refusal was treated as failure and reset the issued marker.
  assert.equal(r.routeRetry.retryIssued, true, 'same route retries after the resolved refusal');
  assert.equal(r.routeRetry.savesAfterRetry, 2, 'two save attempts recorded');
  assert.equal(r.routeRetry.radios.some((x) => x.disabled && x.route === 'nightly'), true, 'unverified route stays disabled');
});
