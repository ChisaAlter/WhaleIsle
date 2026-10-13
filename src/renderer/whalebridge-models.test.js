'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { killProcessTree } = require('../main/git-exec');
const electron = [process.env.ELECTRON_PATH, path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'), path.resolve(__dirname, '../../node_modules/electron/dist/electron'), path.resolve(__dirname, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')].find(file => file && fs.existsSync(file));
test('WhaleBridge compact overview and model controls preserve focus, position and scoped bulk visibility', { skip: !electron }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whalebridge-models-'));
  try {
    await new Promise((resolve, reject) => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const startedAt = Date.now();
      const child = spawn(electron, [path.join(__dirname, 'whalebridge-models.child.cjs'), profile], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      const timer = setTimeout(() => {
        output += '\nWHALEBRIDGE_MODELS_WATCHDOG:' + JSON.stringify({
          elapsedMs: Date.now() - startedAt,
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          behaviorPassed: output.includes('WHALEBRIDGE_MODELS_RESULT:PASS'),
        }) + '\n';
        killProcessTree(child);
      }, 45000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        console.log(output.split(/\r?\n/).filter(line => line.startsWith('WHALEBRIDGE_MODELS_PHASE:') || line.startsWith('WHALEBRIDGE_MODELS_WATCHDOG:')).join('\n'));
        try { assert.equal(code, 0, output); assert.match(output, /WHALEBRIDGE_MODELS_RESULT:PASS/); resolve(); } catch (error) { reject(error); }
      });
    });
  } finally {
    const relative = path.relative(os.tmpdir(), profile);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
