// In-place ESM copy of src/shared/dom.js for the mobile SPA.
//
// The public deploy (scripts/deploy-dshd-public-spa.mjs) only uploads files
// under mobile/web/, so this page must not import across the tree — the
// implementation lives here verbatim. src/shared/dom.test.js runs the same
// assertions against both copies, so they cannot drift: edit them together.
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

/**
 * Attribute map accepted by h(): keys are setAttribute names; values are
 * strings/numbers, booleans (true = empty attribute; false, null and
 * undefined omit the attribute), or the structured forms for 'class'
 * (string or truthy-filtered array), 'dataset' (object of camelCase keys
 * written as data-*) and 'style' (object of properties or css text).
 * on* names and javascript: URL values throw instead of applying.
 * @typedef {Object.<string, *>} WhaleDomAttrs
 */

/**
 * Anything h()/mount() accepts as a child: nodes append as-is, strings and
 * numbers become text nodes, arrays flatten recursively, and null,
 * undefined and booleans drop out (conditional slots).
 * @typedef {Node | string | number | boolean | null | undefined | *[]} WhaleDomChild
 */

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

/**
 * @param {string} name
 * @returns {string} camelCase input lowercased to kebab-case.
 */
function kebab(name) {
  return String(name).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * @param {string} name
 * @returns {string} kebab-case input raised to camelCase.
 */
function camel(name) {
  return String(name).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

/**
 * The second argument of h() is the attrs map only when it is a plain
 * object; nodes, arrays and primitives shift into the children list so
 * h('li', row) and h('ul', rows) work. null/undefined count as "no attrs".
 * @param {*} value
 * @returns {boolean}
 */
function isAttrs(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return value.nodeType === undefined;
}

/**
 * @param {Element} el
 * @param {Object.<string, *>} dataset camelCase keys written as data-*
 *   attributes; null/undefined/false entries are skipped.
 */
function applyDataset(el, dataset) {
  for (const [key, value] of Object.entries(dataset)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    el.setAttribute(`data-${kebab(key)}`, String(value));
  }
}

/**
 * @param {Element} el
 * @param {Object.<string, *>} style property map; camelCase names are
 *   kebab-cased for setProperty, '--' custom properties pass through, and
 *   null/undefined/false entries are skipped.
 */
function applyStyle(el, style) {
  // .style only exists on HTMLElement/SVGElement typing; h() always passes
  // elements carrying it, while test fakes may expose a plain object
  // without setProperty, so the value is read loosely either way.
  const css = /** @type {*} */ (el).style;
  for (const [prop, value] of Object.entries(style)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (css && typeof css.setProperty === 'function') {
      css.setProperty(prop.startsWith('--') ? prop : kebab(prop), String(value));
    } else {
      css[camel(prop)] = String(value);
    }
  }
}

/**
 * @param {Element} el
 * @param {WhaleDomAttrs} attrs
 */
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

/**
 * @param {Node[]} out accumulator for the flattened child list.
 * @param {WhaleDomChild} child
 */
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

/**
 * Build one element. Strings/numbers become text nodes — interpolated
 * values can never smuggle markup.
 * @param {string} tag tag name; names in SVG_TAGS are created in the SVG
 *   namespace.
 * @param {WhaleDomAttrs | WhaleDomChild} [attrs] attribute map; a non
 *   plain-object value is treated as the first child instead.
 * @param {...WhaleDomChild} children
 * @returns {Element}
 */
function h(tag, attrs, ...children) {
  if (!isAttrs(attrs)) {
    children.unshift(/** @type {WhaleDomChild} */ (attrs));
    attrs = null;
  }
  const el = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);
  if (attrs) {
    applyAttrs(el, /** @type {WhaleDomAttrs} */ (attrs));
  }
  /** @type {Node[]} */
  const flat = [];
  for (const child of children) {
    collectChild(flat, child);
  }
  for (const node of flat) {
    el.appendChild(node);
  }
  return el;
}

/**
 * replaceChildren with the same child rules as h().
 * @param {Element} el host element whose children are replaced.
 * @param {...WhaleDomChild} children
 * @returns {Element} the host element.
 */
function mount(el, ...children) {
  /** @type {Node[]} */
  const flat = [];
  for (const child of children) {
    collectChild(flat, child);
  }
  el.replaceChildren(...flat);
  return el;
}

export { h, mount };
