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
   * Copy and actions for one snapshot. Actions are { id, label, kind } where
   * kind is primary | secondary | link | danger.
   */
  function describe(view) {
    const mac = view.platform === 'darwin';
    const target = view.target;
    const progress = view.progress;
    const out = {
      headline: '', badge: null, subline: '', progress: null, problem: null, actions: [], notes: Boolean(target),
    };
    const versionLine = target
      ? [formatDate(target.publishedAt) && `发布于 ${formatDate(target.publishedAt)}`, `当前 v${view.current}`, sizeLine(view)]
        .filter(Boolean).join(' · ')
      : '';
    const progressLine = (prefix) => {
      if (!progress?.total) return { percent: null, text: prefix, state: 'indeterminate' };
      const percent = Math.min(100, Math.floor((progress.received / progress.total) * 100));
      const parts = [`${formatBytes(progress.received)} / ${formatBytes(progress.total)}`];
      if (view.phase === 'downloading' && progress.bytesPerSecond > 0) parts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
      if (view.phase === 'downloading') parts.push(formatEta(progress.etaSeconds));
      if (view.phase === 'downloading' && progress.resumedFrom > 0) parts.push(`从 ${formatBytes(progress.resumedFrom)} 处继续`);
      if (progress.retrying) parts.push(`连接中断，正在重试（${progress.retrying.attempt}/${progress.retrying.maxAttempts}）`);
      return { percent, text: [prefix, ...parts].filter(Boolean).join(' · '), state: view.phase === 'paused' ? 'paused' : 'active' };
    };

    switch (view.phase) {
      case 'idle':
      case 'current':
        out.headline = view.phase === 'current' ? `已是最新版本 v${view.current}` : `当前版本 v${view.current}`;
        out.subline = view.checkedAt ? `上次检查 ${formatClock(view.checkedAt)} · 线路 ${routeLabel(view, view.route)}` : '';
        out.actions = [{ id: 'check', label: '检查更新', kind: 'primary' }];
        break;
      case 'checking':
        out.headline = '正在检查更新…';
        out.subline = `当前 v${view.current} · 线路 ${routeLabel(view, view.route)}`;
        out.actions = [{ id: 'check', label: '正在检查…', kind: 'primary', disabled: true }];
        break;
      case 'available':
        out.headline = `新版本 v${target.version}`;
        out.subline = versionLine;
        out.actions = [{ id: 'download', label: '下载更新', kind: 'primary' }];
        if (view.plan?.method === 'delta') {
          out.actions.push({ id: 'downloadFull', label: `完整下载（${formatBytes(view.plan.fullBytes)}）`, kind: 'link' });
        }
        break;
      case 'downloading':
        out.headline = `正在下载 v${target.version}`;
        out.subline = versionLine;
        out.progress = progressLine(view.explicit ? '' : '后台下载');
        out.actions = [
          { id: 'pause', label: '暂停', kind: 'primary' },
          { id: 'cancel', label: '取消下载', kind: 'link' },
        ];
        break;
      case 'paused':
        out.headline = `已暂停 v${target.version}`;
        out.subline = versionLine;
        out.progress = progressLine('已暂停');
        out.actions = [
          { id: 'resume', label: '继续下载', kind: 'primary' },
          { id: 'cancel', label: '取消下载', kind: 'link' },
        ];
        break;
      case 'verifying':
        out.headline = `正在校验 v${target?.version || ''}`;
        out.subline = versionLine;
        out.progress = { percent: null, text: '正在核对安装包完整性（SHA512）…', state: 'indeterminate' };
        out.actions = [{ id: 'install', label: '正在校验…', kind: 'primary', disabled: true }];
        break;
      case 'ready':
        out.headline = `v${target.version} 已准备好`;
        out.badge = { text: '可以安装', tone: 'ready' };
        out.subline = versionLine.replace(/ · 需下载 [^·]+$/, '');
        out.actions = [
          { id: 'install', label: mac ? '打开安装映像' : '安装并重启', kind: 'primary' },
          { id: 'close', label: '稍后', kind: 'secondary' },
        ];
        if (view.error?.manual) out.problem = { tone: 'info', text: view.error.message || '请在打开的安装映像中完成更新。', actions: [] };
        break;
      case 'installing':
        out.headline = `正在安装 v${target?.version || ''}`;
        out.subline = '安装程序启动后，鲸屿会自动退出并完成更新。';
        out.progress = { percent: null, text: '正在启动安装程序…', state: 'indeterminate' };
        out.actions = [{ id: 'install', label: '正在安装…', kind: 'primary', disabled: true }];
        break;
      case 'error': {
        const error = view.error || {};
        out.headline = target ? `v${target.version}` : `当前版本 v${view.current}`;
        out.subline = target ? versionLine : '';
        if (error.operation === 'download' && progress?.total) out.progress = { ...progressLine('已停止'), state: 'paused' };
        const problemActions = [];
        if (error.suggestRoute) {
          problemActions.push({ id: 'setRoute', arg: error.suggestRoute, label: `改用 ${routeLabel(view, error.suggestRoute)} 线路`, kind: 'secondary' });
        }
        const lead = {
          check: '检查更新失败',
          download: '下载未完成',
          install: '安装没有启动',
        }[error.operation] || '更新失败';
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
        break;
      }
      default:
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
  let view = null;
  let pending = false;
  let notesTab = 0;
  let lastNotes = '';

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

  function button(action) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = action.kind;
    node.textContent = action.label;
    node.disabled = Boolean(action.disabled) || pending;
    node.addEventListener('click', () => run(action.id, action.arg));
    return node;
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

  function renderNotes(target) {
    const tabs = $('notes-tabs');
    const content = $('content');
    const notes = target?.notesTabs || [];
    const key = JSON.stringify(notes.map((tab) => tab.text));
    if (key !== lastNotes) { lastNotes = key; notesTab = 0; }
    const visible = notes.some((tab) => tab.text);
    content.hidden = !visible;
    $('center').classList.toggle('has-notes', visible);
    tabs.hidden = !visible || notes.length < 2;
    tabs.replaceChildren(...(notes.length < 2 ? [] : notes.map((tab, index) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.role = 'tab';
      node.textContent = tab.label;
      node.setAttribute('aria-selected', String(index === notesTab));
      node.addEventListener('click', () => { notesTab = index; renderNotes(target); });
      return node;
    })));
    $('notes').textContent = notes[notesTab]?.text || '';
  }

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
      $('bar-fill').style.width = model.progress.percent === null ? '100%' : `${model.progress.percent}%`;
      const bar = $('progress').querySelector('.bar');
      if (model.progress.percent === null) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(model.progress.percent));
      $('progress-text').textContent = model.progress.text;
    }

    $('problem').hidden = !model.problem;
    if (model.problem) {
      $('problem').dataset.tone = model.problem.tone;
      $('problem-text').textContent = model.problem.text;
      $('problem-actions').replaceChildren(...model.problem.actions.map(button));
    }

    renderNotes(model.notes ? view.target : null);

    $('routes').replaceChildren(...(view.routes || []).map((route) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.role = 'radio';
      node.textContent = route.label;
      node.title = route.detail || '';
      node.setAttribute('aria-checked', String(route.id === view.route));
      node.disabled = pending || view.phase === 'verifying' || view.phase === 'installing' || view.phase === 'checking';
      node.addEventListener('click', () => { if (route.id !== view.route) void run('setRoute', route.id); });
      return node;
    }));
    $('auto-download').checked = Boolean(view.autoDownload);
    $('auto-download').disabled = pending;
    $('actions').replaceChildren(...model.actions.map(button));
    document.body.classList.add('visible');
  }

  $('auto-download').addEventListener('change', (event) => { void run('setAutoDownload', event.target.checked); });
  $('close').addEventListener('click', () => { void api.close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); void api.close(); }
  });
  api.subscribe((next) => { if (!pending) render(next); else view = next; });
  void api.state().then(render);
})();
