// app/log-rows.js — split from app.js (#442).
import { h } from '../ui/dom.js';
import { lineDiff, toolRowModel } from '../conversation/tool-model.js?v=20260902-mobile-ui';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { hostCall } from '../host/backend.js';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { queueUpdate } from '../host/projections.js?v=20261028-mobile';
import { composerOffline, copyText, operationError, setToast } from './chrome.js?v=20261117-app-split';
import { attachmentReads, state, store } from './context.js?v=20261117-app-split';
import { renderDialog, renderLightbox } from './dialogs.js?v=20261117-app-split';
import { currentReadOnlyReason, currentRow } from './header.js?v=20261117-app-split';
import { renderLog } from './log.js?v=20261117-app-split';
import { buildMarkdownNodes, reconcileWithPinnedChildren, renderMarkdownInto } from './markdown.js?v=20261117-app-split';
import { clearExclusiveDialogs } from './new-session.js?v=20261117-app-split';
import { descNode } from './nodes.js?v=20261117-app-split';
import { pullCurrentHistory, refreshProjections } from './session.js?v=20261117-app-split';
import { assistantUiRowCache, whaleUiCardNode } from './whale-ui.js?v=20261117-app-split';

// —— 流程行（对应桌面 ui-tool ToolRow / ui-chat ReasoningRow / TurnProcessNodeView） —— //

const FLOW_ICON_CHILDREN = {
  think: [
    h('path', { d: 'M8 1.75a4.25 4.25 0 0 1 2.4 7.76c-.4.28-.65.7-.65 1.17V11H6.25v-.32c0-.47-.25-.9-.65-1.17A4.25 4.25 0 0 1 8 1.75Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M6.5 13h3M7 14.5h2', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
  ],
  search: [
    h('circle', { cx: '7', cy: '7', r: '4.25', stroke: 'currentColor', 'stroke-width': '1.2' }),
    h('path', { d: 'm10.2 10.2 3.3 3.3', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
  ],
  read: [
    h('path', { d: 'M4 1.75h5.2L13 5.55V13.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M9 1.75V5.5h4M5.5 8.5h5M5.5 11h5', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
  ],
  bash: [
    h('rect', { x: '1.75', y: '2.75', width: '12.5', height: '10.5', rx: '1.5', stroke: 'currentColor', 'stroke-width': '1.2' }),
    h('path', { d: 'm4.5 6 2 2-2 2M8 10h3.5', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ],
  write: [
    h('path', { d: 'M4 1.75h5.2L13 5.55V13.25a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M8 7v5M5.5 9.5h5', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
  ],
  edit: [
    h('path', { d: 'm10.6 2.4 3 3-7.7 7.7-3.6.6.6-3.6 7.7-7.7Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'm9.2 3.8 3 3', stroke: 'currentColor', 'stroke-width': '1.2' }),
  ],
  code: [
    h('path', { d: 'm5 4.5-3.5 3.5L5 11.5M11 4.5l3.5 3.5-3.5 3.5M9.3 2.5 6.7 13.5', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ],
  others: [
    h('path', { d: 'M9.3 2.2a3.4 3.4 0 0 0 4.2 4.3l-6.9 6.9a1.6 1.6 0 1 1-2.3-2.3l6.9-6.9Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
  ],
  subagent: [
    h('circle', { cx: '8', cy: '5', r: '2.5', stroke: 'currentColor', 'stroke-width': '1.2' }),
    h('path', { d: 'M3.5 13.5a4.5 4.5 0 0 1 9 0', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
  ],
  chevron: [
    h('path', { d: 'm4 6 4 4 4-4', stroke: 'currentColor', 'stroke-width': '1.3', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  ],
};

/** Which rows / disclosures the user has opened, keyed by row id. */
const flowOpen = new Set();

function flowIcon(kind) {
  const node = h('svg', { viewBox: '0 0 16 16', fill: 'none' },
    ...(FLOW_ICON_CHILDREN[kind] || FLOW_ICON_CHILDREN.others).map((child) => child.cloneNode(true)));
  node.setAttribute('width', '14');
  node.setAttribute('height', '14');
  node.setAttribute('aria-hidden', 'true');
  node.classList.add('flow-icon');
  return node;
}

function firstLineOf(text) {
  const value = String(text || '');
  const nl = value.indexOf('\n');
  return nl === -1 ? value : value.slice(0, nl);
}

function latestLineOf(text) {
  const value = String(text || '').trimEnd();
  const nl = value.lastIndexOf('\n');
  return nl === -1 ? value : value.slice(nl + 1);
}

/**
 * Shared disclosure chrome: [state dot] [icon] title · summary ▾, expanding
 * to `body`. `state` is running / ok / error / stopped (desktop StateDot).
 */
function flowRowNode({ id, icon, title, summary, state, body, variant = '', extraClass = '', defaultOpen = store.expandTools && extraClass === 'tool-row' }) {
  const node = document.createElement('div');
  node.className = `flow-row ${extraClass}`.trim();
  node.dataset.state = state;
  if (variant) node.dataset.variant = variant;
  const open = flowOpen.has(id) || (defaultOpen && !flowOpen.has(`closed:${id}`));
  node.dataset.open = open ? 'true' : 'false';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'flow-head';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const lead = document.createElement('span');
  lead.className = 'flow-lead';
  const dot = document.createElement('span');
  dot.className = 'state-dot';
  dot.dataset.state = state;
  lead.append(dot, flowIcon(icon));
  const titleNode = document.createElement('span');
  titleNode.className = 'flow-title';
  titleNode.textContent = title;
  head.append(lead, titleNode);
  if (summary) {
    const sep = document.createElement('span');
    sep.className = 'flow-sep';
    const summaryNode = document.createElement('span');
    summaryNode.className = 'flow-summary';
    summaryNode.textContent = summary;
    if (state === 'running' && icon === 'think') summaryNode.dataset.followEnd = 'true';
    head.append(sep, summaryNode);
  }
  if (body) {
    const chevron = flowIcon('chevron');
    chevron.classList.add('flow-chevron');
    head.append(chevron);
    head.addEventListener('click', () => {
      const next = node.dataset.open !== 'true';
      if (next) {
        flowOpen.add(id);
        flowOpen.delete(`closed:${id}`);
      } else {
        flowOpen.delete(id);
        flowOpen.add(`closed:${id}`);
      }
      node.dataset.open = next ? 'true' : 'false';
      head.setAttribute('aria-expanded', next ? 'true' : 'false');
      body.classList.toggle('hidden', !next);
    });
  } else {
    head.classList.add('is-static');
  }
  node.append(head);
  if (body) {
    body.classList.add('flow-body');
    body.classList.toggle('hidden', !open);
    node.append(body);
  }
  // The running summary follows its tail like the desktop Think row.
  if (state === 'running' && icon === 'think') {
    requestAnimationFrame(() => {
      const summaryNode = head.querySelector('.flow-summary');
      if (summaryNode) summaryNode.scrollLeft = summaryNode.scrollWidth;
    });
  }
  return node;
}

function codeBlockNode(text, { className = '', maxLines = 0 } = {}) {
  const pre = document.createElement('pre');
  pre.className = `flow-code ${className}`.trim();
  const lines = String(text ?? '').split('\n');
  if (maxLines > 0 && lines.length > maxLines) {
    pre.textContent = lines.slice(0, maxLines).join('\n');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'flow-more';
    more.textContent = `还有 ${lines.length - maxLines} 行`;
    more.addEventListener('click', () => {
      pre.textContent = lines.join('\n');
      more.remove();
    });
    const wrap = document.createElement('div');
    wrap.className = 'flow-code-wrap';
    wrap.append(pre, more);
    return wrap;
  }
  pre.textContent = lines.join('\n');
  return pre;
}

function labeledBlock(label, child) {
  const wrap = document.createElement('div');
  wrap.className = 'flow-section';
  const head = document.createElement('p');
  head.className = 'flow-section-label';
  head.textContent = label;
  wrap.append(head, child);
  return wrap;
}

/** Terminal card: prompt row + output (desktop TerminalBlock, simplified). */
function terminalCardNode(command, output, state) {
  const card = document.createElement('div');
  card.className = 'term-card';
  const prompt = document.createElement('div');
  prompt.className = 'term-prompt';
  const sign = document.createElement('span');
  sign.className = 'term-sign';
  sign.textContent = '$';
  const cmd = document.createElement('code');
  cmd.textContent = command || '';
  prompt.append(sign, cmd);
  card.append(prompt);
  if (output) {
    card.append(codeBlockNode(output, { className: 'term-output', maxLines: 12 }));
  } else if (state === 'running') {
    const wait = document.createElement('p');
    wait.className = 'term-wait';
    wait.textContent = '正在运行…';
    card.append(wait);
  }
  return card;
}

/** Diff card: removed / added lines from the intended mutation (desktop DiffBlock, simplified). */
function diffCardNode(diff) {
  const card = document.createElement('div');
  card.className = 'diff-card';
  const path = document.createElement('p');
  path.className = 'diff-path';
  path.textContent = diff.path;
  card.append(path);
  const lines = lineDiff(diff.oldText, diff.newText);
  const body = document.createElement('div');
  body.className = 'diff-body';
  const MAX = 24;
  const shown = lines.slice(0, MAX);
  for (const line of shown) {
    const row = document.createElement('div');
    row.className = `diff-line ${line.kind}`;
    const sign = document.createElement('span');
    sign.className = 'diff-sign';
    sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
    const text = document.createElement('span');
    text.className = 'diff-text';
    text.textContent = line.text;
    row.append(sign, text);
    body.append(row);
  }
  card.append(body);
  if (lines.length > MAX) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'flow-more';
    more.textContent = `还有 ${lines.length - MAX} 行`;
    more.addEventListener('click', () => {
      for (const line of lines.slice(MAX)) {
        const row = document.createElement('div');
        row.className = `diff-line ${line.kind}`;
        const sign = document.createElement('span');
        sign.className = 'diff-sign';
        sign.textContent = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
        const text = document.createElement('span');
        text.className = 'diff-text';
        text.textContent = line.text;
        row.append(sign, text);
        body.append(row);
      }
      more.remove();
    });
    card.append(more);
  }
  const adds = lines.filter((l) => l.kind === 'add').length;
  const dels = lines.filter((l) => l.kind === 'del').length;
  const stat = document.createElement('span');
  stat.className = 'diff-stat';
  stat.textContent = `+${adds} −${dels}`;
  path.append(stat);
  return card;
}

function toolRowNode(row) {
  if (row.whaleUi || row.text === 'render_ui' || row.call?.name === 'render_ui') {
    const ui = row.whaleUi || {
      language: 'whale-ui',
      program: '',
      title: '',
      streaming: Boolean(row.running),
    };
    return whaleUiCardNode({
      cardKey: `tool:${row.id}`,
      language: ui.language,
      program: ui.program,
      title: ui.title,
      streaming: ui.streaming,
    });
  }
  // ChisaCode projected items carry a pre-digested `detail`; raw dsh events carry `call`.
  if (!row.call) return legacyToolRowNode(row);
  const model = toolRowModel(row.call, { cwd: state.cwd });
  const body = document.createElement('div');
  if (model.variant === 'bash') {
    body.append(terminalCardNode(model.body || model.summary, model.output, model.state));
  } else if (model.diff && (model.variant === 'edit' || model.variant === 'write')) {
    body.append(diffCardNode(model.diff));
    if (model.state === 'error' && model.output) body.append(labeledBlock('结果', codeBlockNode(model.output, { maxLines: 12 })));
  } else {
    if (model.body) body.append(labeledBlock('输入', codeBlockNode(model.body, { maxLines: 12 })));
    if (model.output) body.append(labeledBlock(model.state === 'error' ? '错误' : '结果', codeBlockNode(model.output, { maxLines: 16 })));
  }
  const hasBody = body.childNodes.length > 0;
  return flowRowNode({
    id: `tool:${row.id}`,
    icon: model.subagent ? 'subagent' : model.variant,
    title: model.subagent ? '子智能体' : model.title,
    summary: model.state === 'error' && model.errorSummary ? model.errorSummary : model.summary,
    state: model.state,
    variant: model.variant,
    extraClass: 'tool-row',
    body: hasBody ? body : null,
  });
}

/** ChisaCode projected `tool_call` items (Android parity path). */
function legacyToolRowNode(row) {
  const state = row.status === 'failed' ? 'error' : row.status === 'running' ? 'running' : row.status === 'canceled' ? 'stopped' : 'ok';
  const detail = row.detail;
  let body = null;
  if (detail?.body) {
    body = document.createElement('div');
    if (detail.bodyKind === 'markdown') renderMarkdownInto(body, detail.body, { rowId: `legacy:${row.id}` });
    else body.append(codeBlockNode(detail.body, { maxLines: 16 }));
  }
  return flowRowNode({
    id: `tool:${row.id}`,
    icon: 'others',
    title: row.text || '工具调用',
    summary: detail?.summary || row.card || '',
    state,
    extraClass: 'tool-row',
    body,
  });
}

function reasoningRowNode(row) {
  const running = row.running === true;
  const body = document.createElement('div');
  const text = document.createElement('div');
  text.className = 'think-body';
  text.textContent = row.text;
  body.append(text);
  return flowRowNode({
    id: `think:${row.id}`,
    icon: 'think',
    title: '思考',
    summary: running ? latestLineOf(row.text) : firstLineOf(row.text),
    state: running ? 'running' : 'ok',
    extraClass: 'think-row',
    body: row.text ? body : null,
  });
}

function turnProcessNode(group) {
  const labels = [];
  if (group.toolCalls > 0) labels.push(`${group.toolCalls} 次工具调用`);
  if (group.messages > 0) labels.push(`${group.messages} 条消息`);
  if (group.subagents > 0) labels.push(`${group.subagents} 个 subagent`);
  const label = labels.length ? labels.join(' · ') : '已思考';
  const node = document.createElement('div');
  node.className = 'turn-process';
  const open = flowOpen.has(group.id);
  node.dataset.open = open ? 'true' : 'false';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'turn-process-head';
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const text = document.createElement('span');
  text.className = 'turn-process-label';
  text.textContent = label;
  const chevron = flowIcon('chevron');
  chevron.classList.add('flow-chevron');
  head.append(text, chevron);
  const body = document.createElement('div');
  body.className = 'turn-process-body';
  body.classList.toggle('hidden', !open);
  for (const row of group.rows) body.append(logRowNode(row, { nested: true }));
  head.addEventListener('click', () => {
    const next = node.dataset.open !== 'true';
    if (next) flowOpen.add(group.id);
    else flowOpen.delete(group.id);
    node.dataset.open = next ? 'true' : 'false';
    head.setAttribute('aria-expanded', next ? 'true' : 'false');
    body.classList.toggle('hidden', !next);
  });
  node.append(head, body);
  return node;
}

/**
 * Message image. History pages may carry only an attachment reference; it is
 * read once per open session through `session.attachment`, and a failure
 * stays a visible placeholder without re-requesting on every live tick.
 */
function messageImageNode(image, className) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '消息图片';
  img.decoding = 'async';
  img.loading = 'lazy';
  const open = (loaded) => {
    img.src = `data:${loaded.mediaType};base64,${loaded.data}`;
    img.addEventListener('click', () => {
      state.lightbox = loaded;
      renderLightbox();
    });
  };
  if (image.data) {
    open(image);
    return img;
  }
  img.classList.add('is-loading');
  const owner = sessionOwner(state);
  let read = attachmentReads.get(image.attachmentId);
  if (!read) {
    read = hostCall(owner.client, 'session.attachment', { sessionId: owner.sessionId, attachmentId: image.attachmentId })
      .then((value) => {
        const attachment = value?.attachment || {};
        if (attachment.attachmentId !== image.attachmentId || typeof value?.data !== 'string' || !value.data) {
          throw new Error('图片附件响应无效');
        }
        return { mediaType: attachment.mediaType || image.mediaType, data: value.data };
      });
    attachmentReads.set(image.attachmentId, read);
  }
  read.then((loaded) => {
    if (!owner.owns()) return;
    img.classList.remove('is-loading');
    open(loaded);
  }).catch((error) => {
    if (!owner.owns()) return;
    const failed = document.createElement('span');
    failed.className = `${className} image-failed`;
    failed.textContent = `图片无法读取：${error?.message || '电脑没有响应'}`;
    img.replaceWith(failed);
  });
  return img;
}

function messageActionsNode(text) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'msg-action';
  copy.setAttribute('aria-label', '复制回复');
  copy.title = '复制回复';
  copy.append(h('svg', { width: '14', height: '14', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('rect', { x: '5.5', y: '5.5', width: '8', height: '8', rx: '1.5', stroke: 'currentColor', 'stroke-width': '1.2' }),
    h('path', { d: 'M10.5 3.5v-.25A1.25 1.25 0 0 0 9.25 2h-5A1.25 1.25 0 0 0 3 3.25v5A1.25 1.25 0 0 0 4.25 9.5h.25', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' })));
  copy.addEventListener('click', () => { void copyText(text, { done: '回复已复制' }); });
  actions.append(copy);
  return actions;
}

export function logRowNode(row, { nested = false } = {}) {
  if (row.role === 'tool') {
    return toolRowNode(row);
  }
  if (row.role === 'turn-process') {
    return turnProcessNode(row);
  }
  if (row.role === 'reasoning') {
    return reasoningRowNode(row);
  }
  const node = document.createElement('div');
  if (row.role === 'user') {
    node.className = 'user';
    if (row.images?.length) {
      const gallery = document.createElement('div');
      gallery.className = 'bubble-images';
      for (const image of row.images) {
        gallery.append(messageImageNode(image, row.images.length === 1 ? 'solo' : 'multi'));
      }
      node.append(gallery);
    }
    if (row.text) {
      const text = document.createElement('span');
      text.textContent = row.text;
      node.append(text);
    }
    return node;
  }
  if (row.role === 'error') {
    node.className = 'turn-error';
    const dot = document.createElement('span');
    dot.className = 'state-dot';
    dot.dataset.state = 'error';
    const main = document.createElement('span');
    main.className = 'turn-error-main';
    if (row.title) {
      const title = document.createElement('b');
      title.textContent = row.title;
      main.append(title, document.createTextNode(' '));
    }
    main.append(document.createTextNode(row.text));
    if (row.code) {
      const code = document.createElement('code');
      code.className = 'turn-error-code';
      code.textContent = row.code;
      main.append(document.createTextNode(' '), code);
    }
    node.append(dot, main);
    return node;
  }
  if (row.role === 'todo') {
    node.className = 'todo-card';
    const heading = document.createElement('p');
    heading.className = 'todo-title';
    heading.textContent = '待办';
    node.append(heading);
    for (const item of row.items || []) {
      const line = document.createElement('p');
      line.className = `todo-item${item.completed ? ' done' : ''}`;
      line.textContent = `${item.completed ? '✓' : '○'} ${item.text}`;
      node.append(line);
    }
    return node;
  }
  if (row.role === 'changes') {
    node.className = 'changes-card';
    const heading = document.createElement('p');
    heading.className = 'todo-title';
    heading.textContent = row.text || '本轮改动';
    node.append(heading);
    for (const file of row.files || []) {
      const line = document.createElement('p');
      line.className = 'changes-file';
      const counts = [
        Number.isInteger(file.additions) ? `+${file.additions}` : '',
        Number.isInteger(file.deletions) ? `-${file.deletions}` : '',
      ].filter(Boolean).join(' ');
      line.textContent = counts ? `${file.path} · ${counts}` : file.path;
      node.append(line);
    }
    return node;
  }
  if (row.role === 'meta') {
    node.className = 'meta-row';
    node.textContent = row.text;
    return node;
  }
  const children = buildMarkdownNodes(row.text || '', { rowId: row.id, streaming: row.running === true });
  if (!nested && !row.running && row.text) children.push(messageActionsNode(row.text));
  const hasWhaleCard = children.some((child) => child.classList?.contains('whale-ui-card'));
  const cacheKey = `${state.sessionId || 'local'}:assistant:${nested ? 'nested' : 'top'}:${row.id}`;
  const target = hasWhaleCard && assistantUiRowCache.get(cacheKey) ? assistantUiRowCache.get(cacheKey) : node;
  target.className = 'assistant';
  if (row.running) target.dataset.streaming = 'true';
  else delete target.dataset.streaming;
  if (hasWhaleCard) {
    assistantUiRowCache.set(cacheKey, target);
    reconcileWithPinnedChildren(target, children);
  } else {
    target.append(...children);
  }
  return target;
}

/** A sent message the host has not echoed yet: visible at once, never a duplicate. */
export function outboxNode(entry) {
  const node = document.createElement('div');
  node.className = 'user is-pending';
  node.dataset.status = entry.status;
  if (entry.images.length) {
    const gallery = document.createElement('div');
    gallery.className = 'bubble-images';
    for (const image of entry.images) gallery.append(messageImageNode(image, entry.images.length === 1 ? 'solo' : 'multi'));
    node.append(gallery);
  }
  if (entry.text) {
    const text = document.createElement('span');
    text.textContent = entry.text;
    node.append(text);
  }
  const status = document.createElement('span');
  status.className = 'user-status';
  status.textContent = entry.status === 'sending' ? '发送中…' : entry.mode === 'steer' ? '已转入当前回复' : entry.queued ? '已加入队列' : '已发送';
  node.append(status);
  return node;
}

/** Queued input from the host inbox (Android NativeQueuePanel parity). */
export function queuePanelNode(queue) {
  const panel = document.createElement('section');
  panel.className = 'queue-panel';
  panel.setAttribute('aria-label', `待发送消息 ${queue.length} 条`);
  const head = document.createElement('p');
  head.className = 'queue-head';
  head.textContent = `待发送 · ${queue.length}`;
  panel.append(head);
  const available = !state.queueBusy && !composerOffline() && !currentReadOnlyReason();
  const running = currentRow()?.running === true;
  for (const item of queue) {
    const card = document.createElement('div');
    card.className = 'queue-item';
    const target = document.createElement('span');
    target.className = 'queue-target';
    target.textContent = item.target === 'next-step' ? '当前回复中的下一步' : '下一轮回复';
    const body = document.createElement('p');
    body.className = 'queue-text';
    body.textContent = item.text || (item.hasAttachments ? '附件消息' : '空消息');
    card.append(target, body);
    if (item.hasAttachments) card.append(descNode('含附件，无法只编辑文字。', 'row-desc queue-note'));
    const actions = document.createElement('div');
    actions.className = 'queue-actions';
    const action = (label, kind, enabled, className = 'queue-action') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.disabled = !available || !enabled;
      buttonBusy(button, state.queueBusy === `${kind}:${item.id}`, { label: `${label}中…` });
      button.addEventListener('click', () => {
        if (kind === 'edit') {
          clearExclusiveDialogs();
          state.queueEdit = { id: item.id, value: item.text, busy: false };
          renderDialog();
        } else {
          void updateQueueItem(item, kind);
        }
      });
      return button;
    };
    actions.append(action('编辑', 'edit', item.editable && !item.hasAttachments));
    if (item.target === 'next-turn' && running) actions.append(action('发送到当前回复', 'steer', true));
    actions.append(action('删除', 'remove', true, 'queue-action danger'));
    card.append(actions);
    panel.append(card);
  }
  return panel;
}

export async function updateQueueItem(item, kind, text = '') {
  const owner = sessionOwner(state);
  if (state.queueBusy || !owner.client || !owner.sessionId) return false;
  let request;
  try {
    request = queueUpdate(owner.sessionId, item, kind, { text, running: currentRow()?.running === true });
  } catch (error) {
    operationError(error.message);
    return false;
  }
  state.queueBusy = `${kind}:${item.id}`;
  renderLog({ anchor: 'hold' });
  try {
    const result = await hostCall(owner.client, 'session.updateQueue', request);
    if (result && result.accepted === false) throw new Error('未能确认队列操作，请同步后查看');
    if (!owner.owns()) return false;
    setToast(kind === 'remove' ? '已从队列删除' : kind === 'steer' ? '已转入当前回复' : '已保存修改', { tone: 'success', holdMs: 1600 });
    return true;
  } catch (error) {
    if (owner.owns()) operationError(`队列操作失败：${error?.message || '电脑没有响应'}`, () => updateQueueItem(item, kind, text));
    return false;
  } finally {
    if (owner.owns()) {
      state.queueBusy = '';
      await refreshProjections();
      void pullCurrentHistory();
      renderLog({ anchor: 'hold' });
    }
  }
}
