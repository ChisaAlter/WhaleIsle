'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { electronTestEnv } = require('../../scripts/lib/electron-sandbox.cjs');
const { electronBinary, prerequisiteSkip, requirePrerequisite } = require('../../scripts/lib/test-prerequisites.cjs');
const ELECTRON = electronBinary();
const electron = ELECTRON.binary;

test('real welcome page renders and rejects missing layout/images before entering workspace', { skip: prerequisiteSkip(ELECTRON) }, async (t) => {
  requirePrerequisite(t, ELECTRON);
  const cases = await new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [path.join(__dirname, 'welcome-renderer.child.cjs')], {
      env: electronTestEnv(electron, env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('welcome renderer timeout')); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      const line = stdout.split(/\r?\n/).find(row => row.startsWith('WELCOME_RESULT:'));
      if (code !== 0 || !line) return reject(new Error(`welcome renderer ${code}: ${stderr}\n${stdout}`));
      try { resolve(JSON.parse(line.slice('WELCOME_RESULT:'.length))); } catch (error) { reject(error); }
    });
  });
  assert.equal(cases.length, 4);
  assert.ok(cases.every(row => row.image > 0 && row.skipped === 1));
});
