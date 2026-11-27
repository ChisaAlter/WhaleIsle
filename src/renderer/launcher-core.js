'use strict';

// 启动器共享层：DOM 助手、提示、确认弹窗、反馈面板与标签页基础。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

const { h, mount } = window.whaleDom;

function $(id) {
  return document.getElementById(id);
}

function pageShell() {
  return window.shell;
}

function setHint(text, opts = {}) {
  if (text) void appNotice({ title: opts.title || '提示', body: text, tone: opts.tone || (opts.fade ? 'success' : 'error') });
}

// Results already written into a visible progress pane are not repeated in a
// floating notice; a dismissed pane still gets one.
function hintUnlessShown(id, text) {
  if (!$(id)?.checkVisibility()) setHint(text);
}

// The pending action reports on its own button (spinner and label), never in
// a separate floating notice.
// `label` is the full sentence for assistive tech and the tooltip; the button
// shows the short form ("正在检查更新…" → "检查中…") so it keeps its size.
function launcherButtonBusy(button, label = '正在处理…', shortLabel = label.replace(/^正在(.{2}).*$/u, '$1中…')) {
  if (!button) return () => {};
  const disabled = button.disabled;
  const wasFocused = document.activeElement === button;
  const attributes = ['aria-busy', 'aria-label', 'title'].map((name) => [name, button.getAttribute(name)]);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-label', label);
  button.title = label;
  const restoreLabel = window.shellFeedback.buttonBusy(button, shortLabel);
  const restore = () => {
    restoreLabel();
    button.disabled = disabled;
    for (const [name, value] of attributes) {
      if (value === null) button.removeAttribute(name);
      else button.setAttribute(name, value);
    }
    if (wasFocused && document.activeElement === document.body && button.isConnected && !button.disabled && button.checkVisibility()) button.focus();
  };
  restore.update = (nextLabel, nextShortLabel) => {
    button.setAttribute('aria-label', nextLabel);
    button.title = nextLabel;
    restoreLabel.update(nextShortLabel);
  };
  return restore;
}

// Machine codes from launcher-service / runtime-install / update. A bare
// token must never reach the user; sentences pass through after the known
// technical patterns get a Chinese translation.
const ERROR_LABELS = {
  'missing-tag': '缺少版本号，请刷新版本列表后重试。',
  'release-not-found': '未找到该版本的发布信息，请刷新版本列表。',
  'no-installer': '该版本没有可用的安装包。',
  'confirmed-release-unavailable': '所选版本已不可用，请刷新版本列表后重试。',
  'desktop-still-running': '桌面端仍在运行，请从托盘退出后重试。',
  'runtime-not-installed': '未检测到已安装的桌面端，请先在首页安装。',
  'runtime-exe-missing': '桌面端程序文件缺失，请重新安装。',
  'runtime-exited': '桌面端启动后立即退出，请到「插件排查」查看原因。',
  'runtime-never-started': '桌面端未能启动，请稍后重试。',
  'runtime-busy': '桌面端正在运行，请先停止后再试。',
  'desktop-only': '该操作需要在桌面端内完成。',
  'no-peer': '桌面端版本过旧，请从托盘退出桌面端后重试。',
  'peer-unreachable': '无法联系运行中的桌面端，请从其托盘菜单退出后重试。',
  'peer-cancelled': '已在桌面端取消该操作。',
  cancelled: '已取消。',
  busy: '桌面端正在处理任务，请稍后重试。',
  'suspects-changed': '插件排查结果已变化，请查看最新结果后重新确认。',
  'operation-in-progress': '已有其他操作进行中，请稍后重试。',
  'config-unreadable': '桌面配置无法读取，已停止恢复操作。请先恢复配置文件或读取权限。',
  'delta-not-found': '没有可用的增量包，请改用完整更新。',
  'executable-renamed': '此版本变更了主程序文件名，无法使用增量包，请改用完整更新。',
  'install-in-progress': '已有安装任务进行中。',
  'dshd/drain-timeout': '桌面端仍有请求未在 30 秒内结束，已取消本次操作，请稍后重试。',
  'dshd/lock-held': '桌面端正在执行其他关闭或更新操作，请稍后重试。',
};

const ERROR_MESSAGE_PATTERNS = [
  [/too many redirects/i, '下载跳转次数过多，请检查网络或更换下载线路。'],
  [/404|not found/i, '下载资源不存在（404），请刷新版本列表后重试。'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, '无法连接下载服务器，请检查网络后重试。'],
  [/ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|timed? ?out/i, '连接超时或被中断，请检查网络后重试。'],
  [/checksum|sha-?256|hash mismatch/i, '下载文件校验失败，已删除该文件，请重试。'],
  [/EPERM|EBUSY|EACCES/i, '文件被占用或没有权限，请关闭相关程序后重试。'],
  [/ENOSPC/i, '磁盘空间不足，请清理后重试。'],
];

// One sanitizer for every user-visible failure surface: strips the IPC
// "Error invoking remote method" prefix, prefers a real message sentence,
// translates known technical text, and never leaks a bare machine code.
function errText(input, fallback = '操作失败，请重试。') {
  const code = input && typeof input === 'object' ? String(input.error || '') : '';
  let text = typeof input === 'string' ? input : String(input?.message || '');
  text = text
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Error:\s*/, '')
    .trim();
  // Exact machine codes first: `dshd/drain-timeout` must not read as a
  // network timeout.
  if (ERROR_LABELS[text]) {
    return ERROR_LABELS[text];
  }
  for (const [pattern, label] of ERROR_MESSAGE_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }
  if (text && !/^[A-Za-z][\w./:-]*$/.test(text)) {
    return text;
  }
  if (ERROR_LABELS[code]) {
    return ERROR_LABELS[code];
  }
  return fallback;
}

// In-app confirm dialog — window.confirm() is banned here: it blocks the
// renderer thread and ignores the design tokens. Cancel is always the safe
// default focus; destructive confirmations paint the OK button danger.
let confirmResolve = null;
let confirmClosed = Promise.resolve();
let dialogLoading = false;

function appConfirm({ title, body, confirmText = '确定', cancelText = '取消', danger = false, loading = false }) {
  const mask = $('app-confirm');
  if (!mask) {
    return Promise.resolve(false);
  }
  if (confirmResolve) {
    confirmResolve(false);
    confirmResolve = null;
  }
  $('app-confirm-title').textContent = title || '';
  $('app-confirm-body').textContent = body || '';
  const okBtn = $('app-confirm-ok');
  okBtn.textContent = confirmText;
  okBtn.className = danger ? 'danger' : 'primary';
  okBtn.hidden = loading;
  const cancelBtn = $('app-confirm-cancel');
  cancelBtn.textContent = cancelText || '';
  cancelBtn.hidden = loading || cancelText === null;
  dialogLoading = loading;
  const shell = document.querySelector('.shell');
  if (shell && 'inert' in shell) shell.inert = true;
  mask.classList.toggle('is-loading', loading);
  mask.hidden = false;
  const previousFocus = document.activeElement;
  (loading ? mask.querySelector('.modal-card') : cancelBtn.hidden ? okBtn : cancelBtn).focus();
  confirmClosed = new Promise((resolve) => {
    confirmResolve = (ok) => {
      confirmResolve = null;
      dialogLoading = false;
      mask.hidden = true;
      if (shell && 'inert' in shell) shell.inert = false;
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
      resolve(ok);
    };
  });
  return confirmClosed;
}

function appNotice({ title = '提示', body, tone = 'info', holdMs }) {
  return window.shellFeedback.notice({ title, body, tone, ...(holdMs === undefined ? {} : { holdMs }) });
}

const progressPanels = new Map();
let importProgressPanel;
let updateNoticePanel;
let updateNoticeVersion = '';

function mountFeedbackSurfaces() {
  for (const prefix of ['install-progress', 'update-progress']) {
    progressPanels.set(prefix, window.shellFeedback.mountProgress($(`${prefix}-card`), { title: '安装进度' }));
  }
  $('install-progress-card').append($('btn-install-cancel'));
  importProgressPanel = window.shellFeedback.mountProgress($('import-progress-card'), { title: '导入进度' });
  updateNoticePanel = window.shellFeedback.mountProgress($('home-update'), { title: '更新说明' });
}

function settleConfirm(ok) {
  if (confirmResolve && !dialogLoading) {
    confirmResolve(ok);
  }
}

window.appConfirm = appConfirm;
window.appNotice = appNotice;
window.launcherButtonBusy = launcherButtonBusy;
window.dshdErrText = errText;

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('is-active', on);
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.panel').forEach((panel) => {
    const on = panel.id === `panel-${name}` || panel.id === `tab-${name}`;
    panel.classList.toggle('is-active', on);
    panel.hidden = !on;
  });
}

/**
 * Roving-tabindex arrow-key navigation for a tablist: arrows move focus,
 * Home/End jump to the edges, Enter/Space activates (manual activation
 * per ARIA tab pattern). `activate(tab)` is called on selection.
 */
function bindTablist(tablist, { orientation = 'horizontal', activate } = {}) {
  const tabs = () => [...tablist.querySelectorAll('[role="tab"]')].filter((t) => !t.hidden && !t.disabled);
  const prevKeys = orientation === 'vertical' ? ['ArrowUp'] : ['ArrowLeft'];
  const nextKeys = orientation === 'vertical' ? ['ArrowDown'] : ['ArrowRight'];
  tablist.addEventListener('keydown', (event) => {
    const list = tabs();
    if (!list.length) return;
    const current = document.activeElement;
    const index = list.indexOf(current);
    let next = -1;
    if (prevKeys.includes(event.key)) {
      next = index <= 0 ? list.length - 1 : index - 1;
    } else if (nextKeys.includes(event.key)) {
      next = index < 0 || index >= list.length - 1 ? 0 : index + 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = list.length - 1;
    }
    if (next >= 0 && next < list.length) {
      event.preventDefault();
      list[next].focus();
    }
  });
  // Keep tabindex roving: focus moves, the tab stop stays singular.
  tablist.addEventListener('focusin', (event) => {
    if (event.target.getAttribute('role') !== 'tab') return;
    for (const tab of tabs()) {
      tab.tabIndex = tab === event.target ? 0 : -1;
    }
  });
  if (typeof activate === 'function') {
    tablist.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ')
        && event.target.getAttribute('role') === 'tab') {
        event.preventDefault();
        activate(event.target);
      }
    });
  }
}
