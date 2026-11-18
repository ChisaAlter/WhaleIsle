const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, 'release-ui-window-controls.js'), 'utf8');

async function probe(platform, options, buttons) {
  const {
    actions = null,
    hidden = false,
    hiddenAttr = false,
    styleDisplay,
    computedDisplay,
    withComputedStyle = computedDisplay !== undefined,
  } = typeof options === 'object' && options !== null && !Array.isArray(options)
    ? options
    : { actions: options };

  const module = { exports: {} };
  vm.runInNewContext(SOURCE, {
    module,
    process: { platform },
    require: name => name === './window'
      ? { getMainWindow: () => ({}) }
      : { cocoaButtons: () => ({ snapshot: () => ({ buttons }) }) },
  });

  const host = actions === null ? null : {
    hidden,
    hasAttribute: attr => attr === 'hidden' && hiddenAttr,
    ...(styleDisplay !== undefined ? { style: { display: styleDisplay } } : {}),
    querySelector: (selector) => {
      if (selector === '[data-act]') {
        return actions.length > 0 ? {} : null;
      }
      return actions.some(action => selector === `[data-act="${action}"]`) ? {} : null;
    },
  };
  const document = { getElementById: id => id === 'dshd-shell-controls' ? host : null };
  const pageContext = withComputedStyle
    ? { document, getComputedStyle: () => ({ display: computedDisplay }) }
    : { document };

  return module.exports.probeWindowControls({
    executeJavaScript: async code => vm.runInNewContext(code, pageContext),
  });
}

const HEALTHY_NATIVE = ['close', 'minimize', 'zoom'].map(name => ({
  name,
  present: true,
  hidden: false,
  enabled: true,
}));

test('macOS passes when container is absent or empty-and-hidden and AppKit buttons are healthy', async () => {
  assert.equal((await probe('darwin', null, HEALTHY_NATIVE)).ok, true);
  assert.equal((await probe('darwin', { actions: [], computedDisplay: 'none' }, HEALTHY_NATIVE)).ok, true);
  assert.equal((await probe('darwin', { actions: [], hidden: true, computedDisplay: 'flex' }, HEALTHY_NATIVE)).ok, true);
  assert.equal((await probe('darwin', { actions: [], hiddenAttr: true }, HEALTHY_NATIVE)).ok, true);
  assert.equal((await probe('darwin', { actions: [], styleDisplay: 'none' }, HEALTHY_NATIVE)).ok, true);
});

test('macOS fails when web [data-act] buttons exist or empty container is visible', async () => {
  assert.equal(
    (await probe('darwin', { actions: ['close'], computedDisplay: 'none' }, HEALTHY_NATIVE)).ok,
    false,
    'hidden container with [data-act] button must fail',
  );
  assert.equal(
    (await probe('darwin', { actions: ['custom'], hidden: true }, HEALTHY_NATIVE)).ok,
    false,
    'hidden container with any [data-act] button must fail',
  );
  assert.equal(
    (await probe('darwin', { actions: ['minimize', 'maximize', 'close'], computedDisplay: 'flex' }, HEALTHY_NATIVE)).ok,
    false,
    'visible container with [data-act] buttons must fail',
  );
  assert.equal(
    (await probe('darwin', { actions: [], computedDisplay: 'flex' }, HEALTHY_NATIVE)).ok,
    false,
    'visible empty container must fail',
  );
  assert.equal(
    (await probe('darwin', [], HEALTHY_NATIVE)).ok,
    false,
    'empty container without hidden/display:none in minimal sandbox must fail',
  );
});

test('macOS fails when native AppKit buttons are missing, hidden, disabled, or incomplete', async () => {
  for (const bad of [{ present: false }, { hidden: true }, { enabled: false }]) {
    assert.equal(
      (await probe('darwin', { actions: [], computedDisplay: 'none' }, [{ ...HEALTHY_NATIVE[0], ...bad }, ...HEALTHY_NATIVE.slice(1)])).ok,
      false,
    );
  }
  assert.equal(
    (await probe('darwin', { actions: [], computedDisplay: 'none' }, HEALTHY_NATIVE.slice(1))).ok,
    false,
  );
});

test('Windows and Linux require injected plate with minimize, maximize, and close buttons', async () => {
  assert.deepEqual({ ...(await probe('linux', ['minimize', 'maximize', 'close'])) }, {
    ok: true,
    detail: '',
  });
  assert.deepEqual({ ...(await probe('win32', ['minimize', 'close'])) }, {
    ok: false,
    detail: 'injected window-control plate missing or incomplete',
  });
  assert.deepEqual({ ...(await probe('linux', null)) }, {
    ok: false,
    detail: 'injected window-control plate missing or incomplete',
  });
});
