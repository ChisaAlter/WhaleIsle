'use strict';

// 主页与运行时：桌面状态、安装进度、更新中心与标签激活。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

function desktopStateLabel(state) {
  const labels = {
    ready: '已就绪',
    starting: '启动中',
    stopping: '关闭中',
    error: '异常',
    stopped: '未运行',
    idle: '未运行',
    'running-external': '运行中',
  };
  return labels[state] || String(state || '');
}

function desktopIsRunning(desktop) {
  const state = desktop?.state;
  return state === 'ready' || state === 'starting' || state === 'running-external';
}

// --- Download route + runtime install (slim package / missing runtime) -----

let lastStatus = null;
let desktopOperation = null;
let desktopActionError = '';
let pluginGuidancePending = false;
let statusRequest = 0;
let installBusy = false;
let updateBusy = false;
let updateCheckBusy = false;
let lastUpdateCheck = null;
let componentsMounted = false;

function renderInstallCard(status) {
  const card = $('home-install');
  if (!card) {
    return;
  }
  const installed = status?.installed;
  const launcherPackage = status?.launcherPackage === true;
  const missing = Boolean(installed) && installed.registeredInstall === false;
  // Slim package without a runtime: the start actions have nothing to drive.
  const hideStart = launcherPackage && missing;
  $('home-actions').hidden = hideStart;
  card.hidden = !missing;
  if (!missing) {
    return;
  }
  $('install-lede').textContent = launcherPackage
    ? '未检测到本机安装的桌面端。选择下载线路后安装，安装完成后可在本窗口启动。'
    : '未检测到本机安装的正式版。可先下载安装（不影响当前源码运行），或直接启动源码版。';
  renderRouteControls(status);
}

function installPhaseText(payload) {
  const phases = {
    resolve: '正在获取版本信息…',
    verify: '正在校验安装包…',
    install: '正在启动安装程序…',
    'install-wait': `${payload?.installerDone ? '正在确认安装结果' : '请在安装向导中完成安装，并留意系统授权提示'}${payload?.elapsedMs ? `（已等待 ${Math.floor(payload.elapsedMs / 1000)} 秒）` : ''}…`,
    done: '安装完成',
    cancelled: '已取消',
    error: errText(payload, '安装失败'),
  };
  if (payload?.phase === 'download') {
    if (payload.retrying) return payload.received > 0
      ? `下载中断，将从 ${(payload.received / 1048576).toFixed(1)} MB 续传（${payload.attempt}/${payload.maxAttempts}）…`
      : `下载中断，正在重试（${payload.attempt}/${payload.maxAttempts}）…`;
    const size = Number.isFinite(payload.received) ? ` · ${(payload.received / 1048576).toFixed(1)} MB${payload.total > 0 ? ` / ${(payload.total / 1048576).toFixed(1)} MB` : ''}` : '';
    const speed = payload.bytesPerSecond > 0 ? ` · ${(payload.bytesPerSecond / 1048576).toFixed(2)} MB/s` : '';
    const percent = Number.isFinite(payload.percent) ? ` ${payload.percent}%` : '';
    return `${payload.differential ? '增量下载' : '下载'}${percent}${size}${speed}`;
  }
  if (payload?.stage === 'checksum' && payload.phase === 'resolve') {
    return payload.retrying
      ? `校验清单请求中断，正在重试（${payload.attempt}/${payload.maxAttempts}）…`
      : '正在获取安装包校验信息…';
  }
  return phases[payload?.phase] || payload?.phase || '处理中';
}

const PHASE_STEPS = ['resolve', 'download', 'verify', 'install', 'install-wait'];
const PHASE_LABELS = {
  resolve: '解析版本',
  download: '下载',
  verify: '校验',
  install: '安装',
  'install-wait': '确认结果',
};
const PHASE_FILL = {
  resolve: 8,
  verify: 72,
  install: 88,
  'install-wait': 94,
  done: 100,
};

function phaseRank(phase) {
  if (phase === 'done') return PHASE_STEPS.length;
  const index = PHASE_STEPS.indexOf(phase);
  return index === -1 ? 0 : index;
}

// Paints one structured progress card; `prefix` is 'install-progress' (home
// runtime install) or 'update-progress' (versions install / delta update).
function paintProgress(prefix, payload) {
  const card = $(`${prefix}-card`);
  if (!card) {
    return;
  }
  const phase = payload?.phase || '';
  progressPanels.get(prefix)?.show({ active: !['waiting', 'error', 'cancelled', 'done'].includes(phase) });
  const terminalTitle = { waiting: '安装结果待确认', error: '安装未完成', cancelled: '操作已取消', done: '安装完成' }[phase];
  if (terminalTitle && $(`${prefix}-title`)) $(`${prefix}-title`).textContent = terminalTitle;
  const unsettled = ['waiting', 'error', 'cancelled'].includes(phase);
  const percent = phase === 'download' && Number.isFinite(payload?.percent)
    ? Math.max(0, Math.min(100, Number(payload.percent)))
    : null;
  const pct = $(`${prefix}-pct`);
  if (pct) {
    pct.textContent = percent === null ? '' : `${percent}%`;
  }
  const bar = $(`${prefix}-bar`);
  if (bar) {
    bar.parentElement.hidden = unsettled;
    const fill = percent === null ? (phase === 'download' ? 0 : PHASE_FILL[phase] ?? null) : percent;
    if (fill !== null) {
      bar.style.transform = `scaleX(${fill / 100})`;
    }
  }
  const kind = $(`${prefix}-kind`);
  if (kind) {
    kind.hidden = !(payload?.differential || payload?.delta === true || payload?.mode === 'delta');
  }
  const host = $(`${prefix}-phases`);
  if (host) {
    host.hidden = unsettled;
    const now = phaseRank(phase);
    mount(host, ...PHASE_STEPS.map((step, index) => {
      const cls = index < now ? ' done' : (index === now ? ' now' : '');
      return h('span', { class: `phase${cls}` }, h('i', { class: 'phase-dot' }), PHASE_LABELS[step]);
    }));
  }
}

async function installRuntime() {
  const api = pageShell();
  if (!api || installBusy) {
    return;
  }
  const route = selectedRoute() || lastStatus?.downloadRoute || '';
  if (!route) {
    setHint('请先选择下载线路。');
    return;
  }
  installBusy = true;
  progressPanels.get('install-progress')?.show({ reset: true });
  const progress = $('install-progress');
  const title = $('install-progress-title');
  const btnInstall = $('btn-install-runtime');
  const btnCancel = $('btn-install-cancel');
  const restoreInstall = launcherButtonBusy(btnInstall, '正在安装桌面端…');
  btnCancel.hidden = false;
  if (title) {
    title.textContent = '正在安装桌面端';
  }
  paintProgress('install-progress', { phase: 'resolve' });
  progress.textContent = '正在获取版本信息…';
  syncLauncherState();
  try {
    const result = await api.installRuntime({ route });
    if (result?.status === 'installed') {
      paintProgress('install-progress', { phase: 'done' });
      progress.textContent = `安装完成${result?.installed?.version ? `：v${result.installed.version}` : ''}`;
      void refreshStatus();
    } else if (result?.cancelled) {
      paintProgress('install-progress', { phase: result.status === 'waiting' ? 'waiting' : 'cancelled' });
      progress.textContent = result.message || '已取消';
    } else if (result?.manualInstall || result?.status === 'waiting' || result?.status === 'quit-pending' || result?.launched === true || result?.ok === true) {
      paintProgress('install-progress', { phase: 'waiting' });
      progress.textContent = result.message || '安装结果待确认。请完成安装向导并留意系统授权提示，完成后刷新状态。';
    } else {
      paintProgress('install-progress', { phase: result?.status === 'waiting' ? 'waiting' : 'error' });
      progress.textContent = errText(result, '安装失败');
      if (result?.status !== 'waiting') hintUnlessShown('install-progress', progress.textContent);
    }
  } catch (error) {
    paintProgress('install-progress', { phase: 'error' });
    progress.textContent = errText(error, '安装失败');
    hintUnlessShown('install-progress', progress.textContent);
  } finally {
    installBusy = false;
    restoreInstall();
    btnCancel.hidden = true;
    syncLauncherState();
  }
}

function renderHomeStatus(status) {
  const launcherPackage = status?.launcherPackage === true;
  // In the slim package "当前版本" is the managed desktop's version, not the
  // launcher's own build number.
  const version = launcherPackage
    ? (status?.installed?.version || '')
    : (status?.version || status?.config?.appVersion || '');
  const last = status?.lastStart;
  const desktop = desktopOperation ? { state: desktopOperation.kind } : status?.desktop;
  const recovery = status?.recovery || status?.desktop?.pluginRecovery;
  const installedState = status?.installed;
  const missing = launcherPackage && installedState?.registeredInstall === false;
  const bits = missing ? ['尚未安装桌面端'] : [];
  $('home-version').textContent = version ? `v${String(version).replace(/^v/i, '')}` : (missing ? '待安装' : '已安装');
  if (!missing && desktop && desktop.state) {
    bits.push(`桌面端${desktopStateLabel(desktop.state)}`);
  }
  if (recovery?.skipUserPlugins) {
    bits.push('当前跳过用户插件');
  }
  if (!desktopActionBusy() && (desktopActionError || (!desktopIsRunning(desktop) && last?.ok === false))) {
    bits.push('启动或关闭未完成，详见启动诊断');
  } else if (!desktopActionBusy() && window.launcherRecovery?.skippedBuiltins?.(last)?.length) {
    bits.push('部分内置功能未加载，详见启动诊断');
  }
  if (desktopOperation) bits.push(`已等待 ${Math.floor((Date.now() - desktopOperation.startedAt) / 1000)} 秒`);
  const statusText = bits.join(' · ');
  if ($('home-status').textContent !== statusText) $('home-status').textContent = statusText;
  $('home-state-dot').dataset.state = desktopActionBusy() ? 'busy' : (desktopIsRunning(desktop) ? 'running' : 'stopped');
}

async function refreshStatus() {
  const api = pageShell();
  if (!api) return;
  const request = ++statusRequest;
  const status = await api.launcherStatus();
  if (request !== statusRequest) return;
  lastStatus = status;
  renderHomeStatus(status);
  renderInstallCard(status);
  renderRouteControls(status);
  renderVersionsHead(status);
  renderHomeRecovery(status);
  syncRecoveryActions(status);
  syncLauncherState(status);
  syncComponentsBadge();
  const config = status?.config || await api.getConfig();
  if (request !== statusRequest) return;
  $('opt-quit').checked = config.quitAfterStart !== false;
  $('opt-auto').checked = config.autoStartDesktop !== false;
  $('opt-ask').checked = config.askOnUpdate !== false;
  const trayRow = $('row-opt-tray');
  if (trayRow) {
    trayRow.hidden = status?.launcherPackage !== true;
    $('opt-tray').checked = config.closeToTray !== false;
  }
  // A late cold-start update result is parked in the main process until the
  // user actually looks at the launcher. Surface it like any other check.
  if (status?.pendingUpdateCheck) {
    renderUpdateCheck(status.pendingUpdateCheck);
  } else {
    syncUpdateNotice(lastUpdateCheck);
  }
}

function desktopActionBusy() {
  return Boolean(desktopOperation) || ['starting', 'stopping'].includes(lastStatus?.desktop?.state);
}

async function runDesktopAction(method, kind = 'starting', ...args) {
  const api = pageShell();
  if (desktopActionBusy() || typeof api?.[method] !== 'function') return;
  desktopOperation = { kind, startedAt: Date.now() };
  desktopActionError = '';
  ++statusRequest; // Ignore status reads issued before this operation.
  setHint('');
  const paint = () => {
    renderHomeStatus(lastStatus);
    renderHomeRecovery(lastStatus);
    syncRecoveryActions(lastStatus);
    syncLauncherState();
  };
  paint();
  // The start/stop button carries the spinner; the status line counts seconds.
  const timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    renderHomeStatus(lastStatus);
  }, 1000);
  let result;
  try {
    result = await api[method](...args);
    if (result?.ok === false) {
      desktopActionError = String(result.message || result.error || result.code || '操作未完成');
    } else if (method === 'disableSuspectsAndStart' && result?.harnessRestarted === false) {
      desktopActionError = `插件已禁用，但启动未完成：${errText(result.error)}`;
    }
  } catch (error) {
    desktopActionError = error?.message || String(error);
  } finally {
    clearInterval(timer);
    desktopOperation = null;
    try { await refreshStatus(); }
    catch { setHint('暂时无法读取桌面状态，请稍后重新打开首页。'); }
    paint();
    // A failed start or close raises no popup: the status line points at the
    // folded startup diagnostics, which hold the translated reason.
  }
  return result;
}

function pluginFailureKey(status, guidance) {
  const recovery = status?.recovery || status?.desktop?.pluginRecovery || status?.forensics?.recovery;
  const sticky = recovery?.skipUserPlugins === true;
  return JSON.stringify([sticky ? 'sticky' : 'full', sticky ? recovery.at : status?.lastStart?.at, guidance.kind, guidance.names]);
}

// Opened only by a click on the home guidance card: a failed start never
// raises this confirmation by itself.
async function askPluginRecovery(guidance) {
  if (!guidance || desktopActionBusy() || pluginGuidancePending) return;
  pluginGuidancePending = true;
  const key = pluginFailureKey(lastStatus, guidance);
  try {
    while (confirmResolve) await confirmClosed;
    const current = window.launcherRecovery.startupRecoveryGuidance(lastStatus);
    if (!current || key !== pluginFailureKey(lastStatus, current) || desktopActionBusy()) return;
    if (!(await appConfirm({ ...guidance, cancelText: '暂不处理' }))) return;
    const fresh = window.launcherRecovery.startupRecoveryGuidance(lastStatus);
    if (!fresh || key !== pluginFailureKey(lastStatus, fresh)) {
      await appNotice({ title: '排查结果已更新', body: ERROR_LABELS['suspects-changed'] });
      return;
    }
    const result = guidance.kind === 'disable'
      ? await runDesktopAction('disableSuspectsAndStart', 'starting', guidance.names)
      : await runDesktopAction('skipUserPlugins');
    // runDesktopAction already reported a failed disable or start on the home
    // page; only a completed start gets a result notice.
    if (!result && desktopActionError) return;
    if (guidance.kind !== 'disable' || !result) return;
    if (result.ok === false || result.harnessRestarted === false) return;
    if ((result.forensics?.recovery || lastStatus?.recovery || lastStatus?.desktop?.pluginRecovery)?.skipUserPlugins) {
      await appNotice({ title: '插件已禁用，仍需排查', body: `已禁用 ${guidance.names.join('、')}，WhaleIsle 仍以跳过用户插件模式启动。还有插件加载失败，请查看最新诊断；不会自动继续禁用其他插件。` });
    } else {
      await appNotice({ title: '已禁用并启动 WhaleIsle', body: `已禁用 ${guidance.names.join('、')}。未卸载插件或清理用户数据，可在「插件排查」中重新启用。` });
    }
  } finally {
    pluginGuidancePending = false;
  }
}

function syncRecoveryActions(status) {
  const lane = $('home-recovery-actions');
  if (!lane) {
    return;
  }
  const recovery = status?.recovery || status?.desktop?.pluginRecovery || status?.forensics?.recovery;
  const canRestore = recovery?.skipUserPlugins === true;
  const canSkip = !canRestore && (status?.forensics?.pluginTreeFailure === true
    || disableableSuspectNames(status?.forensics).length > 0);
  lane.hidden = $('home-recovery').hidden || (!canRestore && !canSkip);
  $('btn-skip').hidden = !canSkip;
  $('btn-retry-full').hidden = !canRestore;
}

function syncUpdateNotice(check) {
  const box = $('home-update');
  if (!box) {
    return;
  }
  const latest = check?.latest || check?.stableVersion || '';
  const failed = check?.status === 'error'
    || check?.status === 'none'
    || check?.status === 'current'
    || check?.status === 'skipped';
  const show = Boolean(latest) && !failed;
  if (!show) {
    updateNoticePanel?.hide();
    box.hidden = true;
  }
  if (show) {
    updateNoticePanel?.show({ reset: latest !== updateNoticeVersion, active: false });
    updateNoticeVersion = latest;
    const current = check?.currentVersion ? `（当前 v${String(check.currentVersion).replace(/^v/i, '')}）` : '';
    $('home-update-text').textContent = `可更新至 v${String(latest).replace(/^v/i, '')}${current}`;
  }
}

function renderUpdateCheck(check) {
  if (check && typeof check === 'object') {
    lastUpdateCheck = check;
  }
  // The update center's own state drives the notice in the desktop package.
  if (updateCenterApi()) return;
  syncUpdateNotice(check && typeof check === 'object' ? check : lastUpdateCheck);
}

// --- Update center (desktop package; docs/features/update-center.md) -------

// Set once the main process answers: the slim launcher package exposes the
// bridge without an update center behind it.
let centerReady = false;

function updateCenterApi() {
  return centerReady ? pageShell()?.updateCenter || null : null;
}

let centerView = null;

function adoptUpdateCenter(view) {
  const first = !centerReady;
  centerReady = true;
  renderCenterNotice(view);
  // Release rows rendered before the answer still carry per-row choices.
  if (first) void refreshReleases();
}

function centerNotice(view) {
  if (!view?.target) return null;
  const version = `v${view.target.version}`;
  const progress = view.progress;
  const percent = progress?.total ? ` · ${Math.floor((progress.received / progress.total) * 100)}%` : '';
  switch (view.phase) {
    case 'available': return { text: `可更新至 ${version}（当前 v${view.current}）`, action: '立即更新' };
    case 'downloading': return { text: `正在下载 ${version}${percent}`, action: '查看进度' };
    case 'paused': return { text: `${version} 下载已暂停${percent}`, action: '继续下载' };
    case 'verifying': return { text: `正在校验 ${version}`, action: '查看' };
    case 'ready': return { text: `${version} 已准备好，可以安装`, action: '安装并重启' };
    case 'installing': return { text: `正在安装 ${version}`, action: '查看' };
    case 'error': return { text: `${version} 更新未完成`, action: '查看原因' };
    default: return null;
  }
}

function renderCenterNotice(view) {
  centerView = view;
  const box = $('home-update');
  if (!box) return;
  const notice = centerNotice(view);
  if (!notice) {
    updateNoticePanel?.hide();
    box.hidden = true;
    return;
  }
  updateNoticePanel?.show({ reset: view.target.version !== updateNoticeVersion, active: false });
  updateNoticeVersion = view.target.version;
  $('home-update-text').textContent = notice.text;
  $('btn-home-update').textContent = notice.action;
}

/** Show the update center over the launcher, then run `action` there. */
async function openUpdateCenter(action, arg) {
  const center = updateCenterApi();
  if (!center) return false;
  try {
    await center.open();
    if (action) await center.command(action, arg);
  } catch (error) {
    setHint(errText(error, '无法打开更新'));
  }
  return true;
}

// A failed check or update is written under the check buttons, where the
// user is looking, instead of a floating notice.
function showUpdateFailure(text) {
  document.querySelectorAll('[data-update-fail]').forEach((node) => {
    node.textContent = text || '';
    node.hidden = !text;
  });
}

function reportUpdateNotice(notice) {
  if (notice.tone === 'error') showUpdateFailure(`${notice.title}：${notice.body}`);
  else void appNotice(notice);
}

function updateCheckNotice(check) {
  const version = check?.currentVersion || check?.current || (lastStatus?.launcherPackage ? lastStatus?.installed?.version : lastStatus?.version);
  if (check?.status === 'current') {
    return { title: '已是最新版本', body: version ? `当前版本 v${String(version).replace(/^v/i, '')}，已是最新版本。` : '当前已是最新版本。', tone: 'success' };
  }
  if (check?.status === 'installed') {
    return { title: '已安装', body: check.hint || '桌面端已安装，可以启动。', tone: 'success' };
  }
  if (check?.status === 'available') {
    return { title: '发现新版本', body: `最新版本 v${String(check.latest || check.stableVersion).replace(/^v/i, '')}。可在首页或版本管理中更新。` };
  }
  if (check?.status === 'none') {
    return { title: '暂无可用更新', body: check.hint || '未找到可用的发布版本，请稍后重新检查。' };
  }
  return { title: check?.status === 'error' ? '更新检查失败' : '更新检查未完成', body: check?.hint || errText(check, '未能获取更新结果，请检查网络后重试。'), tone: 'error' };
}

// --- Runtime state + components --------------------------------------------

function launcherState(status) {
  if (desktopActionBusy()) return desktopOperation?.kind || status?.desktop?.state;
  const desktop = status?.desktop;
  const recovery = status?.recovery || desktop?.pluginRecovery;
  const recoveryApi = window.launcherRecovery;
  if (recoveryApi?.shouldShowRecovery
    && recoveryApi.shouldShowRecovery(status?.lastStart, recovery, status?.forensics, desktop)) {
    return 'recovery';
  }
  if (desktopIsRunning(desktop)) {
    return 'running';
  }
  if (installBusy) {
    return 'downloading';
  }
  // Slim launcher package with no registered desktop install. In a full
  // package the bundled runtime is itself the desktop, so that mode never
  // reports notinstalled.
  if (status?.launcherPackage === true
    && Boolean(status?.installed)
    && status.installed.registeredInstall === false) {
    return 'notinstalled';
  }
  return 'installed';
}

const desktopButtonLabels = new WeakMap();

// Repaint a start/stop button: its caption, or a spinner and busy label while
// the desktop operation runs.
function syncDesktopButton(button, caption, busyLabel) {
  const current = desktopButtonLabels.get(button);
  if (current?.label === busyLabel && current?.caption === caption) return;
  current?.restore();
  desktopButtonLabels.delete(button);
  button.textContent = caption;
  button.setAttribute('aria-busy', busyLabel ? 'true' : 'false');
  if (busyLabel) desktopButtonLabels.set(button, { caption, label: busyLabel, restore: window.shellFeedback.buttonBusy(button, busyLabel) });
}

function syncDesktopControls() {
  const busy = desktopActionBusy();
  const stopping = desktopOperation?.kind === 'stopping' || lastStatus?.desktop?.state === 'stopping';
  const running = !busy && desktopIsRunning(lastStatus?.desktop);
  const start = $('btn-start');
  const stop = $('btn-stop');
  if (start) {
    // Controls are mutually exclusive: a running desktop offers only 关闭,
    // a stopped one only 启动 — reopening a dismissed window rides the tray.
    start.hidden = running || stopping;
    start.disabled = busy;
    const caption = desktopActionError || lastStatus?.lastStart?.ok === false ? '重试启动' : '启动桌面端';
    syncDesktopButton(start, caption, busy && !stopping ? '启动中…' : '');
    start.setAttribute('aria-label', busy && !stopping ? '正在启动桌面端…' : caption);
  }
  if (stop) {
    stop.hidden = !running && !stopping;
    stop.disabled = busy;
    syncDesktopButton(stop, '关闭桌面端', stopping ? '关闭中…' : '');
    stop.setAttribute('aria-label', stopping ? '正在关闭桌面端…' : '关闭桌面端');
  }
  for (const id of ['btn-skip', 'btn-retry-full', 'btn-disable-suspects', 'btn-recover-plugins']) {
    if ($(id)) $(id).disabled = busy || $(id).getAttribute('aria-busy') === 'true';
  }
  const runBadge = $('home-run-badge');
  if (runBadge) {
    runBadge.hidden = true;
  }
  const runNote = $('home-running-note');
  if (runNote) {
    runNote.hidden = false;
  }
}

function syncLauncherState(status) {
  if (status) {
    lastStatus = status;
  }
  document.body.dataset.launcherState = launcherState(lastStatus);
  syncDesktopControls();
}

function syncComponentsBadge() {
  const badgeNode = $('tab-badge-components');
  if (!badgeNode) {
    return;
  }
  const comps = lastStatus?.components;
  const rows = Array.isArray(comps?.items) ? comps.items : (Array.isArray(comps) ? comps : []);
  const count = rows.filter((row) => row && (row.updateAvailable === true || row.state === 'error')).length;
  badgeNode.hidden = count === 0;
  badgeNode.textContent = count ? String(count) : '';
}

function mountComponents() {
  if (componentsMounted) {
    return;
  }
  componentsMounted = true;
  const host = $('tab-components');
  if (!host) {
    return;
  }
  const mod = window.__launcherComponents;
  if (mod && typeof mod.mount === 'function') {
    try {
      mod.mount(host, pageShell());
      return;
    } catch (error) {
      // Fall through to the empty state; a broken components lane must not
      // take the launcher down.
      mount(host);
    }
  }
  mount(host,
    h('header', { class: 'page-head' }, h('h2', {}, '组件')),
    h('p', { class: 'lede lede-block' }, '组件列表由组件模块提供。'),
    h('div', { class: 'card' }, h('p', { class: 'row-meta' }, '组件模块尚未加载，暂无可用内容。')));
}

function activateTab(name) {
  showTab(name);
  if (name === 'home') {
    void refreshStatus();
    void window.__launcherComponents?.refresh();
  }
  if (name === 'import') {
    void refreshImport({ silent: true });
  }
  if (name === 'versions') {
    void refreshReleases();
  }
  if (name === 'plugins') {
    void refreshPlugins();
  }
}

async function checkUpdateNow() {
  if (await openUpdateCenter('check')) return;
  const api = pageShell();
  if (!api?.checkUpdate || updateCheckBusy) {
    return;
  }
  updateCheckBusy = true;
  showUpdateFailure('');
  const buttons = ['btn-check-update', 'btn-check-update-versions'].map((id) => $(id));
  const restore = buttons.map((button) => launcherButtonBusy(button, '正在检查更新…'));
  let notice;
  let result;
  try {
    result = await api.checkUpdate();
    updateNoticeVersion = '';
    renderUpdateCheck(result);
    notice = updateCheckNotice(result);
    void refreshStatus();
  } catch (error) {
    notice = { title: '更新检查失败', body: errText(error, '更新检查失败，请稍后重试。'), tone: 'error' };
  } finally {
    updateCheckBusy = false;
    restore.forEach((done) => done());
  }
  // A new version opens the inline update card; "nothing to do" outcomes
  // answer on the buttons themselves. Failures are written on the page; only
  // hints need a notice.
  if (notice.title === '发现新版本') return;
  if (!result?.hint && (result?.status === 'current' || result?.status === 'none')) {
    const label = result.status === 'current' ? '已是最新' : '暂无更新';
    buttons.forEach((button) => { if (button) window.shellFeedback.buttonDone(button, label); });
    return;
  }
  reportUpdateNotice(notice);
}
/** @param {string} kind @param {string} tag */
function installTagTitle(kind, tag) {
  return kind === 'update' ? `正在更新到 ${tag}` : `正在安装 ${tag}`;
}

/** @param {string} tag @param {string} kind @param {HTMLElement} [button] */
async function installTag(tag, kind, button) {
  if (tag && await openUpdateCenter('installVersion', tag)) return;
  const api = pageShell();
  if (!api || !tag || updateBusy) {
    return;
  }
  // The version button names its action; clicking it is the consent.
  updateBusy = true;
  const titleText = installTagTitle(kind, tag);
  const restoreButton = launcherButtonBusy(button, `${titleText}…`);
  progressPanels.get('update-progress')?.show({ reset: true });
  const progressTitle = $('update-progress-title');
  if (progressTitle) {
    progressTitle.textContent = titleText;
  }
  paintProgress('update-progress', { phase: 'resolve' });
  $('update-progress').textContent = '正在下载安装包…';
  try {
    const result = await api.installRelease(tag);
    if (result?.manualInstall) {
      paintProgress('update-progress', { phase: 'waiting' });
      $('update-progress').textContent = result.message || '已打开安装映像，请将 WhaleIsle 拖入 Applications 完成更新，完成后重新打开应用。';
      return;
    }
    if (result?.status === 'installed') {
      paintProgress('update-progress', { phase: 'done' });
      $('update-progress').textContent = `安装完成${result?.installed?.version ? `：v${result.installed.version}` : ''}`;
      void refreshStatus();
      return;
    }
    if (result?.cancelled) {
      paintProgress('update-progress', { phase: result.status === 'waiting' ? 'waiting' : 'cancelled' });
      $('update-progress').textContent = result.message || '已取消';
      return;
    }
    if (result?.status === 'waiting' || result?.status === 'quit-pending' || result?.launched === true || result?.ok === true) {
      paintProgress('update-progress', { phase: 'waiting' });
      $('update-progress').textContent = result.message || (result?.launched === true || result?.status === 'quit-pending'
        ? '安装向导已启动。请完成向导并留意系统授权提示，完成后刷新状态；尚未确认安装完成。'
        : '安装结果待确认。请检查安装向导与系统授权，完成后刷新状态。');
      return;
    }
    if (result && (result.status === 'error' || result.ok === false)) {
      paintProgress('update-progress', { phase: 'error' });
      $('update-progress').textContent = errText(result, '安装失败');
      hintUnlessShown('update-progress', $('update-progress').textContent);
    }
  } catch (error) {
    paintProgress('update-progress', { phase: 'error' });
    $('update-progress').textContent = errText(error, '安装失败');
    hintUnlessShown('update-progress', $('update-progress').textContent);
  } finally {
    updateBusy = false;
    restoreButton();
  }
}

/** @param {string} tag @param {HTMLElement} [button] */
async function installDelta(tag, button) {
  const api = pageShell();
  if (!api || typeof api.installDelta !== 'function' || !tag || updateBusy) {
    return;
  }
  updateBusy = true;
  const restoreButton = launcherButtonBusy(button, `正在增量更新到 ${tag}…`);
  progressPanels.get('update-progress')?.show({ reset: true });
  const title = $('update-progress-title');
  if (title) {
    title.textContent = `正在增量更新到 ${tag}`;
  }
  paintProgress('update-progress', { phase: 'resolve', mode: 'delta' });
  $('update-progress').textContent = '正在准备增量包…';
  try {
    const result = await api.installDelta(tag);
    const status = result?.status;
    if ((result?.mode === 'delta' && result?.ok === true) || status === 'applied' || status === 'installed') {
      paintProgress('update-progress', { phase: 'done', mode: result?.mode || 'delta' });
      const version = result?.installed?.version || result?.version || result?.to || tag;
      $('update-progress').textContent = result?.mode === 'full'
        ? `已完成安装：v${String(version).replace(/^v/i, '')}`
        : `已增量更新到 v${String(version).replace(/^v/i, '')}`;
      void refreshStatus();
      void refreshReleases();
      return;
    }
    if (result?.cancelled) {
      paintProgress('update-progress', { phase: status === 'waiting' ? 'waiting' : 'cancelled' });
      $('update-progress').textContent = result.message || '已取消';
      return;
    }
    if (result?.mode === 'full' && (status === 'waiting' || status === 'quit-pending' || status === 'fallback-full' || result?.launched === true || result?.ok === true)) {
      paintProgress('update-progress', { phase: 'waiting', mode: 'full' });
      $('update-progress').textContent = result.message || '安装结果待确认。请检查安装向导与系统授权，完成后刷新状态。';
      return;
    }
    paintProgress('update-progress', { phase: 'error', mode: 'delta' });
    $('update-progress').textContent = `${errText(result, '增量更新失败')}。可返回版本列表选择完全下载。`;
    hintUnlessShown('update-progress', $('update-progress').textContent);
  } catch (error) {
    paintProgress('update-progress', { phase: 'error' });
    $('update-progress').textContent = errText(error, '增量更新失败');
    hintUnlessShown('update-progress', $('update-progress').textContent);
  } finally {
    updateBusy = false;
    restoreButton();
  }
}
