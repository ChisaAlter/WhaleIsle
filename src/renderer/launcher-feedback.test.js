'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = [process.env.ELECTRON_PATH, path.join(__dirname, '../../node_modules/electron/dist/electron.exe'), path.join(__dirname, '../../node_modules/electron/dist/electron')].find(file => file && fs.existsSync(file));

test('real Electron: launcher feedback stays centered and leaves the page and buttons stable', { skip: !electron }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'launcher-feedback.child.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
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
    assert.equal(item.current.title, '已是最新版本');
    assert.match(item.current.body, /0\.3\.3/);
    assert.equal(item.current.cancelVisible, false);
    assert.equal(item.current.okVisible, true);
    assert.equal(item.current.button.disabled, false);
    assert.equal(item.tabFocus, 'app-confirm-ok');
    assert.equal(item.dismissed.modalHidden, true, 'passive refresh does not repeat the result');
    assert.equal(item.dismissed.focus, 'btn-check-update');
  }
  const outcome = status => result.outcomes.find(item => item.status === status);
  assert.equal(outcome('none').title, '暂无可用更新');
  assert.doesNotMatch(outcome('none').body, /最新版本/);
  assert.equal(outcome('error').title, '更新检查失败');
  assert.match(outcome('error').body, /超时/);
  assert.equal(outcome('available').title, '发现新版本');
  assert.match(outcome('available').body, /0\.3\.4/);
  assert.equal(outcome('available').updateVisible, true);
  assert.equal(outcome('invalid').title, '更新检查未完成');
  assert.deepEqual(result.confirmSafe, { title: '确认删除', focus: 'app-confirm-cancel' });
  assert.equal(result.confirmAnswer, false);
  assert.equal(result.progress.modalHidden, false, 'Escape cannot pretend to cancel a backend task');
  assert.equal(result.progress.okVisible || result.progress.cancelVisible, false);
  assert.match(result.progress.body, /42%/);
  assert.deepEqual(result.pluginFailure, { disabled: false, busy: null, body: 'fixture scan failed' });
  assert.equal(result.scan.title, '扫描完成');
  assert.equal(result.scan.extraLines, 0);
  assert.match(result.settings.body, /fixture settings save failed/);
  assert.deepEqual(result.errors, []);
  assert.equal(result.recoveryPrompt.title, '插件加载失败');
  assert.match(result.recoveryPrompt.body, /dsh-tavern/);
  assert.equal(result.recoveryPrompt.focus, 'app-confirm-cancel');
  assert.equal(result.recoveryPrompt.centered, true);
  assert.equal(result.recoveryCancelled.calls, 0, 'cancel changes no plugins');
  assert.equal(result.recoveryCancelled.modalHidden, true, 'same failure refresh does not nag');
  assert.equal(result.recoveryCancelled.guidanceVisible, true, 'recovery remains reachable after cancellation');
  assert.equal(result.recoveryPending.calls, 1, 'double clicks do not duplicate recovery');
  assert.deepEqual(result.recoveryPending.names, ['dsh-tavern']);
  assert.equal(result.recoveryPending.controlsDisabled, true);
  assert.equal(result.recoveryPending.cancelVisible || result.recoveryPending.okVisible, false);
  assert.equal(result.recoverySuccess.title, '已禁用并启动鲸屿');
  assert.equal(result.recoverySuccess.guidanceVisible, false);
  assert.match(result.recoveryStillSkipped.body, /仍以跳过用户插件模式启动/);
  assert.equal(result.recoveryStillSkipped.title, '插件已禁用，仍需排查', 'the operation result remains authoritative when status refresh fails');
  assert.match(result.statusReadFailure.body, /暂时无法读取桌面状态/);
  assert.equal(result.nonPluginFailure.modalHidden, true);
  assert.equal(result.nonPluginFailure.guidanceVisible, false, 'port failures never suggest disabling plugins');
});
