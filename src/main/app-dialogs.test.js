'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('createShellDialogs.confirmDialog serializes concurrent confirmations and forwards task-stop abort signal', async () => {
  const showCalls = [];
  const fakeParent = { isDestroyed: () => false, isVisible: () => true };
  class FakeShellConfirmDialog {
    showQueued(parent, options) {
      let resolveFn;
      const promise = new Promise((resolve) => { resolveFn = resolve; });
      const cancelId = options.cancelId ?? 1;
      options.signal?.addEventListener('abort', () => resolveFn({ response: cancelId }), { once: true });
      showCalls.push({ parent, options, resolve: resolveFn });
      return promise;
    }
  }
  const module = { exports: {} };
  const stubs = {
    electron: { clipboard: { writeText() {} }, dialog: { showMessageBox: async () => ({ response: 1 }) } },
    './window': { getMainWindow: () => fakeParent, getLauncherWindow: () => null },
    './config': { loadConfig: () => ({ locale: 'en' }) },
    './desktop-locale': {
      resolveDesktopLocale: () => ({
        id: 'en',
        messages: {
          confirmTitleExternal: 'Confirm', confirmAssessedLevel: '{level}',
          confirmLevelExternal: 'External', confirmRequestFrom: 'From {source}',
          confirmSourceAssistant: 'Assistant', confirmRequestContent: 'Content',
          confirmFallbackSummary: 'Summary', confirmDeny: 'Deny',
          confirmAllowOnce: 'Allow once', confirmAllowAlways: 'Always',
        },
      }),
    },
    './model-action-dialog': require('./model-action-dialog'),
    '../shared/model-tool-effects': require('../shared/model-tool-effects'),
    './update-overlay': { UpdateOverlays: class {} },
    './update-dialog': { ShellConfirmDialog: FakeShellConfirmDialog },
    './paths': { rendererFile: (name) => path.join(__dirname, '..', 'renderer', name) },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app-dialogs.js'), 'utf8'), {
    require: (id) => stubs[id] || require(id),
    module,
    exports: module.exports,
    __dirname,
    __filename: path.join(__dirname, 'app-dialogs.js'),
    console,
    Promise,
  });

  const dialogs = module.exports.createShellDialogs();
  const modelAsk = dialogs.confirmModelAction({ tool: 'whale_desktop_config', action: 'patch', effect: 'external', summary: 'x' });
  const abort = new AbortController();
  const stopAsk = dialogs.confirmTaskStop('restart', { activeWork: [{ kind: 'agent', id: 'a1' }], scheduledWork: [], coverage: {} }, { signal: abort.signal });
  const updateAsk = dialogs.confirmDialog(fakeParent, { buttons: ['Install', 'Later'], cancelId: 1, title: 'Update' });

  await new Promise(setImmediate);
  assert.equal(showCalls.length, 1, 'second and third prompts must queue instead of cancelling first');

  // Aborting queued confirmTaskStop resolves it immediately without waiting on or cancelling modelAsk.
  abort.abort();
  assert.equal(await stopAsk, false);
  assert.equal(showCalls.length, 1);

  showCalls[0].resolve({ response: 1 });
  assert.equal(await modelAsk, 'once');
  await new Promise(setImmediate);
  assert.equal(showCalls.length, 2);
  assert.equal(showCalls[1].options.title, 'Update');
  showCalls[1].resolve({ response: 0 });
  assert.deepEqual(await updateAsk, { response: 0 });
});
