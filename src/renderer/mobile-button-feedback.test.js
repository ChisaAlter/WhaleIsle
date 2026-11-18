'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { electronTestEnv, terminateChild } = require('../../scripts/lib/electron-sandbox.cjs');
const { electronBinary, prerequisiteSkip, requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');
const ELECTRON = electronBinary();
const electron = ELECTRON.binary;

test('real Electron: mobile busy buttons preserve geometry, complete captions and motion preference', { skip: prerequisiteSkip(ELECTRON) }, async t => {
  requirePrerequisite(t, ELECTRON);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-button-feedback-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const results = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'mobile-button-feedback.child.cjs'), temporary], {
      env: electronTestEnv(electron, { ...process.env, ELECTRON_RUN_AS_NODE: undefined }), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // kill 后等子进程真正退出（上限由 terminateChild 定）再失败，
      // t.after 回收目录时渲染进程已释放 profile（#478）。
      void terminateChild(child).then(() => reject(new Error(`mobile button fixture timed out: ${errors}\n${output}`)));
    }, 30000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return;
      const record = output.split(/\r?\n/).find(line => line.startsWith('MOBILE_BUTTON_RESULT:'));
      if (code !== 0 || !record) return reject(new Error(`mobile button fixture ${code}: ${errors}\n${output}`));
      resolve(JSON.parse(record.slice('MOBILE_BUTTON_RESULT:'.length)));
    });
  });
  assert.equal(results.length, 4);
  assert.deepEqual(results.map(result => [result.width, result.reducedMotion]), [[320, false], [320, true], [390, false], [390, true]]);
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.equal(result.controls, 6);
    assert.ok(result.checks.includes('progress-phase'));
    assert.ok(result.checks.includes('restore'));
    assert.ok(result.checks.includes('fixed-spinner'));
  }
});
