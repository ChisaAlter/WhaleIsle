// app/dialogs.js — split from app.js (#442).
import { buttonBusy, clearButtonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { createSurface } from '../ui/surfaces.js?v=20261025-anchored-menus';
import { queuedMessages } from '../host/projections.js?v=20261028-mobile';
import { copyText, setToast } from './chrome.js?v=20261117-app-split';
import { dialogRoot, lightboxRoot, state } from './context.js?v=20261117-app-split';
import { createBranch, gitAction, gitBusyLabel, loadCommitFiles } from './git.js?v=20261117-app-split';
import { updateQueueItem } from './log-rows.js?v=20261117-app-split';
import { navigation, navigationBusy, preserveSurfaceInput, scheduleNavigation } from './navigation.js?v=20261117-app-split';
import { clearExclusiveDialogs, submitFolderCreate, submitWorkspaceRename } from './new-session.js?v=20261117-app-split';
import { descNode, fieldInput, ghostButton, primaryButton } from './nodes.js?v=20261117-app-split';
import { runSessionConfirm, submitSessionRename } from './session-actions.js?v=20261117-app-split';
import { closeGitLayer } from './sheets.js?v=20261117-app-split';

/** Destructive confirmations for management writes share one compact dialog. */
export function startConfirmAction({ title, lead, label, run }) {
  clearExclusiveDialogs();
  state.confirmAction = { title, lead, label, run, busy: false };
  renderDialog();
}

function renderConfirmActionDialog() {
  const confirm = state.confirmAction;
  const close = () => {
    if (state.confirmAction?.busy) return;
    state.confirmAction = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, confirm.title, confirm.lead);
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'danger-btn';
  ok.textContent = confirm.label;
  buttonBusy(ok, confirm.busy, { label: `${confirm.label}中…` });
  ok.disabled = confirm.busy;
  ok.addEventListener('click', async () => {
    if (confirm.busy) return;
    confirm.busy = true;
    renderDialog();
    await confirm.run();
    if (state.confirmAction === confirm) state.confirmAction = null;
    renderDialog();
  });
  const cancel = ghostButton('取消', close);
  cancel.disabled = confirm.busy;
  dialogFoot(dialog, [cancel, ok]);
  dialogRoot.append(layer);
}

function dialogLayer(compact, onClose = closeGitLayer) {
  const task = !compact;
  const result = createSurface(document, {
    task, variant: task ? 'task' : 'modal', family: 'dialog',
    onClose: () => { if (!navigationBusy()) onClose(); },
    onBack: task ? () => navigation.back() : null,
  });
  return { layer: result.layer, dialog: result.content };
}

function dialogHead(dialog, title, lead) {
  dialog.parentElement.querySelector('.surface-title').textContent = title;
  dialog.parentElement.setAttribute('aria-label', title);
  if (lead) dialog.append(descNode(lead, 'lead'));
}

export async function copyGitError(errorText = state.gitError) {
  const text = typeof errorText === 'string' ? errorText : state.gitError;
  await copyText(text);
}

function dialogFoot(dialog, buttons) {
  const foot = document.createElement('div');
  foot.className = 'dialog-foot';
  foot.append(...buttons);
  dialog.parentElement.append(foot);
}

function renderNamedDialog({ title, hint, field, placeholder, saveLabel, busy, onClose, onSave }) {
  const close = () => {
    if (busy) return;
    onClose();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, title, hint);
  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.append(fieldInput(field, placeholder, (value) => {
    saveBtn.disabled = busy || !value.trim();
    onSave.draft(value);
  }));
  dialog.append(body);
  const saveBtn = buttonBusy(primaryButton(saveLabel, () => onSave.submit()), busy, { label: saveLabel === '创建' ? '创建中…' : '保存中…' });
  saveBtn.disabled = busy || !String(field || '').trim();
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = busy;
  dialogFoot(dialog, [cancelBtn, saveBtn]);
  dialogRoot.append(layer);
}

function renderWorkspaceRenameDialog() {
  const rename = state.workspaceRename;
  renderNamedDialog({
    title: '重命名工作区',
    hint: '名字写回电脑端，两边同步显示。',
    field: rename.value,
    placeholder: '工作区名称',
    saveLabel: '保存',
    busy: rename.busy,
    onClose: () => {
      state.workspaceRename = null;
      renderDialog();
    },
    onSave: {
      draft: (value) => { rename.value = value; },
      submit: () => submitWorkspaceRename(),
    },
  });
}

function renderFolderCreateDialog() {
  const create = state.folderCreate;
  renderNamedDialog({
    title: '新建文件夹',
    hint: '在当前浏览目录下创建一个子文件夹。',
    field: create.value,
    placeholder: '文件夹名称',
    saveLabel: '创建',
    busy: create.busy,
    onClose: () => {
      state.folderCreate = null;
      renderDialog();
    },
    onSave: {
      draft: (value) => { create.value = value; },
      submit: () => submitFolderCreate(),
    },
  });
}

function renderSessionRenameDialog() {
  const rename = state.sessionRename;
  const close = () => {
    if (state.sessionRename?.busy) return;
    state.sessionRename = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, '重命名会话', '名字写回电脑端，两边同步显示。');
  const body = document.createElement('div');
  body.className = 'dialog-body';
  body.append(fieldInput(rename.value, '会话名称', (value) => {
    rename.value = value;
    saveBtn.disabled = rename.busy || !value.trim();
  }));
  dialog.append(body);
  const saveBtn = buttonBusy(primaryButton('保存', () => submitSessionRename()), rename.busy, { label: '保存中…' });
  saveBtn.disabled = rename.busy || !rename.value.trim();
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = rename.busy;
  dialogFoot(dialog, [cancelBtn, saveBtn]);
  dialogRoot.append(layer);
}

function renderQueueEditDialog() {
  const edit = state.queueEdit;
  const item = queuedMessages(state.sessionValues).find((candidate) => candidate.id === edit.id);
  if (!item) {
    state.queueEdit = null;
    setToast('这条消息已不在待发送队列', { tone: 'info' });
    return;
  }
  const close = () => {
    if (state.queueEdit?.busy) return;
    state.queueEdit = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  dialogHead(dialog, '编辑待发送消息', '保存后电脑端的队列同步更新。');
  const body = document.createElement('div');
  body.className = 'dialog-body';
  const input = document.createElement('textarea');
  input.className = 'paste queue-edit-input';
  input.rows = 4;
  input.value = edit.value;
  input.placeholder = '消息内容';
  input.setAttribute('aria-label', '待发送消息内容');
  input.disabled = edit.busy;
  body.append(input);
  dialog.append(body);
  const save = buttonBusy(primaryButton('保存修改', async () => {
    if (edit.busy || !edit.value.trim()) return;
    edit.busy = true;
    renderDialog();
    const saved = await updateQueueItem(item, 'edit', edit.value);
    if (state.queueEdit !== edit) return;
    if (saved) state.queueEdit = null;
    else edit.busy = false;
    renderDialog();
  }), edit.busy, { label: '保存中…' });
  save.disabled = edit.busy || !edit.value.trim();
  input.addEventListener('input', () => {
    edit.value = input.value;
    save.disabled = edit.busy || !input.value.trim();
  });
  const cancel = ghostButton('取消', close);
  cancel.disabled = edit.busy;
  dialogFoot(dialog, [cancel, save]);
  dialogRoot.append(layer);
}

function renderSessionConfirmDialog() {
  const confirm = state.sessionConfirm;
  const close = () => {
    if (state.sessionConfirm?.busy) return;
    state.sessionConfirm = null;
    renderDialog();
  };
  const { layer, dialog } = dialogLayer(true, close);
  const isDelete = confirm.kind === 'delete';
  const isWorkspace = confirm.kind === 'workspace-delete';
  dialogHead(
    dialog,
    isWorkspace ? `移除工作区「${confirm.title}」？` : isDelete ? `删除「${confirm.title}」？` : `归档「${confirm.title}」？`,
    isWorkspace
      ? '只从侧栏列表移除，不会删除磁盘上的文件夹。'
      : isDelete
        ? '会从电脑端永久删除这个已归档会话，不可恢复。'
        : '会话会移入「已归档会话」，之后可以取消归档。',
  );
  const cancelBtn = ghostButton('取消', close);
  cancelBtn.disabled = confirm.busy;
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = isDelete || isWorkspace ? 'danger-btn' : 'primary-btn';
  okBtn.textContent = isWorkspace ? '移除' : isDelete ? '删除' : '归档';
  buttonBusy(okBtn, confirm.busy, { label: isWorkspace ? '移除中…' : isDelete ? '删除中…' : '归档中…' });
  okBtn.disabled = confirm.busy;
  okBtn.addEventListener('click', () => runSessionConfirm());
  dialogFoot(dialog, [cancelBtn, okBtn]);
  dialogRoot.append(layer);
}

export function renderDialog() {
  scheduleNavigation();
  preserveSurfaceInput(dialogRoot);
  clearButtonBusy(dialogRoot);
  dialogRoot.replaceChildren();
  if (state.sessionConfirm) {
    renderSessionConfirmDialog();
    return;
  }
  if (state.confirmAction) {
    renderConfirmActionDialog();
    return;
  }
  if (state.workspaceRename) {
    renderWorkspaceRenameDialog();
    return;
  }
  if (state.folderCreate) {
    renderFolderCreateDialog();
    return;
  }
  if (state.sessionRename) {
    renderSessionRenameDialog();
    return;
  }
  if (state.queueEdit) {
    renderQueueEditDialog();
    if (state.queueEdit) return;
  }
  const kind = state.gitDialog;
  if (kind !== 'commit' && kind !== 'create-branch' && kind !== 'confirm' && kind !== 'publish') return;
  if (kind === 'commit') {
    if (!state.commitFiles) void loadCommitFiles();
    const { layer, dialog } = dialogLayer(false);
    dialogHead(dialog, '提交更改', '确认本次提交内容。提交信息留空将自动生成。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    const card = document.createElement('div');
    card.className = 'commit-card';
    const refRow = document.createElement('div');
    refRow.className = 'ref-row';
    const refLabel = document.createElement('span');
    refLabel.className = 'row-desc';
    refLabel.textContent = '分支';
    const refName = document.createElement('b');
    refName.textContent = state.gitStatus.refName ?? '—';
    refRow.append(refLabel, refName);
    if (state.gitStatus.isDefaultRef) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = '警告：目标为默认分支';
      refRow.append(warn);
    }
    card.append(refRow, descNode(state.gitStatus.hasWorkingTreeChanges ? '有未提交更改' : '无'));
    body.append(card);
    body.append(descNode('提交信息（可选）', 'field-label'));
    const messageInput = fieldInput(state.commitMessage, '留空则自动生成', (value) => {
      state.commitMessage = value;
    });
    messageInput.disabled = state.gitBusy || Boolean(state.gitRetry);
    body.append(messageInput);
    const onBranch = document.createElement('label');
    onBranch.className = 'row-desc';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = state.commitOnNewBranch;
    check.disabled = state.gitBusy || Boolean(state.gitRetry);
    check.addEventListener('change', () => {
      state.commitOnNewBranch = check.checked;
    });
    onBranch.append(check, document.createTextNode(' Commit on new branch'));
    body.append(onBranch);
    const files = state.commitFiles;
    const submit = primaryButton(state.pendingStacked === 'commit_push_pr' ? 'Commit, push & PR' : state.pendingStacked === 'commit_push' ? 'Commit & push' : '提交',
      () => gitAction('gitCommit', state.gitRetry ? { retry: true } : { message: state.commitMessage }));
    submit.dataset.gitFeedback = '';
    buttonBusy(submit, state.gitBusy || files?.loading, { label: state.gitBusy ? gitBusyLabel() : '加载中…' });
    const updateSubmit = () => {
      submit.disabled = state.gitBusy || Boolean(!state.gitRetry && (files?.loading || files?.error || (files?.entries.length && !files.selected.size)));
    };
    if (files?.entries.length) {
      body.append(descNode('包含的文件', 'field-label'));
      for (const entry of files.entries) {
        const label = document.createElement('label'); label.className = 'file-choice';
        const input = document.createElement('input'); input.type = 'checkbox';
        input.checked = files.selected.has(entry.path); input.disabled = state.gitBusy || Boolean(state.gitRetry);
        input.addEventListener('change', () => { if (input.checked) files.selected.add(entry.path); else files.selected.delete(entry.path); updateSubmit(); });
        label.append(input, document.createTextNode(entry.path)); body.append(label);
      }
    }
    updateSubmit();
    dialog.append(body);
    dialogFoot(dialog, [
      ghostButton('取消', closeGitLayer),
      submit,
    ]);
    dialogRoot.append(layer);
    return;
  }
  if (kind === 'create-branch') {
    const { layer, dialog } = dialogLayer(true);
    dialogHead(dialog, '创建并检出新分支', '基于当前 HEAD 创建一个新的本地分支，并在创建成功后立即切换过去。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.append(descNode('分支名', 'field-label'));
    const input = fieldInput(state.newBranchName, '例如 feature/git-branch-switcher', (value) => {
      state.newBranchName = value;
      createBtn.disabled = !value.trim();
    });
    input.disabled = state.gitBusy || Boolean(state.gitRetry);
    body.append(input);
    dialog.append(body);
    const createBtn = buttonBusy(primaryButton('Create branch', () => createBranch()), state.gitBusy, { label: gitBusyLabel() });
    createBtn.dataset.gitFeedback = '';
    createBtn.disabled = state.gitBusy || !state.newBranchName.trim();
    dialogFoot(dialog, [ghostButton('取消', closeGitLayer), createBtn]);
    dialogRoot.append(layer);
    return;
  }
  if (kind === 'publish') {
    const { layer, dialog } = dialogLayer(false);
    dialogHead(dialog, 'Publish repository', '在没有 origin 时把仓库发布到 GitHub（gh）或添加已有远程 URL。');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.append(descNode('仓库名', 'field-label'));
    body.append(fieldInput(state.publishName, '留空则用目录名', (value) => {
      state.publishName = value;
    }));
    body.append(descNode('已有远程地址（可选）', 'field-label'));
    body.append(fieldInput(state.publishRemoteUrl, 'https://… 或 git@…', (value) => { state.publishRemoteUrl = value; }));
    const visibility = document.createElement('div'); visibility.className = 'effort-segment';
    for (const [value, label] of [['private', 'Private'], ['public', 'Public']]) {
      const choice = ghostButton(label, () => {
        state.publishVisibility = value;
        for (const button of visibility.children) button.setAttribute('aria-pressed', String(button.dataset.value === value));
      });
      choice.dataset.value = value; choice.setAttribute('aria-pressed', String(state.publishVisibility === value));
      visibility.append(choice);
    }
    body.append(visibility);
    dialog.append(body);
    const publish = primaryButton('Publish repository', () => {
      gitAction('gitPublishRepository', { input: { name: state.publishName, visibility: state.publishVisibility, remoteUrl: state.publishRemoteUrl } });
    });
    publish.disabled = state.gitBusy;
    publish.dataset.gitFeedback = '';
    buttonBusy(publish, state.gitBusy, { label: gitBusyLabel() });
    dialogFoot(dialog, [
      ghostButton('取消', closeGitLayer),
      publish,
    ]);
    dialogRoot.append(layer);
    return;
  }
  const { layer, dialog } = dialogLayer(true);
  const isPr = state.gitConfirmAction === 'gitCreateChangeRequest';
  dialogHead(
    dialog,
    isPr ? '从默认分支推送并创建 pull request？' : '推送到默认分支？',
    `此操作会作用在“${state.gitStatus.refName ?? ''}”。你可以继续在此引用上操作，或新建功能引用后再执行同一操作。`,
  );
  dialogFoot(dialog, [
    ghostButton('取消', closeGitLayer),
    ghostButton('新建功能分支', () => {
      state.gitDialog = 'create-branch';
      renderDialog();
    }),
    primaryButton(isPr ? '推送并创建 pull request' : `推送到 ${state.gitStatus.refName ?? ''}`, () => {
      const name = state.gitConfirmAction;
      const extra = state.gitConfirmExtra;
      state.gitConfirmAction = '';
      state.gitConfirmExtra = {};
      state.gitDialog = 'menu';
      renderDialog();
      if (name) gitAction(name, extra);
    }),
  ]);
  dialogRoot.append(layer);
}

export function renderLightbox() {
  scheduleNavigation();
  lightboxRoot.replaceChildren();
  if (!state.lightbox) return;
  const layer = document.createElement('div');
  layer.className = 'lightbox-layer';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', '图片预览');
  layer.tabIndex = -1;
  const mask = document.createElement('button');
  mask.type = 'button';
  mask.className = 'lightbox-mask';
  mask.setAttribute('aria-label', '关闭');
  const img = document.createElement('img');
  img.src = `data:${state.lightbox.mediaType};base64,${state.lightbox.data}`;
  img.alt = '图片预览';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lightbox-close';
  close.setAttribute('aria-label', '关闭');
  close.textContent = '×';
  const dismiss = () => {
    state.lightbox = null;
    renderLightbox();
  };
  mask.addEventListener('click', dismiss);
  close.addEventListener('click', dismiss);
  layer.append(mask, img, close);
  lightboxRoot.append(layer);
}
