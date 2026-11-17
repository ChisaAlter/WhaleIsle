'use strict';

// Node-test harness for the launcher page scripts. The production page loads
// its code as several classic <script> files sharing one global lexical
// scope; this kit reproduces that load order in a single vm context, over a
// small fake DOM built by parsing the real launcher.html, so tests drive the
// shipped structure and wiring instead of a parallel mock.
//
//   launcherScripts()        — ordered script list ({src, file, defer})
//   launcherSources()        — Map<src, source> in load order
//   sourceContaining(marker) — the source of the script holding `marker`
//   createLauncherDocument() — fake DOM parsed from launcher.html
//   loadLauncherPage(opts)   — { context, window, document, fireDOMContentLoaded }
//
// The fake DOM supports the selector subset launcher.js uses (tag, .class,
// #id, [attr], [attr=v], :checked, :disabled, :not(...), :scope, descendant
// and child combinators, comma lists) plus addEventListener/dispatch with
// bubbling up to document.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RENDERER_DIR = __dirname;
const LAUNCHER_HTML = path.join(RENDERER_DIR, 'launcher.html');

function launcherScripts() {
  const html = fs.readFileSync(LAUNCHER_HTML, 'utf8');
  const scripts = [];
  for (const match of html.matchAll(/<script\b[^>]*>/g)) {
    const tag = match[0];
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (!src) continue;
    scripts.push({ src, file: path.resolve(RENDERER_DIR, src), defer: /\bdefer\b/.test(tag) });
  }
  // Deferred <head> scripts execute after the inline body scripts at load.
  return [...scripts.filter((s) => !s.defer), ...scripts.filter((s) => s.defer)];
}

function launcherSources() {
  const sources = new Map();
  for (const script of launcherScripts()) {
    sources.set(script.src, fs.readFileSync(script.file, 'utf8'));
  }
  return sources;
}

function sourceContaining(marker) {
  for (const source of launcherSources().values()) {
    if (source.includes(marker)) return source;
  }
  throw new Error(`no launcher page script contains ${JSON.stringify(marker)}`);
}

// --- Fake DOM --------------------------------------------------------------

function kebab(name) {
  return String(name).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(selector)) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

// 'nav.tabs[role="tablist"] > a.x:not(:disabled)' →
// [{ combinator: null, compound: 'nav.tabs[role="tablist"]' }, ...]
function parseSelector(selector) {
  const parts = [];
  let compound = '';
  let combinator = null;
  let depth = 0;
  const flush = () => {
    const text = compound.trim();
    if (text) parts.push({ combinator, compound: text });
    compound = '';
  };
  for (const ch of String(selector).trim()) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (ch === '>' || ch === ' ' || ch === '+' || ch === '~')) {
      flush();
      combinator = ch === '>' ? '>' : ' ';
      if (ch === '+' || ch === '~') {
        throw new Error(`fake DOM: sibling combinator ${ch} is not supported`);
      }
      continue;
    }
    compound += ch;
  }
  flush();
  for (const part of parts.slice(1)) {
    if (part.combinator === null) part.combinator = ' ';
  }
  return parts;
}

function matchAttr(el, attr) {
  const match = /^([^~|^$*!=\s]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?$/.exec(attr.trim());
  if (!match) return false;
  const [, name, dq, sq, bare] = match;
  if (!el.hasAttribute(name)) return false;
  const expected = dq ?? sq ?? bare;
  if (expected === undefined) return true;
  return el.getAttribute(name) === expected;
}

function matchPseudo(el, pseudo, arg, scopeEl) {
  switch (pseudo) {
    case 'checked': return el.checked === true;
    case 'disabled': return el.disabled === true || el.hasAttribute('disabled');
    case 'enabled': return !(el.disabled === true || el.hasAttribute('disabled'));
    case 'hidden': return el.hidden === true || el.hasAttribute('hidden');
    case 'scope': return el === scopeEl;
    case 'not': return !matchCompound(el, String(arg), scopeEl);
    default: throw new Error(`fake DOM: pseudo-class :${pseudo} is not supported`);
  }
}

function matchCompound(el, compound, scopeEl) {
  const token = /\*|[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?/g;
  let saw = false;
  for (const piece of compound.match(token) || []) {
    saw = true;
    if (piece === '*') continue;
    if (piece.startsWith('#')) {
      if (el.getAttribute('id') !== piece.slice(1)) return false;
    } else if (piece.startsWith('.')) {
      if (!el.classList.contains(piece.slice(1))) return false;
    } else if (piece.startsWith('[')) {
      if (!matchAttr(el, piece.slice(1, -1))) return false;
    } else if (piece.startsWith(':')) {
      const argStart = piece.indexOf('(');
      const name = argStart === -1 ? piece.slice(1) : piece.slice(1, argStart);
      const arg = argStart === -1 ? undefined : piece.slice(argStart + 1, -1);
      if (!matchPseudo(el, name, arg, scopeEl)) return false;
    } else if (el.tagName !== piece.toUpperCase()) {
      return false;
    }
  }
  return saw;
}

function matchSelector(el, selector, scopeEl) {
  const parts = parseSelector(selector);
  if (!parts.length) return false;
  let node = el;
  if (!matchCompound(node, parts.at(-1).compound, scopeEl)) return false;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const part = parts[i];
    if (part.combinator === '>') {
      node = node.parentElement;
      if (!node || !matchCompound(node, part.compound, scopeEl)) return false;
    } else {
      node = node.parentElement;
      while (node && !matchCompound(node, part.compound, scopeEl)) {
        node = node.parentElement;
      }
      if (!node) return false;
    }
  }
  return true;
}

function matchesAny(el, selector, scopeEl) {
  return splitSelectorList(selector).some((single) => matchSelector(el, single, scopeEl));
}

function dispatch(target, event) {
  if (typeof event === 'string') event = { type: event };
  event.target = event.target || target;
  if (typeof event.preventDefault !== 'function') {
    event.preventDefault = () => { event.defaultPrevented = true; };
  }
  if (typeof event.stopPropagation !== 'function') {
    event.stopPropagation = () => { event._stopped = true; };
  }
  if (typeof event.stopImmediatePropagation !== 'function') {
    event.stopImmediatePropagation = () => { event._stopped = true; event._stoppedNow = true; };
  }
  const path = [];
  for (let node = target; node; node = node.parentNode) path.push(node);
  const doc = target.ownerDocument || (target.nodeType === 9 ? target : null);
  if (doc && path.at(-1) !== doc) path.push(doc);
  for (const node of path) {
    event.currentTarget = node;
    const property = node[`on${event.type}`];
    if (typeof property === 'function') property.call(node, event);
    for (const listener of node._listeners || []) {
      if (listener.type === event.type) listener.fn.call(node, event);
      if (event._stoppedNow) break;
    }
    if (event._stopped) break;
  }
  return !event.defaultPrevented;
}

function serialize(node) {
  if (node.nodeType === 3) {
    return node.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  const open = [...node.attributes()]
    .map(([name, value]) => ` ${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join('');
  return `<${node.tagName.toLowerCase()}${open}>${node.childNodes.map(serialize).join('')}</${node.tagName.toLowerCase()}>`;
}

class FakeNode {
  constructor(doc, nodeType) {
    this.ownerDocument = doc;
    this.nodeType = nodeType;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = [];
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.nodeType === 9;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] || null;
  }

  appendChild(child) {
    child.parentNode?.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) {
      this.appendChild(typeof node === 'string' || typeof node === 'number'
        ? this.ownerDocument.createTextNode(String(node))
        : node);
    }
  }

  prepend(...nodes) {
    for (const node of nodes) {
      this.insertBefore(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node, this.childNodes[0] || null);
    }
  }

  insertBefore(node, ref) {
    node.parentNode?.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    const index = ref ? this.childNodes.indexOf(ref) : -1;
    node.parentNode = this;
    this.childNodes.splice(index === -1 ? this.childNodes.length : index, 0, node);
    return node;
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...nodes);
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  addEventListener(type, fn) {
    this._listeners.push({ type, fn });
  }

  removeEventListener(type, fn) {
    this._listeners = this._listeners.filter((l) => l.type !== type || l.fn !== fn);
  }

  dispatchEvent(event) {
    return dispatch(this, event);
  }
}

class FakeText extends FakeNode {
  constructor(doc, text) {
    super(doc, 3);
    this.textContent = String(text);
  }
}

const REFLECTED_BOOLEAN = new Set(['hidden', 'disabled', 'open', 'readonly', 'required', 'autofocus']);

class FakeElement extends FakeNode {
  constructor(doc, tag, namespaceURI = null) {
    super(doc, 1);
    this.ownerDocument = doc;
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = namespaceURI;
    this._attrs = new Map();
    this.checked = false;
    this.indeterminate = false;
    this.value = '';
    this._styleProps = {};
    const el = this;
    this.style = new Proxy(this._styleProps, {
      get(props, key) {
        if (key === 'setProperty') return (name, value) => { props[name] = String(value); };
        if (key === 'removeProperty') return (name) => { delete props[name]; };
        if (key === 'cssText') return Object.entries(props).map(([k, v]) => `${k}: ${v};`).join(' ');
        return props[key];
      },
      set(props, key, value) {
        props[key] = String(value);
        return true;
      },
      deleteProperty(props, key) {
        delete props[key];
        return true;
      },
    });
    this.dataset = new Proxy({}, {
      get(_t, key) {
        const value = el.getAttribute(`data-${kebab(key)}`);
        return value === null ? undefined : value;
      },
      set(_t, key, value) {
        el.setAttribute(`data-${kebab(key)}`, String(value));
        return true;
      },
      has(_t, key) {
        return el.hasAttribute(`data-${kebab(key)}`);
      },
      deleteProperty(_t, key) {
        el.removeAttribute(`data-${kebab(key)}`);
        return true;
      },
      ownKeys() {
        return [...el._attrs.keys()]
          .filter((name) => name.startsWith('data-'))
          .map((name) => name.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()));
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      },
    });
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      add: (...names) => { names.forEach((name) => classes.add(name)); el._syncClass(classes); },
      remove: (...names) => { names.forEach((name) => classes.delete(name)); el._syncClass(classes); },
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        el._syncClass(classes);
        return on;
      },
      _set: classes,
    };
  }

  _syncClass(classes = this.classList._set) {
    const text = [...classes].join(' ');
    if (text) this._attrs.set('class', text);
    else this._attrs.delete('class');
  }

  attributes() {
    return [...this._attrs.entries()];
  }

  setAttribute(name, value) {
    const key = String(name);
    this._attrs.set(key, String(value));
    if (key === 'class') {
      this.classList._set.clear();
      for (const cls of String(value).split(/\s+/).filter(Boolean)) this.classList._set.add(cls);
    } else if (key === 'checked') {
      this.checked = true;
    } else if (key === 'value') {
      this.value = String(value);
    }
  }

  getAttribute(name) {
    const key = String(name);
    return this._attrs.has(key) ? this._attrs.get(key) : null;
  }

  hasAttribute(name) {
    return this._attrs.has(String(name));
  }

  removeAttribute(name) {
    const key = String(name);
    this._attrs.delete(key);
    if (key === 'class') this.classList._set.clear();
    else if (key === 'checked') this.checked = false;
  }

  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (on) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return on;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  set id(value) {
    this.setAttribute('id', value);
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get hidden() {
    return this.hasAttribute('hidden');
  }

  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }

  get disabled() {
    return this.hasAttribute('disabled');
  }

  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  get open() {
    return this.hasAttribute('open');
  }

  set open(value) {
    if (value) this.setAttribute('open', '');
    else this.removeAttribute('open');
  }

  get title() {
    return this.getAttribute('title') || '';
  }

  set title(value) {
    this.setAttribute('title', value);
  }

  get type() {
    return this.getAttribute('type') || '';
  }

  set type(value) {
    this.setAttribute('type', value);
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  set name(value) {
    this.setAttribute('name', value);
  }

  get tabIndex() {
    const value = this.getAttribute('tabindex');
    return value === null ? -1 : Number.parseInt(value, 10);
  }

  set tabIndex(value) {
    this.setAttribute('tabindex', String(value));
  }

  get role() {
    return this.getAttribute('role');
  }

  get textContent() {
    return this.childNodes
      .map((node) => (node.nodeType === 3 ? node.textContent : node.textContent))
      .join('');
  }

  set textContent(value) {
    this.replaceChildren(...(String(value) === '' ? [] : [this.ownerDocument.createTextNode(String(value))]));
  }

  get innerHTML() {
    return this.childNodes.map(serialize).join('');
  }

  set innerHTML(value) {
    this.replaceChildren(...(value ? [this.ownerDocument.createTextNode(value)] : []));
  }

  get isVisible() {
    return this.checkVisibility();
  }

  checkVisibility() {
    if (!this.isConnected) return false;
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden) return false;
    }
    return true;
  }

  matches(selector) {
    return matchesAny(this, selector, this);
  }

  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
      if (matchesAny(node, selector, this.ownerDocument.documentElement)) return node;
    }
    return null;
  }

  _descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelectorAll(selector) {
    return this._descendants().filter((el) => matchesAny(el, selector, this));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  focus() {
    const doc = this.ownerDocument;
    const previous = doc.activeElement;
    if (previous === this) return;
    if (previous && previous.nodeType === 1) {
      dispatch(previous, { type: 'focusout', relatedTarget: this });
    }
    doc.activeElement = this;
    dispatch(this, { type: 'focusin', relatedTarget: previous });
    dispatch(this, { type: 'focus' });
  }

  blur() {
    const doc = this.ownerDocument;
    if (doc.activeElement !== this) return;
    doc.activeElement = null;
    dispatch(this, { type: 'focusout', relatedTarget: null });
    dispatch(this, { type: 'blur' });
  }

  click() {
    dispatch(this, { type: 'click', button: 0 });
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }

  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  get scrollWidth() { return 0; }
  get scrollHeight() { return 0; }

  scrollIntoView() {}
}

class FakeDocument extends FakeNode {
  constructor() {
    super(null, 9);
    this.ownerDocument = this;
    this.activeElement = null;
    this.documentElement = new FakeElement(this, 'html');
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.head, this.body);
    this.appendChild(this.documentElement);
  }

  createElement(tag) {
    return new FakeElement(this, tag);
  }

  createElementNS(ns, tag) {
    return new FakeElement(this, tag, ns);
  }

  createTextNode(text) {
    return new FakeText(this, text);
  }

  getElementById(id) {
    const found = this.documentElement._descendants().find((el) => el.getAttribute('id') === id);
    if (found) return found;
    // The page only queries ids its own markup ships; an unlisted id gets an
    // orphan so a missing fixture surface fails loudly at first use instead
    // of crashing the whole script evaluation.
    const orphan = new FakeElement(this, 'div');
    orphan.setAttribute('id', id);
    this._orphans = this._orphans || new Map();
    if (!this._orphans.has(id)) this._orphans.set(id, orphan);
    return this._orphans.get(id);
  }

  querySelectorAll(selector) {
    const candidates = [this.documentElement, ...this.documentElement._descendants()];
    return candidates.filter((el) => matchesAny(el, selector, this.documentElement));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

// --- launcher.html → fake DOM ----------------------------------------------

const VOID_TAGS = new Set(['meta', 'link', 'img', 'input', 'br', 'hr', 'source', 'wbr',
  'path', 'rect', 'circle', 'line', 'polyline', 'polygon', 'use', 'stop']);

function decodeEntities(text) {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttrs(source) {
  const attrs = [];
  const re = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let match;
  while ((match = re.exec(source))) {
    const [, name, , dq, sq, bare] = match;
    attrs.push([name, decodeEntities(dq ?? sq ?? bare ?? '')]);
  }
  return attrs;
}

function parseHtmlInto(doc, html, host) {
  const clean = String(html).replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  const stack = [host];
  while (i < clean.length) {
    const lt = clean.indexOf('<', i);
    const text = lt === -1 ? clean.slice(i) : clean.slice(i, lt);
    if (text.trim()) hostAppend(stack.at(-1), doc.createTextNode(decodeEntities(text)));
    if (lt === -1) break;
    i = lt;
    if (clean.startsWith('</', i)) {
      const end = clean.indexOf('>', i);
      const name = clean.slice(i + 2, end).trim().toLowerCase();
      while (stack.length > 1 && stack.at(-1).tagName !== name.toUpperCase()) stack.pop();
      if (stack.length > 1) stack.pop();
      i = end + 1;
      continue;
    }
    if (/^<![^>]*>/.test(clean.slice(i))) {
      i += clean.slice(i).match(/^<![^>]*>/)[0].length;
      continue;
    }
    const end = clean.indexOf('>', i);
    if (end === -1) break;
    const inside = clean.slice(i + 1, end);
    const selfClose = /\/\s*$/.test(inside);
    const space = inside.search(/[\s/]/);
    const name = (space === -1 ? inside : inside.slice(0, space)).toLowerCase();
    const attrSource = space === -1 ? '' : inside.slice(space);
    const el = doc.createElement(name);
    for (const [attr, value] of parseAttrs(attrSource)) {
      el.setAttribute(attr, value);
    }
    if (el.hasAttribute('checked')) el.checked = true;
    hostAppend(stack.at(-1), el);
    if (!selfClose && !VOID_TAGS.has(name)) stack.push(el);
    i = end + 1;
  }
}

function hostAppend(host, node) {
  if (host.nodeType === 9) host.documentElement.appendChild(node);
  else host.appendChild(node);
}

function createLauncherDocument() {
  const doc = new FakeDocument();
  const html = fs.readFileSync(LAUNCHER_HTML, 'utf8');
  const htmlTag = /<html\b([^>]*)>/.exec(html);
  if (htmlTag) {
    for (const [name, value] of parseAttrs(htmlTag[1])) {
      doc.documentElement.setAttribute(name, value);
    }
  }
  const headMatch = /<head>([\s\S]*?)<\/head>/i.exec(html);
  if (headMatch) parseHtmlInto(doc, headMatch[1], doc.head);
  const bodyMatch = /<body>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) parseHtmlInto(doc, bodyMatch[1], doc.body);
  return doc;
}

// --- vm page loader ---------------------------------------------------------

const STUB_OBSERVER = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
};

function defaultSandbox() {
  return {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ResizeObserver: STUB_OBSERVER,
    MutationObserver: STUB_OBSERVER,
    getComputedStyle: () => ({ color: '', animationName: '', borderTopColor: '', getPropertyValue: () => '' }),
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    CSS: { escape: (value) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`) },
  };
}

// Evaluates every <script src> of launcher.html in page order inside one vm
// context — deferred head scripts last, like the browser. `api` becomes
// window.shell. Returns handles to inspect the shared global scope and to
// fire DOMContentLoaded so bind()/refreshStatus run exactly as at load.
function loadLauncherPage({ api = {}, document: doc, window: win, sandbox: extra } = {}) {
  doc = doc || createLauncherDocument();
  win = win || {};
  win.shell = api;
  if (typeof win.addEventListener !== 'function') win.addEventListener = () => {};
  if (typeof win.removeEventListener !== 'function') win.removeEventListener = () => {};
  if (typeof win.setTimeout !== 'function') win.setTimeout = setTimeout;
  if (typeof win.devicePixelRatio !== 'number') win.devicePixelRatio = 1;
  const sandbox = { ...defaultSandbox(), ...extra, window: win, document: doc };
  const context = vm.createContext(sandbox);
  for (const { file } of launcherScripts()) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const fireDOMContentLoaded = () => dispatch(doc, { type: 'DOMContentLoaded', target: doc });
  return { context, document: doc, window: win, fireDOMContentLoaded,
    evalIn: (source) => vm.runInContext(source, context) };
}

module.exports = {
  RENDERER_DIR,
  LAUNCHER_HTML,
  launcherScripts,
  launcherSources,
  sourceContaining,
  createLauncherDocument,
  loadLauncherPage,
  dispatch,
  matchesAny,
};
