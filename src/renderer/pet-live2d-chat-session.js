'use strict';

let chatServerSession = '';
let chatCatalogAt = 0;
let chatCatalogLoaded = false;
let chatHistoryPending = null;
let chatCatalogPending = null;
let chatCatalogForceQueued = false;
let chatSelected = null;

function chatRefreshState(forceCatalog = false) {
  const history = chatRefreshHistory();
  if (!forceCatalog && chatCatalogLoaded && Date.now() - chatCatalogAt < 60000) {
    return history;
  }
  // Resolve the session identity first, then fetch its catalog. A slow
  // catalog must not hold the next three-second history refresh hostage.
  return history.then(() => chatRefreshCatalog(forceCatalog));
}

function chatRefreshHistory() {
  if (chatHistoryPending) { return chatHistoryPending; }
  chatHistoryPending = chatRefreshStateOnce().finally(() => { chatHistoryPending = null; });
  return chatHistoryPending;
}

function chatRefreshCatalog(force) {
  if (chatCatalogPending) {
    if (!force) { return chatCatalogPending; }
    chatCatalogForceQueued = true;
    return chatCatalogPending.then(() => chatCatalogPending);
  }
  const request = Promise.resolve().then(() => petShell.chatState?.({ includeCatalog: true }))
    .catch(() => null).then((st) => {
      if (!st || st.ok !== true || !Array.isArray(st.groups)) { return; }
      if (st.sessionId && chatServerSession && String(st.sessionId) !== chatServerSession) { return; }
      chatGroups = st.groups;
      chatCatalogAt = Date.now();
      chatCatalogLoaded = true;
      const selKey = JSON.stringify([chatGroups, chatSelected]);
      if (selKey !== chatSelKey && !chatPickerOpen && !chatPickPending) {
        chatSelKey = selKey;
        chatRenderModels(chatSelected);
      }
    });
  chatCatalogPending = request.finally(() => {
    chatCatalogPending = null;
    if (chatCatalogForceQueued) {
      chatCatalogForceQueued = false;
      void chatRefreshCatalog(true);
    }
  });
  return chatCatalogPending;
}

async function chatRefreshStateOnce() {
  const st = await Promise.resolve().then(() => petShell.chatState?.({ includeCatalog: false })).catch(() => null);
  if (!st || st.ok !== true) { return; }
  // A recreated assistant session starts a new log — drop the stale sync
  // watermark so the short fresh tail still repaints.
  const sid = String(st.sessionId || '');
  if (sid && sid !== chatServerSession) {
    chatServerSession = sid;
    chatServerSeq = 0;
    chatSelKey = '';
    chatCatalogLoaded = false;
    chatCatalogAt = 0;
  }
  chatShared = st.enabled === true;
  const modelsEl = chatPart('#pc-models');
  const openBtn = chatPart('#pc-open');
  if (modelsEl) { modelsEl.hidden = !chatShared; }
  if (openBtn) { openBtn.hidden = !chatShared; }
  const nameEl = chatPart('.pc-name');
  if (nameEl && st.name) { nameEl.textContent = st.name; }
  if (!chatShared) { chatClosePicker(); return; }
  chatSelected = st.selected ?? null;
  // Rebuild the selects only when the catalog/selection actually changed —
  // a poll must never clobber an open dropdown or an in-flight pick.
  const selKey = JSON.stringify([chatGroups, chatSelected]);
  if (selKey !== chatSelKey && !chatPickerOpen && !chatPickPending) {
    chatSelKey = selKey;
    chatRenderModels(chatSelected);
  }
  // Watermark on max event seq, not row count — the server tail is capped,
  // so a full tail keeps the same length while new rows rotate through.
  if (Array.isArray(st.history) && st.history.length) {
    const maxSeq = st.history.reduce((m, r) => Math.max(m, Number(r?.seq) || 0), 0);
    if (maxSeq > chatServerSeq) {
      chatServerSeq = maxSeq;
      chatRenderHistory(st.history);
    }
  }
}

function chatStartPoll() {
  chatStopPoll();
  chatPollTimer = petLifetime.interval(() => {
    if (chatOpen && chatShared) { void chatRefreshState(); }
  }, 3000);
}

function chatStopPoll() {
  if (chatPollTimer) { petLifetime.clearInterval(chatPollTimer); chatPollTimer = 0; }
}

function chatSubmitModelChoice() {
  const sel = chatPart('#pc-model');
  const effSel = chatPart('#pc-effort');
  const effBox = chatPart('#pc-effort-box');
  const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel?.value);
  if (!m) { return; }
  const effort = effSel && effBox && !effBox.hidden ? String(effSel.value || '') : '';
  chatPickPending = true;
  const trigger = chatPart('#pc-model-trigger');
  trigger.disabled = true;
  trigger.setAttribute('aria-busy', 'true');
  void Promise.resolve(petShell.chatSelectModel?.({
    provider: m.provider, model: m.model, reasoningEffort: effort,
  })).then((result) => {
    if (result?.ok === false) { chatAppend('err', '模型切换没有成功'); }
  }).catch(() => {
    chatAppend('err', '模型切换没有成功');
  }).finally(() => {
    chatPickPending = false;
    trigger.disabled = false;
    trigger.removeAttribute('aria-busy');
    if (chatOpen) { void chatRefreshState(); }
  });
}

function toggleChat(force) {
  const next = force !== undefined ? Boolean(force) : !chatOpen;
  if (next === chatOpen) { return; }
  if (next && (!chatEl || !chatDom || !settings.chatEnabled)) {
    say('chatFallback');
    return;
  }
  chatOpen = next;
  if (chatOpen) {
    chatEl.hidden = false;
    dropAmbientBubbles();
    chatRenderEmpty();
    syncChatPos();
    setInteractive(true); // the card joins petBounds, but pin it explicitly
    chatFocusWindow(chatOpen);
    // Focus lands once the window actually takes OS focus.
    petLifetime.timeout(() => chatPart('#pc-input')?.focus?.(), 60);
    void chatRefreshState(true);
    chatStartPoll();
  } else {
    chatClosePicker();
    chatEl.hidden = true;
    closeChatFeedback();
    chatRect = null;
    chatFocusWindow(chatOpen);
    chatStopPoll();
  }
  requestFrame();
}

// Renderer-side submit: thread echo + her reply inline, bubble stays the
// ambient copy so a closed card still shows the answer.
async function submitChat(text) {
  const t = String(text || '').trim();
  if (!t || chatBusy) { return; }
  if (t.length > 2000) {
    chatAppend('err', '最多发送 2000 字，请缩短后再发送');
    return;
  }
  const input = chatPart('#pc-input');
  if (!settings.chatEnabled) {
    say('chatFallback');
    return;
  }
  chatAppend('user', t);
  if (input) { input.value = ''; chatAutosize(); }
  chatSetBusy(true);
  try {
    const res = await Promise.resolve(petShell.chat?.({ text: t }));
    chatSetBusy(false);
    if (res && res.ok && typeof res.reply === 'string' && res.reply) {
      // Shared mode: the reply already lives in the session log — pull it
      // via state so the card can't double-render it when the 3s poll
      // catches up. Only append when the tail hasn't published it yet.
      let shown = false;
      if (chatShared) {
        await Promise.resolve(chatRefreshState()).catch(() => {});
        const last = chatLog[chatLog.length - 1];
        shown = last?.role === 'her' && last.text.slice(0, 60) === res.reply.slice(0, 60);
      }
      if (!shown) { chatAppend('her', res.reply); }
      pushBubble({ text: res.reply.slice(0, 120), until: performance.now() + 6000, priority: 1 });
      return;
    }
    if (res?.ok === true && res.via === 'whale') {
      // A completed tool-only turn can legitimately have no closing prose.
      if (chatShared) await Promise.resolve(chatRefreshState()).catch(() => {});
      return;
    }
    // Whale-path failures already get a precise error row — a random quip
    // on top would only muddy it.
    if (res?.via === 'whale') {
      if (chatShared) await Promise.resolve(chatRefreshState()).catch(() => {});
      const replyShown = res.reply && chatLog.slice(-2).some((row) => row.role === 'her'
        && row.text.slice(0, 60) === res.reply.slice(0, 60));
      if (res.reply && !replyShown) chatAppend('her', res.reply);
      if (chatLog[chatLog.length - 1]?.role !== 'err') {
        const status = res.reason === 'turn-aborted' ? '这轮已中止'
          : res.reason === 'timeout' ? '等待回复超时' : '这轮没有完成';
        chatAppend('err', `${status}——点 ↗ 去会话里看详情`);
      }
      return;
    }
    chatAppend('err', '没连上——稍后再试试');
  } catch (_) {
    chatSetBusy(false);
    chatAppend('err', '没连上——稍后再试试');
  }
  say('chatFallback');
}

// Textarea grows to three lines then scrolls; send key is plain Enter.
function chatAutosize() {
  const input = chatPart('#pc-input');
  if (!input) { return; }
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 66)}px`;
  syncChatPos();
}

function bindChatDom() {
  if (!chatDom) { return; }
  const input = chatPart('#pc-input');
  petLifetime.listen(chatPart('#pc-close'), 'click', () => toggleChat(false));
  petLifetime.listen(chatPart('#pc-send'), 'click', () => {
    void submitChat(input?.value);
  });
  petLifetime.listen(input, 'input', () => {
    chatAutosize();
    const send = chatPart('#pc-send');
    if (send && !chatBusy) { send.disabled = !input.value.trim(); }
  });
  petLifetime.listen(input, 'keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submitChat(input.value);
    }
  });
  petLifetime.listen(chatPart('#pc-model-trigger'), 'click', () => chatTogglePicker());
  petLifetime.listen(chatPickerEl, 'click', (event) => {
    const pane = event.target.closest?.('[data-pane]');
    if (pane) { chatShowPicker(pane.dataset.pane); return; }
    const choice = event.target.closest?.('.pc-option');
    if (!choice) { return; }
    if (chatPickerOpen === 'model') {
      const sel = chatPart('#pc-model');
      if (sel?.value === choice.dataset.value) { chatClosePicker(true); return; }
      if (sel) { sel.value = choice.dataset.value; chatSyncPickTitle(sel); }
      chatRenderEfforts('');
    } else if (chatPickerOpen === 'effort') {
      const sel = chatPart('#pc-effort');
      if (sel?.value === choice.dataset.value) { chatClosePicker(true); return; }
      if (sel) { sel.value = choice.dataset.value; chatSyncPickTitle(sel); }
    }
    chatClosePicker(true);
    chatSubmitModelChoice();
  });
  const onChatKeydown = (event) => {
    if (chatPickerOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const rows = [...chatPickerEl.querySelectorAll('.pc-option')];
      const index = rows.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[(index + step + rows.length) % rows.length]?.focus?.();
      return;
    }
    if (event.key !== 'Escape') { return; }
    event.preventDefault();
    event.stopPropagation();
    if (chatPickerOpen === 'model' || chatPickerOpen === 'effort') { chatShowPicker('root'); }
    else if (chatPickerOpen) { chatClosePicker(true); }
    else { toggleChat(false); }
  };
  petLifetime.listen(chatDom, 'keydown', onChatKeydown);
  petLifetime.listen(chatPickerEl, 'keydown', onChatKeydown);
  petLifetime.listen(document, 'pointerdown', (event) => {
    if (chatPickerOpen && !chatDom.contains(event.target) && !chatPickerEl?.contains(event.target)) { chatClosePicker(); }
  });
  petLifetime.listen(chatPart('#pc-open'), 'click', () => {
    void Promise.resolve(petShell.openWhale?.()).catch(() => {});
  });
  // The card never folds itself: only ✕ / Esc / the 聊聊 chip close it.
  // Clicking another window just blurs this one — the card stays put, and
  // regaining focus drops the caret back into the input so typing
  // continues where it left off.
  petLifetime.listen(window, 'focus', () => { if (chatOpen) { chatPart('#pc-input')?.focus?.(); } });
}

