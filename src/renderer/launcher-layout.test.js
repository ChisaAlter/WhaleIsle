'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = [process.env.ELECTRON_PATH, path.join(__dirname, '../../node_modules/electron/dist/electron.exe'), path.join(__dirname, '../../node_modules/electron/dist/electron')].find((file) => file && fs.existsSync(file));

test('real Electron: error diagnostics and launcher controls survive zoom and long text', { skip: !electron }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'launcher-layout.child.cjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('layout fixture timeout')); }, 45000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((text) => text.startsWith('LAYOUT_RESULT:'));
      if (code !== 0 || !line) return reject(new Error(`layout fixture ${code}: ${stderr}\n${stdout}`));
      try { resolve(JSON.parse(line.slice('LAYOUT_RESULT:'.length))); } catch (error) { reject(error); }
    });
  });
  assert.deepEqual(result.diagnostics, { errorCaptured: true, infoCaptured: false, reportHasError: true });
  assert.equal(result.feedbackSurfaces.length, 4);
  for (const surface of result.feedbackSurfaces) {
    assert.equal(surface.floating, true, surface.id + ' belongs to the feedback layer');
    assert.equal(surface.position, 'fixed', surface.id + ' leaves document flow');
  }
  for (const item of result.cases) {
    assert.ok(item.items >= 6, 'fixture renders real import choices');
    assert.ok(item.bodyHeight >= 119, `usable list height: ${JSON.stringify(item)}`);
    assert.ok(item.reachable.every(Boolean), `all controls reachable: ${JSON.stringify(item)}`);
  }
  assert.deepEqual(result.heading, ['16px', '24px']);
  for (const item of result.dialogs) {
    assert.ok(item.bodyHeight > 0, 'dialog body stays scrollable');
    assert.ok(item.buttons.every(Boolean), `dialog actions stay visible: ${JSON.stringify(item)}`);
  }
});
