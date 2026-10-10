const test = require('node:test');
const assert = require('node:assert/strict');
const { enableNativeWindowMotion, hasNativeWindowMotion, isNativeWindowMaximized, toggleNativeMaximize } = require('./native-window-motion');

function fixture(initial = 0x10000000) {
  let style = initial;
  let maximized = false;
  const calls = [];
  const hooks = new Map();
  let nonClientRendering = true;
  const nativeRenderingChanged = enabled => {
    const value = Buffer.alloc(8);
    value.writeUInt32LE(Number(enabled));
    hooks.get(0x031f)?.(value);
    // The notifying native operation commits after the callback returns.
    nonClientRendering = enabled;
  };
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(0x123456789n);
  const win = {
    isDestroyed: () => false,
    getNativeWindowHandle: () => buffer,
    hookWindowMessage: (message, callback) => {
      assert.equal(hooks.has(message), false, 'register each native hook once');
      hooks.set(message, callback);
    },
  };
  const api = {
    getStyle: (hwnd, index) => { assert.equal(hwnd, 0x123456789n); assert.equal(index, -16); return style; },
    setStyle: (hwnd, index, value) => { calls.push(['style', value]); style = value; },
    frameChanged: (...args) => { calls.push(['frame', ...args]); return true; },
    setDwmAttribute: (...args) => {
      calls.push(['dwm', ...args]);
      nativeRenderingChanged(args[2][0] !== 1);
      return 0;
    },
    isZoomed: () => maximized,
    showWindow: (hwnd, command) => { calls.push(['show', hwnd, command]); maximized = command === 3; return true; },
  };
  return {
    win, api, calls, nativeRenderingChanged,
    isNonClientRendering: () => nonClientRendering,
    options: { platform: 'win32', loadApi: () => api },
  };
}

test('native frame re-enabling is suppressed after the notifying operation commits', async () => {
  const f = fixture();
  enableNativeWindowMotion(f.win, f.options);
  assert.equal(f.isNonClientRendering(), false);
  f.calls.length = 0;
  f.nativeRenderingChanged(false);
  assert.deepEqual(f.calls, []);
  f.nativeRenderingChanged(true);
  f.nativeRenderingChanged(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.isNonClientRendering(), false, 'native chrome cannot fill the alpha cutouts');
  assert.deepEqual(f.calls, [['dwm', 0x123456789n, 2, [1], 4]]);
  f.calls.length = 0;
  f.nativeRenderingChanged(true);
  f.win.isDestroyed = () => true;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
});

test('restores animation styles without changing bounds, z-order, focus or unrelated style bits', () => {
  const f = fixture();
  assert.equal(enableNativeWindowMotion(f.win, f.options), true);
  assert.deepEqual(f.calls, [['style', 0x10c40000], ['frame', 0x123456789n, 0, 0, 0, 0, 0, 0x37], ['dwm', 0x123456789n, 2, [1], 4]]);
  assert.equal(hasNativeWindowMotion(f.win), true);
  f.calls.length = 0;
  enableNativeWindowMotion(f.win, f.options);
  assert.deepEqual(f.calls, [['dwm', 0x123456789n, 2, [1], 4]], 'preserve styles and reassert non-client suppression');
});

test('maximize and restore use Windows state, not Electron transparent-window geometry', () => {
  const f = fixture();
  assert.equal(isNativeWindowMaximized(f.win), undefined);
  assert.equal(toggleNativeMaximize(f.win), false);
  enableNativeWindowMotion(f.win, f.options);
  f.calls.length = 0;
  assert.equal(toggleNativeMaximize(f.win), true);
  assert.equal(isNativeWindowMaximized(f.win), true);
  assert.equal(toggleNativeMaximize(f.win), true);
  assert.equal(isNativeWindowMaximized(f.win), false);
  assert.deepEqual(f.calls, [['show', 0x123456789n, 3], ['show', 0x123456789n, 9]]);
  f.api.showWindow = () => false;
  assert.throws(() => toggleNativeMaximize(f.win), /Cannot request native/);
  f.win.isDestroyed = () => true;
  assert.equal(toggleNativeMaximize(f.win), false);
  assert.equal(isNativeWindowMaximized(f.win), undefined);
});

test('unsupported platforms and destroyed windows never load native dependencies', () => {
  const f = fixture();
  const loadApi = () => { throw Error('must not load'); };
  assert.equal(enableNativeWindowMotion(f.win, { platform: 'darwin', loadApi }), false);
  f.win.isDestroyed = () => true;
  assert.equal(enableNativeWindowMotion(f.win, { platform: 'win32', loadApi }), false);
});

test('failed writes or frame refresh cannot silently claim animation support', () => {
  const f = fixture();
  f.api.setStyle = () => {};
  assert.throws(() => enableNativeWindowMotion(f.win, f.options), /did not persist/);
  assert.equal(hasNativeWindowMotion(f.win), false);
  const g = fixture();
  g.api.frameChanged = () => false;
  assert.throws(() => enableNativeWindowMotion(g.win, g.options), /Cannot apply/);
  assert.equal(hasNativeWindowMotion(g.win), false);
  const h = fixture();
  h.api.setDwmAttribute = () => -2147024809;
  assert.throws(() => enableNativeWindowMotion(h.win, h.options), /non-client rendering/);
  assert.equal(hasNativeWindowMotion(h.win), false);
});
