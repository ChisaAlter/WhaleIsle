'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildSettingsSectionScript } = require('./settings-jump');
const { REMOTE_FEATURE_ENABLED } = require('./config');

/**
 * In-page helpers for the Electron release walk. Kept as a string so
 * executeJavaScript can eval them without a Node closure.
 */
const PAGE_HELPERS = `
function dshShown(el) {
  if (!el) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none';
}
function dshLabel(el) {
  const labelled = (el.getAttribute('aria-labelledby') || '').trim().split(/\\s+/)
    .map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
  return (labelled || el.getAttribute('aria-label') || el.textContent || '')
    .replace(/\\s+/g, ' ').trim();
}
function dshSwitchChecked(el) {
  if (!el) return null;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') return el.checked;
  const value = el.getAttribute('aria-checked');
  return value === 'true' ? true : value === 'false' ? false : null;
}
function dshFind(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll(
    'button, [role="button"], [role="menuitem"], [role="tab"], [role="searchbox"], [role="textbox"], input, textarea, a'
  )).find((el) => dshShown(el) && re.test(dshLabel(el))) || null;
}
function dshComposerSend() {
  const card = document.querySelector('[data-composer-card]');
  if (!card) return null;
  return dshFind('send message|发送消息', card);
}
function composerModelTrigger() {
  const card = document.querySelector('[data-composer-card]');
  if (!card) return null;
  return Array.from(card.querySelectorAll('button[aria-haspopup="menu"]')).find((el) =>
    dshShown(el) && /选择模型|select model/i.test(el.getAttribute('aria-label') || '')) || null;
}
const VISION_PASS_RE = /不支持图片|does not support images?|无法查看|不能读图|无法识图|不能识图|没有.*视觉|识图|像素|multimodal|image input|这张.*图|图中|图片里|PNG|rgb|红|蓝|绿|颜色|包含非文本|暂不支持编辑|non-text/i;
const VISION_PRE_SEND_RE = /不支持图片|does not support images?|无法.*图|不能.*图|包含非文本|暂不支持编辑|non-text/i;
function lastAssistantText() {
  const assistants = Array.from(document.querySelectorAll(
    '[data-chat-flow-kind="assistant"], [data-chat-flow-kind="assistant-step"]',
  ));
  const last = assistants.at(-1);
  return last ? (last.innerText || '').trim() : '';
}
function dshQaPngFile() {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], 'dshd-qa.png', { type: 'image/png' });
}
function dshAssignFile(input, file) {
  if (!input || !file) return false;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
function dshSetValue(el, value) {
  if (!el) return false;
  el.focus();
  try {
    if (typeof el.select === 'function') el.select();
  } catch {
    /* password / number inputs still accept insertText */
  }
  if (document.execCommand && document.execCommand('insertText', false, value) && el.value === value) {
    return true;
  }
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  const tracker = el._valueTracker;
  const last = el.value;
  if (tracker) tracker.setValue(last);
  setter.call(el, value);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: 'insertText',
    data: value,
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === value;
}
function dshComposerInput() {
  return document.querySelector('[data-composer-input]');
}
function dshComposerReady() {
  const el = dshComposerInput();
  return Boolean(
    el
    && dshShown(el)
    && el.getAttribute('contenteditable') === 'true'
    && el.getAttribute('aria-disabled') !== 'true'
  );
}
function dshComposerIdle() {
  const stop = dshFind('stop generating|停止生成|deep diving|深潜');
  const send = dshComposerSend();
  return dshComposerReady() && Boolean(send && !send.disabled) && (!stop || stop.disabled);
}
function dshComposerText() {
  const el = dshComposerInput();
  return ((el && (el.innerText || el.textContent)) || '')
    .replace(/\\u00a0/g, ' ')
    .replace(/\\r\\n/g, '\\n')
    .replace(/\\n+$/g, '');
}
function dshSelectComposerAll(el) {
  el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'a',
    code: 'KeyA',
    keyCode: 65,
    which: 65,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  }));
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}
function dshSetComposerText(value) {
  const el = dshComposerInput();
  if (!el || !dshComposerReady()) return false;
  if (typeof el.click === 'function') el.click();
  if (dshComposerText() === value) return true;
  dshSelectComposerAll(el);
  if (document.execCommand) {
    if (value) document.execCommand('insertText', false, value);
    else document.execCommand('delete');
  }
  if (dshComposerText() === value) return true;
  el.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    composed: true,
    inputType: value ? 'insertReplacementText' : 'deleteByCut',
    data: value || null,
  }));
  return dshComposerText() === value;
}
function dshField(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll('input, textarea')).find((el) => {
    const aria = el.getAttribute('aria-label') || '';
    const ph = el.getAttribute('placeholder') || '';
    return re.test(aria) || re.test(ph);
  }) || null;
}
function dshCustomProviderCard(root) {
  const scope = root || document;
  const route = Array.from(scope.querySelectorAll('input, textarea')).find((el) =>
    /^provider id$/i.test(el.getAttribute('aria-label') || ''));
  if (!route) return null;
  let node = route.parentElement;
  while (node && node !== document.body) {
    // EditorFooter replaces the submit label while the write is in flight.
    // The unique Provider ID field still belongs to the same creation card.
    const hasCreate = Array.from(node.querySelectorAll('button')).some((btn) =>
      /^(创建提供商|create provider|创建中|正在创建|creating)$/i.test(
        dshLabel(btn).replace(/[.…]+$/, '').trim()));
    if (hasCreate) return node;
    node = node.parentElement;
  }
  return null;
}
function dshInputInventory(root) {
  const scope = root || document;
  return Array.from(scope.querySelectorAll('input, textarea')).map((el) => ({
    aria: el.getAttribute('aria-label') || '',
    ph: el.getAttribute('placeholder') || '',
    shown: dshShown(el),
    type: el.type || el.tagName,
  })).slice(0, 12);
}
function dshDialog() {
  return Array.from(document.querySelectorAll('[role="dialog"]')).find(dshShown) || null;
}
function dshDialogNamed(pattern) {
  const re = new RegExp(pattern, 'i');
  return Array.from(document.querySelectorAll('[role="dialog"]')).filter(dshShown).find((el) => {
    const labelled = el.getAttribute('aria-labelledby');
    const title = labelled ? ((document.getElementById(labelled) && document.getElementById(labelled).textContent) || '') : '';
    const aria = el.getAttribute('aria-label') || '';
    return re.test(aria) || re.test(title);
  }) || null;
}
function dshHeading(pattern, root) {
  const re = new RegExp(pattern, 'i');
  const scope = root || document;
  return Array.from(scope.querySelectorAll('h1, h2, h3')).find((el) =>
    dshShown(el) && re.test((el.textContent || '').trim())) || null;
}
function dshSkillsSnapshot() {
  const dialog = dshDialogNamed('^设置$|^settings$');
  const nav = document.querySelector('[data-dsh-settings-section="skills"]');
  return {
    nav: Boolean(nav),
    active: nav?.getAttribute('aria-current') === 'true',
    dialog: Boolean(dialog),
    heading: Boolean(dialog && dshHeading('^skills$|^技能$', dialog)),
    add: Boolean(dialog && dshFind('^add skill$|^添加技能$', dialog)),
  };
}
function dshMcpSnapshot() {
  const dialog = dshDialogNamed('^设置$|^settings$');
  const nav = document.querySelector('[data-dsh-settings-section="mcp"]');
  const search = dialog && dialog.querySelector('input[type="search"], [role="searchbox"]');
  return {
    nav: Boolean(nav),
    active: nav?.getAttribute('aria-current') === 'true',
    dialog: Boolean(dialog),
    heading: Boolean(dialog && dshHeading('mcp servers|mcp 服务器', dialog)),
    search: Boolean(search && dshShown(search)),
    add: Boolean(dialog && dshFind('add server|添加服务器', dialog)),
  };
}
function dshModelsDiagnostic(route, name) {
  const dialog = dshDialogNamed('^设置$|^settings$');
  const nav = document.querySelector('[data-dsh-settings-section="models"]');
  const rows = dialog ? Array.from(dialog.querySelectorAll('li')) : [];
  const identity = (el) => (el.innerText || '').includes(name) || (el.innerText || '').includes(route);
  return {
    dialog: Boolean(dialog),
    active: nav?.getAttribute('aria-current') === 'true',
    rows: rows.length,
    shownRows: rows.filter(dshShown).length,
    identityRows: rows.filter(identity).length,
    identityShown: rows.some((el) => identity(el) && dshShown(el)),
    identityText: Boolean(dialog && identity(dialog)),
    alerts: dialog?.querySelectorAll('[role="alert"]').length || 0,
  };
}
function dshSavedCustomProvider(route, name) {
  const dialog = dshDialogNamed('^设置$|^settings$');
  const nav = document.querySelector('[data-dsh-settings-section="models"]');
  if (!dialog || nav?.getAttribute('aria-current') !== 'true') return null;
  const row = Array.from(dialog.querySelectorAll('li')).find((el) =>
    dshShown(el) && ((el.innerText || '').includes(name) || (el.innerText || '').includes(route)));
  if (!row) return null;
  const credential = Array.from(row.querySelectorAll('[role="img"]')).find((el) =>
    dshShown(el) && /credential configured|已配置|api key configured/i.test(dshLabel(el)));
  return {
    listed: true,
    configured: Boolean(credential),
    leak: /sk-dshd-qa-placeholder/.test(dialog.innerText || ''),
  };
}
`;

/**
 * QA log line for a Remote snapshot. Never includes token or pairing URLs.
 * @param {object | null | undefined} snap
 * @returns {string}
 */
function summarizeRemoteQaDetail(snap) {
  if (snap == null) return 'no snapshot';
  const parts = [
    `available=${snap.available === true}`,
    `enabled=${snap.enabled === true}`,
    `listening=${snap.listening === true}`,
  ];
  if (snap.port != null) parts.push(`port=${snap.port}`);
  if (snap.mode) parts.push(`mode=${snap.mode}`);
  parts.push(`tokenPresent=${Boolean(snap.token)}`);
  if (Array.isArray(snap.urls)) parts.push(`urls=${snap.urls.length}`);
  const err = typeof snap.error === 'string' ? snap.error.trim() : '';
  if (err) parts.push(`error=${err}`);
  return parts.join(' ');
}

const QA_REQUIRED_STEPS = [
  'workspace.picker',
  'workspace.connected',
  'frame.fourColumn',
  'composer.card',
  'composer.textarea',
  'composer.commands',
  'composer.send',
  'composer.access',
  'composer.heroCentered',
  'composer.thinkingSwitch',
  'composer.skillMenuAbsent',
  'composer.pathSourceAbsent',
  'remote.available',
  'remote.notListening',
  'remote.footerPresent',
  'titlebar.sessionLog',
  'titlebar.branch',
  'titlebar.commit',
  'titlebar.git',
  'titlebar.terminal',
  'titlebar.surfaces',
  'titlebar.windowControls',
  'titlebar.branchMenu',
  'titlebar.gitMenu',
  'terminal.drawer',
  'terminal.new',
  'rightbar.open',
  'rightbar.legacyDormant',
  'files.panel',
  'files.tabCloseRight',
  'files.search',
  'files.readme',
  'files.note',
  'files.mentionVisible',
  'files.mentionAppended',
  'git.commit',
  'agents.panel',
  'agents.empty',
  'diff.panel',
  'browser.panel',
  'browser.url',
  'terminal.surface',
  'account.launcher',
  'account.signedOutMenu',
  'settings.trigger',
  'models.heading',
  'models.customAdd',
  'models.customForm',
  'models.visionPicker',
  'appearance.choose',
  'appearance.browse',
  'appearance.noSourceDump',
  'appearance.themeSwitch',
  'appearance.localCrop',
  'appearance.frost',
  'gallery.dialog',
  'gallery.sources',
  'gallery.addSource',
  'gallery.wallhavenSfw',
  'gallery.confirmSet',
  'mcp.heading',
  'mcp.search',
  'mcp.add',
  'skills.heading',
  'skills.add',
  'plugins.heading',
  'market.section',
  'market.discover',
  'market.installed',
  'usage-stats.section',
  'interface.dshbotSwitch',
  'interface.sessionLogMenu',
  'plugin.dshbot.defaultOff',
];

function gitHeadSubject(workspacePath) {
  if (!workspacePath) return '';
  const result = spawnSync('git', ['-C', workspacePath, 'log', '-1', '--pretty=%s'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function gitPorcelain(workspacePath) {
  if (!workspacePath) return '';
  const result = spawnSync('git', ['-C', workspacePath, 'status', '--porcelain'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}

function dirtyQaNote(workspacePath) {
  if (!workspacePath) return false;
  try {
    fs.writeFileSync(
      path.join(workspacePath, 'note.md'),
      `composer official qa\nline-two\nqa-commit-${Date.now()}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(probe, timeoutMs, intervalMs = 200, isReady) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe();
    if (isReady ? isReady(last) : last) return last;
    await sleep(intervalMs);
  }
  // A partial object must not become a truthy success when its ready
  // predicate never passed. Boolean-only callers retain their old result.
  return isReady ? null : last;
}

// Snapshot presence alone does not mean the controls have finished mounting.
function probeSignedOutAccountMenu(wc, timeoutMs = 5_000) {
  return waitUntil(() => pageEval(wc, () => {
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((el) =>
      dshShown(el) && (dshFind('^sign in$|^登录$', el) || dshFind('^contact us$|^联系我们$', el)));
    if (!menu) return null;
    return {
      signIn: Boolean(dshFind('^sign in$|^登录$', menu)),
      contact: Boolean(dshFind('^contact us$|^联系我们$', menu)),
    };
  }), timeoutMs, 200, (state) => state?.signIn && state?.contact);
}

function probeAppearanceControls(wc, timeoutMs = 10_000) {
  return waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialogNamed('^设置$|^settings$');
    if (!dialog) return null;
    const nav = document.querySelector('[data-dsh-settings-section="appearance"]');
    const text = dialog.innerText || '';
    return {
      nav: nav?.getAttribute('aria-current') === 'true',
      heading: Boolean(dshHeading('wallpaper|背景图', dialog)),
      choose: Boolean(dshFind('choose image|选择图片', dialog)),
      browse: Boolean(dshFind('browse gallery|浏览图库', dialog)),
      bingDaily: /Bing daily wallpapers|Bing 每日壁纸/.test(text),
      catalogUrls: /Wallpaper catalog URLs|壁纸目录地址/.test(text),
      placeholder: Boolean(dialog.querySelector('input[placeholder="https://example.com/wallpapers.json"]')),
    };
  }), timeoutMs, 200, (state) => state?.nav && state?.heading && state?.choose && state?.browse);
}

function pageEval(wc, fn, ...args) {
  const serialized = args.map((value) => JSON.stringify(value)).join(', ');
  return wc.executeJavaScript(`(() => { ${PAGE_HELPERS}; return (${fn.toString()})(${serialized}); })()`);
}

function pageScript(wc, body, args) {
  return wc.executeJavaScript(`(() => {
    ${PAGE_HELPERS}
    const args = ${JSON.stringify(args || {})};
    ${body}
  })()`);
}

async function typeIntoAriaField(wc, pattern, value) {
  const box = await pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const card = dialog && dshCustomProviderCard(dialog);
    const el = card && dshField(args.pattern, card);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    el.focus();
    if (typeof el.select === 'function') el.select();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  `, { pattern });
  if (!box || box.w < 1 || box.h < 1) return false;
  try {
    if (wc.debugger && !wc.debugger.isAttached()) await wc.debugger.attach('1.3');
  } catch {
    /* already attached or unavailable — sendInputEvent/insertText still work */
  }
  if (typeof wc.sendInputEvent === 'function') {
    wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
    wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  if (wc.debugger && wc.debugger.isAttached()) {
    try {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
    } catch {
      /* page click below */
    }
  }
  await pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const card = dialog && dshCustomProviderCard(dialog);
    const el = card && dshField(args.pattern, card);
    if (!el) return false;
    el.click();
    el.focus();
    return true;
  `, { pattern });
  await sleep(40);
  if (typeof wc.insertText === 'function') {
    await Promise.resolve(wc.insertText(value));
  } else if (wc.debugger && wc.debugger.isAttached()) {
    await wc.debugger.sendCommand('Input.insertText', { text: value });
  } else {
    await pageScript(wc, `
      const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
      const card = dialog && dshCustomProviderCard(dialog);
      const el = card && dshField(args.pattern, card);
      return el ? dshSetValue(el, args.value) : false;
    `, { pattern, value });
  }
  await sleep(80);
  return pageScript(wc, `
    const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
    const card = dialog && dshCustomProviderCard(dialog);
    const el = card && dshField(args.pattern, card);
    return Boolean(el && el.value === args.value);
  `, { pattern, value });
}

/**
 * Real-input fill for a dialog textarea: React controlled components must see
 * trusted input events, so click and insert through the attached debugger
 * (same pattern as the composer) and fall back to dshSetValue only when the
 * debugger is unavailable.
 */
async function typeIntoDialogTextarea(wc, dialogPattern, value) {
  const box = await pageScript(wc, `
    const dialog = dshDialogNamed(args.dialogPattern);
    const ta = dialog && dialog.querySelector('textarea');
    if (!ta || !dshShown(ta)) return null;
    ta.scrollIntoView({ block: 'center', inline: 'nearest' });
    ta.focus();
    if (typeof ta.select === 'function') ta.select();
    const r = ta.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
  `, { dialogPattern });
  if (!box || box.w < 1 || box.h < 1) return false;
  try {
    if (wc.debugger && !wc.debugger.isAttached()) await wc.debugger.attach('1.3');
  } catch {
    /* already attached or unavailable — sendInputEvent/insertText still work */
  }
  if (typeof wc.sendInputEvent === 'function') {
    wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
    wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  if (wc.debugger && wc.debugger.isAttached()) {
    try {
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
      await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
      });
    } catch {
      /* page click below */
    }
  }
  await pageScript(wc, `
    const dialog = dshDialogNamed(args.dialogPattern);
    const ta = dialog && dialog.querySelector('textarea');
    if (!ta) return false;
    ta.click();
    ta.focus();
    return true;
  `, { dialogPattern });
  await sleep(40);
  if (typeof wc.insertText === 'function') {
    await Promise.resolve(wc.insertText(value));
  } else if (wc.debugger && wc.debugger.isAttached()) {
    await wc.debugger.sendCommand('Input.insertText', { text: value });
  } else {
    await pageScript(wc, `
      const dialog = dshDialogNamed(args.dialogPattern);
      const ta = dialog && dialog.querySelector('textarea');
      return ta ? dshSetValue(ta, args.value) : false;
    `, { dialogPattern, value });
  }
  await sleep(80);
  return pageScript(wc, `
    const dialog = dshDialogNamed(args.dialogPattern);
    const ta = dialog && dialog.querySelector('textarea');
    return Boolean(ta && ta.value === args.value);
  `, { dialogPattern, value });
}

async function typeIntoComposer(wc, value, timeoutMs) {
  const deadline = timeoutMs == null ? Infinity : Date.now() + timeoutMs;
  const remaining = (cap) => Math.max(0, Math.min(cap, deadline - Date.now()));
  const ready = await waitUntil(() => pageEval(wc, () => dshComposerReady()), remaining(8_000));
  if (!ready) return false;
  const expected = String(value || '');
  const box = await pageEval(wc, () => {
    const el = dshComposerInput();
    if (!el || !dshComposerReady()) return null;
    el.scrollIntoView({ block: 'nearest' });
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x + Math.min(40, rect.width / 2)),
      y: Math.round(rect.y + rect.height / 2),
    };
  });
  if (!box) return false;

  try {
    if (wc.debugger && !wc.debugger.isAttached()) await wc.debugger.attach('1.3');
  } catch {
    /* already attached or unavailable */
  }

  const clickComposer = async () => {
    if (typeof wc.sendInputEvent === 'function') {
      wc.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
      wc.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    if (wc.debugger && wc.debugger.isAttached()) {
      try {
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1,
        });
        await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1,
        });
      } catch {
        /* page click below */
      }
    }
    await pageEval(wc, () => {
      const el = dshComposerInput();
      if (!el) return false;
      if (typeof el.click === 'function') el.click();
      el.focus();
      return true;
    });
  };
  const selectAll = async () => {
    if (typeof wc.sendInputEvent === 'function') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'char', keyCode: 'A', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    }
    if (wc.debugger && wc.debugger.isAttached()) {
      try {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
          windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
        });
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2,
          windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
        });
      } catch {
        /* page select-all below */
      }
    }
    await pageEval(wc, () => {
      const el = dshComposerInput();
      if (!el) return false;
      dshSelectComposerAll(el);
      return true;
    });
  };
  const backspace = async () => {
    if (typeof wc.sendInputEvent === 'function') {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    }
    if (wc.debugger && wc.debugger.isAttached()) {
      try {
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
        });
        await wc.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
        });
      } catch {
        /* ignore */
      }
    }
  };
  const insert = async (text) => {
    if (typeof wc.insertText === 'function') {
      await Promise.resolve(wc.insertText(text));
      return;
    }
    if (wc.debugger && wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Input.insertText', { text });
    }
  };

  await clickComposer();
  await sleep(80);
  const existing = await pageEval(wc, () => dshComposerText());
  if (existing !== expected) {
    await selectAll();
    await sleep(40);
    if (existing) {
      await backspace();
      await sleep(40);
      const leftover = await pageEval(wc, () => dshComposerText());
      if (leftover && leftover !== expected) {
        await selectAll();
        await sleep(20);
        await backspace();
        await sleep(40);
      }
    }
    if (expected) await insert(expected);
  }
  const written = await waitUntil(async () => {
    const text = await pageEval(wc, () => dshComposerText());
    return text === expected ? true : null;
  }, remaining(2_000));
  if (written) return true;
  if (Date.now() >= deadline) return false;
  return pageScript(wc, 'return dshSetComposerText(args.value);', { value: expected });
}

async function clickNewSession(wc) {
  const clicked = await pageEval(wc, () => {
    const buttons = Array.from(document.querySelectorAll('button')).filter(dshShown);
    const btn = buttons.find((el) => {
      const aria = el.getAttribute('aria-label') || '';
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /新建会话|new session in/i.test(aria) || text === '新会话' || text === '新对话';
    });
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  if (!clicked) return false;
  await waitUntil(() => pageEval(wc, () => (dshComposerReady() ? true : null)), 8_000);
  return true;
}

function clickNamed(wc, pattern, rootSelector) {
  return pageScript(wc, `
    const root = args.rootSelector ? document.querySelector(args.rootSelector) : document;
    const el = dshFind(args.pattern, root || document);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  `, { pattern, rootSelector: rootSelector || null });
}

async function pressEnter(wc) {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
}

async function openComposerModelMenu(wc) {
  const opened = await pageEval(wc, () => {
    const trigger = composerModelTrigger();
    if (!trigger || trigger.disabled) return false;
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    return true;
  });
  if (!opened) return false;
  return Boolean(await waitUntil(() => pageEval(wc, () => {
    const menu = document.querySelector('[role="menu"]');
    return menu && dshShown(menu) ? true : null;
  }), 6_000));
}

async function closeComposerModelMenu(wc, pressEscape) {
  const expanded = await pageEval(wc, () => {
    const trigger = composerModelTrigger();
    return Boolean(trigger && trigger.getAttribute('aria-expanded') === 'true');
  });
  if (!expanded) return;
  if (typeof pressEscape === 'function') await pressEscape(wc);
  await sleep(150);
  await pageEval(wc, () => {
    const trigger = composerModelTrigger();
    if (trigger && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
    return true;
  });
}

async function waitForComposerIdle(wc, timeoutMs = 10_000, readinessDraft) {
  const deadline = Date.now() + timeoutMs;
  if (readinessDraft != null) {
    // A healthy empty draft disables Send. First prove that the empty
    // composer has left its Stop state, then fill an unsent draft to require
    // enabled Send as well. All phases share the existing timeout budget.
    const stopped = await waitUntil(() => pageEval(wc, () => {
      const stop = dshFind('stop generating|停止生成|deep diving|深潜');
      return dshComposerReady() && dshComposerSend() && (!stop || stop.disabled) ? true : null;
    }), Math.max(0, deadline - Date.now()));
    if (!stopped || !await typeIntoComposer(wc, readinessDraft, Math.max(0, deadline - Date.now()))) return false;
  }
  return Boolean(await waitUntil(() => pageEval(wc, () => dshComposerIdle() ? true : null),
    Math.max(0, deadline - Date.now())));
}

/** A cleared draft and the matching user bubble prove this send was accepted. */
function waitForComposerSubmission(wc, text, timeoutMs = 30_000) {
  return waitUntil(() => pageEval(wc, (want) => {
    const echoed = Array.from(document.querySelectorAll('[data-chat-flow-kind="user"]'))
      .some((el) => dshShown(el) && (el.textContent || '').includes(want));
    if (!echoed || dshComposerText() !== '' || !dshComposerReady()) return null;
    const stop = dshFind('stop generating|停止生成|deep diving|深潜');
    if (stop && !stop.disabled) return 'engaged';
    // Empty, editable composers correctly disable Send after a fast turn ends.
    return dshComposerSend() ? 'idle' : null;
  }, text), timeoutMs);
}

async function probeSessionLogMenu(wc, timeoutMs = 5_000) {
  const entry = await pageEval(wc, () => {
    const ordinary = Array.from(document.querySelectorAll('[data-chat-flow-kind="user"]')).some(dshShown);
    const more = ordinary && dshFind('^more actions$|^更多操作$');
    const bar = document.querySelector('#dshd-shell-titlebar-trailing');
    const extraShortcut = Boolean(bar && dshFind('session log|会话日志|Session 日志', bar));
    const opened = Boolean(more && !more.disabled);
    if (opened) more.click();
    return { ordinary, opened, extraShortcut };
  });
  const download = entry.opened && Boolean(await waitUntil(() => pageEval(wc, () => {
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((el) =>
      dshShown(el) && dshFind('download session log|下载会话日志', el));
    const item = menu && dshFind('download session log|下载会话日志', menu);
    return item && !item.disabled && item.getAttribute('aria-disabled') !== 'true' ? true : null;
  }), timeoutMs));
  return { ...entry, download: Boolean(download) };
}

/** The Git primary action varies with repository state; Commit lives in its menu. */
function probeGitCommitMenu(wc, timeoutMs = 5_000) {
  return waitUntil(() => pageEval(wc, () => {
    const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((el) =>
      dshShown(el) && dshFind('^commit$|^提交$', el));
    const commit = menu && dshFind('^commit$|^提交$', menu);
    return commit ? { present: true,
      enabled: !commit.disabled && commit.getAttribute('aria-disabled') !== 'true' } : null;
  }), timeoutMs);
}

/** Verify the current account entry or its documented sidebar fallback. */
async function probeRemoteEntry(wc, timeoutMs = 5_000) {
  const entry = await pageEval(wc, () => {
    const account = dshFind('^account menu|^账号菜单');
    const footer = document.querySelector('[data-dsh-remote-trigger], [data-sidebar-action="remote"]');
    const footerShown = Boolean(footer && dshShown(footer));
    if (account) account.click();
    else if (footerShown) footer.click();
    return { account: Boolean(account), footerShown };
  });
  let menuEntry = false;
  if (entry.account) {
    menuEntry = Boolean(await waitUntil(() => pageEval(wc, () => {
      const menu = Array.from(document.querySelectorAll('[role="menu"]')).find(dshShown);
      const remote = menu && dshFind('^remote$|^远程$', menu);
      if (!remote || remote.disabled) return null;
      remote.click();
      return true;
    }), timeoutMs));
  }
  const popup = Boolean((entry.account ? menuEntry : entry.footerShown) && await waitUntil(() =>
    pageEval(wc, () => {
      const panel = document.querySelector('[data-dsh-remote-panel]');
      return panel && dshShown(panel) && panel.getAttribute('role') === 'dialog'
        && /^remote$|^远程$/i.test(dshLabel(panel)) && dshHeading('^remote$|^远程$', panel) ? true : null;
    }), timeoutMs));
  return {
    ok: REMOTE_FEATURE_ENABLED
      ? popup && (entry.account ? menuEntry && !entry.footerShown : entry.footerShown)
      : !menuEntry && !entry.footerShown && !popup,
    detail: `account=${entry.account} footer=${entry.footerShown} menu=${menuEntry} popup=${popup}`,
  };
}

/**
 * TC-MODEL-004: open the composer Model / Effort menu and switch two
 * reasoning levels, sending a short ping after each. grok-4.6 with no
 * catalog efforts is N/A (still a required row so the table cannot skip
 * the probe).
 * @param {import('electron').WebContents} wc
 * @param {{ pressEscape?: Function }} helpers
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function switchComposerThinking(wc, helpers) {
  const menuOpen = await openComposerModelMenu(wc);
  if (!menuOpen) {
    return { ok: true, detail: 'N/A: composer model menu missing' };
  }
  const effortRow = await pageEval(wc, () => {
    const item = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).find((el) => {
      const label = dshLabel(el);
      return dshShown(el) && /推理等级|^effort/i.test(label);
    });
    if (!item || item.disabled) return '';
    item.click();
    return dshLabel(item).slice(0, 80);
  });
  if (!effortRow) {
    await closeComposerModelMenu(wc, helpers.pressEscape);
    return { ok: true, detail: 'N/A: gateway did not expose reasoning efforts' };
  }
  const choices = await waitUntil(() => pageEval(wc, () => {
    const radios = Array.from(document.querySelectorAll('[role="menu"] [role="menuitemradio"]'))
      .filter(dshShown)
      .map((el) => ({
        label: dshLabel(el).replace(/\s+/g, ' ').trim(),
        checked: el.getAttribute('aria-checked') === 'true',
      }));
    return radios.length ? radios : null;
  }), 6_000);
  if (!choices || choices.length < 2) {
    await closeComposerModelMenu(wc, helpers.pressEscape);
    return {
      ok: true,
      detail: `N/A: fewer than two effort rows (${JSON.stringify(choices || [])})`,
    };
  }
  const picked = [];
  const unchecked = choices.filter((row) => !row.checked);
  const first = unchecked[0] || choices[0];
  const second = choices.find((row) => row.label !== first.label) || choices[1];
  picked.push(first, second);
  await closeComposerModelMenu(wc, helpers.pressEscape);

  const ping = async (label) => {
    const menu = await openComposerModelMenu(wc);
    if (!menu) return `menu closed before ${label}`;
    const effortOpen = await pageEval(wc, () => {
      const item = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"]')).find((el) =>
        dshShown(el) && /推理等级|^effort/i.test(dshLabel(el)));
      if (!item || item.disabled) return false;
      item.click();
      return true;
    });
    if (!effortOpen) return `effort pane missing before ${label}`;
    const clicked = await waitUntil(() => pageEval(wc, (want) => {
      const radio = Array.from(document.querySelectorAll('[role="menu"] [role="menuitemradio"]')).find((el) =>
        dshShown(el) && dshLabel(el).replace(/\s+/g, ' ').trim() === want);
      if (!radio || radio.disabled) return null;
      radio.click();
      return true;
    }, label), 6_000);
    if (!clicked) return `effort ${label} not clickable`;
    const selected = await waitUntil(() => pageEval(wc, (want) => {
      const trigger = composerModelTrigger();
      const aria = (trigger && trigger.getAttribute('aria-label')) || '';
      return aria.includes(want) ? true : null;
    }, label), 8_000);
    if (!selected) return `effort ${label} did not settle`;
    const pingText = `只回复一个词：ok（${label}）`;
    const typed = await typeIntoComposer(wc, pingText);
    if (!typed) return `composer rejected ping for ${label}`;
    let sent = await pageEval(wc, () => {
      const btn = dshComposerSend();
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    if (!sent) {
      await pressEnter(wc);
      sent = true;
    }
    const settled = await waitForComposerSubmission(wc, pingText);
    if (settled === 'engaged') {
      if (await waitForComposerIdle(wc, 20_000, pingText)) return '';
      // Still engaged (credential-less world sits in provider retries): stop
      // the turn so the next ping starts from an idle composer.
      await pageEval(wc, () => {
        const stop = dshFind('stop generating|停止生成|deep diving|深潜');
        if (stop && !stop.disabled) stop.click();
        return true;
      });
      const idleAfterStop = await waitForComposerIdle(wc, 10_000, pingText);
      return idleAfterStop ? '' : `composer did not become idle after stopping ${label}`;
    }
    return settled === 'idle' ? '' : `ping for ${label} had no accepted user echo and ready composer`;
  };

  const errors = [];
  for (const row of picked) {
    const error = await ping(row.label);
    if (error) errors.push(error);
  }
  await closeComposerModelMenu(wc, helpers.pressEscape);
  return {
    ok: errors.length === 0,
    detail: errors.length
      ? errors.join(' | ')
      : `switched ${picked.map((row) => row.label).join(' → ')}; accepted sends and idle verified; model inference unverified (MISSING_CREDENTIAL is not inference acceptance)`,
  };
}

function makeRecorder(steps) {
  return (name, ok, detail, optional = false) => {
    const row = {
      name,
      ok: Boolean(ok),
      detail: detail == null ? '' : String(detail).slice(0, 400),
    };
    if (optional) row.optional = true;
    steps.push(row);
    console.log(`[DSH_QA] ${ok ? 'PASS' : (optional ? 'SKIP' : 'FAIL')} ${name}${row.detail ? ` — ${row.detail}` : ''}`);
  };
}

/**
 * Connect the configured desktop workspace through the in-app directory picker.
 *
 * @param {Electron.WebContents} wc
 * @param {{ workspacePath: string, pressEscape: Function }} helpers
 * @param {(name: string, ok: boolean, detail?: string, optional?: boolean) => void} rec
 */
async function connectConfiguredWorkspace(wc, helpers, rec) {
  const workspacePath = helpers.workspacePath;
  rec('workspace.path', Boolean(workspacePath), workspacePath || 'missing', true);
  if (!workspacePath) {
    rec('workspace.connected', false, 'helpers.workspacePath missing');
    return false;
  }

  const clicked = await clickNamed(wc, '^add workspace$|^添加工作区$');
  rec('workspace.addClicked', Boolean(clicked), '', true);
  await sleep(300);
  await pageEval(wc, () => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) =>
      dshShown(el) && /add workspace|添加工作区/i.test(dshLabel(el)));
    if (!item) return false;
    item.click();
    return true;
  });

  const picker = await waitUntil(() => pageEval(wc, () =>
    Boolean(dshDialogNamed('select workspace directory|选择工作区目录'))), 10_000);
  rec('workspace.picker', Boolean(picker), picker ? '' : 'directory picker missing');
  if (!picker) {
    rec('workspace.connected', false, 'picker did not open');
    return false;
  }

  await clickNamed(wc, 'edit path|编辑路径');
  await sleep(250);
  const filled = await pageScript(wc, `
    const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
    if (!dialog) return false;
    const input = Array.from(dialog.querySelectorAll('input, textarea')).find(dshShown)
      || dshFind('edit path|编辑路径', dialog);
    if (!input) return false;
    input.focus();
    return dshSetValue(input, args.path);
  `, { path: workspacePath });
  if (!filled) {
    rec('workspace.connected', false, 'path editor missing');
    return false;
  }
  await pressEnter(wc);
  const openReady = await waitUntil(() => pageScript(wc, `
    const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
    if (!dialog) return null;
    const btn = Array.from(dialog.querySelectorAll('button')).find((el) =>
      dshShown(el) && /^(open|打开)$/i.test(dshLabel(el)) && !el.disabled);
    return btn || null;
  `), 12_000);
  if (openReady) {
    await pageScript(wc, `
      const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
      const btn = dialog && Array.from(dialog.querySelectorAll('button')).find((el) =>
        dshShown(el) && /^(open|打开)$/i.test(dshLabel(el)) && !el.disabled);
      if (!btn) return false;
      btn.click();
      return true;
    `);
  } else {
    // Fallback: confirm with Enter when Open stays disabled longer than expected.
    await pressEnter(wc);
  }
  let pickerClosed = await waitUntil(() => pageEval(wc, () =>
    !dshDialogNamed('select workspace directory|选择工作区目录')), 12_000);
  if (!pickerClosed) {
    await pressEnter(wc);
    pickerClosed = await waitUntil(() => pageEval(wc, () =>
      !dshDialogNamed('select workspace directory|选择工作区目录')), 8_000);
  }
  const connected = await waitUntil(() => pageEval(wc, () => dshComposerReady()), 15_000);
  if (connected && !pickerClosed) {
    // Workspace already unlocked; dismiss a stuck directory dialog so chrome is usable.
    await pageEval(wc, () => {
      const dialog = dshDialogNamed('select workspace directory|选择工作区目录');
      if (!dialog) return false;
      const close = Array.from(dialog.querySelectorAll('button')).find((el) =>
        dshShown(el) && /^(open|打开|cancel|取消|close|关闭)$/i.test(dshLabel(el)));
      if (close) {
        close.click();
        return true;
      }
      return false;
    });
    if (typeof helpers.pressEscape === 'function') {
      for (let i = 0; i < 4; i += 1) {
        await helpers.pressEscape(wc);
        await sleep(100);
      }
    }
    pickerClosed = await waitUntil(() => pageEval(wc, () =>
      !dshDialogNamed('select workspace directory|选择工作区目录')), 5_000);
  }
  rec('workspace.pickerClosed', Boolean(pickerClosed), pickerClosed ? '' : 'picker stayed open', true);
  rec(
    'workspace.connected',
    Boolean(connected),
    connected ? workspacePath : 'session still locked',
  );
  return Boolean(connected);
}

/**
 * Drive one assembled-desktop UI walk against a live harness webContents.
 * Callers must attach the CDP debugger when they need Escape via pressEscape.
 *
 * @param {Electron.WebContents} wc - harness page (BrowserView), not the boot shell.
 * @param {{ pressEscape: Function, clickTitlebarButton: Function, surfacesPattern: string, terminalPattern: string }} helpers
 * @returns {Promise<{ ok: boolean, steps: Array<{ name: string, ok: boolean, optional?: boolean, detail: string }> }>}
 */
async function runReleaseUiWalk(wc, helpers) {
  const steps = [];
  const rec = makeRecorder(steps);

  const dismiss = async () => {
    for (let i = 0; i < 4; i += 1) {
      await helpers.pressEscape(wc);
      await sleep(120);
    }
  };

  const openRightTab = async (kind) => {
    // DockKit's add control opens the native guide; its entries navigate the
    // actual Sidebar controller. The legacy dshd-open-surface event is dormant.
    const guide = await pageEval(wc, () => {
      const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
      if (!panel) return false;
      const existing = panel.querySelector('[data-sidebar-right-guide]');
      if (existing && dshShown(existing)) return true;
      const add = Array.from(panel.querySelectorAll('[data-dockkit-add-tab]'))
        .find((el) => dshShown(el) && !el.disabled);
      if (!add) return false;
      add.click();
      return true;
    });
    if (!guide) return false;
    const entry = await waitUntil(() => pageEval(wc, (wanted) => {
      const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
      const node = panel && panel.querySelector(`[data-sidebar-right-guide-entry="${wanted}"]`);
      if (!node || !dshShown(node)) return false;
      const trigger = node.matches('button') ? node : node.querySelector('button');
      if (!trigger || trigger.disabled) return false;
      trigger.click();
      return true;
    }, kind), 5_000);
    return Boolean(entry);
  };

  const openSettings = async (section) => {
    const opened = await wc.executeJavaScript(buildSettingsSectionScript(section));
    await sleep(400);
    return opened;
  };

  try {
  await dismiss();
  if (helpers.skipWorkspaceConnect) {
    rec('workspace.picker', true, 'connected before titlebar hits');
    rec('workspace.connected', true, helpers.workspacePath || '');
  } else {
    await connectConfiguredWorkspace(wc, helpers, rec);
  }
  await clickNewSession(wc);
  await pageEval(wc, () => {
    const btn = dshFind('stop generating|停止生成');
    if (btn && !btn.disabled) btn.click();
    return true;
  });
  await waitUntil(() => pageEval(wc, () => (
    dshComposerReady() && dshFind('send message|发送消息') ? true : null
  )), 12_000);

  const frame = await pageEval(wc, () => {
    const el = document.querySelector('[class*="frame"]');
    const grid = el ? getComputedStyle(el).gridTemplateColumns.trim() : '';
    return {
      present: Boolean(el),
      columns: grid ? grid.split(/\s+/).length : 0,
      grid,
      collapsed: el ? el.getAttribute('data-surfaces-collapsed') : null,
    };
  });
  rec('frame.fourColumn', frame?.columns === 4, frame?.grid || 'missing frame');

  const composer = await pageEval(wc, () => {
    const card = document.querySelector('[data-composer-card]');
    return {
      card: dshShown(card),
      textarea: Boolean(card && dshComposerReady()),
      commands: Boolean(dshFind('add files or run commands|添加文件或调用指令', card)),
      send: Boolean(dshFind('send message|发送消息')),
      access: Boolean(dshFind('access mode|访问模式')),
    };
  });
  rec('composer.card', composer?.card, '');
  rec('composer.textarea', composer?.textarea, '');
  rec('composer.commands', composer?.commands, '');
  rec('composer.send', composer?.send, composer?.send ? '' : 'no 发送消息 (likely 停止生成 leftover)');
  rec('composer.access', composer?.access, '');
  const heroLayout = await pageEval(wc, () => {
    const root = document.querySelector('[data-phase="hero"]');
    const seat = document.querySelector('[data-composer-seat]');
    if (!root) {
      return { phase: document.querySelector('[data-phase]')?.getAttribute('data-phase') || 'none' };
    }
    if (!seat) return { phase: 'hero', ok: false, detail: 'missing composer seat' };
    const column = root.getBoundingClientRect();
    const box = seat.getBoundingClientRect();
    const slack = Math.max(80, column.height * 0.22);
    const delta = Math.abs((box.top + box.bottom) / 2 - (column.top + column.bottom) / 2);
    return {
      phase: 'hero',
      ok: column.height > 240 && delta <= slack,
      colH: Math.round(column.height),
      seatTop: Math.round(box.top),
      delta: Math.round(delta),
      slack: Math.round(slack),
    };
  });
  rec(
    'composer.heroCentered',
    heroLayout.phase !== 'hero' || heroLayout.ok === true,
    heroLayout.phase === 'hero'
      ? `colH=${heroLayout.colH}; seatTop=${heroLayout.seatTop}; delta=${heroLayout.delta}; slack=${heroLayout.slack}`
      : `phase=${heroLayout.phase}`,
  );
  const thinking = await switchComposerThinking(wc, helpers);
  rec('composer.thinkingSwitch', thinking.ok, thinking.detail);
  // A sent ordinary session owns More actions. A fresh blank draft hides it.
  const sessionLog = await probeSessionLogMenu(wc);
  const sessionLogMenu = sessionLog.download;
  rec('titlebar.sessionLog', !sessionLog.extraShortcut && sessionLog.ordinary && sessionLogMenu,
    `ordinary=${sessionLog.ordinary} extraShortcut=${sessionLog.extraShortcut} menuDownload=${sessionLogMenu}`);
  await dismiss();
  await clickNewSession(wc);
  await waitUntil(() => pageEval(wc, () => (
    dshComposerReady() && dshFind('send message|发送消息') ? true : null
  )), 12_000);

  await typeIntoComposer(wc, '$fo');
  await sleep(500);
  const skillMenu = await pageEval(wc, () => ({
    foo: Boolean(dshFind('foo-skill')),
    menuitem: Boolean(document.querySelector('[role="menuitem"]') && dshShown(document.querySelector('[role="menuitem"]'))),
    typed: dshComposerText(),
  }));
  rec(
    'composer.skillMenuAbsent',
    !skillMenu?.foo && skillMenu?.typed === '$fo',
    skillMenu?.foo
      ? 'foo-skill menu opened'
      : `typed=${skillMenu?.typed || ''}; menuitem=${Boolean(skillMenu?.menuitem)}`,
  );

  await typeIntoComposer(wc, '@');
  await sleep(700);
  const pathSource = await pageEval(wc, () => ({
    pathRows: document.querySelectorAll('[data-source="path"]').length,
    typed: dshComposerText(),
  }));
  rec(
    'composer.pathSourceAbsent',
    pathSource?.pathRows === 0,
    pathSource?.pathRows
      ? `desktop path source rows=${pathSource.pathRows}`
      : `typed=${pathSource?.typed || ''}`,
  );
  await typeIntoComposer(wc, '');

  const remoteSnap = typeof helpers.probeRemote === 'function'
    ? await helpers.probeRemote()
    : null;
  rec(
    'remote.available',
    remoteSnap != null && remoteSnap.enabled === false && remoteSnap.listening !== true
      && (REMOTE_FEATURE_ENABLED ? remoteSnap.available === true : remoteSnap.available === false),
    remoteSnap ? summarizeRemoteQaDetail(remoteSnap) : 'helpers.probeRemote missing',
  );
  rec(
    'remote.notListening',
    remoteSnap != null && remoteSnap.listening !== true,
    remoteSnap ? `listening=${remoteSnap.listening}` : 'helpers.probeRemote missing',
  );
  const remoteEntry = await probeRemoteEntry(wc);
  rec(
    'remote.footerPresent',
    remoteEntry.ok,
    REMOTE_FEATURE_ENABLED ? remoteEntry.detail : `parked hidden; ${remoteEntry.detail}`,
  );
  await dismiss();

  const commandsClicked = await clickNamed(wc, 'add files or run commands|添加文件或调用指令');
  if (commandsClicked) {
    const menu = await waitUntil(() => pageEval(wc, () =>
      Boolean(document.querySelector('[role="listbox"], [role="menu"]'))), 3_000);
    rec('composer.commandsMenu', Boolean(menu), menu ? 'opened' : 'no menu', true);
    await dismiss();
  } else {
    rec('composer.commandsMenu', true, 'commands disabled or missing', true);
  }

  const titlebar = await pageEval(wc, () => {
    const bar = document.querySelector('#dshd-shell-titlebar-trailing');
    const labels = bar
      ? Array.from(bar.querySelectorAll('button')).map((el) => dshLabel(el)).filter(Boolean).slice(0, 12)
      : [];
    return {
      sessionLog: Boolean(bar && dshFind('session log|会话日志|Session 日志', bar)),
      labels,
      branch: Boolean(dshFind('switch branch|切换分支', bar)),
      git: Boolean(dshFind('git actions|git 操作', bar)),
      terminal: Boolean(dshFind('terminal|终端', bar)),
      surfaces: Boolean(dshFind('right panel|surfaces|右侧栏', bar)),
    };
  });
  rec('titlebar.branch', titlebar?.branch, '');
  rec('titlebar.git', titlebar?.git, '');
  rec('titlebar.terminal', titlebar?.terminal, '');
  rec('titlebar.surfaces', titlebar?.surfaces, '');
  const windowControls = await pageEval(wc, () => {
    const host = document.getElementById('dshd-shell-controls');
    if (!host) return null;
    return {
      min: Boolean(host.querySelector('[data-act="minimize"]')),
      max: Boolean(host.querySelector('[data-act="maximize"]')),
      close: Boolean(host.querySelector('[data-act="close"]')),
    };
  });
  rec(
    'titlebar.windowControls',
    Boolean(windowControls?.min && windowControls?.max && windowControls?.close),
    windowControls ? '' : 'injected window-control plate missing',
  );

  await helpers.clickTitlebarButton(wc, 'switch branch|切换分支');
  const branchMenu = await waitUntil(() => pageEval(wc, () => {
    const bar = document.querySelector('#dshd-shell-titlebar-trailing');
    const btn = bar && dshFind('switch branch|切换分支', bar);
    return Boolean((btn && btn.getAttribute('aria-expanded') === 'true') || document.querySelector('[role="menu"]'));
  }), 5_000);
  rec('titlebar.branchMenu', Boolean(branchMenu), branchMenu ? 'opened' : 'did not open');
  await dismiss();

  await helpers.clickTitlebarButton(wc, 'git actions|git 操作');
  const gitMenu = await waitUntil(() => pageEval(wc, () => Boolean(document.querySelector('[role="menu"]'))), 5_000);
  rec('titlebar.gitMenu', Boolean(gitMenu), gitMenu ? 'opened' : 'did not open');
  const gitCommit = gitMenu && await probeGitCommitMenu(wc);
  rec('titlebar.commit', Boolean(gitCommit?.present),
    gitCommit ? `Git menu Commit present; enabled=${gitCommit.enabled} (actual commit verified by git.commit)` : 'Git menu Commit missing');
  await dismiss();
  const drawerOpen = await pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
  });
  if (!drawerOpen) {
    await helpers.clickTitlebarButton(wc, helpers.terminalPattern);
  }
  const drawer = await waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-terminal-owner="drawer"]');
    if (!root || !dshShown(root) || root.getBoundingClientRect().height < 8) return null;
    return {
      newTerminal: Boolean(dshFind('new terminal|新建终端', root)),
    };
  }), 10_000, 200, (state) => state?.newTerminal);
  rec('terminal.drawer', Boolean(drawer), drawer ? '' : 'drawer did not open');
  rec('terminal.new', Boolean(drawer?.newTerminal), '');
  if (drawer) {
    await helpers.clickTitlebarButton(wc, helpers.terminalPattern);
    await sleep(250);
  }

  const rightbarOpen = await pageEval(wc, () => Boolean(
    document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]')));
  if (!rightbarOpen) {
    await helpers.clickTitlebarButton(wc, helpers.surfacesPattern);
  }
  const rightbar = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
    return panel && dshShown(panel) && panel.getBoundingClientRect().width > 8;
  }), 10_000);
  rec('rightbar.open', Boolean(rightbar), rightbar ? '' : 'native right Sidebar stayed collapsed');
  const legacy = await pageEval(wc, () => {
    const frame = document.querySelector('[data-surfaces-collapsed]');
    const column = frame && Array.from(frame.children).find((el) =>
      /surfacesCol/.test(el.className || ''));
    return {
      collapsed: Boolean(frame),
      width: column ? column.getBoundingClientRect().width : null,
      occupied: Boolean(document.querySelector('[data-surfaces-tab], [data-surfaces-empty]')),
    };
  });
  rec('rightbar.legacyDormant', Boolean(legacy?.collapsed && legacy?.width <= 1 && !legacy?.occupied),
    `legacy width=${legacy?.width ?? 'missing'} occupied=${legacy?.occupied}`);
  const filesOpened = await openRightTab('files');

  const files = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-files-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    const readme = /README\.md/i.test(text);
    const note = /note\.md/i.test(text);
    if (!readme && !note) return null;
    return {
      search: Boolean(dshFind('search files|搜索文件', panel)),
      readme,
      note,
      text: text.slice(0, 160),
    };
  }), 20_000, 200, (state) => state?.search && state?.readme && state?.note);
  const filesSnap = files || await pageEval(wc, () => {
    const panel = document.querySelector('[data-files-panel]');
    if (!panel) return null;
    const text = panel.innerText || '';
    return {
      search: Boolean(dshFind('search files|搜索文件', panel)),
      readme: /README\.md/i.test(text),
      note: /note\.md/i.test(text),
      text: text.slice(0, 160),
    };
  });
  rec('files.panel', Boolean(filesOpened && filesSnap), filesSnap ? '' : 'native Files tab missing');
  const tabClose = await pageEval(wc, () => {
    const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
    const tab = panel && Array.from(panel.querySelectorAll('[data-dockkit-tab]'))
      .find((el) => dshShown(el) && /files|文件/i.test(dshLabel(el)));
    if (!tab) return null;
    const close = tab.querySelector('[data-dockkit-tab-close]');
    if (!close) return null;
    const tabBox = tab.getBoundingClientRect();
    const closeBox = close.getBoundingClientRect();
    return {
      closeRight: closeBox.left >= tabBox.left + tabBox.width / 2,
      labelLeft: Math.round(tabBox.left),
      closeLeft: Math.round(closeBox.left),
    };
  });
  rec(
    'files.tabCloseRight',
    Boolean(tabClose?.closeRight),
    tabClose ? `label=${tabClose.labelLeft} close=${tabClose.closeLeft}` : 'tab close control missing',
  );
  rec('files.search', Boolean(filesSnap?.search), '');
  rec('files.readme', Boolean(filesSnap?.readme), filesSnap?.readme ? '' : (filesSnap?.text || 'README.md not listed'));
  rec('files.note', Boolean(filesSnap?.note), filesSnap?.note ? '' : (filesSnap?.text || 'note.md not listed'));
  const mention = filesSnap
    ? await waitUntil(() => pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      return panel && dshFind('mention in composer|引用到输入框', panel);
    }), 10_000)
    : null;
  rec('files.mentionVisible', Boolean(mention), mention ? 'visible' : 'mention control missing');
  if (mention) {
    await typeIntoComposer(wc, '');
    const clicked = await pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      if (!panel) return false;
      const row = Array.from(panel.querySelectorAll('li')).find((el) =>
        dshShown(el) && /note\.md/i.test((el.querySelector('span') && el.querySelector('span').textContent) || dshLabel(el)));
      const btn = row && dshFind('mention in composer|引用到输入框', row);
      if (!btn || btn.disabled) return false;
      btn.click();
      return true;
    });
    const draft = (clicked
      ? await waitUntil(() => pageEval(wc, () => {
        const value = dshComposerText();
        return /\[note\.md\]\(note\.md\)/.test(value) ? value : null;
      }), 8_000)
      : null) || await pageEval(wc, () => dshComposerText());
    rec(
      'files.mentionAppended',
      Boolean(clicked) && /\[note\.md\]\(note\.md\)/.test(String(draft || '')),
      draft || (clicked ? 'composer draft missing markdown link' : 'note.md mention click missed'),
    );
  } else {
    rec('files.mentionAppended', false, 'mention control missing');
  }

  await dismiss();
  dirtyQaNote(helpers.workspacePath);
  await waitUntil(() => gitPorcelain(helpers.workspacePath) || null, 8_000);
  const beforeSubject = gitHeadSubject(helpers.workspacePath);
  let commitDialog = null;
  for (let attempt = 0; attempt < 5 && !commitDialog; attempt += 1) {
    await helpers.clickTitlebarButton(wc, 'git actions|git 操作');
    await waitUntil(() => pageEval(wc, () => Boolean(document.querySelector('[role="menu"]'))), 3_000);
    await clickNamed(wc, '^commit$');
    commitDialog = await waitUntil(() => pageEval(wc, () => {
      const dialog = dshDialogNamed('commit changes|提交更改');
      if (!dialog || !dshShown(dialog)) return null;
      const note = Array.from(dialog.querySelectorAll('li')).some((el) => /note\.md/i.test(el.textContent || ''));
      if (!note) return null;
      return {
        message: Boolean(dialog.querySelector('textarea')),
        submit: Boolean(dshFind('^commit$|^提交$', dialog)),
        note,
      };
    }), 8_000, 200, (state) => state?.note && state?.message && state?.submit);
    if (!commitDialog) await dismiss();
  }
  rec('git.commitDialog', Boolean(commitDialog), commitDialog ? 'note.md listed' : 'commit dialog did not list note.md', true);
  const commitMessage = `qa: commit note.md ${Date.now()}`;
  if (commitDialog) {
    await pageScript(wc, `
      const dialog = dshDialogNamed('commit changes|提交更改');
      if (!dialog) return false;
      const edit = dshFind('^edit$|^编辑$', dialog);
      if (edit && !edit.disabled) edit.click();
      Array.from(dialog.querySelectorAll('input[type="checkbox"]')).forEach((input) => {
        const label = input.getAttribute('aria-label') || '';
        if (/^files$|^文件$/i.test(label)) return;
        const want = /note\\.md$/i.test(label);
        if (want !== input.checked) input.click();
      });
      return Boolean(dialog.querySelector('textarea'));
    `, {});
    await typeIntoDialogTextarea(wc, 'commit changes|提交更改', commitMessage);
    await clickNamed(wc, '^commit$|^提交$', '[role="dialog"]');
  }
  const committed = await waitUntil(() => {
    const subject = gitHeadSubject(helpers.workspacePath);
    return subject && subject !== beforeSubject ? subject : null;
  }, 20_000);
  rec('git.commit', Boolean(committed), committed || `HEAD still ${beforeSubject || 'empty'}`);
  await dismiss();

  if (filesSnap?.search) {
    await pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      const input = panel && (dshFind('search files|搜索文件', panel) || panel.querySelector('input'));
      if (!input) return false;
      input.focus();
      return dshSetValue(input, 'note');
    });
    const filtered = await waitUntil(() => pageEval(wc, () => {
      const panel = document.querySelector('[data-files-panel]');
      return Boolean(panel && /note\.md/i.test(panel.innerText || ''));
    }), 8_000);
    rec('files.searchFilter', Boolean(filtered), filtered ? 'note.md' : 'filter missed note.md', true);
  }

  await openRightTab('agents');
  const agents = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-agents-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    return { empty: /no agents yet|还没有子代理/i.test(text) };
  }), 10_000, 200, (state) => state?.empty);
  rec('agents.panel', Boolean(agents), '');
  rec('agents.empty', Boolean(agents?.empty), agents?.empty ? '' : 'empty copy missing');

  await openRightTab('diff');
  const diff = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-diff-panel]');
    if (!panel || !dshShown(panel)) return null;
    const text = panel.innerText || '';
    if (/差异仅适用于|only available in Git/i.test(text)) return null;
    return { text: text.slice(0, 120) };
  }), 12_000);
  const diffSnap = diff || await pageEval(wc, () => {
    const panel = document.querySelector('[data-diff-panel]');
    return panel && dshShown(panel) ? { text: (panel.innerText || '').slice(0, 120) } : null;
  });
  rec('diff.panel', Boolean(diffSnap) && !/差异仅适用于|only available in Git/i.test(diffSnap?.text || ''), diffSnap?.text || '');

  const browserOpened = await openRightTab('browser');
  const browser = await waitUntil(() => pageEval(wc, () => {
    const panel = document.querySelector('[data-preview-panel]');
    if (!panel || !dshShown(panel)) return null;
    const unavailable = panel.querySelector('[data-preview-unavailable]');
    const toolbar = panel.querySelector('[data-preview-toolbar]');
    const url = Boolean(
      dshFind('search or enter url|搜索或输入 url', panel)
      || panel.querySelector('input'),
    );
    return {
      unavailable: Boolean(unavailable && dshShown(unavailable)),
      toolbar: Boolean(toolbar && dshShown(toolbar)),
      url,
    };
  }), 10_000, 200, (state) => state?.unavailable || state?.url || state?.toolbar);
  const browserDiagnostic = !browser ? await pageEval(wc, () => {
    const panel = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]');
    return {
      guide: Array.from(panel?.querySelectorAll('[data-sidebar-right-guide-entry]') || [])
        .map((el) => el.getAttribute('data-sidebar-right-guide-entry')),
      tabs: Array.from(panel?.querySelectorAll('[data-dockkit-tab]') || [])
        .map((el) => dshLabel(el).slice(0, 35)),
    };
  }) : null;
  rec('browser.panel', Boolean(browserOpened && browser) && !browser.unavailable,
    browser?.unavailable ? 'preview unavailable' : `open=${browserOpened} ${JSON.stringify(browserDiagnostic || {})}`);
  rec('browser.url', Boolean(browser?.url || browser?.toolbar), '');

  const terminalOpened = await openRightTab('terminal');
  const termSurface = await waitUntil(() => pageEval(wc, () => {
    const root = document.querySelector('[data-sidebar-terminal]');
    return Boolean(root && dshShown(root) && root.getBoundingClientRect().height > 8);
  }), 10_000);
  rec('terminal.surface', Boolean(terminalOpened && termSurface),
    `open=${terminalOpened} body=${Boolean(termSurface)}`);

  await dismiss();
  const accountLauncher = await pageEval(wc, () => Boolean(dshFind('^account menu|^账号菜单')));
  rec('account.launcher', accountLauncher, accountLauncher ? '' : 'desktop account launcher missing');
  if (accountLauncher) await clickNamed(wc, '^account menu|^账号菜单');
  const accountMenu = accountLauncher ? await probeSignedOutAccountMenu(wc) : null;
  rec('account.signedOutMenu', Boolean(accountMenu?.signIn && accountMenu?.contact),
    accountMenu ? `signIn=${accountMenu.signIn} contact=${accountMenu.contact}` : 'account menu missing');
  await dismiss();
  const settingsTrigger = await pageEval(wc, () =>
    Boolean(document.querySelector('[data-dsh-settings-trigger]')));
  rec('settings.trigger', settingsTrigger, '');

  const appearanceOpened = await openSettings('appearance');
  const appearance = await probeAppearanceControls(wc);
  rec('appearance.choose', Boolean(appearanceOpened && appearance?.choose), appearanceOpened ? '' : 'settings did not open');
  rec('appearance.browse', Boolean(appearance?.browse), '');
  rec(
    'appearance.noSourceDump',
    Boolean(appearance) && !appearance.bingDaily && !appearance.catalogUrls && !appearance.placeholder,
    appearance?.bingDaily || appearance?.catalogUrls || appearance?.placeholder
      ? 'Appearance still lists gallery sources'
      : '',
  );

  const lightClicked = await clickNamed(wc, '^浅色$|^light$');
  await sleep(250);
  const darkClicked = await clickNamed(wc, '^深色$|^dark$');
  await sleep(250);
  const scheme = await pageEval(wc, () => {
    const dialog = dshDialog();
    const pressed = dialog
      ? Array.from(dialog.querySelectorAll('[aria-pressed="true"]')).map((el) => dshLabel(el)).slice(0, 4)
      : [];
    return { light: Boolean(dshFind('^浅色$|^light$', dialog)), dark: Boolean(dshFind('^深色$|^dark$', dialog)), pressed };
  });
  rec(
    'appearance.themeSwitch',
    Boolean(lightClicked && darkClicked && scheme?.dark),
    `light=${lightClicked}; dark=${darkClicked}; pressed=${(scheme?.pressed || []).join(',')}`,
  );

  const localPicked = await pageEval(wc, () => {
    const dialog = dshDialog();
    const input = dialog && dialog.querySelector('input[type="file"][accept*="image"]');
    if (!input) return false;
    return dshAssignFile(input, dshQaPngFile());
  });
  const cropOpened = localPicked
    ? await waitUntil(() => pageEval(wc, () => Boolean(dshDialogNamed('调整背景图|adjust wallpaper|crop wallpaper|crop'))), 8_000)
    : false;
  if (cropOpened) {
    await clickNamed(wc, '使用此图片|use this image|^use$');
  }
  const frostAfterLocal = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    return dialog && dshFind('毛玻璃|frosted glass', dialog) ? true : null;
  }), 8_000);
  rec(
    'appearance.localCrop',
    Boolean(localPicked && (cropOpened || frostAfterLocal)),
    localPicked ? (cropOpened ? 'crop confirmed' : (frostAfterLocal ? 'sliders without crop dialog' : 'file assigned, crop missing')) : 'file input missing',
  );

  if (appearance?.browse) {
    await clickNamed(wc, 'browse gallery|浏览图库');
  }
  const gallery = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    if (!galleryDialog) return null;
    return {
      sources: Boolean(dshFind('^sources$|^图源$', galleryDialog)),
      items: (galleryDialog.innerText || '').slice(0, 80),
    };
  }), 15_000, 200, (state) => state?.sources);
  rec('gallery.dialog', Boolean(gallery), gallery ? '' : 'browse gallery dialog missing');
  rec('gallery.sources', Boolean(gallery?.sources), gallery?.sources ? '' : 'Sources missing — wallpaper shell inject?');

  if (gallery?.sources) {
    await clickNamed(wc, '^sources$|^图源$');
    const sourcesPane = await waitUntil(() => pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      if (!galleryDialog) return null;
      return {
        addSource: Boolean(dshFind('add source|新增图源', galleryDialog)),
        hint: /Categories come from here|分类来自这里/i.test(galleryDialog.innerText || ''),
      };
    }), 8_000, 200, (state) => state?.addSource);
    rec('gallery.addSource', Boolean(sourcesPane?.addSource), sourcesPane?.hint ? 'hint visible' : '');
    await clickNamed(wc, 'back to gallery|返回图库');
    await sleep(300);
  } else {
    rec('gallery.addSource', false, 'sources control missing');
  }

  await clickNamed(wc, 'wallhaven|Wallhaven');
  const wallhaven = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    if (!galleryDialog) return null;
    const text = galleryDialog.innerText || '';
    return {
      tab: /wallhaven/i.test(text),
      sfw: Boolean(dshFind('常规|general', galleryDialog)),
      r18: /R18|NSFW|purity/i.test(text),
    };
  }), 8_000, 200, (state) => state?.tab || state?.sfw || state?.r18);
  rec(
    'gallery.wallhavenSfw',
    Boolean(wallhaven?.tab || wallhaven?.sfw) && !wallhaven?.r18,
    wallhaven?.r18 ? 'R18/NSFW copy present' : (wallhaven?.sfw ? 'SFW chips' : 'Wallhaven tab missing'),
  );

  await clickNamed(wc, '^必应$|^bing$');
  const thumbReady = await waitUntil(() => pageEval(wc, () => {
    const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
    const img = galleryDialog && galleryDialog.querySelector('img');
    const btn = img && img.closest('button');
    return btn && !btn.disabled && dshShown(btn) ? true : null;
  }), 35_000);
  if (thumbReady) {
    await pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      const star = galleryDialog && dshFind('收藏这张|favorite this image', galleryDialog);
      if (star) star.click();
      const card = galleryDialog && galleryDialog.querySelector('button img');
      const btn = card && card.closest('button');
      if (btn && !btn.disabled) btn.click();
      return Boolean(btn);
    });
    const confirm = await waitUntil(() => pageEval(wc, () =>
      Boolean(dshDialogNamed('将这张图设为背景|set this image as the wallpaper'))), 8_000);
    if (confirm) {
      await clickNamed(wc, '设为壁纸|set wallpaper');
    }
    const cropAfterGallery = await waitUntil(() => pageEval(wc, () =>
      Boolean(dshDialogNamed('调整背景图|adjust wallpaper|crop wallpaper|crop'))), 20_000);
    if (cropAfterGallery) {
      await clickNamed(wc, '使用此图片|use this image|^use$');
    }
    rec(
      'gallery.confirmSet',
      Boolean(confirm && (cropAfterGallery || frostAfterLocal)),
      confirm ? (cropAfterGallery ? 'Bing confirmed and cropped' : 'Bing confirmed') : 'confirm dialog missing',
    );
  } else {
    const status = await pageEval(wc, () => {
      const galleryDialog = dshDialogNamed('browse gallery|浏览图库');
      const node = galleryDialog && galleryDialog.querySelector('[role="status"]');
      return node ? String(node.textContent || '').slice(0, 120) : 'no status';
    });
    rec('gallery.confirmSet', false, `Bing thumbnails did not load (${status || 'empty'})`);
  }

  await dismiss();
  await sleep(400);
  await openSettings('appearance');
  const frost = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    return dialog && dshFind('毛玻璃|frosted glass', dialog) && dshFind('像素化|pixelation', dialog) ? true : null;
  }), 8_000);
  rec('appearance.frost', Boolean(frost || frostAfterLocal), frost ? 'frost+pixelate after wallpaper' : (frostAfterLocal ? 'frost after local crop' : 'sliders missing'));

  await dismiss();
  await sleep(300);

  const modelsOpened = await openSettings('models');
  const models = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialogNamed('^设置$|^settings$');
    const nav = document.querySelector('[data-dsh-settings-section="models"]');
    if (!dialog || nav?.getAttribute('aria-current') !== 'true') return null;
    const text = dialog.innerText || '';
    const customAdd = Boolean(dshFind('add model provider|添加模型提供商', dialog));
    if (!customAdd) return null;
    return {
      heading: Boolean(dshHeading('^models$|^模型$', dialog) || /模型|models/i.test(text)),
      customAdd,
      thinking: /supported thinking intensity|思考强度/i.test(text),
    };
  }), 10_000, 200, (state) => state?.heading && state?.customAdd);
  const vision = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    return Boolean(dialog && dshFind('vision model|识图模型', dialog));
  }), 10_000);
  rec('models.heading', Boolean(modelsOpened && models?.heading), modelsOpened ? '' : 'models section missing');
  rec('models.customAdd', Boolean(models?.customAdd), models?.customAdd ? '' : 'add model provider control missing');
  rec('models.visionPicker', Boolean(vision), vision ? '' : 'vision fallback picker missing');
  rec('models.thinking', Boolean(models?.thinking), models?.thinking ? '' : 'thinking intensity editor not shown', true);

  let customFormOk = false;
  if (models?.customAdd) {
    await clickNamed(wc, 'add model provider|添加模型提供商');
    const customMode = await waitUntil(() => pageEval(wc, () => {
      const dialog = dshDialog();
      const tab = dialog && Array.from(dialog.querySelectorAll('[role="tab"]'))
        .find((el) => dshShown(el) && /custom model api|自定义模型 api/i.test(dshLabel(el)));
      if (!tab || tab.disabled) return false;
      tab.click();
      return true;
    }), 8_000);
    const form = await waitUntil(() => pageEval(wc, () => {
      const dialog = dshDialog();
      const route = dialog && dshField('^provider id$', dialog);
      return route && dshShown(route) ? true : null;
    }), 8_000);
    if (form) {
      const filled = {
        route: await typeIntoAriaField(wc, '^provider id$', 'dshdqa'),
        name: await typeIntoAriaField(wc, '^显示名称$|^display name$', 'Dshd QA'),
        url: await typeIntoAriaField(wc, '^api 地址$|^base url$', 'https://ayase.cn/v1'),
        key: await typeIntoAriaField(wc, '^api 密钥$|^api key$', 'sk-dshd-qa-placeholder'),
      };
      await pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        const btn = card && dshFind('add model|添加模型', card);
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      });
      const modelField = await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        return card && dshField('^模型 ID 1$|^Model ID 1$', card) ? true : null;
      }), 8_000);
      const modelFilled = modelField
        ? await typeIntoAriaField(wc, '^模型 ID 1$|^Model ID 1$', 'grok-4.6')
        : false;
      const createReady = await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        const btn = card && dshFind('创建提供商|create provider', card);
        return btn && !btn.disabled ? true : null;
      }), 8_000);
      if (createReady) {
        await pageEval(wc, () => {
          const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
          const card = dialog && dshCustomProviderCard(dialog);
          const btn = card && dshFind('创建提供商|create provider', card);
          if (!btn || btn.disabled) return false;
          btn.click();
          return true;
        });
      }
      // Keep the original 12s save budget across closure, reopening and the
      // refreshed provider row. A draft field or a name elsewhere is not proof
      // that the profile and credential both survived the write.
      const saveDeadline = Date.now() + 12_000;
      const createClosed = createReady && await waitUntil(() => pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$');
        return dialog && !dshCustomProviderCard(dialog) ? true : null;
      }), Math.max(0, saveDeadline - Date.now()));
      if (createClosed) {
        await dismiss();
        await openSettings('models');
      }
      const saved = createClosed && await waitUntil(() => pageEval(wc, () => {
        const state = dshSavedCustomProvider('dshdqa', 'Dshd QA');
        return state?.leak || state?.configured ? state : null;
      }), Math.max(0, saveDeadline - Date.now()));
      customFormOk = Boolean(saved && !saved.leak && saved.listed && saved.configured);
      const inventory = customFormOk ? '' : await pageEval(wc, () => {
        const dialog = dshDialogNamed('^设置$|^settings$') || dshDialog();
        const card = dialog && dshCustomProviderCard(dialog);
        return JSON.stringify(dshInputInventory(card || dialog));
      });
      const providerState = customFormOk ? null : await pageEval(wc, () =>
        dshSavedCustomProvider('dshdqa', 'Dshd QA'));
      const providerDiagnostic = customFormOk ? '' : JSON.stringify(await pageEval(wc, () =>
        dshModelsDiagnostic('dshdqa', 'Dshd QA')));
      const fillDetail = `route=${filled?.route} name=${filled?.name} url=${filled?.url} key=${filled?.key} model=${Boolean(modelFilled)} createReady=${Boolean(createReady)} closed=${Boolean(createClosed)} listed=${Boolean(providerState?.listed)} configured=${Boolean(providerState?.configured)}`;
      rec(
        'models.customForm',
        customFormOk,
        saved?.leak ? 'key echoed' : (customFormOk ? 'provider saved without plaintext key' : `provider UI confirmation failed (${fillDetail}) ${providerDiagnostic} ${inventory || ''}`.slice(0, 400)),
      );
    } else {
      rec('models.customForm', false, `custom provider form did not open (mode=${Boolean(customMode)})`);
    }
  } else {
    rec('models.customForm', false, 'custom add missing');
  }

  const mcpOpened = await openSettings('mcp');
  const mcp = await waitUntil(() => pageEval(wc, () => {
    const state = dshMcpSnapshot();
    return state.active && state.heading && state.search && state.add ? state : null;
  }), 10_000);
  const mcpDetail = mcp ? '' : JSON.stringify(await pageEval(wc, () => dshMcpSnapshot()));
  rec('mcp.heading', Boolean(mcpOpened && mcp?.active && mcp?.heading), mcpDetail);
  rec('mcp.search', Boolean(mcp?.active && mcp?.search), mcpDetail);
  rec('mcp.add', Boolean(mcp?.active && mcp?.add), mcpDetail);

  const skillsOpened = await openSettings('skills');
  const skills = await waitUntil(() => pageEval(wc, () => {
    const state = dshSkillsSnapshot();
    return state.active && state.heading && state.add ? state : null;
  }), 10_000);
  const skillsDetail = skills ? '' : JSON.stringify(await pageEval(wc, () => dshSkillsSnapshot()));
  rec('skills.heading', Boolean(skillsOpened && skills?.active && skills?.heading), skillsDetail);
  rec('skills.add', Boolean(skills?.active && skills?.add), skillsDetail);

  const pluginsOpened = await openSettings('plugins');
  const plugins = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialogNamed('^设置$|^settings$');
    const nav = document.querySelector('[data-dsh-settings-section="plugins"]');
    return {
      nav: Boolean(nav && nav.getAttribute('aria-current') === 'true'),
      heading: Boolean(dialog && dshHeading('^plugins$|^插件$', dialog)),
    };
  }), 10_000, 200, (state) => state?.nav || state?.heading);
  rec('plugins.heading', Boolean(pluginsOpened && (plugins?.heading || plugins?.nav)), '');

  const marketOpened = await openSettings('market');
  const market = await waitUntil(() => pageEval(wc, () => {
    const nav = document.querySelector('[data-dsh-settings-section="market"]');
    const dialog = dshDialogNamed('^设置$|^settings$');
    const text = dialog ? (dialog.innerText || '') : '';
    return {
      nav: Boolean(dialog && nav?.getAttribute('aria-current') === 'true'),
      discover: /discover|发现/i.test(text),
    };
  }), 10_000, 200, (state) => state?.nav);
  rec('market.section', Boolean(marketOpened && market?.nav), marketOpened ? '' : 'market section missing');
  await clickNamed(wc, '^(discover|发现)$');
  const discover = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialog();
    const text = dialog ? (dialog.innerText || '') : '';
    const tab = dshFind('^(discover|发现)$', dialog);
    const selected = Boolean(tab && (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('aria-current') === 'true'));
    return /discover|发现/i.test(text) || selected ? { discover: true } : null;
  }), 10_000);
  rec('market.discover', Boolean(market?.discover || discover?.discover), '');

  // Installed plugin ownership comes from the profile, not a named bundled plugin.
  const { listInstalledPlugins } = require('./plugins');
  const profile = listInstalledPlugins();
  const names = (profile.plugins || []).map((row) => row.name);
  await clickNamed(wc, '^(installed|已安装)( \\(\\d+\\))?$');
  const installed = await waitUntil(() => pageEval(wc, (expectedNames) => {
    const dialog = dshDialog();
    if (!dialog) return null;
    const text = dialog.innerText || '';
    if (expectedNames.length > 0) {
      return expectedNames.every((name) => text.includes(name)) ? { ready: true } : null;
    }
    return /还没有装过社区插件|No community plugins yet/i.test(text) ? { ready: true } : null;
  }, names), 10_000);
  rec('market.installed', profile.ok && Boolean(installed), installed ? '' : 'Installed tab missing or incomplete');

  const usageOpened = await openSettings('usage-stats');
  const usage = await waitUntil(() => pageEval(wc, () => {
    const nav = document.querySelector('[data-dsh-settings-section="usage-stats"]');
    return {
      nav: Boolean(dshDialogNamed('^设置$|^settings$') && nav?.getAttribute('aria-current') === 'true'),
    };
  }), 10_000, 200, (state) => state?.nav);
  rec('usage-stats.section', Boolean(usageOpened && usage?.nav), usageOpened ? '' : 'usage-stats section missing');

  await dismiss();
  await sleep(300);

  // The source-QA fixture uses the desktop default (dshbotEnabled: false).
  // Prove that the Interface setting exposes the opt-in switch and that the
  // disabled plugin has not silently mounted a Bots sidebar tab.
  const interfaceOpened = await openSettings('interface');
  const botsSetting = await waitUntil(() => pageEval(wc, () => {
    const dialog = dshDialogNamed('^设置$|^settings$');
    const nav = document.querySelector('[data-dsh-settings-section="interface"]');
    const control = dialog && Array.from(dialog.querySelectorAll('[role="switch"]'))
      .find((el) => /(bots|机器人)/i.test(dshLabel(el)));
    if (!dialog || !nav || !control) return null;
    return {
      nav: Boolean(nav && nav.getAttribute('aria-current') === 'true'),
      switchPresent: Boolean(control && dshShown(control)),
      off: control?.getAttribute('aria-checked') === 'false',
      beta: Boolean(dialog && /测试中|beta/i.test(dialog.innerText || '')),
    };
  }), 10_000, 200, (state) => state?.nav && state?.switchPresent);
  rec('interface.dshbotSwitch', Boolean(interfaceOpened && botsSetting?.nav
    && botsSetting?.switchPresent && botsSetting?.off && botsSetting?.beta),
  `nav=${botsSetting?.nav} switch=${botsSetting?.switchPresent} off=${botsSetting?.off} beta=${botsSetting?.beta}`);

  // The single Session-menu entry no longer has an Interface visibility switch.
  const sessionLogSwitchRemoved = await pageEval(wc, () => {
    const dialog = dshDialog();
    const control = dialog && Array.from(dialog.querySelectorAll('[role="switch"]'))
      .find((el) => /(会话日志|session log)/i.test(dshLabel(el)));
    return Boolean(dialog && !control);
  });
  rec('interface.sessionLogMenu', Boolean(interfaceOpened && sessionLogSwitchRemoved && sessionLogMenu),
    `switchRemoved=${sessionLogSwitchRemoved} menuDownload=${sessionLogMenu}`);
  await dismiss();
  const botsTab = await pageEval(wc, () => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((el) =>
      dshShown(el) && /(bots|机器人)/i.test(dshLabel(el)));
    return Boolean(tab);
  });
  rec('plugin.dshbot.defaultOff', !botsTab, botsTab ? 'Bots tab mounted while default switch is off' : 'Bots tab absent');

  } catch (error) {
    rec('walk.uncaught', false, error && error.stack ? error.stack : String(error));
  }

  const failed = steps.filter((s) => !s.ok && !s.optional).map((s) => s.name);
  return {
    ok: failed.length === 0,
    failed,
    steps,
  };
}

/**
 * Fail a QA run when required assembled-UI steps did not pass.
 *
 * @param {{ qa?: { ok?: boolean, failed?: string[], steps?: Array<{ name: string, ok: boolean, optional?: boolean, detail?: string }> } }} result
 */
function assertReleaseQaResult(result) {
  const qa = result?.qa;
  if (!qa || qa.ok !== true) {
    const failed = (qa?.failed && qa.failed.length > 0)
      ? qa.failed
      : (qa?.steps || []).filter((s) => !s.ok && !s.optional).map((s) => `${s.name}: ${s.detail || ''}`);
    throw new Error(`Release QA failed:\n${failed.join('\n')}\n${JSON.stringify(qa)}`);
  }
  const names = new Set((qa.steps || []).map((s) => s.name));
  const missing = QA_REQUIRED_STEPS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Release QA omitted required steps: ${missing.join(', ')}`);
  }
}

module.exports = {
  runReleaseUiWalk,
  connectConfiguredWorkspace,
  makeRecorder,
  assertReleaseQaResult,
  QA_REQUIRED_STEPS,
  PAGE_HELPERS,
  summarizeRemoteQaDetail,
  typeIntoComposer,
  clickNewSession,
  waitForComposerIdle,
  waitForComposerSubmission,
  probeSessionLogMenu,
  probeGitCommitMenu,
  probeRemoteEntry,
  probeSignedOutAccountMenu,
  probeAppearanceControls,
};
