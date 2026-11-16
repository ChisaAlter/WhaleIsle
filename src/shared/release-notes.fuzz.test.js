'use strict';

// Property-based fuzz for release-notes.js plainReleaseNotes / releaseNotesTabs
// — the markdown → plain-text stripper whose output is painted as text in the
// update dialog. Output must stay plain text: no markdown link/image syntax,
// no folded-section tags, never longer than the input, never a throw.
const test = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

const { plainReleaseNotes, releaseNotesTabs } = require('./release-notes');

const NUM_RUNS = 400;

const mdArb = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({
    unit: fc.constantFrom(
      'a', 'B', '0', ' ', '\n', '#', '*', '_', '`', '>', '-', '+', '[', ']',
      '(', ')', '!', '<', '>', 'details', 'summary', 'English', 'x', '·', '中',
      '![', '](', '**', '__', '### ', '<details>', '</details>', '<summary>', '</summary>',
    ),
    maxLength: 150,
  }),
  fc.constantFrom(
    '# Title', '**bold**', '[a](b)', '![i](u)', '> q', '- [x] t', '`c`',
    '<details><summary>English</summary>en</details>zh',
    '***x***', 'a< b', '<script>alert(1)</script>', '![](x)', '',
  ),
);

test('plainReleaseNotes emits only plain text: no links, images or fold tags', () => {
  fc.assert(fc.property(mdArb, (input) => {
    const out = plainReleaseNotes(input);
    assert.equal(typeof out, 'string');
    assert.equal(/!?\[[^\]]*\]\([^)]*\)/.test(out), false, `${input} -> ${out}`);
    assert.equal(/<\/?(?:details|summary)>/i.test(out), false, `${input} -> ${out}`);
    assert.equal(out.length <= String(input || '').length, true, `${input} -> ${out}`);
    return true;
  }), { numRuns: NUM_RUNS });
});

// FINDING (see report, cosmetic): the stripper is single-pass and does not
// reach a fixpoint — nested quote markers and overlapping emphasis leave
// markup residue in the plain text.
test.todo('#496: plainReleaseNotes is not idempotent — minimal counterexample: ">>" → ">" (expected ""); also "*### **" → "### *" leaves heading residue');

test('releaseNotesTabs returns both translations or nothing', () => {
  fc.assert(fc.property(mdArb, (input) => {
    const tabs = releaseNotesTabs(input);
    assert.equal(Array.isArray(tabs), true);
    if (tabs.length === 0) return true;
    assert.equal(tabs.length, 2, input);
    assert.equal(tabs[0].id, 'zh-CN');
    assert.equal(tabs[1].id, 'en');
    for (const tab of tabs) {
      assert.notEqual(tab.text, '', input);
      assert.equal(/<\/?(?:details|summary)>/i.test(tab.text), false, `${input} -> ${tab.text}`);
    }
    return true;
  }), { numRuns: NUM_RUNS });
});
