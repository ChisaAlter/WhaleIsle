// app/whale-ui.js — split from app.js (#442).
import { schemeIsDark } from '../ui/settings-hub.js?v=20261028-mobile';
import { normalizeUiLanguage } from '../conversation/markdown.js?v=20261028-mobile';
import { composerOffline, copyText, setToast } from './chrome.js?v=20261117-app-split';
import { renderComposer } from './composer.js?v=20261117-app-split';
import { darkQuery, draft, state, store } from './context.js?v=20261117-app-split';
import { currentReadOnlyReason } from './header.js?v=20261117-app-split';
import { sendPrompt } from './session-actions.js?v=20261117-app-split';

const UI_FENCE_TITLE = /Title\(\s*"([^"]+)"/;

const WHALE_CHANNEL = 'whale-ui';

const WHALE_VERSION = 2;

const WHALE_FRAME_PREFIX = 'whale-ui:';

const SAFE_WHALE_BUNDLE = /^[a-z0-9._-]+\.js$/i;

const WHALE_THEME_TOKEN_KEYS = [
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-brand-primary',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-static-green-500',
  '--dsw-static-amber-500',
  '--dsw-static-red-500',
  '--dsw-font-family-base',
  '--dsw-font-family',
  '--ds-font-family-code',
  '--dsw-font-family-code',
  '--dsw-font-family-mono',
  '--dsw-radius-sm',
  '--dsw-radius-md',
];

const whaleUiInstances = new Map();

const whaleUiStateStore = new Map();

const whaleUiBundleCache = new Map();

const whaleUiResourceCache = new Map();

export const assistantUiRowCache = new Map();

export function resetWhaleUiCards() {
  whaleUiInstances.clear();
  assistantUiRowCache.clear();
}

function whaleUiLocale() {
  return /^en\b/i.test(navigator.language || '') ? 'en' : 'zh';
}

function buildWhaleUiTheme() {
  const dark = schemeIsDark(store.scheme, darkQuery.matches);
  const appearance = dark ? 'dark' : 'light';
  const variables = dark
    ? {
      '--whale-fg': '#f5f5f7',
      '--whale-fg-muted': '#a1a1aa',
      '--whale-fg-faint': '#71717a',
      '--whale-bg': '#141416',
      '--whale-surface': '#1e1e22',
      '--whale-panel': '#18181b',
      '--whale-hover': 'rgba(255, 255, 255, 0.06)',
      '--whale-active': 'rgba(255, 255, 255, 0.1)',
      '--whale-border': 'rgba(255, 255, 255, 0.12)',
      '--whale-accent': '#4d6bfe',
      '--whale-on-accent': '#ffffff',
      '--whale-button': '#4d6bfe',
      '--whale-button-hover': '#3b5bdb',
      '--whale-on-button': '#ffffff',
      '--whale-ok': '#22c55e',
      '--whale-warn': '#f59e0b',
      '--whale-danger': '#ef4444',
    }
    : {
      '--whale-fg': '#18181b',
      '--whale-fg-muted': '#52525b',
      '--whale-fg-faint': '#a1a1aa',
      '--whale-bg': '#ffffff',
      '--whale-surface': '#f4f4f5',
      '--whale-panel': '#fafafa',
      '--whale-hover': 'rgba(0, 0, 0, 0.04)',
      '--whale-active': 'rgba(0, 0, 0, 0.08)',
      '--whale-border': 'rgba(0, 0, 0, 0.1)',
      '--whale-accent': '#4d6bfe',
      '--whale-on-accent': '#ffffff',
      '--whale-button': '#4d6bfe',
      '--whale-button-hover': '#3b5bdb',
      '--whale-on-button': '#ffffff',
      '--whale-ok': '#16a34a',
      '--whale-warn': '#d97706',
      '--whale-danger': '#dc2626',
    };
  try {
    const computed = getComputedStyle(document.documentElement);
    for (const key of WHALE_THEME_TOKEN_KEYS) {
      const value = computed.getPropertyValue(key)?.trim();
      if (value) variables[key] = value;
    }
  } catch { /* ignore */ }
  return { appearance, variables };
}

function postWhaleUiMessage(entry, payload) {
  const target = entry?.iframe?.contentWindow;
  if (!target) return;
  target.postMessage({
    channel: WHALE_CHANNEL,
    version: WHALE_VERSION,
    instanceId: entry.instanceId,
    ...payload,
  }, '*');
}

function postWhaleUiRender(entry) {
  if (!entry?.ready) return;
  postWhaleUiMessage(entry, {
    type: 'render',
    program: entry.program,
    language: entry.language,
    streaming: Boolean(entry.streaming),
    state: entry.state || {},
    theme: buildWhaleUiTheme(),
    locale: whaleUiLocale(),
  });
}

export function broadcastWhaleUiTheme() {
  for (const entry of whaleUiInstances.values()) {
    if (entry.ready && entry.iframe.isConnected) postWhaleUiRender(entry);
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function loadWhaleUiBundleBase64(name) {
  if (!SAFE_WHALE_BUNDLE.test(String(name || ''))) {
    return Promise.reject(new Error(`Invalid Whale UI asset: ${name}`));
  }
  let task = whaleUiBundleCache.get(name);
  if (!task) {
    task = fetch(`./whale-ui/assets/${encodeURIComponent(name)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load Whale UI asset ${name} (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytesToBase64(bytes);
      })
      .catch((error) => {
        whaleUiBundleCache.delete(name);
        throw error;
      });
    whaleUiBundleCache.set(name, task);
  }
  return task;
}

function safeHttpsImageUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

async function resolveWhaleUiResource(path, query = {}) {
  const key = JSON.stringify([path, query]);
  if (whaleUiResourceCache.has(key)) return whaleUiResourceCache.get(key);
  try {
    if (path === '/api/wiki') {
      const title = typeof query.title === 'string' ? query.title.trim() : '';
      if (!title || title.length > 200) return { status: 400, body: { error: { message: 'title must contain 1 to 200 characters.' } } };
      const article = encodeURIComponent(title.replaceAll(' ', '_'));
      const [summaryRes, mediaRes] = await Promise.all([
        fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${article}`),
        fetch(`https://en.wikipedia.org/api/rest_v1/page/media-list/${article}`),
      ]);
      const summary = summaryRes.ok ? await summaryRes.json() : {};
      const media = mediaRes.ok ? await mediaRes.json() : {};
      const photos = [];
      const addPhoto = (candidate) => {
        const url = safeHttpsImageUrl(candidate);
        if (url && !photos.includes(url) && !/\.(?:svg)(?:\?|$)|(?:flag|logo|coat_of_arms|locator_map)/i.test(url)) {
          photos.push(url);
        }
      };
      addPhoto(summary?.thumbnail?.source);
      for (const item of Array.isArray(media?.items) ? media.items : []) {
        if (item?.type === 'image') {
          for (const source of (item.srcset ?? []).slice(0, 1)) addPhoto(source?.src);
        }
        if (photos.length >= 3) break;
      }
      const lat = summary?.coordinates?.lat;
      const lng = summary?.coordinates?.lon;
      const body = { ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}), photos: photos.slice(0, 3) };
      const result = { status: 200, body };
      whaleUiResourceCache.set(key, result);
      return result;
    }
    if (path === '/api/image-search') {
      const term = typeof query.q === 'string' ? query.q.trim().replace(/\s+/g, ' ') : '';
      if (term.length < 2 || term.length > 200) return { status: 400, body: { error: { message: 'q must contain 2 to 200 characters.' } } };
      const url = new URL('https://en.wikipedia.org/w/api.php');
      url.search = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        origin: '*',
        generator: 'search',
        gsrsearch: term,
        gsrlimit: '6',
        prop: 'pageimages',
        piprop: 'thumbnail',
        pithumbsize: '960',
      }).toString();
      const res = await fetch(url.href);
      const data = res.ok ? await res.json() : {};
      const photos = [];
      for (const page of Array.isArray(data?.query?.pages) ? data.query.pages : []) {
        const src = safeHttpsImageUrl(page?.thumbnail?.source);
        if (src && !photos.includes(src) && !/\.(?:svg)(?:\?|$)|(?:flag|logo|coat_of_arms|locator_map|signature)/i.test(src)) {
          photos.push(src);
        }
      }
      const result = { status: 200, body: { images: photos.slice(0, 4) } };
      whaleUiResourceCache.set(key, result);
      return result;
    }
    if (path === '/api/street-route') {
      const source = typeof query.coords === 'string' ? query.coords : '';
      const points = source.split(';').map((pair) => pair.split(',').map((part) => (part.trim() === '' ? NaN : Number(part))));
      if (points.length < 2 || points.length > 25 || points.some((pair) => pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]))) {
        return { status: 400, body: { error: { message: 'Invalid coordinates.' } } };
      }
      const coordinates = points.map((pair) => pair.join(',')).join(';');
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`);
      const data = res.ok ? await res.json() : {};
      const route = data?.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(route) || route.length < 2) throw new Error('No street route was returned.');
      const result = { status: 200, body: { points: route.map(([lng, lat]) => [lat, lng]) } };
      whaleUiResourceCache.set(key, result);
      return result;
    }
    return { status: 404, body: { error: { message: 'Unknown resource path.' } } };
  } catch (error) {
    return { status: 502, body: { error: { message: error?.message || 'Resource unavailable.' } } };
  }
}

async function handleWhaleUiAction(data) {
  const action = data.action;
  if (action === 'clipboard') {
    const ok = await copyText(String(data.text ?? ''), { done: '已复制' });
    return ok ? { ok: true } : { ok: false, error: '无法访问剪贴板' };
  }
  if (action === 'open-url') {
    try {
      const url = new URL(String(data.url || ''));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, error: 'Only HTTP(S) links can be opened.' };
      }
      window.open(url.href, '_blank', 'noopener,noreferrer');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || '链接无效' };
    }
  }
  if (action === 'download') {
    try {
      const filename = String(data.filename || 'download.txt').replace(/[\\/:*?"<>|]+/g, '_');
      const mime = String(data.mime || 'text/plain;charset=utf-8');
      const blob = new Blob([String(data.content ?? '')], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast(`已下载 ${filename}`, { tone: 'success' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || '下载失败' };
    }
  }
  if (action === 'assistant') {
    const base = String(data.message || '').trim();
    const parts = [base];
    if (data.context != null && data.context !== '') {
      parts.push(typeof data.context === 'string' ? data.context : JSON.stringify(data.context));
    }
    if (data.formState && typeof data.formState === 'object' && Object.keys(data.formState).length > 0 && !base) {
      parts.push(JSON.stringify(data.formState));
    }
    const text = parts.filter(Boolean).join('\n');
    if (!text) return { ok: false, error: '消息内容为空' };
    if (!state.sessionId || currentReadOnlyReason() || composerOffline()) {
      return { ok: false, error: '当前会话不可发送消息' };
    }
    try {
      draft.value = text;
      renderComposer();
      await sendPrompt();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || '发送失败' };
    }
  }
  return { ok: false, error: `Unsupported action: ${String(action)}` };
}

window.addEventListener('message', (event) => {
  const data = event?.data;
  if (!data || typeof data !== 'object' || data.channel !== WHALE_CHANNEL || data.version !== WHALE_VERSION) return;
  const instanceId = typeof data.instanceId === 'string' ? data.instanceId : '';
  const entry = whaleUiInstances.get(instanceId);
  if (!entry || event.source !== entry.iframe.contentWindow) return;

  if (data.type === 'ready') {
    entry.ready = true;
    postWhaleUiRender(entry);
    return;
  }
  if (data.type === 'height') {
    const height = Math.max(60, Math.ceil(Number(data.height) || 0));
    if (Number.isFinite(height) && height > 0) {
      entry.iframe.style.height = `${height}px`;
    }
    return;
  }
  if (data.type === 'title') {
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (title) {
      entry.viewerTitle = title;
      if (!entry.explicitTitle) entry.titleEl.textContent = title;
    }
    return;
  }
  if (data.type === 'state') {
    if (data.state && typeof data.state === 'object' && !Array.isArray(data.state)) {
      entry.state = data.state;
      whaleUiStateStore.set(instanceId, data.state);
    }
    return;
  }
  if (data.type === 'bundle' && typeof data.requestId === 'string') {
    const requestId = data.requestId;
    const name = String(data.name || '');
    loadWhaleUiBundleBase64(name)
      .then((base64) => {
        postWhaleUiMessage(entry, { type: 'bundle-response', requestId, name, base64 });
      })
      .catch((error) => {
        postWhaleUiMessage(entry, {
          type: 'bundle-response',
          requestId,
          name,
          error: error?.message || `Unable to load ${name}`,
        });
      });
    return;
  }
  if (data.type === 'resource' && typeof data.requestId === 'string') {
    const requestId = data.requestId;
    resolveWhaleUiResource(String(data.path || ''), data.query && typeof data.query === 'object' ? data.query : {})
      .then(({ status, body }) => {
        postWhaleUiMessage(entry, { type: 'resource-response', requestId, status, body });
      });
    return;
  }
  if (data.type === 'action' && typeof data.requestId === 'string') {
    const requestId = data.requestId;
    handleWhaleUiAction(data)
      .then((result) => {
        postWhaleUiMessage(entry, { type: 'action-response', requestId, result });
      });
  }
});

/**
 * Interactive Whale UI card widget with Preview / Source toggle, copy action,
 * and sandboxed viewer.html iframe that survives live streaming updates.
 */
export function whaleUiCardNode({ cardKey, language = 'whale-ui', program = '', title = '', streaming = false }) {
  const instanceId = `${state.sessionId || 'local'}:${cardKey}`;
  const normalizedLang = normalizeUiLanguage(language);
  const explicitTitle = String(title || UI_FENCE_TITLE.exec(program || '')?.[1] || '').trim();
  const existing = whaleUiInstances.get(instanceId);
  if (existing) {
    const changed = existing.program !== program
      || existing.language !== normalizedLang
      || existing.streaming !== Boolean(streaming);
    existing.program = program;
    existing.language = normalizedLang;
    existing.streaming = Boolean(streaming);
    existing.explicitTitle = explicitTitle;
    existing.cardEl.dataset.streaming = existing.streaming ? 'true' : 'false';
    existing.titleEl.textContent = explicitTitle || existing.viewerTitle || (existing.streaming ? '正在生成交互界面…' : '交互界面');
    existing.sourceCode.textContent = program;
    if (changed) postWhaleUiRender(existing);
    return existing.cardEl;
  }

  const cardEl = document.createElement('div');
  cardEl.className = 'whale-ui-card md-ui-card';
  cardEl.dataset.mode = 'preview';
  cardEl.dataset.streaming = streaming ? 'true' : 'false';

  const head = document.createElement('div');
  head.className = 'whale-ui-head';

  const titleEl = document.createElement('span');
  titleEl.className = 'whale-ui-title';
  titleEl.textContent = explicitTitle || (streaming ? '正在生成交互界面…' : '交互界面');

  const controls = document.createElement('div');
  controls.className = 'whale-ui-controls';

  const tabs = document.createElement('div');
  tabs.className = 'whale-ui-tabs';
  tabs.setAttribute('role', 'tablist');

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'whale-ui-tab active';
  previewBtn.setAttribute('role', 'tab');
  previewBtn.setAttribute('aria-selected', 'true');
  previewBtn.textContent = '预览';

  const sourceBtn = document.createElement('button');
  sourceBtn.type = 'button';
  sourceBtn.className = 'whale-ui-tab';
  sourceBtn.setAttribute('role', 'tab');
  sourceBtn.setAttribute('aria-selected', 'false');
  sourceBtn.textContent = '源码';

  tabs.append(previewBtn, sourceBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'whale-ui-copy md-code-copy hidden';
  copyBtn.textContent = '复制';
  copyBtn.setAttribute('aria-label', '复制交互界面源码');

  controls.append(tabs, copyBtn);
  head.append(titleEl, controls);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'whale-ui-preview';

  const iframe = document.createElement('iframe');
  iframe.className = 'whale-ui-frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.name = `${WHALE_FRAME_PREFIX}${instanceId}`;
  iframe.title = explicitTitle || 'Whale UI';
  iframe.style.height = '180px';
  iframe.src = './whale-ui/viewer.html';
  previewWrap.append(iframe);

  const sourcePre = document.createElement('pre');
  sourcePre.className = 'whale-ui-source md-code hidden';
  const sourceCode = document.createElement('code');
  sourceCode.textContent = program;
  sourcePre.append(sourceCode);

  cardEl.append(head, previewWrap, sourcePre);

  const entry = {
    instanceId,
    cardKey,
    cardEl,
    titleEl,
    iframe,
    sourcePre,
    sourceCode,
    previewWrap,
    previewBtn,
    sourceBtn,
    copyBtn,
    mode: 'preview',
    language: normalizedLang,
    program,
    streaming: Boolean(streaming),
    explicitTitle,
    viewerTitle: '',
    state: whaleUiStateStore.get(instanceId) || {},
    ready: false,
  };

  const setMode = (mode) => {
    entry.mode = mode;
    const isSource = mode === 'source';
    cardEl.dataset.mode = mode;
    previewBtn.classList.toggle('active', !isSource);
    previewBtn.setAttribute('aria-selected', String(!isSource));
    sourceBtn.classList.toggle('active', isSource);
    sourceBtn.setAttribute('aria-selected', String(isSource));
    previewWrap.classList.toggle('hidden', isSource);
    sourcePre.classList.toggle('hidden', !isSource);
    copyBtn.classList.toggle('hidden', !isSource);
  };

  previewBtn.addEventListener('click', () => setMode('preview'));
  sourceBtn.addEventListener('click', () => setMode('source'));
  copyBtn.addEventListener('click', () => {
    void copyText(entry.program, { done: '源码已复制' });
  });

  whaleUiInstances.set(instanceId, entry);
  return cardEl;
}

export function markdownUiCardNode(block, { cardKey = '', streaming = false } = {}) {
  const title = UI_FENCE_TITLE.exec(block.text || '')?.[1] || '';
  return whaleUiCardNode({
    cardKey: cardKey || `fence:${block.lang}:${(block.text || '').slice(0, 32)}`,
    language: normalizeUiLanguage(block.lang),
    program: block.text || '',
    title,
    streaming: Boolean(block.streaming || streaming),
  });
}
