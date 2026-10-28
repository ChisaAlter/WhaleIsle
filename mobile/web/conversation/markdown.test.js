import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from './markdown.js';

test('parseInline splits code, bold, italic, and safe links', () => {
  assert.deepEqual(parseInline('run `ls` and **read** *this* [doc](https://a.example/x)'), [
    { kind: 'text', text: 'run ' },
    { kind: 'code', text: 'ls' },
    { kind: 'text', text: ' and ' },
    { kind: 'strong', text: 'read' },
    { kind: 'text', text: ' ' },
    { kind: 'em', text: 'this' },
    { kind: 'text', text: ' ' },
    { kind: 'link', text: 'doc', href: 'https://a.example/x' },
  ]);
});

test('parseInline keeps unsafe link schemes as literal text (never a link span)', () => {
  for (const input of ['[x](javascript:alert(1))', '[x](data:text/html,hi)']) {
    const spans = parseInline(input);
    assert.ok(spans.every((span) => span.kind === 'text'), input);
    assert.equal(spans.map((span) => span.text).join(''), input);
  }
});

test('parseMarkdown keeps raw HTML as plain text (injection-safe by structure)', () => {
  const blocks = parseMarkdown('<img src=x onerror=alert(1)>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'paragraph');
  assert.deepEqual(blocks[0].spans, [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }]);
});

test('parseMarkdown handles fences, headings, lists, and quotes', () => {
  const blocks = parseMarkdown([
    '# 标题',
    '',
    '第一段',
    '',
    '- 甲',
    '- 乙',
    '',
    '1. 一',
    '',
    '> 引用一',
    '> 引用二',
    '',
    '```js',
    'const x = 1;',
    '```',
  ].join('\n'));
  assert.deepEqual(blocks.map((block) => block.kind), [
    'heading', 'paragraph', 'list', 'list', 'quote', 'code',
  ]);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[5].lang, 'js');
  assert.equal(blocks[5].text, 'const x = 1;');
});

test('parseMarkdown does not close a fence on ```lang and keeps unterminated fences', () => {
  const blocks = parseMarkdown('```sh\necho hi\n```js\nstill code');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'code');
  assert.equal(blocks[0].text, 'echo hi\n```js\nstill code');
});

test('parseInline links bare URLs without swallowing sentence punctuation', () => {
  assert.deepEqual(parseInline('见 https://a.example/x?y=1。然后 ~~旧~~'), [
    { kind: 'text', text: '见 ' },
    { kind: 'link', text: 'https://a.example/x?y=1', href: 'https://a.example/x?y=1' },
    { kind: 'text', text: '。然后 ' },
    { kind: 'strike', text: '旧' },
  ]);
  assert.equal(parseInline('(see https://a.example/p_(1))').find((span) => span.kind === 'link').text, 'https://a.example/p_(1)');
});

test('parseMarkdown reads pipe tables with alignment and escaped pipes', () => {
  const [table] = parseMarkdown('| 名称 | 数量 |\n|:--|--:|\n| a\\|b | 2 |\n| c | 3 |');
  assert.equal(table.kind, 'table');
  assert.deepEqual(table.align, ['left', 'right']);
  assert.equal(table.header.length, 2);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0][0].text, 'a|b');
});

test('a pipe in prose above a rule is not a table', () => {
  assert.deepEqual(parseMarkdown('a | b\n---').map((block) => block.kind), ['paragraph', 'rule']);
});

test('parseMarkdown keeps nested, task and continued list items in one list', () => {
  const [list, paragraph] = parseMarkdown('1. **一**\n   说明\n   - [x] 子项\n2. 二\n\n结尾');
  assert.equal(list.kind, 'list');
  assert.equal(list.items.length, 3);
  assert.deepEqual(list.meta.map((item) => item.depth), [0, 1, 0]);
  assert.equal(list.meta[1].checked, true);
  assert.equal(list.meta[1].ordered, false);
  assert.equal(list.items[0].map((span) => span.text).join(''), '一\n说明');
  assert.equal(paragraph.kind, 'paragraph');
});

test('ordered lists split by prose keep their numbering', () => {
  const blocks = parseMarkdown('1. a\n\n中间\n\n2. b');
  assert.equal(blocks[2].start, 2);
});

test('fences nested under list items drop the item indentation', () => {
  const blocks = parseMarkdown('- 运行：\n   ```sh\n   npm test\n   ```');
  assert.equal(blocks[1].kind, 'code');
  assert.equal(blocks[1].text, 'npm test');
});

test('parseMarkdown treats empty input as no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown(undefined), []);
});
