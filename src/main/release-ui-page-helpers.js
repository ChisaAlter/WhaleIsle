'use strict';
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

module.exports = { PAGE_HELPERS };
