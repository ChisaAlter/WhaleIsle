const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const vm = require('node:vm');

const injectSource = fs.readFileSync(path.join(__dirname, 'harness-chrome-inject.js'), 'utf8');

test('injected chrome script is a re-runnable IIFE with no Node exports', () => {
  assert.match(injectSource.trimStart(), /^\(\(\)\s*=>/);
  assert.doesNotMatch(injectSource, /module\.exports/);
  assert.doesNotMatch(injectSource, /^const /m);
  assert.doesNotMatch(injectSource, /^function /m);
});

test('injected window controls follow official label and hover tokens', () => {
  assert.match(injectSource, /color:\s*var\(--dsw-alias-label-primary\)/);
  assert.match(injectSource, /background:\s*var\(--dsw-alias-interactive-bg-hover\)/);
  assert.doesNotMatch(injectSource, /--dsh-ctrl-fg/);
  assert.doesNotMatch(injectSource, /--dsh-ctrl-hover/);
});

test('injected chrome script omits the marketplace window-control', () => {
  assert.doesNotMatch(injectSource, /插件市场/);
  assert.doesNotMatch(injectSource, /data-act="marketplace"/);
});

test('injected chrome owns only the window-control plate', () => {
  assert.match(injectSource, /const CAPTION_HEIGHT = 48/);
  assert.match(injectSource, /addEventListener\('pointerdown'/);
  assert.match(injectSource, /pointer-events:\s*none/);
  assert.match(injectSource, /--dshd-wco-controls/);
  assert.match(injectSource, /--dshd-wco-caption/);
  assert.doesNotMatch(injectSource, /--dshd-wco-pad/);
  assert.doesNotMatch(injectSource, /dshd-shell-drag-strip/);
  assert.doesNotMatch(injectSource, /data-dshd-shell-drag/);
  assert.doesNotMatch(injectSource, /data-dshd-shell-hit/);
  assert.doesNotMatch(injectSource, /findSessionLog/);
  assert.doesNotMatch(injectSource, /findTopBar/);
  assert.doesNotMatch(injectSource, /findCenterCol/);
  assert.doesNotMatch(injectSource, /findTitlebarRow/);
  assert.doesNotMatch(injectSource, /placeDragGutter/);
  assert.doesNotMatch(injectSource, /reservedRight/);
  assert.doesNotMatch(injectSource, /\[data-surfaces-collapsed\]/);
});

test('injected silhouette keeps a hairline ring element that maximization removes', () => {
  // The transparent window's bare alpha-AA edge reads as blur; an inset
  // hairline inside the rounded clip anchors the edge visually. The ring is
  // a real element (not body::after) so the self-heal observer can watch it
  // and no client stylesheet can collide with body's pseudo-elements.
  assert.match(injectSource, /FRAME_RING_ID = 'dshd-frame-ring'/);
  assert.match(injectSource, /box-shadow: inset 0 0 0 var\(--dsh-window-hairline, 1px\) var\(--dsw-alias-border-l2/);
  assert.match(injectSource, /html\[data-window-maximized\] #\$\{FRAME_RING_ID\} \{\s*display: none;/);
  // The ring must live inside body: --dsw-alias-* tokens are declared on
  // body, so a sibling element would only ever resolve the fallback color.
  assert.match(injectSource, /document\.body\.appendChild\(el\)/);
});

test('injected chrome seeds the maximized flag from getWindowState on first run', () => {
  // State pushes only arrive on transitions; a document injected while the
  // window is already maximized must query the current state once or it
  // draws the rounded silhouette at the screen edge indefinitely.
  assert.match(injectSource, /window\.shell\.getWindowState\(\)/);
  assert.match(injectSource, /window\.shell\.onWindowState\(/);
});

test('injected chrome regrows dropped nodes through a scoped self-heal observer', () => {
  // The observer is self-healing only: it watches the document for removal of
  // the injected ids and must not scrape app layout or attributes.
  assert.match(injectSource, /typeof MutationObserver === 'function'/);
  assert.match(injectSource, /healer\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);
  assert.match(injectSource, /getElementById\(STYLE_ID\)/);
  assert.match(injectSource, /getElementById\(CONTROLS_ID\)/);
  assert.match(injectSource, /getElementById\(FRAME_CANVAS_ID\)/);
  assert.match(injectSource, /getElementById\(FRAME_RING_ID\)/);
  assert.doesNotMatch(injectSource, /healer\.observe\([^)]*attributes/);
});

test('injected chrome script can be evaluated twice in one realm', () => {
  const context = vm.createContext(createInjectSandbox());
  assert.doesNotThrow(() => vm.runInContext(injectSource, context));
  assert.doesNotThrow(() => vm.runInContext(injectSource, context));
  const hosts = context.document.querySelectorAll('#dshd-shell-controls');
  assert.equal(hosts.length, 1);
});

test('injected measure publishes window-control insets with an 8px plate margin', () => {
  const cssVars = {};
  const context = vm.createContext(createInjectSandbox({ cssVars }));
  vm.runInContext(injectSource, context);
  assert.equal(cssVars['--dshd-wco-controls'], '112px');
  assert.equal(cssVars['--dshd-wco-caption'], '48px');
  assert.equal(cssVars['--dshd-wco-pad'], undefined);
  const host = context.document.getElementById('dshd-shell-controls');
  assert.ok(host);
  assert.equal(host.style.top, '0px');
  assert.equal(host.style.right, '0px');
  assert.equal(host.style.width, '112px');
  assert.equal(host.style.height, '48px');
  assert.equal(host.style.padding, '8px');
  assert.equal(context.document.getElementById('dshd-shell-drag-strip'), null);
  assert.equal(context.document.querySelector('[data-dshd-shell-drag]'), null);
  assert.equal(context.document.querySelector('[data-dshd-shell-hit]'), null);
});

test('injected window controls dispatch windowAction on pointerdown', () => {
  const actions = [];
  const context = vm.createContext(createInjectSandbox({
    shell: {
      windowAction(act) {
        actions.push(act);
      },
    },
  }));
  vm.runInContext(injectSource, context);
  const host = context.document.getElementById('dshd-shell-controls');
  assert.ok(host);
  const close = host.querySelector('[data-act="close"]');
  assert.ok(close);
  host.emit('pointerdown', {
    type: 'pointerdown',
    button: 0,
    target: close,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(actions, ['close']);
});

function createInjectSandbox(options = {}) {
  const cssVars = options.cssVars ?? {};
  class HTMLElement {}
  const store = new Map();
  const nodes = [];

  function matches(node, selector) {
    const trimmed = String(selector || '').trim();
    if (trimmed.includes(',')) {
      return trimmed.split(',').some((part) => matches(node, part.trim()));
    }
    if (!trimmed) {
      return false;
    }
    if (trimmed.startsWith('#')) {
      return node.id === trimmed.slice(1);
    }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1);
      const equals = inner.match(/^(.*?)=['"]?(.*?)['"]?$/);
      if (equals) {
        return node.getAttribute(equals[1]) === equals[2];
      }
      return node.hasAttribute(inner);
    }
    return node.tagName === trimmed.toUpperCase();
  }

  function descendants(root) {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(root);
    return out;
  }

  function makeElement(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const node = Object.assign(Object.create(HTMLElement.prototype), {
      tagName: String(tag || 'DIV').toUpperCase(),
      _id: '',
      className: '',
      textContent: '',
      innerHTML: '',
      parentElement: null,
      children: [],
      dataset: {},
      style: {
        setProperty(name, value) {
          cssVars[name] = value;
        },
        right: '',
        gap: '',
        height: '',
        padding: '',
        top: '',
        left: '',
        width: '',
      },
      appendChild(child) {
        child.parentElement = node;
        node.children.push(child);
        return child;
      },
      addEventListener(type, handler) {
        const list = listeners.get(type) || [];
        list.push(handler);
        listeners.set(type, list);
      },
      emit(type, event) {
        for (const handler of listeners.get(type) || []) {
          handler(event);
        }
      },
      setAttribute(name, value) {
        const next = value == null ? '' : String(value);
        attrs.set(name, next);
        if (name === 'id') {
          node.id = next;
        }
      },
      removeAttribute(name) {
        attrs.delete(name);
      },
      getAttribute(name) {
        if (name === 'id') {
          return node.id || null;
        }
        return attrs.has(name) ? attrs.get(name) : null;
      },
      hasAttribute(name) {
        if (name === 'id') {
          return Boolean(node.id);
        }
        return attrs.has(name);
      },
      querySelector(selector) {
        return descendants(node).find((child) => matches(child, selector)) || null;
      },
      querySelectorAll(selector) {
        return descendants(node).filter((child) => matches(child, selector));
      },
      closest(selector) {
        let cursor = node;
        while (cursor) {
          if (matches(cursor, selector)) {
            return cursor;
          }
          cursor = cursor.parentElement;
        }
        return null;
      },
      getContext() {
        return { fillStyle: '#ffffff' };
      },
    });
    Object.defineProperty(node, 'id', {
      get() {
        return node._id;
      },
      set(value) {
        if (node._id) {
          store.delete(node._id);
        }
        node._id = String(value || '');
        if (node._id) {
          store.set(node._id, node);
        }
      },
    });
    Object.defineProperty(node, 'innerHTML', {
      get() {
        return node._innerHTML || '';
      },
      set(value) {
        node._innerHTML = String(value || '');
        node.children = [];
        for (const match of node._innerHTML.matchAll(/<button\b([^>]*)>/gi)) {
          const button = makeElement('button');
          const act = /data-act="([^"]+)"/.exec(match[1] || '');
          if (act) {
            button.setAttribute('data-act', act[1]);
            button.dataset.act = act[1];
          }
          node.appendChild(button);
        }
      },
    });
    nodes.push(node);
    return node;
  }

  const html = makeElement('html');
  const body = makeElement('body');
  html.appendChild(body);

  const document = {
    documentElement: html,
    body,
    getElementById(id) {
      return store.get(id) || null;
    },
    createElement(tag) {
      return makeElement(tag);
    },
    querySelector(selector) {
      return nodes.find((node) => matches(node, selector)) || null;
    },
    querySelectorAll(selector) {
      return nodes.filter((node) => matches(node, selector));
    },
  };

  const window = {
    __dshShellChromeBound: false,
    __dshShellMaximized: false,
    innerWidth: 1280,
    shell: options.shell || null,
    addEventListener() {},
    clearTimeout() {},
    setTimeout() {
      return 0;
    },
  };

  return {
    document,
    window,
    HTMLElement,
    getComputedStyle() {
      return { backgroundColor: 'rgb(255, 255, 255)' };
    },
  };
}
