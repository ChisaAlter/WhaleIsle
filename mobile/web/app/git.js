// app/git.js — split from app.js (#442).
import { resolveGitQuick } from '../git/quick.js';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { gitCall } from '../host/backend.js';
import { parseVcsStatus, parseBranchList } from '../git/vcs-parse.js';
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { gitTunnelAction, gitCommitPayload } from '../git/bridge.js';
import { runStackedGit } from '../git/stack.js?v=20260906-interaction';
import { openPullRequest, operationError, renderToast, setToast, showBanner, toastTimer } from './chrome.js?v=20261117-app-split';
import { gitPill, phone, state } from './context.js?v=20261117-app-split';
import { copyGitError, renderDialog } from './dialogs.js?v=20261117-app-split';
import { renderHeader } from './header.js?v=20261117-app-split';
import { clearExclusiveDialogs } from './new-session.js?v=20261117-app-split';
import { renderSheet } from './pickers.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';

// —— Git / 工作区（M5）—— //

export function currentQuick() {
  if (state.gitAuthError) {
    return { label: 'Git', disabled: true, kind: 'show_hint', action: null, hint: state.gitAuthError };
  }
  if (state.gitStatus.isRepo === false) {
    return { label: 'Initialize Git', disabled: state.gitBusy, kind: 'run_init', action: null, hint: '' };
  }
  // Keep the resting caption while pending so feedback cannot resize it.
  return resolveGitQuick(state.gitStatus, false);
}

export function gitBusyLabel() {
  const labels = {
    commit: '提交中…', push: '推送中…', pull: '拉取中…', init: '初始化中…',
    'create-branch': '创建分支中…', 'switch-branch': '切换分支中…',
    publish: '发布中…', 'create-change-request': '创建 PR 中…',
  };
  return labels[state.gitProgress] || 'Git 操作进行中…';
}

function refreshGitButtonFeedback() {
  for (const button of phone.querySelectorAll('[data-git-feedback]')) {
    buttonBusy(button, state.gitBusy, { label: gitBusyLabel() });
  }
}

export async function refreshGit() {
  if (!state.cwd) return;
  state.gitAuthError = '';
  try {
    const status = await gitCall(state.chisacode.client, 'git-status', state.cwd, {});
    if (!status) {
      state.gitAuthError = 'Git 未授权该目录';
      state.gitStatus = parseVcsStatus({ isRepo: false, refName: null });
    } else {
      state.gitStatus = parseVcsStatus(status);
      try {
        const pr = await gitCall(state.chisacode.client, 'git-pull-request', state.cwd, {});
        if (pr && typeof pr === 'object' && (pr.url || pr.state)) {
          state.gitStatus.pr = {
            state: pr.state || null,
            number: pr.number ?? null,
            url: pr.url || null,
          };
        }
      } catch (error) {
        showBanner(`Git 状态已加载；拉取请求状态不可用：${error?.message || '电脑没有响应'}`);
      }
    }
  } catch (error) {
    const message = error.message || 'Git 状态不可用';
    if (/unavailable|授权|workspace/i.test(message)) {
      state.gitAuthError = message;
      state.gitStatus = parseVcsStatus({ isRepo: false, refName: null });
    } else {
      operationError(message, refreshGit);
    }
  }
  renderHeader();
  if (state.settingsOpen) renderSettings();
}

export async function gitAction(name, extra = {}) {
  if (!state.cwd || state.gitBusy) return false;
  const owner = sessionOwner(state);
  const cwd = state.cwd;
  const retry = extra.retry === true ? state.gitRetry : null;
  if (retry && (retry.cwd !== cwd || retry.client !== owner.client)) return;
  state.gitBusy = true;
  state.gitProgress = gitTunnelAction(name).replace('git-', '');
  state.gitPendingRef = name === 'gitSwitchBranch' ? extra.ref || '' : '';
  state.gitProgressDismissed = false;
  state.gitToast = '';
  clearTimeout(toastTimer);
  state.gitError = '';
  renderToast();
  renderSettings();
  renderSheet();
  renderDialog();
  let stacked = '';
  let payload;
  let succeeded = false;
  try {
    const action = gitTunnelAction(name);
    stacked = retry?.action || extra.stacked || (action === 'git-commit' ? state.pendingStacked || 'commit' : '');
    payload = retry?.payload || (action === 'git-commit'
      ? gitCommitPayload({
        message: extra.message || state.commitMessage,
        filePaths: extra.filePaths || (state.commitFiles?.entries.length ? [...state.commitFiles.selected] : undefined),
        featureBranch: extra.featureBranch === true || state.commitOnNewBranch,
      })
      : extra);
    if (stacked && stacked !== 'commit') {
      await runStackedGit(
        (step, body) => gitCall(
          owner.client,
          step,
          cwd,
          step === 'git-commit' ? payload : step === 'git-create-branch' ? { name: payload.name } : body || {},
        ),
        stacked,
        {},
        { completed: retry?.completed || [], onProgress: (step) => {
          if (owner.owns()) {
            state.gitProgress = step.replace('git-', '');
            refreshGitButtonFeedback();
            renderToast();
          }
        } },
      );
    } else {
      await gitCall(owner.client, action, cwd, payload);
    }
    if (!owner.owns()) return;
    state.pendingStacked = '';
    state.gitRetry = null;
    state.gitProgress = '';
    state.commitFiles = null;
    state.gitDialog = '';
    state.gitConfirmAction = '';
    state.gitConfirmExtra = {};
    state.commitOnNewBranch = false;
    renderSheet();
    renderDialog();
    state.gitBusy = false;
    setToast('完成', { tone: 'success' });
    succeeded = true;
    await refreshGit();
  } catch (error) {
    if (!owner.owns()) return;
    state.gitBusy = false;
    state.gitProgress = '';
    state.gitError = error.message || 'Git 失败';
    if (error.completedSteps?.length) {
      state.gitRetry = { action: stacked, completed: error.completedSteps, payload, cwd, client: owner.client };
      state.gitError = `已完成 ${error.completedSteps.map((step) => step.replace('git-', '')).join('、')}；${state.gitError}`;
    }
    const errorText = state.gitError;
    operationError(errorText, () => gitAction(name, state.gitRetry ? { retry: true } : extra), [{ label: '复制错误', onClick: () => copyGitError(errorText) }]);
  }
  if (!owner.owns()) return;
  renderSheet(); renderDialog();
  renderToast();
  renderSettings();
  return succeeded;
}

export function maybeConfirm(name, extra = {}) {
  if (name === 'gitCreateChangeRequest') extra = { stacked: 'create_pr', ...extra };
  if (state.gitStatus.isDefaultRef && (name === 'gitPush' || name === 'gitCreateChangeRequest')) {
    state.gitConfirmAction = name;
    state.gitConfirmExtra = extra;
    state.gitDialog = 'confirm';
    renderSheet();
    renderDialog();
  } else {
    gitAction(name, extra);
  }
}

export function runGitPrimary() {
  const quick = currentQuick();
  if (state.gitBusy) return;
  if (quick.disabled) {
    setToast(quick.hint);
    return;
  }
  if (quick.kind === 'run_init') {
    gitAction('gitInit');
    return;
  }
  if (quick.kind === 'run_pull') {
    gitAction('gitPull');
    return;
  }
  if (quick.action === 'commit' || quick.action === 'commit_push' || quick.action === 'commit_push_pr') {
    state.pendingStacked = quick.action;
    state.gitDialog = 'commit';
    renderDialog();
    return;
  }
  if (quick.action === 'push') {
    maybeConfirm('gitPush');
    return;
  }
  if (quick.action === 'create_pr') {
    maybeConfirm('gitCreateChangeRequest', { stacked: 'create_pr' });
    return;
  }
  if (quick.kind === 'open_publish') {
    state.gitDialog = 'publish';
    renderSheet();
    renderDialog();
    return;
  }
  if (quick.kind === 'open_pr') {
    openPullRequest();
    return;
  }
  setToast(quick.hint);
}

export async function loadBranches() {
  if (!state.cwd) return;
  const owner = sessionOwner(state);
  const request = ++state.branchRequest;
  state.gitDialog = 'branch';
  state.branchLoading = true;
  state.gitError = '';
  renderSheet();
  try {
    const result = await gitCall(owner.client, 'git-branch-list', state.cwd, {});
    if (!owner.owns() || request !== state.branchRequest || state.gitDialog !== 'branch') return;
    state.branches = parseBranchList(result);
    state.branchLoading = false;
    renderSheet();
  } catch (error) {
    if (!owner.owns() || request !== state.branchRequest || state.gitDialog !== 'branch') return;
    state.branchLoading = false;
    state.gitError = error.message || '无法列出分支';
    const errorText = state.gitError;
    operationError(errorText, loadBranches, [{ label: '复制错误', onClick: () => copyGitError(errorText) }]);
    renderSheet();
  }
}

export function switchBranch(ref) {
  gitAction('gitSwitchBranch', { ref });
}

export async function createBranch() {
  if (state.gitRetry?.action.startsWith('create_branch_')) {
    await gitAction('gitCreateBranch', { retry: true });
    return;
  }
  const name = state.newBranchName.trim();
  if (!name) return;
  const continuation = state.gitConfirmAction;
  const stacked = continuation === 'gitCreateChangeRequest' ? 'create_branch_pr' : continuation === 'gitPush' ? 'create_branch_push' : '';
  await gitAction('gitCreateBranch', { name, ...(stacked ? { stacked } : {}) });
}

export async function loadCommitFiles() {
  const owner = sessionOwner(state);
  const files = { entries: [], selected: new Set(), loading: true, error: '' };
  state.commitFiles = files;
  try {
    const result = await gitCall(owner.client, 'git-status-entries', state.cwd, {});
    if (!owner.owns() || state.commitFiles !== files) return;
    files.entries = result?.entries || [];
    files.selected = new Set(files.entries.map((entry) => entry.path));
  } catch (error) {
    if (!owner.owns() || state.commitFiles !== files) return;
    files.error = error.message || '读取更改失败';
    operationError(files.error, () => {
      const loading = loadCommitFiles();
      renderDialog();
      return loading;
    });
  }
  files.loading = false;
  if (state.gitDialog === 'commit') renderDialog();
}

export function gitCapsuleNode() {
  const quick = currentQuick();
  const capsule = document.createElement('div');
  capsule.className = 'git-capsule';
  const branch = document.createElement('button');
  branch.type = 'button';
  branch.className = 'cap-branch';
  branch.disabled = state.gitBusy;
  const branchLabel = document.createElement('span');
  branchLabel.textContent = state.gitStatus.refName ?? '—';
  branch.append(branchLabel, document.createTextNode(' ▾'));
  branch.addEventListener('click', () => loadBranches());
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'cap-primary';
  primary.disabled = quick.disabled || state.gitBusy;
  const primaryLabel = document.createElement('span');
  primaryLabel.textContent = quick.label;
  primary.append(primaryLabel);
  primary.dataset.gitFeedback = '';
  buttonBusy(primary, state.gitBusy, { label: gitBusyLabel() });
  primary.addEventListener('click', () => runGitPrimary());
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'cap-menu';
  menu.disabled = state.gitBusy;
  menu.setAttribute('aria-label', 'Git 操作');
  menu.textContent = '▾';
  menu.addEventListener('click', () => {
    state.gitDialog = 'menu';
    renderSheet();
  });
  const dividerA = document.createElement('span');
  dividerA.className = 'divider';
  const dividerB = document.createElement('span');
  dividerB.className = 'divider';
  capsule.append(branch, dividerA, primary, dividerB, menu);
  return capsule;
}

gitPill.addEventListener('click', () => {
  // Desktop title-bar parity: the branch pill opens the Git action sheet
  // (branch switch + fetch / pull / commit / push / PR) in place.
  clearExclusiveDialogs();
  state.pickerSheet = '';
  state.pickerPage = '';
  state.attachOpen = false;
  state.gitDialog = 'menu';
  renderSheet();
  refreshGit().then(() => {
    if (state.gitDialog === 'menu') renderSheet();
  }).catch((error) => { console.warn('[mobile/web/app.js] background operation failed', error); });
});
