import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  MOBILE_BOTS_RPC_ALLOWLIST,
  normalizeMobileAccessDecision,
  callBotsRpc,
  normalizeBotsList,
  normalizeBotItems,
  normalizeAccessRequests,
  normalizeBotGroups,
  buildBotsDigest,
  createBotsBridge,
  ensureBotsState,
  hasBotsSubView,
  stepBackBotsView,
  getBotsOverlayElement,
  syncBotsDrawerEntry,
  renderBotsOverlay,
} from '../app/bots-view.js';

const require = createRequire(import.meta.url);
const {
  HOST_RPC_METHODS,
  DSH_BOTS_RPC_METHODS,
  isAllowedHostMethod,
  isAllowedDshBotsMethod,
  resolveDshBotsWireMethod,
  forwardHostRpc,
  forwardDshBotsRpc,
} = require('../../../src/shared/dshd-host-tunnel.js');

const REQUIRED_SAFE_METHODS = [
  'bots.list',
  'bots.items.list',
  'bots.items.detail',
  'bots.items.ownerComment',
  'bots.items.ownerStatus',
  'bots.items.ownerSnooze',
  'bots.access.list',
  'bots.access.decide',
  'bots.groups.list',
  'bots.groups.messages',
  'bots.groups.send',
  'bots.groups.approvePlan',
  'bots.budget.get',
  'bots.budget.usage',
  'bots.decisions.read',
];

const BLOCKED_SENSITIVE_METHODS = [
  'bots.delete',
  'bots.create',
  'bots.soul.write',
  'bots.files.write',
  'bots.tools.add',
  'bots.tools.remove',
  'bots.share.import',
  'bots.connectors.webhooks.create',
  'bots.settings.set',
  'bots.automations.create',
];

function createMockDocument() {
  class MockNode {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = {};
      this.listeners = new Map();
      this.value = '';
      this.disabled = false;
      this._text = '';
      this.classList = {
        add: (cls) => {
          const set = new Set(String(this.attrs.class || '').split(/\s+/).filter(Boolean));
          set.add(cls);
          this.attrs.class = [...set].join(' ');
        },
        remove: (cls) => {
          const set = new Set(String(this.attrs.class || '').split(/\s+/).filter(Boolean));
          set.delete(cls);
          this.attrs.class = [...set].join(' ');
        },
        contains: (cls) => String(this.attrs.class || '').split(/\s+/).includes(cls),
      };
    }

    set textContent(v) {
      this._text = String(v ?? '');
      this.children = [];
    }

    get textContent() {
      if (!this.children.length) return this._text;
      return this.children.map((c) => c.textContent ?? String(c)).join('');
    }

    setAttribute(name, value) {
      this.attrs[name] = String(value);
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        this.dataset[key] = String(value);
      }
    }

    getAttribute(name) {
      return this.attrs[name] ?? null;
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    append(...nodes) {
      for (const n of nodes) this.appendChild(n);
    }

    replaceChildren(...nodes) {
      this.children = [...nodes];
    }

    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }

    click() {
      for (const fn of this.listeners.get('click') || []) fn();
    }

    querySelector(selector) {
      const match = (node) => {
        if (selector.startsWith('.')) {
          return node.classList?.contains(selector.slice(1));
        }
        const attrMatch = selector.match(/^\[([a-z0-9-]+)="([^"]+)"\]$/i);
        if (attrMatch) {
          return node.attrs?.[attrMatch[1]] === attrMatch[2];
        }
        return false;
      };
      const queue = [...this.children];
      while (queue.length) {
        const next = queue.shift();
        if (next && next.nodeType === 1) {
          if (match(next)) return next;
          queue.push(...(next.children || []));
        }
      }
      return null;
    }
  }

  return {
    createElement: (tag) => new MockNode(tag),
    createElementNS: (_ns, tag) => new MockNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  };
}

describe('Mobile E2EE dshBots.rpc tunnel and bots view bridge', () => {
  test('dshd-host-tunnel whitelists dshBots.rpc safe subset and rejects arbitrary methods without calling fetch', async () => {
    assert.equal(isAllowedHostMethod('dshBots.rpc'), true);
    assert.equal(HOST_RPC_METHODS.has('dshBots.rpc'), true);

    for (const method of REQUIRED_SAFE_METHODS) {
      assert.equal(isAllowedDshBotsMethod(method), true, `expected allowlisted: ${method}`);
      assert.equal(DSH_BOTS_RPC_METHODS.has(method), true);
    }
    assert.equal(resolveDshBotsWireMethod('bots.items.detail'), 'bots.items.owner.show');
    assert.equal(resolveDshBotsWireMethod('bots.items.ownerComment'), 'bots.items.owner.comment');
    assert.equal(resolveDshBotsWireMethod('bots.items.ownerStatus'), 'bots.items.owner.status');
    assert.equal(resolveDshBotsWireMethod('bots.items.ownerSnooze'), 'bots.items.owner.snooze');
    assert.equal(resolveDshBotsWireMethod('bots.groups.messages'), 'bots.groups.read');

    let fetchCalls = 0;
    const fakeFetch = async () => {
      fetchCalls += 1;
      return new Response('{}');
    };
    for (const blocked of BLOCKED_SENSITIVE_METHODS) {
      assert.equal(isAllowedDshBotsMethod(blocked), false, `expected blocked: ${blocked}`);
      await assert.rejects(
        () => forwardHostRpc({
          origin: 'http://127.0.0.1:3080',
          method: 'dshBots.rpc',
          payload: { method: blocked, params: {} },
          fetchImpl: fakeFetch,
        }),
        /dshBots 方法不允许转发/,
      );
    }
    await assert.rejects(
      () => forwardDshBotsRpc({ origin: 'http://127.0.0.1:3080', payload: {}, fetchImpl: fakeFetch }),
      /dshBots 方法不允许转发/,
    );
    assert.equal(fetchCalls, 0);
  });

  test('forwardHostRpc forwards whitelisted dshBots.rpc to loopback /dsh-bots/rpc with cookie and wire alias', async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url: String(url), headers: init.headers, body });
      if (body.method === 'bots.items.owner.comment') {
        return new Response(JSON.stringify({ ok: true, result: { saved: true, uid: body.params.uid } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'missing' } }));
    };

    const okRes = await forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'dshBots.rpc',
      payload: { method: 'bots.items.ownerComment', params: { uid: 'item-1', text: '批准上线' } },
      cookie: 'dsh-browser-session=tok123',
      fetchImpl,
    });
    assert.equal(okRes.ok, true);
    assert.deepEqual(okRes.value, { saved: true, uid: 'item-1' });
    assert.equal(requests[0].url, 'http://127.0.0.1:3080/dsh-bots/rpc');
    assert.equal(requests[0].headers.Cookie, 'dsh-browser-session=tok123');
    assert.deepEqual(requests[0].body, {
      method: 'bots.items.owner.comment',
      params: { uid: 'item-1', text: '批准上线' },
    });

    const errRes = await forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'dshBots.rpc',
      payload: { args: { method: 'bots.decisions.read', params: { itemUid: 'missing' } } },
      fetchImpl,
    });
    assert.equal(errRes.ok, false);
    assert.equal(errRes.error.code, 'not_found');

    // Non-loopback origin must still be rejected
    await assert.rejects(
      () => forwardHostRpc({
        origin: 'http://example.com:3080',
        method: 'dshBots.rpc',
        payload: { method: 'bots.list', params: {} },
        fetchImpl,
      }),
      /loopback/,
    );
  });

  test('createBotsBridge drives full mobile workflow through dshBots.rpc tunnel', async () => {
    const dispatched = [];
    const fetchImpl = async (_url, init) => {
      const { method, params } = JSON.parse(init.body);
      dispatched.push({ method, params });
      const fixtures = {
        'bots.list': { bots: [{ id: 'cap', name: '船长', status: 'ready', needsYouCount: 1, role: '总管' }] },
        'bots.items.list': {
          items: [
            { uid: 'it-1', ownerBotId: 'cap', title: '确认发布 v0.4', status: 'needs_you', summary: '等待拍板' },
            { uid: 'it-2', ownerBotId: 'cap', title: '夜间回归测试', status: 'done', summary: '全部通过' },
          ],
        },
        'bots.access.list': {
          requests: [{ id: 'acc-1', botId: 'cap', channel: 'feishu', senderName: '产品同学', status: 'pending' }],
        },
        'bots.groups.list': {
          groups: [{ id: 'grp-1', name: '发布战情室', memberBotIds: ['cap', 'qa'], awaitingApproval: true, pendingPlanId: 'plan-9' }],
        },
        'bots.budget.usage': { costUsd: 1.25, dailyLimitUsd: 5, isOffPeak: true },
        'bots.budget.get': { botId: 'cap', dailyLimitUsd: 5 },
        'bots.items.owner.show': { item: { uid: 'it-1', title: '确认发布 v0.4' } },
        'bots.decisions.read': { rows: [{ ts: '2026-11-22T10:00:00Z', actor: 'cap', phase: 'verify', decision: 'needs_you' }] },
        'bots.items.owner.comment': { ok: true },
        'bots.items.owner.status': { ok: true },
        'bots.items.owner.snooze': { ok: true },
        'bots.access.decide': { ok: true, decision: params.decision },
        'bots.groups.read': { messages: [{ senderName: '船长', text: 'Plan 已就绪' }] },
        'bots.groups.send': { ok: true },
        'bots.groups.approvePlan': { ok: true, planId: params.planId },
      };
      return new Response(JSON.stringify({ ok: true, result: fixtures[method] }));
    };

    const pairedClient = {
      hostRpc: (method, payload) => forwardHostRpc({
        origin: 'http://127.0.0.1:3080',
        method,
        payload,
        fetchImpl,
      }),
    };

    assert.equal(MOBILE_BOTS_RPC_ALLOWLIST.length, 15);
    assert.equal(normalizeMobileAccessDecision('denied'), 'declined');
    assert.equal(normalizeMobileAccessDecision('approve'), 'granted');
    await assert.rejects(() => callBotsRpc(pairedClient, 'bots.delete', { botId: 'cap' }), /不允许/);

    const bridge = createBotsBridge(pairedClient);
    const overview = await bridge.loadOverview();
    assert.equal(overview.bots.length, 1);
    assert.equal(overview.digest.needsYou.count, 2);
    assert.equal(overview.digest.progress.doneCount, 1);
    assert.equal(overview.digest.fleet.pendingPlanCount, 1);
    assert.equal(overview.digest.fleet.costUsd, 1.25);

    const detail = await bridge.loadItemDetail('it-1');
    assert.equal(detail.decisions.length, 1);

    await bridge.replyItem('it-1', '同意发布');
    await bridge.updateItemStatus('it-1', 'done', '已确认');
    await bridge.snoozeItem('it-1', 1_900_000_000_000);
    const deniedRes = await bridge.decideAccess('acc-1', 'denied');
    assert.equal(deniedRes.decision, 'declined');
    const msgs = await bridge.loadGroupMessages('grp-1');
    assert.equal(msgs.messages.length, 1);
    await bridge.sendGroupMessage('grp-1', '开始执行');
    const planRes = await bridge.approveGroupPlan('grp-1', 'plan-9', true);
    assert.equal(planRes.planId, 'plan-9');
    const budget = await bridge.getBudget('cap');
    assert.equal(budget.dailyLimitUsd, 5);
    assert.ok(dispatched.some((call) => call.method === 'bots.access.decide' && call.params.decision === 'declined'));
  });

  test('bots-view state helpers, back stack stepping, and DOM overlay rendering work without raw HTML', () => {
    const prevDoc = globalThis.document;
    globalThis.document = createMockDocument();
    try {
      const state = { botsOpen: true, chisacode: null };
      const view = ensureBotsState(state);
      view.bots = normalizeBotsList([{ id: 'b1', name: '大副', status: 'ready', needsYouCount: 1 }]);
      view.items = normalizeBotItems([{ uid: 'u1', ownerBotId: 'b1', title: '确认方案', status: 'needs_you' }]);
      view.access = normalizeAccessRequests([{ id: 'a1', channel: 'telegram', senderName: 'Bob', status: 'pending' }]);
      view.groups = normalizeBotGroups([{ id: 'g1', name: '舰桥', memberBotIds: ['b1'], awaitingApproval: true, pendingPlanId: 'p1' }]);
      view.digest = buildBotsDigest(view);

      // Step back pops sub-views before closing overlay
      view.selectedItemUid = 'u1';
      assert.equal(hasBotsSubView(state), true);
      assert.equal(stepBackBotsView(state), true);
      assert.equal(state.botsOpen, true);
      assert.equal(hasBotsSubView(state), false);
      assert.equal(stepBackBotsView(state), false);
      assert.equal(state.botsOpen, false);

      // Drawer entry mounts once and reflects pending count
      const drawer = globalThis.document.createElement('aside');
      const nav = globalThis.document.createElement('nav');
      nav.setAttribute('class', 'drawer-nav');
      drawer.append(nav);
      let opened = 0;
      syncBotsDrawerEntry({ drawer, state, onOpen: () => { opened += 1; } });
      syncBotsDrawerEntry({ drawer, state, onOpen: () => { opened += 1; } });
      assert.equal(nav.children.length, 1);
      assert.match(nav.children[0].textContent, /大肥鱼/);
      assert.match(nav.children[0].textContent, /2/);
      nav.children[0].click();
      assert.equal(opened, 1);

      // Render overlay across all 4 tabs cleanly
      const phone = globalThis.document.createElement('div');
      state.botsOpen = true;
      for (const tab of ['digest', 'needs_you', 'access', 'groups']) {
        view.tab = tab;
        renderBotsOverlay({ phone, state, visible: true, onBack: () => {} });
        const overlay = getBotsOverlayElement(phone);
        assert.ok(overlay);
        assert.equal(overlay.classList.contains('hidden'), false);
      }
      renderBotsOverlay({ phone, state, visible: false, onBack: () => {} });
      assert.equal(getBotsOverlayElement(phone).classList.contains('hidden'), true);
    } finally {
      globalThis.document = prevDoc;
    }
  });
});
