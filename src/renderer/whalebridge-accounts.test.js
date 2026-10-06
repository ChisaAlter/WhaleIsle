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

test('real WhaleBridge account UI keeps adapter selection and acknowledges successful connections', { skip: !electron }, async () => {
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

    const assertSuccess = (success, title, provider) => {
      assert.equal(success.open, true, 'a successful connection remains in its modal until acknowledged');
      assert.equal(success.visible, true, 'success feedback has rendered geometry');
      assert.equal(success.title, title);
      assert.ok(success.detail.includes(provider), 'the success detail names the connected provider');
      assert.ok(success.detail.includes('\u6a21\u578b\u5df2\u540c\u6b65\u5230\u9cb8\u5c7f'), 'success confirms model synchronization');
      assert.ok(success.instruction.includes('\u6a21\u578b\u9009\u62e9\u5668'), 'the success detail explains the next action');
      assert.ok(success.instruction.includes('\u9cb8\u6865'), 'the next action identifies the desktop model channel');
      assert.equal(success.primary, '\u67e5\u770b\u4f9b\u5e94\u5546');
      assert.equal(success.primaryHidden, false);
      assert.equal(success.primaryDisabled, false);
      assert.equal(success.completion, '\u5b8c\u6210');
      assert.equal(success.fieldCount, 0, 'success replaces the login form instead of leaving resubmittable inputs');
      assert.equal(success.error, '');
    };
    const subscriptionSuccessTitle = '\u8ba2\u9605\u8d26\u53f7\u63a5\u5165\u6210\u529f';
    assertSuccess(result.immediateSuccess, subscriptionSuccessTitle, 'Cursor');
    assertSuccess(result.promptSuccess, subscriptionSuccessTitle, 'Cursor');
    assertSuccess(result.providerSuccess, '\u4f9b\u5e94\u5546\u6dfb\u52a0\u6210\u529f', 'Fixture API');
    assert.equal(result.providerCompletion.selectedTab, 'providers', 'the primary success action opens the provider list');
    assert.ok(result.providerCompletion.names.includes('Fixture API'), 'the new provider is visible after refreshing the list');
    assert.equal(result.providerCompletion.writes, 1, 'acknowledging success does not submit the provider a second time');

    assertSuccess(result.polled[0].success, subscriptionSuccessTitle, 'Claude');
    assert.equal(result.polled[0].polls, 2, 'a waiting status keeps the flow alive until a later done status');
    assertSuccess(result.polled[1].success, '\u8ba2\u9605\u8d26\u53f7\u6388\u6743\u5df2\u66f4\u65b0', 'Codex');
    assert.ok(result.polled[1].success.detail.includes('\u767b\u5f55\u6388\u6743\u5df2\u66f4\u65b0'), 'renewing an existing account is not reported as a new account');
    for (const row of result.polled) {
      assert.ok(row.success.detail.includes('fixture@example.test'), 'a returned account identity is shown');
      assert.equal(row.refreshes, 1, 'a completed login refreshes the provider and model state once');
    }
    assert.deepEqual(result.unsuccessful.map(row => row.error), ['fixture sign-in failed', '\u767b\u5f55\u5df2\u53d6\u6d88']);
    for (const row of result.unsuccessful) {
      assert.equal(row.open, true, 'a failed or canceled login remains visible with its error');
      assert.equal(row.visible, false, 'a failed or canceled login never shows success feedback');
      assert.equal(row.primaryHidden, true);
      assert.notEqual(row.completion, '\u5b8c\u6210');
    }
    assert.deepEqual(result.cancellations.map(call => call.path), ['/api/signin/signin-pending-cancel-flow/cancel'],
      'closing successful login feedback never cancels it, while closing an unfinished login still does');
    for (const geometry of [result.desktopAdapterGap, result.narrowAdapterGap]) {
      assert.equal(geometry.gap, 12, 'the install button has a rendered 12px gap below its explanation');
      assert.equal(geometry.visible, true);
      assert.equal(geometry.insideDialog, true, 'the adapter button stays inside the dialog on desktop and narrow windows');
    }
    assert.ok(result.desktopAdapterGap.width > 600);
    assert.equal(result.narrowAdapterGap.width, 420);
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
