'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { describe, formatBytes, formatEta } = require('./update-center');

const MB = 1024 * 1024;
const base = {
  current: '0.3.12', route: 'cnb', autoDownload: true, platform: 'win32', checkedAt: 0,
  routes: [{ id: 'cnb', label: 'CNB' }, { id: 'github', label: 'GitHub' }],
  target: { version: '0.3.13', publishedAt: '2026-10-29T08:00:00Z', notesTabs: [] },
  plan: { method: 'full', downloadBytes: 329 * MB, fullBytes: 329 * MB },
  progress: null, error: null, explicit: true,
};
const ids = (actions) => actions.map((action) => action.id);

test('an available delta shows only its size; full download is a quiet link', () => {
  const view = describe({ ...base, phase: 'available', plan: { method: 'delta', downloadBytes: 21 * MB, fullBytes: 329 * MB } });
  assert.equal(view.headline, '新版本 v0.3.13');
  assert.match(view.subline, /需下载 21\.0 MB/);
  assert.doesNotMatch(JSON.stringify(view), /增量/);
  assert.deepEqual(view.actions.map((a) => [a.id, a.kind]), [['download', 'primary'], ['downloadFull', 'link']]);
  assert.equal(view.actions[1].label, '完整下载（329 MB）');
});

test('without a delta there is no alternative method at all', () => {
  const view = describe({ ...base, phase: 'available' });
  assert.deepEqual(ids(view.actions), ['download']);
  assert.match(view.subline, /需下载 329 MB/);
});

test('downloading shows bytes, speed, time left and the resume position', () => {
  const view = describe({ ...base, phase: 'downloading',
    progress: { received: 128 * MB, total: 329 * MB, bytesPerSecond: 4.5 * MB, etaSeconds: 45, resumedFrom: 120 * MB } });
  assert.equal(view.progress.percent, 38);
  assert.equal(view.progress.text, '128 MB / 329 MB · 4.5 MB/s · 剩余约 45 秒 · 从 120 MB 处继续');
  assert.deepEqual(ids(view.actions), ['pause', 'cancel']);
});

test('paused offers resume; ready offers install now or later', () => {
  const paused = describe({ ...base, phase: 'paused', progress: { received: 100 * MB, total: 329 * MB } });
  assert.equal(paused.progress.state, 'paused');
  assert.deepEqual(ids(paused.actions), ['resume', 'cancel']);
  const ready = describe({ ...base, phase: 'ready' });
  assert.equal(ready.headline, 'v0.3.13 已准备好');
  assert.deepEqual(ready.actions.map((a) => a.label), ['安装并重启', '稍后']);
  assert.equal(describe({ ...base, phase: 'ready', platform: 'darwin' }).actions[0].label, '打开安装映像');
});

test('a network failure explains itself and offers the other route and a resume', () => {
  const view = describe({ ...base, phase: 'error', progress: { received: 50 * MB, total: 329 * MB },
    error: { operation: 'download', message: '下载连接中断', network: true, suggestRoute: 'github', canResume: true } });
  assert.match(view.problem.text, /^下载未完成：下载连接中断。网络连接不稳定/);
  assert.deepEqual(view.problem.actions.map((a) => [a.id, a.arg, a.label]), [['setRoute', 'github', '改用 GitHub 线路']]);
  assert.deepEqual(view.actions.map((a) => a.label), ['继续下载']);
  assert.equal(view.progress.state, 'paused');
});

test('up to date shows the last check and the route', () => {
  const at = new Date(2026, 9, 29, 9, 5).getTime();
  const view = describe({ ...base, phase: 'current', target: null, plan: null, checkedAt: at });
  assert.equal(view.headline, '已是最新版本 v0.3.12');
  assert.equal(view.subline, '上次检查 09:05 · 线路 CNB');
  assert.deepEqual(ids(view.actions), ['check']);
});

test('formatting helpers', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(20 * 1024), '20 KB');
  assert.equal(formatBytes(21.4 * MB), '21.4 MB');
  assert.equal(formatEta(30), '剩余约 30 秒');
  assert.equal(formatEta(125), '剩余约 3 分钟');
  assert.equal(formatEta(3700), '剩余约 1 小时 2 分钟');
});

test('update-center reuses buttons across ticks, implements tablist/radiogroup/focus-trap, and uses scaleX + tokens', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const css = fs.readFileSync(path.join(__dirname, 'update-center.css'), 'utf8');
  const tokensCss = fs.readFileSync(path.join(__dirname, '../shared/dsh-webui-tokens.css'), 'utf8');
  assert.match(tokensCss, /--dsw-alias-switch-thumb:/);
  assert.match(css, /var\(--dsw-alias-switch-thumb\)/);
  assert.match(css, /var\(--dsw-shadow-lv2\)/);
  assert.match(css, /var\(--dsw-elevation-panel\)/);
  assert.doesNotMatch(css, /--dsw-elevation-subtle/);
  assert.match(css, /#bar-fill[\s\S]*?transform:\s*scaleX\(0\)/);

  class El {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.attrs = new Map();
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.tabIndex = 0;
      this._text = '';
      const cls = new Set();
      this.classList = {
        add: (...names) => names.forEach((n) => cls.add(n)),
        remove: (...names) => names.forEach((n) => cls.delete(n)),
        toggle: (n, on) => (on ? cls.add(n) : cls.delete(n)),
        contains: (n) => cls.has(n),
      };
    }
    set className(v) { this._className = v; }
    get className() { return this._className || ''; }
    set textContent(v) { this._text = String(v); }
    get textContent() { return this._text; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    removeAttribute(k) { this.attrs.delete(k); }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatch(type, event = {}) {
      const ev = { target: this, preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false, ...event };
      for (const fn of this.listeners.get(type) || []) fn(ev);
      return ev;
    }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    replaceChildren(...nodes) {
      for (const c of this.children) c.parentNode = null;
      this.children = [];
      for (const n of nodes) this.appendChild(n);
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (sel === '[hidden]' && cur.hidden) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    querySelector(sel) {
      if (sel === '.bar') return this.children[0] || null;
      return null;
    }
    querySelectorAll(sel) {
      const all = [];
      const walk = (n) => {
        for (const c of n.children) { all.push(c); walk(c); }
      };
      walk(this);
      if (sel === '[role="tab"]') return all.filter((c) => c.getAttribute('role') === 'tab');
      if (sel === '[role="radio"]') return all.filter((c) => c.getAttribute('role') === 'radio');
      return all.filter((c) => (c.tagName === 'BUTTON' || c.tagName === 'INPUT') && !c.disabled && c.tabIndex !== -1);
    }
  }
  const byId = new Map();
  const make = (id, tag = 'div') => {
    const el = new El(tag, id);
    byId.set(id, el);
    return el;
  };
  const center = make('center', 'section');
  center.tabIndex = -1;
  const barWrap = new El('div');
  barWrap.className = 'bar';
  const progress = make('progress');
  progress.appendChild(barWrap);
  center.appendChild(progress);
  for (const id of ['headline', 'badge', 'subline', 'bar-fill', 'progress-text', 'problem', 'problem-text',
    'problem-actions', 'content', 'notes', 'notes-tabs', 'notes-body', 'routes', 'auto-download', 'proxy',
    'proxy-error', 'actions', 'close']) {
    const tag = (id === 'proxy' || id === 'auto-download') ? 'input' : (id === 'close' ? 'button' : 'div');
    center.appendChild(make(id, tag));
  }
  const docListeners = new Map();
  const docEl = new El('html');
  docEl.toggleAttribute = (k, on) => { if (on) docEl.attrs.set(k, ''); else docEl.attrs.delete(k); };
  const bodyEl = new El('body');
  bodyEl.toggleAttribute = (k, on) => { if (on) bodyEl.attrs.set(k, ''); else bodyEl.attrs.delete(k); };
  const doc = {
    activeElement: null,
    documentElement: docEl,
    body: bodyEl,
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new El(tag),
    addEventListener: (t, fn) => {
      if (!docListeners.has(t)) docListeners.set(t, []);
      docListeners.get(t).push(fn);
    },
  };
  let onPush = null;
  const calls = [];
  const initial = {
    ...base,
    phase: 'downloading',
    target: {
      ...base.target,
      notesTabs: [{ id: 'zh', label: '中文', text: '内容A' }, { id: 'en', label: 'EN', text: 'Body B' }],
    },
    progress: { received: 10 * MB, total: 100 * MB, bytesPerSecond: 2 * MB, etaSeconds: 45 },
  };
  const api = {
    state: async () => initial,
    subscribe: (fn) => { onPush = fn; return () => {}; },
    onTheme: () => () => {},
    onWindowState: () => () => {},
    command: async (id, arg) => { calls.push([id, arg]); return initial; },
    close: async () => {},
  };
  const sandbox = {
    document: doc,
    window: { whaleUpdateCenter: api },
    location: { search: '' },
    URLSearchParams,
    console,
    Date,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'update-center.js'), 'utf8'), sandbox);
  await new Promise((r) => setImmediate(r));

  assert.equal(doc.activeElement, center, 'moves initial focus to dialog container');
  const firstAction = byId.get('actions').children[0];
  firstAction.focus();
  onPush({
    ...initial,
    progress: { received: 50 * MB, total: 100 * MB, bytesPerSecond: 2 * MB, etaSeconds: 25 },
  });
  assert.equal(byId.get('actions').children[0], firstAction, 'reuses action buttons across progress ticks');
  assert.equal(doc.activeElement, firstAction, 'preserves focus on action button');
  assert.equal(byId.get('bar-fill').style.transform, 'scaleX(0.5)');

  const tabs = byId.get('notes-tabs').children;
  tabs[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(doc.activeElement, tabs[1]);
  assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(tabs[0].tabIndex, -1);

  const radios = byId.get('routes').children;
  radios[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(doc.activeElement, radios[1]);
  assert.deepEqual(calls.at(-1), ['setRoute', 'github']);

  const focusables = center.querySelectorAll('focusable');
  focusables.at(-1).focus();
  for (const fn of docListeners.get('keydown') || []) {
    fn({ key: 'Tab', shiftKey: false, preventDefault() {} });
  }
  assert.equal(doc.activeElement, focusables[0], 'Tab wraps inside dialog');
});
