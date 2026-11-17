'use strict';

// Self-contained mini-DOM: the builder only needs createElement,
// createElementNS, createTextNode and element setAttribute/appendChild/
// replaceChildren — jsdom would only re-test the browser. serialize()
// renders the fake tree back to markup so assertions can compare against
// the exact HTML the innerHTML sites used to produce.

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function fakeText(text) {
  return { nodeType: 3, textContent: String(text), children: [] };
}

function fakeElement(tag, namespaceURI = null) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    namespaceURI,
    children: [],
    attrs: {},
    style: {
      props: {},
      setProperty(name, value) { this.props[name] = String(value); },
    },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...nodes) { this.children = []; nodes.forEach((node) => this.appendChild(node)); },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] ?? null; },
  };
}

function serialize(node) {
  if (node.nodeType === 3) {
    return node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const open = Object.entries(node.attrs).map(([name, value]) => ` ${name}="${value}"`).join('');
  return `<${node.tagName.toLowerCase()}${open}>${node.children.map(serialize).join('')}</${node.tagName.toLowerCase()}>`;
}

global.document = {
  createElement: (tag) => fakeElement(tag),
  createElementNS: (ns, tag) => fakeElement(tag, ns),
  createTextNode: fakeText,
};

// The builder ships in two copies: src/shared/dom.js (classic script / CJS)
// and an in-place ESM copy at mobile/web/ui/dom.js — the public SPA deploy
// only uploads files under mobile/web/, so the page cannot import across
// the tree. The same assertions run against both copies so they cannot
// drift; keep the implementations identical.
const IMPLEMENTATIONS = [
  ['src/shared/dom.js', async () => require('./dom')],
  ['mobile/web/ui/dom.js', async () => import(pathToFileURL(
    path.join(__dirname, '..', '..', 'mobile', 'web', 'ui', 'dom.js'),
  ).href)],
];

for (const [name, load] of IMPLEMENTATIONS) {
  describe(name, () => {
    let h;
    let mount;
    before(async () => {
      ({ h, mount } = await load());
    });

    test('h builds an element with setAttribute attributes and text children', () => {
      const el = h('button', { type: 'button', class: 'primary small', 'data-act': 'close' }, '关闭');
      assert.equal(el.tagName, 'BUTTON');
      assert.equal(serialize(el), '<button type="button" class="primary small" data-act="close">关闭</button>');
    });

    test('string children become text nodes and never parse as markup', () => {
      const el = h('span', {}, '<img src=x onerror=alert(1)>');
      assert.equal(el.children.length, 1);
      assert.equal(el.children[0].nodeType, 3);
      assert.equal(serialize(el), '<span>&lt;img src=x onerror=alert(1)&gt;</span>');
    });

    test('numbers become text nodes; null/false/true/undefined children drop out', () => {
      const el = h('li', {}, 'v', 3, null, false, true, undefined, 'x');
      assert.equal(serialize(el), '<li>v3x</li>');
    });

    test('arrays of children flatten, including the attrs slot', () => {
      const rows = [h('li', {}, 'a'), h('li', {}, 'b')];
      assert.equal(serialize(h('ul', {}, rows)), '<ul><li>a</li><li>b</li></ul>');
      assert.equal(serialize(h('ul', rows)), '<ul><li>a</li><li>b</li></ul>');
      assert.equal(serialize(h('ul', [rows])), '<ul><li>a</li><li>b</li></ul>');
    });

    test('on* attributes are rejected', () => {
      for (const attr of ['onclick', 'onClick', 'onerror', 'ONLOAD']) {
        assert.throws(() => h('div', { [attr]: 'f()' }), /on\* attribute/);
      }
    });

    test('javascript: URLs are rejected in any attribute', () => {
      for (const value of ['javascript:alert(1)', '  javascript:alert(1)', 'JAVASCRIPT:x', 'java\tscript:x']) {
        assert.throws(() => h('a', { href: value }), /javascript:/);
      }
      assert.equal(serialize(h('a', { href: 'https://example.com' }, 'ok')), '<a href="https://example.com">ok</a>');
    });

    test('dataset object writes data-* attributes with kebab-case keys', () => {
      const el = h('button', { dataset: { compId: 'whale', installTag: 'v1', skip: false } }, 'x');
      assert.equal(serialize(el), '<button data-comp-id="whale" data-install-tag="v1">x</button>');
    });

    test('style object goes through setProperty with kebab-case names', () => {
      const el = h('div', { style: { top: '1px', zIndex: 2, '--custom-var': 'v' } });
      assert.deepEqual(el.style.props, { top: '1px', 'z-index': '2', '--custom-var': 'v' });
    });

    test('boolean and empty attributes follow HTML rules', () => {
      const el = h('input', { type: 'checkbox', checked: true, disabled: false, title: null });
      assert.equal(serialize(el), '<input type="checkbox" checked=""></input>');
    });

    test('class accepts an array and filters falsy entries', () => {
      const el = h('span', { class: ['badge', 'warn', null, ''] }, 'x');
      assert.equal(serialize(el), '<span class="badge warn">x</span>');
    });

    test('svg tag names are created in the SVG namespace', () => {
      const icon = h('svg', { viewBox: '0 0 12 12' }, h('path', { d: 'M3 3l6 6' }));
      assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.equal(icon.children[0].namespaceURI, 'http://www.w3.org/2000/svg');
      assert.equal(icon.children[0].tagName, 'PATH');
    });

    test('mount replaces children and clears with no arguments', () => {
      const host = fakeElement('ul');
      host.appendChild(fakeElement('li'));
      mount(host, h('li', {}, 'new'));
      assert.equal(serialize(host), '<ul><li>new</li></ul>');
      mount(host);
      assert.equal(serialize(host), '<ul></ul>');
    });

    test('mount accepts the same child shapes as h', () => {
      const host = fakeElement('div');
      mount(host, 'text', [h('span', {}, 's')], null);
      assert.equal(serialize(host), '<div>text<span>s</span></div>');
    });
  });
}
