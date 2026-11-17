'use strict';

// 版本页：版本卡头、发行列表渲染、发行操作与刷新。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

function badge(text, warn) {
  return h('span', { class: `badge${warn ? ' warn' : ''}` }, text);
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

function renderVersionLead(installed, current) {
  const version = current || installed?.version || '';
  $('ver-label').textContent = current ? '当前运行' : '本机版本';
  const runningFromSource = Boolean(installed?.runningFromSource);
  const label = version
    ? `v${String(version).replace(/^v/i, '')}${runningFromSource ? ' · 源码运行' : ''}`
    : (runningFromSource ? '源码运行' : (installed?.registeredInstall === false ? '未安装' : '版本未知'));
  $('ver-num').textContent = label;
  const sub = $('ver-now-sub');
  if (sub) {
    if (installed?.installPath) {
      sub.textContent = current && installed.registeredInstall
        ? `本机安装${installed.version ? ` v${String(installed.version).replace(/^v/i, '')}` : ''} · 安装位置 ${installed.installPath}`
        : `${current && !installed.registeredInstall ? '运行位置' : '安装位置'} ${installed.installPath}`;
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
    return updateCenterApi() ? '更新到此版本' : '完全下载';
  }
  return '切换至此版本';
}

function releaseActionButtons(row, rowDelta) {
  const parts = [];
  const label = releaseActionLabel(row);
  // The update center picks the cheapest transfer itself; no per-row choice.
  const delta = updateCenterApi() ? null : rowDelta;
  if (delta && label) {
    parts.push(h('button', { type: 'button', class: 'primary small', dataset: { deltaTag: row.tag || '' } }, '增量更新'));
  }
  if (label) {
    const kind = row.newer ? 'update' : 'switch';
    parts.push(h('button', {
      type: 'button',
      class: `${delta ? 'ghost' : 'primary'} small`,
      dataset: { installTag: row.tag || '', installKind: kind },
    }, label));
  } else if (!row.current) {
    const reason = row.installable ? '不可用' : '无安装包';
    parts.push(h('button', { type: 'button', class: 'ghost small', disabled: true }, reason));
  }
  return parts;
}

const { plainReleaseNotes } = typeof module !== 'undefined' && module.exports
  ? require('../shared/release-notes')
  : window.releaseNotes;

function releaseDetailNode(row, delta, running) {
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
  const actions = releaseActionButtons(row, delta);
  return h('div', { class: 'rel-detail', hidden: true },
    h('div', { class: 'rel-detail-meta row-meta' }, meta.join(' · ')),
    h('p', { class: 'rel-notes' }, notes || '该版本未提供更新说明。'),
    actions.length
      ? h('div', { class: 'rel-detail-actions' }, ...actions)
      : (row.current ? h('div', { class: 'row-meta' }, `当前${running ? '正在运行' : '已安装'}此版本`) : null));
}

function renderReleases(payload) {
  renderVersionLead(payload?.installed, payload?.current);
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
      mount(cta, ...releaseActionButtons(updateRow, delta));
      bindVersionActions(cta);
    }
  } else {
    const installed = payload && payload.installed;
    const known = Boolean(payload?.current || installed?.version) && rows.length > 0;
    badgeEl.textContent = known ? '已是最新' : '';
    badgeEl.className = 'badge green';
    badgeEl.hidden = !known;
    if (cta) {
      mount(cta);
    }
  }
  if (!rows.length) {
    mount(list, h('li', {}, h('span', { class: 'row-meta' }, payload?.message || '暂无可列出的正式版。')));
    return;
  }
  const latestIdx = rows.findIndex((row) => row && !row.prerelease);
  mount(list, ...rows.map((row, index) => {
    const delta = row && row.newer ? (row.delta || deltaFor(row.tag)) : null;
    const marks = [
      index === latestIdx ? h('span', { class: 'badge green' }, '最新') : null,
      row.current ? badge('当前') : null,
      row.prerelease ? badge('预发布') : null,
      delta ? h('span', { class: 'badge blue' }, `增量${formatBytes(delta.size) ? ` ${formatBytes(delta.size)}` : ''}`) : null,
      row.installable ? null : badge('无安装包', true),
    ];
    const metaBits = [];
    if (row.publishedAt) {
      metaBits.push(String(row.publishedAt).slice(0, 10));
    }
    if (row.assetSize) {
      metaBits.push(formatBytes(row.assetSize));
    }
    return h('li', { class: 'rel-row' },
      h('button', { type: 'button', class: 'rel-line', dataset: { relToggle: '' }, 'aria-expanded': 'false' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, `${row.tag || row.version || ''} `, ...marks),
          h('span', { class: 'row-meta' }, metaBits.join(' · '))),
        row.current ? h('span', { class: 'row-meta' }, payload?.current ? '运行中' : '已安装') : null,
        h('svg', { class: 'rel-chev', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('path', { fill: 'currentColor', d: 'M8 10.6 3.7 6.3l1.1-1.1L8 8.4l3.2-3.2 1.1 1.1z' }))),
      releaseDetailNode(row, delta, Boolean(payload?.current)));
  }));
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
