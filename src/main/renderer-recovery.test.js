'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  UNRESPONSIVE, RETRY_URL, createReloadBudget, failurePageHtml, reasonDetail, attachRecovery,
} = require('./renderer-recovery');

function fakeContents(url = 'http://127.0.0.1:3081/') {
  const contents = new EventEmitter();
  Object.assign(contents, { url, destroyed: false, reloads: 0, loaded: [] });
  contents.getURL = () => contents.url;
  contents.isDestroyed = () => contents.destroyed;
  contents.reloadIgnoringCache = () => { contents.reloads += 1; };
  contents.loadURL = async (next) => { contents.loaded.push(next); contents.url = next; };
  return contents;
}

function attach(contents, extra = {}) {
  const reasons = [];
  const recovery = attachRecovery(contents, {
    label: '桌面端主',
    report: async (why) => { reasons.push(why); return 'C:\\logs\\crash\\one.log'; },
    wait: async () => {},
    ...extra,
  });
  contents.emit('did-finish-load');
  return { ...recovery, reasons };
}

test('a crashed page reloads by itself, without asking', async () => {
  const contents = fakeContents();
  const { recover, reasons } = attach(contents);
  await recover('crashed');
  assert.deepEqual(reasons, ['crashed']);
  assert.equal(contents.reloads, 1);
  assert.deepEqual(contents.loaded, []);
});

test('reloading that keeps failing ends on a failure page inside the surface', async () => {
  const contents = fakeContents();
  const { recover } = attach(contents);
  await recover('crashed');
  await recover('crashed');
  await recover('crashed');
  assert.equal(contents.reloads, 3);
  assert.deepEqual(contents.loaded, []);
  await recover('oom');
  assert.equal(contents.reloads, 3, 'no fourth automatic reload');
  assert.equal(contents.loaded.length, 1);
  assert.match(contents.loaded[0], /^data:text\/html;charset=utf-8,/u);
  const html = decodeURIComponent(contents.loaded[0].split(',')[1]);
  assert.match(html, /桌面端主界面没有恢复/u);
  assert.match(html, /oom/u);
  assert.match(html, /C:\\logs\\crash\\one\.log/u);
  assert.ok(html.includes(`href="${RETRY_URL}"`));
});

test('the failure page is not replaced or reloaded while it is showing', async () => {
  const contents = fakeContents();
  const { recover, reasons } = attach(contents, { budget: createReloadBudget({ delaysMs: [] }) });
  await recover('crashed');
  assert.equal(contents.loaded.length, 1);
  await recover('crashed again');
  assert.equal(contents.loaded.length, 1);
  assert.equal(contents.reloads, 0);
  assert.deepEqual(reasons, ['crashed', 'crashed again'], 'every failure is still reported');
});

test('the retry link reloads the last good page and restores the reload budget', async () => {
  const contents = fakeContents('http://127.0.0.1:3081/chat');
  const { recover } = attach(contents, { budget: createReloadBudget({ delaysMs: [] }) });
  await recover('crashed');
  assert.match(contents.url, /^data:/u);
  let prevented = false;
  contents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, RETRY_URL);
  assert.equal(prevented, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(contents.url, 'http://127.0.0.1:3081/chat');
  assert.equal(contents.loaded.at(-1), 'http://127.0.0.1:3081/chat');
});

test('other navigations are left to the navigation guards', () => {
  const contents = fakeContents();
  attach(contents);
  let prevented = false;
  contents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.com/');
  assert.equal(prevented, false);
});

test('events that are not failures never trigger recovery', async () => {
  const contents = fakeContents();
  const { reasons } = attach(contents);
  contents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  contents.emit('render-process-gone', {}, { reason: 'killed' });
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://x/', true);
  contents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'http://x/', false);
  contents.emit('did-fail-load', {}, -2, 'ERR_FAILED', 'data:text/html,x', true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, []);
  assert.equal(contents.reloads, 0);
});

test('a main-frame load failure and a crash both recover', async () => {
  const contents = fakeContents();
  const { reasons } = attach(contents);
  contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:3081/', true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reasons, ['页面加载失败（ERR_CONNECTION_REFUSED）']);
  assert.equal(contents.reloads, 1);
});

test('a hang is only reloaded when it lasts, and answering again cancels it', async () => {
  const contents = fakeContents();
  const { reasons } = attach(contents, { graceMs: 20 });
  contents.emit('unresponsive');
  contents.emit('responsive');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(reasons, []);
  assert.equal(contents.reloads, 0);

  contents.emit('unresponsive');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(reasons, [UNRESPONSIVE]);
  assert.equal(contents.reloads, 1);
});

test('reloads back off, and the budget refills once its window has passed', () => {
  let at = 0;
  const budget = createReloadBudget({ delaysMs: [10, 20], windowMs: 1000, now: () => at });
  assert.deepEqual([budget.take(), budget.take(), budget.take()], [10, 20, null]);
  at = 1001;
  assert.equal(budget.take(), 10);
  budget.reset();
  assert.equal(budget.take(), 10);
});

test('each automatic reload waits longer than the one before', async () => {
  const contents = fakeContents();
  const waits = [];
  const { recover } = attach(contents, { wait: async (ms) => { waits.push(ms); } });
  await recover('a');
  await recover('b');
  await recover('c');
  assert.deepEqual(waits, [1000, 3000, 8000]);
});

test('the failure page escapes what it prints and long reasons keep their tail', () => {
  const html = failurePageHtml({ label: '<b>', why: '<script>alert(1)</script>', reportPath: 'C:\\a&b' });
  assert.doesNotMatch(html, /<script>alert/u);
  assert.match(html, /&lt;script&gt;/u);
  assert.match(html, /C:\\a&amp;b/u);
  const long = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n');
  const detail = reasonDetail(long);
  assert.match(detail, /^（已截断）/u);
  assert.match(detail, /line 39$/u);
  assert.doesNotMatch(detail, /line 0\b/u);
});

test('crash recovery never raises a dialog', () => {
  for (const file of ['renderer-recovery.js', 'window.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /showMessageBox|showErrorBox|confirmDialog|recoveryConfirm/u, file);
  }
});
