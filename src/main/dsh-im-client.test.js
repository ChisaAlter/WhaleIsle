'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const clientPath = path.join(__dirname, '../../vendor/dsh-im/lib/client.js');
const clientRequire = createRequire(path.join(__dirname, '../../vendor/dsh-im/package.json'));
const vendorRequire = createRequire(path.join(__dirname, '../../vendor/deepseek-harness/package.json'));
const React = clientRequire('react');
const { JSDOM } = vendorRequire('jsdom');
const { act, createElement: h } = React;

const snapshot = (bots = []) => ({ schemaVersion: 2, revision: 1, state: 'disconnected', bots });

// Exercise the shipped module, settings registration and real React events.
// Only RPC and primitive appearance are substituted; pixel layout and scrolling
// belong to the production Button's browser checks.
async function settingsBench(t, { bots = {}, language = 'zh' } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost', pretendToBeVisual: true,
  });
  const globalValues = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const savedGlobals = Object.fromEntries(Object.keys(globalValues).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = clientRequire('react-dom/client');
  const cleanups = [], entries = [], requests = [], pending = new Map();
  let registration, dictionaries;
  dom.window.__ModuleLoader__ = { load: value => { registration = value; } };
  vm.runInNewContext(fs.readFileSync(clientPath, 'utf8'), {
    window: dom.window, document: dom.window.document, AbortController,
    setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: clientPath });
  const Button = React.forwardRef(function Button({ children, loading, feedback, ...props }, ref) {
    return h('button', { type: 'button', ...props, ref, 'data-shared-button': true, 'data-shared-loading': loading || undefined, 'data-shared-ref': ref != null || undefined }, children);
  });
  const primitives = {
    Button,
    Toast: ({ text }) => h('div', { role: 'status' }, text),
    IconWarningOutlineRegular: () => null,
    useModalLayer() {},
  };
  const plugin = registration.factory(name => {
    if (name === 'react') return React;
    if (name === 'react-dom') return clientRequire('react-dom');
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`Unexpected client dependency ${name}`);
  });
  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const dispose of cleanups.reverse()) dispose();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(savedGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  plugin.apply({
    effect: setup => { const dispose = setup(); if (typeof dispose === 'function') cleanups.push(dispose); },
    locale: {
      register: (_namespace, value) => { dictionaries = value; return () => {}; },
      bind: () => key => dictionaries?.[language]?.[key] ?? key,
      getLocale: () => ({ active: language }),
    },
    slots: {
      inject: (_name, install) => install(),
      register: (options, component) => { entries.push({ options, component }); return () => {}; },
    },
    workspaces: { listDirectory() { throw new Error('Directory picker was not requested'); }, pickDirectory() {} },
    connection: { rpc: { call: async (channel, endpoint, payload) => {
      requests.push({ channel, endpoint, payload });
      if (endpoint === 'connection.status') return { ok: true, value: snapshot(bots[channel]) };
      const deferred = pending.get(`${channel}:${endpoint}`);
      assert.ok(deferred, `No external RPC is allowed: ${channel}:${endpoint}`);
      return deferred.promise;
    } } },
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].options.name, 'settings.remote.tab');
  await act(async () => root.render(h(entries[0].component, entries[0].options.inject())));
  const flush = async () => { await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); };
  const click = async element => {
    assert.ok(element, 'The requested control is reachable');
    await act(async () => { element.focus(); element.click(); });
    await flush();
  };
  return {
    document: dom.window.document, window: dom.window, requests, flush, click,
    selectChannel: id => click(dom.window.document.querySelector(`#dim-tab-${id}`)),
    defer: (channel, endpoint) => {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending.set(`${channel}:${endpoint}`, { promise });
      return async value => { await act(async () => { resolve(value); }); await flush(); };
    },
    fill: async (input, value) => {
      assert.ok(input, 'The credential input is reachable');
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
      await act(async () => {
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
  };
}

function assertSharedBusy(button, label) {
  assert.ok(button, 'The action remains in the DOM');
  assert.equal(button.dataset.sharedButton, 'true', 'The action renders through the shared primitive');
  assert.equal(button.dataset.sharedLoading, 'true', 'The shared primitive receives the loading state');
  assert.equal(button.dataset.loading, 'true', 'The IM loading attribute remains available');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, label, 'The complete caption reaches the shared primitive');
  assert.equal(button.querySelector('.dim-buttonSpinner'), null, 'The action owns no second spinner');
}

for (const [channel, prefix, ariaLabel] of [
  ['feishu', 'bxf', '扫码接入飞书机器人'],
  ['dingtalk', 'ddt', '扫码接入钉钉机器人'],
]) {
  test(`${channel} QR action keeps complex caption and native attributes while pending`, async t => {
    const bench = await settingsBench(t);
    await bench.selectChannel(channel);
    const settle = bench.defer(`/${channel}`, 'provision.begin');
    const button = bench.document.querySelector('.dim-scanButton');
    assert.equal(button.classList.contains(`${prefix}-button`), true);
    assert.equal(button.dataset.kind, 'primary');
    assert.equal(button.type, 'button');
    assert.equal(button.dataset.sharedRef, 'true', 'The action ref reaches the shared primitive');
    assert.ok(button.querySelector('svg'), 'The existing leading icon is preserved');
    await bench.click(button);
    assertSharedBusy(button, '扫码接入机器人');
    assert.equal(button.getAttribute('aria-label'), ariaLabel);
    assert.equal(bench.requests.filter(call => call.endpoint === 'provision.begin').length, 1);
    await bench.click(button);
    assert.equal(bench.requests.filter(call => call.endpoint === 'provision.begin').length, 1, 'A disabled action does not submit twice');
    await settle({ ok: false, error: { code: 'fixture/rejected', message: 'Fixture request failed' } });
    assertSharedBusy(button, '扫码接入机器人');
    assert.match(bench.document.querySelector('[role="alert"]').textContent, /Fixture request failed/);
    await bench.click([...bench.document.querySelectorAll('button')].find(element => element.textContent === '关闭'));
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute('data-loading'), false);
    assert.equal(button.hasAttribute('data-shared-loading'), false);
    assert.equal(button.textContent, '扫码接入机器人');
  });
}

test('manual credentials use the shared busy button without changing form submission or error recovery', async t => {
  const bench = await settingsBench(t);
  await bench.selectChannel('dingtalk');
  await bench.click(bench.document.querySelector('.dim-credentialButton'));
  const form = bench.document.querySelector('.dim-credentialForm');
  const inputs = form.querySelectorAll('input');
  await bench.fill(inputs[0], 'fixture-client-id');
  await bench.fill(inputs[1], 'fixture-client-secret');
  const button = form.querySelector('button[type="submit"]');
  assert.equal(button.disabled, false);
  const settle = bench.defer('/dingtalk', 'bot.bind-credentials');
  await bench.click(button);
  assertSharedBusy(button, '绑定并连接');
  assert.equal(button.type, 'submit');
  assert.equal(button.classList.contains('ddt-button'), true);
  assert.equal(button.dataset.kind, 'primary');
  assert.equal(inputs[0].disabled, true);
  assert.equal(inputs[1].disabled, true);
  const request = bench.requests.find(call => call.endpoint === 'bot.bind-credentials');
  assert.equal(request.payload.clientId, 'fixture-client-id');
  assert.equal(request.payload.clientSecret, 'fixture-client-secret');
  await settle({ ok: false, error: { code: 'fixture/rejected', message: 'Fixture binding failed' } });
  assert.equal(button.disabled, false);
  assert.equal(button.hasAttribute('data-loading'), false);
  assert.match(form.textContent, /Fixture binding failed/);
  assert.equal(inputs[1].value, 'fixture-client-secret');
});

test('Telegram access save keeps its full caption and restores the action after success', async t => {
  const account = { botId: 'fixture-bot', state: 'connected', connected: true, bot: { name: 'Fixture bot' }, accessPolicy: { accessMode: 'compatible', allowedUsers: [] } };
  const bench = await settingsBench(t, { bots: { '/telegram': [account] } });
  await bench.selectChannel('telegram');
  const settle = bench.defer('/telegram', 'bot.access-policy.set');
  const button = bench.document.querySelector('.dtg-accessActions button');
  await bench.click(button);
  assertSharedBusy(button, '保存访问设置');
  assert.equal(button.type, 'submit');
  assert.equal(button.dataset.kind, 'secondary');
  assert.equal(bench.document.querySelector('select[aria-label="Telegram 访问模式"]').disabled, true);
  await settle({ ok: true, value: snapshot([account]) });
  assert.equal(button.disabled, false);
  assert.equal(button.hasAttribute('data-loading'), false);
  assert.equal(button.textContent, '保存访问设置');
});

test('English IM captions reach the shared busy button without being shortened', async t => {
  const bench = await settingsBench(t, { language: 'en' });
  await bench.selectChannel('feishu');
  const settle = bench.defer('/feishu', 'provision.begin');
  const button = bench.document.querySelector('.dim-scanButton');
  await bench.click(button);
  assertSharedBusy(button, 'Scan QR code');
  assert.equal(button.getAttribute('aria-label'), 'Connect Feishu bot by QR code');
  await settle({ ok: false, error: { message: 'Fixture request failed' } });
});
