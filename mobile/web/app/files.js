// app/files.js — split from app.js (#442).
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { hostCall } from '../host/backend.js';
import { fileArgs, fileEntries, isImagePath, fileReadArgs, imagePreview, filePage, fileSize, FILE_PAGE_LINES, pathSegments, parentPath } from '../host/desktop.js?v=20261028-mobile';
import { h } from '../ui/dom.js';
import { copyText, surfaceBusy } from './chrome.js?v=20261117-app-split';
import { insertMention } from './composer.js?v=20261117-app-split';
import { options, state } from './context.js?v=20261117-app-split';
import { renderLightbox } from './dialogs.js?v=20261117-app-split';
import { folderIcon } from './drawer.js?v=20261117-app-split';
import { descNode, fieldInput, ghostButton, noticeNode, primaryButton } from './nodes.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';

// —— 电脑功能：文件 / 更改 / MCP / 技能 / 插件（已配对 Host 正式服务）—— //

/** Drop session/cwd-bound work-loop state (session switch, logout). */
export function resetWorkPanes() {
  state.filesPane = null;
  state.diffPane = null;
}

function ensureFilesPane() {
  if (!state.filesPane) {
    state.filesPane = {
      path: '', entries: [], truncated: false, loading: false, loaded: false, error: '',
      seq: 0, preview: null, filter: '', scrollTops: {}, pendingScroll: null,
    };
  }
  return state.filesPane;
}

function filesPaneVisible() {
  return state.settingsOpen && (state.settingsPane === '文件' || (state.settingsPane === '工作区' && state.wsTab === 'files'));
}

function refreshFilesBody() {
  if (filesPaneVisible()) renderSettings();
}

function closeFilePreview() {
  const pane = state.filesPane;
  if (!pane?.preview) return;
  pane.preview = null;
  pane.pendingScroll = pane.scrollTops[pane.path] ?? 0;
}

/** List one workspace directory of the open session (`workspaceFiles.list`). */
async function loadFilesPath(path = ensureFilesPane().path) {
  const pane = ensureFilesPane();
  const owner = sessionOwner(state);
  if (!owner.client || !owner.sessionId) {
    refreshFilesBody();
    return;
  }
  if (!pane.preview && filesPaneVisible()) pane.scrollTops[pane.path] = options.scrollTop;
  pane.preview = null;
  const seq = ++pane.seq;
  pane.loading = true;
  pane.error = '';
  refreshFilesBody();
  try {
    const listing = await hostCall(owner.client, 'workspaceFiles.list', fileArgs(owner.sessionId, path));
    if (!owner.owns() || state.filesPane !== pane || pane.seq !== seq) return;
    if (pane.path !== path) pane.filter = '';
    pane.path = path;
    pane.entries = fileEntries(listing, path);
    pane.truncated = listing?.truncated === true;
    pane.loaded = true;
    pane.pendingScroll = pane.scrollTops[path] ?? 0;
  } catch (error) {
    if (!owner.owns() || state.filesPane !== pane || pane.seq !== seq) return;
    pane.error = error?.message || '无法读取目录';
  }
  pane.loading = false;
  refreshFilesBody();
}

/** Preview one file: a 200-line text page or a size-capped image. */
async function openFilePreview(entry, offset = 1) {
  const pane = ensureFilesPane();
  const owner = sessionOwner(state);
  if (!owner.client || !owner.sessionId) return;
  if (!pane.preview && filesPaneVisible()) pane.scrollTops[pane.path] = options.scrollTop;
  const image = isImagePath(entry.path);
  const preview = {
    path: entry.path, name: entry.name || entry.path.split('/').pop() || entry.path,
    size: Number.isFinite(entry.size) ? entry.size : null, image, offset,
    loading: true, error: '', data: null,
  };
  pane.preview = preview;
  pane.pendingScroll = 0;
  refreshFilesBody();
  try {
    const result = image
      ? await hostCall(owner.client, 'workspaceFiles.readImage', fileArgs(owner.sessionId, entry.path))
      : await hostCall(owner.client, 'workspaceFiles.read', fileReadArgs(owner.sessionId, entry.path, offset));
    if (!owner.owns() || state.filesPane !== pane || pane.preview !== preview) return;
    preview.data = image ? imagePreview(result, entry.path) : filePage(result, entry.path);
    if (Number.isFinite(preview.data.bytes)) preview.size = preview.data.bytes;
  } catch (error) {
    if (!owner.owns() || state.filesPane !== pane || pane.preview !== preview) return;
    preview.error = error?.message || '无法读取文件';
  }
  preview.loading = false;
  pane.pendingScroll = 0;
  refreshFilesBody();
}

export function openFilesPane() {
  const pane = ensureFilesPane();
  if (!pane.loaded && !pane.loading) void loadFilesPath(pane.path);
}

function fileIcon() {
  return h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M4 1.75h5.2L13 5.55v7.7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }),
    h('path', { d: 'M9 1.75V5.5h4', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linejoin': 'round' }));
}

export function mentionButton(path) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-insert';
  button.textContent = '@';
  button.setAttribute('aria-label', `把 ${path} 插入输入框`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    insertMention(path);
  });
  return button;
}

function fileEntryRow(entry, { onOpen }) {
  const row = document.createElement('div');
  row.className = 'file-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-open';
  button.disabled = entry.kind === 'other';
  const icon = entry.kind === 'directory' ? folderIcon() : fileIcon();
  icon.classList.add('file-icon');
  const main = document.createElement('span');
  main.className = 'file-main';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = entry.name;
  const meta = document.createElement('span');
  meta.className = 'file-path';
  meta.textContent = entry.kind === 'directory' ? '文件夹' : entry.kind === 'other' ? '不是普通文件，无法打开' : fileSize(entry.size);
  main.append(name, meta);
  button.append(icon, main);
  button.addEventListener('click', () => onOpen(entry));
  row.append(button);
  if (entry.kind !== 'other') row.append(mentionButton(entry.path));
  return row;
}

function filePreviewNodes(pane) {
  const preview = pane.preview;
  const nodes = [];
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'preview-back';
  back.textContent = '‹ 目录';
  back.addEventListener('click', () => {
    closeFilePreview();
    refreshFilesBody();
  });
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = preview.path;
  title.title = preview.path;
  bar.append(back, title);
  nodes.push(bar);
  const data = preview.data;
  const meta = [];
  if (Number.isFinite(preview.size)) meta.push(fileSize(preview.size));
  if (data?.kind === 'text' && data.lines > 0) meta.push(`第 ${data.offset}–${data.offset + data.lines - 1} 行`);
  if (data?.kind === 'image') meta.push('图片预览上限 2 MB');
  meta.push('只读');
  nodes.push(descNode(meta.join(' · ')));
  const actions = document.createElement('div');
  actions.className = 'preview-actions';
  actions.append(primaryButton('插入 @路径', () => insertMention(preview.path)));
  if (data?.kind === 'text' && data.text) actions.append(ghostButton('复制本页', () => { void copyText(data.text); }));
  nodes.push(actions);
  if (preview.loading && !data) {
    nodes.push(descNode('正在读取文件…'));
    return nodes;
  }
  if (preview.error) {
    nodes.push(descNode(`读取失败：${preview.error}`, 'row-desc ext-error'));
    nodes.push(ghostButton('重试', () => { void openFilePreview(preview, preview.offset); }));
    return nodes;
  }
  if (!data) return nodes;
  if (data.kind === 'image') {
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.alt = preview.path;
    img.src = `data:${data.mediaType};base64,${data.data}`;
    img.addEventListener('click', () => {
      state.lightbox = { mediaType: data.mediaType, data: data.data };
      renderLightbox();
    });
    nodes.push(img);
    return nodes;
  }
  if (!data.lines) {
    nodes.push(descNode(data.offset > 1 ? '已到文件末尾' : '空文件'));
  } else {
    const pre = document.createElement('pre');
    pre.className = 'preview-text';
    pre.textContent = data.text;
    nodes.push(pre);
  }
  if (data.offset > 1 || (!data.eof && data.lines > 0)) {
    const pager = document.createElement('div');
    pager.className = 'preview-pager';
    const previous = ghostButton('上一页', () => { void openFilePreview(preview, Math.max(1, data.offset - FILE_PAGE_LINES)); });
    previous.disabled = data.offset <= 1 || preview.loading;
    const next = ghostButton('下一页', () => { void openFilePreview(preview, data.offset + data.lines); });
    next.disabled = data.eof || !data.lines || preview.loading;
    pager.append(previous, next);
    nodes.push(pager);
  }
  return nodes;
}

function fileBrowserNodes(pane) {
  const nodes = [];
  const crumbs = document.createElement('nav');
  crumbs.className = 'crumbs';
  crumbs.setAttribute('aria-label', '当前目录');
  const segments = pathSegments(pane.path);
  segments.forEach((segment, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '/';
      crumbs.append(sep);
    }
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'crumb';
    crumb.textContent = segment.label;
    crumb.disabled = index === segments.length - 1;
    crumb.addEventListener('click', () => { void loadFilesPath(segment.path); });
    crumbs.append(crumb);
  });
  nodes.push(crumbs);
  if (pane.error) {
    nodes.push(descNode(`读取目录失败：${pane.error}`, 'row-desc ext-error'));
    nodes.push(ghostButton('重试', () => { void loadFilesPath(pane.path); }));
    return nodes;
  }
  if (!pane.loaded) {
    nodes.push(descNode('正在读取目录…'));
    return nodes;
  }
  const open = (hit) => {
    if (hit.kind === 'directory') void loadFilesPath(hit.path);
    else if (hit.kind === 'file') void openFilePreview(hit);
  };
  const list = document.createElement('div');
  list.className = 'file-list';
  const paint = () => {
    const query = pane.filter.trim().toLowerCase();
    const rows = query ? pane.entries.filter((entry) => entry.name.toLowerCase().includes(query)) : pane.entries;
    const children = [];
    if (pane.path && !query) {
      children.push(fileEntryRow({ name: '..', path: parentPath(pane.path), kind: 'directory', size: null }, {
        onOpen: () => { void loadFilesPath(parentPath(pane.path)); },
      }));
      children.at(-1).querySelector('.file-insert')?.remove();
      children.at(-1).querySelector('.file-path').textContent = '上一级';
    }
    children.push(...rows.map((entry) => fileEntryRow(entry, { onOpen: open })));
    if (!rows.length) children.push(descNode(query ? '没有匹配的文件' : '此目录为空', 'row-desc ext-empty'));
    list.replaceChildren(...children);
  };
  if (pane.entries.length > 12) {
    const filter = fieldInput(pane.filter, '筛选当前目录', (value) => {
      pane.filter = value;
      paint();
    });
    filter.type = 'search';
    filter.classList.add('ext-filter');
    filter.setAttribute('aria-label', '筛选当前目录');
    nodes.push(filter);
  }
  if (pane.truncated) nodes.push(descNode('目录项达到电脑端上限，此处仅显示返回的条目。'));
  paint();
  nodes.push(list);
  return nodes;
}

/** Workspace files of the open session (`workspaceFiles.*`), read-only. */
export function renderFilesInto(target) {
  if (!state.sessionId) {
    target.append(noticeNode('先打开一个有工作目录的会话，再浏览它的文件。'));
    return;
  }
  const pane = ensureFilesPane();
  if (!pane.loaded && !pane.loading && !pane.error) void loadFilesPath(pane.path);
  const body = document.createElement('div');
  body.className = 'files-body';
  body.append(...(pane.preview ? filePreviewNodes(pane) : fileBrowserNodes(pane)));
  target.append(body);
  surfaceBusy(target, pane.loading || Boolean(pane.preview?.loading));
  if (pane.pendingScroll !== null) {
    const top = pane.pendingScroll;
    pane.pendingScroll = null;
    queueMicrotask(() => { options.scrollTop = top; });
  }
}
