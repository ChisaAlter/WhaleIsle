// app/composer.js — split from app.js (#442).
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { filterSlashCommands, slashQuery, applySlashCommand } from '../chisacode/commands.js';
import { hostCall } from '../host/backend.js';
import { commandListPayload, mapHostSlashList } from '../host/commands.js';
import { ALLOWED_IMAGE_TYPES, imageBlock } from '../host/prompt.js';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { composerOffline, operationError, showBanner } from './chrome.js?v=20261117-app-split';
import { draftStore } from './connect.js?v=20261117-app-split';
import { accessChip, attachRail, composer, composerBehavior, draft, fileCamera, fileGallery, modelChip, planChip, sendBtn, slashPop, state, store } from './context.js?v=20261117-app-split';
import { renderLightbox } from './dialogs.js?v=20261117-app-split';
import { currentModeState, currentModelState, currentReadOnlyReason } from './header.js?v=20261117-app-split';
import { scheduleNativeSnapshot } from './native.js?v=20261117-app-split';
import { scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { sendPrompt } from './session-actions.js?v=20261117-app-split';
import { closeSettings } from './settings.js?v=20261117-app-split';

let fileSelectionOwner = null;

export function renderComposer({ nativeSnapshot = true } = {}) {
  composerBehavior.refresh();
  const canSend = Boolean(draft.value.trim()) || state.attachments.length > 0;
  sendBtn.disabled = !canSend || composerOffline() || state.sendBusy;
  buttonBusy(sendBtn, state.sendBusy, { iconOnly: true, label: '正在发送消息…' });
  const choiceDisabled = !state.sessionId || composerOffline() || Boolean(currentReadOnlyReason());
  accessChip.disabled = choiceDisabled;
  modelChip.disabled = choiceDisabled;
  const choiceHint = !state.sessionId ? '先打开或新建一个会话' : composerOffline() ? '等待连接恢复' : currentReadOnlyReason();
  const accessLabel = currentModeState().currentLabel || '权限';
  // #access-chip's first child is a whitespace text node; the visually-hidden
  // .chip-label span is the label slot (the shield icon stays visible alone).
  accessChip.querySelector('.chip-label').textContent = accessLabel;
  accessChip.title = choiceDisabled ? choiceHint : `权限：${accessLabel}`;
  accessChip.setAttribute('aria-label', `权限：${accessLabel}`);
  const modelLabel = currentModelState().label || '模型';
  // The label span (not a bare text node) is what lets the chip ellipsize
  // "model · effort" on a narrow phone instead of wrapping the tool row.
  modelChip.querySelector('.chip-label').textContent = modelLabel;
  modelChip.title = choiceDisabled ? choiceHint : modelLabel;
  modelChip.setAttribute('aria-label', choiceDisabled ? `模型：${choiceHint}` : `模型：${modelLabel}`);
  planChip.classList.toggle('hidden', !state.permission.planOn || Boolean(currentReadOnlyReason()));
  attachRail.classList.toggle('hidden', state.attachments.length === 0);
  attachRail.replaceChildren(...state.attachments.map((image, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'attach-thumb';
    const img = document.createElement('img');
    img.src = `data:${image.mediaType};base64,${image.data}`;
    img.alt = '附件图片';
    img.addEventListener('click', () => {
      state.lightbox = image;
      renderLightbox();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attach-remove';
    remove.setAttribute('aria-label', '移除附件');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.attachments.splice(index, 1);
      draftStore?.saveAttachments(state.sessionId, state.attachments);
      if (state.lightbox && !state.attachments.includes(state.lightbox)) {
        state.lightbox = null;
        renderLightbox();
      }
      renderComposer();
    });
    wrap.append(img, remove);
    return wrap;
  }));
  if (nativeSnapshot) scheduleNativeSnapshot();
  if (state.pickerSheet || state.attachOpen) scheduleNavigation();
}

// —— Slash 命令 popup（`/` 触发，host commands/list，按会话缓存）—— //

export function renderSlashPop() {
  const slash = state.slash;
  const visible = slash.open && !currentReadOnlyReason() && !state.pendingApprovals.length;
  slashPop.classList.toggle('hidden', !visible);
  if (!visible) return;
  const nodes = [];
  if (slash.loading) {
    slashPop.classList.add('surface-busy');
  } else if (slash.error) {
    slashPop.classList.remove('surface-busy');
  } else {
    slashPop.classList.remove('surface-busy');
    const rows = filterSlashCommands(slash.commands, slashQuery(draft.value) || '');
    if (!rows.length) {
      const note = document.createElement('p');
      note.className = 'slash-note';
      note.textContent = '没有匹配的命令';
      nodes.push(note);
    }
    for (const command of rows.slice(0, 8)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slash-item';
      const name = document.createElement('b');
      name.textContent = `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`;
      button.append(name);
      if (command.description) {
        const desc = document.createElement('span');
        desc.textContent = command.description;
        button.append(desc);
      }
      button.addEventListener('click', () => {
        draft.value = applySlashCommand(command.name);
        if (state.sessionId) draftStore?.save(state.sessionId, draft.value);
        state.slash = { ...state.slash, open: false };
        renderSlashPop();
        renderComposer();
        draft.focus();
      });
      nodes.push(button);
    }
  }
  slashPop.replaceChildren(...nodes);
  slashPop.setAttribute('aria-busy', String(slash.loading));
}

function updateSlashPopup() {
  const paired = state.chisacode;
  const sessionId = state.sessionId;
  const query = slashQuery(draft.value);
  const usable = state.transport === 'chisacode' && paired && sessionId
    && query !== null && !currentReadOnlyReason();
  if (!usable) {
    if (state.slash.open) {
      state.slash = { ...state.slash, open: false };
      renderSlashPop();
    }
    return;
  }
  paired.slashCommandsCache ??= new Map();
  paired.slashCommandsInflight ??= new Set();
  const cached = paired.slashCommandsCache.get(sessionId);
  if (cached) {
    state.slash = { open: true, loading: false, error: '', commands: cached };
    renderSlashPop();
    return;
  }
  if (paired.slashCommandsInflight.has(sessionId)) {
    if (!state.slash.open) {
      state.slash = { open: true, loading: true, error: '', commands: [] };
      renderSlashPop();
    }
    return;
  }
  paired.slashCommandsInflight.add(sessionId);
  state.slash = { open: true, loading: true, error: '', commands: [] };
  renderSlashPop();
  hostCall(paired.client, 'commands/list', commandListPayload(sessionId))
    .then((listed) => {
      const mapped = mapHostSlashList(listed);
      paired.slashCommandsCache.set(sessionId, mapped);
      if (state.sessionId !== sessionId || slashQuery(draft.value) === null) return;
      state.slash = { open: true, loading: false, error: '', commands: mapped };
      renderSlashPop();
    })
    .catch((error) => {
      if (state.sessionId !== sessionId) return;
      state.slash = {
        open: true,
        loading: false,
        error: error.message || '无法读取命令',
        commands: [],
      };
      operationError(state.slash.error, () => updateSlashPopup());
      renderSlashPop();
    })
    .finally(() => {
      paired.slashCommandsInflight.delete(sessionId);
    });
}

// —— 附件（M3）—— //

function base64FromDataUrl(dataUrl) {
  const index = dataUrl.indexOf(',');
  return index >= 0 ? dataUrl.slice(index + 1) : '';
}

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

async function compressImage(file) {
  // 与 Android TakePicturePreview→JPEG 88% 同量级：大图经 canvas 转 JPEG。
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { mediaType: 'image/jpeg', data: base64FromDataUrl(canvas.toDataURL('image/jpeg', 0.88)) };
}

async function attachmentFromFile(file) {
  if (ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const block = imageBlock(file.type, bytes);
    return { mediaType: block.mediaType, data: block.data };
  }
  // 非白名单类型（如 HEIC）或大图统一经 canvas 转 JPEG。
  return compressImage(file);
}

async function addFiles(fileList, owner = sessionOwner(state)) {
  if (!owner.owns()) return;
  for (const file of Array.from(fileList || [])) {
    try {
      const attachment = await attachmentFromFile(file);
      if (!owner.owns()) return;
      state.attachments.push(attachment);
    } catch (error) {
      if (!owner.owns()) return;
      showBanner(error.message || '无法读取图片');
    }
  }
  draftStore?.saveAttachments(state.sessionId, state.attachments);
  renderComposer();
}

export function insertMention(path) {
  draft.value = draft.value ? `${draft.value.trimEnd()} @${path} ` : `@${path} `;
  closeSettings();
  renderComposer();
  draft.focus();
}

draft.addEventListener('input', () => {
  // Only persist for the session the textarea is bound to; a late input event
  // during a switch must not land under the new id.
  if (state.transport === 'chisacode' && state.sessionId && draft.dataset.draftSession === state.sessionId) {
    draftStore?.save(state.sessionId, draft.value);
  }
  renderComposer();
  updateSlashPopup();
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendPrompt().catch((error) => operationError(`发送失败：${error?.message || '电脑没有响应'}；草稿已保留`, () => sendPrompt()));
});

// Ctrl/⌘+Enter always sends; plain Enter sends only with the phone preference
// (hardware keyboards). Shift+Enter and IME composition keep a newline.
draft.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  const chord = event.ctrlKey || event.metaKey;
  if (!chord && (!store.enterSend || event.shiftKey || event.altKey)) return;
  event.preventDefault();
  if (!sendBtn.disabled) composer.requestSubmit();
});

fileCamera.addEventListener('change', () => {
  addFiles(fileCamera.files, fileSelectionOwner || sessionOwner(state));
  fileSelectionOwner = null;
  fileCamera.value = '';
});

fileGallery.addEventListener('change', () => {
  addFiles(fileGallery.files, fileSelectionOwner || sessionOwner(state));
  fileSelectionOwner = null;
  fileGallery.value = '';
});

for (const input of [fileCamera, fileGallery]) {
  input.addEventListener('click', () => { fileSelectionOwner = sessionOwner(state); });
  input.addEventListener('cancel', () => { fileSelectionOwner = null; });
}
