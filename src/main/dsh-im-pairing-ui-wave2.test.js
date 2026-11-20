'use strict';

const nodeTest = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { gateTests, harnessDependencies } = require('../../scripts/lib/test-prerequisites.cjs');

const HARNESS_DEPS = harnessDependencies();
const test = gateTests(nodeTest, HARNESS_DEPS);

const clientBundlePath = path.join(__dirname, '../../vendor/dsh-im/lib/client.js');
const singleOwnerGateUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-im/src/channels/shared/single-owner-gate.mjs')).href;
const singleOwnerRpcUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-im/plugin-src/host/channels/shared/single-owner-rpc.mjs')).href;
const feishuTasksUrl = pathToFileURL(path.join(__dirname, '../../vendor/dsh-im/plugin-src/host/channels/feishu/whale-tasks.mjs')).href;

const clientRequire = createRequire(path.join(__dirname, '../../vendor/dsh-im/package.json'));
const vendorRequire = createRequire(path.join(__dirname, '../../vendor/deepseek-harness/package.json'));
const React = clientRequire('react');
const { JSDOM } = HARNESS_DEPS.ok ? vendorRequire('jsdom') : {};
const { act, createElement: h } = React;

const SINGLE_OWNER_CHANNELS = [
  'weixin',
  'feishu',
  'dingtalk',
  'wecom',
  'qq',
  'slack',
  'telegram',
  'discord',
  'whatsapp',
];

function makeTempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function mountImSettingsWithLiveGate(t, { gate, botsByChannel = {} } = {}) {
  const { createSingleOwnerRpcHandler, SINGLE_OWNER_RPC_CHANNEL } = await import(singleOwnerRpcUrl);
  const accessHandler = createSingleOwnerRpcHandler(gate);

  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', {
    url: 'http://localhost:3123/',
    pretendToBeVisual: true,
  });
  const globalValues = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const savedGlobals = Object.fromEntries(Object.keys(globalValues).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globalValues)) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }

  let registration = null;
  dom.window.__ModuleLoader__ = { load: (entry) => { registration = entry; } };
  vm.runInNewContext(fs.readFileSync(clientBundlePath, 'utf8'), {
    window: dom.window,
    document: dom.window.document,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }, { filename: clientBundlePath });

  const Button = React.forwardRef(function Button({ children, loading, feedback, ...props }, ref) {
    return h('button', { type: 'button', ...props, ref, 'data-loading': loading || undefined }, children);
  });
  const primitives = {
    Button,
    Toast: ({ text }) => h('div', { role: 'status' }, text),
    IconWarningOutlineRegular: () => null,
    useModalLayer() {},
  };
  const plugin = registration.factory((name) => {
    if (name === 'react') return React;
    if (name === 'react-dom') return clientRequire('react-dom');
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
    throw new Error(`Unexpected dependency ${name}`);
  });

  const cleanups = [];
  const entries = [];
  const accessCalls = [];
  let dictionaries = {};
  plugin.apply({
    effect: (setup) => { const dispose = setup(); if (typeof dispose === 'function') cleanups.push(dispose); },
    locale: {
      register: (_ns, dicts) => { dictionaries = dicts; return () => {}; },
      bind: () => (key) => dictionaries?.zh?.[key] ?? key,
      getLocale: () => ({ active: 'zh' }),
    },
    slots: {
      inject: (_name, install) => install(),
      register: (options, component) => { entries.push({ options, component }); return () => {}; },
    },
    workspaces: { listDirectory: async () => [], pickDirectory: async () => '' },
    connection: {
      rpc: {
        call: async (channel, endpoint, payload, signal) => {
          if (channel === SINGLE_OWNER_RPC_CHANNEL) {
            const response = await accessHandler(endpoint, payload, signal);
            accessCalls.push({ endpoint, payload, response });
            return response;
          }
          if (endpoint === 'connection.status') {
            return {
              ok: true,
              value: { schemaVersion: 2, revision: 1, state: 'disconnected', bots: botsByChannel[channel] ?? [] },
            };
          }
          return { ok: true, value: {} };
        },
      },
    },
  });

  const { createRoot } = clientRequire('react-dom/client');
  const root = createRoot(dom.window.document.querySelector('main'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const dispose of cleanups.reverse()) dispose();
    dom.window.close();
    for (const [k, desc] of Object.entries(savedGlobals)) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  });

  const flush = async () => {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
    }
  };
  await act(async () => root.render(h(entries[0].component, entries[0].options.inject())));
  await flush();

  const click = async (el) => {
    assert.ok(el, 'expected target button to exist');
    await act(async () => { el.click(); });
    await flush();
  };
  const selectChannel = (id) => click(dom.window.document.querySelector(`#dim-tab-${id}`));
  const fill = async (input, value) => {
    assert.ok(input, 'expected target input to exist');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await flush();
  };

  return { document: dom.window.document, accessCalls, click, selectChannel, fill, flush };
}

test('IM settings renders SingleOwnerPairingPanel for all 9 single-owner channels and excludes AI Office', async (t) => {
  const { SingleOwnerAccessGate } = await import(singleOwnerGateUrl);
  const home = makeTempDir(t, 'im-pairing-ui-channels-');
  const gate = new SingleOwnerAccessGate({ dshHome: home });
  await gate.load();

  const bench = await mountImSettingsWithLiveGate(t, { gate });
  for (const channel of SINGLE_OWNER_CHANNELS) {
    await bench.selectChannel(channel);
    const panel = bench.document.querySelector(`[data-single-owner-panel="${channel}"]`);
    assert.ok(panel, `SingleOwnerPairingPanel must render for ${channel}`);
  }

  // AI Office Connector MUST stay excluded!
  await bench.selectChannel('office');
  assert.equal(bench.document.querySelector('[data-single-owner-panel]'), null, 'AI Office must NOT render SingleOwnerPairingPanel');
});

test('SingleOwnerPairingPanel approves, revokes, rejects, approves by manual short code, and NEVER leaks raw platform IDs', async (t) => {
  const { SingleOwnerAccessGate } = await import(singleOwnerGateUrl);
  const home = makeTempDir(t, 'im-pairing-ui-flow-');
  const whaleDir = path.join(home, 'data', 'whale');
  fs.mkdirSync(whaleDir, { recursive: true });
  fs.writeFileSync(path.join(whaleDir, 'settings.json'), JSON.stringify({ enabled: true, imDefault: true }), 'utf8');

  const gate = new SingleOwnerAccessGate({ dshHome: home });
  await gate.load();

  const rawSecretOpenId = 'ou_secret_raw_openid_999';
  const rawSecondOpenId = 'ou_second_secret_openid_888';
  const d1 = await gate.evaluateInbound({
    channel: 'feishu',
    botId: 'feishu-bot-1',
    senderId: rawSecretOpenId,
    displayName: '张*三',
    chatType: 'private',
    preset: 'whale-girl',
  });
  assert.equal(d1.reason, 'pairing-required');
  const d2 = await gate.evaluateInbound({
    channel: 'feishu',
    botId: 'feishu-bot-1',
    senderId: rawSecondOpenId,
    displayName: '访客*',
    chatType: 'private',
    preset: 'whale-girl',
  });
  assert.equal(d2.reason, 'pairing-required');

  const bench = await mountImSettingsWithLiveGate(t, { gate });
  await bench.selectChannel('feishu');

  const html = bench.document.body.innerHTML;
  assert.match(html, new RegExp(d1.pairing.code));
  assert.match(html, /张\*三/);
  assert.equal(html.includes(rawSecretOpenId), false, 'raw platform ID MUST NEVER appear in DOM');
  assert.equal(html.includes(rawSecondOpenId), false, 'second raw platform ID MUST NEVER appear in DOM');

  // Verify every access RPC response contains zero raw platform IDs.
  const serializedRpc = JSON.stringify(bench.accessCalls);
  assert.equal(serializedRpc.includes(rawSecretOpenId), false);
  assert.equal(serializedRpc.includes(rawSecondOpenId), false);

  // Reject second pending request first.
  const secondRow = bench.document.querySelector(`[data-pairing-request="${d2.pairing.requestId}"]`);
  assert.ok(secondRow);
  await bench.click(secondRow.querySelector('[data-pairing-action="reject"]'));
  assert.equal(bench.document.querySelector(`[data-pairing-request="${d2.pairing.requestId}"]`), null);

  // One-click approve first pending request -> becomes paired sole owner.
  const firstRow = bench.document.querySelector(`[data-pairing-request="${d1.pairing.requestId}"]`);
  assert.ok(firstRow);
  await bench.click(firstRow.querySelector('[data-pairing-action="approve"]'));
  assert.ok(bench.document.querySelector('[data-pairing-owner="true"]'));
  assert.match(bench.document.querySelector('[data-pairing-owner="true"]').textContent, /张\*三/);
  assert.equal(bench.document.body.innerHTML.includes(rawSecretOpenId), false);

  // Revoke sole owner via ConfirmDialog -> owner cleared.
  await bench.click(bench.document.querySelector('[data-pairing-action="revoke"]'));
  await bench.click(bench.document.querySelector('[data-pairing-action="confirm-revoke"]'));
  assert.equal(bench.document.querySelector('[data-pairing-owner="true"]'), null);

  // Re-request pairing and approve via manual short-code form!
  const d3 = await gate.evaluateInbound({
    channel: 'feishu',
    botId: 'feishu-bot-1',
    senderId: rawSecretOpenId,
    displayName: '张*三',
    chatType: 'private',
    preset: 'whale-girl',
  });
  await bench.click(bench.document.querySelector('[data-pairing-action="refresh"]'));
  const codeInput = bench.document.querySelector('.dim-pairingCodeInput');
  await bench.fill(codeInput, d3.pairing.code.toLowerCase());
  const submitBtn = bench.document.querySelector('[data-pairing-action="approve-code"]');
  await act(async () => {
    submitBtn.closest('form').dispatchEvent(new bench.document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
  });
  await bench.flush();
  assert.ok(bench.document.querySelector('[data-pairing-owner="true"]'), 'manual short-code approval must bind sole owner');
  assert.equal(bench.document.body.innerHTML.includes(rawSecretOpenId), false);
});

nodeTest('paired single-owner Feishu user runs natural /task goal/list/status/stop without multi-tenant owners or JSON syntax', async (t) => {
  const { SingleOwnerAccessGate } = await import(singleOwnerGateUrl);
  const { createFeishuTaskBinding } = await import(feishuTasksUrl);
  const base = makeTempDir(t, 'feishu-natural-task-');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, 'data', 'whale'), { recursive: true });
  fs.writeFileSync(path.join(home, 'data', 'whale', 'settings.json'), JSON.stringify({ sessionId: 'resident', enabled: true, imDefault: true }), 'utf8');

  const prevHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  t.after(() => {
    if (prevHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prevHome;
  });

  const gate = new SingleOwnerAccessGate({ dshHome: home });
  await gate.load();
  await gate.setOwner({
    channel: 'feishu',
    botId: 'bot-nat',
    platformUserId: 'owner-nat-1',
    displayName: '主*人',
    source: 'paired',
  });

  // Notice: botConfig has NO legacy ownerOpenIds, and whaleTasks starts with NO pre-populated multi-tenant owners!
  const botConfig = { id: 'bot-nat', appId: 'app-nat', createdAt: 't1', connectedAt: 't2', ownerOpenIds: [] };
  const owners = new Map();
  const tasks = new Map();
  const sentMessages = [];
  const service = {
    available: true,
    scope: { get: () => ({ sessionId: 'resident', imDefault: true }) },
    assertImRoute(route) {
      const owner = owners.get(`feishu:${route.botId}`);
      if (!owner || owner.actor !== route.actor) throw new Error('owner-mismatch');
    },
    store: {
      owners: { get: (k) => owners.get(k) ?? null },
      tasks: { get: (id) => tasks.get(id) ?? null },
      get: (id) => {
        const found = tasks.get(id);
        if (!found) throw new Error('missing-task');
        return found;
      },
    },
    async setOwner(botId, actor) { owners.set(`feishu:${botId}`, { actor }); },
    registerChannel() { return () => {}; },
    async recordInbound() {},
    async accept(origin) {
      const parsed = JSON.parse(origin.text.slice('/task '.length));
      const task = { id: 'task-nat-1', goal: parsed.goal, state: 'queued', origin };
      tasks.set(task.id, task);
      return task;
    },
    schedule() {},
    list() { return [...tasks.values()]; },
    view(task) { return { id: task.id, goal: task.goal, state: task.state }; },
    grantControl(id, action, meta, validate) { validate(); return { id, action, meta }; },
    assertControl() {},
    async stop(id) {
      const item = tasks.get(id);
      if (item) item.state = 'cancelled';
      return item;
    },
  };

  const botGate = gate.createBotGate({ channel: 'feishu', botId: 'bot-nat', botConfig, home });
  const abort = new AbortController();
  t.after(() => abort.abort());
  const binding = createFeishuTaskBinding(
    { get: () => service, on: () => () => {} },
    {
      botId: 'bot-nat',
      botConfig,
      configStore: { list: () => [botConfig] },
      workspaces: { has: () => true, agentPresetFor: () => null },
      accessGate: botGate,
    },
  );
  const adapter = binding.attach({
    client: {
      im: {
        message: {
          create: async (req) => {
            sentMessages.push(req);
            return { code: 0, data: { message_id: `m-${sentMessages.length}` } };
          },
        },
      },
    },
    signal: abort.signal,
    allowedSenderOpenIds: new Set(),
  });

  const event = { sender: { sender_id: { open_id: 'owner-nat-1' } }, message: { message_id: 'msg-1', chat_id: 'chat-1' } };
  const harness = { agentPresetSettings: async () => ({ agentPreset: null }) };

  // Natural `/task <goal>` with attached text file works without JSON or manual multi-tenant owner setup!
  const created = await adapter.handle(
    event,
    {
      content: '/task 整理这周的研发周报',
      files: [{ name: 'notes.txt', load: async () => Buffer.from('Wave 2 progress summary', 'utf8') }],
    },
    harness,
  );
  assert.match(created, /已接纳 task-nat-1/);
  assert.equal(tasks.get('task-nat-1').goal, '整理这周的研发周报');

  // Natural `/task list`, `/task status <id>`, `/task stop <id>` work cleanly via adapter.command().
  const listed = await adapter.command(event, { content: '/task list' });
  assert.match(listed, /task-nat-1/);

  const statusReply = await adapter.command(
    { ...event, message: { ...event.message, message_id: 'msg-status' } },
    { content: '/task status task-nat-1' },
  );
  assert.equal(statusReply.taskReplySent, true);
  assert.match(sentMessages[0].data.content, /task-nat-1/);

  const stopped = await adapter.command(
    { ...event, message: { ...event.message, message_id: 'msg-stop' } },
    { content: '/task stop task-nat-1' },
  );
  assert.match(stopped, /已停止 task-nat-1/);
  assert.equal(tasks.get('task-nat-1').state, 'cancelled');

  // Non-owner is still strictly refused.
  const strangerEvent = { sender: { sender_id: { open_id: 'stranger-9' } }, message: { message_id: 'msg-2', chat_id: 'chat-2' } };
  const denied = await adapter.handle(strangerEvent, { content: '/task 偷看资料', files: [] }, harness);
  assert.match(denied, /不能提交后台任务/);
});
