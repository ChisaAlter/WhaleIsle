const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { overlayCss, closingCopy } = require('./closing-overlay');

test('overlayCss uses the supplied light theme colors instead of a dark fallback', () => {
  const css = overlayCss({
    scheme: 'light',
    bg: '#ffffff',
    fg: '#0f1115',
    muted: '#6b7280',
    accent: '#4176e6',
    field: '#f5f5f6',
    line: 'rgba(15, 17, 21, 0.12)',
  });
  assert.match(css, /background: #ffffff/);
  assert.match(css, /color: #0f1115/);
  assert.match(css, /color-scheme: light/);
  assert.doesNotMatch(css, /#151517/);
  assert.doesNotMatch(css, /color-mix\([^)]*#000/);
});

test('overlayCss uses the supplied dark theme colors', () => {
  const css = overlayCss({
    scheme: 'dark',
    bg: '#151517',
    fg: '#f5f5f5',
    muted: '#8b93a7',
    accent: '#6ea8ff',
    field: '#1d1d20',
    line: 'rgba(245, 245, 245, 0.10)',
  });
  assert.match(css, /background: #151517/);
  assert.match(css, /color: #f5f5f5/);
  assert.match(css, /color-scheme: dark/);
  assert.match(css, /border-top-color: #6ea8ff/);
});

test('closingCopy is Chinese by default and English when locale is en', () => {
  assert.deepEqual(closingCopy(), {
    title: '关闭中',
    detail: '正在停止本机 Harness 服务，请稍候',
  });
  assert.deepEqual(closingCopy('zh'), {
    title: '关闭中',
    detail: '正在停止本机 Harness 服务，请稍候',
  });
  assert.deepEqual(closingCopy('en'), {
    title: 'Closing',
    detail: 'Stopping the local Harness service…',
  });
});

function paintFixture({ insertCSS = async () => {}, executeJavaScript = async () => {}, visible = true, minimized = false } = {}) {
  const timers = [];
  const cleared = [];
  const calls = [];
  const windowCalls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'closing-overlay.js'), 'utf8'), {
    module,
    require: () => ({ currentTheme: () => ({ bg: '#151517', fg: '#f5f5f5', scheme: 'dark' }) }),
    setTimeout: (callback, milliseconds) => { const timer = { callback, milliseconds }; timers.push(timer); return timer; },
    clearTimeout: timer => { cleared.push(timer); },
  });
  const win = {
    isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible,
    restore: () => { windowCalls.push('restore'); minimized = false; },
    show: () => { windowCalls.push('show'); visible = true; },
    setBackgroundColor: () => { windowCalls.push('background'); },
    focus: () => { windowCalls.push('focus'); },
    webContents: {
      insertCSS: css => { calls.push('css'); return insertCSS(css); },
      executeJavaScript: script => { calls.push('eval'); return executeJavaScript(script); },
    },
  };
  return { show: module.exports.showClosingOverlay, win, timers, cleared, calls, windowCalls };
}

for (const state of [
  { label: 'hidden in the tray', visible: false, minimized: false },
  { label: 'minimized', visible: true, minimized: true },
]) {
  test(`closing leaves a window ${state.label} in its original state`, async () => {
    const f = paintFixture(state);
    await f.show(f.win);
    assert.equal(f.win.isVisible(), state.visible);
    assert.equal(f.win.isMinimized(), state.minimized);
    assert.deepEqual(f.windowCalls, []);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.timers, []);
  });
}

test('closing a visible window paints feedback without activation or native background changes', async () => {
  const f = paintFixture();
  await f.show(f.win);
  assert.deepEqual(f.calls, ['css', 'eval']);
  assert.deepEqual(f.windowCalls, []);
});

test('successful closing paint keeps CSS/eval order and clears the 500ms host timer', async () => {
  const f = paintFixture();
  await f.show(f.win, 'en');
  assert.deepEqual(f.calls, ['css', 'eval']);
  assert.equal(f.timers.length, 1); assert.equal(f.timers[0].milliseconds, 500);
  assert.deepEqual(f.cleared, f.timers);
});

test('a never-resolving insertCSS cannot block closing beyond its host deadline', async () => {
  const f = paintFixture({ insertCSS: () => new Promise(() => {}) });
  let settled = false;
  const closing = f.show(f.win).then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  assert.deepEqual(f.calls, ['css']); assert.equal(f.timers[0].milliseconds, 500);
  f.timers[0].callback(); await closing;
  assert.equal(settled, true); assert.deepEqual(f.cleared, f.timers);
});

test('suspended renderer animation frames cannot block closing beyond its host deadline', async () => {
  const f = paintFixture({ executeJavaScript: () => new Promise(() => {}) });
  let settled = false;
  const closing = f.show(f.win).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, ['css', 'eval']); assert.equal(settled, false);
  f.timers[0].callback(); await closing;
  assert.equal(settled, true); assert.deepEqual(f.cleared, f.timers);
});

for (const failed of ['insertCSS', 'executeJavaScript']) {
  test(`${failed} rejection remains best effort and clears the host timer`, async () => {
    const f = paintFixture({ [failed]: () => Promise.reject(new Error('renderer gone')) });
    await assert.doesNotReject(f.show(f.win));
    assert.deepEqual(f.cleared, f.timers);
  });
}

test('a renderer rejection after the host deadline remains handled', async () => {
  let rejectPaint;
  const f = paintFixture({ executeJavaScript: () => new Promise((_resolve, reject) => { rejectPaint = reject; }) });
  const closing = f.show(f.win);
  await new Promise(resolve => setImmediate(resolve));
  f.timers[0].callback(); await closing;
  rejectPaint(new Error('late renderer destruction'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.cleared, f.timers);
});
