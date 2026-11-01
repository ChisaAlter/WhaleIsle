'use strict';

// Selector shapes that make Chromium restyle whole subtrees. Chromium merges
// the invalidation sets of every :has() rule (and of every structural
// pseudo-class rule), and a right-most compound without a class, id,
// attribute, or tag cannot be narrowed: one such rule anywhere in the client
// made each composer keystroke, row mount, and Turn start restyle the whole
// transcript (10k+ elements, 100ms+ per pass in a long session).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGES = path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'packages');

// Adjacent-only rules over short sidebar lists and the font settings group:
// each invalidates one sibling, never the transcript.
const ALLOWED_SIBLING = new Set([
  'client/ui-workspace/src/client/rows/Rows.module.css: .sessionRunInner > * + *',
  'client/ui-workspace/src/client/rows/WorkspaceBrowser.module.css: .flatList > * + *',
  'client/ui-workspace/src/client/rows/WorkspaceBrowser.module.css: .groupSection > * + *',
]);

// Attributes that toggle on transcript ancestors at every Turn start/end or
// first send; rules keyed on them must name what they restyle.
const TOGGLING = ['data-chat-motion', 'data-input-fold', 'data-composer-entering'];

function cssFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'lib', 'dist', 'tests', 'test'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) cssFiles(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** Split on separators that sit outside parentheses and brackets. */
function splitTop(text, isSeparator) {
  const parts = [];
  const separators = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && isSeparator(ch)) {
      parts.push(current);
      separators.push(ch);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return { parts, separators };
}

/** Compounds and the combinators between them. */
function compounds(selector) {
  const normalized = selector.replace(/\s*([>~+])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const { parts, separators } = splitTop(normalized, (ch) => ch === ' ' || ch === '>' || ch === '~' || ch === '+');
  return { compounds: parts, combinators: separators };
}

/** Whether a compound carries a class, id, attribute, or tag Chromium can key an invalidation set on. */
function hasFeature(compound) {
  const unwrapped = compound.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, '$1').replace(/::?[a-z-]+$/, '');
  if (/^[a-zA-Z]/.test(unwrapped)) return true;
  let depth = 0;
  for (const ch of unwrapped) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && (ch === '.' || ch === '#' || ch === '[')) return true;
  }
  const is = /^:(?:is|where)\(((?:[^()]|\([^()]*\))*)\)/.exec(unwrapped);
  return is !== null && splitTop(is[1], (ch) => ch === ',').parts.every((arg) => hasFeature(arg.trim()));
}

function selectors() {
  const out = [];
  for (const file of cssFiles(PACKAGES)) {
    const rel = path.relative(PACKAGES, file).split(path.sep).join('/');
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /([^{}@;]+)\{/g;
    let match;
    while ((match = rule.exec(css)) !== null) {
      const list = match[1].trim();
      if (!list || /^(?:from|to|\d+%)/.test(list)) continue;
      for (const selector of splitTop(list, (ch) => ch === ',').parts.map((part) => part.trim()).filter(Boolean)) {
        out.push({ rel, selector, ...compounds(selector) });
      }
    }
  }
  return out;
}

const ALL = selectors();

test('the scan reads the Harness client stylesheets', () => {
  assert.ok(ALL.length > 1000, `expected the client CSS, found ${ALL.length} selectors`);
});

test('no :has() rule ends in a featureless compound after its anchor', () => {
  const bad = ALL.filter(({ compounds: list }) => list.length > 1
    && list.slice(0, -1).some((compound) => compound.includes(':has('))
    && !hasFeature(list.at(-1)));
  assert.deepEqual(bad.map(({ rel, selector }) => `${rel}: ${selector}`), []);
});

test('no sibling combinator is followed by a featureless compound', () => {
  const bad = ALL.filter(({ compounds: list, combinators }) => combinators.some((c) => c === '~' || c === '+')
    && !hasFeature(list.at(-1)))
    .map(({ rel, selector }) => `${rel}: ${selector.replace(/\s+/g, ' ')}`)
    .filter((entry) => !ALLOWED_SIBLING.has(entry));
  assert.deepEqual(bad, []);
});

test('rules keyed on toggling transcript attributes name their targets', () => {
  const bad = ALL.filter(({ compounds: list }) => list.length > 1
    && list.slice(0, -1).some((compound) => TOGGLING.some((attribute) => compound.includes(`[${attribute}`)))
    && !hasFeature(list.at(-1)));
  assert.deepEqual(bad.map(({ rel, selector }) => `${rel}: ${selector}`), []);
});

test('no *-of-type pseudo-class sits before a combinator', () => {
  const bad = ALL.filter(({ compounds: list }) => list.slice(0, -1).some((compound) => /:(?:first|last|nth|nth-last|only)-of-type/.test(compound)));
  assert.deepEqual(bad.map(({ rel, selector }) => `${rel}: ${selector}`), []);
});

test('the scanner flags the shapes that restyled the transcript', () => {
  const flags = (selector) => {
    const { compounds: list, combinators } = compounds(selector);
    return !hasFeature(list.at(-1)) && (list.slice(0, -1).some((compound) => compound.includes(':has(')) || combinators.some((c) => c === '~' || c === '+'));
  };
  assert.equal(flags('.column:has(> .older) > [data-slot="flow"] > :not([hidden]):not(.flowItem:is(:empty))'), true);
  assert.equal(flags(':is(.column, [data-slot="flow"]) > :not([hidden]) ~ :not([hidden])'), true);
  assert.equal(flags(':is(.column, [data-slot="flow"]) > :not([hidden]) ~ :is([data-chat-flow-key], [data-slot]):not([hidden])'), false);
  assert.equal(flags('.root:has([data-composer-entering]) .header > :is(.titleRow, .tabs)'), false);
  assert.equal(hasFeature(':global([data-conversation-scroll])'), true);
  assert.equal(hasFeature(':not([hidden]):not(.flowItem)'), false);
});
