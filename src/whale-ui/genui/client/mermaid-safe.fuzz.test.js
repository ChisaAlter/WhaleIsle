// Property-based fuzz for mermaid-safe.ts — the last check before mermaid's
// rendered SVG is injected via dangerouslySetInnerHTML. assertSafeSvg parses
// the markup as XML (image/svg+xml via DOMParser) and applies an element /
// attribute whitelist; the contract below is checked against an independent
// model of "scriptable construct", not against the implementation itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import fc from 'fast-check';
import { assertSafeSvg, mermaidKind, repairMermaidSource, ensureFlowchartKind } from './mermaid-safe.ts';

const require_ = createRequire(import.meta.url);
const { requirePrerequisite } = require_('../../../../scripts/lib/test-prerequisites.cjs');
// assertSafeSvg needs a real DOMParser; under Node it comes from jsdom, a
// whale-ui devDependency — the same source the genui test bench uses
// (src/whale-ui/tests/genui-helpers.mjs). mermaid itself is a whale-ui
// dependency; both resolve through the whale-ui package require.
const whaleUiRequire = createRequire(new URL('../../package.json', import.meta.url));
let JsdomDOMParser = null;
try {
  JsdomDOMParser = new (whaleUiRequire('jsdom').JSDOM)('').window.DOMParser;
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const DOM_CHECK = JsdomDOMParser === null
  ? { ok: false, reason: 'Whale UI 依赖缺失：src/whale-ui/node_modules/jsdom，先运行 npm run setup' }
  : { ok: true };
if (JsdomDOMParser !== null) globalThis.DOMParser = JsdomDOMParser;

const NUM_RUNS = 400;

const XSS_ATOMS = [
  '<script>', '</script>', '<script src="x">', '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>', '<svg/onload=alert(1)>', '<a href="javascript:alert(1)">',
  'javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
  ' vbscript:x', '<iframe src="https://x">', '<object data="x">', '<embed src="x">',
  '<foreignObject>', '<body onload=x>', 'onload=', ' onclick =', '"onfocus=',
  "'onmouseover=", '<use href="data:image/svg+xml;base64,x"/>', '<animate onbegin=x>',
  '<set attributeName=x to=y>', 'data:text/html,<script>', '<link rel=import>',
  '<form action=x>', '<meta http-equiv=refresh>', 'expression(', '&#x6a;avascript:',
];
const BENIGN_ATOMS = [
  '<svg viewBox="0 0 10 10">', '</svg>', '<g>', '</g>', '<rect x="1" y="2"/>',
  '<text x="3">A</text>', '<path d="M0 0L1 1"/>', 'class="node"', 'fill="#fff"',
  'A --> B', 'graph TD', '%% comment', '<style>.x{fill:#000}</style>',
];

const svgArb = fc.array(fc.constantFrom(...XSS_ATOMS, ...BENIGN_ATOMS, 'x', '<', '>', '"', "'", '=', '/', ' '), { minLength: 0, maxLength: 8 }).map((parts) => parts.join(''));

// Elements that can execute script, embed foreign/plugin content, or rewrite
// the host document — the whitelist must never let one through. `math`/
// `annotation-xml` are the classic HTML-reparse (mXSS) vectors inside
// foreignObject.
const NEVER_ELEMENTS = new Set([
  'script', 'iframe', 'object', 'embed', 'audio', 'video', 'form', 'meta',
  'link', 'base', 'math', 'set', 'animate', 'animatemotion',
  'animatetransform', 'mpath', 'applet', 'frame', 'frameset', 'noscript',
  'template', 'canvas', 'textarea', 'select', 'button',
]);
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'data', 'action', 'formaction', 'poster', 'ping',
  'background', 'lowsrc', 'dynsrc', 'base', 'cite', 'longdesc', 'profile',
]);
const URL_NOISE = /[\s\p{Cc}\p{Cf}]/gu;
const CSS_HAZARD = /@import|expression\(|behaviou?r:|-moz-binding|javascript:|vbscript:/;

// Independent oracle for "would a browser find something scriptable in the
// parsed tree": every element name must be outside NEVER_ELEMENTS, no `on*`
// attribute may exist, every URL-bearing attribute must normalize to a
// `#` fragment or http(s), and CSS must carry no import/external url().
function* hazards(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.doctype !== null || doc.getElementsByTagName('parsererror').length > 0) {
    yield 'not a well-formed standalone svg document';
    return;
  }
  const root = doc.documentElement;
  if (root === null || root.localName.toLowerCase() !== 'svg') yield 'non-svg root';
  for (const el of doc.getElementsByTagName('*')) {
    const tag = el.localName.toLowerCase();
    if (NEVER_ELEMENTS.has(tag)) yield `element <${tag}>`;
    const attrs = el.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      const name = attr.name.toLowerCase();
      const local = (attr.localName ?? name).toLowerCase();
      if (name.startsWith('on') || local.startsWith('on')) yield `handler ${attr.name}`;
      const compact = attr.value.toLowerCase().replace(URL_NOISE, '');
      if (URL_ATTRIBUTES.has(local) || URL_ATTRIBUTES.has(name)) {
        if (!compact.startsWith('#') && !compact.startsWith('http:') && !compact.startsWith('https:')) {
          yield `url ${attr.name}=${attr.value}`;
        }
      }
      if (CSS_HAZARD.test(compact)) yield `css hazard in ${attr.name}`;
      for (const m of compact.matchAll(/url\(['"]?/g)) {
        if (compact[m.index + m[0].length] !== '#') yield `external url() in ${attr.name}`;
      }
    }
    if (tag === 'style') {
      const compact = (el.textContent ?? '').toLowerCase().replace(URL_NOISE, '');
      if (CSS_HAZARD.test(compact)) yield 'css hazard in <style>';
      for (const m of compact.matchAll(/url\(['"]?/g)) {
        if (compact[m.index + m[0].length] !== '#') yield 'external url() in <style>';
      }
    }
  }
}

// The contract: whatever the gate accepts, the oracle must find clean.
test('assertSafeSvg: accepted markup contains no scriptable construct', (t) => {
  if (!requirePrerequisite(t, DOM_CHECK)) return;
  fc.assert(fc.property(svgArb, (svg) => {
    try {
      assertSafeSvg(svg);
    } catch {
      return true;
    }
    assert.deepEqual([...hazards(svg)], [], svg);
    return true;
  }), { numRuns: NUM_RUNS });
});

// #492 regression dictionary: every payload a browser would execute or
// navigate must throw — including the original regex bypasses
// (`<svg/onload=…>`, tab-split `java\tscript:`, `vbscript:`, foreignObject
// wrappers) and the surrounding payload family.
test('assertSafeSvg: known XSS payloads all throw', (t) => {
  if (!requirePrerequisite(t, DOM_CHECK)) return;
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
  const payloads = [
    // parser-level / structural
    '<svg/onload=alert(1)>',
    '<svg onload=alert(1)></svg>',
    '<?xml-stylesheet href="javascript:alert(1)"?><svg/>',
    '<!DOCTYPE svg><svg/>',
    '<svg><unclosed></svg>',
    'javascript:alert(1)',
    // event handlers, every separator shape
    `<svg ${NS}><rect onload="alert(1)"/></svg>`,
    `<svg ${NS}><g oNcLiCk="alert(1)"/></svg>`,
    // non-whitelisted scriptable / embedding elements
    `<svg ${NS}><script>alert(1)</script></svg>`,
    `<svg ${NS}><script href="x"/></svg>`,
    `<svg ${NS}><foreignObject><iframe src="https://evil"/></foreignObject></svg>`,
    `<svg ${NS}><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil"/></body></foreignObject></svg>`,
    `<svg ${NS}><foreignObject><math><annotation-xml encoding="text/html"><svg onload="alert(1)"/></annotation-xml></math></foreignObject></svg>`,
    `<svg ${NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><object data="x"/></div></foreignObject></svg>`,
    `<svg ${NS}><object data="x"/><embed src="x"/><iframe src="x"/><audio src="x"/><video src="x"/><form><input formaction="x"/></form><meta http-equiv="refresh" content="0;url=x"/><link rel="import" href="x"/><base href="x"/><canvas/><math/><animate attributeName="x"/><set attributeName="x" to="y"/></svg>`,
    // URL attributes: every non-#/http(s) scheme and every obfuscation
    `<svg ${NS}><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
    `<svg ${NS}><a href="java\tscript:alert(1)"><rect/></a></svg>`,
    `<svg ${NS}><a href="java\nscript:alert(1)"><rect/></a></svg>`,
    `<svg ${NS}><a href=" vbscript:x"><rect/></a></svg>`,
    `<svg ${NS}><a href="&#x6a;avascript:alert(1)"><rect/></a></svg>`,
    `<svg ${NS}><a href="jav&#x09;ascript:alert(1)"><rect/></a></svg>`,
    `<svg ${NS}><a href="data:text/html,<script>alert(1)</script>"><rect/></a></svg>`,
    `<svg ${NS}><a href=""><rect/></a></svg>`,
    `<svg ${NS} ${XLINK}><a xlink:href="javascript:alert(1)"><rect/></a></svg>`,
    `<svg ${NS} ${XLINK}><use xlink:href="data:image/svg+xml;base64,eA=="/></svg>`,
    `<svg ${NS}><image href="javascript:alert(1)"/></svg>`,
    `<svg ${NS}><image src="data:image/png;base64,eA=="/></svg>`,
    `<svg ${NS} xml:base="javascript:alert(1)/"><a href="#x"><rect/></a></svg>`,
    `<svg ${NS}><img src="file:///etc/passwd"/></svg>`,
    // CSS: external url(), @import, expression(, behavior
    `<svg ${NS}><style>@import "https://evil/x.css";</style></svg>`,
    `<svg ${NS}><style>rect{fill:url(https://evil/x)}</style></svg>`,
    `<svg ${NS}><style>rect{fill:u r l ( javascript:alert(1) )}</style></svg>`,
    `<svg ${NS}><style>rect{fill:url('#')}.a{width:expression(alert(1))}</style></svg>`,
    `<svg ${NS}><rect style="fill:url(javascript:alert(1))"/></svg>`,
    `<svg ${NS}><rect style="behavior: url(#x) javascript:alert(1)"/></svg>`,
    `<svg ${NS}><rect style="-moz-binding: url(https://evil/x)"/></svg>`,
  ];
  for (const payload of payloads) {
    assert.throws(() => assertSafeSvg(payload), /sanitization check/, payload);
  }
});

// The other half of the contract: legitimate rendered markup must pass —
// real mermaid output for every diagram kind the renderer ships, produced by
// the actual engine under jsdom with the production security settings.
const MERMAID_SAMPLES = {
  flowchart: 'graph TD\nA[Start node]-->B{Decide thing}\nB-->|yes|C[End node]\nB-->|no|D((Stop))',
  sequence: 'sequenceDiagram\nparticipant A\nparticipant B\nA->>B: hello\nB-->>A: world\nNote over A,B: note\nloop L\nA->>B: again\nend',
  class: 'classDiagram\nclass Animal {\n  +int age\n  +run()\n}\nAnimal <|-- Dog\nAnimal <|-- Cat',
  state: 'stateDiagram-v2\n[*] --> Still\nStill --> Moving\nMoving --> [*]',
  gantt: 'gantt\ntitle Plan\nsection S\nTask a: a1, 2024-01-01, 3d\nTask b: after a1, 2d',
  pie: 'pie title Pets\n"Dogs": 45\n"Cats": 30\n"Birds": 25',
  er: 'erDiagram\nCUSTOMER ||--o{ ORDER : places\nORDER ||--|{ ITEM : contains',
  journey: 'journey\ntitle Day\nsection Morning\nWake: 5: Me\nEat: 3: Me, Cat',
  gitGraph: 'gitGraph\ncommit\nbranch dev\ncheckout dev\ncommit\ncheckout main\nmerge dev',
  timeline: 'timeline\ntitle T\n2020 : a\n2021 : b',
  quadrant: 'quadrantChart\ntitle Q\nquadrant-1 A\nquadrant-2 B\nquadrant-3 C\nquadrant-4 D\nP: [0.5, 0.5]',
};

test('assertSafeSvg: real mermaid output of every shipped diagram kind passes', async (t) => {
  if (!requirePrerequisite(t, DOM_CHECK)) return;
  const { JSDOM } = whaleUiRequire('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://whale.invalid/', pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'DOMParser', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'XMLSerializer', 'MutationObserver', 'Event', 'CustomEvent', 'DocumentFragment', 'CSSStyleSheet', 'CSSRule', 'CSSStyleRule', 'DOMException'];
  const saved = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] });
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, writable: true, value: dom.window.getComputedStyle.bind(dom.window) });
  // jsdom lacks SVG layout APIs; mermaid only needs them to measure, so
  // fixed-size stubs keep rendering deterministic.
  globalThis.SVGElement.prototype.getBBox ??= () => ({ x: 0, y: 0, width: 120, height: 24 });
  globalThis.SVGElement.prototype.getComputedTextLength ??= () => 60;
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  });
  const { default: mermaid } = await import(pathToFileURL(whaleUiRequire.resolve('mermaid')).href);
  // Mirror mermaid-core.ts: strict sanitizer, no error-diagram fallback.
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'base' });
  let seq = 0;
  for (const [kind, code] of Object.entries(MERMAID_SAMPLES)) {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-100000px';
    document.body.appendChild(container);
    try {
      const { svg } = await mermaid.render(`genui-mermaid-${seq++}`, code, container);
      assert.doesNotThrow(() => assertSafeSvg(svg), `${kind} output was rejected`);
      assert.deepEqual([...hazards(svg)], [], kind);
    } finally {
      container.remove();
    }
  }
});

// Hand-shaped acceptance fixtures covering the whitelist corners mermaid
// may emit: fragment xlink:href on <use>, gradient/filter url(#…), a
// foreignObject label body, an outbound <a>/<image> http(s) target, and an
// svg root without a namespace (HTML-parser output is namespaced, but a
// well-formed un-namespaced tree is still not scriptable).
test('assertSafeSvg: whitelisted constructs pass', (t) => {
  if (!requirePrerequisite(t, DOM_CHECK)) return;
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
  const accepted = [
    `<svg ${NS} viewBox="0 0 10 10"><g><rect width="10" height="10"/></g></svg>`,
    `<svg ${NS}><defs><marker id="m"><path d="M0 0L1 1"/></marker></defs><path marker-end="url(#m)" d="M0 0"/></svg>`,
    `<svg ${NS}><style>.a{fill:#fff}@keyframes k{from{stroke-dashoffset:0}}</style><rect class="a"/></svg>`,
    `<svg ${NS}><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><filter id="f"><feDropShadow stdDeviation="2"/></filter></defs><rect fill="url(#g)" filter="url(#f)"/></svg>`,
    `<svg ${NS} ${XLINK}><defs><path id="p" d="M0 0"/></defs><use xlink:href="#p" href="#p"/></svg>`,
    `<svg ${NS}><a href="#fragment"><text>x</text></a><image href="https://example.test/i.png"/><a href="https://example.test/"><text>link</text></a></svg>`,
    `<svg ${NS}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="display: table-cell; white-space: nowrap;"><span class="nodeLabel">label</span><br/><p>text <em>x</em> <a href="https://example.test">y</a></p></div></foreignObject></svg>`,
    `<svg ${NS}><switch><foreignObject requiredExtensions="x"><div xmlns="http://www.w3.org/1999/xhtml">section</div></foreignObject><text>fallback</text></switch></svg>`,
    '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    `<svg ${NS}><title>t</title><desc>d</desc><clipPath id="c"><rect/></clipPath><rect clip-path="url(#c)"/></svg>`,
  ];
  for (const markup of accepted) {
    assert.doesNotThrow(() => assertSafeSvg(markup), markup);
  }
});

const codeArb = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.string({
    unit: fc.constantFrom(
      'a', 'B', '1', ' ', '\n', '`', '[', ']', '(', ')', '{', '}', '|', '-', '>',
      '=', '.', ':', '"', "'", '%', 'graph', 'flowchart', 'TD', '-->', '==>', '-.->',
      '%%', '<br/>', '<br>', '中', 'x', '-- ', ' -->',
    ),
    maxLength: 150,
  }),
  fc.constantFrom(
    'graph TD\nA-->B', 'flowchart LR\nA[模型 x]-->B', 'A --> B',
    'sequenceDiagram\nA->>B: x', 'pie\n"a":1', 'H -- 否(流式中) --> J',
    'graph TD\nA-->|"l[e]"|B', '```\ngraph TD\nA-->B', '',
  ),
);

test('repairMermaidSource: graph/flowchart output keeps no backticks or <br>', () => {
  fc.assert(fc.property(codeArb, (code) => {
    const out = repairMermaidSource(code);
    const kind = mermaidKind(code);
    if (kind !== 'graph' && kind !== 'flowchart') {
      assert.equal(out, code, code);
      return true;
    }
    assert.equal(out.includes('`'), false, `${code} -> ${out}`);
    assert.equal(/<br\s*\/?>/i.test(out), false, `${code} -> ${out}`);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('mermaidKind returns the first alphabetic word or empty', () => {
  fc.assert(fc.property(codeArb, (code) => {
    const kind = mermaidKind(code);
    assert.equal(kind === '' || /^[A-Za-z]+$/.test(kind), true, `${code} -> ${kind}`);
    return true;
  }), { numRuns: NUM_RUNS });
});

test('ensureFlowchartKind is a pure prepend-or-identity transform', () => {
  fc.assert(fc.property(codeArb, (code) => {
    const out = ensureFlowchartKind(code);
    assert.ok(out === code || out === `graph TD\n${code.trim()}`, `${code} -> ${out}`);
    return true;
  }), { numRuns: NUM_RUNS });
});
