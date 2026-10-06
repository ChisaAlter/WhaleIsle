'use strict';

function $(id) {
  return document.getElementById(id);
}

function pageShell() {
  return window.shell;
}

function setHint(text, opts = {}) {
  if (text) void appNotice({ title: opts.title || '提示', body: text });
}

// Keep the original caption in the layout; CSS draws the spinner over it.
function launcherButtonBusy(button, label = '正在处理…') {
  if (!button) return () => {};
  const disabled = button.disabled;
  const wasFocused = document.activeElement === button;
  const attributes = ['aria-busy', 'aria-label', 'title'].map((name) => [name, button.getAttribute(name)]);
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.setAttribute('aria-label', label);
  button.title = label;
  return () => {
    button.disabled = disabled;
    for (const [name, value] of attributes) {
      if (value === null) button.removeAttribute(name);
      else button.setAttribute(name, value);
    }
    if (wasFocused && document.activeElement === document.body && button.isConnected && !button.disabled && button.checkVisibility()) button.focus();
  };
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
  'install-in-progress': '已有安装任务进行中。',
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
  for (const [pattern, label] of ERROR_MESSAGE_PATTERNS) {
    if (pattern.test(text)) {
      return label;
    }
  }
  if (text && !/^[A-Za-z][\w./:-]*$/.test(text)) {
    return text;
  }
  if (ERROR_LABELS[text]) {
    return ERROR_LABELS[text];
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
  mask.classList.toggle('is-loading', loading);
  mask.hidden = false;
  const previousFocus = document.activeElement;
  (loading ? mask.querySelector('.modal-card') : cancelBtn.hidden ? okBtn : cancelBtn).focus();
  confirmClosed = new Promise((resolve) => {
    confirmResolve = (ok) => {
      confirmResolve = null;
      dialogLoading = false;
      mask.hidden = true;
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
      resolve(ok);
    };
  });
  return confirmClosed;
}

async function appNotice({ title = '提示', body }) {
  // A background result must not answer or replace a destructive confirmation.
  while (confirmResolve) await confirmClosed;
  return appConfirm({ title, body, cancelText: null });
}

function appProgress({ title, body }) {
  let owner = null;
  let closed = false;
  let text = body;
  void (async () => {
    while (confirmResolve) await confirmClosed;
    if (closed) return;
    void appConfirm({ title, body: text, loading: true });
    owner = confirmResolve;
  })();
  return {
    update(value) {
      text = value;
      if (owner && confirmResolve === owner) $('app-confirm-body').textContent = value;
    },
    close() {
      closed = true;
      if (owner && confirmResolve === owner) owner(true);
    },
  };
}

function settleConfirm(ok) {
  if (confirmResolve && !dialogLoading) {
    confirmResolve(ok);
  }
}

window.appConfirm = appConfirm;
window.appNotice = appNotice;
window.appProgress = appProgress;
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

function badge(text, warn) {
  return `<span class="badge${warn ? ' warn' : ''}">${text}</span>`;
}

function uninstallErrorHint(result) {
  if (result?.message) {
    return result.message;
  }
  const labels = {
    'source-run-no-install': '当前为源码运行，无本机安装包可卸载。请用「设置 → 应用」卸载已安装的 Whale Isle。',
    'uninstaller-not-found': '未找到卸载程序。请在「设置 → 应用」中卸载 Whale Isle。',
  };
  return labels[result?.error] || result?.error || '无法启动卸载程序';
}

function renderVersionLead(installed) {
  const version = installed?.version || '';
  const runningFromSource = Boolean(installed?.runningFromSource);
  const label = version
    ? `v${String(version).replace(/^v/i, '')}${runningFromSource ? ' · 源码运行' : ''}`
    : (runningFromSource ? '源码运行' : (installed?.registeredInstall === false ? '未安装' : '版本未知'));
  $('ver-num').textContent = label;
  const sub = $('ver-now-sub');
  if (sub) {
    if (installed?.installPath) {
      sub.textContent = `安装位置 ${installed.installPath}`;
      sub.hidden = false;
      sub.title = installed.installPath;
    } else {
      sub.textContent = '';
      sub.hidden = true;
      sub.title = '';
    }
  }
  const noteNode = $('installed-uninstall-note');
  const note = installed?.uninstallNote || '';
  if (note) {
    noteNode.textContent = note;
    noteNode.hidden = false;
  } else {
    noteNode.textContent = '';
    noteNode.hidden = true;
  }
  const btn = $('btn-uninstall-app');
  btn.textContent = installed?.uninstallUsesSettings ? '打开应用设置' : '卸载本机应用';
  const canUninstall = Boolean(installed?.uninstallAvailable);
  btn.hidden = !canUninstall;
  btn.disabled = !canUninstall;
  const foot = $('ver-foot');
  if (foot) {
    foot.hidden = !(note || canUninstall);
  }
}

function bindVersionActions(root) {
  root.querySelectorAll('[data-install-tag]').forEach((button) => {
    button.addEventListener('click', () => installTag(button.dataset.installTag, button.dataset.installKind));
  });
  root.querySelectorAll('[data-delta-tag]').forEach((button) => {
    button.addEventListener('click', () => installDelta(button.dataset.deltaTag));
  });
}

function releaseActionLabel(row) {
  if (row.current || !row.installable) {
    return null;
  }
  if (row.newer) {
    return '更新到此版本';
  }
  return '切换至此版本';
}

function releaseActionButtons(row, delta) {
  const parts = [];
  const label = releaseActionLabel(row);
  if (delta && label) {
    parts.push(`<button type="button" class="primary small" data-delta-tag="${escapeHtml(row.tag || '')}">增量更新</button>`);
  }
  if (label) {
    const kind = row.newer ? 'update' : 'switch';
    parts.push(`<button type="button" class="primary small" data-install-tag="${escapeHtml(row.tag || '')}" data-install-kind="${kind}">${label}</button>`);
  } else if (!row.current) {
    const reason = row.installable ? '不可用' : '无安装包';
    parts.push(`<button type="button" class="ghost small" disabled>${reason}</button>`);
  }
  return parts.join('');
}

const RELEASE_NOTES_LIMIT = 1200;

// Release bodies are markdown; the detail pane shows plain reading text.
function plainReleaseNotes(body) {
  return String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gm, '· ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function releaseDetailHtml(row, delta) {
  const meta = [];
  if (row.publishedAt) {
    meta.push(`发布于 ${String(row.publishedAt).slice(0, 10)}`);
  }
  if (row.assetName) {
    meta.push(`完整包 ${row.assetName}${row.assetSize ? ` · ${formatBytes(row.assetSize)}` : ''}`);
  } else {
    meta.push('无 Setup 安装包');
  }
  if (delta) {
    meta.push(`增量包 ${delta.assetName || ''}${delta.size ? ` · ${formatBytes(delta.size)}` : ''}`.trim());
  }
  const notes = plainReleaseNotes(row.notes);
  const clipped = notes.length > RELEASE_NOTES_LIMIT ? `${notes.slice(0, RELEASE_NOTES_LIMIT)}…` : notes;
  const actions = releaseActionButtons(row, delta);
  return `<div class="rel-detail" hidden>
    <div class="rel-detail-meta row-meta">${escapeHtml(meta.join(' · '))}</div>
    <p class="rel-notes">${clipped ? escapeHtml(clipped) : '该版本未提供更新说明。'}</p>
    ${actions ? `<div class="rel-detail-actions">${actions}</div>` : (row.current ? '<div class="row-meta">当前已安装此版本</div>' : '')}
  </div>`;
}

function renderReleases(payload) {
  renderVersionLead(payload?.installed);
  const list = $('release-list');
  const rows = payload && Array.isArray(payload.releases) ? payload.releases : [];
  const deltas = (payload && payload.deltas) || lastStatus?.deltas || {};
  const cachedDeltas = Array.isArray(deltas) ? deltas : (deltas.available || []);
  const deltaFor = (tag) => {
    if (!tag) {
      return null;
    }
    const hit = cachedDeltas.find((entry) => entry && entry.tag === tag);
    return hit || (Array.isArray(deltas) ? null : deltas[tag] || null);
  };
  const badgeEl = $('ver-badge');
  const cta = $('ver-cta');
  const updateRow = rows.find((row) => row && row.newer && row.installable)
    || rows.find((row) => row && row.newer);
  if (updateRow) {
    const delta = updateRow.delta || deltaFor(updateRow.tag);
    badgeEl.textContent = `发现新版本 ${updateRow.tag || updateRow.version || ''}`;
    badgeEl.className = 'badge blue';
    badgeEl.hidden = false;
    if (cta) {
      cta.innerHTML = releaseActionButtons(updateRow, delta);
      bindVersionActions(cta);
    }
  } else {
    const installed = payload && payload.installed;
    const known = Boolean(installed && installed.version) && rows.length > 0;
    badgeEl.textContent = known ? '已是最新' : '';
    badgeEl.className = 'badge green';
    badgeEl.hidden = !known;
    if (cta) {
      cta.innerHTML = '';
    }
  }
  if (!rows.length) {
    list.innerHTML = `<li><span class="row-meta">${escapeHtml(payload?.message || '暂无可列出的正式版。')}</span></li>`;
    return;
  }
  const latestIdx = rows.findIndex((row) => row && !row.prerelease);
  list.innerHTML = rows.map((row, index) => {
    const delta = row && row.newer ? (row.delta || deltaFor(row.tag)) : null;
    const marks = [
      index === latestIdx ? '<span class="badge green">最新</span>' : '',
      row.current ? badge('当前') : '',
      row.prerelease ? badge('预发布') : '',
      delta ? `<span class="badge blue">增量${escapeHtml(formatBytes(delta.size) ? ` ${formatBytes(delta.size)}` : '')}</span>` : '',
      row.installable ? '' : badge('无安装包', true),
    ].join('');
    const metaBits = [];
    if (row.publishedAt) {
      metaBits.push(String(row.publishedAt).slice(0, 10));
    }
    if (row.assetSize) {
      metaBits.push(formatBytes(row.assetSize));
    }
    return `<li class="rel-row">
      <button type="button" class="rel-line" data-rel-toggle aria-expanded="false">
        <span class="row-main">
          <span class="row-title">${escapeHtml(row.tag || row.version || '')} ${marks}</span>
          <span class="row-meta">${escapeHtml(metaBits.join(' · '))}</span>
        </span>
        ${row.current ? '<span class="row-meta">已安装</span>' : ''}
        <svg class="rel-chev" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 10.6 3.7 6.3l1.1-1.1L8 8.4l3.2-3.2 1.1 1.1z"/></svg>
      </button>
      ${releaseDetailHtml(row, delta)}
    </li>`;
  }).join('');
  list.querySelectorAll('[data-rel-toggle]').forEach((line) => {
    line.addEventListener('click', () => {
      const item = line.closest('li');
      const detail = item && item.querySelector('.rel-detail');
      if (!item || !detail) {
        return;
      }
      const open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      detail.hidden = !open;
      if (line.setAttribute) {
        line.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
    });
  });
  bindVersionActions(list);
}

function pluginErrorHint(code) {
  const recovery = window.launcherRecovery;
  if (recovery && typeof recovery.pluginErrorLabel === 'function') {
    return recovery.pluginErrorLabel(code);
  }
  const labels = {
    preset: '桌面预置插件不可移除。',
    'official-template': '官方模板插件不可禁用。',
    'desktop-builtin': '桌面内置组件不可禁用。',
    'missing-name': '缺少插件名称。',
    'missing-names': '缺少插件名称。',
  };
  return labels[code] || code || '操作失败';
}

function evidenceLines(forensics, name) {
  const rows = Array.isArray(forensics?.evidence) ? forensics.evidence : [];
  return rows.filter((row) => row.name === name).map((row) => row.line);
}

function pluginBoardRows(forensics, sortSuspectsFirst) {
  const plugins = Array.isArray(forensics?.plugins) ? forensics.plugins : [];
  const orphans = Array.isArray(forensics?.orphanSuspects) ? forensics.orphanSuspects : [];
  const rows = [...plugins, ...orphans];
  if (sortSuspectsFirst && window.launcherRecovery?.sortPluginRows) {
    return window.launcherRecovery.sortPluginRows(rows);
  }
  return rows;
}

function disableableSuspectNames(forensics) {
  return window.launcherRecovery.disableableSuspectNames(forensics);
}

function forensicsSummaryText(forensics) {
  if (!forensics) {
    return '尚未生成排查结果。';
  }
  if (forensics.genericCause) {
    const recovery = window.launcherRecovery;
    const labels = recovery?.GENERIC_LABELS || {
      oom: '检测到内存不足（OOM），与单个插件无关。',
      'port-excluded': '端口被系统保留或无权监听（listen EACCES），与插件无关，跳过用户插件无法修复。',
      'port-in-use': '检测到端口被占用，与单个插件无关。',
      'missing-node': '未找到 Node 运行时，与单个插件无关。',
    };
    return labels[forensics.genericCause] || String(forensics.genericCause);
  }
  if (forensics.desktopRuntimeDamage && window.launcherRecovery?.desktopRuntimeDamageVerdict) {
    return window.launcherRecovery.desktopRuntimeDamageVerdict(forensics);
  }
  if (forensics.suspects && forensics.suspects.length) {
    return `启动日志指向以下可疑插件：${forensics.suspects.map((row) => row.name || row).join('、')}。建议优先处理后再启动。`;
  }
  return '未能从日志确定具体插件。可逐项禁用下列插件后重新启动，以排查冲突。';
}

function renderPluginBoard(forensics, options = {}) {
  const list = $(options.listId);
  if (!list) {
    return;
  }
  if (options.summaryId) {
    const summary = $(options.summaryId);
    if (summary) {
      summary.textContent = options.summaryText || forensicsSummaryText(forensics);
    }
  }
  if (!forensics) {
    list.innerHTML = '<li><span class="row-meta">尚未扫描，点击「重新扫描」生成排查结果。</span></li>';
    return;
  }
  const allowRemove = options.allowRemove === true;
  const rows = pluginBoardRows(forensics, options.sortSuspectsFirst === true);
  if (!rows.length) {
    list.innerHTML = '<li><span class="row-meta">未检测到插件，当前插件环境为空。</span></li>';
    return;
  }
  list.innerHTML = rows.map((row) => {
    const marks = [
      row.inBox ? badge('内置组件', true) : (row.orphan ? badge('未在 profile 登记', true) : ''),
      row.officialTemplate ? badge('官方模板') : '',
      row.preset ? badge('桌面预置') : '',
      row.disabled ? badge('已禁用') : '',
      row.suspect ? badge('可疑冲突', true) : '',
    ].join('');
    let actions = '';
    if (row.inBox) {
      actions = '<span class="row-meta">桌面内置组件损坏；禁用或跳过均无效，需重装桌面端。</span>';
    } else if (row.orphan) {
      actions = '<span class="row-meta">日志中出现但未写入 profile，无法在此禁用。</span>';
    } else if (row.officialTemplate) {
      actions = '<span class="row-meta" title="官方模板插件不可禁用。">不可禁用</span>';
    } else if (row.disabled) {
      actions = `<button type="button" class="ghost small" data-enable="${escapeHtml(row.name)}">启用</button>`;
    } else {
      actions = `<button type="button" class="ghost small" data-disable="${escapeHtml(row.name)}">禁用</button>`;
    }
    if (allowRemove && !row.preset && !row.orphan) {
      // Slim packages ship no vendored plugin toolchain, so removal is
      // intentionally routed to the installed desktop app.
      actions += lastStatus?.launcherPackage === true
        ? '<span class="row-meta" title="轻量启动器不含插件工具链">需在桌面端内移除</span>'
        : `<button type="button" class="danger small" data-remove="${escapeHtml(row.name)}">移除</button>`;
    }
    const evidence = evidenceLines(forensics, row.name)
      .map((line) => `<div class="row-meta evidence">${escapeHtml(line)}</div>`)
      .join('');
    return `<li>
      <div class="row-main">
        <div class="row-title">${escapeHtml(row.name)} ${marks}</div>
        <div class="row-meta">${escapeHtml(row.spec || '')}</div>
        ${evidence}
      </div>
      <div class="row-actions">${actions}</div>
    </li>`;
  }).join('');
  list.querySelectorAll('[data-disable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('disablePlugin', button.dataset.disable, button));
  });
  list.querySelectorAll('[data-enable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('enablePlugin', button.dataset.enable, button));
  });
  list.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('removePlugin', button.dataset.remove, button));
  });
}

function renderPlugins(forensics) {
  renderPluginBoard(forensics, {
    listId: 'plugin-list',
    summaryId: 'forensics-summary',
    allowRemove: true,
    sortSuspectsFirst: true,
  });
}

function renderHomeRecovery(status) {
  const board = $('home-recovery');
  const forensics = status?.forensics;
  const recovery = status?.recovery || forensics?.recovery || status?.desktop?.pluginRecovery;
  const recoveryApi = window.launcherRecovery;
  const guidance = recoveryApi.startupRecoveryGuidance(status);
  const guidanceCard = $('home-plugin-guidance');
  guidanceCard.hidden = desktopActionBusy() || !guidance;
  if (guidance) {
    $('home-plugin-guidance-title').textContent = guidance.title;
    $('home-plugin-guidance-body').textContent = guidance.body;
    $('btn-recover-plugins').textContent = guidance.confirmText;
  }
  const show = !desktopActionBusy() && Boolean(desktopActionError || recovery?.skipUserPlugins
    || (!desktopIsRunning(status?.desktop)
      && recoveryApi?.shouldShowRecovery?.(status?.lastStart, recovery, forensics, status?.desktop)));
  board.hidden = !show;
  if (!show) {
    board.open = false;
    return;
  }
  const verdict = desktopActionError || (recoveryApi?.recoveryVerdict
    ? recoveryApi.recoveryVerdict(status?.lastStart, recovery, forensics) : '');
  if ($('home-recovery-verdict').textContent !== verdict) board.open = false;
  $('home-recovery-verdict').textContent = verdict;
  $('home-recovery-list').hidden = !forensics?.plugins?.length;
  renderPluginBoard(forensics, {
    listId: 'home-recovery-list',
    sortSuspectsFirst: true,
  });
  const suspects = disableableSuspectNames(forensics);
  const btn = $('btn-disable-suspects');
  btn.hidden = suspects.length === 0;
  btn.dataset.names = suspects.join('\0');
}

async function actPlugin(method, name, button) {
  const api = pageShell();
  if (!api || typeof api[method] !== 'function') {
    return;
  }
  const aligning = method === 'disablePlugin' || method === 'enablePlugin';
  const slimPackage = lastStatus?.launcherPackage === true;
  const restore = launcherButtonBusy(button, aligning ? '正在应用插件变更…' : '正在移除插件…');
  try {
    const result = await api[method](name);
    if (result && result.forensics) {
      renderPlugins(result.forensics);
      void refreshStatus();
    }
    if (result && result.ok === false) {
      setHint(pluginErrorHint(result.error));
      return;
    }
    if (aligning && result && result.harnessRestarted === false && result.error) {
      setHint(errText(result));
      return;
    }
    if (method === 'removePlugin' && result && result.kernelStopped) {
      setHint('桌面端已停止，请在首页重新启动。');
      void refreshStatus();
      return;
    }
    if (aligning) {
      setHint(slimPackage ? '已写入运行时配置，下次启动桌面端生效。' : '');
      void refreshStatus();
    }
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}

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
let promptedPluginFailure = '';
let statusRequest = 0;
let installBusy = false;
let updateBusy = false;
let updateCheckBusy = false;
let lastUpdateCheck = null;
let componentsMounted = false;

function routeLabel(routes, routeId) {
  const row = (Array.isArray(routes) ? routes : []).find((route) => route && route.id === routeId);
  return (row && row.label) || routeId || '';
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = size;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n >= 10 || unit === 0 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`;
}

function selectedRoute() {
  const picked = document.querySelector('#route-picker .line-card.is-sel');
  return picked ? picked.dataset.routePick : '';
}

// Route picks serialize: each new keypress is the latest intent and must be
// saved, even if a previous save is still in flight. A naive `value===prev`
// check drops the second pick when Right then Left fire before the status
// refresh re-renders the selection, so dedup compares only against the last
// value actually issued — never against the rendered selection.
let routeSaveGen = 0;
const lastIssuedRoute = { value: '' };

async function issueRouteSave(api, value, refreshStatus, setHint, errText) {
  const gen = ++routeSaveGen;
  lastIssuedRoute.value = value;
  try {
    const reply = await api.saveLauncherConfig({ downloadRoute: value });
    // A resolved refusal ({ok:false}) is as much a failure as a rejection:
    // the service declined the write (e.g. maintenance-in-progress). Treat
    // it identically — reset the marker and surface the error — instead of
    // returning success on a route that was never persisted.
    if (reply && reply.ok === false) {
      throw Object.assign(new Error(reply.error || 'save-refused'), { refused: true });
    }
    if (gen === routeSaveGen) {
      void refreshStatus();
    }
    return true;
  } catch (error) {
    // The save did not commit, so the issued marker must not keep pointing
    // at a route that never persisted — re-seed it to the value that is
    // actually selected. Otherwise a retry of the same route is deduped
    // away (`value === lastIssuedRoute`) and the user can never re-pick it.
    if (lastIssuedRoute.value === value) {
      lastIssuedRoute.value = selectedRoute();
    }
    if (gen === routeSaveGen) {
      setHint(errText(error, '设置保存失败'));
    }
    return false;
  }
}

/**
 * Radio-group arrow-key index step, extracted for direct testing: wraps
 * Left/Up and Right/Down through the enabled subset only. Returns -1 for a
 * key the radio group does not own, so the caller ignores it.
 */
function radioNextIndex(enabledList, currentIndex, key) {
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return currentIndex <= 0 ? enabledList.length - 1 : currentIndex - 1;
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return currentIndex < 0 || currentIndex >= enabledList.length - 1 ? 0 : currentIndex + 1;
  }
  return -1;
}

// Both the home card and the settings row render from the same status payload
// (status.routes / status.downloadRoute); unverified routes are visible but
// not selectable per plan ("标注未完成" before real-file verification).
function renderRouteControls(status) {
  const routes = Array.isArray(status?.routes) ? status.routes : [];
  const current = status?.downloadRoute || '';
  // Remember which route had focus so an innerHTML re-render (triggered by a
  // status refresh) can restore focus to the same logical option by id.
  const focusedPickerRoute = document.activeElement?.dataset?.routePick;
  const focusedSegRoute = document.activeElement?.dataset?.route;
  // Seed the issued marker with the freshly rendered selection so a re-pick
  // of the already-selected route is a no-op, while any different pick is
  // always issued even if the render is mid-burst stale.
  if (!lastIssuedRoute.value) {
    lastIssuedRoute.value = current;
  }
  const pickRoute = async (value, prev) => {
    // `prev` is what the render happened to show — stale as soon as a newer
    // pick was issued. The only true duplicate is re-issuing the value we
    // already issued most recently.
    if (!value || value === lastIssuedRoute.value) return;
    await issueRouteSave(pageShell(), value, refreshStatus, setHint, errText);
  };
  // Keyboard: arrows move AND select (radio-group semantics), skipping
  // disabled routes; focus and checked state stay in sync via the same pick.
  const radioKeyNav = (list, pick) => (event) => {
    const enabled = list.filter((b) => !b.disabled);
    const next = radioNextIndex(enabled, enabled.indexOf(document.activeElement), event.key);
    if (next >= 0 && next < enabled.length) {
      event.preventDefault();
      const target = enabled[next];
      target.focus();
      pick(target);
    }
  };
  const railRoute = $('rail-route');
  if (railRoute) {
    railRoute.textContent = routeLabel(routes, current) || '未选择';
  }
  const railPop = $('rail-route-pop');
  if (railPop) {
    renderRouteOptions(railPop, routes, current, async (picked) => {
      closeRoutePops();
      await pickDownloadRoute(picked, current);
    });
  }
  const picker = $('route-picker');
  if (picker) {
    picker.innerHTML = routes.map((route) => `
      <button type="button" role="radio"
        class="line-card${route.id === current ? ' is-sel' : ''}${route.verified ? '' : ' is-disabled'}"
        data-route-pick="${escapeHtml(route.id)}"
        aria-checked="${route.id === current ? 'true' : 'false'}"
        tabindex="${route.id === current ? '0' : '-1'}"
        ${route.verified ? '' : 'disabled'}>
        <span class="lc-title"><span class="lc-radio" aria-hidden="true"></span>${escapeHtml(route.label)}${route.verified ? '' : ' <span class="badge warn">未启用</span>'}</span>
        <span class="lc-desc">${escapeHtml(route.detail || '')}</span>
      </button>`).join('');
    picker.querySelectorAll('[data-route-pick]').forEach((button) => {
      button.addEventListener('click', () => pickRoute(button.dataset.routePick, current));
    });
    // Bind the container handler exactly once: re-rendering only replaces
    // innerHTML, so a handler re-added each render would stack and replay a
    // single keypress many times.
    if (!picker.dataset.navBound) {
      picker.dataset.navBound = '1';
      picker.addEventListener('keydown', (event) => {
        const buttons = [...picker.querySelectorAll('[data-route-pick]')];
        radioKeyNav(buttons, (b) => pickRoute(b.dataset.routePick, selectedRoute()))(event);
      });
      // Roving tabindex: whichever radio holds focus is the group's single
      // tab stop; arrows that move focus move the stop with them.
      picker.addEventListener('focusin', (event) => {
        if (!event.target?.dataset?.routePick) return;
        picker.querySelectorAll('[data-route-pick]').forEach((b) => {
          b.tabIndex = b === event.target ? 0 : -1;
        });
      });
    }
    // Restore focus to the same logical route after the re-render.
    if (focusedPickerRoute) {
      const again = picker.querySelector(`[data-route-pick="${CSS.escape(focusedPickerRoute)}"]`);
      if (again && !again.disabled) again.focus();
    }
  }
  const seg = $('route-seg');
  const segNote = $('route-seg-note');
  if (seg) {
    seg.innerHTML = routes.map((route) => `
      <button type="button" role="radio" class="seg${route.id === current ? ' is-active' : ''}"
        data-route="${escapeHtml(route.id)}" ${route.verified ? '' : 'disabled'}
        aria-checked="${route.id === current ? 'true' : 'false'}"
        tabindex="${route.id === current ? '0' : '-1'}"
        title="${escapeHtml(route.detail || '')}${route.verified ? '' : '（待验证）'}">${escapeHtml(route.label)}</button>`).join('');
    if (segNote) {
      const disabled = routes.filter((route) => !route.verified);
      segNote.hidden = disabled.length === 0;
      segNote.textContent = disabled.length
        ? disabled.map((route) => `${route.label}：待验证，暂不可用`).join('；')
        : '';
    }
    seg.querySelectorAll('[data-route]').forEach((button) => {
      button.addEventListener('click', () => pickRoute(button.dataset.route, current));
    });
    if (!seg.dataset.navBound) {
      seg.dataset.navBound = '1';
      seg.addEventListener('keydown', (event) => {
        const buttons = [...seg.querySelectorAll('[data-route]')];
        radioKeyNav(buttons, (b) => pickRoute(b.dataset.route, selectedRoute()))(event);
      });
      seg.addEventListener('focusin', (event) => {
        if (!event.target?.dataset?.route) return;
        seg.querySelectorAll('[data-route]').forEach((b) => {
          b.tabIndex = b === event.target ? 0 : -1;
        });
      });
    }
    if (focusedSegRoute) {
      const again = seg.querySelector(`[data-route="${CSS.escape(focusedSegRoute)}"]`);
      if (again && !again.disabled) again.focus();
    }
  }
}

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
  };
  if (payload?.phase === 'download') {
    if (payload.retrying) return `下载中断，正在重试（${payload.attempt}/${payload.maxAttempts}）…`;
    const size = Number.isFinite(payload.received) ? ` · ${(payload.received / 1048576).toFixed(1)} MB${payload.total > 0 ? ` / ${(payload.total / 1048576).toFixed(1)} MB` : ''}` : '';
    const speed = payload.bytesPerSecond > 0 ? ` · ${(payload.bytesPerSecond / 1048576).toFixed(2)} MB/s` : '';
    const percent = Number.isFinite(payload.percent) ? ` ${payload.percent}%` : '';
    return `${payload.differential ? '增量下载' : '下载'}${percent}${size}${speed}`;
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
  card.hidden = false;
  const phase = payload?.phase || '';
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
      bar.style.width = `${fill}%`;
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
    host.innerHTML = PHASE_STEPS.map((step, index) => {
      const cls = index < now ? ' done' : (index === now ? ' now' : '');
      return `<span class="phase${cls}"><i class="phase-dot"></i>${PHASE_LABELS[step]}</span>`;
    }).join('');
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
  const progress = $('install-progress');
  const title = $('install-progress-title');
  const btnInstall = $('btn-install-runtime');
  const btnCancel = $('btn-install-cancel');
  btnInstall.disabled = true;
  btnCancel.hidden = false;
  if (title) {
    title.textContent = '正在安装桌面端';
  }
  paintProgress('install-progress', { phase: 'resolve' });
  progress.textContent = '正在获取版本信息…';
  syncLauncherState();
  try {
    const result = await api.installRuntime({ route });
    if (result?.status === 'installed' || result?.ok === true) {
      paintProgress('install-progress', { phase: 'done' });
      progress.textContent = `安装完成${result?.installed?.version ? `：v${result.installed.version}` : ''}`;
      setHint('桌面端已安装，可启动。', { fade: true });
      void refreshStatus();
    } else if (result?.cancelled) {
      paintProgress('install-progress', { phase: result.status === 'waiting' ? 'waiting' : 'cancelled' });
      progress.textContent = result.message || '已取消';
    } else {
      paintProgress('install-progress', { phase: result?.status === 'waiting' ? 'waiting' : 'error' });
      progress.textContent = errText(result, '安装失败');
    }
  } catch (error) {
    paintProgress('install-progress', { phase: 'error' });
    progress.textContent = errText(error, '安装失败');
  } finally {
    installBusy = false;
    btnInstall.disabled = false;
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
  }
  if (desktopOperation) bits.push(`已等待 ${Math.floor((Date.now() - desktopOperation.startedAt) / 1000)} 秒`);
  $('home-status').textContent = bits.join(' · ');
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
  void maybePromptPluginRecovery();
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
  const timer = setInterval(() => renderHomeStatus(lastStatus), 1000);
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
  }
  return result;
}

function pluginFailureKey(status, guidance) {
  const recovery = status?.recovery || status?.desktop?.pluginRecovery || status?.forensics?.recovery;
  return JSON.stringify([status?.lastStart?.at, recovery?.at, guidance.kind, guidance.names]);
}

async function askPluginRecovery(guidance) {
  if (!guidance || desktopActionBusy() || pluginGuidancePending) return;
  pluginGuidancePending = true;
  const key = pluginFailureKey(lastStatus, guidance);
  try {
    while (confirmResolve) await confirmClosed;
    const current = window.launcherRecovery.startupRecoveryGuidance(lastStatus);
    if (!current || key !== pluginFailureKey(lastStatus, current) || desktopActionBusy()) return;
    promptedPluginFailure = key;
    if (!(await appConfirm({ ...guidance, cancelText: '暂不处理' }))) return;
    const fresh = window.launcherRecovery.startupRecoveryGuidance(lastStatus);
    if (!fresh || key !== pluginFailureKey(lastStatus, fresh)) {
      await appNotice({ title: '排查结果已更新', body: ERROR_LABELS['suspects-changed'] });
      return;
    }
    const progress = appProgress({
      title: guidance.kind === 'disable' ? '正在禁用插件并启动鲸屿' : '正在跳过用户插件启动',
      body: '正在应用插件恢复操作，请稍候。',
    });
    let result;
    try {
      result = guidance.kind === 'disable'
        ? await runDesktopAction('disableSuspectsAndStart', 'starting', guidance.names)
        : await runDesktopAction('skipUserPlugins');
    } finally {
      progress.close();
    }
    if (!result && desktopActionError) {
      await appNotice({ title: '启动未完成', body: errText(desktopActionError) });
      return;
    }
    if (guidance.kind !== 'disable' || !result) return;
    if (result.ok === false) {
      await appNotice({ title: '未能禁用插件', body: errText(result.error) });
    } else if (result.harnessRestarted === false) {
      await appNotice({ title: '插件已禁用，启动未完成', body: `已禁用 ${guidance.names.join('、')}，但鲸屿尚未启动成功。\n\n${errText(result.error)}` });
    } else if ((result.forensics?.recovery || lastStatus?.recovery || lastStatus?.desktop?.pluginRecovery)?.skipUserPlugins) {
      await appNotice({ title: '插件已禁用，仍需排查', body: `已禁用 ${guidance.names.join('、')}，鲸屿仍以跳过用户插件模式启动。还有插件加载失败，请查看最新诊断；不会自动继续禁用其他插件。` });
    } else {
      await appNotice({ title: '已禁用并启动鲸屿', body: `已禁用 ${guidance.names.join('、')}。未卸载插件或清理用户数据，可在「插件排查」中重新启用。` });
    }
  } finally {
    pluginGuidancePending = false;
  }
}

async function maybePromptPluginRecovery() {
  if (document.visibilityState !== 'visible' || !document.hasFocus()
    || desktopActionBusy() || pluginGuidancePending) return;
  const guidance = window.launcherRecovery.startupRecoveryGuidance(lastStatus);
  if (!guidance || promptedPluginFailure === pluginFailureKey(lastStatus, guidance)) return;
  await askPluginRecovery(guidance);
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
  box.hidden = !show;
  if (show) {
    const current = check?.currentVersion ? `（当前 v${String(check.currentVersion).replace(/^v/i, '')}）` : '';
    $('home-update-text').textContent = `可更新至 v${String(latest).replace(/^v/i, '')}${current}`;
  }
}

function renderUpdateCheck(check) {
  if (check && typeof check === 'object') {
    lastUpdateCheck = check;
  }
  syncUpdateNotice(check && typeof check === 'object' ? check : lastUpdateCheck);
}

function updateCheckNotice(check) {
  const version = check?.currentVersion || check?.current || (lastStatus?.launcherPackage ? lastStatus?.installed?.version : lastStatus?.version);
  if (check?.status === 'current') {
    return { title: '已是最新版本', body: version ? `当前版本 v${String(version).replace(/^v/i, '')}，已是最新版本。` : '当前已是最新版本。' };
  }
  if (check?.status === 'available') {
    return { title: '发现新版本', body: `最新版本 v${String(check.latest || check.stableVersion).replace(/^v/i, '')}。可在首页或版本管理中更新。` };
  }
  if (check?.status === 'none') {
    return { title: '暂无可用更新', body: check.hint || '未找到可用的发布版本，请稍后重新检查。' };
  }
  return { title: check?.status === 'error' ? '更新检查失败' : '更新检查未完成', body: check?.hint || errText(check, '未能获取更新结果，请检查网络后重试。') };
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
    start.textContent = busy ? '启动中…' : (desktopActionError || lastStatus?.lastStart?.ok === false ? '重试启动' : '启动桌面端');
  }
  if (stop) {
    stop.hidden = !running && !stopping;
    stop.disabled = busy;
    stop.textContent = stopping ? '关闭中…' : '关闭桌面端';
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
    runNote.hidden = !running;
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
      host.innerHTML = '';
    }
  }
  host.innerHTML = `<header class="page-head"><h2>组件</h2></header>
    <p class="lede lede-block">组件列表由组件模块提供。</p>
    <div class="card"><p class="row-meta">组件模块尚未加载，暂无可用内容。</p></div>`;
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
  const api = pageShell();
  if (!api?.checkUpdate || updateCheckBusy) {
    return;
  }
  updateCheckBusy = true;
  const restore = ['btn-check-update', 'btn-check-update-versions'].map((id) => launcherButtonBusy($(id), '正在检查更新…'));
  let notice;
  try {
    const result = await api.checkUpdate();
    renderUpdateCheck(result);
    notice = updateCheckNotice(result);
    void refreshStatus();
  } catch (error) {
    notice = { title: '更新检查失败', body: errText(error, '更新检查失败，请稍后重试。') };
  } finally {
    updateCheckBusy = false;
    restore.forEach((done) => done());
  }
  void appNotice(notice);
}

let importSourceHome;
const extraSkillDirs = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function skillSourceLabel(source) {
  if (source === 'home') {
    return '官方 home';
  }
  if (source === 'agents') {
    return '用户技能目录';
  }
  return '额外目录';
}

function pluginSkipLabel(reason) {
  if (reason === 'template') {
    return '官方模板，不重装';
  }
  if (reason === 'dropped') {
    return '已下架';
  }
  if (reason === 'local-spec') {
    return '本地 file / link / workspace，不重装';
  }
  if (reason === 'unsupported') {
    return '规格不受支持，无法自动重装';
  }
  return reason || '跳过';
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`)].map((node) => node.value);
}

function setGroupChecked(name, on) {
  document.querySelectorAll(`input[name="${name}"]:not(:disabled)`).forEach((node) => {
    node.checked = Boolean(on);
  });
}

const IMPORT_CATS = {
  sessions: { name: 'session-rel', hint: '按会话目录分组' },
  skills: { name: 'skill-id', hint: '官方 skills、用户技能根与额外目录' },
  plugins: { name: 'plugin-name', hint: '按名单重装，不拷 node_modules' },
  mcp: { name: 'mcp-id', hint: '按 id 合并，密钥不出现在界面' },
  settings: { name: 'setting-id', hint: '整节搬运白名单设置；API key 随模型配置落盘，不在界面显示' },
  presets: { name: 'preset-id', hint: '官方 .agent-presets 按目录拷贝' },
};

const SETTING_LABELS = {
  'llm-deepseek': 'DeepSeek 模型与提供方',
  'llm-pi-ai': '自定义提供方（pi-ai）',
  'agent-default-model': '默认模型',
  'vision-fallback': '视觉回退模型',
  'ui-theme': '主题与外观',
  'agents-md': '全局指令 AGENTS.md',
};

function settingRowMeta(row) {
  if (row.id === 'agents-md') {
    return 'home 级指令文件，逐字拷贝';
  }
  const refs = Array.isArray(row.credentialRefs) ? row.credentialRefs : [];
  if (refs.length) {
    return `settings.yaml 整节 · 同步 API key 引用 ${refs.join('、')}`;
  }
  return 'settings.yaml 整节';
}

let importCat = 'sessions';
let importHomeDir = '';
let importListRendered = false;

const IMPORT_COLLAPSE_AT = 8;

function sessionGroupKey(rel) {
  const text = String(rel || '');
  const slash = text.indexOf('/');
  return slash === -1 ? text : text.slice(0, slash);
}

function sessionItemTitle(rel) {
  const text = String(rel || '');
  const key = sessionGroupKey(text);
  return text.startsWith(`${key}/`) ? text.slice(key.length + 1) : text;
}

function shortenHomePath(cwd) {
  const home = String(importHomeDir || '').replace(/[/\\]+$/, '');
  const text = String(cwd || '');
  if (!text) {
    return '';
  }
  if (home && (text === home || text.startsWith(`${home}\\`) || text.startsWith(`${home}/`))) {
    const rest = text.slice(home.length).replace(/\\/g, '/');
    return rest ? `~${rest}` : '~';
  }
  return text.replace(/\\/g, '/');
}

function sessionGroupLabel(key, items) {
  const withCwd = (items || []).find((row) => row && row.cwd);
  if (withCwd && withCwd.cwd) {
    return shortenHomePath(withCwd.cwd);
  }
  if (key === '_no-cwd') {
    return '无工作区';
  }
  if (/^--.+--$/.test(key)) {
    return `工作区（路径编码） ${key.slice(2, -2)}`;
  }
  return key || '未分组';
}

function sessionRowTitle(row) {
  return (row && (row.title || row.id)) || sessionItemTitle(row && row.rel);
}

function formatCreatedAt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return '';
  }
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

function sessionRowMeta(row) {
  const notes = [];
  if (row.id) {
    notes.push(row.id);
  }
  const when = formatCreatedAt(row.createdAt);
  if (when) {
    notes.push(when);
  }
  if (row.mixedEncoding) {
    notes.push('编码混用');
  }
  if (row.unsupported) {
    notes.push('不兼容旧库');
  }
  if (row.compressedLog) {
    notes.push('压缩日志未解析');
  }
  return notes.join(' · ');
}

function countChecked(name) {
  return document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`).length;
}

function countBoxes(name) {
  return document.querySelectorAll(`input[name="${name}"]`).length;
}

function showImportCat(name) {
  if (!IMPORT_CATS[name]) {
    return;
  }
  importCat = name;
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    const on = button.dataset.importCat === name;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('[data-import-pane]').forEach((pane) => {
    const on = pane.dataset.importPane === name;
    pane.classList.toggle('is-active', on);
    pane.hidden = !on;
  });
  $('import-board-hint').textContent = IMPORT_CATS[name].hint;
}

function syncImportSummary() {
  const sessionsChecked = countChecked('session-rel');
  const skillsChecked = countChecked('skill-id');
  const pluginsChecked = countChecked('plugin-name');
  const mcpChecked = countChecked('mcp-id');
  const settingsChecked = countChecked('setting-id');
  const presetsChecked = countChecked('preset-id');
  $('import-sessions-count').textContent = `${sessionsChecked}/${countBoxes('session-rel')}`;
  $('import-skills-count').textContent = `${skillsChecked}/${countBoxes('skill-id')}`;
  $('import-plugins-count').textContent = `${pluginsChecked}/${countBoxes('plugin-name')}`;
  $('import-mcp-count').textContent = `${mcpChecked}/${countBoxes('mcp-id')}`;
  $('import-settings-count').textContent = `${settingsChecked}/${countBoxes('setting-id')}`;
  $('import-presets-count').textContent = `${presetsChecked}/${countBoxes('preset-id')}`;
  // Selection counts live on their own line — they must never overwrite the
  // persistent terminal summary in #import-result.
  const selLine = $('import-selection-line');
  if (selLine) {
    selLine.textContent = `已选 会话 ${sessionsChecked} · 技能 ${skillsChecked} · 插件 ${pluginsChecked} · MCP ${mcpChecked} · 设置 ${settingsChecked} · 预设 ${presetsChecked}`;
  }
}

function syncSessionClusters() {
  const host = $('import-sessions');
  host.querySelectorAll('[data-import-cluster]').forEach((input) => {
    const key = input.dataset.importCluster;
    const boxes = [...host.querySelectorAll('input[name="session-rel"]')]
      .filter((node) => !node.disabled && sessionGroupKey(node.value) === key);
    const selected = boxes.filter((node) => node.checked).length;
    input.checked = boxes.length > 0 && selected === boxes.length;
    input.indeterminate = selected > 0 && selected < boxes.length;
  });
}

function setSessionGroupExpanded(key, expanded) {
  const host = $('import-sessions');
  const fold = host.querySelector(`[data-import-fold="${CSS.escape(key)}"]`);
  if (fold) {
    fold.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    fold.classList.toggle('is-collapsed', !expanded);
  }
  host.querySelectorAll(`[data-import-group-item="${CSS.escape(key)}"]`).forEach((node) => {
    node.hidden = !expanded;
  });
}

function captureImportSelections() {
  if (!importListRendered) {
    return null;
  }
  return {
    'session-rel': new Set(checkedValues('session-rel')),
    'skill-id': new Set(checkedValues('skill-id')),
    'plugin-name': new Set(checkedValues('plugin-name')),
    'mcp-id': new Set(checkedValues('mcp-id')),
    'setting-id': new Set(checkedValues('setting-id')),
    'preset-id': new Set(checkedValues('preset-id')),
  };
}

function captureSessionFoldState() {
  const folded = new Map();
  $('import-sessions').querySelectorAll('[data-import-fold]').forEach((button) => {
    folded.set(button.dataset.importFold, button.getAttribute('aria-expanded') !== 'false');
  });
  return folded;
}

function shouldCheckImportItem(selections, name, value, defaultChecked) {
  if (!selections || !selections[name]) {
    return defaultChecked;
  }
  return selections[name].has(value);
}

function renderSessionList(rows, options = {}) {
  const selections = options.selections;
  const foldState = options.foldState;
  const host = $('import-sessions');
  if (!rows.length) {
    host.innerHTML = '<li><span class="row-meta">没有可列出的项。</span></li>';
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = sessionGroupKey(row.rel);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  const html = [];
  const groupEntries = [...groups.entries()].sort((left, right) => {
    const rank = (items) => {
      let score = 0;
      if (items.some((row) => row && row.title)) {
        score += 2;
      }
      if (items.some((row) => row && row.cwd)) {
        score += 1;
      }
      return score;
    };
    const byRank = rank(right[1]) - rank(left[1]);
    if (byRank !== 0) {
      return byRank;
    }
    return sessionGroupLabel(left[0], left[1]).localeCompare(sessionGroupLabel(right[0], right[1]), 'zh');
  });
  for (const [key, items] of groupEntries) {
    const enabled = items.filter((row) => !row.unsupported);
    const expanded = foldState?.has(key)
      ? foldState.get(key)
      : items.length < IMPORT_COLLAPSE_AT;
    const label = sessionGroupLabel(key, items);
    html.push(`<li class="import-cluster">
      <div class="import-cluster-head">
        <button type="button" class="import-fold${expanded ? '' : ' is-collapsed'}" data-import-fold="${escapeHtml(key)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="折叠或展开分组">
          <svg class="import-fold-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.2 3.2 10.8 8 6.2 12.8 5.2 11.8 8.8 8 5.2 4.2z"/></svg>
        </button>
        <label class="check-row">
          <input type="checkbox" data-import-cluster="${escapeHtml(key)}" ${enabled.length ? 'checked' : 'disabled'} />
          <span class="row-main">
            <span class="row-title">${escapeHtml(label)}</span>
            <span class="row-meta">${items.length} 项</span>
          </span>
        </label>
      </div>
    </li>`);
    for (const row of items) {
      const disabled = Boolean(row.unsupported);
      const checked = !disabled && shouldCheckImportItem(selections, 'session-rel', row.rel, true);
      html.push(`<li class="import-item" data-import-group-item="${escapeHtml(key)}"${expanded ? '' : ' hidden'}>
        <label class="check-row">
          <input type="checkbox" name="session-rel" value="${escapeHtml(row.rel)}" ${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''} />
          <span class="row-main">
            <span class="row-title">${escapeHtml(sessionRowTitle(row))}${disabled ? badge('不兼容', true) : (row.conflict ? badge('已存在') : '')}</span>
            <span class="row-meta">${escapeHtml(sessionRowMeta(row))}</span>
          </span>
        </label>
      </li>`);
    }
  }
  host.innerHTML = html.join('');
}

function renderCheckList(targetId, rows, options) {
  const host = $(targetId);
  const selections = options.selections;
  if (!rows.length) {
    host.innerHTML = '<li><span class="row-meta">没有可列出的项。</span></li>';
    return;
  }
  host.innerHTML = rows.map((row) => {
    const disabled = options.disabled(row);
    const defaultChecked = !disabled;
    const checked = shouldCheckImportItem(selections, options.name, options.value(row), defaultChecked);
    const marks = typeof options.marks === 'function' ? options.marks(row) : '';
    return `<li>
      <label class="check-row">
        <input type="checkbox" name="${options.name}" value="${escapeHtml(options.value(row))}" ${disabled ? 'disabled' : ''} ${checked ? 'checked' : ''} />
        <span class="row-main">
          <span class="row-title">${escapeHtml(options.title(row))}${disabled ? badge(options.skipLabel(row), true) : ''}${marks}${!disabled && row.conflict ? badge('已存在') : ''}</span>
          <span class="row-meta">${escapeHtml(options.meta(row))}</span>
        </span>
      </label>
    </li>`;
  }).join('');
}

function scanOptions() {
  return {
    sourceHome: importSourceHome,
    extraSkillDirs: extraSkillDirs.slice(),
  };
}

function countStatus(rows, status) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row.status === status).length;
}

const IMPORT_PHASE_LABELS = {
  sessions: '会话',
  attachments: '附件',
  skills: '技能',
  plugins: '插件',
  presets: '预设',
};

function importProgressText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (payload.phase === 'done') {
    return '导入完成。';
  }
  if (payload.phase === 'cancelled') {
    return '已取消。';
  }
  if (payload.phase === 'blocked') {
    return '导入被阻止：存在未完成的事务需要恢复。';
  }
  const label = IMPORT_PHASE_LABELS[payload.phase];
  if (!label) {
    return '';
  }
  const item = payload.rel || payload.id || payload.name || '';
  return `正在导入${label} ${payload.done}/${payload.total}${item ? `：${item}` : ''}`;
}

function summarizeImport(result) {
  if (!result) {
    return '没有返回结果。';
  }
  if (result.cancelled) {
    return '导入已取消。已拷贝的内容保留，下次可按原规则续导（已存在的会跳过）。';
  }
  if (result.empty) {
    return '未选择任何项，没有写入桌面 home。';
  }
  // Surface the service's top-level refusal reason first — a resolved
  // ok:false with a capability/recovery/ambiguity error must explain itself
  // rather than collapse into a generic "incomplete" line.
  const refusalText = {
    'slim-import-unsupported': '当前为精简启动器：无法安全地停止并隔离正在运行的桌面端，导入已拒绝。请打开完整桌面端启动器执行导入。',
    'import-recovery-blocked': '检测到未完成的导入事务，已阻止本次导入以免破坏数据。请先重启桌面端让恢复流程完成，或检查导入目录中的残留事务。',
    'ambiguous-destination': '所选技能存在同名目标目录且来自不同来源，必须每个目标只保留一个来源。请取消其中冲突项后重试。',
    'transaction-needs-recovery': '导入过程中发生需要人工恢复的替换失败，已停止后续写入。请重启桌面端完成恢复后再导入。',
    'shutdown-committed': '应用正在退出，导入已取消。',
    'import-in-progress': '已有导入任务进行中。',
  }[result.error];
  const lines = [
    refusalText,
    `会话 已拷 ${countStatus(result.sessions, 'copied')} · 跳过 ${countStatus(result.sessions, 'skipped')} · 拒绝 ${countStatus(result.sessions, 'rejected')}`,
    `技能 已拷 ${countStatus(result.skills, 'copied')} · 跳过 ${countStatus(result.skills, 'skipped')} · 拒绝 ${countStatus(result.skills, 'rejected')}`,
    `插件 已装 ${countStatus(result.plugins, 'installed')} · 跳过 ${countStatus(result.plugins, 'skipped')} · 失败 ${countStatus(result.plugins, 'failed')}`,
    `MCP 已写入 ${countStatus(result.mcp, 'copied')} · 跳过 ${countStatus(result.mcp, 'skipped')} · 拒绝 ${countStatus(result.mcp, 'rejected')}`,
    `设置 已写入 ${countStatus(result.settings, 'copied')} · 跳过 ${countStatus(result.settings, 'skipped')} · 凭据引用 已同步 ${countStatus(result.credentials, 'copied')} · 跳过 ${countStatus(result.credentials, 'skipped')}`,
    `预设 已拷 ${countStatus(result.presets, 'copied')} · 跳过 ${countStatus(result.presets, 'skipped')} · 拒绝 ${countStatus(result.presets, 'rejected')}`,
    `附件 ${result.attachments || 'absent'}`,
  ].filter(Boolean);
  const totalFailed = ['sessions', 'skills', 'plugins', 'mcp', 'settings', 'credentials', 'presets']
    .reduce((n, key) => n + countStatus(result[key], 'failed'), 0)
    + (typeof result.attachments === 'string' && result.attachments.startsWith('failed:') ? 1 : 0);
  if (totalFailed > 0) {
    lines.push(`共 ${totalFailed} 项失败。`);
    // Item-level failures: name + reason, capped so a long run stays readable.
    const failedItems = [];
    for (const key of ['sessions', 'skills', 'plugins', 'mcp', 'settings', 'credentials', 'presets']) {
      for (const row of Array.isArray(result[key]) ? result[key] : []) {
        if (row && row.status === 'failed' && failedItems.length < 8) {
          failedItems.push(`${row.rel || row.id || row.name || row.ref || '项'}：${row.error || '失败'}`);
        }
      }
    }
    if (failedItems.length) {
      lines.push(failedItems.join('\n'));
    }
  }
  if (result.ok === false) {
    lines.push('导入未完全成功。官方来源未改写。');
  }
  if (result.kernelStopped) {
    lines.push('桌面端已停止，请在首页重新启动。');
  }
  return lines.join('\n');
}

async function refreshImport(options = {}) {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-scan');
  const showFeedback = options.silent !== true;
  const savedSelections = captureImportSelections();
  const foldState = captureSessionFoldState();
  if (btn.disabled) return;
  const restore = launcherButtonBusy(btn, '正在扫描…');
  try {
    const scan = await api.scanImport(scanOptions());
    importHomeDir = typeof scan?.homeDir === 'string' ? scan.homeDir : '';
    const sourceLine = scan?.sourceHome
      ? `${scan.sourceHome}${scan.sourceHasData ? '（有可导入数据）' : '（没有可导入数据）'}${scan.destEmpty ? '；桌面会话为空' : ''}`
      : '还没有扫描结果。';
    $('import-source').textContent = sourceLine;
    $('import-source').title = scan?.sourceHome || '';
    $('import-skill-roots').hidden = extraSkillDirs.length === 0;
    $('import-skill-roots').textContent = extraSkillDirs.length
      ? `额外技能目录 ${extraSkillDirs.join('；')}`
      : '';

    const sessions = Array.isArray(scan?.sessions) ? scan.sessions : [];
    const skills = Array.isArray(scan?.skills) ? scan.skills : [];
    const plugins = Array.isArray(scan?.plugins) ? scan.plugins : [];
    const mcp = Array.isArray(scan?.mcp) ? scan.mcp : [];
    const settings = Array.isArray(scan?.settings) ? scan.settings : [];
    const presets = Array.isArray(scan?.presets) ? scan.presets : [];
    const renderOptions = { selections: savedSelections, foldState };

    renderSessionList(sessions, renderOptions);
    renderCheckList('import-skills', skills, {
      name: 'skill-id',
      value: (row) => row.id,
      title: (row) => row.displayName || row.name,
      meta: (row) => {
        const base = skillSourceLabel(row.source);
        if (Array.isArray(row.sourceCollision) && row.sourceCollision.length > 1) {
          const peers = row.sourceCollision.filter((id) => id !== row.id).join('、');
          return `${base} · 同名冲突：与 ${peers} 写入同一目录，二者选其一`;
        }
        return base;
      },
      disabled: () => false,
      skipLabel: () => '',
      marks: (row) => (Array.isArray(row.sourceCollision) && row.sourceCollision.length > 1
        ? badge('同名冲突', true)
        : ''),
      selections: savedSelections,
    });
    const slimPackage = lastStatus?.launcherPackage === true;
    renderCheckList('import-plugins', plugins, {
      name: 'plugin-name',
      value: (row) => row.name,
      title: (row) => row.name,
      meta: (row) => (row.skipped ? pluginSkipLabel(row.reason)
        : (slimPackage ? '轻量启动器不含插件工具链' : (row.spec || ''))),
      disabled: (row) => Boolean(row.skipped) || slimPackage,
      skipLabel: (row) => (slimPackage && !row.skipped ? '需在桌面端内重装' : pluginSkipLabel(row.reason)),
      marks: (row) => (!row.skipped && row.alreadyInstalled ? badge('已安装') : ''),
      selections: savedSelections,
    });
    renderCheckList('import-mcp', mcp, {
      name: 'mcp-id',
      value: (row) => row.id,
      title: (row) => row.name || row.id,
      meta: (row) => [
        row.enabled === false ? '已停用' : '已启用',
        row.id,
        row.endpoint,
      ].filter(Boolean).join(' · '),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-settings', settings, {
      name: 'setting-id',
      value: (row) => row.id,
      title: (row) => SETTING_LABELS[row.id] || row.id,
      meta: (row) => settingRowMeta(row),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-presets', presets, {
      name: 'preset-id',
      value: (row) => row.id,
      title: (row) => row.id,
      meta: (row) => (row.broken ? 'agent.cordis.yml 缺失或无效' : 'agent.cordis.yml'),
      disabled: (row) => Boolean(row.broken),
      skipLabel: () => '组合损坏',
      selections: savedSelections,
    });

    $('import-attachments').checked = Boolean(scan?.hasAttachments) && sessions.some((row) => !row.unsupported);
    importListRendered = true;
    syncSessionClusters();
    syncImportSummary();
    if (showFeedback) {
      void appNotice({ title: '扫描完成', body: `会话 ${sessions.length} · 技能 ${skills.length} · 插件 ${plugins.length} · MCP ${mcp.length} · 设置 ${settings.length} · 预设 ${presets.length}` });
    }
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}

async function refreshReleases() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-refresh-releases');
  if (btn.disabled) return;
  const restore = launcherButtonBusy(btn, '正在刷新版本…');
  try {
    const payload = await api.listReleases();
    renderReleases(payload);
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}

async function refreshPlugins() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-refresh-plugins');
  if (btn.disabled) return;
  const restore = launcherButtonBusy(btn, '正在刷新插件…');
  try {
    renderPlugins(await api.pluginForensics());
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}

function setRoutePop(chip, pop, open) {
  if (!chip || !pop) {
    return;
  }
  pop.hidden = !open;
  if (chip.setAttribute) {
    chip.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

// Both route popovers (Versions header + rail footer) close together: an
// outside click or Escape sweeps every open one.
function closeRoutePops(exceptWrap) {
  document.querySelectorAll('.route-pop-wrap').forEach((wrap) => {
    if (wrap === exceptWrap) {
      return;
    }
    setRoutePop(wrap.querySelector('[aria-haspopup="listbox"]'), wrap.querySelector('.route-pop'), false);
  });
}

// Shared option list for every route popover: checked current, unverified
// rows disabled, one click delegates to the caller's save flow.
function renderRouteOptions(pop, routes, routeId, onPick) {
  pop.innerHTML = routes.map((route) => `
    <button type="button" role="option" class="route-opt"
      data-route-opt="${escapeHtml(route.id)}"
      aria-selected="${route.id === routeId ? 'true' : 'false'}"
      ${route.verified ? '' : 'disabled'}>
      <span class="route-opt-check" aria-hidden="true">${route.id === routeId ? '✓' : ''}</span>
      <span class="route-opt-body">
        <span class="route-opt-title">${escapeHtml(route.label || route.id)}${route.verified ? '' : ' <span class="badge warn">未启用</span>'}</span>
        <span class="route-opt-desc">${escapeHtml(route.detail || '')}${route.verified ? '' : '（待验证，暂不可用）'}</span>
      </span>
    </button>`).join('');
  pop.querySelectorAll('[data-route-opt]').forEach((button) => {
    button.addEventListener('click', () => { void onPick(button.dataset.routeOpt); });
  });
}

async function pickDownloadRoute(routeId, current, afterSave) {
  // Route the popup save through the same issued-marker/generation the
  // radio picker uses. Two different controls issuing saves without a
  // shared marker can interleave (`A` popup, `B` radio, `A` resolves last)
  // and leave the rendered selection out of sync with what persisted.
  // Do NOT early-return on `routeId === current`: `current` is the stale
  // rendered selection, which during an outstanding save can still show the
  // previous route — returning to it would silently discard the user's
  // latest intent. The only true duplicate is re-issuing the value we
  // already issued most recently.
  if (!routeId || routeId === lastIssuedRoute.value) {
    return;
  }
  const saved = await issueRouteSave(pageShell(), routeId, refreshStatus, setHint, errText);
  if (saved && typeof afterSave === 'function') {
    afterSave();
  }
}

// Inline route switcher on the Versions head: a real dropdown, never a
// navigation jump. Picking a route saves config, refreshes status, and
// reloads this page's release list in place.
function renderVersionsHead(status) {
  const routeNode = $('versions-route');
  const routeWrap = $('versions-route-wrap');
  const pop = $('versions-route-pop');
  const routes = Array.isArray(status?.routes) ? status.routes : [];
  const routeId = status?.downloadRoute || '';
  const routeName = routeId ? routeLabel(routes, routeId) : '';
  const show = Boolean(status?.launcherPackage) && Boolean(routeName);
  if (routeNode) {
    routeNode.textContent = routeName;
  }
  if (routeWrap) {
    routeWrap.hidden = !show;
  } else if (routeNode) {
    routeNode.hidden = !show;
  }
  if (pop) {
    renderRouteOptions(pop, routes, routeId, async (picked) => {
      closeRoutePops();
      await pickDownloadRoute(picked, routeId, () => { void refreshReleases(); });
    });
  }
}

async function installTag(tag, kind) {
  const api = pageShell();
  if (!api || !tag || updateBusy) {
    return;
  }
  const launcherPackage = lastStatus?.launcherPackage === true;
  let title = '安装版本';
  let message = `将下载 ${tag} 安装包并替换当前安装。`;
  let confirmText = '安装';
  if (launcherPackage) {
    message = `将下载并安装 ${tag} 桌面端，期间桌面端会短暂关闭。`;
  } else if (kind === 'update') {
    title = '更新桌面端';
    message = `将更新到 ${tag}，安装程序会替换当前版本。`;
    confirmText = '更新';
  } else if (kind === 'switch') {
    title = '切换版本';
    message = `${tag} 早于当前版本，安装程序将覆盖当前安装。`;
    confirmText = '切换';
  }
  if (!(await appConfirm({ title, body: message, confirmText }))) {
    return;
  }
  updateBusy = true;
  const progressTitle = $('update-progress-title');
  if (progressTitle) {
    progressTitle.textContent = kind === 'update' ? `正在更新到 ${tag}` : `正在安装 ${tag}`;
  }
  paintProgress('update-progress', { phase: 'resolve' });
  $('update-progress').textContent = '正在下载安装包…';
  try {
    const result = await api.installRelease(tag);
    if (result?.manualInstall) {
      paintProgress('update-progress', { phase: 'waiting' });
      $('update-progress').textContent = result.message || '已打开安装映像，请将 Whale Isle 拖入 Applications 完成更新，完成后重新打开应用。';
      return;
    }
    if (result?.status === 'installed' || (launcherPackage && result?.ok === true)) {
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
    if (result?.status === 'waiting' || result?.launched) {
      paintProgress('update-progress', { phase: 'waiting' });
      $('update-progress').textContent = result.message || '安装向导已启动。请完成向导并留意系统授权提示，完成后刷新状态。';
      return;
    }
    if (result && (result.status === 'error' || result.ok === false)) {
      paintProgress('update-progress', { phase: 'error' });
      $('update-progress').textContent = errText(result, '安装失败');
    }
  } catch (error) {
    paintProgress('update-progress', { phase: 'error' });
    $('update-progress').textContent = errText(error, '安装失败');
  } finally {
    updateBusy = false;
  }
}

async function installDelta(tag) {
  const api = pageShell();
  if (!api || typeof api.installDelta !== 'function' || !tag || updateBusy) {
    return;
  }
  if (!(await appConfirm({
    title: '增量更新',
    body: `将通过增量包更新到 ${tag}，只下载变更部分。增量包不可用时自动改用完整安装包。`,
    confirmText: '增量更新',
  }))) {
    return;
  }
  updateBusy = true;
  const title = $('update-progress-title');
  if (title) {
    title.textContent = `正在增量更新到 ${tag}`;
  }
  paintProgress('update-progress', { phase: 'resolve', mode: 'delta' });
  $('update-progress').textContent = '正在准备增量包…';
  try {
    const result = await api.installDelta(tag);
    const status = result?.status;
    const fellBack = result?.mode === 'full' || status === 'fallback-full';
    if (result?.ok === true || status === 'applied' || status === 'installed') {
      paintProgress('update-progress', { phase: 'done', mode: fellBack ? 'full' : 'delta' });
      const version = result?.installed?.version || result?.version || tag;
      $('update-progress').textContent = fellBack
        ? `增量包不可用，已通过完整安装包完成安装：v${String(version).replace(/^v/i, '')}`
        : `已增量更新到 v${String(version).replace(/^v/i, '')}`;
      void refreshStatus();
      void refreshReleases();
      return;
    }
    if (fellBack && result?.ok !== false) {
      // The delta lane reported a full-installer fallback without a final
      // verdict yet; keep the card up and let progress events carry on.
      $('update-progress').textContent = result?.message || '增量包不可用，正在改用完整安装包…';
      if (title) {
        title.textContent = `正在安装 ${tag}`;
      }
      return;
    }
    if (result?.cancelled) {
      $('update-progress').textContent = result.message || '已取消';
      return;
    }
    $('update-progress').textContent = errText(result, '增量更新失败');
  } catch (error) {
    $('update-progress').textContent = errText(error, '增量更新失败');
  } finally {
    updateBusy = false;
  }
}

async function saveSettings() {
  const api = pageShell();
  if (!api) {
    return;
  }
  try {
    const patch = {
      quitAfterStart: $('opt-quit').checked,
      autoStartDesktop: $('opt-auto').checked,
      askOnUpdate: $('opt-ask').checked,
    };
    if ($('row-opt-tray') && !$('row-opt-tray').hidden) {
      patch.closeToTray = $('opt-tray').checked;
    }
    await api.saveLauncherConfig(patch);
  } catch (error) {
    setHint(errText(error, '设置保存失败'));
  }
}

function bind() {
  const api = pageShell();
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  const mainNav = document.querySelector('nav.tabs[role="tablist"]');
  if (mainNav) {
    bindTablist(mainNav, {
      orientation: 'vertical',
      activate: (tab) => activateTab(tab.dataset.tab),
    });
  }
  const importCats = document.querySelector('.import-cats[role="tablist"]');
  if (importCats) {
    bindTablist(importCats, {
      orientation: 'horizontal',
      activate: (tab) => showImportCat(tab.dataset.importCat),
    });
  }
  document.querySelectorAll('[data-goto]').forEach((link) => {
    link.addEventListener('click', () => activateTab(link.dataset.goto));
  });
  $('btn-start').addEventListener('click', () => void runDesktopAction('startDesktop'));
  if ($('btn-stop')) {
    $('btn-stop').addEventListener('click', () => void runDesktopAction('stopDesktop', 'stopping'));
  }
  if ($('btn-check-update')) {
    $('btn-check-update').addEventListener('click', () => checkUpdateNow());
  }
  if ($('btn-home-update')) {
    $('btn-home-update').addEventListener('click', () => {
      const latest = lastUpdateCheck?.latest || lastUpdateCheck?.stableVersion || '';
      const tag = latest ? (String(latest).startsWith('v') ? String(latest) : `v${latest}`) : '';
      if (tag) {
        void installTag(tag, 'update');
      }
    });
  }
  if ($('btn-check-update-versions')) {
    $('btn-check-update-versions').addEventListener('click', () => checkUpdateNow());
  }
  for (const [chipId, popId] of [
    ['versions-route-btn', 'versions-route-pop'],
    ['rail-route-btn', 'rail-route-pop'],
  ]) {
    const chip = $(chipId);
    if (!chip) {
      continue;
    }
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      const pop = $(popId);
      const opening = pop ? pop.hidden : false;
      closeRoutePops();
      setRoutePop(chip, pop, opening);
    });
  }
  document.addEventListener('click', (event) => {
    const wrap = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.route-pop-wrap')
      : null;
    closeRoutePops(wrap || undefined);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeRoutePops();
    }
  });
  $('btn-skip').addEventListener('click', () => void runDesktopAction('skipUserPlugins'));
  $('btn-retry-full').addEventListener('click', () => void runDesktopAction('retryFullPlugins'));
  for (const id of ['btn-disable-suspects', 'btn-recover-plugins']) {
    $(id).addEventListener('click', () => void askPluginRecovery(window.launcherRecovery.startupRecoveryGuidance(lastStatus)));
  }
  $('btn-pick-source').addEventListener('click', async () => {
    const picked = await api?.pickImportSource();
    if (picked) {
      importSourceHome = picked;
      await refreshImport();
    }
  });
  $('btn-pick-skill').addEventListener('click', async () => {
    const picked = await api?.pickSkillDir();
    if (picked && !extraSkillDirs.includes(picked)) {
      extraSkillDirs.push(picked);
      await refreshImport();
    }
  });
  $('btn-scan').addEventListener('click', () => refreshImport());
  $('btn-uninstall-app').addEventListener('click', async () => {
    const usesSettings = $('btn-uninstall-app').textContent === '打开应用设置';
    const ok = await appConfirm(usesSettings
      ? {
        title: '卸载 Whale Isle',
        body: '将打开 Windows「设置 → 应用」，请在列表中完成卸载。',
        confirmText: '打开设置',
      }
      : {
        title: '卸载 Whale Isle',
        body: '将启动 Windows 卸载程序并移除本机桌面端，其运行数据保留在本机。此操作不可撤销。',
        confirmText: '卸载',
        danger: true,
      });
    if (!ok) {
      return;
    }
    const restore = launcherButtonBusy($('btn-uninstall-app'), usesSettings ? '正在打开应用设置…' : '正在启动卸载程序…');
    try {
      const result = await api?.uninstallApp();
      if (result && result.ok === false) {
        setHint(uninstallErrorHint(result));
        return;
      }
      setHint(result?.message || (result?.openedSettings
        ? '已打开「设置 → 应用」，请在列表中卸载 Whale Isle。'
        : ''), { fade: true });
    } catch (error) {
      setHint(errText(error, '无法启动卸载程序'));
    } finally {
      restore();
    }
  });
  $('app-confirm-ok').addEventListener('click', () => settleConfirm(true));
  $('app-confirm-cancel').addEventListener('click', () => settleConfirm(false));
  $('app-confirm').addEventListener('click', (event) => {
    if (event.target === $('app-confirm')) {
      settleConfirm(false);
    }
  });
  $('app-confirm').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      settleConfirm(false);
    } else if (event.key === 'Tab') {
      const focusables = [$('app-confirm-cancel'), $('app-confirm-ok')].filter((button) => !button.hidden && !button.disabled);
      if (!focusables.length) focusables.push($('app-confirm').querySelector('.modal-card'));
      const idx = focusables.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (idx <= 0 ? focusables.length - 1 : idx - 1)
        : (idx < 0 || idx === focusables.length - 1 ? 0 : idx + 1);
      event.preventDefault();
      focusables[next].focus();
    }
  });
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    button.addEventListener('click', () => showImportCat(button.dataset.importCat));
  });
  $('import-board-body').addEventListener('click', (event) => {
    const fold = event.target.closest('[data-import-fold]');
    if (!fold || !$('import-sessions').contains(fold)) {
      return;
    }
    event.preventDefault();
    const key = fold.dataset.importFold;
    const expanded = fold.getAttribute('aria-expanded') !== 'false';
    setSessionGroupExpanded(key, !expanded);
  });
  $('import-board-body').addEventListener('change', (event) => {
    const cluster = event.target.closest('[data-import-cluster]');
    if (cluster && event.target === cluster) {
      const key = cluster.dataset.importCluster;
      $('import-sessions').querySelectorAll('input[name="session-rel"]').forEach((node) => {
        if (!node.disabled && sessionGroupKey(node.value) === key) {
          node.checked = cluster.checked;
        }
      });
    }
    syncSessionClusters();
    syncImportSummary();
  });
  $('btn-import-select-all').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, true);
    syncSessionClusters();
    syncImportSummary();
  });
  $('btn-import-select-none').addEventListener('click', () => {
    setGroupChecked(IMPORT_CATS[importCat].name, false);
    syncSessionClusters();
    syncImportSummary();
  });
  const importRunBtn = $('btn-import');
  const importCancelBtn = $('btn-import-cancel');
  let importOpSeq = 0;
  let activeImportOpId = '';
  importRunBtn.addEventListener('click', async () => {
    const opSeq = ++importOpSeq;
    const myOpId = `ui-import-${Date.now().toString(36)}-${opSeq}`;
    activeImportOpId = myOpId;
    importRunBtn.disabled = true;
    importCancelBtn.hidden = false;
    importCancelBtn.disabled = false;
    $('import-result').textContent = '正在导入…';
    try {
      if (!api || typeof api.runImport !== 'function') {
        $('import-result').textContent = '导入不可用：桌面桥接未连接。';
        return;
      }
      const result = await api?.runImport({
        ...scanOptions(),
        opId: myOpId,
        overwrite: $('import-overwrite').checked,
        importAttachments: $('import-attachments').checked,
        selectedRels: checkedValues('session-rel'),
        selectedSkillIds: checkedValues('skill-id'),
        selectedPluginNames: checkedValues('plugin-name'),
        selectedMcpIds: checkedValues('mcp-id'),
        selectedSettingIds: checkedValues('setting-id'),
        selectedPresetIds: checkedValues('preset-id'),
      });
      if (opSeq === importOpSeq) {
        $('import-result').textContent = summarizeImport(result);
      }
    } catch (error) {
      if (opSeq === importOpSeq) {
        $('import-result').textContent = `导入失败：${errText(error, '调用被拒绝')}`;
      }
    } finally {
      if (opSeq === importOpSeq) {
        importRunBtn.disabled = false;
        importCancelBtn.hidden = true;
        activeImportOpId = '';
      }
    }
  });
  importCancelBtn.addEventListener('click', async () => {
    importCancelBtn.disabled = true;
    // Capture the op we're cancelling BEFORE awaiting. `activeImportOpId`
    // is shared mutable state the run handler clears on completion — reading
    // it after an await could name a different (or no) operation.
    const cancellingOpId = activeImportOpId;
    // A cancellation outcome may only reach the UI while the op that
    // requested it still owns the import state. If A's cancel resolves after
    // A finished (or B started), writing it would overwrite a terminal
    // summary or a different operation's live progress.
    const stillOwns = () => cancellingOpId !== '' && activeImportOpId === cancellingOpId && importRunBtn.disabled === true;
    try {
      // Name the op we're cancelling so the service can refuse to abort a
      // different operation it owns (e.g. a slim plugin retry holding the
      // same slot).
      const reply = await api?.cancelImport?.({ opId: cancellingOpId });
      // A resolved refusal ({ok:false}) is still a refusal — the service
      // declined to abort (wrong owner, already done, or non-import work).
      // Surface it instead of silently showing a cancel that did nothing.
      if (reply && reply.ok === false && stillOwns()) {
        $('import-result').textContent = `取消被拒绝：${errText(reply.error, '无法取消')}`;
      }
    } catch (error) {
      // A rejected cancellation is itself a terminal diagnostic — surface it
      // instead of leaving an unhandled rejection and a stuck-looking state.
      if (stillOwns()) {
        $('import-result').textContent = `取消请求被拒绝：${errText(error, '无法取消')}`;
      }
    }
  });
  if (typeof api?.onImportProgress === 'function') {
    api.onImportProgress((payload) => {
      // Late events from an earlier operation must not overwrite a terminal
      // summary; only accept progress while the run is still in flight, and
      // only when the event carries THIS operation's identity. An event with
      // no `op` is unowned and can never be attributed to the active run —
      // reject it too rather than let an unrelated emitter overwrite state.
      if (importRunBtn.disabled === false) {
        return;
      }
      if (typeof payload?.op !== 'string' || !payload.op || payload.op !== activeImportOpId) {
        return;
      }
      const text = importProgressText(payload);
      if (text) {
        $('import-result').textContent = text;
      }
    });
  }
  $('btn-refresh-releases').addEventListener('click', () => refreshReleases());
  $('btn-refresh-plugins').addEventListener('click', () => refreshPlugins());
  ['opt-quit', 'opt-auto', 'opt-ask', 'opt-tray'].forEach((id) => {
    $(id).addEventListener('change', () => saveSettings());
  });
  if (api?.onShowTab) {
    api.onShowTab((payload) => {
      if (payload?.tab) {
        activateTab(payload.tab);
      }
    });
  }
  if (api?.onDesktopFailed) {
    api.onDesktopFailed((payload) => {
      desktopActionError = payload?.error || '桌面端启动失败。';
      activateTab('home');
      setHint('');
      void refreshStatus();
      void refreshPlugins();
    });
  }
  if (api?.onDesktopReady) {
    api.onDesktopReady(() => {
      desktopActionError = '';
      setHint('');
      void refreshStatus();
    });
  }
  window.addEventListener('focus', () => void maybePromptPluginRecovery());
  document.addEventListener('visibilitychange', () => void maybePromptPluginRecovery());
  if (api?.onLauncherHint) {
    api.onLauncherHint((payload) => {
      if (payload?.importResume) {
        setHint('上次导入中断，未完成的临时文件已清理。可重新导入；已存在的内容将按规则跳过。');
      } else {
        // Cold-start gate outcome (failed/incomplete update flow): hints are
        // shown verbatim, everything else falls back to the shared rendering.
        renderUpdateCheck(payload?.check);
        if (payload?.check?.hint || payload?.check?.status === 'error') void appNotice(updateCheckNotice(payload.check));
      }
      void refreshStatus();
    });
  }
  // Main-process confirmations (unverified installer, update asks) render on
  // this same app-confirm card instead of a native messagebox.
  if (api?.onAppConfirm) {
    api.onAppConfirm((payload) => {
      const id = payload && payload.id;
      void appConfirm({
        title: payload?.title,
        body: payload?.body,
        confirmText: payload?.confirmText || undefined,
        cancelText: payload?.cancelText || undefined,
        danger: payload?.danger === true,
      }).then((ok) => {
        void api.respondAppConfirm?.({ id, ok });
      });
    });
  }
  if (api?.onUpdateProgress) {
    api.onUpdateProgress((payload) => {
      const text = installPhaseText(payload);
      const prefix = installBusy ? 'install-progress' : 'update-progress';
      paintProgress(prefix, payload);
      const line = $(prefix);
      if (line && text) {
        line.textContent = text;
      }
    });
  }
  if ($('btn-install-runtime')) {
    $('btn-install-runtime').addEventListener('click', () => installRuntime());
  }
  if ($('btn-install-cancel')) {
    $('btn-install-cancel').addEventListener('click', async () => {
      const apiNow = pageShell();
      try {
        await apiNow?.cancelRuntimeInstall();
      } catch {
        // best effort — the install op resolves the cancel state itself
      }
      const progress = $('install-progress');
      if (progress) {
        progress.hidden = false;
        progress.textContent = '正在取消…';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const host = document.querySelector('.window-controls');
  if (typeof window.mountWindowControls === 'function') {
    window.mountWindowControls(host);
  }
  if (typeof window.watchShellTheme === 'function') {
    window.watchShellTheme();
  }
  bind();
  window.__launcherComponents?.mountHome($('home-components'), pageShell());
  mountComponents();
  void refreshStatus();
});

if (typeof module === 'object' && module.exports) {
  module.exports = { renderReleases, radioNextIndex, issueRouteSave, installPhaseText, paintProgress };
}
