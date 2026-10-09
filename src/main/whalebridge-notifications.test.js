'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createWhaleBridgeService } = require('../launcher/whalebridge');
const { startWhaleBridgeNotifications, quotaNotification } = require('./whalebridge-notifications');

const alert = { Provider: 'clinepass', Name: 'ClinePass', User: 'account', Window: 'weekly', Used: 95,
  Balance: '', ResetsAt: '2026-10-08T00:00:00Z', Kind: '', Credits: 0 };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('host reads authenticated quota notices from loopback without a management window', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whalebridge-notices-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const secret = 'a'.repeat(32);
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/api/subscriptions/alerts/claim');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.cookie, `magpie_web_${server.address().port}=${secret}`);
    assert.equal(request.headers.authorization, undefined);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ sequence: 7, alerts: [{ sequence: 7, alert }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const service = createWhaleBridgeService({ root, dshHome: root });
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data/state.json'), JSON.stringify({ id: 'whalebridge', ready: true,
    pid: process.pid, version: '1.0.0', url: `http://127.0.0.1:${server.address().port}/?k=${secret}` }));
  assert.deepEqual(await service.alerts(), { sequence: 7, alerts: [{ sequence: 7, alert }] });
  fs.rmSync(path.join(root, 'data/state.json'));
  assert.deepEqual(await service.alerts(), { sequence: 0, alerts: [] });
});

function watcher(t, overrides = {}) {
  let current = { pid: 10, url: 'http://127.0.0.1:3427/' }, timer, cleared = false;
  const shown = [], requests = [], errors = [];
  const batches = [{ sequence: 1, alerts: [{ sequence: 1, alert }] }];
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(value) { super(); this.value = value; }
    show() { shown.push(this); }
  }
  const service = { state: () => current, alerts: async active => {
    requests.push(active.pid);
    return batches.shift() || { sequence: 1, alerts: [] };
  } };
  const stop = startWhaleBridgeNotifications({ service, Notification,
    environment: { platform: 'win32', defaultApp: false }, onError: error => errors.push(error),
    setInterval: callback => { timer = callback; return { unref() {} }; },
    clearInterval: () => { cleared = true; }, ...overrides });
  t.after(stop);
  return { shown, requests, errors, batches, stop, setState: value => { current = value; },
    tick: async () => { timer(); await turn(); }, cleared: () => cleared };
}

test('one host delivers a notice once, resets the cursor after component restart, and stops cleanly', async t => {
  const f = watcher(t);
  await turn();
  assert.equal(f.shown.length, 1);
  assert.match(f.shown[0].value.title, /ClinePass.*account/);
  assert.match(f.shown[0].value.body, /95%/);
  f.batches.push({ sequence: 1, alerts: [{ sequence: 1, alert }] });
  await f.tick();
  assert.equal(f.shown.length, 1);
  assert.deepEqual(f.requests, [10, 10]);
  f.setState({ pid: 11 });
  f.batches.push({ sequence: 1, alerts: [{ sequence: 1, alert: { ...alert, Kind: 'renews' } }] });
  await f.tick();
  assert.equal(f.requests.at(-1), 11);
  assert.equal(f.shown.length, 2);
  assert.match(f.shown[1].value.body, /重置/);
  f.stop(); await f.tick();
  assert.equal(f.cleared(), true);
  assert.equal(f.requests.length, 3);
  assert.equal(f.errors.length, 0);
});

test('raw Windows Electron never initializes a notification presenter', async t => {
  let supports = 0;
  class Notification { static isSupported() { supports++; throw new Error('presenter must not initialize'); } }
  const f = watcher(t, { Notification, environment: { platform: 'win32', defaultApp: true } });
  await turn();
  assert.equal(supports, 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.requests.length, 0);
});

test('a stopped host cannot emit a pending component response', async t => {
  let resolve;
  const service = { state: () => ({ pid: 10 }), alerts: () => new Promise(done => { resolve = done; }) };
  const f = watcher(t, { service });
  f.stop();
  resolve({ sequence: 1, alerts: [{ sequence: 1, alert }] });
  await turn();
  assert.equal(f.shown.length, 0);
  assert.equal(f.errors.length, 0);
  assert.match(quotaNotification({ ...alert, Kind: 'expires', Credits: 3 }).body, /3 次.*到期/);
  assert.match(quotaNotification({ ...alert, Balance: '0' }).body, /余额.*0/);
});
