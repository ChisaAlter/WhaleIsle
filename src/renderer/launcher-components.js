'use strict';

// Components panel module (lane C, refactor plan §5.0/§5.2). Lane A's
// launcher.html owns the <section id="panel-components"> container and the
// <script src="launcher-components.js"> tag; this file owns everything inside
// the container and mounts via window.__launcherComponents.mount(el, shell).
// Mounting twice is harmless — the second call just re-renders the list.
(function () {
  const state = {
    el: null,
    shell: null,
    unsubscribe: null,
    pending: new Set(),
    rows: new Map(),
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
    return kind ? badge(kind[0], kind[1]) : '';
  }

  function iconGlyph(row) {
    const name = String(row.name || row.id || '?').trim();
    return escapeHtml((name[0] || '?').toUpperCase());
  }

  function rowMeta(row) {
    const bits = [];
    if (row.description) {
      bits.push(row.description);
    }
    bits.push(`v${row.version || '?'}`);
    if (row.installedVersion && row.installedVersion !== row.version) {
      bits.push(`已装 v${row.installedVersion}`);
    }
    return escapeHtml(bits.join(' · '));
  }

  function rowDetail(row) {
    const bits = [];
    if (row.state === 'running' && row.pid) {
      bits.push(`PID ${row.pid}`);
    }
    if (row.state === 'running' && row.url) {
      bits.push(row.url);
    }
    if (row.updateAvailable) {
      bits.push(`有更新 v${row.version}`);
    }
    if (row.previousVersion) {
      bits.push(`可回滚 v${row.previousVersion}`);
    }
    if (row.message) {
      bits.push(row.message);
    }
    return bits.length ? escapeHtml(bits.join(' · ')) : '';
  }

  function rowActions(row) {
    if (state.pending.has(row.id)) {
      return '<span class="row-meta">操作进行中…</span>';
    }
    const buttons = [];
    const btn = (action, label, cls) => `<button type="button" class="${cls} small" data-comp-action="${action}" data-comp-id="${escapeHtml(row.id)}">${label}</button>`;
    if (row.state === 'available') {
      buttons.push(btn('install', '安装', 'primary'));
    } else if (row.state === 'running') {
      buttons.push(btn('stop', '停止', 'ghost'));
      if (row.updateAvailable) {
        buttons.push(btn('update', '更新', 'ghost'));
      }
      buttons.push(btn('uninstall', '卸载', 'danger'));
    } else {
      buttons.push(btn('start', row.state === 'error' ? '重试' : '运行', 'primary'));
      if (row.updateAvailable) {
        buttons.push(btn('update', '更新', 'ghost'));
      }
      if (row.previousVersion) {
        buttons.push(btn('rollback', '回滚', 'ghost'));
      }
      buttons.push(btn('uninstall', '卸载', 'danger'));
    }
    return buttons.join('');
  }

  function renderRows(payload) {
    const host = state.list;
    if (!host) {
      return;
    }
    const rows = payload && Array.isArray(payload.components) ? payload.components : [];
    state.rows = new Map(rows.map((row) => [row.id, row]));
    if (!rows.length) {
      host.innerHTML = '<li><span class="row-meta">暂无可安装的组件。</span></li>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const marks = [
        kindBadge(row),
        row.source === 'bundled' ? badge('官方签名', 'blue') : '',
        row.updateAvailable ? badge('可更新') : '',
        row.orphan ? badge('目录外组件', 'warn') : '',
      ].join('');
      const detail = rowDetail(row);
      return `<li class="comp-row" data-comp-row="${escapeHtml(row.id)}">
        <div class="row-main">
          <span class="comp-icon" aria-hidden="true">${iconGlyph(row)}</span>
          <div class="comp-copy">
            <div class="row-title">${escapeHtml(row.name || row.id)} ${marks}</div>
            <div class="row-meta">${rowMeta(row)}</div>
            ${detail ? `<div class="row-meta">${detail}</div>` : ''}
            <p class="progress" data-comp-progress hidden></p>
          </div>
        </div>
        <div class="comp-status">
          ${stateBadge(row)}
          <div class="row-actions">${rowActions(row)}</div>
        </div>
      </li>`;
    }).join('');
    host.querySelectorAll('[data-comp-action]').forEach((button) => {
      button.addEventListener('click', () => {
        void runAction(button.dataset.compAction, button.dataset.compId);
      });
    });
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
    } finally {
      state.pending.delete(id);
      void refresh();
    }
  }

  function onProgress(payload) {
    if (!payload || !payload.id) {
      return;
    }
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
    el.innerHTML = `
      <header class="page-head">
        <h2>组件</h2>
        <span class="head-line row-meta" data-comp-route hidden>当前线路 <b class="cur-line"></b></span>
      </header>
      <p class="lede lede-block">项目维护的独立工具与服务组件；进程独立于桌面端，文件与数据写在启动器自有目录，不进入桌面端插件名单。</p>
      <div class="actions">
        <button type="button" class="ghost" data-comp-refresh>刷新</button>
      </div>
      <ul class="list" data-comp-list></ul>
      <p class="progress" data-comp-hint hidden></p>`;
    state.list = el.querySelector('[data-comp-list]');
    state.hintNode = el.querySelector('[data-comp-hint]');
    el.querySelector('[data-comp-refresh]').addEventListener('click', () => void refresh());
    const routeNode = el.querySelector('[data-comp-route]');
    if (routeNode && state.shell && typeof state.shell.launcherStatus === 'function') {
      void state.shell.launcherStatus().then((status) => {
        const routes = Array.isArray(status?.routes) ? status.routes : [];
        const current = routes.find((route) => route.id === status?.downloadRoute);
        if (current) {
          routeNode.querySelector('.cur-line').textContent = current.label || current.id;
          routeNode.hidden = false;
        }
      }).catch(() => {});
    }
    if (state.shell && typeof state.shell.onComponentsProgress === 'function') {
      state.unsubscribe = state.shell.onComponentsProgress(onProgress);
    }
    void refresh();
  }

  window.__launcherComponents = { mount };
})();
