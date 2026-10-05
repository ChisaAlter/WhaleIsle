'use strict';

// Component selection, detail actions and the launcher's component overview.
(function () {
  const state = {
    el: null,
    shell: null,
    unsubscribe: null,
    pending: new Set(),
    rows: new Map(),
    selected: null,
    progress: new Map(),
    detail: null,
    list: null,
    hintNode: null,
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(text, variant) {
    return `<span class="badge${variant ? ` ${variant}` : ''}">${escapeHtml(text)}</span>`;
  }

  const STATE_LABELS = {
    available: '可安装',
    installed: '已安装',
    stopped: '已停止',
    running: '运行中',
    error: '异常',
  };

  const STATE_VARIANTS = {
    running: 'green',
    error: 'warn',
  };

  const KIND_LABELS = {
    service: ['服务', 'amber'],
    tool: ['工具', ''],
  };

  const PHASE_LABELS = {
    copy: '正在拷贝组件文件',
    verify: '正在校验组件',
    switch: '正在切换版本',
    spawn: '正在启动进程',
    wait: '正在等待组件就绪',
    stop: '正在停止进程',
    remove: '正在移除组件',
    retry: '进程退出，准备重启',
    done: '完成',
    error: '失败',
  };

  function stateBadge(row) {
    const label = STATE_LABELS[row.state] || row.state || '未知';
    return badge(label, STATE_VARIANTS[row.state] || '');
  }

  function kindBadge(row) {
    const kind = KIND_LABELS[row.kind] || (row.kind ? [row.kind, ''] : null);
    return kind ? badge(kind[0]) : '';
  }

  function iconGlyph(row) {
    const name = String(row.name || row.id || '?').trim();
    return escapeHtml((name[0] || '?').toUpperCase());
  }

  function rowActions(row) {
    const disabled = state.pending.has(row.id) ? ' disabled' : '';
    const buttons = [];
    const btn = (action, label, cls) => `<button type="button" class="${cls}" data-comp-action="${action}" data-comp-id="${escapeHtml(row.id)}"${disabled}>${label}</button>`;
    if (row.state === 'available') {
      buttons.push(btn('install', '安装组件', 'primary'));
    } else {
      buttons.push(row.state === 'running'
        ? btn('stop', '停止组件', 'primary')
        : btn('start', row.state === 'error' ? '重试运行' : '运行组件', 'primary'));
      if (row.updateAvailable) {
        buttons.push(btn('update', '更新', 'ghost'));
      }
      buttons.push(`<details class="more-operations"><summary>更多操作</summary><div class="more-menu">
        ${row.previousVersion ? btn('rollback', '回滚上一版本', 'ghost small') : ''}
        ${btn('uninstall', '卸载组件', 'danger small')}</div></details>`);
    }
    return buttons.join('');
  }

  function renderOverview() {
    const host = document.getElementById('home-components-list');
    if (!host) return;
    const rows = [...state.rows.values()];
    host.innerHTML = rows.length ? rows.map((row) => `<div class="overview-row">
      <span class="comp-icon" aria-hidden="true">${iconGlyph(row)}</span>
      <div><strong>${escapeHtml(row.name || row.id)}</strong><p>${escapeHtml(row.installedVersion ? `已安装 v${row.installedVersion}` : `可安装 v${row.version || '?'}`)}${row.updateAvailable ? ' · 有更新' : ''}</p></div>
      ${stateBadge(row)}</div>`).join('') : '<p class="row-meta">暂无可用组件。可在组件页刷新列表。</p>';
    const count = rows.filter((row) => row.updateAvailable || row.state === 'error').length;
    const badgeNode = document.getElementById('tab-badge-components');
    if (badgeNode) {
      badgeNode.hidden = count === 0;
      badgeNode.textContent = count ? String(count) : '';
    }
  }

  function renderDetail() {
    const row = state.rows.get(state.selected);
    if (!state.detail) return;
    if (!row) {
      state.detail.innerHTML = '<div class="component-empty"><h3>暂无可用组件</h3><p class="row-meta">刷新列表以查看可安装的独立工具与服务。</p></div>';
      return;
    }
    const field = (label, value, wide = false) => `<div${wide ? ' class="wide"' : ''}><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
    const progress = state.progress.get(row.id);
    state.detail.innerHTML = `<div class="component-detail-body" data-comp-row="${escapeHtml(row.id)}">
      <div class="component-heading"><div><h3>${escapeHtml(row.name || row.id)}</h3><div class="identity-tags">${kindBadge(row)}${row.source === 'bundled' ? badge('官方签名', 'blue') : badge(row.source || '已安装')}${row.orphan ? badge('目录外组件', 'warn') : ''}</div></div>${stateBadge(row)}</div>
      <p class="component-description">${escapeHtml(row.description || '由启动器管理的独立组件。')}</p>
      <dl class="component-metadata">${field('已安装版本', row.installedVersion ? `v${row.installedVersion}` : '尚未安装')}${field('可用版本', `v${row.version || '?'}`)}
      ${row.state === 'running' && row.pid ? field('进程 PID', row.pid) : ''}
      ${row.state === 'running' && row.url ? field('服务地址', row.url, true) : ''}</dl>
      ${row.updateAvailable ? '<p class="component-note">有新版本可用，更新时将停止当前组件进程。</p>' : ''}
      ${row.message ? `<p class="component-note" role="status">${escapeHtml(row.message)}</p>` : ''}
      <details class="component-info"><summary>组件详情</summary><dl class="component-metadata">${field('组件标识', row.id, true)}${row.previousVersion ? field('可回滚版本', `v${row.previousVersion}`) : ''}</dl><p class="row-meta">进程独立于桌面端。退出启动器会停止其监管的服务；卸载保留配置数据。</p></details>
      <p class="progress" data-comp-progress role="status"${progress ? '' : ' hidden'}>${escapeHtml(progress || '')}</p>
      </div><div class="action-strip">${rowActions(row)}</div>`;
    state.detail.querySelectorAll('[data-comp-action]').forEach((button) => {
      button.addEventListener('click', () => void runAction(button.dataset.compAction, button.dataset.compId));
    });
    state.detail.querySelector('.more-operations')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary').focus();
      }
    });
  }

  function renderRows(payload) {
    const host = state.list;
    if (!host) {
      return;
    }
    const rows = payload && Array.isArray(payload.components) ? payload.components : [];
    state.rows = new Map(rows.map((row) => [row.id, row]));
    if (!state.rows.has(state.selected)) state.selected = rows[0]?.id || null;
    host.innerHTML = rows.map((row) => {
      return `<li><button type="button" class="component-item" data-comp-select="${escapeHtml(row.id)}" aria-pressed="${row.id === state.selected}">
        <span class="comp-icon" aria-hidden="true">${iconGlyph(row)}</span><span class="comp-copy"><strong>${escapeHtml(row.name || row.id)}</strong><span class="row-meta">${row.updateAvailable ? '有更新可用' : (row.kind === 'tool' ? '独立工具' : '独立服务')}</span>${state.pending.has(row.id) ? badge('处理中') : stateBadge(row)}</span></button></li>`;
    }).join('');
    host.querySelectorAll('[data-comp-select]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selected = button.dataset.compSelect;
        host.querySelectorAll('[data-comp-select]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        renderDetail();
      });
    });
    renderDetail();
    renderOverview();
  }

  function setHint(text) {
    if (!state.hintNode) {
      return;
    }
    state.hintNode.hidden = !text;
    state.hintNode.textContent = text || '';
  }

  function progressNode(id) {
    return state.el?.querySelector(`[data-comp-row="${CSS.escape(id)}"] [data-comp-progress]`) || null;
  }

  function progressText(payload) {
    const label = PHASE_LABELS[payload?.phase] || payload?.phase || '处理中';
    const detail = payload?.message || '';
    const percent = payload?.percent === undefined || payload.phase === 'done' || payload.phase === 'error'
      ? ''
      : ` ${payload.percent}%`;
    return `${label}${percent}${detail ? `：${detail}` : ''}`;
  }

  async function refresh() {
    if (!state.shell || typeof state.shell.componentsList !== 'function') {
      return;
    }
    try {
      renderRows(await state.shell.componentsList());
    } catch (error) {
      setHint(typeof window.dshdErrText === 'function'
        ? window.dshdErrText(error, '组件列表读取失败')
        : '组件列表读取失败');
      const overview = document.getElementById('home-components-list');
      if (overview && !state.rows.size) overview.textContent = '组件列表读取失败，可在组件页重试刷新。';
    }
  }

  const ACTION_METHODS = {
    install: 'componentsInstall',
    start: 'componentsStart',
    stop: 'componentsStop',
    update: 'componentsUpdate',
    rollback: 'componentsRollback',
    uninstall: 'componentsUninstall',
  };

  const ACTION_ERRORS = {
    'invalid-id': '组件 id 无效。',
    'unknown-component': '组件目录中没有这个组件。',
    'unknown-version': '没有该版本可供安装。',
    'already-installed': '组件已安装，请使用更新。',
    'not-installed': '组件未安装。',
    'spawn-failed': '组件进程启动失败。',
    'early-exit': '组件启动后立即退出，详见组件日志。',
    'payload-missing': '组件负载缺失，请重新安装。',
    'no-newer-version': '已是最新版本。',
    'nothing-to-rollback': '没有可回滚的版本。',
    'rollback-payload-missing': '回滚版本已被清理，无法回滚。',
    busy: '该组件有操作进行中。',
  };

  async function runAction(action, id) {
    const method = ACTION_METHODS[action];
    if (!method || typeof state.shell?.[method] !== 'function' || state.pending.has(id)) {
      return;
    }
    const row = state.rows.get(id);
    const name = row?.name || id;
    if (action === 'uninstall' && typeof window.appConfirm === 'function') {
      const ok = await window.appConfirm({
        title: `卸载组件「${name}」`,
        body: `将停止并删除组件「${name}」及其程序文件，其配置数据会保留。此操作不可撤销。`,
        confirmText: '卸载',
        danger: true,
      });
      if (!ok) {
        return;
      }
    } else if (action === 'rollback' && typeof window.appConfirm === 'function') {
      const ok = await window.appConfirm({
        title: `回滚组件「${name}」`,
        body: `将把组件「${name}」回滚到上一个版本${row?.previousVersion ? `（v${row.previousVersion}）` : ''}，当前进程会先停止。`,
        confirmText: '回滚',
      });
      if (!ok) {
        return;
      }
    }
    state.pending.add(id);
    state.progress.set(id, '处理中…');
    renderRows({ components: [...state.rows.values()] });
    const progress = progressNode(id);
    if (progress) {
      progress.hidden = false;
      progress.textContent = '处理中…';
    }
    try {
      const result = await state.shell[method](id);
      if (result && result.ok === false) {
        const text = ACTION_ERRORS[result.error] || result.message || result.error || '操作失败';
        setHint(`${id}：${text}`);
        state.progress.set(id, text);
        if (progress) {
          progress.hidden = false;
          progress.textContent = text;
        }
      } else {
        setHint('');
      }
    } catch (error) {
      setHint(typeof window.dshdErrText === 'function'
        ? window.dshdErrText(error, '操作失败')
        : '操作失败');
      state.progress.set(id, state.hintNode.textContent);
    } finally {
      state.pending.delete(id);
      renderRows({ components: [...state.rows.values()] });
      void refresh();
    }
  }

  function onProgress(payload) {
    if (!payload || !payload.id) {
      return;
    }
    state.progress.set(payload.id, progressText(payload));
    const node = progressNode(payload.id);
    if (node) {
      node.hidden = false;
      node.textContent = progressText(payload);
    }
    if (payload.phase === 'done' || payload.phase === 'error') {
      void refresh();
    }
  }

  function mount(el, shell) {
    if (!el) {
      return;
    }
    if (state.el === el && state.shell === shell) {
      // Double-mount: keep the existing DOM/subscription, refresh data only.
      void refresh();
      return;
    }
    if (state.unsubscribe) {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.el = el;
    state.shell = shell || null;
    state.pending.clear();
    state.progress.clear();
    state.selected = null;
    el.innerHTML = `
      <header class="page-head">
        <h2>组件</h2>
        <button type="button" class="ghost small" data-comp-refresh>刷新列表</button>
      </header>
      <p class="lede lede-block component-lede">管理独立工具与服务，按需安装和运行。</p>
      <p class="hint" data-comp-hint role="status" hidden></p>
      <div class="component-layout"><aside class="component-list"><div class="list-label">可用组件</div><ul data-comp-list aria-label="组件列表"></ul><p class="row-meta list-footnote">组件独立于桌面端插件。</p></aside><section class="component-detail" aria-label="组件详情" data-comp-detail><p class="row-meta component-empty">正在读取组件…</p></section></div>`;
    state.list = el.querySelector('[data-comp-list]');
    state.detail = el.querySelector('[data-comp-detail]');
    state.hintNode = el.querySelector('[data-comp-hint]');
    el.querySelector('[data-comp-refresh]').addEventListener('click', () => void refresh());
    if (state.shell && typeof state.shell.onComponentsProgress === 'function') {
      state.unsubscribe = state.shell.onComponentsProgress(onProgress);
    }
    void refresh();
  }

  function syncStatus(snapshot) {
    if (!Array.isArray(snapshot) || !state.rows.size) return;
    const installed = new Map(snapshot.map((row) => [row.id, row]));
    const changed = [...state.rows.values()].some((row) => {
      const current = installed.get(row.id);
      return current ? row.state !== current.state || row.installedVersion !== current.version : Boolean(row.installedVersion);
    }) || snapshot.some((row) => !state.rows.has(row.id));
    if (changed) void refresh();
    else renderOverview();
  }

  window.__launcherComponents = { mount, syncStatus };
})();
