'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DOM_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'shared', 'dom.js'), 'utf8');
const INJECT_SOURCE = fs.readFileSync(path.join(__dirname, 'star-prompt-inject.js'), 'utf8');

function createDomEnv(options = {}) {
  let now = options.initialNow ?? 1000;
  let nextTimerId = 1;
  const timers = new Map();
  const observers = [];
  const listenerRecords = [];
  const windowListeners = new Map();
  const changedSubscribers = [];

  const activityCalls = [];
  const actionCalls = [];
  let getStateCalls = 0;

  let currentInitialView = options.initialView ?? {
    visible: false,
    phase: 'hidden',
    mode: 'direct',
    locale: 'zh',
    errorCode: '',
  };

  class FakeText {
    constructor(data) {
      this.nodeType = 3;
      this.nodeValue = String(data);
      this.parentNode = null;
    }
    get textContent() {
      return this.nodeValue;
    }
  }

  class FakeElement {
    constructor(tagName, namespaceURI = null) {
      this.nodeType = 1;
      this.tagName = String(tagName).toUpperCase();
      this.localName = String(tagName).toLowerCase();
      this.namespaceURI = namespaceURI;
      this.attributes = new Map();
      this.childNodes = [];
      this.parentNode = null;
      this.listeners = new Map();
      this.style = {
        setProperty(k, v) {
          this[k] = v;
        },
      };
      this._textContent = '';
    }
    get id() {
      return this.attributes.get('id') || '';
    }
    set id(v) {
      this.setAttribute('id', v);
    }
    get className() {
      return this.attributes.get('class') || '';
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get textContent() {
      if (this.childNodes.length === 0) {
        return this._textContent;
      }
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      this.childNodes = [];
      this._textContent = String(v);
    }
    setAttribute(name, value) {
      this.attributes.set(String(name), String(value));
    }
    getAttribute(name) {
      return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
    }
    hasAttribute(name) {
      return this.attributes.has(String(name));
    }
    removeAttribute(name) {
      this.attributes.delete(String(name));
    }
    appendChild(child) {
      if (child.parentNode && child.parentNode !== this && typeof child.parentNode.removeChild === 'function') {
        child.parentNode.removeChild(child);
      }
      if (!this.childNodes.includes(child)) {
        this.childNodes.push(child);
      }
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    replaceChildren(...nodes) {
      for (const child of this.childNodes) {
        child.parentNode = null;
      }
      this.childNodes = [];
      this._textContent = '';
      for (const node of nodes) {
        this.appendChild(node);
      }
    }
    remove() {
      if (this.parentNode && typeof this.parentNode.removeChild === 'function') {
        this.parentNode.removeChild(this);
      }
    }
    addEventListener(type, fn, opts) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, []);
      }
      this.listeners.get(type).push({ fn, opts });
    }
    dispatchEvent(event) {
      const evt = { ...event, target: event.target || this };
      let cur = this;
      while (cur) {
        if (cur.listeners) {
          const list = cur.listeners.get(evt.type) || [];
          for (const entry of list) {
            entry.fn(evt);
          }
        }
        cur = cur.parentNode;
      }
    }
    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }
    matches(selector) {
      if (selector.startsWith('#')) {
        return this.id === selector.slice(1);
      }
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return this.className.split(/\s+/).includes(cls);
      }
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const inner = selector.slice(1, -1);
        const eq = inner.indexOf('=');
        if (eq === -1) {
          return this.hasAttribute(inner);
        }
        const key = inner.slice(0, eq);
        const val = inner.slice(eq + 1).replace(/^['"]|['"]$/g, '');
        return this.getAttribute(key) === val;
      }
      return this.localName === selector.toLowerCase();
    }
    closest(selector) {
      let cur = this;
      while (cur) {
        if (cur.matches(selector)) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.matches(selector)) {
              out.push(child);
            }
            walk(child);
          }
        }
      };
      walk(this);
      return out;
    }
  }

  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  documentElement.appendChild(body);
  if (options.minimal) {
    documentElement.setAttribute('data-dsh-minimal', '');
  }

  const document = {
    documentElement,
    body,
    createElement(tag) {
      return new FakeElement(tag);
    },
    createElementNS(ns, tag) {
      return new FakeElement(tag, ns);
    },
    createTextNode(text) {
      return new FakeText(text);
    },
    getElementById(id) {
      return documentElement.querySelector(`#${id}`);
    },
    querySelector(selector) {
      return documentElement.querySelector(selector);
    },
    querySelectorAll(selector) {
      return documentElement.querySelectorAll(selector);
    },
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      observers.push(this);
    }
    observe(target, opts) {
      this.observed.push({ target, opts });
    }
    disconnect() {}
    trigger() {
      this.callback([], this);
    }
  }

  const setTimeoutFn = (fn, ms = 0) => {
    const id = nextTimerId++;
    timers.set(id, { fn, runAt: now + ms });
    return id;
  };
  const clearTimeoutFn = (id) => {
    timers.delete(id);
  };

  const shell = {
    reportStarPromptActivity() {
      activityCalls.push(now);
    },
    getStarPromptState() {
      getStateCalls += 1;
      if (typeof options.getStarPromptState === 'function') {
        return options.getStarPromptState();
      }
      return Promise.resolve(currentInitialView);
    },
    starPromptAction(payload) {
      actionCalls.push({ type: payload.type });
      if (typeof options.onAction === 'function') {
        return Promise.resolve(options.onAction(payload));
      }
      return Promise.resolve(currentInitialView);
    },
    onStarPromptChanged(cb) {
      changedSubscribers.push(cb);
      return () => {
        const idx = changedSubscribers.indexOf(cb);
        if (idx !== -1) changedSubscribers.splice(idx, 1);
      };
    },
  };

  const windowObj = {
    document,
    shell,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    matchMedia(query) {
      return {
        matches: Boolean(options.reducedMotion && query.includes('prefers-reduced-motion')),
      };
    },
    addEventListener(type, fn, opts) {
      listenerRecords.push({ type, fn, opts });
      if (!windowListeners.has(type)) {
        windowListeners.set(type, []);
      }
      windowListeners.get(type).push(fn);
    },
    dispatchEvent(type) {
      const list = windowListeners.get(type) || [];
      for (const fn of list) {
        fn({ type });
      }
    },
  };

  const context = vm.createContext({
    window: windowObj,
    document,
    MutationObserver: FakeMutationObserver,
    Promise,
    console,
    Date: {
      now: () => now,
    },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
  });
  context.globalThis = context;

  function runInject() {
    const bundle = `(() => {\n${DOM_SOURCE}\nreturn ${INJECT_SOURCE}\n})()`;
    return vm.runInContext(bundle, context);
  }

  async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function advanceTime(ms) {
    now += ms;
    for (const [id, entry] of [...timers.entries()]) {
      if (entry.runAt <= now) {
        timers.delete(id);
        entry.fn();
      }
    }
  }

  function pushView(view) {
    currentInitialView = view;
    for (const cb of changedSubscribers) {
      cb(view);
    }
  }

  return {
    window: windowObj,
    document,
    observers,
    listenerRecords,
    changedSubscribers,
    activityCalls,
    actionCalls,
    getGetStateCalls: () => getStateCalls,
    runInject,
    flushMicrotasks,
    advanceTime,
    pushView,
    setNow(t) {
      now = t;
    },
  };
}

test('source obeys zero-innerHTML, zero-credential-leak, and DSHD token rules', () => {
  assert.equal(/\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|\bdocument\.write\b/.test(INJECT_SOURCE), false);
  assert.equal(/githubToken|GH_TOKEN|GITHUB_TOKEN|gh auth/i.test(INJECT_SOURCE), false);
  for (const token of [
    '--dsw-alias-bg-layer-2',
    '--dsw-menu-backdrop-filter',
    '--dsw-alias-border-l2',
    '--dsw-shadow-lv3',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-interactive-bg-hover',
    'html[data-dsh-minimal]',
    'prefers-reduced-motion: reduce',
    'position: fixed',
    'right: 20px',
    'bottom: 20px',
    'pointer-events: auto',
    '-webkit-app-region: no-drag',
  ]) {
    assert.ok(INJECT_SOURCE.includes(token), `expected CSS token/rule: ${token}`);
  }
});

test('repeated injection is idempotent and does not duplicate listeners or subscriptions', async () => {
  const env = createDomEnv({
    initialView: { visible: true, phase: 'visible', mode: 'direct', locale: 'zh', errorCode: '' },
  });

  const first = env.runInject();
  await env.flushMicrotasks();
  assert.deepEqual({ ...first }, { ready: true, reinjected: false });
  assert.equal(env.window.__dshStarPromptBound, true);
  assert.equal(env.listenerRecords.length, 5);
  for (const rec of env.listenerRecords) {
    assert.deepEqual({ ...rec.opts }, { passive: true, capture: true });
  }
  assert.equal(env.changedSubscribers.length, 1);
  assert.equal(env.getGetStateCalls(), 1);
  assert.ok(env.document.getElementById('dshd-star-prompt-style'));
  assert.ok(env.document.getElementById('dshd-star-prompt-card'));

  // Drop style and card, then reinject; should restore without duplicating listeners.
  env.document.getElementById('dshd-star-prompt-style').remove();
  env.document.getElementById('dshd-star-prompt-card').remove();
  const second = env.runInject();
  assert.deepEqual({ ...second }, { ready: true, reinjected: true });
  assert.equal(env.listenerRecords.length, 5);
  assert.equal(env.changedSubscribers.length, 1);
  assert.equal(env.getGetStateCalls(), 1);
  assert.ok(env.document.getElementById('dshd-star-prompt-style'));
  assert.ok(env.document.getElementById('dshd-star-prompt-card'));
});

test('activity listeners report throttled activity across all 5 interaction events', async () => {
  const env = createDomEnv();
  env.runInject();
  await env.flushMicrotasks();

  env.window.dispatchEvent('pointermove');
  env.setNow(1200);
  env.window.dispatchEvent('pointerdown');
  env.setNow(1499);
  env.window.dispatchEvent('keydown');
  assert.equal(env.activityCalls.length, 1);

  env.setNow(1500);
  env.window.dispatchEvent('wheel');
  assert.equal(env.activityCalls.length, 2);

  env.setNow(2000);
  env.window.dispatchEvent('touchstart');
  assert.equal(env.activityCalls.length, 3);
});

test('renders zh and en copy across visible, starring, error, browser fallback, and success phases', async () => {
  const env = createDomEnv({
    initialView: { visible: false, phase: 'hidden', mode: 'direct', locale: 'zh', errorCode: '' },
  });
  env.runInject();
  await env.flushMicrotasks();

  assert.equal(env.document.getElementById('dshd-star-prompt-card'), null);

  // Visible zh direct
  env.pushView({ visible: true, phase: 'visible', mode: 'direct', locale: 'zh', errorCode: '' });
  let card = env.document.getElementById('dshd-star-prompt-card');
  assert.ok(card);
  assert.equal(card.getAttribute('role'), 'region');
  assert.equal(card.getAttribute('aria-modal'), null);
  assert.ok(card.textContent.includes('支持鲸屿项目'));
  assert.ok(card.textContent.includes('喜欢鲸屿的话，欢迎点个 Star 支持一下。'));

  let primary = card.querySelector('.dshd-sp-primary');
  assert.equal(primary.textContent, '一键点 Star');
  primary.click();
  await env.flushMicrotasks();
  assert.deepEqual(env.actionCalls.at(-1), { type: 'star' });

  // Secondary actions & close
  const ghosts = card.querySelectorAll('.dshd-sp-ghost');
  assert.equal(ghosts.length, 2);
  assert.equal(ghosts[0].textContent, '稍后再说');
  assert.equal(ghosts[1].textContent, '不再提醒');
  ghosts[0].click();
  await env.flushMicrotasks();
  assert.deepEqual(env.actionCalls.at(-1), { type: 'snooze' });

  ghosts[1].click();
  await env.flushMicrotasks();
  assert.deepEqual(env.actionCalls.at(-1), { type: 'dismiss-forever' });

  const closeBtn = card.querySelector('.dshd-sp-close');
  assert.equal(closeBtn.getAttribute('aria-label'), '关闭');
  closeBtn.click();
  await env.flushMicrotasks();
  assert.deepEqual(env.actionCalls.at(-1), { type: 'snooze' });

  // Starring state disables primary and suppresses duplicate click
  env.pushView({ visible: true, phase: 'starring', mode: 'direct', locale: 'zh', errorCode: '' });
  primary = card.querySelector('.dshd-sp-primary');
  assert.equal(primary.textContent, '正在点 Star…');
  assert.equal(primary.hasAttribute('disabled'), true);
  assert.equal(primary.getAttribute('aria-busy'), 'true');
  assert.equal(card.querySelectorAll('.dshd-sp-ghost').length, 0);
  assert.equal(card.querySelector('.dshd-sp-close'), null);
  const countBeforeDisabledClick = env.actionCalls.length;
  primary.click();
  await env.flushMicrotasks();
  assert.equal(env.actionCalls.length, countBeforeDisabledClick);

  // Error states switch primary to browser fallback
  env.pushView({ visible: true, phase: 'error', mode: 'direct', locale: 'zh', errorCode: 'auth-failed' });
  assert.equal(card.querySelector('.dshd-sp-error').textContent, '凭证授权不足，请前往 GitHub 页面点赞');
  primary = card.querySelector('.dshd-sp-primary');
  assert.equal(primary.textContent, '打开 GitHub 页面点 Star');
  primary.click();
  await env.flushMicrotasks();
  assert.deepEqual(env.actionCalls.at(-1), { type: 'open-browser' });

  env.pushView({ visible: true, phase: 'error', mode: 'browser', locale: 'en', errorCode: 'request-failed' });
  assert.ok(card.textContent.includes('Star Whale Isle'));
  assert.ok(card.textContent.includes('Enjoying Whale Isle? Give it a Star on GitHub.'));
  assert.equal(card.querySelector('.dshd-sp-error').textContent, 'Request failed. Open GitHub to star.');
  assert.equal(card.querySelector('.dshd-sp-primary').textContent, 'Open GitHub to Star');
  const enGhosts = card.querySelectorAll('.dshd-sp-ghost');
  assert.equal(enGhosts[0].textContent, 'Later');
  assert.equal(enGhosts[1].textContent, "Don't remind");
  assert.equal(card.querySelector('.dshd-sp-close').getAttribute('aria-label'), 'Close');

  // English direct + starring
  env.pushView({ visible: true, phase: 'visible', mode: 'direct', locale: 'en', errorCode: '' });
  assert.equal(card.querySelector('.dshd-sp-primary').textContent, 'Star on GitHub');
  env.pushView({ visible: true, phase: 'starring', mode: 'direct', locale: 'en', errorCode: '' });
  assert.equal(card.querySelector('.dshd-sp-primary').textContent, 'Starring…');

  // Success removes all action buttons
  env.pushView({ visible: true, phase: 'success', mode: 'direct', locale: 'zh', errorCode: '' });
  assert.ok(card.textContent.includes('已感谢支持，Star 成功！'));
  assert.equal(card.querySelectorAll('button').length, 0);

  env.pushView({ visible: true, phase: 'success', mode: 'direct', locale: 'en', errorCode: '' });
  assert.ok(card.textContent.includes('Thank you for starring!'));
  assert.equal(card.querySelectorAll('button').length, 0);
});

test('transitions to hidden smoothly in normal mode and immediately under minimal mode', async () => {
  const normal = createDomEnv({
    initialView: { visible: true, phase: 'visible', mode: 'direct', locale: 'zh', errorCode: '' },
  });
  normal.runInject();
  await normal.flushMicrotasks();
  assert.ok(normal.document.getElementById('dshd-star-prompt-card'));

  normal.pushView({ visible: false, phase: 'hidden', mode: 'direct', locale: 'zh', errorCode: '' });
  const closingCard = normal.document.getElementById('dshd-star-prompt-card');
  assert.ok(closingCard);
  assert.equal(closingCard.getAttribute('data-state'), 'closed');
  assert.equal(closingCard.getAttribute('aria-hidden'), 'true');
  normal.advanceTime(160);
  assert.equal(normal.document.getElementById('dshd-star-prompt-card'), null);

  const minimal = createDomEnv({
    minimal: true,
    initialView: { visible: true, phase: 'visible', mode: 'direct', locale: 'zh', errorCode: '' },
  });
  minimal.runInject();
  await minimal.flushMicrotasks();
  assert.ok(minimal.document.getElementById('dshd-star-prompt-card'));
  minimal.pushView({ visible: false, phase: 'hidden', mode: 'direct', locale: 'zh', errorCode: '' });
  assert.equal(minimal.document.getElementById('dshd-star-prompt-card'), null);
});

test('MutationObserver heals dropped style or card while visible', async () => {
  const env = createDomEnv({
    initialView: { visible: true, phase: 'visible', mode: 'direct', locale: 'zh', errorCode: '' },
  });
  env.runInject();
  await env.flushMicrotasks();
  assert.equal(env.observers.length, 1);

  env.document.getElementById('dshd-star-prompt-style').remove();
  env.document.getElementById('dshd-star-prompt-card').remove();
  assert.equal(env.document.getElementById('dshd-star-prompt-style'), null);
  assert.equal(env.document.getElementById('dshd-star-prompt-card'), null);

  env.observers[0].trigger();
  assert.ok(env.document.getElementById('dshd-star-prompt-style'));
  assert.ok(env.document.getElementById('dshd-star-prompt-card'));
});

test('late getStarPromptState resolution does not overwrite newer onStarPromptChanged push', async () => {
  let resolveInitial;
  const env = createDomEnv({
    getStarPromptState: () => new Promise((resolve) => {
      resolveInitial = resolve;
    }),
  });
  env.runInject();

  env.pushView({ visible: true, phase: 'visible', mode: 'direct', locale: 'en', errorCode: '' });
  let card = env.document.getElementById('dshd-star-prompt-card');
  assert.ok(card);
  assert.ok(card.textContent.includes('Star Whale Isle'));

  resolveInitial({ visible: false, phase: 'hidden', mode: 'direct', locale: 'zh', errorCode: '' });
  await env.flushMicrotasks();

  card = env.document.getElementById('dshd-star-prompt-card');
  assert.ok(card);
  assert.equal(card.getAttribute('data-state'), 'open');
  assert.ok(card.textContent.includes('Star Whale Isle'));
});
