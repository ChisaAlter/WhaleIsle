// app/work-panes.js — split from app.js (#442).
import { sessionOwner } from '../ui/session-owner.js?v=20260906-interaction';
import { gitCall, hostCall } from '../host/backend.js';
import { diffView, mcpRows, skillRows, skillScope, pluginView, diffStatusLabel, mcpRequest, mcpTestMessage, pluginResultMessage } from '../host/desktop.js?v=20261028-mobile';
import { buttonBusy } from '../ui/button-busy.js?v=20261021-button-feedback';
import { composerOffline, operationError, setToast, surfaceBusy } from './chrome.js?v=20261117-app-split';
import { options, state } from './context.js?v=20261117-app-split';
import { startConfirmAction } from './dialogs.js?v=20261117-app-split';
import { mentionButton } from './files.js?v=20261117-app-split';
import { renderMarkdownInto } from './markdown.js?v=20261117-app-split';
import { descNode, fieldInput, ghostButton, groupNode, hairRow, noticeNode, sectionNode, switchNode } from './nodes.js?v=20261117-app-split';
import { drillChevron } from './pickers.js?v=20261117-app-split';
import { renderSettings } from './settings.js?v=20261117-app-split';

function ensureDiffPane() {
  if (!state.diffPane) {
    state.diffPane = { baseRef: '', loading: false, loaded: false, error: '', view: null, open: {}, seq: 0 };
  }
  return state.diffPane;
}

function refreshDiffBody() {
  if (state.settingsOpen && state.settingsPane === '工作区' && state.wsTab === 'changes') renderSettings();
}

/** Git diff of the session workspace: uncommitted changes, or against a base ref. */
async function loadDiff() {
  const pane = ensureDiffPane();
  const owner = sessionOwner(state);
  const cwd = state.cwd;
  if (!owner.client || !cwd) {
    refreshDiffBody();
    return;
  }
  const seq = ++pane.seq;
  pane.loading = true;
  pane.error = '';
  refreshDiffBody();
  try {
    const value = await gitCall(owner.client, 'git-diff', cwd, { options: pane.baseRef ? { baseRef: pane.baseRef } : {} });
    if (!owner.owns() || state.diffPane !== pane || pane.seq !== seq) return;
    pane.view = diffView(value);
    pane.loaded = true;
  } catch (error) {
    if (!owner.owns() || state.diffPane !== pane || pane.seq !== seq) return;
    pane.error = error?.message || '读取更改失败';
    pane.view = null;
  }
  pane.loading = false;
  refreshDiffBody();
}

export function openChangesTab() {
  const pane = ensureDiffPane();
  if (!pane.loaded && !pane.loading) void loadDiff();
}

export const EXT_PANES = { mcp: 'MCP', skills: '技能', plugins: '插件' };

function ensureExtPane(kind) {
  if (!state.extPane[kind]) {
    state.extPane[kind] = { loading: false, loaded: false, error: '', data: null, filter: '', busyId: '', detail: null, seq: 0 };
  }
  return state.extPane[kind];
}

/** MCP servers, skills and plugins from the paired Host's management services. */
export async function loadExtensions(kind, { force = false } = {}) {
  const pane = ensureExtPane(kind);
  const client = state.chisacode?.client;
  if (!client || (pane.loading && !force)) return;
  const sessionId = state.sessionId;
  const seq = ++pane.seq;
  pane.loading = true;
  pane.error = '';
  renderExtIfVisible(kind);
  try {
    let data;
    if (kind === 'mcp') {
      data = mcpRows(await hostCall(client, 'mcpServers.list', { args: {} }));
    } else if (kind === 'skills') {
      if (!sessionId) throw new Error('先打开一个会话，技能按会话的工作目录发现');
      data = skillRows(await hostCall(client, 'skillInventory.list', { args: { request: skillScope(state.cwd, sessionId) } }));
    } else {
      const inventory = await hostCall(client, 'pluginInventory.list', { args: {} });
      const [plugins, bundles] = inventory?.managementAvailable === true
        ? await Promise.all([
          hostCall(client, 'pluginManager.listPlugins', { args: {} }),
          hostCall(client, 'pluginManager.listBundles', { args: {} }),
        ])
        : [inventory?.entries, []];
      data = pluginView({ inventory, plugins, bundles });
    }
    if (state.extPane[kind] !== pane || pane.seq !== seq || state.chisacode?.client !== client) return;
    pane.data = data;
    pane.loaded = true;
  } catch (error) {
    if (state.extPane[kind] !== pane || pane.seq !== seq || state.chisacode?.client !== client) return;
    pane.error = error?.message || '电脑没有响应';
  }
  pane.loading = false;
  renderExtIfVisible(kind);
}

/** One management write; the list is re-read afterwards so the page shows Host truth. */
async function runExtAction(kind, busyId, method, payload, { notice = '修改已保存', tone = 'success' } = {}) {
  const pane = ensureExtPane(kind);
  const client = state.chisacode?.client;
  if (!client || pane.busyId) return false;
  pane.busyId = busyId;
  renderExtIfVisible(kind);
  let succeeded = false;
  try {
    const result = await hostCall(client, method, payload);
    if (state.chisacode?.client !== client) return false;
    setToast(typeof notice === 'function' ? notice(result) : notice, { tone });
    succeeded = true;
  } catch (error) {
    if (state.chisacode?.client === client) {
      operationError(error?.message || '电脑没有响应', () => runExtAction(kind, busyId, method, payload, { notice, tone }));
    }
  } finally {
    if (state.extPane[kind] === pane) pane.busyId = '';
  }
  if (state.chisacode?.client === client) {
    if (kind === 'skills' && pane.detail?.name) await loadSkillDetail(pane.detail.name);
    await loadExtensions(kind, { force: true });
  }
  return succeeded;
}

async function loadSkillDetail(name) {
  const pane = ensureExtPane('skills');
  const owner = sessionOwner(state);
  if (!owner.client || !owner.sessionId) return;
  const detail = { name, loading: true, error: '', data: pane.detail?.name === name ? pane.detail.data : null };
  pane.detail = detail;
  renderExtIfVisible('skills');
  try {
    const value = await hostCall(owner.client, 'skillInventory.get', { args: { request: { ...skillScope(state.cwd, owner.sessionId), name } } });
    if (!owner.owns() || pane.detail !== detail) return;
    detail.data = value && typeof value === 'object' ? value : null;
  } catch (error) {
    if (!owner.owns() || pane.detail !== detail) return;
    detail.error = error?.message || '无法读取技能';
  }
  detail.loading = false;
  renderExtIfVisible('skills');
}

function renderExtIfVisible(kind) {
  if (state.settingsOpen && state.settingsPane === EXT_PANES[kind]) renderSettings();
}

const DIFF_LINE_CAP = 400;

const DIFF_CLASS = { add: 'add', del: 'remove', eof: 'header' };

const DIFF_SIGN = { add: '+', del: '−', eof: '' };

function diffHunksNode(file) {
  const body = document.createElement('div');
  body.className = 'diff-file-body';
  if (!file.hunks.length) {
    body.append(descNode('没有可显示的文本差异，可能为二进制文件或超出预览上限。'));
    return body;
  }
  const total = file.hunks.reduce((sum, hunk) => sum + hunk.lines.length + 1, 0);
  let budget = DIFF_LINE_CAP;
  const paint = (limit) => {
    const hunks = [];
    let left = limit;
    for (const hunk of file.hunks) {
      if (left <= 0) break;
      const node = document.createElement('div');
      node.className = 'diff-hunk';
      const header = document.createElement('div');
      header.className = 'diff-line header';
      header.textContent = hunk.header;
      node.append(header);
      left -= 1;
      for (const line of hunk.lines) {
        if (left <= 0) break;
        const row = document.createElement('div');
        row.className = `diff-line ${DIFF_CLASS[line.kind] || 'context'}`;
        row.textContent = `${DIFF_SIGN[line.kind] ?? ' '}${line.text}`;
        node.append(row);
        left -= 1;
      }
      hunks.push(node);
    }
    body.replaceChildren(...hunks);
    if (total > limit) {
      const more = ghostButton(`显示全部 ${total} 行`, () => paint(Infinity));
      more.classList.add('diff-more');
      body.append(more);
    }
  };
  paint(budget);
  return body;
}

/** Git diff of the session workspace, per file and folded until opened. */
export function renderDiffInto(target) {
  if (!state.sessionId || !state.cwd) {
    target.append(noticeNode('当前会话没有工作目录，没有可对比的更改。'));
    return;
  }
  const pane = ensureDiffPane();
  if (!pane.loaded && !pane.loading && !pane.error) void loadDiff();
  const refRow = document.createElement('div');
  refRow.className = 'diff-ref';
  const input = fieldInput(pane.baseRef, '对比引用，留空查看未提交更改', (value) => { pane.baseRef = value.trim(); });
  input.setAttribute('aria-label', '对比引用');
  input.setAttribute('enterkeyhint', 'go');
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      void loadDiff();
    }
  });
  const run = ghostButton(pane.loaded ? '刷新' : '查看', () => { void loadDiff(); });
  buttonBusy(run, pane.loading, { label: '读取中…' });
  run.disabled = pane.loading;
  refRow.append(input, run);
  target.append(refRow);
  if (pane.error) {
    target.append(descNode(`读取失败：${pane.error}`, 'row-desc ext-error'));
    return;
  }
  const view = pane.view;
  if (!view) {
    target.append(descNode('正在读取更改…'));
    return;
  }
  const adds = view.files.reduce((sum, file) => sum + file.additions, 0);
  const dels = view.files.reduce((sum, file) => sum + file.deletions, 0);
  target.append(descNode([
    view.baseRef ? `对比 ${view.baseRef}` : '未提交更改',
    `${view.files.length} 个文件`,
    view.files.length ? `+${adds} −${dels}` : '',
  ].filter(Boolean).join(' · ')));
  if (view.truncated) target.append(descNode('电脑端差异达到输出上限，内容不完整。'));
  if (!view.files.length) {
    target.append(descNode(view.baseRef ? '此范围没有文件更改。' : '工作区是干净的，没有未提交更改。', 'row-desc ext-empty'));
    return;
  }
  for (const file of view.files) {
    const details = document.createElement('details');
    details.className = 'diff-file';
    details.open = pane.open[file.path] === true;
    const head = document.createElement('summary');
    head.className = 'diff-file-head';
    const path = document.createElement('span');
    path.className = 'diff-path';
    path.textContent = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    const badge = document.createElement('span');
    badge.className = 'diff-badge';
    badge.textContent = diffStatusLabel(file.status);
    const stat = document.createElement('span');
    stat.className = 'diff-stat';
    stat.textContent = file.hunks.length ? `+${file.additions} −${file.deletions}` : '无文本差异';
    const mention = mentionButton(file.path);
    // The summary toggles the file; inserting the path must not.
    mention.addEventListener('click', (event) => event.preventDefault());
    head.append(path, badge, stat, mention);
    details.append(head);
    const build = () => {
      if (details.querySelector('.diff-file-body')) return;
      details.append(diffHunksNode(file));
    };
    if (details.open) build();
    details.addEventListener('toggle', () => {
      pane.open[file.path] = details.open;
      if (details.open) build();
    });
    target.append(details);
  }
}

export function extToggle(on, label, onToggle, disabled) {
  const toggle = switchNode(on, onToggle);
  toggle.setAttribute('aria-label', label);
  toggle.disabled = disabled;
  return toggle;
}

/** Locally filtered list; typing repaints only the rows, keeping input focus. */
function filteredExtList(pane, rows, { text, render, empty }) {
  const wrap = document.createElement('div');
  wrap.className = 'ext-list';
  const list = document.createElement('div');
  list.className = 'group ext-group';
  const paint = () => {
    const query = pane.filter.trim().toLowerCase();
    const hits = query ? rows.filter((row) => text(row).toLowerCase().includes(query)) : rows;
    list.replaceChildren(...(hits.length ? hits.map(render) : [descNode(query ? '没有匹配的条目' : empty, 'row-desc ext-empty')]));
  };
  if (rows.length > 6) {
    const input = fieldInput(pane.filter, '筛选', (value) => {
      pane.filter = value;
      paint();
    });
    input.type = 'search';
    input.classList.add('ext-filter');
    input.setAttribute('aria-label', '筛选');
    wrap.append(input);
  }
  paint();
  wrap.append(list);
  return wrap;
}

function extRowShell(name, statusText, statusOn, trailing = null) {
  const row = document.createElement('div');
  row.className = 'ext-row';
  const main = document.createElement('div');
  main.className = 'ext-main';
  const title = document.createElement('span');
  title.className = 'ext-name';
  title.textContent = name;
  main.append(title);
  row.append(main);
  if (trailing) {
    row.append(trailing);
  } else if (statusText) {
    const status = document.createElement('span');
    status.className = `ext-status${statusOn ? ' on' : ''}`;
    status.textContent = statusText;
    row.append(status);
  }
  return { row, main };
}

const PLUGIN_PHASE = { active: '运行中', loading: '加载中', pending: '等待中', failed: '失败', unloading: '卸载中' };

const MCP_HEALTH = { connected: '已连接', connecting: '连接中', reconnecting: '重连中', failed: '失败', active: '运行中', loading: '加载中', pending: '等待中' };

function renderMcpPane(pane) {
  const rows = pane.data || [];
  options.append(filteredExtList(pane, rows, {
    text: (row) => `${row.name} ${row.transport}`,
    empty: '电脑尚未配置 MCP 服务器',
    render: (row) => {
      const busy = pane.busyId === row.id;
      const { row: node, main } = extRowShell(row.name, MCP_HEALTH[row.health] || row.health, row.health === 'connected' || row.health === 'active');
      main.append(descNode([row.transport, row.enabled ? '已启用' : '已停用', row.writable ? '' : '来自电脑的配置组合，只读'].filter(Boolean).join(' · '), 'ext-meta'));
      if (row.lastError) main.append(descNode(row.lastError, 'ext-error'));
      if (row.tools.length) {
        const tools = document.createElement('details');
        tools.className = 'ext-tools';
        const summary = document.createElement('summary');
        summary.textContent = `${row.tools.length} 个工具`;
        const list = document.createElement('p');
        list.className = 'ext-meta';
        list.textContent = row.tools.join('\n');
        tools.append(summary, list);
        main.append(tools);
      }
      const actions = document.createElement('div');
      actions.className = 'ext-actions';
      const disabled = Boolean(pane.busyId) || composerOffline();
      if (row.writable) {
        actions.append(extToggle(row.enabled, `启用 ${row.name}`, () => {
          void runExtAction('mcp', row.id, ...mcpRequest('setEnabled', row.id, !row.enabled), { notice: row.enabled ? '已停用' : '已启用' });
        }, disabled));
        const retry = ghostButton('重连', () => { void runExtAction('mcp', row.id, ...mcpRequest('retry', row.id), { notice: '已请求重连' }); });
        retry.disabled = disabled;
        actions.append(retry);
      }
      const probe = ghostButton('测试', () => {
        void runExtAction('mcp', row.id, ...mcpRequest('test', row.id), { notice: mcpTestMessage, tone: 'info' });
      });
      probe.disabled = disabled;
      buttonBusy(probe, busy, { label: '处理中…' });
      actions.append(probe);
      if (row.writable) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger-btn';
        remove.textContent = '删除';
        remove.disabled = disabled;
        remove.addEventListener('click', () => startConfirmAction({
          title: `删除 MCP 服务器「${row.name}」？`,
          lead: '会从电脑删除这个服务器的配置并断开连接。',
          label: '删除',
          run: () => runExtAction('mcp', row.id, ...mcpRequest('delete', row.id), { notice: '已删除' }),
        }));
        actions.append(remove);
      }
      main.append(actions);
      return node;
    },
  }));
  options.append(descNode('新增和编辑服务器配置目前在电脑端与 Android 客户端提供。', 'row-desc settings-note'));
}

function renderSkillDetail(pane) {
  const detail = pane.detail;
  const bar = document.createElement('div');
  bar.className = 'preview-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'preview-back';
  back.textContent = '‹ 技能';
  back.addEventListener('click', () => {
    pane.detail = null;
    renderSettings();
  });
  const title = document.createElement('span');
  title.className = 'preview-title';
  title.textContent = detail.name;
  bar.append(back, title);
  options.append(bar);
  if (detail.error) {
    options.append(descNode(`读取失败：${detail.error}`, 'row-desc ext-error'), ghostButton('重试', () => { void loadSkillDetail(detail.name); }));
    return;
  }
  const skill = detail.data;
  if (!skill) {
    surfaceBusy(options, true);
    return;
  }
  if (skill.description) options.append(descNode(skill.description));
  options.append(descNode([skill.source, skill.path].filter(Boolean).join(' · '), 'row-desc ext-meta'));
  const scope = skillScope(state.cwd, state.sessionId);
  const disabled = Boolean(pane.busyId) || composerOffline();
  const invocation = (model, user) => {
    void runExtAction('skills', skill.name, 'skillInventory.setInvocation', {
      args: { request: { ...scope, name: skill.name, modelInvocable: model, userInvocable: user } },
    });
  };
  if (skill.writable === true) {
    options.append(sectionNode('调用', null, groupNode(
      hairRow('模型可调用', '智能体可按需自动使用这个技能。', extToggle(skill.modelInvocable === true, '模型可调用', () => invocation(!skill.modelInvocable, skill.userInvocable === true), disabled)),
      hairRow('用户可调用', '可在输入框用斜杠命令调用。', extToggle(skill.userInvocable === true, '用户可调用', () => invocation(skill.modelInvocable === true, !skill.userInvocable), disabled)),
    )));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-btn';
    remove.textContent = '删除技能';
    remove.disabled = disabled;
    remove.addEventListener('click', () => startConfirmAction({
      title: `删除技能「${skill.name}」？`,
      lead: '会删除电脑上的技能文件或目录。',
      label: '删除',
      run: async () => {
        const removed = await runExtAction('skills', skill.name, 'skillInventory.delete', { args: { request: { ...scope, name: skill.name } } }, { notice: '技能已删除' });
        if (removed) {
          pane.detail = null;
          renderSettings();
        }
      },
    }));
    options.append(remove);
  } else {
    options.append(descNode('此技能来源只读。'));
  }
  if (typeof skill.content === 'string' && skill.content.trim()) {
    const content = document.createElement('div');
    content.className = 'assistant skill-content';
    renderMarkdownInto(content, skill.content);
    options.append(sectionNode('正文', null, content));
  }
}

function renderSkillsPane(pane) {
  if (pane.detail) {
    renderSkillDetail(pane);
    return;
  }
  options.append(filteredExtList(pane, pane.data || [], {
    text: (row) => `${row.name} ${row.description} ${row.groups.join(' ')}`,
    empty: '此会话未发现技能',
    render: (row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ext-row ext-link';
      const main = document.createElement('span');
      main.className = 'ext-main';
      const title = document.createElement('span');
      title.className = 'ext-name';
      title.textContent = row.name;
      main.append(title);
      if (row.description) main.append(descNode(row.description, 'ext-desc'));
      main.append(descNode([
        row.source, row.groups.join(' · '),
        row.modelInvocable ? '模型可调用' : '模型调用关闭',
        row.userInvocable ? '用户可调用' : '用户调用关闭',
      ].filter(Boolean).join(' · '), 'ext-meta'));
      button.append(main, drillChevron());
      button.addEventListener('click', () => { void loadSkillDetail(row.name); });
      return button;
    },
  }));
  options.append(descNode('创建和编辑技能目前在电脑端与 Android 客户端提供。', 'row-desc settings-note'));
}

function renderPluginsPane(pane) {
  const view = pane.data;
  if (!view.manageable) options.append(noticeNode('此电脑未挂载插件管理服务，以下为当前插件的只读状态。'));
  const disabled = Boolean(pane.busyId) || composerOffline();
  if (view.bundles.length) {
    options.append(sectionNode('插件包', null, filteredExtList(pane, view.bundles, {
      text: (row) => `${row.name} ${row.description}`,
      empty: '',
      render: (row) => {
        const toggle = row.editable && view.manageable
          ? extToggle(row.enabled, `启用插件包 ${row.name}`, () => {
            void runExtAction('plugins', `bundle:${row.name}`, 'pluginManager.setBundleEnabled', { args: { name: row.name, enabled: !row.enabled } }, { notice: pluginResultMessage });
          }, disabled)
          : null;
        const { row: node, main } = extRowShell(row.name, row.enabled ? '已启用' : '已停用', row.enabled, toggle);
        if (row.description) main.append(descNode(row.description, 'ext-desc'));
        main.append(descNode([row.version, row.availability].filter(Boolean).join(' · '), 'ext-meta'));
        if (row.readOnlyReason) main.append(descNode(row.readOnlyReason, 'ext-meta'));
        if (row.error) main.append(descNode(row.error, 'ext-error'));
        return node;
      },
    })));
  }
  if (view.plugins.length) {
    options.append(sectionNode('运行中的插件', null, filteredExtList(pane, view.plugins, {
      text: (row) => row.name,
      empty: '',
      render: (row) => {
        const toggle = row.editable && view.manageable
          ? extToggle(row.enabled, `启用插件 ${row.name}`, () => {
            void runExtAction('plugins', `plugin:${row.id}`, 'pluginManager.setPluginEnabled', { args: { id: row.id, enabled: !row.enabled } }, { notice: pluginResultMessage });
          }, disabled)
          : null;
        const phase = PLUGIN_PHASE[row.phase] || row.phase || '未运行';
        const { row: node, main } = extRowShell(row.name, phase, row.phase === 'active', toggle);
        // Without a toggle the phase sits in the status chip; with one it moves to the meta line.
        const meta = [toggle ? phase : '', row.readOnlyReason].filter(Boolean).join(' · ');
        if (meta) main.append(descNode(meta, 'ext-meta'));
        return node;
      },
    })));
  }
  if (!view.bundles.length && !view.plugins.length) options.append(descNode('电脑没有返回插件条目。', 'row-desc ext-empty'));
  options.append(descNode('安装和移除插件包目前在电脑端与 Android 客户端提供。', 'row-desc settings-note'));
}

/** MCP / 技能 / 插件: real Host management services; failures are never shown as empty. */
export function renderExtensionsPane(kind) {
  const pane = ensureExtPane(kind);
  if (!pane.loaded && !pane.loading && !pane.error) void loadExtensions(kind);
  const toolbar = document.createElement('div');
  toolbar.className = 'ext-toolbar';
  const refresh = ghostButton('刷新', () => { void loadExtensions(kind, { force: true }); });
  buttonBusy(refresh, pane.loading, { label: '刷新中…' });
  refresh.disabled = pane.loading;
  toolbar.append(refresh);
  options.append(toolbar);
  if (pane.error) {
    options.append(descNode(`读取失败：${pane.error}`, 'row-desc ext-error'));
    if (!pane.data) return;
  }
  if (!pane.data) {
    surfaceBusy(options, true);
    return;
  }
  if (kind === 'mcp') renderMcpPane(pane);
  else if (kind === 'skills') renderSkillsPane(pane);
  else renderPluginsPane(pane);
}
