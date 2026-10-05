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
  assert.equal(r.update.hintHidden, true);
  assert.equal(r.removed.hidden, true);
  for (const op of ['component-start', 'component-stop', 'component-open']) assert.equal(r.calls.filter(call => call.op === op).length, 1, op);
  assert.equal(r.calls.filter(call => call.op === 'component-rollback').length, 0, 'cancel preserves the current version');
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
  assert.match(r.pending.progress, /[1-9]\d* 秒/);
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
