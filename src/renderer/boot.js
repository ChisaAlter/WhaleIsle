const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('status-text');
const failureEl = document.getElementById('failure');
const actionsEl = document.getElementById('actions');
const logEl = document.getElementById('log');
const tickerInnerEl = document.getElementById('ticker-inner');
const tickerLineEl = document.getElementById('ticker-line');
const tickerCountEl = document.getElementById('ticker-count');
const drawerEl = document.getElementById('logdrawer');
const logCountEl = document.getElementById('log-count');
const logCloseEl = document.getElementById('log-close');
const retryEl = document.getElementById('retry');
const cancelRestartEl = document.getElementById('cancel-restart');
const openLauncherEl = document.getElementById('open-launcher');
const saveLogEl = document.getElementById('save-log');
const failurePanel = document.createElement('div');
failurePanel.append(failureEl);
const failureFeedback = window.shellFeedback.mountProgress(failurePanel, { title: '启动详情' });
let lastFailureText = '';

function showFailure(text) {
  failureEl.textContent = text;
  failureEl.hidden = !text;
  if (text) failureFeedback.show({ active: false, reset: text !== lastFailureText });
  else failureFeedback.hide();
  lastFailureText = text;
}

function actionFeedback(body, tone = 'error') {
  window.shellFeedback.notice({ body, tone });
}

const HINTS = {
  idle: '',
  starting: '',
  ready: '正在打开 Web UI。',
  stopping: '正在停止运行时。',
  error: '可立即重启，或根据日志调整配置。',
};

const LABELS = {
  idle: '待机',
  starting: '启动中',
  ready: '就绪',
  stopping: '正在停止',
  error: '启动失败',
};

let latestSnapshot = null;
let countdownTimer = null;
let pluginBoot = null;
let actionNotice = '';
let hintText = '';
let auxText = '';
let latestLogLine = '';
let latestLogImportant = false;

// The ticker line multiplexes three sources with clear precedence:
// recovery/action feedback > state hint > latest log line.
function refreshTickerLine() {
  tickerLineEl.textContent = auxText || hintText || latestLogLine;
  tickerLineEl.classList.toggle('important', !auxText && !hintText && latestLogImportant);
}

// The bottom ticker opens a drawer with the full log; closing paths are the
// backdrop, the × button, and Escape.
function openDrawer() {
  drawerEl.hidden = false;
  logEl.scrollTop = logEl.scrollHeight;
}

function closeDrawer() {
  drawerEl.hidden = true;
}

tickerInnerEl.addEventListener('click', openDrawer);
tickerInnerEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openDrawer();
  }
});
logCloseEl.addEventListener('click', closeDrawer);
drawerEl.addEventListener('click', (event) => {
  if (event.target === drawerEl) {
    closeDrawer();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !drawerEl.hidden) {
    closeDrawer();
  }
});

function invoke(method, ...args) {
  try {
    const api = window.shell;
    if (!api || typeof api[method] !== 'function') {
      return Promise.reject(new Error('桌面壳接口不可用'));
    }
    return Promise.resolve(api[method](...args));
  } catch (error) {
    return Promise.reject(error);
  }
}

function listen(method, handler) {
  try {
    const api = window.shell;
    if (!api || typeof api[method] !== 'function') {
      return;
    }
    Promise.resolve(api[method](handler)).catch(() => {});
  } catch {
    // ignore
  }
}

function recoveryText(snapshot) {
  const recovery = snapshot?.recovery;
  if (!recovery) {
    return '';
  }
  const attempt = Number(recovery.attempt) || 0;
  const maxAttempts = Number(recovery.maxAttempts) || 0;
  if (recovery.status === 'scheduled') {
    const at = Number(recovery.nextRetryAt);
    const remaining = Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
    const seconds = Math.max(1, Math.ceil(remaining / 1000));
    return `${seconds} 秒后进行第 ${attempt}/${maxAttempts} 次自动重启。`;
  }
  if (recovery.status === 'restarting') {
    return `正在进行第 ${attempt}/${maxAttempts} 次自动重启。`;
  }
  if (recovery.status === 'monitoring') {
    return `第 ${attempt}/${maxAttempts} 次自动重启已完成，正在确认运行稳定。`;
  }
  if (recovery.status === 'exhausted') {
    return `已完成 ${attempt} 次自动重启，仍未稳定运行。自动恢复已停止。`;
  }
  if (recovery.status === 'cancelled') {
    return recovery.reason === 'disabled'
      ? '自动恢复已在设置中关闭。'
      : '本轮自动恢复已取消。';
  }
  return '';
}

function refreshCountdown() {
  if (!latestSnapshot && !actionNotice) {
    return;
  }
  const recovery = latestSnapshot ? recoveryText(latestSnapshot) : '';
  auxText = [recovery, actionNotice].filter(Boolean).join(' ');
  refreshTickerLine();
}

function manageCountdown(snapshot) {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (snapshot?.recovery?.status === 'scheduled') {
    countdownTimer = setInterval(refreshCountdown, 250);
  }
}

function setHint(text) {
  hintText = text || '';
  refreshTickerLine();
}

function applyPluginBootCopy(payload) {
  if (payload.failed) {
    statusTextEl.textContent = '插件加载失败';
    statusEl.className = 'status error';
    setHint(payload.error || '运行时已就绪，但客户端插件未能完成装载。');
    showFailure(payload.error || '运行时已就绪，但客户端插件未能完成装载。');
    document.body.dataset.state = 'error';
    return;
  }
  statusTextEl.textContent = payload.total > 0
    ? `正在加载插件 ${payload.ready}/${payload.total}`
    : '正在加载插件';
  statusEl.className = 'status ready';
  setHint('运行时已就绪，正在装载客户端插件。');
}

function applyPluginRecoveryCopy(snapshot) {
  if (snapshot?.pluginRecovery?.skipUserPlugins !== true) return false;
  const copy = globalThis.BootRecovery?.skipStartingCopy?.();
  if (!copy) return false;
  statusTextEl.textContent = copy.status;
  statusEl.className = 'status ready';
  setHint(copy.hint);
  document.body.dataset.state = 'starting';
  return true;
}

function renderPluginBoot(payload) {
  pluginBoot = payload;
  if (!payload || payload.settled) {
    return;
  }
  if (latestSnapshot?.state === 'error') {
    return;
  }
  applyPluginBootCopy(payload);
}

// Failure copy for people, not logs: known technical failures map to a
// Chinese cause + next step; the raw message stays in the log dock.
const FAILURE_TEXT_PATTERNS = [
  [/spawn\s+\S+\s+ENOENT|ENOENT/i, '桌面运行时文件缺失，请重新安装桌面端。'],
  [/EADDRINUSE|address already in use/i, '启动所需端口被其他程序占用，请关闭占用程序后重试。'],
  [/EACCES|permission denied|EPERM/i, '没有权限访问所需资源，请检查安全软件拦截或重新安装。'],
  [/dsh 进程结束|exit(?:ed)?\s+(?:with|code)/i, '桌面运行时进程已退出，可重试或回启动器排查。'],
];

function failureText(failure, snapshot) {
  const raw = String(failure?.message || snapshot?.error || '').trim();
  if (!raw) {
    return '';
  }
  for (const [pattern, text] of FAILURE_TEXT_PATTERNS) {
    if (pattern.test(raw)) {
      return `${text}（详情见下方日志）`;
    }
  }
  // A plain sentence (spaces, CJK, punctuation) is already user copy; a bare
  // technical token is not.
  if (!/^[A-Za-z][\w./:-]*$/.test(raw)) {
    return raw;
  }
  return '启动失败，请下载日志后回启动器排查。';
}

function renderState(snapshot) {
  latestSnapshot = snapshot;
  const state = snapshot?.state || 'starting';
  const failure = snapshot?.failure;
  const recovery = snapshot?.recovery;
  const runtimeFailure = state === 'error' && failure?.phase === 'runtime';
  const recoveryBusy = recovery?.status === 'restarting';
  const recoveryScheduled = recovery?.status === 'scheduled';
  document.body.dataset.state = state;

  const usingOfficialRecovery = state === 'starting' && applyPluginRecoveryCopy(snapshot);

  if (!usingOfficialRecovery) {
    statusTextEl.textContent = state === 'error'
      ? (runtimeFailure
        ? '桌面端意外退出'
        : (globalThis.BootRecovery?.startupErrorLabel?.() || '桌面端启动失败'))
      : LABELS[state] || LABELS.starting;
    statusEl.className = `status ${state}`;
    setHint(runtimeFailure
      ? '桌面端已返回恢复页面，失效的 Web UI 和手机 Remote 已停止使用旧进程。'
      : (HINTS[state] ?? HINTS.starting));
  }

  showFailure(state === 'error' ? failureText(failure, snapshot) : '');

  const canAct = state === 'error' || recoveryScheduled || recoveryBusy;
  if (!canAct) {
    actionNotice = '';
  }
  refreshCountdown();
  manageCountdown(snapshot);

  actionsEl.hidden = !canAct;
  retryEl.textContent = globalThis.BootRecovery?.retryActionLabel
    ? globalThis.BootRecovery.retryActionLabel(runtimeFailure)
    : (runtimeFailure ? '立即重启' : '重试');
  retryEl.disabled = recoveryBusy;
  saveLogEl.textContent = globalThis.BootRecovery?.downloadLogLabel
    ? globalThis.BootRecovery.downloadLogLabel()
    : '下载日志';
  // Plugin-level recovery lives on the launcher Recovery Board; the boot
  // page only bridges there on a settled failure.
  openLauncherEl.textContent = globalThis.BootRecovery?.openLauncherLabel
    ? globalThis.BootRecovery.openLauncherLabel()
    : '回启动器排查';
  const recoveryStatus = snapshot?.recovery?.status;
  openLauncherEl.hidden = !(globalThis.BootRecovery?.showLauncherBridge
    ? globalThis.BootRecovery.showLauncherBridge(state, recoveryStatus)
    : state === 'error' && recoveryStatus !== 'scheduled' && recoveryStatus !== 'restarting');
  cancelRestartEl.hidden = !recoveryScheduled;
  cancelRestartEl.disabled = recoveryBusy || cancelRestartEl.getAttribute('aria-busy') === 'true';

  if (Array.isArray(snapshot?.logs)) {
    // Merge streamed DOM with the snapshot instead of replacing it: the
    // streamed buffer may hold more history than the snapshot tail, and
    // post-snapshot stream lines stay appended. Whichever side has the
    // longer head wins the shared prefix; a missing tail means divergence
    // (fresh attempt) and the snapshot replaces the buffer.
    const snap = snapshot.logs.map((line) => String(line ?? ''));
    const dom = [...logEl.children].map((li) => li.textContent);
    const idx = snap.length ? dom.lastIndexOf(snap[snap.length - 1]) : -1;
    if (idx === -1) {
      logEl.replaceChildren();
      snap.forEach((line) => appendLog(line));
    } else if (idx + 1 < dom.length || idx < snap.length - 1) {
      const merged = (idx < snap.length - 1 ? snap : dom.slice(0, idx + 1))
        .concat(dom.slice(idx + 1));
      logEl.replaceChildren();
      merged.forEach((line) => appendLog(line));
    }
    updateLogCount();
  }

  if (state === 'ready' && pluginBoot && !pluginBoot.settled && !pluginBoot.failed) {
    applyPluginBootCopy(pluginBoot);
  }
}

function isImportantLog(line) {
  return globalThis.BootRecovery?.isImportantBootLog
    ? globalThis.BootRecovery.isImportantBootLog(line)
    : /ERR_[A-Z0-9_]+|Cannot find (?:package|module)|Error \[|plugin tree failed to load|cannot get property|cannot resolve profile bundle/.test(line);
}

function updateLogCount() {
  const total = logEl.children.length;
  tickerCountEl.textContent = `L ${String(total).padStart(2, '0')}`;
  logCountEl.textContent = `${total} 行`;
}

// The ticker only ever paints the latest line; the drawer keeps the full
// buffer (capped) with important lines marked.
function appendLog(line) {
  const text = typeof line === 'string' ? line : String(line ?? '');
  const important = isImportantLog(text);
  const item = document.createElement('li');
  item.textContent = text;
  if (important) {
    item.className = 'important';
  }
  logEl.appendChild(item);
  while (logEl.children.length > 400) {
    logEl.removeChild(logEl.firstChild);
  }
  latestLogLine = text;
  latestLogImportant = important;
  refreshTickerLine();
  updateLogCount();
}

retryEl.addEventListener('click', () => {
  actionNotice = '';
  retryEl.disabled = true;
  cancelRestartEl.hidden = true;
  renderState({ state: 'starting', recovery: { status: 'inactive' } });
  invoke('restart')
    .then((snapshot) => {
      if (snapshot && snapshot.state) {
        renderState(snapshot);
      }
    })
    .catch((error) => {
      renderState({
        state: 'error',
        error: error.message || String(error),
        failure: {
          phase: 'startup',
          message: error.message || String(error),
        },
      });
    });
});

cancelRestartEl.addEventListener('click', async () => {
  if (cancelRestartEl.getAttribute('aria-busy') === 'true') return;
  cancelRestartEl.disabled = true;
  cancelRestartEl.setAttribute('aria-busy', 'true');
  try {
    renderState(await invoke('cancelRestart'));
  } catch (error) {
    actionFeedback(`取消失败：${error.message || String(error)}`);
  } finally {
    cancelRestartEl.removeAttribute('aria-busy');
    cancelRestartEl.disabled = latestSnapshot?.recovery?.status === 'restarting';
  }
});

openLauncherEl.addEventListener('click', async () => {
  if (openLauncherEl.getAttribute('aria-busy') === 'true') return;
  openLauncherEl.disabled = true;
  openLauncherEl.setAttribute('aria-busy', 'true');
  try {
    const result = await invoke('openLauncher');
    if (result && result.ok === false) {
      actionFeedback(`打开启动器失败：${result.error || result.reason || '未知错误'}`);
    }
  } catch (error) {
    actionFeedback(`打开启动器失败：${error.message || String(error)}`);
  } finally {
    openLauncherEl.disabled = false;
    openLauncherEl.removeAttribute('aria-busy');
  }
});

saveLogEl.addEventListener('click', async () => {
  if (saveLogEl.getAttribute('aria-busy') === 'true') return;
  saveLogEl.disabled = true;
  saveLogEl.setAttribute('aria-busy', 'true');
  try {
    const result = await invoke('saveBootLog');
    if (!result || result.canceled) return;
    if (result.ok) {
      actionFeedback(`日志已保存：${result.path}`, 'success');
    } else {
      actionFeedback(`保存日志失败：${result.error || '未知错误'}`);
    }
  } catch (error) {
    actionFeedback(`保存日志失败：${error.message || String(error)}`);
  } finally {
    saveLogEl.disabled = false;
    saveLogEl.removeAttribute('aria-busy');
  }
});

invoke('getState')
  .then(renderState)
  .catch((error) => {
    renderState({
      state: 'error',
      error: error.message || String(error),
      failure: {
        phase: 'startup',
        message: error.message || String(error),
      },
    });
  });

listen('onState', renderState);
listen('onLog', (payload) => (Array.isArray(payload) ? payload : [payload]).forEach(appendLog));
listen('onPluginBoot', renderPluginBoot);
if (typeof window.watchShellTheme === 'function') {
  window.watchShellTheme();
}
