'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function preview(query = '', platform = 'MacIntel') {
  class Element {
    constructor() {
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.value = 'active';
      const classes = new Set();
      this.classList = {
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
        contains: name => classes.has(name),
      };
    }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { this.focused = true; }
    contains(target) { return target === this; }
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const commands = ['settings', 'hide', 'quit'].map(command => {
    const button = new Element();
    button.dataset.previewCommand = command;
    return button;
  });
  const menu = get('mac-menu');
  menu.querySelector = () => get('summary');
  const document = Object.assign(new Element(), {
    body: new Element(),
    documentElement: new Element(),
    getElementById: get,
    querySelector: () => menu,
    querySelectorAll: selector => selector === '[data-preview-command]' ? commands : [],
  });
  let location = `https://preview.example/index.html${query}`;
  const context = {
    document,
    navigator: { platform },
    HTMLElement: Element,
    URL,
    history: { replaceState: (_state, _title, url) => { location = url.href; } },
    window: {
      location: { href: location },
      matchMedia: () => ({ matches: false, addEventListener() {} }),
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../prototypes/boot-page/boot-prototype.js'), 'utf8'), context);
  return { context, document, get, menu, commands, url: () => new URL(location) };
}

test('boot prototype defaults to the host platform but explicit Windows wins on Mac', () => {
  const mac = preview();
  assert.equal(mac.document.documentElement.dataset.platform, 'darwin');
  assert.equal(mac.get('window-state-label').hidden, false);
  for (const p of [preview('?platform=windows'), preview('', 'Win32')]) {
    assert.equal(p.document.documentElement.dataset.platform, 'win32');
    assert.equal(p.get('window-state-label').hidden, true);
    assert.equal(p.get('platform-detail').hidden, true);
  }
});

test('Mac window fixture, theme and startup state survive platform switching', () => {
  const p = preview('?platform=mac&window=inactive&theme=dark&state=error');
  assert.equal(p.document.documentElement.dataset.windowState, 'inactive');
  assert.equal(p.document.documentElement.getAttribute('data-ds-dark-theme'), '');
  assert.equal(p.document.body.dataset.state, 'error');
  p.context.setWindowState('fullscreen');
  assert.equal(p.url().searchParams.get('window'), 'fullscreen');
  assert.match(p.get('platform-detail').textContent, /AppKit/);
  p.context.setPlatform('windows');
  assert.equal(p.get('platform-detail').hidden, true);
  p.context.setPlatform('mac');
  assert.equal(p.document.documentElement.dataset.windowState, 'fullscreen');
  assert.equal(p.document.body.dataset.state, 'error');
  assert.equal(p.get('platform-detail').hidden, false);
  p.context.setWindowState('invalid');
  assert.equal(p.document.documentElement.dataset.windowState, 'active');
});

test('prototype menu dismisses and explains commands without controlling the host', () => {
  const p = preview();
  p.menu.open = true;
  p.document.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(p.menu.open, false);
  assert.equal(p.get('summary').focused, true);
  p.menu.open = true;
  p.document.listeners.get('pointerdown')({ target: {} });
  assert.equal(p.menu.open, false);
  for (const button of p.commands) {
    p.menu.open = true;
    button.listeners.get('click')();
    assert.equal(p.menu.open, false);
    assert.match(p.get('prototype-note').textContent, /原型预览/);
  }
});
