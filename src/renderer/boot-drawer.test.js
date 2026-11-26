'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('boot logdrawer sets aria-modal, manages inert background, traps Tab, and restores focus', () => {
  const html = fs.readFileSync(path.join(__dirname, 'boot.html'), 'utf8');
  assert.match(html, /class="logdrawer-panel"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /<ol class="logdrawer-lines" id="log" tabindex="0"/);

  class El {
    constructor(tag = 'div', id = '') {
      this.tagName = tag.toUpperCase();
      this.id = id;
      this.children = [];
      this.hidden = false;
      this.disabled = false;
      this.inert = false;
      this.scrollTop = 0;
      this.scrollHeight = 100;
      this.textContent = '';
      this.dataset = {};
      this.listeners = new Map();
      this.attrs = new Map();
      this.style = { setProperty() {} };
      const cls = new Set();
      this.classList = {
        add: (...names) => names.forEach((n) => cls.add(n)),
        remove: (...names) => names.forEach((n) => cls.delete(n)),
        toggle: (n, on) => (on ? cls.add(n) : cls.delete(n)),
        contains: (n) => cls.has(n),
      };
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
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
    appendChild(child) { this.children.push(child); return child; }
    append(...nodes) { this.children.push(...nodes); }
  }

  const byId = new Map();
  const make = (id, tag = 'div') => {
    const el = new El(tag, id);
    byId.set(id, el);
    return el;
  };

  const mainStage = make('stage', 'main');
  const drawer = make('logdrawer', 'div');
  drawer.hidden = true;
  const scene = new El('div');
  scene.append(mainStage, drawer);

  for (const id of ['status', 'status-text', 'failure', 'actions', 'log', 'ticker-inner', 'ticker-line',
    'ticker-count', 'log-count', 'log-close', 'retry', 'cancel-restart', 'open-launcher', 'save-log']) {
    make(id, id === 'log-close' || id === 'retry' ? 'button' : 'div');
  }
  const docListeners = new Map();
  const doc = {
    activeElement: null,
    documentElement: new El('html'),
    body: new El('body'),
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new El(tag),
    querySelector: (sel) => (sel === '.scene' ? scene : null),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
  };
  const win = {
    shellFeedback: {
      mountProgress: () => ({ show() {}, hide() {} }),
      notice() {},
    },
    shell: {
      getState: async () => ({ state: 'starting', logs: [] }),
      onState: () => () => {},
      onLog: () => () => {},
      onAction: () => () => {},
      onTheme: () => () => {},
    },
  };
  const sandbox = { document: doc, window: win, console, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'boot.js'), 'utf8'), sandbox);

  const ticker = byId.get('ticker-inner');
  const logClose = byId.get('log-close');
  const log = byId.get('log');

  ticker.focus();
  ticker.dispatch('click');
  assert.equal(drawer.hidden, false);
  assert.equal(mainStage.inert, true, 'background sibling becomes inert while drawer is open');
  assert.equal(doc.activeElement, logClose, 'opening drawer moves focus to close button');

  const keydown = (key, shiftKey = false) => {
    const ev = { key, shiftKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of docListeners.get('keydown') || []) fn(ev);
    return ev;
  };

  const tabForward = keydown('Tab', false);
  assert.equal(tabForward.defaultPrevented, true);
  assert.equal(doc.activeElement, log, 'Tab moves from close button to scrollable log');

  const tabWrap = keydown('Tab', false);
  assert.equal(tabWrap.defaultPrevented, true);
  assert.equal(doc.activeElement, logClose, 'Tab wraps back to close button');

  const esc = keydown('Escape', false);
  assert.equal(esc.defaultPrevented, true);
  assert.equal(drawer.hidden, true);
  assert.equal(mainStage.inert, false);
  assert.equal(doc.activeElement, ticker, 'closing drawer restores prior focus');
});
