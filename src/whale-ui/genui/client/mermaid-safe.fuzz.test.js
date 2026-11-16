// Property-based fuzz for mermaid-safe.ts — the last check before mermaid's
// rendered SVG is injected via dangerouslySetInnerHTML. Accepted markup must
// contain no scriptable construct an HTML parser would honor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { assertSafeSvg, mermaidKind, repairMermaidSource, ensureFlowchartKind } from './mermaid-safe.ts';

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

// The documented contract: the regex-backed gate refuses `<script`,
// `[\s"']on\w+=` and literal `javascript:` — accepted markup contains none.
test('assertSafeSvg: accepted markup contains none of the documented hazards', () => {
  fc.assert(fc.property(svgArb, (svg) => {
    try {
      assertSafeSvg(svg);
    } catch {
      return true;
    }
    assert.equal(/<script/i.test(svg), false, svg);
    assert.equal(/[\s"']on[a-z]+\s*=/i.test(svg), false, svg);
    assert.equal(/javascript:/i.test(svg), false, svg);
    return true;
  }), { numRuns: NUM_RUNS });
});

// FINDING (see report): the regex misses constructs a browser executes —
// `[\s"']` before on* forgets `/` (an attribute separator), scheme matching
// is literal so tab/newline split `java\tscript:`, `vbscript:`/`data:` are
// uncovered, and non-script elements (<iframe>/<object>/<foreignObject>)
// are not checked at all.
test.todo('#492: assertSafeSvg must match the HTML parser model — minimal counterexamples: <svg/onload=alert(1)>, <a href="java\tscript:alert(1)">, <svg><foreignObject><iframe src="https://evil">, " vbscript:x" are all accepted today');

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
