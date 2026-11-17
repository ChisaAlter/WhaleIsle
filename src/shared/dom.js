'use strict';

// Shared DOM builder for every shell surface: file:// pages load it as
// ../shared/dom.js, the pet:// page as /dom.js (whitelist in
// desktop-live2d), injected chrome scripts get it concatenated ahead of
// their source, the sandboxed preview preload bundles it through esbuild,
// and Node tests require it. The mobile SPA cannot reach this file — the
// public deploy only uploads mobile/web/ — so it keeps an in-place ESM copy
// at mobile/web/ui/dom.js, contract-tested by src/shared/dom.test.js.
// String children always become text nodes, so interpolated values can
// never smuggle markup — that is the whole point of replacing innerHTML
// with this file.
//
//   h(tag, attrs?, ...children) — build one element.
//   mount(el, ...children)      — replaceChildren with the same child rules.
//
// Children: strings/numbers become text nodes, arrays flatten, and
// null/undefined/true/false drop out (conditional slots). attrs is a plain
// object (pass null to skip); a non-plain-object second argument is treated
// as the first child, so h('li', row) and h('ul', rows) both work.
//
// Attributes: every value goes through setAttribute — 'class' accepts a
// string or a truthy-filtered array, 'dataset' an object of camelCase keys
// written as data-* attributes, 'style' an object of properties (or a css
// text string), true means an empty boolean attribute, and
// null/undefined/false omit the attribute. on* attribute names and
// javascript: URL values throw: event handlers bind via addEventListener
// and URL attributes only ever carry http(s)/data constants.
//
// SVG tag names are created in the SVG namespace — createElement alone
// would build inert HTMLUnknownElements. Ambiguous names that also exist in
// HTML (a, title, style, script, image) stay HTML on purpose.
//
// The implementation is wrapped so `h`/`mount` never become global var
// bindings: consumer scripts destructure their own top-level `const h`/
// `mount`, and a global var+lexical name clash would be a SyntaxError that
// kills the whole consumer script.

const whaleDom = (() => {
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'marker', 'mask', 'pattern', 'clipPath',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'foreignObject',
  'linearGradient', 'radialGradient', 'stop',
  'animate', 'animateMotion', 'animateTransform', 'set', 'mpath',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight',
  'feDropShadow', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR',
  'feGaussianBlur', 'feImage', 'feMerge', 'feMergeNode', 'feMorphology',
  'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile',
  'feTurbulence', 'desc', 'metadata', 'view',
]);

function kebab(name) {
  return String(name).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function camel(name) {
  return String(name).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

function isAttrs(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return value.nodeType === undefined;
}

function applyDataset(el, dataset) {
  for (const [key, value] of Object.entries(dataset)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    el.setAttribute(`data-${kebab(key)}`, String(value));
  }
}

function applyStyle(el, style) {
  for (const [prop, value] of Object.entries(style)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (el.style && typeof el.style.setProperty === 'function') {
      el.style.setProperty(prop.startsWith('--') ? prop : kebab(prop), String(value));
    } else {
      el.style[camel(prop)] = String(value);
    }
  }
}

function applyAttrs(el, attrs) {
  for (const [rawName, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    const name = String(rawName);
    if (/^on/i.test(name)) {
      throw new TypeError(`h(): on* attribute "${name}" is not allowed; bind events with addEventListener`);
    }
    if (typeof value === 'string' && /^\s*j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:/i.test(value)) {
      throw new TypeError(`h(): javascript: URL is not allowed ("${name}")`);
    }
    if (name === 'class') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      continue;
    }
    if (name === 'dataset' && typeof value === 'object') {
      applyDataset(el, value);
      continue;
    }
    if (name === 'style' && typeof value === 'object') {
      applyStyle(el, value);
      continue;
    }
    el.setAttribute(name, value === true ? '' : String(value));
  }
}

function collectChild(out, child) {
  if (child === null || child === undefined || child === false || child === true) {
    return;
  }
  if (Array.isArray(child)) {
    for (const item of child) {
      collectChild(out, item);
    }
    return;
  }
  if (typeof child === 'string' || typeof child === 'number') {
    out.push(document.createTextNode(String(child)));
    return;
  }
  out.push(child);
}

function h(tag, attrs, ...children) {
  if (!isAttrs(attrs)) {
    children.unshift(attrs);
    attrs = null;
  }
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  if (attrs) {
    applyAttrs(el, attrs);
  }
  const flat = [];
  for (const child of children) {
    collectChild(flat, child);
  }
  for (const node of flat) {
    el.appendChild(node);
  }
  return el;
}

function mount(el, ...children) {
  const flat = [];
  for (const child of children) {
    collectChild(flat, child);
  }
  el.replaceChildren(...flat);
  return el;
}

return { h, mount };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = whaleDom;
}
// Both globals: classic-script consumers and injected realms read
// window.whaleDom, while a Node ESM test importing this file only gets
// globalThis.
if (typeof window !== 'undefined') {
  window.whaleDom = whaleDom;
}
if (typeof globalThis !== 'undefined') {
  globalThis.whaleDom = whaleDom;
}
