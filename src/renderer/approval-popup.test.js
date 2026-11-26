'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('approval-popup.html narrows img-src and adds base-uri, form-action, and object-src none', () => {
  const html = fs.readFileSync(path.join(__dirname, 'approval-popup.html'), 'utf8');
  assert.match(html, /img-src 'self' data: http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(html, /http:\/\/localhost:\*/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /object-src 'none'/);
});

test('approval-popup.js validates subject.icon against harnessOrigin/bitmap data URI and syncs colorScheme', () => {
  const src = fs.readFileSync(path.join(__dirname, 'approval-popup.js'), 'utf8');
  assert.match(src, /document\.documentElement\.style\.colorScheme = isDark \? 'dark' : 'light'/);
  assert.match(src, /function sanitizeSubjectIcon\(raw, harnessOrigin\)/);
  assert.match(src, /iconUrl\.origin === originUrl\.origin/);
});

test('approval-popup reuses action buttons across state updates, clears stale toast timer, and wraps narrow footer', async () => {
  const css = fs.readFileSync(path.join(__dirname, 'approval-popup.css'), 'utf8');
  assert.match(css, /\.footer\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.actions\s*\{[^}]*flex-wrap:\s*wrap/s);

  const vm = require('node:vm');
  class Node {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.children = [];
      this.attrs = new Map();
      this.dataset = {};
      this.style = { setProperty() {} };
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.className = '';
      this.textContent = '';
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); }
    addEventListener(t, fn) {
      if (!this.listeners.has(t)) this.listeners.set(t, []);
      this.listeners.get(t).push(fn);
    }
    appendChild(c) { this.children.push(c); return c; }
    replaceChildren(...nodes) {
      this.children = nodes.flatMap((n) => (n.tagName === 'FRAGMENT' ? n.children : [n]));
    }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { width: 88 }; }
  }
  const byId = new Map();
  for (const id of ['card', 'kind-label', 'pager', 'pager-count', 'prev-btn', 'next-btn', 'dismiss-btn',
    'meta-row', 'session-name', 'requester-tag', 'subject-row', 'subject-icon', 'subject-name',
    'card-title', 'card-description', 'card-preview', 'open-session-btn', 'actions', 'toast']) {
    byId.set(id, new Node('div', id));
  }
  const doc = {
    activeElement: null,
    documentElement: new Node('html'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new Node(tag),
    createDocumentFragment: () => new Node('fragment'),
  };
  const timers = new Map();
  let tid = 0;
  let onStateCb = null;
  const viewBase = {
    visible: true,
    locale: 'zh',
    total: 1,
    selectedIndex: 0,
    items: [{ eventId: 'evt-1', kind: 'tool-approval' }],
    activeItem: {
      eventId: 'evt-1',
      kind: 'tool-approval',
      sessionId: 's1',
      sessionTitle: 'Session',
      title: 'Run command',
      description: null,
      toolName: 'bash',
      commandPreview: 'echo hi',
      planSummary: null,
      subject: null,
      requester: null,
      approveLabel: null,
      capabilities: { allowOnce: true, allowAlways: true, reject: true, requestChanges: false },
      busyAction: null,
    },
    error: null,
  };
  const bridge = {
    getState: async () => viewBase,
    decide: async () => ({ ok: true }),
    select: () => {},
    openSession: async () => ({}),
    dismiss: () => {},
    onState: (cb) => { onStateCb = cb; return () => {}; },
    onTheme: () => () => {},
  };
  const win = {
    dshApprovalPopup: bridge,
    addEventListener: () => {},
    getComputedStyle: () => ({}),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'approval-popup.js'), 'utf8'), {
    document: doc,
    window: win,
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { const id = ++tid; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  });
  await new Promise((r) => setImmediate(r));

  const firstAllow = byId.get('actions').children.find((b) => b.dataset.actionKey === 'evt-1:allow-once');
  firstAllow.focus();
  onStateCb({ ...viewBase, error: { eventId: 'evt-1', message: '错误1', at: 1 } });
  const firstShowTimer = [...timers.values()][0];
  assert.equal(firstShowTimer.ms, 4000);
  // Trigger fade-out step so the 200ms hide timer is armed before the second toast arrives.
  firstShowTimer.fn();
  const hideEntry = [...timers.entries()].find(([, entry]) => entry.ms === 200);
  assert.ok(hideEntry, 'arms 200ms toastHideTimer');
  onStateCb({ ...viewBase, activeItem: { ...viewBase.activeItem, busyAction: 'allow-once' }, error: { eventId: 'evt-1', message: '错误2', at: 2 } });

  assert.equal(timers.has(hideEntry[0]), false, 'newer toast clears prior toastHideTimer');
  assert.equal(byId.get('toast').hidden, false);
  assert.equal(byId.get('actions').children.find((b) => b.dataset.actionKey === 'evt-1:allow-once'), firstAllow, 'reuses action buttons for same eventId');
  assert.equal(doc.activeElement, firstAllow, 'preserves focus on active action button');
});
