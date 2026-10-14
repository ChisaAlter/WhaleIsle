'use strict';

const root = document.getElementById('preview');
let truncationNotice;

function applyTheme(theme) {
  const dark = theme?.scheme === 'dark';
  document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
  document.body.toggleAttribute('data-ds-dark-theme', dark);
}

function textFor(state, key) {
  const en = state?.locale === 'en';
  const labels = {
    loading: en ? 'Loading preview…' : '正在载入预览…',
    failed: en ? 'Could not load this preview.' : '无法载入此预览。',
    truncated: en ? 'File is too large; showing the beginning.' : '文件过长，仅显示开头。',
  };
  return labels[key];
}

function status(message) {
  const node = document.createElement('p');
  node.className = 'status';
  node.textContent = message;
  root.replaceChildren(node);
}

function mediaStage(child) {
  const stage = document.createElement('div');
  stage.className = 'mediaStage';
  stage.append(child);
  root.replaceChildren(stage);
}

function render(state) {
  truncationNotice?.close();
  truncationNotice = undefined;
  if (!state || typeof state !== 'object') {
    status(textFor(state, 'failed'));
    return;
  }
  applyTheme(state);
  document.documentElement.lang = state.locale === 'en' ? 'en' : 'zh-CN';
  document.title = state.name || 'File preview';
  if (state.message) {
    status(state.message);
    return;
  }
  if (state.kind === 'image') {
    const image = document.createElement('img');
    image.className = 'image';
    image.alt = state.name || '';
    image.src = state.url;
    image.addEventListener('error', () => status(textFor(state, 'failed')), { once: true });
    mediaStage(image);
    return;
  }
  if (state.kind === 'video' || state.kind === 'audio') {
    const media = document.createElement(state.kind);
    media.className = state.kind;
    media.controls = true;
    media.preload = 'metadata';
    media.src = state.url;
    media.addEventListener('error', () => status(textFor(state, 'failed')), { once: true });
    mediaStage(media);
    return;
  }
  if (state.kind === 'pdf' || state.kind === 'html') {
    const frame = document.createElement('iframe');
    frame.className = 'document';
    frame.title = state.name || 'File preview';
    frame.referrerPolicy = 'no-referrer';
    if (state.kind === 'html') frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    frame.src = state.url;
    root.replaceChildren(frame);
    return;
  }
  if (state.kind === 'text') {
    const wrap = document.createElement('div');
    wrap.className = 'textWrap';
    if (state.truncated) {
      truncationNotice = window.shellFeedback.notice({ body: textFor(state, 'truncated'), holdMs: null, dismissLabel: state.locale === 'en' ? 'Dismiss notice' : '关闭提示' });
    }
    const code = document.createElement('pre');
    code.className = 'code';
    code.textContent = typeof state.text === 'string' ? state.text : '';
    wrap.append(code);
    root.replaceChildren(wrap);
    return;
  }
  status(textFor(state, 'failed'));
}

function uiLocale() {
  return /^en/i.test(typeof navigator === 'object' ? navigator.language || '' : '') ? 'en' : 'zh';
}

if (!window.filePreview || typeof window.filePreview.getState !== 'function') {
  status(uiLocale() === 'en' ? 'File preview bridge is unavailable.' : '预览桥接不可用。');
} else {
  window.filePreview.onTheme(applyTheme);
  window.filePreview.getState().then(render).catch(() => status(textFor({ locale: uiLocale() }, 'failed')));
}
