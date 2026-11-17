// app/markdown.js — split from app.js (#442).
import { parseMarkdown, isUiFenceLang } from '../conversation/markdown.js?v=20261028-mobile';
import { copyText } from './chrome.js?v=20261117-app-split';
import { markdownUiCardNode } from './whale-ui.js?v=20261117-app-split';

// —— 安全 Markdown 渲染：结构化 block/span → createElement/textContent —— //

function markdownSpanNodes(spans) {
  return (spans || []).map((span) => {
    if (span.kind === 'code') {
      const code = document.createElement('code');
      code.textContent = span.text;
      return code;
    }
    if (span.kind === 'strong') {
      const strong = document.createElement('strong');
      strong.textContent = span.text;
      return strong;
    }
    if (span.kind === 'em') {
      const em = document.createElement('em');
      em.textContent = span.text;
      return em;
    }
    if (span.kind === 'strike') {
      const del = document.createElement('del');
      del.textContent = span.text;
      return del;
    }
    if (span.kind === 'link') {
      const link = document.createElement('a');
      link.textContent = span.text;
      link.href = span.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      return link;
    }
    return document.createTextNode(span.text);
  });
}

/** Fenced code: language caption + copy, horizontally scrolling body. */
function markdownCodeNode(block) {
  const wrap = document.createElement('div');
  wrap.className = 'md-code-block';
  const head = document.createElement('div');
  head.className = 'md-code-head';
  const lang = document.createElement('span');
  lang.textContent = block.lang || '代码';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'md-code-copy';
  copy.textContent = '复制';
  copy.setAttribute('aria-label', `复制${block.lang ? ` ${block.lang} ` : ''}代码`);
  copy.addEventListener('click', () => { void copyText(block.text, { done: '代码已复制' }); });
  head.append(lang, copy);
  const pre = document.createElement('pre');
  pre.className = 'md-code';
  const code = document.createElement('code');
  code.textContent = block.text;
  pre.append(code);
  wrap.append(head, pre);
  return wrap;
}

/** Flat list items with depth metadata become real nested lists. */
function markdownListNode(block) {
  const root = document.createElement(block.ordered ? 'ol' : 'ul');
  root.className = 'md-list';
  if (block.ordered && block.start > 1) root.start = block.start;
  const stack = [{ list: root, depth: 0, last: null }];
  block.items.forEach((spans, index) => {
    const meta = block.meta?.[index] || { depth: 0, ordered: block.ordered, checked: null };
    while (stack.length > 1 && meta.depth < stack[stack.length - 1].depth) stack.pop();
    let top = stack[stack.length - 1];
    if (meta.depth > top.depth && top.last) {
      const child = document.createElement(meta.ordered ? 'ol' : 'ul');
      child.className = 'md-list md-sublist';
      top.last.append(child);
      top = { list: child, depth: meta.depth, last: null };
      stack.push(top);
    }
    const li = document.createElement('li');
    if (meta.checked === true || meta.checked === false) {
      li.className = 'md-task';
      const box = document.createElement('span');
      box.className = 'md-check';
      box.dataset.checked = String(meta.checked);
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', meta.checked ? '已完成' : '未完成');
      li.append(box);
    }
    li.append(...markdownSpanNodes(spans));
    top.list.append(li);
    top.last = li;
  });
  return root;
}

function markdownTableNode(block) {
  const wrap = document.createElement('div');
  wrap.className = 'md-table-wrap';
  const table = document.createElement('table');
  table.className = 'md-table';
  const width = block.header.length;
  const cell = (tag, spans, index) => {
    const node = document.createElement(tag);
    if (block.align[index]) node.style.textAlign = block.align[index];
    node.append(...markdownSpanNodes(spans || []));
    return node;
  };
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  block.header.forEach((spans, index) => headRow.append(cell('th', spans, index)));
  head.append(headRow);
  const body = document.createElement('tbody');
  for (const row of block.rows) {
    const tr = document.createElement('tr');
    for (let index = 0; index < width; index += 1) tr.append(cell('td', row[index], index));
    body.append(tr);
  }
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

export function reconcileWithPinnedChildren(parent, nextNodes) {
  const nextSet = new Set(nextNodes);
  for (const child of Array.from(parent.childNodes)) {
    if (!nextSet.has(child)) parent.removeChild(child);
  }
  let cursor = parent.firstChild;
  for (const node of nextNodes) {
    if (node === cursor) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(node, cursor);
    }
  }
}

export function buildMarkdownNodes(text, { rowId = '', streaming = false } = {}) {
  const out = [];
  let fenceIndex = 0;
  for (const block of parseMarkdown(text)) {
    if (block.kind === 'code') {
      if (block.uiFence || isUiFenceLang(block.lang)) {
        const key = `${rowId || 'md'}:fence:${fenceIndex++}`;
        out.push(markdownUiCardNode(block, { cardKey: key, streaming: Boolean(block.streaming || streaming) }));
      } else {
        out.push(markdownCodeNode(block));
      }
      continue;
    }
    if (block.kind === 'table') {
      out.push(markdownTableNode(block));
      continue;
    }
    if (block.kind === 'rule') {
      const rule = document.createElement('hr');
      rule.className = 'md-rule';
      out.push(rule);
      continue;
    }
    if (block.kind === 'heading') {
      const heading = document.createElement(`h${Math.min(block.level + 3, 6)}`);
      heading.className = 'md-heading';
      heading.append(...markdownSpanNodes(block.spans));
      out.push(heading);
      continue;
    }
    if (block.kind === 'list') {
      out.push(markdownListNode(block));
      continue;
    }
    if (block.kind === 'quote') {
      const quote = document.createElement('blockquote');
      quote.className = 'md-quote';
      quote.append(...markdownSpanNodes(block.spans));
      out.push(quote);
      continue;
    }
    const paragraph = document.createElement('p');
    paragraph.append(...markdownSpanNodes(block.spans));
    out.push(paragraph);
  }
  return out;
}

export function renderMarkdownInto(node, text, options = {}) {
  node.append(...buildMarkdownNodes(text, options));
}
