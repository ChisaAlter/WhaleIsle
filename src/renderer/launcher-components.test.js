'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = [process.env.ELECTRON_PATH, path.join(__dirname, '../../node_modules/electron/dist/electron.exe'), path.join(__dirname, '../../node_modules/electron/dist/electron')].find((file) => file && fs.existsSync(file));

test('real launcher component UI: install, update, process, rollback, selection, uninstall and error recovery', { skip: !electron }, async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(__dirname, 'launcher-components.child.cjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('component UI timeout')); }, 90000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find((text) => text.startsWith('COMPONENT_RESULT:'));
      if (code !== 0 || !line) return reject(new Error(`component UI ${code}: ${stderr}\n${stdout}`));
      resolve(JSON.parse(line.slice('COMPONENT_RESULT:'.length)));
    });
  });
  assert.deepEqual(result.realHttpVersions, ['2.0.0','1.0.0']);
  assert.equal(result.dataPreserved, true);
  assert.equal(result.pendingPreserved, true);
  assert.equal(result.errorPreserved, true);
  assert.deepEqual(result.rendererErrors, []);
});
