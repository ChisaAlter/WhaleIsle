'use strict';

// Update center overlay: renders the main-owned update snapshot and sends
// commands back. `describe()` is pure (copy + actions per state) and unit
// tested; the rest paints it.

(() => {
  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return `剩余约 ${Math.max(1, Math.round(seconds))} 秒`;
    if (seconds < 3600) return `剩余约 ${Math.ceil(seconds / 60)} 分钟`;
    return `剩余约 ${Math.floor(seconds / 3600)} 小时 ${Math.ceil((seconds % 3600) / 60)} 分钟`;
  }

  function formatClock(ms) {
    if (!ms) return '';
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  }

  function routeLabel(view, id) {
    return view.routes?.find((route) => route.id === id)?.label || id;
  }

  function sizeLine(view) {
    const plan = view.plan;
    if (!plan?.downloadBytes) return '';
    return `需下载 ${formatBytes(plan.downloadBytes)}`;
  }

  /**
   * @param {any} view
   * @param {any} progress
   * @param {string} prefix
   */
  function buildProgressLine(view, progress, prefix) {
    if (!progress?.total) return { percent: null, text: prefix, state: 'indeterminate' };
    const percent = Math.min(100, Math.floor((progress.received / progress.total) * 100));
    const parts = [`${formatBytes(progress.received)} / ${formatBytes(progress.total)}`];
    if (view.phase === 'downloading' && progress.bytesPerSecond > 0) parts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
    if (view.phase === 'downloading') parts.push(formatEta(progress.etaSeconds));
    if (view.phase === 'downloading' && progress.resumedFrom > 0) parts.push(`从 ${formatBytes(progress.resumedFrom)} 处继续`);
    if (progress.retrying) parts.push(`连接中断，正在重试（${progress.retrying.attempt}/${progress.retrying.maxAttempts}）`);
    return { percent, text: [prefix, ...parts].filter(Boolean).join(' · '), state: view.phase === 'paused' ? 'paused' : 'active' };
  }

  /**
   * @param {any} view
   * @param {any} target
   * @param {string} versionLine
   * @param {(prefix: string) => any} progressLine
   * @param {any} out
   */
  function describeErrorPhase(view, target, versionLine, progressLine, out) {
    const error = view.error || {};
    out.headline = target ? `v${target.version}` : `当前版本 v${view.current}`;
    out.subline = target ? versionLine : '';
    if (error.operation === 'download' && view.progress?.total) out.progress = { ...progressLine('已停止'), state: 'paused' };
    const problemActions = [];
    if (error.suggestRoute) {
      problemActions.push({ id: 'setRoute', arg: error.suggestRoute, label: `改用 ${routeLabel(view, error.suggestRoute)} 线路`, kind: 'secondary' });
    }
    const leadMap = /** @type {Record<string, string>} */ ({
      check: '检查更新失败',
      download: '下载未完成',
      install: '安装没有启动',
    });
    const lead = leadMap[String(error.operation || '')] || '更新失败';
    out.problem = {
      tone: 'error',
      text: `${lead}：${error.message || '未知原因'}${error.network ? '。网络连接不稳定或该线路暂时无法访问。' : ''}`,
      actions: problemActions,
    };
    if (error.operation === 'download') {
      out.actions = [{ id: 'resume', label: error.canResume ? '继续下载' : '重新下载', kind: 'primary' }];
      if (view.plan?.method === 'delta') out.actions.push({ id: 'downloadFull', label: '完整下载', kind: 'link' });
    } else if (error.operation === 'install') {
      out.actions = [{ id: target ? 'resume' : 'check', label: '重新下载并安装', kind: 'primary' }];
    } else {
      out.actions = [{ id: 'check', label: '重试', kind: 'primary' }];
    }
  }

  /**
   * @param {any} view
   * @param {any} target
   * @param {string} versionLine
   * @param {(prefix: string) => any} progressLine
   * @param {any} out
   */
  function describeActivePhase(view, target, versionLine, progressLine, out) {
    switch (view.phase) {
      case 'available':
        out.headline = `新版本 v${target.version}`;
        out.subline = versionLine;
        out.actions = [{ id: 'download', label: '下载更新', kind: 'primary' }];
        if (view.plan?.method === 'delta') {
          out.actions.push({ id: 'downloadFull', label: `完整下载（${formatBytes(view.plan.fullBytes)}）`, kind: 'link' });
        }
        return true;
      case 'downloading':
        out.headline = `正在下载 v${target.version}`;
        out.subline = versionLine;
        out.progress = progressLine(view.explicit ? '' : '后台下载');
        out.actions = [{ id: 'pause', label: '暂停', kind: 'primary' }, { id: 'cancel', label: '取消下载', kind: 'link' }];
        return true;
      case 'paused':
        out.headline = `已暂停 v${target.version}`;
        out.subline = versionLine;
        out.progress = progressLine('已暂停');
        out.actions = [{ id: 'resume', label: '继续下载', kind: 'primary' }, { id: 'cancel', label: '取消下载', kind: 'link' }];
        return true;
      case 'verifying':
        out.headline = `正在校验 v${target?.version || ''}`;
        out.subline = versionLine;
        out.progress = { percent: null, text: '正在核对安装包完整性（SHA512）…', state: 'indeterminate' };
        out.actions = [{ id: 'install', label: '正在校验…', kind: 'primary', disabled: true }];
        return true;
      case 'ready':
        out.headline = `v${target.version} 已准备好`;
        out.badge = { text: '可以安装', tone: 'ready' };
        out.subline = versionLine.replace(/ · 需下载 [^·]+$/, '');
        out.actions = [{ id: 'install', label: view.platform === 'darwin' ? '打开安装映像' : '安装并重启', kind: 'primary' }, { id: 'close', label: '稍后', kind: 'secondary' }];
        if (view.error?.manual) out.problem = { tone: 'info', text: view.error.message || '请在打开的安装映像中完成更新。', actions: [] };
        return true;
      case 'installing':
        out.headline = `正在安装 v${target?.version || ''}`;
        out.subline = '安装程序启动后，WhaleIsle 会自动退出并完成更新。';
        out.progress = { percent: null, text: '正在启动安装程序…', state: 'indeterminate' };
        out.actions = [{ id: 'install', label: '正在安装…', kind: 'primary', disabled: true }];
        return true;
      default:
        return false;
    }
  }

  /**
   * Copy and actions for one snapshot. Actions are { id, label, kind } where
   * kind is primary | secondary | link | danger.
   * @param {any} view
   */
  function describe(view) {
    const target = view.target;
    /** @type {any} */
    const out = {
      headline: '', badge: null, subline: '', progress: null, problem: null, actions: [], notes: Boolean(target),
    };
    const versionLine = target
      ? [formatDate(target.publishedAt) && `发布于 ${formatDate(target.publishedAt)}`, `当前 v${view.current}`, sizeLine(view)]
        .filter(Boolean).join(' · ')
      : '';
    /** @param {string} prefix */
    const progressLine = (prefix) => buildProgressLine(view, view.progress, prefix);

    if (view.phase === 'idle' || view.phase === 'current') {
      out.headline = view.phase === 'current' ? `已是最新版本 v${view.current}` : `当前版本 v${view.current}`;
      out.subline = view.checkedAt ? `上次检查 ${formatClock(view.checkedAt)} · 线路 ${routeLabel(view, view.route)}` : '';
      out.actions = [{ id: 'check', label: '检查更新', kind: 'primary' }];
    } else if (view.phase === 'checking') {
      out.headline = '正在检查更新…';
      out.subline = `当前 v${view.current} · 线路 ${routeLabel(view, view.route)}`;
      out.actions = [{ id: 'check', label: '正在检查…', kind: 'primary', disabled: true }];
    } else if (view.phase === 'error') {
      describeErrorPhase(view, target, versionLine, progressLine, out);
    } else if (!describeActivePhase(view, target, versionLine, progressLine, out)) {
      out.headline = `当前版本 v${view.current}`;
      out.actions = [{ id: 'check', label: '检查更新', kind: 'primary' }];
    }
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { describe, formatBytes, formatEta };
  }
  if (typeof window === 'undefined' || !window.whaleUpdateCenter) return;

  const api = window.whaleUpdateCenter;
  const $ = (id) => document.getElementById(id);
  /** @type {Parameters<typeof describe>[0] | null} */
  let view = null;
  let pending = false;
  let notesTab = 0;
  let lastNotes = '';
  let lastNotesTabsKey = '';
  /** @type {Array<{ label: string, text: string }>} */
  let currentNotes = [];
  let initialFocused = false;

  function applyScheme(scheme) {
    const dark = scheme === 'dark';
    document.documentElement.toggleAttribute('data-ds-dark-theme', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.toggleAttribute('data-ds-dark-theme', dark);
  }

  const params = new URLSearchParams(location.search);
  applyScheme(params.get('scheme'));
  document.documentElement.toggleAttribute('data-window-maximized', params.get('maximized') === '1');
  api.onTheme((theme) => applyScheme(theme?.scheme));
  api.onWindowState((state) => document.documentElement.toggleAttribute('data-window-maximized', Boolean(state?.maximized)));

  /** @param {any} action */
  function createActionButton(action) {
    const node = /** @type {HTMLButtonElement & { _action?: any }} */ (document.createElement('button'));
    node.type = 'button';
    node._action = action;
    node.dataset.actionKey = `${action.id}:${action.arg ?? ''}`;
    node.className = action.kind;
    node.textContent = action.label;
    node.disabled = Boolean(action.disabled) || pending;
    node.addEventListener('click', () => {
      const current = node._action;
      if (current) void run(current.id, current.arg);
    });
    return node;
  }

  /**
   * @param {HTMLElement | null} container
   * @param {any[]} actions
   */
  function syncActionButtons(container, actions) {
    if (!container) return;
    const existing = /** @type {Array<HTMLButtonElement & { _action?: any }>} */ ([...container.children]);
    const sameShape = existing.length === actions.length
      && actions.every((action, idx) => existing[idx]?.dataset?.actionKey === `${action.id}:${action.arg ?? ''}`);
    if (sameShape) {
      actions.forEach((action, idx) => {
        const node = existing[idx];
        node._action = action;
        if (node.className !== action.kind) node.className = action.kind;
        if (node.textContent !== action.label) node.textContent = action.label;
        node.disabled = Boolean(action.disabled) || pending;
      });
      return;
    }
    container.replaceChildren(...actions.map(createActionButton));
  }

  // A rejected proxy is an input problem, not a failed check: report it beside
  // the field, keep what the user typed, and leave the update state alone.
  const proxyInput = /** @type {HTMLInputElement} */ (document.getElementById('proxy'));
  const proxyError = /** @type {HTMLElement} */ (document.getElementById('proxy-error'));
  let proxyRejected = false;
  /** @param {string} message */
  function showProxyError(message) {
    proxyRejected = Boolean(message);
    proxyError.textContent = message;
    proxyError.hidden = !message;
    proxyInput.setAttribute('aria-invalid', String(proxyRejected));
  }

  /** @param {string} value */
  async function saveProxy(value) {
    if (pending) return;
    pending = true;
    try {
      render(await api.command('setProxy', value));
      showProxyError('');
    } catch (error) {
      // Same IPC prefix stripping as the launcher's error text.
      showProxyError(String(error instanceof Error ? error.message : error)
        .replace(/^Error invoking remote method '[^']*':\s*/i, '')
        .replace(/^Error:\s*/, ''));
    } finally {
      pending = false;
      if (view) render(view);
    }
  }

  async function run(id, arg) {
    if (id === 'close') { void api.close(); return; }
    if (pending) return;
    pending = true;
    try {
      render(await api.command(id, arg));
    } catch (error) {
      if (view) render({ ...view, phase: 'error', error: { operation: 'check', message: error?.message || String(error) } });
    } finally {
      pending = false;
      if (view) render(view);
    }
  }

  /**
   * @param {number} index
   * @param {boolean} [focus]
   */
  function selectNotesTab(index, focus = false) {
    const tabs = $('notes-tabs');
    const content = $('content');
    const notes = currentNotes;
    if (!tabs || !content || !notes.length) return;
    notesTab = Math.max(0, Math.min(index, notes.length - 1));
    const tabNodes = /** @type {HTMLButtonElement[]} */ ([...tabs.children]);
    const tabbed = notes.length >= 2;
    tabNodes.forEach((tab, i) => {
      const selected = i === notesTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    content.setAttribute('role', tabbed ? 'tabpanel' : 'region');
    if (tabbed && tabNodes[notesTab]?.id) {
      content.setAttribute('aria-labelledby', tabNodes[notesTab].id);
    } else {
      content.removeAttribute('aria-labelledby');
    }
    const text = notes[notesTab]?.text || '';
    const notesEl = $('notes');
    if (notesEl && notesEl.textContent !== text) notesEl.textContent = text;
    if (focus) tabNodes[notesTab]?.focus?.();
  }

  /** @param {any} target */
  function renderNotes(target) {
    const tabs = $('notes-tabs');
    const content = $('content');
    if (!tabs || !content) return;
    const notes = target?.notesTabs || [];
    currentNotes = notes;
    const key = JSON.stringify(notes.map((/** @type {any} */ tab) => tab.text));
    if (key !== lastNotes) { lastNotes = key; notesTab = 0; }
    const visible = notes.some((/** @type {any} */ tab) => tab.text);
    content.hidden = !visible;
    $('center')?.classList.toggle('has-notes', visible);
    const tabbed = visible && notes.length >= 2;
    tabs.hidden = !tabbed;
    const tabsKey = notes.length < 2 ? '' : JSON.stringify(notes.map((/** @type {any} */ tab) => tab.label));
    if (tabsKey !== lastNotesTabsKey) {
      lastNotesTabsKey = tabsKey;
      tabs.replaceChildren(...(notes.length < 2 ? [] : notes.map((/** @type {any} */ tab, /** @type {number} */ index) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.id = `notes-tab-${index}`;
        node.setAttribute('role', 'tab');
        node.setAttribute('aria-controls', 'content');
        node.textContent = tab.label;
        node.addEventListener('click', () => selectNotesTab(index));
        node.addEventListener('keydown', (event) => {
          let next = -1;
          if (event.key === 'ArrowRight') next = (index + 1) % currentNotes.length;
          else if (event.key === 'ArrowLeft') next = (index + currentNotes.length - 1) % currentNotes.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = currentNotes.length - 1;
          if (next < 0) return;
          event.preventDefault();
          selectNotesTab(next, true);
        });
        return node;
      })));
    }
    selectNotesTab(notesTab);
  }

  /**
   * @param {any[]} routes
   * @param {string} activeRoute
   * @param {boolean} disabled
   */
  function syncRoutes(routes, activeRoute, disabled) {
    const host = $('routes');
    if (!host) return;
    const list = routes || [];
    const existing = /** @type {Array<HTMLButtonElement & { _routeId?: string }>} */ ([...host.children]);
    const activeIndex = list.findIndex((route) => route.id === activeRoute);
    const focusIndex = activeIndex >= 0 ? activeIndex : 0;
    const sameShape = existing.length === list.length
      && list.every((route, idx) => existing[idx]?.dataset?.routeId === route.id);
    if (sameShape) {
      list.forEach((route, idx) => {
        const node = existing[idx];
        node._routeId = route.id;
        if (node.textContent !== route.label) node.textContent = route.label;
        const nextTitle = route.detail || '';
        if (node.title !== nextTitle) node.title = nextTitle;
        const checked = route.id === activeRoute;
        node.setAttribute('aria-checked', String(checked));
        node.tabIndex = idx === focusIndex ? 0 : -1;
        node.disabled = disabled;
      });
      return;
    }
    host.replaceChildren(...list.map((route, idx) => {
      const node = /** @type {HTMLButtonElement & { _routeId?: string }} */ (document.createElement('button'));
      node.type = 'button';
      node.setAttribute('role', 'radio');
      node.dataset.routeId = route.id;
      node._routeId = route.id;
      node.textContent = route.label;
      node.title = route.detail || '';
      node.setAttribute('aria-checked', String(route.id === activeRoute));
      node.tabIndex = idx === focusIndex ? 0 : -1;
      node.disabled = disabled;
      node.addEventListener('click', () => {
        if (node._routeId && node._routeId !== view?.route) void run('setRoute', node._routeId);
      });
      node.addEventListener('keydown', (event) => {
        const radios = /** @type {Array<HTMLButtonElement & { _routeId?: string }>} */ (
          [...host.querySelectorAll('[role="radio"]')].filter((el) => !(/** @type {HTMLButtonElement} */ (el)).disabled)
        );
        const pos = radios.indexOf(node);
        if (pos < 0 || !radios.length) return;
        let next = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (pos + 1) % radios.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (pos + radios.length - 1) % radios.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = radios.length - 1;
        if (next < 0) return;
        event.preventDefault();
        const target = radios[next];
        radios.forEach((el, i) => { el.tabIndex = i === next ? 0 : -1; });
        target.focus();
        if (target._routeId && target._routeId !== view?.route) void run('setRoute', target._routeId);
      });
      return node;
    }));
  }

  /** @param {any} next */
  function render(next) {
    view = next;
    const model = describe(view);
    $('headline').textContent = model.headline;
    $('badge').hidden = !model.badge;
    if (model.badge) { $('badge').textContent = model.badge.text; $('badge').dataset.tone = model.badge.tone; }
    $('subline').textContent = model.subline;
    $('subline').hidden = !model.subline;

    $('progress').hidden = !model.progress;
    if (model.progress) {
      $('progress').dataset.state = model.progress.state;
      $('bar-fill').style.transform = model.progress.percent === null
        ? 'scaleX(1)'
        : `scaleX(${model.progress.percent / 100})`;
      const bar = $('progress').querySelector('.bar');
      if (model.progress.percent === null) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(model.progress.percent));
      $('progress-text').textContent = model.progress.text;
    }

    $('problem').hidden = !model.problem;
    if (model.problem) {
      $('problem').dataset.tone = model.problem.tone;
      $('problem-text').textContent = model.problem.text;
      syncActionButtons($('problem-actions'), model.problem.actions);
    } else {
      syncActionButtons($('problem-actions'), []);
    }

    renderNotes(model.notes ? view.target : null);

    const routeDisabled = pending || view.phase === 'verifying' || view.phase === 'installing' || view.phase === 'checking';
    syncRoutes(view.routes, view.route, routeDisabled);
    $('auto-download').checked = Boolean(view.autoDownload);
    // Do not overwrite what the user is typing; the saved value is shown whenever the field is not focused.
    if (document.activeElement !== proxyInput && !proxyRejected) proxyInput.value = view.proxy || '';
    proxyInput.disabled = pending;
    $('auto-download').disabled = pending;
    syncActionButtons($('actions'), model.actions);
    document.body.classList.add('visible');
    if (!initialFocused) {
      initialFocused = true;
      $('center')?.focus?.();
    }
  }

  proxyInput.addEventListener('change', (event) => {
    const value = proxyInput.value.trim();
    if (value !== (view?.proxy || '')) void saveProxy(value);
    else showProxyError('');
  });
  proxyInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') proxyInput.blur(); });
  $('auto-download').addEventListener('change', (event) => { void run('setAutoDownload', event.target.checked); });
  $('close').addEventListener('click', () => { void api.close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void api.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const center = $('center');
    if (!center) return;
    const candidates = /** @type {HTMLElement[]} */ (
      [...center.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]):not(:disabled)')]
        .filter((el) => !(/** @type {HTMLElement} */ (el)).hidden && !el.closest?.('[hidden]'))
    );
    if (!candidates.length) return;
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    const current = active ? candidates.indexOf(active) : -1;
    const next = current < 0
      ? (event.shiftKey ? candidates.length - 1 : 0)
      : (current + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
    event.preventDefault();
    candidates[next]?.focus();
  });
  api.subscribe((/** @type {any} */ next) => { if (!pending) render(next); else view = next; });
  void api.state().then(render);
})();
