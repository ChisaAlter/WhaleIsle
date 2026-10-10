'use strict';

// Composer family width linkage. The composer seat publishes
// --dsh-composer-resized-width while the Interface Settings composerResize
// drag is live; the rows that share the input card's width axis — the session
// stats line, the queue/todo/goal dock cards, and the blank-session Hero's
// workspace/preset row — must read that variable so they follow the drag
// instead of keeping the resting card cap. (The dsh-usage-panel cost strip
// that used to sit under the card was
// retired in favour of ui-conversation's PeakValleyRow, which lives inside the
// dock and needs no cap of its own.) The follow is a CSS variable
// reference with the resting cap as fallback (rest state never changes), so
// the contract is pinned as source markers: a sync:harness merge or a manual
// "restore to upstream" must not silently drop the references (the fork
// markers in harness-desktop-forks.js catch the same regression on the
// manifest level; this test pins the CSS text itself).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VENDOR = path.join(__dirname, '..', '..', 'vendor');

function readRel(base, rel) {
  return fs.readFileSync(path.join(base, ...rel.split('/')), 'utf8');
}

/** Whitespace-normalized CSS rule body so multi-line calc() compares as one string. */
function normalize(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resized-width follow marker: the max-width cap reads the seat variable
 *  with the resting card cap as its fallback. */
const FOLLOW = /max-width:\s*calc\(\s*var\(--dsh-composer-resized-width,\s*var\(--dsh-composer-card-max-width\)\)/;
const EXACT_FOLLOW = /max-width:\s*var\(--dsh-composer-resized-width,\s*var\(--dsh-composer-card-max-width\)\)/;

const UI_CHAT = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-chat', 'src', 'client');
const UI_CONVERSATION = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-conversation', 'src', 'client');
const UI_GOAL = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-goal', 'src', 'client');

function ruleOf(css, selector) {
  const rule = css.match(new RegExp(`${selector} \\{[^}]*\\}`))?.[0];
  assert.ok(rule, `${selector} rule present`);
  return rule;
}

test('stats row follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'skeleton/InputBar.module.css'));
  const rule = ruleOf(css, '\\.dock');
  assert.match(rule, FOLLOW);
  assert.match(rule, /var\(--dsh-composer-side-clearance\)/);
});

test('queue dock follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'queue/QueueDock.module.css'));
  assert.match(ruleOf(css, '\\.dock'), FOLLOW);
});

test('chat flow column follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_CHAT, 'chat/ChatView.module.css'));
  const rule = ruleOf(css, '\\.column');
  assert.match(rule, FOLLOW);
  assert.match(rule, /var\(--dsh-composer-side-clearance\)/);
});

test('width is published on the conversation scroll host so the transcript sees it', () => {
  const source = readRel(UI_CONVERSATION, 'skeleton/ComposerResizeHandles.tsx');
  assert.match(source, /const SCROLL_SELECTOR = '\[data-conversation-scroll\]'/);
  assert.match(source, /scrollOf\(seat\)\?\.style\.setProperty\(WIDTH_VAR, value\)/);
  assert.match(source, /host\?\.style\.removeProperty\(WIDTH_VAR\)/);
});

test('blank-session Hero controls follow and center on the resized composer card', () => {
  const css = normalize(readRel(UI_CONVERSATION, 'skeleton/ConversationRoot.module.css'));
  const rule = ruleOf(css, '\\.heroWorkspaceRow');
  assert.match(rule, EXACT_FOLLOW);
  assert.match(rule, /width:\s*100%/);
  assert.match(rule, /align-self:\s*center/);
  assert.match(rule, /box-sizing:\s*border-box/);
});

test('todo panel follows the drag-resized composer card', () => {
  const todo = readRel(UI_CONVERSATION, 'skeleton/TodoPanel.tsx');
  assert.match(todo, /import\s*\{[^}]*\bTaskDock\b[^}]*\}\s*from\s*'@deepseek-ai\/dsh-client-ui-primitives'/);
  assert.match(todo, /<TaskDock\b/);
  const primitives = path.join(VENDOR, 'deepseek-harness', 'packages', 'client', 'ui-primitives', 'src');
  const task = readRel(primitives, 'TaskDock.tsx');
  assert.match(task, /import css from '\.\/TaskDock\.module\.css'/);
  assert.match(task, /<section className=\{css\.root\}/);
  const css = normalize(readRel(primitives, 'TaskDock.module.css'));
  const rule = ruleOf(css, '\\.root');
  assert.match(rule, FOLLOW);
  const cap = rule.match(/max-width:[^;]+;/)?.[0];
  assert.equal(cap.match(/var\(--dsh-composer-dock-inset\)/g).length, 4);
});

test('goal bar follows the drag-resized composer card', () => {
  const css = normalize(readRel(UI_GOAL, 'GoalBar.module.css'));
  assert.match(ruleOf(css, '\\.bar'), FOLLOW);
});

test('usage-panel registers no composer.dock entry (PeakValleyRow owns the cost row)', () => {
  const client = readRel(path.join(VENDOR, 'dsh-usage-panel', 'src', 'client'), 'index.tsx');
  assert.doesNotMatch(client, /slots\.inject\(\s*'conversation\.composer\.dock'/);
  assert.doesNotMatch(client, /CostStrip/);
});
