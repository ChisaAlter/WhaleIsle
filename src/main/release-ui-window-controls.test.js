const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('window-control walk checks actual AppKit buttons on macOS and web controls elsewhere', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'release-ui-window-controls.js'), 'utf8');
  async function probe(platform, actions, buttons) {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, process: { platform },
      require: name => name === './window'
        ? { getMainWindow: () => ({}) }
        : { cocoaButtons: () => ({ snapshot: () => ({ buttons }) }) },
    });
    const document = { getElementById: () => actions === null ? null : {
      querySelector: selector => actions.some(action => selector === `[data-act="${action}"]`) ? {} : null,
    } };
    const result = await module.exports.probeWindowControls({
      executeJavaScript: async code => vm.runInNewContext(code, { document }),
    });
    return result.ok;
  }
  const native = ['close', 'minimize', 'zoom'].map(name => ({ name, present: true, hidden: false, enabled: true }));
  assert.equal(await probe('darwin', null, native), true);
  for (const bad of [{ present: false }, { hidden: true }, { enabled: false }]) {
    assert.equal(await probe('darwin', null, [{ ...native[0], ...bad }, ...native.slice(1)]), false);
  }
  assert.equal(await probe('darwin', null, native.slice(1)), false);
  assert.equal(await probe('darwin', [], native), false, 'macOS must not have a duplicate web plate');
  assert.equal(await probe('linux', ['minimize', 'maximize', 'close']), true);
  assert.equal(await probe('win32', ['minimize', 'close']), false);
  assert.equal(await probe('linux', null), false);
});
