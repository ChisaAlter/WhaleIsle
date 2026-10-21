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
  assert.equal(r.stopped.desktopImages, 0, 'the desktop home card omits its avatar');
  assert.equal(r.stopped.homeImages, 0, 'the WhaleBridge home card omits its avatar');
  assert.ok(r.stopped.sidebarBrand > 0, 'the sidebar brand stays unchanged');
  assert.ok(r.stopped.catalogBrand > 0, 'component management retains its existing icon');
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
  assert.equal(r.update.noticeVisible, false, 'available update keeps confirmation free');
  assert.equal(r.update.toastCount, 0, 'the one actionable update pane supplies its result');
  assert.match(r.update.updateText, /可更新至 v0\.3\.3/);
  assert.equal(r.removed.hidden, true);
  for (const op of ['component-start', 'component-stop', 'component-open']) assert.equal(r.calls.filter(call => call.op === op).length, 1, op);
  assert.equal(r.calls.filter(call => call.op === 'component-rollback').length, 0, 'cancel preserves the current version');
});

test('component feedback stays on its buttons, shows one result, and restores focus', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_COMPONENT_FEEDBACK: '1' });
  for (const [before, pending] of [[r.startBefore, r.starting], [r.installBefore, r.installing],
    [r.updateBefore, r.updating], [r.refreshBefore, r.refreshing], [r.uninstallBefore, r.uninstallReading]]) {
    assert.equal(pending.sameButton, true, 'operation preserves its original button DOM');
    assert.equal(pending.spinner, true, 'the button shows its own spinner');
    assert.match(pending.caption, /\S/, 'the button preserves its pending label');
    assert.ok(pending.caption || pending.spinner, 'a busy button always shows progress');
    assert.equal(pending.width, before.width, 'loading keeps the button width');
    assert.equal(pending.height, before.height, 'loading preserves button height');
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
  assert.equal(r.failed.noticeRole, 'alert');
  assert.equal(r.failed.modalVisible, false, 'failure result keeps confirmation free');

  for (const progress of [r.installing, r.downloading, r.verifying, r.updating]) {
    assert.equal(progress.progressVisible, false, 'no floating progress panel');
    assert.equal(progress.busy, 'true');
    assert.equal(progress.modalVisible, false, 'progress does not occupy the confirmation dialog');
    assert.equal(progress.noticeVisible, false, 'pending progress cannot report a completed result');
    assert.equal(progress.extraFeedbackNodes, 0);
    for (const color of [progress.labelColor, progress.spinnerColor]) {
      assert.match(color, /^rgb\(/, `progress text and spinner stay opaque: ${color}`);
    }
  }
  assert.equal(r.installing.caption, '安装中…', 'the narrow install button keeps its complete label');
  for (const progress of [r.installing, r.downloading, r.verifying]) {
    assert.equal(progress.scrolling, true, 'overflowing button labels scroll');
    assert.equal(progress.animationName, 'shell-button-scroll');
    assert.ok(progress.textWidth > progress.labelWidth, 'the complete text remains available inside a clipped viewport');
  }
  assert.equal(r.installScroll.missingAnimation, undefined);
  assert.ok(r.installScroll.movingEnd < r.installScroll.movingStart, 'the label moves during actual animation playback');
  assert.ok(r.installScroll.end < r.installScroll.start, 'the label moves horizontally');
  assert.ok(Math.abs(r.installScroll.start - r.installScroll.left) < 1, 'scrolling starts with the first character visible');
  assert.ok(Math.abs(r.installScroll.endRight - r.installScroll.right) < 1, 'scrolling reveals the end of the label');
  assert.equal(r.continuousScroll.sameText, true, 'progress preserves the scrolling text node');
  assert.equal(r.continuousScroll.sameAnimation, true, 'progress does not restart the marquee');
  assert.ok(r.continuousScroll.time > 0, 'progress preserves animation time');
  assert.equal(r.reducedMotion.animationName, 'none', 'reduced motion disables automatic scrolling');
  assert.equal(r.reducedMotion.caption, '下载 42%');
  assert.match(r.downloading.loadingLabel, /正在下载组件 42%/);
  assert.equal(r.downloading.caption, '下载 42%', 'download progress keeps its verb and percentage');
  assert.match(r.verifying.loadingLabel, /正在校验组件 60%/);
  assert.equal(r.verifying.caption, '校验 60%', 'verification progress keeps its verb and percentage');
  assert.equal(r.installed.noticeVisible, false, 'the refreshed row reports a plain install');
  assert.equal(r.installed.progressVisible, false);
  assert.equal(r.installed.modalVisible, false);
  assert.match(r.updating.loadingLabel, /正在下载组件 51%/);
  assert.equal(r.updateFailed.noticeTitle, '鲸桥操作未完成');
  assert.equal(r.updateFailed.notices.filter(notice => notice.body === 'fixture package refused').length, 1);
  assert.equal(r.updateFailed.notices.length, 2, 'update has one result after the earlier failure');

  assert.equal(r.persistentErrorInline, false, 'catalog error stays available without a raw inline message');
  assert.equal(r.statusDetails.noticeTitle, '鲸桥状态');
  assert.equal(r.statusDetails.noticeBody, '鲸桥状态：fixture catalog is unavailable');
  assert.equal(r.statusDetails.modalVisible, false);
  assert.equal(r.refreshed.busy, null);
  assert.equal(r.refreshed.sameButton, true, 'refresh keeps its static control');
  assert.equal(r.calls.filter(call => call.op === 'component-list' && call.refresh).length, 1, 'duplicate refresh is not issued');

  assert.match(r.uninstallReading.loadingLabel, /读取鲸桥状态/);
  assert.equal(r.uninstallReading.noticeVisible, false);
  assert.equal(r.uninstallReading.controls.every(button => button.disabled), true, 'preflight locks conflicting actions before confirmation');
  assert.equal(r.uninstallConfirm.modalVisible, true);
  assert.match(r.uninstallConfirm.confirmBody, /当前默认模型使用鲸桥/);
  assert.equal(r.uninstallsAfterCancel, 0, 'cancelling the first confirmation leaves the component installed');
  assert.equal(r.uninstallCancelled.modalVisible, false);
  assert.equal(r.uninstallCancelled.controls.every(button => !button.disabled), true);
  assert.equal(r.keepDataConfirm.modalVisible, true);
  assert.equal(r.keepDataConfirm.confirmTitle, '是否同时删除鲸桥配置？');
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
  assert.match(r.pending.startText, /^启动(中…?)?$/, 'the start button shows its pending step');
  assert.equal(r.pending.startBusy, 'true');
  assert.match(r.pending.startLabel, /正在启动/);
  assert.match(r.pending.status, /[1-9]\d* 秒/);
  assert.doesNotMatch(r.pending.status, /未运行|失败|EEXIST/);
  assert.equal(r.failed.startDisabled, false);
  assert.equal(r.rejected.startDisabled, false);
  assert.match(r.rejected.detail, /fixture transport failure/);
  assert.match(r.failed.detail, /EEXIST/);
  assert.doesNotMatch(r.failed.homeVisibleText, /EEXIST|fixture/, 'raw failure does not grow the home surface');
  assert.equal(r.failed.diagnosticsOpen, false);
  assert.equal(r.failed.errorToasts.length, 1, 'failed operation has one floating result');
  assert.match(r.failed.errorToasts[0], /EEXIST/);
  assert.equal(r.failed.modalHidden, true);
  assert.equal(r.readyHome.startHidden, true);
  assert.equal(r.readyHome.stopHidden, false);
  assert.equal(r.readyHome.diagnosticsHidden, true);
  assert.equal(r.stops, 1);
  assert.equal(r.stopping.stopDisabled, true);
  assert.match(r.stopping.stopText, /^关闭(中…?)?$/, 'the stop button shows its pending step');
  assert.equal(r.stopping.stopBusy, 'true');
  assert.match(r.stopping.stopLabel, /正在关闭/);
  assert.equal(r.stopping.startHidden, true);
  assert.equal(r.stopped.startDisabled, false);
  assert.equal(r.stopped.startHidden, false);
  for (const layout of r.layouts) {
    assert.equal(layout.reachable, true, `main action reachable at ${layout.zoom}x`);
    assert.equal(layout.rawErrorCount, 1, 'the home surface keeps raw error in diagnostics');
  }
  assert.ok(r.layouts[1].width < r.layouts[0].width, 'zoom changes actual viewport geometry');
});

test('real Electron: delta fallback waits for confirmed installation and only actual success refreshes', { skip: !hasElectron }, async () => {
  const r = await runBound({ QA_DELTA_FEEDBACK: '1' });
  assert.equal(r.calls.filter(call => call.op === 'install-delta').length, 3);
  for (const item of r.cases) {
    assert.equal(item.confirmationFocus, 'app-confirm-cancel', 'safe choice receives confirmation focus');
    assert.equal(item.pending.progressVisible, true);
    assert.equal(item.pending.busy, 'true');
    assert.equal(item.pending.modalHidden, true);
    assert.equal(item.terminal.progressVisible, true, 'the result remains reachable in its original progress pane');
    assert.equal(item.terminal.busy, 'false');
    assert.equal(item.terminal.modalHidden, true);
    assert.equal(item.terminal.toasts, 0, 'one progress result is authoritative');
  }
  const waiting = r.cases.find(item => item.name === 'waiting');
  assert.equal(waiting.terminal.title, '安装结果待确认');
  assert.match(waiting.terminal.body, /安装结果待确认.*安装向导.*系统授权/);
  assert.doesNotMatch(waiting.terminal.body, /已完成安装|已增量更新|安装完成/);
  assert.equal(waiting.terminal.pct, '');
  assert.equal(waiting.terminal.phasesHidden, true);
  assert.equal(waiting.terminal.barHidden, true);
  assert.deepEqual(waiting.readsAfter, waiting.readsBefore, 'unconfirmed install cannot refresh as success');
  for (const item of r.cases.filter(item => item.name !== 'waiting')) {
    assert.equal(item.terminal.title, '安装完成');
    assert.equal(item.terminal.phasesHidden, false);
    assert.equal(item.terminal.barHidden, false);
    assert.ok(item.readsAfter.status > item.readsBefore.status);
    assert.ok(item.readsAfter.releases > item.readsBefore.releases);
  }
  assert.match(r.cases[1].terminal.body, /已增量更新到 v9\.9\.9/);
  assert.match(r.cases[2].terminal.body, /已完成安装：v9\.9\.9/);
});

test('bound handlers: delayed cancel A->B keeps B live and refuses the stale write', { skip: !hasElectron }, async () => {
  const r = await runBound();
  assert.deepEqual([r.keyboard.opened, r.keyboard.down, r.keyboard.end, r.keyboard.home, r.keyboard.up],
    ['stable', 'beta', 'beta', 'stable', 'beta'], 'popup skips the unverified option and supports arrow and boundary keys');
  assert.equal(r.keyboard.escaped, true, 'Escape returns focus to the popup trigger');
  assert.match(r.keyboard.scope, /重新安装已勾选插件/);
  assert.match(r.keyboard.scope, /预设和设置（含全局指令及关联凭据）/);
  assert.match(r.keyboard.scope, /同路径附件覆盖/);
  assert.match(r.keyboard.scope, /整个 attachments\/ 目录，包括未勾选会话/);
  assert.equal(r.scan.hasShell, true, 'real preload bridge exposed window.shell');
  assert.equal(r.scan.importBtn && r.scan.cancelBtn && r.scan.routePicker, true, 'launcher DOM bound');
  assert.equal(r.delayedCancel.staleWriteRefused, true,
    'a delayed cancel for A must not overwrite B in-flight progress');
  assert.match(r.delayedCancel.dom.importResult, /正在导入/, 'B stays in-flight');
  assert.notEqual(r.delayedCancel.opA, r.delayedCancel.opB, 'A and B are distinct operation ids');
  assert.equal(r.delayedCancel.dom.cancelHidden, false, 'cancel stays available for the live run');
  assert.equal(r.delayedCancel.cancelPending.label, '取消中…');
  assert.equal(r.delayedCancel.cancelPending.busy, 'true');
  assert.equal(r.delayedCancel.cancelPending.disabled, true);
  assert.equal(r.delayedCancel.cancelPending.spinner, true);
  assert.equal(r.delayedCancel.cancelPending.width, r.delayedCancel.cancelBefore.width);
  assert.equal(r.delayedCancel.cancelPending.height, r.delayedCancel.cancelBefore.height);
  assert.equal(r.delayedCancel.dom.cancelBusy, null, 'the next import owns fresh cancellation feedback');
  assert.equal(r.delayedCancel.dom.cancelDisabled, false);
  assert.equal(r.delayedCancel.dom.cancelOverlay, false);
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
