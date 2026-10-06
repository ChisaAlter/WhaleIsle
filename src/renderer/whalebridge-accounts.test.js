'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { killProcessTree } = require('../main/git-exec');

const electron = [
  process.env.ELECTRON_PATH,
  path.resolve(__dirname, '../../node_modules/electron/dist/electron.exe'),
  path.resolve(__dirname, '../../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  path.resolve(__dirname, '../../node_modules/electron/dist/electron'),
].find(file => file && fs.existsSync(file));

test('real WhaleBridge account UI keeps the installed adapter selected and signs in to it', { skip: !electron }, async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const profile = fs.mkdtempSync(path.join(tempRoot, 'whalebridge-accounts-'));
  let failure;
  try {
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(electron, [path.join(__dirname, 'whalebridge-accounts.child.cjs'), profile], {
        env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', childError, timedOut = false;
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      const timer = setTimeout(() => { timedOut = true; killProcessTree(child); }, 45000);
      child.once('error', error => { childError = error; clearTimeout(timer); });
      // close follows exit and drained stdio; cleanup must not race Electron.
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (timedOut || childError) return reject(new Error(
          `WhaleBridge account renderer ${timedOut ? 'timeout' : 'spawn failed'}: ${childError || signal || code}\n${stderr}\n${stdout}`,
          childError ? { cause: childError } : undefined,
        ));
        const marker = 'WHALEBRIDGE_ACCOUNTS_RESULT:';
        const line = stdout.split(/\r?\n/).find(row => row.startsWith(marker));
        if (code !== 0 || !line) return reject(new Error(`WhaleBridge account renderer ${code}: ${stderr}\n${stdout}`));
        try { resolve(JSON.parse(line.slice(marker.length))); } catch (error) { reject(error); }
      });
    });

    assert.equal(result.initial.selected, 'claude', 'a new add-account dialog retains its default');
    assert.equal(result.beforeInstall.selected, 'cursor');
    assert.equal(result.beforeInstall.hasAdapterButton, true);
    assert.equal(result.installed.selected, 'cursor-plugin', 'refresh selects the installed backend, not the built-in');
    assert.deepEqual(result.installed.methods, ['Cursor OAuth', 'Cursor API key']);
    assert.equal(result.installed.hasAdapterButton, false);
    assert.deepEqual(result.signin, { agent: 'cursor', plugin: true, method: 0, inputs: {} });
    assert.equal(result.migrated.selected, 'cursor', 'provider identity comes from the refreshed catalog, not a suffix');
    assert.deepEqual(result.migrated.methods, ['Cursor OAuth', 'Cursor API key']);
    assert.equal(result.migrated.hasAdapterButton, false);
    assert.equal(result.failureDefault, 'claude', 'the prior adapter does not leak into a new dialog');
    assert.equal(result.failed.selected, 'cursor');
    assert.equal(result.failed.hasAdapterButton, true);
    assert.equal(result.failed.adapterDisabled, false);
    assert.equal(result.failed.error, 'fixture adapter installation failed');
    assert.equal(result.failureRefreshes, 0, 'a failed installation does not replace the form');
    assert.equal(result.addAccount.selected, 'cursor', 'adding an existing provider account keeps its exact identity');
    assert.equal(result.addAccount.hasAdapterButton, true);
    assert.deepEqual(result.addAccount.methods, []);
    assert.deepEqual(result.catalogs.slice(0, 2).map(row => row.ids), [
      ['claude', 'codex', 'cursor'],
      ['claude', 'codex', 'cursor', 'cursor-plugin'],
    ], 'the adapter API actually changes the HTTP catalog fixture');
    assert.deepEqual(result.installs.map(call => call.body), [{ id: 'cursor' }, { id: 'cursor' }, { id: 'cursor' }]);
    assert.deepEqual(result.prompts.filter(call => call.scenario === 'normal').map(call => call.body), [
      { id: 'cursor', method: 0, inputs: {} },
    ]);
    assert.equal(result.promptValidationError, 'fixture tenant rejected');
    assert.deepEqual(result.prompts.filter(call => call.scenario === 'prompts').map(call => call.body), [
      { id: 'cursor', method: 0, inputs: {} },
      { id: 'cursor', method: 0, inputs: {}, key: 'tenant', value: 'invalid' },
      { id: 'cursor', method: 0, inputs: {}, key: 'tenant', value: 'fixture-tenant' },
      { id: 'cursor', method: 0, inputs: { tenant: 'fixture-tenant' }, key: 'region', value: 'eu' },
    ], 'prompt answers are validated by key/value before joining the accepted inputs');
    assert.deepEqual(result.promptSignin, {
      agent: 'cursor', plugin: true, method: 0, inputs: { tenant: 'fixture-tenant', region: 'eu' },
    }, 'sign-in receives the accepted sequential prompt answers');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      const relative = path.relative(tempRoot, path.resolve(profile));
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'cleanup remains inside the temporary directory');
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (cleanupError) {
      if (failure) throw new AggregateError([failure, cleanupError], 'WhaleBridge account renderer failed and cleanup failed', { cause: failure });
      throw cleanupError;
    }
  }
});
