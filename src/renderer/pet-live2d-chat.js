'use strict';

let chatOpen = false;
let chatBusy = false;
/** @type {{ x: number, y: number, w: number, h: number } | null} */
let chatRect = null; // { x, y, w, h } — joins petBounds so the card takes clicks
let chatPickerRect = null; // floating menu joins the interactive area only while open
/** @type {{ x: number, y: number, w: number, h: number } | null} */
let chatFeedbackRect = null;
const chatFeedbackEl = document.getElementById('pc-feedback');
let lastChatFeedbackText = '';
/** @type {ReturnType<typeof setTimeout> | 0} */
let chatFeedbackTimer = 0;
const CHAT_FEEDBACK_HOLD_MS = 6000;

function closeChatFeedback() {
  if (chatFeedbackTimer) {
    petLifetime.clearTimeout(chatFeedbackTimer);
    chatFeedbackTimer = 0;
  }
  if (!chatFeedbackEl || (chatFeedbackEl.hidden && chatFeedbackRect === null)) return;
  chatFeedbackEl.hidden = true;
  chatFeedbackRect = null;
  requestFrame();
}

/** @param {string} text */
function showChatFeedback(text) {
  lastChatFeedbackText = text;
  const feedbackTextEl = document.getElementById('pc-feedback-text');
  if (feedbackTextEl) feedbackTextEl.textContent = text;
  if (!chatFeedbackEl) return;
  chatFeedbackEl.hidden = false;
  syncChatFeedbackPos();
  setInteractive(true);
  if (chatFeedbackTimer) {
    petLifetime.clearTimeout(chatFeedbackTimer);
  }
  chatFeedbackTimer = petLifetime.timeout(closeChatFeedback, CHAT_FEEDBACK_HOLD_MS);
  requestFrame();
}

function syncChatFeedbackPos() {
  if (!chatFeedbackEl || chatFeedbackEl.hidden) return;
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const w = chatFeedbackEl.offsetWidth;
  const h = chatFeedbackEl.offsetHeight;
  const anchor = chatRect || chatAnchor(petBodyBounds(), host, w, h);
  const x = Math.min(Math.max(anchor.x, host.x + 4), host.x + host.width - w - 4);
  let y = anchor.y - h - 8;
  if (y < (host.y || 0) + 4) y = anchor.y + anchor.h + 8;
  y = Math.min(Math.max(y, (host.y || 0) + 4), (host.y || 0) + host.height - h - 4);
  chatFeedbackRect = { x, y, w, h };
  chatFeedbackEl.style.left = x + 'px';
  chatFeedbackEl.style.top = y + 'px';
}
const chatLog = []; // { role: 'user'|'her'|'err', text }
let chatTypingEl = null;
const CHAT_LOG_MAX = 30;
// Shared-session mode: when the whale assistant is enabled the card talks
// to her persistent session, so its model picker IS the session selection
// and the thread backfills from the real conversation log.
let chatShared = false;
let chatGroups = [];    // [{id,name,models:[{id,name,efforts,defaultEffort}]}]
let chatFlatModels = [];// [{provider,model,efforts,defaultEffort}]
let chatServerSeq = 0;  // max event seq last synced from the shared log
let chatSelKey = '';    // serialized [groups, selected] — rebuild selects only on change
let chatPollTimer = 0;
let chatPickerOpen = ''; // 'root' | 'model' | 'effort' — portaled menu pane
let chatPickPending = false;

function chatPart(sel) {
  return chatDom ? chatDom.querySelector(sel) : null;
}

// Anchor above her head like the bubble; flip below when there is no room
// up top. The card must never sit ON her: when the host is too short to
// clear her either way, pick the side that leaves more of her uncovered.
// Pure math (testable); the DOM read/write lives in syncChatPos.
function chatAnchor(b, host, w, h) {
  const hostY = host.y ?? 0;
  const hostB = hostY + host.height;
  const cx = (b.x + b.right) / 2;
  const x = Math.min(Math.max(cx - w / 2, host.x + 4), host.x + host.width - w - 4);
  let y = b.y - h - 8;
  if (y < hostY + 4) {
    y = Math.min(b.bottom + 8, hostB - h - 4);
    if (y < b.bottom && hostB - b.bottom < b.y - hostY) {
      y = hostY + 4;
    }
  }
  y = Math.min(Math.max(y, hostY + 4), Math.max(hostY + 4, hostB - h - 4));
  return { x: Math.round(x), y: Math.round(y), w, h };
}

// Card size comes from layout each call — the thread grows as they talk.
function syncChatPos() {
  if (!chatOpen || !chatEl || typeof chatEl.offsetWidth !== 'number') {
    return;
  }
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const w = chatEl.offsetWidth || 248;
  const h = chatEl.offsetHeight || 120;
  const next = chatAnchor(petBodyBounds(), host, w, h);
  const nx = next.x;
  const ny = next.y;
  if (!chatRect || chatRect.x !== nx || chatRect.y !== ny || chatRect.h !== h) {
    chatRect = { x: nx, y: ny, w, h };
    chatEl.style.left = `${nx}px`;
    chatEl.style.top = `${ny}px`;
  }
  syncChatPickerPos();
  syncChatFeedbackPos();
}

function chatScrollDown() {
  const thread = chatPart('#pc-thread');
  if (thread) { thread.scrollTop = thread.scrollHeight; }
}

function chatRenderEmpty() {
  const thread = chatPart('#pc-thread');
  if (!thread) { return; }
  const empty = chatPart('#pc-empty');
  if (empty) { empty.hidden = chatLog.some((entry) => entry.role !== 'err'); }
}

// She texts like a person — one reply can arrive as several short
// messages, split on blank lines. The log entry stays whole; only the
// rendering splits.
function chatSegments(role, text) {
  if (role !== 'her') { return [String(text)]; }
  const parts = String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [String(text)];
}
function chatAppend(role, text) {
  chatLog.push({ role, text });
  if (chatLog.length > CHAT_LOG_MAX) { chatLog.shift(); }
  if (role === 'err') { showChatFeedback(text); return; }
  const thread = chatPart('#pc-thread');
  if (!thread) { return; }
  for (const part of chatSegments(role, text)) {
    const node = document.createElement('div');
    node.className = `pc-msg pc-${role}`;
    node.textContent = part;
    thread.appendChild(node);
  }
  chatRenderEmpty();
  chatScrollDown();
}

// A sticker while the card is open lands inside the thread like any of her
// replies — the ambient bubble stays the closed-card surface.
function chatAppendImage(src, alt) {
  chatLog.push({ role: 'her', text: alt || '[表情包]' });
  if (chatLog.length > CHAT_LOG_MAX) { chatLog.shift(); }
  const thread = chatPart('#pc-thread');
  if (thread) {
    const node = document.createElement('div');
    node.className = 'pc-msg pc-her';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '表情包';
    img.className = 'pc-sticker';
    node.appendChild(img);
    thread.appendChild(node);
  }
  chatRenderEmpty();
  chatScrollDown();
}

function chatSetBusy(next) {
  chatBusy = next;
  const send = chatPart('#pc-send');
  if (send) {
    send.disabled = next || !(chatPart('#pc-input')?.value || '').trim();
    send.setAttribute('aria-busy', next ? 'true' : 'false');
    send.setAttribute('aria-label', next ? '正在发送…' : '发送');
  }
  if (!next && chatTypingEl) {
    chatTypingEl.remove?.();
    chatTypingEl = null;
  }
}

function chatFocusWindow(on) {
  void Promise.resolve(petShell.chatFocus?.({ focus: on })).catch(() => { /* Focus telemetry may race overlay closure; the next focus event reconciles it. */ });
}

// Rebuild the thread from the shared session tail (poll/backfill path).
// chatServerCount only moves forward — a shorter list (fresh session,
// transient error rows) never wipes what the user just typed.
function chatRenderHistory(list) {
  chatLog.length = 0;
  for (const m of list) {
    chatLog.push({ role: m.role === 'her' || m.role === 'err' ? m.role : 'user', text: String(m.text || '') });
  }
  const thread = chatPart('#pc-thread');
  if (!thread || typeof thread.querySelectorAll !== 'function') { return; }
  chatTypingEl?.remove?.();
  chatTypingEl = null;
  for (const node of thread.querySelectorAll('.pc-msg')) { node.remove?.(); }
  for (const m of chatLog) {
    if (m.role === 'err') continue;
    for (const part of chatSegments(m.role, m.text)) {
      const node = document.createElement('div');
      node.className = `pc-msg pc-${m.role}`;
      node.textContent = part;
      thread.appendChild(node);
    }
  }
  const last = chatLog[chatLog.length - 1];
  if (last?.role === 'err' && last.text !== lastChatFeedbackText) showChatFeedback(last.text);
  const empty = chatPart('#pc-empty');
  if (empty) { empty.hidden = chatLog.some((entry) => entry.role !== 'err'); }
  chatScrollDown();
}

const CHAT_EFFORT_NAMES = {
  off: '关闭', minimal: '最低', low: '低', medium: '中',
  high: '高', xhigh: '极高', max: '最大',
};
function chatEffortName(entry) {
  return CHAT_EFFORT_NAMES[entry?.id] || entry?.name || entry?.id || '';
}

// Hidden selects retain the catalog's exact ids. The visible triggers show
// a readable value and expose the full choice to hover and assistive tech.
function chatSyncPickTitle(sel) {
  if (!sel) { return; }
  const option = sel.selectedOptions?.[0];
  if (sel.id === 'pc-model') {
    const trigger = chatPart('#pc-model-trigger');
    if (!trigger) { return; }
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel.value);
    const group = chatGroups.find((g) => g.id === m?.provider);
    const label = option?.textContent || m?.model || '选择模型';
    trigger.querySelector('.pc-choice-value').textContent = label;
    trigger.title = group ? `${group.name || group.id} · ${label}` : label;
    trigger.setAttribute('aria-label', `选择模型，当前${trigger.title}`);
  } else if (sel.id === 'pc-effort') {
    const trigger = chatPart('#pc-model-trigger');
    if (!trigger) { return; }
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === chatPart('#pc-model')?.value);
    const effort = m?.efforts?.find((e) => e.id === sel.value);
    const label = chatEffortName(effort) || '选择档位';
    const caption = trigger.querySelector('.pc-choice-effort');
    caption.textContent = label;
    caption.hidden = false;
    trigger.title = `${chatPart('#pc-model')?.selectedOptions?.[0]?.textContent || '模型'} · ${label}`;
    trigger.setAttribute('aria-label', `选择模型与思考，当前${trigger.title}`);
  }
}

function syncChatPickerPos() {
  if (!chatPickerOpen || !chatPickerEl || chatPickerEl.hidden) { chatPickerRect = null; return; }
  const trigger = chatPart('#pc-model-trigger');
  if (!trigger) { return; }
  const anchor = trigger.getBoundingClientRect();
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const width = chatPickerEl.offsetWidth;
  const height = chatPickerEl.offsetHeight;
  const left = Math.round(Math.min(Math.max(anchor.right - width, host.x + 4), host.x + host.width - width - 4));
  const above = anchor.top - height - 8;
  const top = Math.round(Math.min(Math.max(above, host.y + 4), host.y + host.height - height - 4));
  chatPickerEl.style.left = `${left}px`;
  chatPickerEl.style.top = `${top}px`;
  chatPickerRect = { x: left, y: top, w: width, h: height };
}

// Effort options follow the picked model; the whole side cell hides when
// the model has none so the name keeps the full bar.
function chatRenderEfforts(prefer) {
  const sel = chatPart('#pc-model');
  const effSel = chatPart('#pc-effort');
  const effBox = chatPart('#pc-effort-box');
  if (!sel || !effSel) { return; }
  const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel.value);
  const efforts = m?.efforts || [];
  if (!efforts.length) {
    if (effBox) { effBox.hidden = true; }
    const caption = chatPart('#pc-model-trigger .pc-choice-effort');
    if (caption) { caption.hidden = true; caption.textContent = ''; }
    if (chatPickerOpen === 'effort') { chatClosePicker(); }
    mountNodes(effSel);
    chatSyncPickTitle(sel);
    return;
  }
  mountNodes(effSel, ...efforts.map((e) => h('option', { value: e.id }, e.name)));
  if (effBox) { effBox.hidden = false; }
  if (prefer && efforts.some((e) => e.id === prefer)) {
    effSel.value = prefer;
  } else if (m.defaultEffort) {
    effSel.value = m.defaultEffort;
  }
  chatSyncPickTitle(effSel);
}

function chatRenderModels(selected) {
  const sel = chatPart('#pc-model');
  if (!sel) { return; }
  chatFlatModels = [];
  mountNodes(sel, ...chatGroups.map((g) => h('optgroup', { label: g.name || g.id },
    ...(g.models || []).map((m) => {
      chatFlatModels.push({
        provider: g.id, model: m.id,
        efforts: m.efforts || [], defaultEffort: m.defaultEffort || '',
      });
      return h('option', { value: `${g.id}::${m.id}` }, m.name || m.id);
    }))));
  if (selected?.provider && selected?.model) {
    sel.value = `${selected.provider}::${selected.model}`;
  }
  chatSyncPickTitle(sel);
  chatRenderEfforts(selected?.reasoningEffort || '');
}

function chatClosePicker(restoreFocus = false) {
  chatPickerOpen = '';
  const picker = chatPickerEl;
  if (picker) { picker.hidden = true; mountNodes(picker); }
  chatPickerRect = null;
  chatPart('#pc-model-trigger')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) { chatPart('#pc-model-trigger')?.focus?.(); }
}

function chatShowPicker(kind) {
  const picker = chatPickerEl;
  if (!picker) { return; }
  const selected = chatPart(kind === 'model' ? '#pc-model' : '#pc-effort')?.value;
  if (kind === 'root') {
    const model = chatPart('#pc-model')?.selectedOptions?.[0]?.textContent || '选择模型';
    const effort = chatPart('#pc-model-trigger .pc-choice-effort')?.textContent || '';
    mountNodes(picker,
      h('button', { class: 'pc-option', type: 'button', dataset: { pane: 'model' }, role: 'menuitem' },
        h('span', { class: 'pc-option-name' }, '模型'),
        h('span', { class: 'pc-option-detail' }, model),
        h('span', { 'aria-hidden': 'true' }, '›')),
      chatPart('#pc-effort-box')?.hidden ? null : h('button', {
        class: 'pc-option', type: 'button', dataset: { pane: 'effort' }, role: 'menuitem',
      },
        h('span', { class: 'pc-option-name' }, '思考'),
        h('span', { class: 'pc-option-detail' }, effort),
        h('span', { 'aria-hidden': 'true' }, '›')));
  } else if (kind === 'model') {
    mountNodes(picker,
      h('button', { class: 'pc-option', type: 'button', dataset: { pane: 'root' }, role: 'menuitem' },
        h('span', { 'aria-hidden': 'true' }, '‹'),
        h('span', { class: 'pc-option-name' }, '模型')),
      ...chatGroups.flatMap((group) => [
        h('div', { class: 'pc-picker-group' }, group.name || group.id),
        ...(group.models || []).map((m) => {
          const value = `${group.id}::${m.id}`;
          const picked = value === selected;
          return h('button', {
            class: 'pc-option', type: 'button', role: 'menuitemradio',
            dataset: { value }, 'aria-checked': String(picked),
          },
            h('span', { class: 'pc-option-name' }, m.name || m.id),
            picked ? h('span', { class: 'pc-option-check', 'aria-hidden': 'true' }, '✓') : null);
        }),
      ]));
  } else {
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === chatPart('#pc-model')?.value);
    mountNodes(picker,
      h('button', { class: 'pc-option', type: 'button', dataset: { pane: 'root' }, role: 'menuitem' },
        h('span', { 'aria-hidden': 'true' }, '‹'),
        h('span', { class: 'pc-option-name' }, '思考')),
      ...(m?.efforts || []).map((e) => {
        const picked = e.id === selected;
        return h('button', {
          class: 'pc-option', type: 'button', role: 'menuitemradio',
          dataset: { value: e.id }, 'aria-checked': String(picked),
        },
          h('span', { class: 'pc-option-name' }, chatEffortName(e)),
          picked ? h('span', { class: 'pc-option-check', 'aria-hidden': 'true' }, '✓') : null);
      }));
  }
  chatPickerOpen = kind;
  picker.hidden = false;
  chatPart('#pc-model-trigger')?.setAttribute('aria-expanded', 'true');
  syncChatPickerPos();
  const focusRow = picker.querySelector('[aria-checked="true"]') || picker.querySelector('.pc-option');
  focusRow?.scrollIntoView?.({ block: 'nearest' });
  focusRow?.focus?.();
}

function chatTogglePicker() {
  if (chatPickerOpen) { chatClosePicker(true); }
  else { chatShowPicker('root'); }
}

// Card chrome + shared-log sync: model selects, jump button, her display
// name, and the merged thread. Polled while the card is open so messages
// sent from the DSHD side show up here too (互通).
