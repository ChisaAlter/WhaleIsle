/* dsh-acp-agents client: ACP account settings and native model-menu extensions. */
window.__ModuleLoader__.load({
  id: 'dsh-acp-agents',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const {
      createElement: h,
      Fragment,
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef,
      useSyncExternalStore,
    } = react;

    const {
      Button: HostButton,
      Input,
      Modal,
      StateDot,
      Switch,
      IconCheckOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronRightOutlineRegular,
      IconAgentPresetOutlineRegular,
    } = primitives;

    function Button({ loading, disabled, icon, ...props }) {
      // aria-busy is understood by both hosts; `loading` is desktop-only and
      // otherwise leaks onto a native button without blocking repeat submits.
      return h(HostButton, {
        ...props,
        disabled: Boolean(disabled || loading),
        'aria-busy': loading || props['aria-busy'],
        icon: loading ? h(StateDot, { state: 'ongoing', size: 14 }) : icon,
      });
    }

    // The desktop shell extends the standard DSH primitives namespace. Keep
    // those implementations when present without requiring them for activation.
    const SettingsSelect = primitives.SettingsSelect ?? function NativeSettingsSelect({ options, onChange, variant, className, ...props }) {
      return h('select', {
        ...props,
        className: ['dsh-acp-settings-select', className].filter(Boolean).join(' '),
        onChange: (event) => onChange?.(event.currentTarget.value),
      }, options.map((option) => h('option', {
        key: option.id, value: option.id, disabled: option.disabled,
      }, option.label)));
    };
    const IconPlusOutline16 = primitives.IconPlusOutline16 ?? primitives.IconPlusOutlineRegular;
    const IconRefreshOutline16 = primitives.IconRefreshOutline16 ?? primitives.IconRefreshOutlineRegular;
    const IconSettingsOutline16 = primitives.IconSettingsOutline16 ?? primitives.IconSettingsOutlineRegular;
    const IconTrashOutline16 = primitives.IconTrashOutline16 ?? primitives.IconTrashOutlineRegular;

    const NS = 'dsh-acp-agents';
    const SETTINGS_SECTION_ID = 'acp-agents';
    const ACP_PREFIX = 'acp:';
    // Registry ids already covered by a first-class preset option in the
    // "add instance" type picker — they must not be listed twice.
    const BUILTIN_REGISTRY_IDS = new Set(['claude-acp', 'codex-acp', 'antigravity-acp', 'devin']);
    // ACP runtime "Add provider" card grid: first-class presets get the official ACP
    // registry brand icons (same CDN the registry list uses).
    const ACP_REGISTRY_ICON_BASE = 'https://cdn.agentclientprotocol.com/registry/v1/latest';
    const ADD_PROVIDER_CARDS = [
      { id: 'claude-code', label: 'Claude Code', icon: `${ACP_REGISTRY_ICON_BASE}/claude-acp.svg` },
      { id: 'codex', label: 'OpenAI Codex', icon: `${ACP_REGISTRY_ICON_BASE}/codex-acp.svg` },
      { id: 'antigravity', label: 'Google Antigravity', icon: `${ACP_REGISTRY_ICON_BASE}/antigravity-acp.svg` },
      { id: 'devin', label: 'Cognition Devin', icon: `${ACP_REGISTRY_ICON_BASE}/devin.svg` },
    ];

    const zh = {
      nav: 'Agent',
      'delegate.child': '外部子代理',
      'delegate.running': '运行中',
      'delegate.waiting_approval': '等待审批',
      'delegate.waiting_question': '等待回答',
      'delegate.completed': '已完成',
      'delegate.failed': '失败',
      'delegate.cancelled': '已停止',
      'delegate.open': '查看子会话',
      'page.title': 'Agent 与账号管理',
      'page.subtitle': '管理本地 CLI 智能体（Claude Code、Codex、Antigravity、Devin）的账号登录、OAuth 授权、多账号实例、API 密钥与可用模型。',
      'page.addInstance': '添加账号 / Agent',
      'page.refresh': '刷新状态',
      'status.authenticated': '已登录',
      'status.unauthenticated': '未登录',
      'status.acpAuthed': 'ACP 会话已认证',
      'status.missing': '未安装 CLI',
      'status.activeSessions': '{count} 个活跃会话',
      'action.test': '测试连接并同步模型',
      'action.testing': '连接中…',
      'action.login': '登录账号',
      'action.relogin': '切换 / 重新登录',
      'action.logout': '退出登录',
      'action.cancelLogin': '取消登录',
      'action.reauth': '清除凭据并重新登录',
      'action.openBrowser': '打开浏览器登录',
      'action.copyUrl': '复制登录链接',
      'action.copied': '已复制链接',
      'action.connect': '连接',
      'action.continue': '继续',
      'action.saveCredentials': '保存密钥并生效',
      'action.saveRuntime': '保存配置',
      'action.addAccount': '新建同类型账号',
      'action.reset': '恢复默认',
      'action.delete': '删除实例',
      'action.retry': '重试',
      'section.account': '账号与登录认证',
      'section.accountDesc': '查看当前 CLI 登录账号与订阅状态，支持浏览器 OAuth 登录、设备码授权或 API Key 接入。',
      'section.models': '模型管理',
      'section.modelsDesc': '搜索、收藏、启用或隐藏该 Agent 在底部模型选择器中展示的模型。',
      'section.runtime': '运行时与权限设置',
      'section.runtimeDesc': '自定义 CLI 可执行文件路径、启动参数、独立账号配置目录与工具审批策略。',
      'section.env': '环境变量与网关配置',
      'section.envDesc': '为该 Agent 进程注入自定义环境变量（如 ANTHROPIC_BASE_URL、HTTPS_PROXY 等）。',
      'account.profileDir': '独立配置目录',
      'account.reveal': '点击显示/隐藏完整邮箱',
      'account.notLoggedIn': '当前未登录账号',
      'models.searchPh': '搜索模型名称或 ID…',
      'models.addPh': '输入新模型 ID（可选：model-id | 显示名称）',
      'models.addBtn': '添加模型',
      'models.syncBtn': '从 CLI 同步模型',
      'models.count': '已启用 {enabled} / 共 {total} 个模型',
      'models.showAll': '全部启用',
      'models.hideAll': '全部关闭',
      'models.favorite': '设为常用置顶',
      'models.discovered': 'CLI 发现',
      'field.name': '显示名称',
      'field.badge': '厂商标签',
      'field.command': '可执行命令 / 路径',
      'field.args': '启动参数（空格分隔）',
      'field.profileDir': '独立配置目录（多账号隔离）',
      'field.profileDirPh': '留空则使用本机默认目录 (~/.claude / ~/.codex / ~/.dsh/antigravity)',
      'field.permission': '工具权限策略',
      'field.permission.ask': '每次操作前询问确认（默认）',
      'field.permission.read': '只读操作自动允许，写入与命令询问确认',
      'field.permission.all': '自动批准全部工具操作',
      'env.addRow': '添加环境变量',
      'env.keyPh': '变量名 (如 HTTPS_PROXY)',
      'env.valPh': '变量值',
      'env.empty': '暂未配置额外环境变量。',
      'modal.addTitle': '添加新账号实例或自定义 Agent',
      'modal.addType': '选择类型',
      'modal.addName': '实例显示名称',
      'modal.addNamePh': '例如：Claude Code (工作号) / Codex #2',
      'modal.showMore': '显示更多',
      'modal.showLess': '收起',
      'modal.registrySearchPh': '搜索 ACP Registry…',
      'modal.registryLoading': '正在加载 ACP Registry…',
      'modal.registryEmpty': '没有匹配的 Agent',
      'modal.customCard': '自定义 ACP 智能体',
      'modal.close': '关闭',
      'modal.cancel': '取消',
      'modal.create': '创建实例',
      'modal.deleteTitle': '删除实例',
      'modal.resetTitle': '恢复默认',
      'modal.deleteBody': '将永久删除实例「{name}」及其全部配置与已保存凭据，此操作不可撤销。',
      'modal.resetBody': '将重置「{name}」为默认配置：自定义命令、启动参数、环境变量、模型列表与已保存凭据将全部清除，此操作不可撤销。',
      'test.ok': '{name} 连接成功（{binary}）',
      'test.okSynced': '{name} 连接成功（{binary}）· 同步 {found} 个模型，新增 {added} 个',
      'test.failed': '{name} 连接失败：{error}',
      'test.handshakeFailed': '握手失败',
      'action.savedDone': '保存完成',
      'saveFailed': '操作失败：{message}',
      'loadFailed': '读取配置失败：{message}',
      'login.started': '已发起登录流程，请在浏览器中完成授权。',
      'login.callbackHint': '若浏览器中的 localhost 页面打不开，把完整链接粘贴到这里。',
      'login.waitingBrowser': '正在等待浏览器授权…',
      'login.openBrowser': '打开浏览器授权',
      'login.flowFailed': '登录失败，请重新开始。',
      'login.flowExpired': '登录已过期，请重新开始。',
      'login.terminalPh': '输入内容后回车发送到登录终端…',
      'logout.done': '已退出登录：{name}',
      'logout.partial': '已清除本地 API 凭据；Agent 退出登录失败：{message}',
      'options.needsSession': '发送首条消息后，可为此会话设置选项。',
      'provider.account': 'DeepSeek 账号',
      'menu.agent': 'Agent',
      'menu.model': '模型',
      'menu.effort': '推理等级',
      'menu.aria': 'Agent、模型与推理等级',
      'menu.manageAgents': '管理 Agent 与账号设置…',
      'aside.current': '当前',
      'aside.noSelection': '未选择模型',
      'agent.defaultName': 'DeepSeek Harness',
      'agent.defaultBadge': '内置 / API',
      'agent.externalBadge': 'ACP',
      'trigger.loading': '正在加载模型…',
      'trigger.fallback': '请选择模型',
      'trigger.selectAria': '请选择模型',
      'trigger.aria': '选择模型，当前 {model}',
      'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
      'trigger.ariaAgent': '选择智能体与模型，当前 {agent} · {model}',
      'trigger.ariaAgentEffort': '选择智能体与模型，当前 {agent} · {model}，推理等级 {effort}',
      'effort.providerDefault': '默认',
      'effort.low': '低 (Low)',
      'effort.medium': '中 (Medium)',
      'effort.high': '高 (High)',
      'agent.disabledHint': '未启用 · 点击模型自动启用',
      'agent.enableBtn': '立即启用',
      'agent.enabledBadge': '已启用',
      'agent.disabledBadge': '未启用',
      'search.placeholder': '搜索模型或 Agent…',
      'search.clear': '清除搜索',
      'search.empty': '没有匹配的模型。',
      'empty.models': '当前 Agent 暂无可用模型，请前往设置检查配置。',
      'warning.groupLoad': '{name} 加载失败：{message}',
      'error.sessionInUse': '当前会话正在运行或被占用，请稍后切换模型。',
      'error.action': '模型切换失败：{message}',
      'error.settingsNav': '请从“设置 → Agent”打开账号管理。',
      'action.reload': '重新加载',
    };

    const en = {
      nav: 'Agent',
      'delegate.child': 'External subagent',
      'delegate.running': 'Running',
      'delegate.waiting_approval': 'Approval needed',
      'delegate.waiting_question': 'Answer needed',
      'delegate.completed': 'Completed',
      'delegate.failed': 'Failed',
      'delegate.cancelled': 'Stopped',
      'delegate.open': 'Open child conversation',
      'page.title': 'Agents & Accounts',
      'page.subtitle': 'Manage local CLI coding agents (Claude Code, Codex, Antigravity, Devin), OAuth sign-in, multi-account instances, API keys, and models.',
      'page.addInstance': 'Add Account / Agent',
      'page.refresh': 'Refresh',
      'status.authenticated': 'Signed in',
      'status.unauthenticated': 'Not signed in',
      'status.acpAuthed': 'ACP session authenticated',
      'status.missing': 'CLI not found',
      'status.activeSessions': '{count} active session(s)',
      'action.test': 'Test & Sync Models',
      'action.testing': 'Testing…',
      'action.login': 'Sign in',
      'action.relogin': 'Switch / Re-authenticate',
      'action.logout': 'Sign out',
      'action.cancelLogin': 'Cancel sign-in',
      'action.reauth': 'Clear credentials & sign in',
      'action.openBrowser': 'Open in Browser',
      'action.copyUrl': 'Copy Sign-in Link',
      'action.copied': 'Link Copied',
      'action.connect': 'Connect',
      'action.continue': 'Continue',
      'action.saveCredentials': 'Save Credentials',
      'action.saveRuntime': 'Save Settings',
      'action.addAccount': 'Add Another Account',
      'action.reset': 'Reset Default',
      'action.delete': 'Delete Instance',
      'action.retry': 'Retry',
      'section.account': 'Account & Authentication',
      'section.accountDesc': 'View signed-in account and subscription tier, or authenticate via browser OAuth, device code, or API key.',
      'section.models': 'Models',
      'section.modelsDesc': 'Search, favorite, enable, or hide models exposed by this Agent in the composer picker.',
      'section.runtime': 'Runtime & Permissions',
      'section.runtimeDesc': 'Configure CLI binary path, arguments, isolated profile directory, and tool approval policy.',
      'section.env': 'Environment Variables',
      'section.envDesc': 'Inject custom environment variables (e.g. ANTHROPIC_BASE_URL, HTTPS_PROXY) into the Agent process.',
      'account.profileDir': 'Isolated Profile Dir',
      'account.reveal': 'Click to reveal/hide full email',
      'account.notLoggedIn': 'Not signed in',
      'models.searchPh': 'Search model name or ID…',
      'models.addPh': 'Add custom model ID (or model-id | Display Name)',
      'models.addBtn': 'Add Model',
      'models.syncBtn': 'Sync from CLI',
      'models.count': '{enabled} enabled / {total} total models',
      'models.showAll': 'Enable All',
      'models.hideAll': 'Disable All',
      'models.favorite': 'Pin as favorite',
      'models.discovered': 'Discovered',
      'field.name': 'Display Name',
      'field.badge': 'Vendor Badge',
      'field.command': 'Executable Command / Path',
      'field.args': 'Launch Arguments (space-separated)',
      'field.profileDir': 'Isolated Profile Directory',
      'field.profileDirPh': 'Leave empty to use the default profile directory (~/.claude / ~/.codex / ~/.dsh/antigravity)',
      'field.permission': 'Tool Permission Policy',
      'field.permission.ask': 'Always ask before running tools (Default)',
      'field.permission.read': 'Auto-allow read-only tools, ask on edits and commands',
      'field.permission.all': 'Auto-approve all tool operations',
      'env.addRow': 'Add Variable',
      'env.keyPh': 'KEY (e.g. HTTPS_PROXY)',
      'env.valPh': 'VALUE',
      'env.empty': 'No custom environment variables configured.',
      'modal.addTitle': 'Add Account Instance or Custom Agent',
      'modal.addType': 'Provider Type',
      'modal.addName': 'Instance Display Name',
      'modal.addNamePh': 'e.g. Claude Code (Work) / Codex #2',
      'modal.showMore': 'Show more',
      'modal.showLess': 'Show less',
      'modal.registrySearchPh': 'Search ACP Registry…',
      'modal.registryLoading': 'Loading ACP Registry…',
      'modal.registryEmpty': 'No matching agents',
      'modal.customCard': 'Custom ACP Agent',
      'modal.close': 'Close',
      'modal.cancel': 'Cancel',
      'modal.create': 'Create Instance',
      'modal.deleteTitle': 'Delete Instance',
      'modal.resetTitle': 'Reset to Defaults',
      'modal.deleteBody': 'Permanently delete the "{name}" instance together with all of its configuration and saved credentials. This cannot be undone.',
      'modal.resetBody': 'Reset "{name}" to defaults: custom command, launch arguments, environment variables, model lists, and saved credentials will be cleared. This cannot be undone.',
      'test.ok': '{name} connected ({binary})',
      'test.okSynced': '{name} connected ({binary}) · synced {found} models, {added} new',
      'test.failed': '{name} connection failed: {error}',
      'test.handshakeFailed': 'Handshake failed',
      'action.savedDone': 'Saved',
      'saveFailed': 'Operation failed: {message}',
      'loadFailed': 'Failed to load configuration: {message}',
      'login.started': 'Sign-in started. Complete authentication in your browser.',
      'login.callbackHint': 'If the final localhost page does not load, paste its full URL here.',
      'login.waitingBrowser': 'Waiting for browser authorization…',
      'login.openBrowser': 'Authorize in browser',
      'login.flowFailed': 'Sign-in failed. Start again.',
      'login.flowExpired': 'Sign-in expired. Start again.',
      'login.terminalPh': 'Type input and press Enter to send…',
      'logout.done': 'Signed out of {name}',
      'logout.partial': 'Local API credentials cleared; agent sign-out failed: {message}',
      'options.needsSession': 'Send the first message to configure options for this conversation.',
      'provider.account': 'DeepSeek Account',
      'menu.agent': 'Agent',
      'menu.model': 'Model',
      'menu.effort': 'Effort',
      'menu.aria': 'Agent, model, and reasoning effort',
      'menu.manageAgents': 'Manage Agents & Accounts…',
      'aside.current': 'Current',
      'aside.noSelection': 'No model selected',
      'agent.defaultName': 'DeepSeek Harness',
      'agent.defaultBadge': 'Built-in / API',
      'agent.externalBadge': 'ACP',
      'trigger.loading': 'Loading models…',
      'trigger.fallback': 'Select model',
      'trigger.selectAria': 'Select model',
      'trigger.aria': 'Select model, current {model}',
      'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
      'trigger.ariaAgent': 'Select agent and model, current {agent} · {model}',
      'trigger.ariaAgentEffort': 'Select agent and model, current {agent} · {model}, reasoning effort {effort}',
      'effort.providerDefault': 'Default',
      'effort.low': 'Low',
      'effort.medium': 'Medium',
      'effort.high': 'High',
      'agent.disabledHint': 'Disabled · Click any model to auto-enable',
      'agent.enableBtn': 'Enable',
      'agent.enabledBadge': 'Enabled',
      'agent.disabledBadge': 'Disabled',
      'search.placeholder': 'Search models or agents…',
      'search.clear': 'Clear search',
      'search.empty': 'No matching models.',
      'empty.models': 'No models available for this Agent. Check Settings -> Agent.',
      'warning.groupLoad': '{name} failed to load: {message}',
      'error.sessionInUse': 'This session is currently busy. Try switching models once the turn finishes.',
      'error.action': 'Model operation failed: {message}',
      'error.settingsNav': 'Open Settings → Agent to manage accounts.',
      'action.reload': 'Reload',
    };

    const CSS_TEXT = `
/* ACP Master-Detail Provider & Account Settings */
.dsh-acp-settings {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 980px;
  padding: 6px 0 32px;
  color: var(--dsw-alias-label-primary);
  gap: 14px;
}
.dsh-acp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dsh-acp-banner {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 90;
  max-width: 360px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 18px;
  background: var(--dsw-alias-bg-layer-2, rgba(24,24,27,0.96));
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-banner[data-error="true"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  border-color: rgba(239, 68, 68, 0.35);
}

/* Top 2-Column Agent Switcher Grid + Full-Width Selected Agent Detail Stack (fits 564px Settings .options) */
.dsh-acp-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}

.dsh-acp-rail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}
@media (max-width: 520px) {
  .dsh-acp-rail {
    grid-template-columns: 1fr;
  }
}
.dsh-acp-rail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  text-align: left;
  min-width: 0;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.dsh-acp-rail-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-rail-item[data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.07));
  border-color: var(--dsw-alias-label-primary, rgba(255,255,255,0.45));
  box-shadow: 0 0 0 0.5px var(--dsw-alias-label-primary, rgba(255,255,255,0.25));
}
.dsh-acp-rail-item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-rail-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dsh-acp-rail-name {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-rail-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Full-Width Detail Stack */
.dsh-acp-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}
.dsh-acp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  min-width: 0;
  box-sizing: border-box;
}
.dsh-acp-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.dsh-acp-card-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  flex: 1;
}
.dsh-acp-card-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-acp-card-title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-acp-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.dsh-acp-actions-slot {
  display: inline-flex;
  align-items: center;
}
.dsh-acp-card-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-cmd-bar {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.22);
  border: 0.5px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-acp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-badge[data-tone="success"] {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.28);
}
.dsh-acp-badge[data-tone="warning"] {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.28);
}
.dsh-acp-badge[data-tone="plan"] {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}

/* Account Info Grid */
.dsh-acp-account-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.03));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-acp-account-user {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-account-email {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  border: 0.5px dashed var(--dsw-alias-border-l2);
}
.dsh-acp-account-email:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-account-msg {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
}

/* Auth method tabs */
.dsh-acp-auth-methods {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}
.dsh-acp-auth-method-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease;
}
.dsh-acp-auth-method-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-auth-method-card[data-active="true"] {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.06));
}
.dsh-acp-auth-method-title {
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-auth-method-desc {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}

/* Live OAuth Flow Box */
.dsh-acp-flow-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.06);
}
.dsh-acp-flow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-acp-flow-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-code {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-flow-url {
  flex: 1;
  min-width: 180px;
  padding: 5px 8px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  background: rgba(0, 0, 0, 0.2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-flow-logs {
  max-height: 90px;
  overflow-y: auto;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}
.dsh-acp-flow-terminal {
  max-height: 160px;
  overflow-y: auto;
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  border: 0.5px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary);
  white-space: pre-wrap;
}
.dsh-acp-flow-callback {
  display: grid;
  gap: 6px;
}
.dsh-acp-field {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-field input.dsh-acp-raw-input {
  padding: 5px 8px;
  border-radius: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: rgba(0, 0, 0, 0.2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}

/* Models Manager */
.dsh-acp-models-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-models-toolbar-input {
  flex: 1;
  min-width: 180px;
}
.dsh-acp-models-list {
  display: flex;
  flex-direction: column;
  max-height: 290px;
  overflow-y: auto;
  border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  divide-y: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row:last-child {
  border-bottom: none;
}
.dsh-acp-model-row[data-hidden="true"] {
  opacity: 0.52;
}
.dsh-acp-model-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-star-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-star-btn[data-fav="true"] {
  color: #f59e0b;
}
.dsh-acp-model-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-id {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Form fields & Env table */
.dsh-acp-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.dsh-acp-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dsh-acp-field-label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-settings-select {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l4);
  border-radius: 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
}
.dsh-acp-settings-select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh-acp-settings-select:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.dsh-acp-env-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-acp-env-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(160px, 1.5fr) auto;
  gap: 8px;
  align-items: center;
}
.dsh-acp-meta-line {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}
.dsh-acp-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* ACP runtime Add-provider card picker */
.dsh-acp-provider-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.dsh-acp-provider-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--dsw-alias-label-primary);
  transition: background 120ms ease, border-color 120ms ease;
}
.dsh-acp-provider-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-provider-card[data-selected="true"] {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.06));
}
.dsh-acp-provider-icon {
  position: relative;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.06));
  overflow: hidden;
}
.dsh-acp-provider-icon-letter {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-provider-icon img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: var(--dsw-alias-bg-primary, transparent);
}
.dsh-acp-provider-name {
  font-size: 12.5px;
  line-height: 17px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-provider-check {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-showmore {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 2px 0;
  font: inherit;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-acp-showmore:hover {
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-showmore[data-open="true"] svg {
  transform: rotate(180deg);
}
.dsh-acp-registry {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-acp-registry-grid {
  max-height: 224px;
  overflow-y: auto;
  padding-right: 2px;
}
.dsh-acp-registry-hint {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
  padding: 8px 2px;
}

.dsh-acp-session-options { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding-top: 6px; }
.dsh-acp-session-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 20px; }
.dsh-acp-session-option > select { width: auto; max-width: 60%; }
.dsh-acp-session-option > input { accent-color: var(--dsw-alias-state-business-primary); }

`;

    const DELEGATION_CSS = `
.dsh-acp-child { margin: 4px 0; min-width: 0; color: var(--dsw-alias-label-primary); container-type: inline-size; }
.dsh-acp-child-open { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; height: 40px; padding: 4px 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; text-align: left; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 400; line-height: 20px; white-space: nowrap; }
.dsh-acp-child-open:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-acp-child-open:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }
.dsh-acp-child-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
.dsh-acp-child-icon img { display: block; width: 16px; height: 16px; object-fit: contain; filter: brightness(0); }
html[data-ds-theme-source="dark"] .dsh-acp-child-icon img { filter: brightness(0) invert(1); }
.dsh-acp-child-identity { display: flex; flex-direction: column; justify-content: center; flex: 0 1 176px; min-width: 0; }
.dsh-acp-child-agent { overflow: hidden; text-overflow: ellipsis; font-weight: 500; line-height: 17px; }
.dsh-acp-child-model { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 14px; }
.dsh-acp-child-task { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-secondary); }
.dsh-acp-child-status { display: inline-flex; align-items: center; flex-shrink: 0; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-acp-child-elapsed { flex-shrink: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.dsh-acp-child[data-status="failed"] .dsh-acp-child-status, .dsh-acp-child[data-status="failed"] .dsh-acp-child-task { color: var(--dsw-alias-state-error-primary); }
.dsh-acp-child-open > svg { flex-shrink: 0; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .dsh-acp-child-identity { flex: 1; }
  .dsh-acp-child-task, .dsh-acp-child-elapsed, .dsh-acp-child-open > svg { display: none; }
}
`;

    function injectCss() {
      if (typeof document === 'undefined') return;
      let style = document.getElementById('dsh-acp-agents-styles');
      if (!style) {
        style = document.createElement('style');
        style.id = 'dsh-acp-agents-styles';
        document.head.appendChild(style);
      }
      style.textContent = CSS_TEXT + DELEGATION_CSS;
    }

    function rpcValue(response) {
      if (response && typeof response === 'object' && 'ok' in response) {
        if (response.ok) return response.value;
        const msg = response.error?.message || response.error?.code || 'RPC error';
        throw new Error(msg);
      }
      return response;
    }

    function maskEmail(email) {
      const clean = String(email || '').trim();
      const at = clean.indexOf('@');
      if (at <= 1) return clean;
      const local = clean.slice(0, at);
      const domain = clean.slice(at);
      const visible = local.slice(0, Math.min(2, local.length));
      return `${visible}***${domain}`;
    }

    function unwrapSwitchChecked(val, fallback) {
      if (typeof val === 'boolean') return val;
      if (typeof val?.target?.checked === 'boolean') return val.target.checked;
      return fallback;
    }

    // Shell-style args round-trip: split on whitespace but keep quoted
    // segments whole (single/double quotes, backslash escape inside double
    // quotes); join quotes back any arg containing whitespace or quotes so a
    // saved list re-renders to the same values.
    function splitArgsText(text) {
      const out = [];
      let cur = '';
      let quote = null;
      let hasToken = false;
      const src = String(text || '');
      for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
          if (ch === quote) {
            quote = null;
          } else if (ch === '\\' && quote === '"' && i + 1 < src.length) {
            i += 1;
            cur += src[i];
          } else {
            cur += ch;
          }
        } else if (ch === '"' || ch === "'") {
          quote = ch;
          hasToken = true;
        } else if (/\s/.test(ch)) {
          if (hasToken || cur !== '') {
            out.push(cur);
            cur = '';
            hasToken = false;
          }
        } else {
          cur += ch;
        }
      }
      if (hasToken || cur !== '') out.push(cur);
      return out;
    }

    function joinArgsText(args) {
      return (Array.isArray(args) ? args : [])
        .map((arg) => {
          const s = String(arg ?? '');
          if (s === '') return '""';
          return /[\s"'\\]/.test(s)
            ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
            : s;
        })
        .join(' ');
    }

    // Vendored ACP runtime auth flows report English terminal messages verbatim —
    // remap the known ones through the dictionary so zh never leaks EN copy.
    const FLOW_MESSAGE_KEYS = {
      'Sign-in failed. Start again.': 'login.flowFailed',
      'Sign-in expired. Start again.': 'login.flowExpired',
    };

    /**
     * ACP Provider & Account Settings Panel (`Settings -> Agent`).
     */
    function AgentsSettingsSection(props) {
      const { rpc, t } = props;
      const [catalog, setCatalog] = useState(null);
      const [selectedId, setSelectedId] = useState('claude-code');
      const [loading, setLoading] = useState(true);
      const [busyAction, setBusyAction] = useState('');
      const [banner, setBanner] = useState(null);
      const [probeAuthAction, setProbeAuthAction] = useState(null);
      const [savedFlash, setSavedFlash] = useState(null);
      const [revealEmail, setRevealEmail] = useState(false);
      const [copiedUrl, setCopiedUrl] = useState(false);

      // Selected Agent draft states
      const [activeAuthMethod, setActiveAuthMethod] = useState('');
      const [credDraft, setCredDraft] = useState({});
      const [flowCredDraft, setFlowCredDraft] = useState({});
      const [callbackDraft, setCallbackDraft] = useState('');
      const [modelQuery, setModelQuery] = useState('');
      const [newModelInput, setNewModelInput] = useState('');
      const [runtimeDraft, setRuntimeDraft] = useState({
        name: '',
        badge: '',
        command: undefined,
        argsText: '',
        profileDir: '',
        permissionPolicy: 'ask',
        envRows: [],
      });
      // env keys present when the draft was built — lets the save path merge
      // credentials that arrived later (account card) instead of wiping them.
      const envBaselineRef = useRef([]);
      const [terminalDraft, setTerminalDraft] = useState('');

      // Destructive action confirmation (delete instance / reset defaults)
      const [confirmDelete, setConfirmDelete] = useState(false);

      // Add Account / Custom Agent Modal
      const [addModal, setAddModal] = useState(null);
      const [registryAgents, setRegistryAgents] = useState(null);

      // Lazily load the official ACP registry catalog when the picker expands —
      // mirrors ACP runtime Settings → Providers → Add provider → "Show more".
      useEffect(() => {
        if (!addModal?.showMore || registryAgents !== null) return;
        let cancelled = false;
        rpc('agent/registry-search', { limit: 100 })
          .then((res) => {
            if (!cancelled) setRegistryAgents(Array.isArray(res?.agents) ? res.agents : []);
          })
          .catch(() => {
            if (!cancelled) setRegistryAgents([]);
          });
        return () => {
          cancelled = true;
        };
      }, [addModal?.showMore, registryAgents]);

      const loadCatalog = useCallback(
        async (refreshAccounts = false) => {
          try {
            setLoading(true);
            const data = await rpc('catalog', { refreshAccounts });
            setCatalog(data);
          } catch (err) {
            setBanner({ error: true, text: t('loadFailed', { message: err?.message || String(err) }) });
          } finally {
            setLoading(false);
          }
        },
        [rpc, t],
      );

      useEffect(() => {
        void loadCatalog(true);
      }, [loadCatalog]);

      const agents = catalog?.agents || [];
      const selectedAgent = useMemo(
        () => agents.find((a) => a.id === selectedId) || agents[0] || null,
        [agents, selectedId],
      );

      // Sync local drafts when switching selected Agent
      useEffect(() => {
        if (!selectedAgent) return;
        const methods = selectedAgent.account?.availableMethods || [];
        const currentMethod =
          selectedAgent.account?.authMethod
          || selectedAgent.authMethod
          || methods[0]?.id
          || '';
        setActiveAuthMethod(currentMethod);

        const nextCreds = {};
        for (const m of methods) {
          for (const f of m.fields || []) {
            nextCreds[f.key] = selectedAgent.env?.[f.key] || '';
          }
        }
        setCredDraft(nextCreds);

        const envEntries = Object.entries(selectedAgent.env || {}).map(([key, value]) => ({
          key,
          value: String(value ?? ''),
        }));
        envBaselineRef.current = Object.keys(selectedAgent.env || {});
        setRuntimeDraft({
          name: selectedAgent.name || '',
          badge: selectedAgent.badge || 'ACP',
          // undefined = field untouched → keep persisted command; '' = the
          // user blanked it on purpose → send empty so the preset default
          // takes over.
          command: undefined,
          argsText: joinArgsText(selectedAgent.args),
          profileDir: selectedAgent.profileDir || '',
          permissionPolicy: selectedAgent.permissionPolicy || 'ask',
          envRows: envEntries,
        });
        setTerminalDraft('');
        setConfirmDelete(false);
        setModelQuery('');
        setNewModelInput('');
      }, [selectedAgent?.id]);

      // Auto-poll while a ACP runtime ProviderAuthFlow is in a live phase
      const activeFlow = selectedAgent?.authFlow;
      const flowPhase = activeFlow?.phase;
      const flowActive =
        flowPhase === 'starting' || flowPhase === 'waiting' || flowPhase === 'verifying';
      // ACP runtime: interaction.url wins over authorizationUrl (ProviderAuthenticationSection.tsx).
      const flowInteraction = activeFlow?.interaction ?? null;
      const flowUrl =
        flowInteraction?.type === 'browser' || flowInteraction?.type === 'deviceCode'
          ? flowInteraction.url
          : activeFlow?.authorizationUrl ?? null;
      const flowNeedsConsent =
        flowInteraction?.type === 'browser' && flowInteraction.requiresConsent === true;
      useEffect(() => {
        if (!flowActive) {
          return undefined;
        }
        const timer = setInterval(() => {
          void rpc('catalog', { refreshAccounts: false })
            .then((data) => {
              if (data) setCatalog(data);
            })
            .catch(() => {});
        }, 1500);
        return () => clearInterval(timer);
      }, [flowActive, selectedAgent?.id, rpc]);

      // Floating banner: auto-dismiss non-error messages; errors persist until the next action
      useEffect(() => {
        if (!banner || banner.error) return undefined;
        const timer = setTimeout(() => setBanner(null), 4500);
        return () => clearTimeout(timer);
      }, [banner]);

      const toggleAgentEnabled = async (agent, nextVal) => {
        const enabled = unwrapSwitchChecked(nextVal, !agent.enabled);
        setBusyAction(`toggle:${agent.id}`);
        setBanner(null);
        try {
          const next = await rpc('agent/toggle', { id: agent.id, enabled });
          setCatalog(next);
          if (enabled) {
            setTimeout(() => {
              void rpc('catalog').then((d) => d && setCatalog(d)).catch(() => {});
            }, 2200);
          }
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const testAndSyncAgent = async (agent) => {
        setBusyAction(`test:${agent.id}`);
        setBanner(null);
        let active = true;
        let polling = false;
        const poll = async () => {
          if (polling || !active) return;
          polling = true;
          try { const action = await rpc('agent/auth-action', { id: agent.id }); if (active) setProbeAuthAction(action ? { ...action, agentId: agent.id } : null); }
          catch { /* The probe result carries errors; this only observes pending consent. */ }
          finally { polling = false; }
        };
        const consentTimer = setInterval(() => { void poll(); }, 1000);
        try {
          const res = await rpc('agent/test', { id: agent.id });
          if (res?.catalog) setCatalog(res.catalog);
          if (res?.ok) {
            setBanner({
              error: false,
              text:
                typeof res.modelsFound === 'number'
                  ? t('test.okSynced', {
                      name: agent.name,
                      binary: res.binaryPath || agent.command,
                      found: String(res.modelsFound),
                      added: String(res.modelsAdded ?? 0),
                    })
                  : t('test.ok', { name: agent.name, binary: res.binaryPath || agent.command }),
            });
          } else {
            setBanner({
              error: true,
              text: t('test.failed', { name: agent.name, error: res?.error || t('test.handshakeFailed') }),
            });
          }
        } catch (err) {
          setBanner({
            error: true,
            text: t('test.failed', { name: agent.name, error: err?.message || String(err) }),
          });
        } finally {
          active = false;
          clearInterval(consentTimer);
          setProbeAuthAction(null);
          setBusyAction('');
        }
      };

      const startLoginFlow = async (forceNewToken = false) => {
        if (!selectedAgent) return;
        setBusyAction('login');
        setBanner(null);
        try {
          const res = await rpc('agent/login', {
            id: selectedAgent.id,
            methodId: activeAuthMethod,
            forceNewToken,
          });
          if (res?.catalog) setCatalog(res.catalog);
          setBanner({ error: false, text: t('login.started') });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const saveApiKeyCredentials = async () => {
        if (!selectedAgent) return;
        setBusyAction('save-creds');
        setBanner(null);
        try {
          const res = await rpc('agent/login', {
            id: selectedAgent.id,
            methodId: activeAuthMethod,
            credentials: credDraft,
            onlySaveCredentials: true,
          });
          if (res?.catalog) setCatalog(res.catalog);
          setSavedFlash('save-creds');
          setTimeout(() => setSavedFlash((cur) => (cur === 'save-creds' ? null : cur)), 1800);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const cancelLoginFlow = async () => {
        if (!selectedAgent) return;
        try {
          const next = await rpc('agent/login/cancel', { id: selectedAgent.id });
          setCatalog(next);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        }
      };

      // ACP runtime openBrowser(): consent is recorded before the URL is opened; the
      // same accept is sent on copy-link so consent semantics stay honest.
      const respondLoginFlow = async (response) => {
        if (!selectedAgent) return false;
        try {
          const res = await rpc('agent/login/respond', { id: selectedAgent.id, response });
          if (res?.catalog) setCatalog(res.catalog);
          return Boolean(res?.sent);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
          return false;
        }
      };
      const completeLoginFlow = async (callbackUrl) => {
        if (!selectedAgent || !callbackUrl) return;
        try {
          const res = await rpc('agent/login/complete', { id: selectedAgent.id, callbackUrl });
          if (res?.catalog) setCatalog(res.catalog);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        }
      };
      const openLoginUrl = async () => {
        if (!flowUrl) return;
        try {
          if (flowNeedsConsent && !(await respondLoginFlow({ type: 'browser', action: 'accept' }))) {
            return;
          }
          await rpc('agent/open-url', { url: flowUrl });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        }
      };
      const copyLoginUrl = async () => {
        if (!flowUrl) return;
        try {
          await navigator.clipboard?.writeText?.(flowUrl);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
          return;
        }
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 1800);
        if (flowNeedsConsent) {
          await respondLoginFlow({ type: 'browser', action: 'accept' }).catch(() => {});
        }
      };

      const reauthFlow = async () => {
        if (!selectedAgent) return;
        setBusyAction('reauth');
        setBanner(null);
        try {
          const res = await rpc('agent/login/reauth', { id: selectedAgent.id, methodId: activeAuthMethod });
          if (res?.catalog) setCatalog(res.catalog);
          setBanner({ error: false, text: t('login.started') });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const logoutCurrentAgent = async () => {
        if (!selectedAgent) return;
        setBusyAction('logout');
        setBanner(null);
        try {
          const next = await rpc('agent/logout', {
            id: selectedAgent.id,
            clearApiKeys: true,
          });
          setCatalog(next);
          setBanner(next.logoutWarning
            ? { error: true, text: t('logout.partial', { message: next.logoutWarning }) }
            : { error: false, text: t('logout.done', { name: selectedAgent.name }) });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const patchCatalogAgent = (agentId, patch) => {
        setCatalog((cur) => {
          if (!cur?.agents) return cur;
          return {
            ...cur,
            agents: cur.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)),
          };
        });
      };

      const saveAgentPatch = async (patch, flashKey) => {
        if (!selectedAgent) return false;
        setBusyAction('save');
        setBanner(null);
        try {
          const next = await rpc('agent/save', {
            agent: {
              ...patch,
              id: selectedAgent.id,
            },
          });
          setCatalog(next);
          if (flashKey) {
            setSavedFlash(flashKey);
            setTimeout(() => setSavedFlash((cur) => (cur === flashKey ? null : cur)), 1800);
          }
          return true;
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
          return false;
        } finally {
          setBusyAction('');
        }
      };

      const toggleModelFavorite = async (modelId) => {
        if (!selectedAgent) return;
        const prev = selectedAgent.favoriteModels || [];
        const currentFavs = new Set(prev);
        if (currentFavs.has(modelId)) currentFavs.delete(modelId);
        else currentFavs.add(modelId);
        const patch = { favoriteModels: Array.from(currentFavs) };
        patchCatalogAgent(selectedAgent.id, patch);
        if (!(await saveAgentPatch(patch))) {
          patchCatalogAgent(selectedAgent.id, { favoriteModels: prev });
        }
      };

      const toggleModelVisible = async (modelId, visible) => {
        if (!selectedAgent) return;
        const prev = selectedAgent.hiddenModels || [];
        const currentHidden = new Set(prev);
        if (visible) currentHidden.delete(modelId);
        else currentHidden.add(modelId);
        const patch = { hiddenModels: Array.from(currentHidden) };
        patchCatalogAgent(selectedAgent.id, patch);
        if (!(await saveAgentPatch(patch))) {
          patchCatalogAgent(selectedAgent.id, { hiddenModels: prev });
        }
      };

      const setAllModelsHidden = async (hiddenIds) => {
        if (!selectedAgent) return;
        const prev = selectedAgent.hiddenModels || [];
        const patch = { hiddenModels: hiddenIds };
        patchCatalogAgent(selectedAgent.id, patch);
        if (!(await saveAgentPatch(patch))) {
          patchCatalogAgent(selectedAgent.id, { hiddenModels: prev });
        }
      };

      const addCustomModel = async () => {
        if (!selectedAgent || !newModelInput.trim()) return;
        const raw = newModelInput.trim();
        const pipe = raw.indexOf('|');
        const id = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
        const name = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || id;
        if (!id) return;
        const baseModels = [...(selectedAgent.configuredModels || selectedAgent.models || [])];
        if (!baseModels.some((m) => m.id === id)) {
          baseModels.unshift({ id, name, defaultEffort: 'medium' });
        }
        const currentHidden = (selectedAgent.hiddenModels || []).filter((hId) => hId !== id);
        setNewModelInput('');
        await saveAgentPatch({ models: baseModels, hiddenModels: currentHidden });
      };

      const saveRuntimeAndEnv = async () => {
        if (!selectedAgent) return;
        const envObj = {};
        for (const row of runtimeDraft.envRows) {
          const k = String(row.key || '').trim();
          if (k) envObj[k] = String(row.value ?? '');
        }
        // Merge over the persisted env instead of replacing it with the stale
        // draft rows: keys added since the draft snapshot (e.g. credentials
        // saved via the account card) survive; baseline keys the user removed
        // stay removed; edited values win.
        const userKeys = new Set(Object.keys(envObj));
        const removedKeys = new Set(
          envBaselineRef.current.filter((k) => !userKeys.has(k)),
        );
        const mergedEnv = {};
        for (const [k, v] of Object.entries(selectedAgent.env || {})) {
          if (!removedKeys.has(k)) mergedEnv[k] = v;
        }
        Object.assign(mergedEnv, envObj);
        const saved = await saveAgentPatch(
          {
            name: runtimeDraft.name.trim() || selectedAgent.name,
            badge: runtimeDraft.badge.trim() || selectedAgent.badge,
            command:
              runtimeDraft.command === undefined
                ? selectedAgent.command
                : runtimeDraft.command.trim(),
            args: splitArgsText(runtimeDraft.argsText),
            profileDir: runtimeDraft.profileDir.trim(),
            permissionPolicy: runtimeDraft.permissionPolicy,
            env: mergedEnv,
          },
          'save-runtime',
        );
        if (saved) {
          // Re-sync to persisted truth so a cleared command shows the preset
          // default the server normalized to.
          setRuntimeDraft((cur) => ({ ...cur, command: undefined }));
          envBaselineRef.current = Object.keys(mergedEnv);
        }
      };

      const deleteOrResetAgent = async () => {
        if (!selectedAgent) return;
        setBusyAction('delete');
        try {
          const next = await rpc('agent/delete', { id: selectedAgent.id });
          setCatalog(next);
          if (!selectedAgent.builtin && next?.agents?.[0]) {
            setSelectedId(next.agents[0].id);
          }
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
          setConfirmDelete(false);
        }
      };

      const createAccountInstance = async () => {
        if (!addModal) return;
        setBusyAction('create-instance');
        try {
          if (addModal.baseAgentId.startsWith('registry:')) {
            const registryId = addModal.baseAgentId.slice('registry:'.length);
            const regAgent = (registryAgents || []).find((a) => a.id === registryId);
            const baseSlug =
              registryId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'registry-agent';
            const existingIds = new Set(agents.map((a) => a.id));
            let instId = baseSlug;
            let suffix = 2;
            while (existingIds.has(instId)) {
              instId = `${baseSlug}-${suffix}`;
              suffix += 1;
            }
            const next = await rpc('agent/save', {
              agent: {
                id: instId,
                baseAgentId: 'custom',
                name: addModal.name.trim() || regAgent?.name || registryId,
                badge: 'ACP',
                description: regAgent?.description || '',
                registrySource: 'registry',
                registryAgentId: registryId,
                command: '',
                args: [],
                enabled: true,
                permissionPolicy: 'ask',
              },
            });
            setCatalog(next);
            setSelectedId(instId);
          } else if (addModal.baseAgentId === 'custom') {
            const customId = addModal.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || `custom-${Date.now()}`;
            const next = await rpc('agent/save', {
              agent: {
                id: customId,
                baseAgentId: 'custom',
                name: addModal.name.trim() || 'Custom ACP Agent',
                badge: 'ACP',
                command: addModal.command.trim() || 'custom-acp',
                args: ['--acp'],
                enabled: true,
              },
            });
            setCatalog(next);
            setSelectedId(customId);
          } else {
            const res = await rpc('agent/create-account', {
              baseAgentId: addModal.baseAgentId,
              name: addModal.name.trim(),
            });
            if (res?.catalog) setCatalog(res.catalog);
            if (res?.createdId) setSelectedId(res.createdId);
          }
          setAddModal(null);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const permissionOptions = useMemo(
        () => [
          { id: 'ask', label: t('field.permission.ask') },
          { id: 'auto-allow-read', label: t('field.permission.read') },
          { id: 'auto-allow', label: t('field.permission.all') },
        ],
        [t],
      );

      const account = selectedAgent?.account;
      const availableMethods = account?.availableMethods || [];
      const currentMethodDef =
        availableMethods.find((m) => m.id === activeAuthMethod) || availableMethods[0] || null;

      const allModels = selectedAgent?.allModels || selectedAgent?.models || [];
      const enabledCount = allModels.filter((m) => !m.hidden).length;
      const filteredModels = useMemo(() => {
        const q = modelQuery.trim().toLowerCase();
        if (!q) return allModels;
        return allModels.filter(
          (m) =>
            String(m.name || '').toLowerCase().includes(q)
            || String(m.id || '').toLowerCase().includes(q),
        );
      }, [allModels, modelQuery]);

      /* ACP runtime "Add provider" card: icon tile + name + selected check. The icon
       * <img> overlays a monogram letter so a failed brand-icon fetch still
       * leaves a readable tile. */
      const renderAddTypeCard = (card) => {
        const selected = addModal?.baseAgentId === card.id;
        return h(
          'button',
          {
            key: card.id,
            type: 'button',
            className: 'dsh-acp-provider-card',
            'data-selected': selected ? 'true' : undefined,
            onClick: () => setAddModal((cur) => ({ ...cur, baseAgentId: card.id })),
          },
          h(
            'span',
            { className: 'dsh-acp-provider-icon' },
            h(
              'span',
              { className: 'dsh-acp-provider-icon-letter' },
              card.mono || String(card.label || '?').slice(0, 1).toUpperCase(),
            ),
            card.icon
              ? h('img', {
                  src: card.icon,
                  alt: '',
                  onError: (e) => {
                    e.currentTarget.style.display = 'none';
                  },
                })
              : null,
          ),
          h('span', { className: 'dsh-acp-provider-name' }, card.label),
          selected
            ? h(IconCheckOutlineRegular, { className: 'dsh-acp-provider-check', size: 14 })
            : null,
        );
      };

      const registryQueryLC = String(addModal?.registryQuery || '').trim().toLowerCase();
      const registryCards = (registryAgents || [])
        .filter((a) => a && a.id && !BUILTIN_REGISTRY_IDS.has(a.id))
        .filter(
          (a) =>
            !registryQueryLC
            || `${a.id} ${a.name || ''}`.toLowerCase().includes(registryQueryLC),
        )
        .map((a) => ({
          id: `registry:${a.id}`,
          label: a.name || a.id,
          icon: a.icon || null,
        }));

      return h(
        'div',
        { className: 'dsh-acp-settings' },
        probeAuthAction ? h('div', { className: 'dsh-acp-banner', role: 'status' },
          h('span', null, probeAuthAction.message || t('login.waitingBrowser')),
          h(Button, { variant: 'outline', size: 'sm', onClick: async () => {
            try { await rpc('agent/auth-action/accept', { id: probeAuthAction.agentId, elicitationId: probeAuthAction.elicitationId }); setProbeAuthAction(null); }
            catch (error) { setBanner({ error: true, text: error.message }); }
          } }, t('login.openBrowser'))) : null,
        /* Top Page Header */
        h(
          'div',
          { className: 'dsh-acp-header' },
          h(
            'div',
            { className: 'dsh-acp-header-copy' },
            h('h3', { className: 'dsh-acp-title' }, t('page.title')),
            h('p', { className: 'dsh-acp-subtitle' }, t('page.subtitle')),
          ),
          h(
            'div',
            { className: 'dsh-acp-header-actions' },
            h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                icon: h(IconRefreshOutline16, { size: 14 }),
                disabled: loading,
                onClick: () => void loadCatalog(true),
              },
              t('page.refresh'),
            ),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                icon: h(IconPlusOutline16, { size: 14 }),
                onClick: () =>
                  setAddModal({
                    baseAgentId: selectedAgent?.baseAgentId || 'claude-code',
                    name: '',
                    command: '',
                    showMore: false,
                    registryQuery: '',
                  }),
              },
              t('page.addInstance'),
            ),
          ),
        ),

        banner
          ? h(
              'div',
              {
                className: 'dsh-acp-banner',
                'data-error': banner.error ? 'true' : undefined,
              },
              banner.text,
            )
          : null,

        /* ACP Split Workspace: Left Provider Rail + Right Selected Provider Detail */
        h(
          'div',
          { className: 'dsh-acp-workspace' },
          /* Left Sidebar Rail */
          h(
            'div',
            { className: 'dsh-acp-rail', role: 'tablist', 'aria-label': t('menu.agent') },
            agents.map((agent) => {
              const acc = agent.account;
              const isSelected = agent.id === selectedAgent?.id;
              const dotState = !agent.binaryFound
                ? 'idle'
                : acc?.authenticated
                  ? 'done'
                  : 'warning';
              const subParts = [];
              if (!agent.binaryFound) {
                subParts.push(t('status.missing'));
              } else if (acc?.authenticated) {
                if (acc.email) subParts.push(maskEmail(acc.email));
                else if (acc.plan) subParts.push(acc.plan);
                else subParts.push(t('status.authenticated'));
              } else {
                subParts.push(t('status.unauthenticated'));
              }
              if (agent.version) subParts.push(`v${agent.version}`);
              if (agent.activeSessionCount > 0) {
                subParts.push(
                  t('status.activeSessions', { count: String(agent.activeSessionCount) }),
                );
              }

              return h(
                'div',
                {
                  key: agent.id,
                  role: 'tab',
                  tabIndex: 0,
                  'aria-selected': isSelected,
                  'data-selected': isSelected ? 'true' : 'false',
                  'data-agent-id': agent.id,
                  className: 'dsh-acp-rail-item',
                  onClick: () => setSelectedId(agent.id),
                  onKeyDown: (e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(agent.id);
                    }
                  },
                },
                h(
                  'div',
                  { className: 'dsh-acp-rail-item-main' },
                  h(
                    'div',
                    { className: 'dsh-acp-rail-title-row' },
                    h(StateDot, { state: dotState, size: 10 }),
                    // First text leaf is agent.name for Settings search indexing
                    h('span', { className: 'dsh-acp-rail-name' }, agent.name),
                  ),
                  h('span', { className: 'dsh-acp-rail-sub' }, subParts.join(' · ')),
                ),
                h(
                  'div',
                  {
                    onClick: (e) => e.stopPropagation(),
                    // Keep Enter/Space on the focused switch from bubbling to
                    // the rail card (which would preventDefault the toggle and
                    // select the tab instead).
                    onKeyDown: (e) => e.stopPropagation(),
                  },
                  h(Switch, {
                    'aria-label': agent.name,
                    checked: agent.enabled === true,
                    disabled: busyAction === `toggle:${agent.id}`,
                    loading: busyAction === `toggle:${agent.id}`,
                    onChange: (val) => void toggleAgentEnabled(agent, val),
                  }),
                ),
              );
            }),
          ),

          /* Right Detail Column */
          selectedAgent
            ? h(
                'div',
                { className: 'dsh-acp-detail' },

                /* 1. Overview Header Card */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h(
                        'div',
                        { className: 'dsh-acp-card-title-row' },
                        h('h4', { className: 'dsh-acp-card-title' }, selectedAgent.name),
                        h('span', { className: 'dsh-acp-badge' }, selectedAgent.badge || 'ACP'),
                        selectedAgent.version
                          ? h('span', { className: 'dsh-acp-badge' }, `v${selectedAgent.version}`)
                          : null,
                        h(
                          'span',
                          {
                            className: 'dsh-acp-badge',
                            'data-tone': !selectedAgent.binaryFound
                              ? 'warning'
                              : account?.authenticated
                                ? 'success'
                                : 'warning',
                          },
                          !selectedAgent.binaryFound
                            ? t('status.missing')
                            : account?.authenticated
                              ? t('status.authenticated')
                              : t('status.unauthenticated'),
                        ),
                        // CLI credential probes and ACP `authenticate` are
                        // separate trust paths: devin's credentials file can
                        // probe "未登录" while sessions authenticate fine.
                        !account?.authenticated && selectedAgent.acpAuthedAt
                          ? h(
                              'span',
                              { className: 'dsh-acp-badge', 'data-tone': 'success' },
                              t('status.acpAuthed'),
                            )
                          : null,
                      ),
                      h('p', { className: 'dsh-acp-card-desc' }, selectedAgent.description || ''),
                    ),
                  ),
                  h(
                    'div',
                    {
                      className: 'dsh-acp-cmd-bar',
                      title: selectedAgent.binaryPath
                        ? `${selectedAgent.binaryPath} ${joinArgsText(selectedAgent.args)}`
                        : `$ ${selectedAgent.command} ${joinArgsText(selectedAgent.args)}`,
                    },
                    selectedAgent.binaryPath
                      ? `$ ${selectedAgent.command} ${joinArgsText(selectedAgent.args)} \u00b7 ${selectedAgent.binaryPath}`
                      : `$ ${selectedAgent.command} ${joinArgsText(selectedAgent.args)}`,
                  ),
                  h(
                    'div',
                    { className: 'dsh-acp-card-actions-bar' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          loading: busyAction === `test:${selectedAgent.id}`,
                          onClick: () => void testAndSyncAgent(selectedAgent),
                        },
                        busyAction === `test:${selectedAgent.id}` ? t('action.testing') : t('action.test'),
                      ),
                      selectedAgent.baseAgentId && selectedAgent.baseAgentId !== 'custom'
                        ? h(
                            Button,
                            {
                              variant: 'outline',
                              size: 'sm',
                              icon: h(IconPlusOutline16, { size: 14 }),
                              onClick: () =>
                                setAddModal({
                                  baseAgentId: selectedAgent.baseAgentId,
                                  name: `${selectedAgent.name} #2`,
                                  command: selectedAgent.command,
                                  showMore: false,
                                  registryQuery: '',
                                }),
                            },
                            t('action.addAccount'),
                          )
                        : null,
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconTrashOutline16, { size: 14 }),
                          onClick: () => setConfirmDelete(true),
                        },
                        selectedAgent.builtin ? t('action.reset') : t('action.delete'),
                      ),
                    ),
                  ),
                ),

                /* 2. Account & Authentication Card (ACP ProviderAuthenticationSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h('h4', { className: 'dsh-acp-card-title' }, t('section.account')),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.accountDesc')),
                    ),
                  ),

                  /* Current Account Status Box */
                  h(
                    'div',
                    { className: 'dsh-acp-account-box' },
                    h(
                      'div',
                      { className: 'dsh-acp-account-row' },
                      h(
                        'div',
                        { className: 'dsh-acp-account-user' },
                        h(StateDot, {
                          state: account?.authenticated ? 'done' : 'warning',
                          size: 12,
                        }),
                        account?.email
                          ? h(
                              'span',
                              {
                                className: 'dsh-acp-account-email',
                                title: t('account.reveal'),
                                onClick: () => setRevealEmail((v) => !v),
                              },
                              revealEmail ? account.email : maskEmail(account.email),
                            )
                          : h(
                              'span',
                              { style: { fontWeight: 600, fontSize: '13px' } },
                              account?.authenticated
                                ? account.name || account.authLabel || t('status.authenticated')
                                : t('account.notLoggedIn'),
                            ),
                        account?.plan
                          ? h(
                              'span',
                              { className: 'dsh-acp-badge', 'data-tone': 'plan' },
                              account.plan,
                            )
                          : null,
                        account?.authLabel
                          ? h('span', { className: 'dsh-acp-badge' }, account.authLabel)
                          : null,
                      ),
                      h(
                        'div',
                        { className: 'dsh-acp-card-actions' },
                        h(
                          Button,
                          {
                            variant: 'primary',
                            size: 'sm',
                            loading: busyAction === 'login',
                            disabled: !selectedAgent.binaryFound,
                            onClick: () => void startLoginFlow(Boolean(account?.authenticated)),
                          },
                          account?.authenticated ? t('action.relogin') : t('action.login'),
                        ),
                        account?.authenticated
                          ? h(
                              Button,
                              {
                                variant: 'outline',
                                size: 'sm',
                                loading: busyAction === 'reauth',
                                onClick: () => void reauthFlow(),
                              },
                              t('action.reauth'),
                            )
                          : null,
                        account?.authenticated
                          ? h(
                              Button,
                              {
                                variant: 'outline',
                                size: 'sm',
                                loading: busyAction === 'logout',
                                onClick: () => void logoutCurrentAgent(),
                              },
                              t('action.logout'),
                            )
                          : null,
                      ),
                    ),
                    account?.message
                      ? h('div', { className: 'dsh-acp-account-msg' }, account.message)
                      : null,
                    account?.profileDir || selectedAgent.profileDir
                      ? h(
                          'div',
                          { className: 'dsh-acp-meta-line' },
                          `${t('account.profileDir')}: ${selectedAgent.profileDir || account.profileDir}`,
                        )
                      : null,
                  ),

                  /* Auth Method Selector Tabs */
                  availableMethods.length > 1
                    ? h(
                        'div',
                        { className: 'dsh-acp-auth-methods' },
                        availableMethods.map((m) =>
                          h(
                            'button',
                            {
                              key: m.id,
                              type: 'button',
                              className: 'dsh-acp-auth-method-card',
                              'data-active': m.id === activeAuthMethod ? 'true' : 'false',
                              onClick: () => setActiveAuthMethod(m.id),
                            },
                            h('span', { className: 'dsh-acp-auth-method-title' }, m.label),
                            h('span', { className: 'dsh-acp-auth-method-desc' }, m.description),
                          ),
                        ),
                      )
                    : null,

                  /* Live auth flow box — ACP runtime ProviderAuthFlowState verbatim.
                     * authorizationUrl/interaction exist only in live phases;
                     * terminal phases carry no URL and no cancel action. */
                  activeFlow && flowPhase && flowPhase !== 'idle'
                    ? h(
                        'div',
                        { className: 'dsh-acp-flow-box' },
                        h(
                          'div',
                          { className: 'dsh-acp-flow-top' },
                          h(
                            'div',
                            { className: 'dsh-acp-flow-status' },
                            h(StateDot, {
                              state:
                                flowPhase === 'succeeded'
                                  ? 'done'
                                  : flowPhase === 'failed' || flowPhase === 'cancelled'
                                    ? 'warning'
                                    : 'ongoing',
                              size: 14,
                            }),
                            h(
                              'span',
                              null,
                              activeFlow.message
                                ? FLOW_MESSAGE_KEYS[activeFlow.message]
                                  ? t(FLOW_MESSAGE_KEYS[activeFlow.message])
                                  : activeFlow.message
                                : t('login.waitingBrowser'),
                            ),
                          ),
                          activeFlow.interaction?.userCode
                            ? h(
                                'span',
                                { className: 'dsh-acp-flow-code' },
                                activeFlow.interaction.userCode,
                              )
                            : null,
                          flowActive
                            ? h(
                                Button,
                                {
                                  variant: 'outline',
                                  size: 'sm',
                                  onClick: () => void cancelLoginFlow(),
                                },
                                t('action.cancelLogin'),
                              )
                            : null,
                        ),
                        flowUrl
                          ? h(
                              'div',
                              { className: 'dsh-acp-flow-url-row' },
                              h(
                                'div',
                                { className: 'dsh-acp-flow-url', title: flowUrl },
                                flowUrl,
                              ),
                              h(
                                Button,
                                {
                                  variant: 'primary',
                                  size: 'sm',
                                  onClick: () => void openLoginUrl(),
                                },
                                t('action.openBrowser'),
                              ),
                              h(
                                Button,
                                {
                                  variant: 'outline',
                                  size: 'sm',
                                  onClick: () => void copyLoginUrl(),
                                },
                                copiedUrl ? t('action.copied') : t('action.copyUrl'),
                              ),
                            )
                          : null,
                        /* ACP runtime terminal interaction: agent asks the client to run
                           * its login command; render output and accept stdin
                           * (ProviderAuthResponse {type:'terminal', data}). */
                        flowInteraction?.type === 'terminal'
                          ? h(
                              Fragment,
                              null,
                              flowInteraction.output
                                ? h(
                                    'pre',
                                    { className: 'dsh-acp-flow-terminal' },
                                    flowInteraction.output,
                                  )
                                : null,
                              h(
                                'form',
                                {
                                  className: 'dsh-acp-flow-callback',
                                  onSubmit: (event) => {
                                    event.preventDefault();
                                    const data = terminalDraft;
                                    if (!data) return;
                                    setTerminalDraft('');
                                    void respondLoginFlow({
                                      type: 'terminal',
                                      data: `${data}\n`,
                                    });
                                  },
                                },
                                h('input', {
                                  className: 'dsh-acp-raw-input',
                                  type: 'text',
                                  value: terminalDraft,
                                  autoComplete: 'off',
                                  placeholder: t('login.terminalPh'),
                                  onInput: (e) => setTerminalDraft(e.target.value),
                                }),
                                h(
                                  Button,
                                  {
                                    type: 'submit',
                                    variant: 'outline',
                                    size: 'sm',
                                    disabled: !terminalDraft,
                                  },
                                  t('action.continue'),
                                ),
                              ),
                            )
                          : null,
                        /* ACP runtime credentials interaction: the flow itself asks for
                           * field values mid-login (respond credentials). */
                        flowInteraction?.type === 'credentials'
                          ? h(
                              'form',
                              {
                                className: 'dsh-acp-grid-2',
                                onSubmit: (event) => {
                                  event.preventDefault();
                                  void respondLoginFlow({
                                    type: 'credentials',
                                    values: flowCredDraft,
                                  }).then((sent) => {
                                    if (sent) setFlowCredDraft({});
                                  });
                                },
                              },
                              (flowInteraction.fields || []).map((field) =>
                                h(
                                  'label',
                                  { key: field.name, className: 'dsh-acp-field' },
                                  h('span', null, field.label || field.name),
                                  h('input', {
                                    className: 'dsh-acp-raw-input',
                                    type: field.secret ? 'password' : 'text',
                                    value: flowCredDraft[field.name] ?? '',
                                    autoComplete: 'off',
                                    onInput: (e) =>
                                      setFlowCredDraft((cur) => ({
                                        ...cur,
                                        [field.name]: e.target.value,
                                      })),
                                  }),
                                ),
                              ),
                              h(
                                Button,
                                { type: 'submit', variant: 'outline', size: 'sm' },
                                t('action.connect'),
                              ),
                            )
                          : null,
                        /* ACP runtime callback paste box: browser flows that accept a
                           * callback let the user paste the final localhost URL. */
                        flowUrl && flowInteraction?.type === 'browser' && flowInteraction.acceptsCallback
                          ? h(
                              'form',
                              {
                                className: 'dsh-acp-flow-callback',
                                onSubmit: (event) => {
                                  event.preventDefault();
                                  void completeLoginFlow(callbackDraft.trim());
                                },
                              },
                              h(
                                'label',
                                { className: 'dsh-acp-field' },
                                h('span', null, t('login.callbackHint')),
                                h('input', {
                                  className: 'dsh-acp-raw-input',
                                  type: 'url',
                                  value: callbackDraft,
                                  autoComplete: 'off',
                                  onInput: (e) => setCallbackDraft(e.target.value),
                                }),
                              ),
                              h(
                                Button,
                                {
                                  type: 'submit',
                                  variant: 'outline',
                                  size: 'sm',
                                  disabled: !callbackDraft.trim(),
                                },
                                t('action.continue'),
                              ),
                            )
                          : null,
                      )
                    : null,

                  /* Credential Fields when API Key / Vertex AI method is selected */
                  currentMethodDef?.fields && currentMethodDef.fields.length > 0
                    ? h(
                        'div',
                        { className: 'dsh-acp-account-box' },
                        h(
                          'div',
                          { className: 'dsh-acp-grid-2' },
                          currentMethodDef.fields.map((field) =>
                            h(
                              'div',
                              { key: field.key, className: 'dsh-acp-field' },
                              h('label', { className: 'dsh-acp-field-label' }, field.label),
                              h(Input, {
                                variant: 'form',
                                type: field.secret ? 'password' : 'text',
                                value: credDraft[field.key] ?? '',
                                placeholder: field.placeholder || '',
                                onChange: (e) =>
                                  setCredDraft({ ...credDraft, [field.key]: e.target.value }),
                              }),
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', justifyContent: 'flex-end' } },
                          h(
                            Button,
                            {
                              variant: 'primary',
                              size: 'sm',
                              icon:
                                savedFlash === 'save-creds'
                                  ? h(IconCheckOutlineRegular, { size: 14 })
                                  : undefined,
                              loading: busyAction === 'save-creds',
                              onClick: () => void saveApiKeyCredentials(),
                            },
                            savedFlash === 'save-creds'
                              ? t('action.savedDone')
                              : t('action.saveCredentials'),
                          ),
                        ),
                      )
                    : null,
                ),

                /* 3. Models Section (ACP ProviderModelsSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h(
                        'div',
                        { className: 'dsh-acp-card-title-row' },
                        h('h4', { className: 'dsh-acp-card-title' }, t('section.models')),
                        h(
                          'span',
                          { className: 'dsh-acp-badge' },
                          t('models.count', {
                            enabled: String(enabledCount),
                            total: String(allModels.length),
                          }),
                        ),
                      ),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.modelsDesc')),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      h(
                        'span',
                        {
                          className: 'dsh-acp-actions-slot',
                          style: {
                            visibility:
                              (selectedAgent.hiddenModels || []).length > 0
                                ? 'visible'
                                : 'hidden',
                          },
                        },
                        h(
                          Button,
                          {
                            variant: 'outline',
                            size: 'sm',
                            onClick: () => void setAllModelsHidden([]),
                          },
                          t('models.showAll'),
                        ),
                      ),
                      h(
                        'span',
                        {
                          className: 'dsh-acp-actions-slot',
                          style: { visibility: enabledCount > 0 ? 'visible' : 'hidden' },
                        },
                        h(
                          Button,
                          {
                            variant: 'outline',
                            size: 'sm',
                            onClick: () =>
                              void setAllModelsHidden(allModels.map((m) => m.id)),
                          },
                          t('models.hideAll'),
                        ),
                      ),
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconRefreshOutline16, { size: 14 }),
                          loading: busyAction === `test:${selectedAgent.id}`,
                          onClick: () => void testAndSyncAgent(selectedAgent),
                        },
                        t('models.syncBtn'),
                      ),
                    ),
                  ),

                  /* Search + Add custom model toolbar */
                  h(
                    'div',
                    { className: 'dsh-acp-models-toolbar' },
                    h(
                      'div',
                      { className: 'dsh-acp-models-toolbar-input' },
                      h(Input, {
                        variant: 'form',
                        value: modelQuery,
                        placeholder: t('models.searchPh'),
                        onChange: (e) => setModelQuery(e.target.value),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-models-toolbar-input' },
                      h(Input, {
                        variant: 'form',
                        value: newModelInput,
                        placeholder: t('models.addPh'),
                        onChange: (e) => setNewModelInput(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addCustomModel();
                          }
                        },
                      }),
                    ),
                    h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'sm',
                        icon: h(IconPlusOutline16, { size: 14 }),
                        disabled: !newModelInput.trim(),
                        onClick: () => void addCustomModel(),
                      },
                      t('models.addBtn'),
                    ),
                  ),

                  /* Scrollable Model Rows */
                  h(
                    'div',
                    { className: 'dsh-acp-models-list' },
                    filteredModels.map((m) =>
                      h(
                        'div',
                        {
                          key: m.id,
                          className: 'dsh-acp-model-row',
                          'data-hidden': m.hidden ? 'true' : 'false',
                        },
                        h(
                          'div',
                          { className: 'dsh-acp-model-left' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-acp-star-btn',
                              'data-fav': m.favorite ? 'true' : 'false',
                              title: t('models.favorite'),
                              onClick: () => void toggleModelFavorite(m.id),
                            },
                            m.favorite ? '★' : '☆',
                          ),
                          h('span', { className: 'dsh-acp-model-name' }, m.name || m.id),
                          m.name && m.name !== m.id
                            ? h('span', { className: 'dsh-acp-model-id' }, m.id)
                            : null,
                          m.discovered
                            ? h('span', { className: 'dsh-acp-badge' }, t('models.discovered'))
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'dsh-acp-model-right' },
                          h(Switch, {
                            'aria-label': m.name || m.id,
                            checked: !m.hidden,
                            onChange: (val) =>
                              void toggleModelVisible(m.id, unwrapSwitchChecked(val, Boolean(m.hidden))),
                          }),
                        ),
                      ),
                    ),
                  ),
                ),

                /* 4. Runtime & Environment Variables Card (ACP ProviderSetupSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h('h4', { className: 'dsh-acp-card-title' }, t('section.runtime')),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.runtimeDesc')),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'dsh-acp-grid-2' },
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.name')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.name,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, name: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.command ?? selectedAgent?.command ?? '',
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, command: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.badge')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.badge,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, badge: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.args')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.argsText,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, argsText: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.profileDir')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.profileDir,
                        placeholder: t('field.profileDirPh'),
                        onChange: (e) =>
                          setRuntimeDraft({ ...runtimeDraft, profileDir: e.target.value }),
                      }),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'dsh-acp-field' },
                    h('label', { className: 'dsh-acp-field-label' }, t('field.permission')),
                    h(SettingsSelect, {
                      variant: 'block',
                      'aria-label': t('field.permission'),
                      value: runtimeDraft.permissionPolicy,
                      options: permissionOptions,
                      onChange: (val) =>
                        setRuntimeDraft({ ...runtimeDraft, permissionPolicy: val }),
                    }),
                  ),

                  /* Environment Variables Interactive Editor */
                  h(
                    'div',
                    { className: 'dsh-acp-field', style: { marginTop: '4px' } },
                    h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        },
                      },
                      h('label', { className: 'dsh-acp-field-label' }, t('section.env')),
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconPlusOutline16, { size: 14 }),
                          onClick: () =>
                            setRuntimeDraft({
                              ...runtimeDraft,
                              envRows: [...runtimeDraft.envRows, { key: '', value: '' }],
                            }),
                        },
                        t('env.addRow'),
                      ),
                    ),
                    h('p', { className: 'dsh-acp-meta-line' }, t('section.envDesc')),
                    runtimeDraft.envRows.length === 0
                      ? h('div', { className: 'dsh-acp-meta-line' }, t('env.empty'))
                      : h(
                          'div',
                          { className: 'dsh-acp-env-list' },
                          runtimeDraft.envRows.map((row, idx) =>
                            h(
                              'div',
                              { key: idx, className: 'dsh-acp-env-row' },
                              h(Input, {
                                variant: 'form',
                                value: row.key,
                                placeholder: t('env.keyPh'),
                                onChange: (e) => {
                                  const nextRows = [...runtimeDraft.envRows];
                                  nextRows[idx] = { ...row, key: e.target.value };
                                  setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                },
                              }),
                              h(Input, {
                                variant: 'form',
                                type: /KEY|TOKEN|SECRET|PASSWORD/i.test(row.key) ? 'password' : 'text',
                                value: row.value,
                                placeholder: t('env.valPh'),
                                onChange: (e) => {
                                  const nextRows = [...runtimeDraft.envRows];
                                  nextRows[idx] = { ...row, value: e.target.value };
                                  setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                },
                              }),
                              h(
                                Button,
                                {
                                  variant: 'outline',
                                  size: 'sm',
                                  icon: h(IconTrashOutline16, { size: 14 }),
                                  onClick: () => {
                                    const nextRows = runtimeDraft.envRows.filter((_, i) => i !== idx);
                                    setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                  },
                                },
                                '',
                              ),
                            ),
                          ),
                        ),
                  ),

                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } },
                    h(
                      Button,
                      {
                        variant: 'primary',
                        size: 'sm',
                        icon:
                          savedFlash === 'save-runtime'
                            ? h(IconCheckOutlineRegular, { size: 14 })
                            : undefined,
                        loading: busyAction === 'save',
                        onClick: () => void saveRuntimeAndEnv(),
                      },
                      savedFlash === 'save-runtime'
                        ? t('action.savedDone')
                        : t('action.saveRuntime'),
                    ),
                  ),
                ),
              )
            : null,
        ),

        /* Destructive action confirm — delete instance / reset defaults. The
           * dialog names what's lost (config + credentials); cancel is a no-op. */
        confirmDelete && selectedAgent
          ? h(
              Modal,
              {
                open: true,
                onClose: () => setConfirmDelete(false),
                title: selectedAgent.builtin ? t('modal.resetTitle') : t('modal.deleteTitle'),
                closeLabel: t('modal.close'),
                footer: h(
                  'div',
                  { className: 'dsh-acp-modal-footer' },
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => setConfirmDelete(false),
                    },
                    t('modal.cancel'),
                  ),
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'sm',
                      loading: busyAction === 'delete',
                      onClick: () => void deleteOrResetAgent(),
                    },
                    selectedAgent.builtin ? t('action.reset') : t('action.delete'),
                  ),
                ),
              },
              h(
                'p',
                { style: { margin: 0 } },
                selectedAgent.builtin
                  ? t('modal.resetBody', { name: selectedAgent.name })
                  : t('modal.deleteBody', { name: selectedAgent.name }),
              ),
            )
          : null,

        /* Modal for creating a new isolated account instance or custom ACP agent */
        addModal
          ? h(
              Modal,
              {
                open: true,
                onClose: () => setAddModal(null),
                title: t('modal.addTitle'),
                closeLabel: t('modal.close'),
                footer: h(
                  'div',
                  { className: 'dsh-acp-modal-footer' },
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => setAddModal(null),
                    },
                    t('modal.cancel'),
                  ),
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'sm',
                      loading: busyAction === 'create-instance',
                      onClick: () => void createAccountInstance(),
                    },
                    t('modal.create'),
                  ),
                ),
              },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
                h(
                  'div',
                  { className: 'dsh-acp-field' },
                  h('label', { className: 'dsh-acp-field-label' }, t('modal.addType')),
                  h(
                    'div',
                    { className: 'dsh-acp-provider-grid' },
                    ADD_PROVIDER_CARDS.map((card) => renderAddTypeCard(card)),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-acp-showmore',
                      'data-open': addModal.showMore ? 'true' : undefined,
                      onClick: () =>
                        setAddModal((cur) => ({ ...cur, showMore: !cur.showMore })),
                    },
                    addModal.showMore ? t('modal.showLess') : t('modal.showMore'),
                    h(IconChevronDownOutlineRegular, { size: 12 }),
                  ),
                  addModal.showMore
                    ? h(
                        'div',
                        { className: 'dsh-acp-registry' },
                        h(Input, {
                          variant: 'form',
                          value: addModal.registryQuery || '',
                          placeholder: t('modal.registrySearchPh'),
                          onChange: (e) =>
                            setAddModal((cur) => ({ ...cur, registryQuery: e.target.value })),
                        }),
                        registryAgents === null
                          ? h('div', { className: 'dsh-acp-registry-hint' }, t('modal.registryLoading'))
                          : h(
                              'div',
                              { className: 'dsh-acp-provider-grid dsh-acp-registry-grid' },
                              registryCards.map((card) => renderAddTypeCard(card)),
                              renderAddTypeCard({
                                id: 'custom',
                                label: t('modal.customCard'),
                                mono: '>_',
                              }),
                              registryCards.length === 0
                                ? h('div', { className: 'dsh-acp-registry-hint' }, t('modal.registryEmpty'))
                                : null,
                            ),
                      )
                    : null,
                ),
                h(
                  'div',
                  { className: 'dsh-acp-field' },
                  h('label', { className: 'dsh-acp-field-label' }, t('modal.addName')),
                  h(Input, {
                    variant: 'form',
                    value: addModal.name,
                    placeholder: t('modal.addNamePh'),
                    onChange: (e) => setAddModal({ ...addModal, name: e.target.value }),
                  }),
                ),
                addModal.baseAgentId === 'custom'
                  ? h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
                      h(Input, {
                        variant: 'form',
                        value: addModal.command,
                        placeholder: 'e.g. my-agent-binary',
                        onChange: (e) => setAddModal({ ...addModal, command: e.target.value }),
                      }),
                    )
                  : null,
              ),
            )
          : null,
      );
    }

    function editableModelOptions(model) {
      return (model?.options || []).filter((option) =>
        ['boolean', 'select'].includes(option.type)
        && option.id !== 'model' && option.category !== 'model' && option.role !== 'reasoning'
        && !['thought_level', 'reasoning_effort'].includes(option.category)
        && !/effort|thought|thinking|mode|permission|approval|sandbox/i.test(`${option.id} ${option.category || ''}`));
    }

    function AgentSessionOptions({ sessionId, directory, rpc, openAgentSettings, t, locked, dismiss, reportFailure }) {
      const state = useSyncExternalStore(
        (fn) => directory.subscribe(fn),
        () => directory.getSnapshot(),
      );
      const provider = state.current?.provider || '';
      const modelId = state.current?.model;
      const agentId = provider.startsWith(ACP_PREFIX) ? provider.slice(ACP_PREFIX.length) : null;
      const key = `${provider}/${modelId}`;
      const [config, setConfig] = useState(null);
      const [saving, setSaving] = useState(false);
      const failureRef = useRef(reportFailure);
      failureRef.current = reportFailure;
      useEffect(() => {
        let active = true;
        setConfig(null);
        if (agentId && modelId) {
          Promise.all([
            rpc('catalog'),
            rpc('session/options', { sessionId, agentId, model: modelId }),
          ]).then(([catalog, result]) => {
            if (!active) return;
            const agent = catalog.agents.find((item) => item.id === agentId);
            const model = (agent?.allModels || agent?.models || []).find((item) => item.id === modelId);
            setConfig({ key, options: editableModelOptions(model), selections: result.selections || [] });
          }).catch((error) => { if (active) failureRef.current(error.message); });
        }
        return () => { active = false; };
      }, [sessionId, agentId, modelId, state.groups, rpc]);

      const changeOption = async (option, value) => {
        setSaving(true);
        try {
          const result = await rpc('session/options', { sessionId, agentId, model: modelId, option: { id: option.id, value } });
          setConfig((current) => current?.key === key ? { ...current, selections: result.selections || [] } : current);
        } catch (error) { reportFailure(error.message); }
        finally { setSaving(false); }
      };
      return h('div', {
        className: 'dsh-acp-session-options',
        onKeyDown: (event) => { if (event.key !== 'Escape') event.stopPropagation(); },
        // Disabling the focused control during a save emits a null-target
        // blur. It is an internal transition, not leaving the host's menu.
        onBlur: (event) => { if (saving && event.relatedTarget === null) event.stopPropagation(); },
      },
      config?.key === key ? config.options.map((option) => {
        const value = config.selections.find((selection) => selection.id === option.id)?.value ?? option.currentValue;
        const disabled = Boolean(locked || saving || state.pending);
        return h('label', { key: option.id, className: 'dsh-acp-session-option', title: option.description || '' },
          h('span', null, option.name || option.label || option.id),
          option.type === 'boolean'
            ? h('input', { type: 'checkbox', checked: value === true, disabled, onChange: (event) => void changeOption(option, event.target.checked) })
            : h('select', { className: 'dsh-acp-settings-select', value: value ?? '', disabled, onChange: (event) => void changeOption(option, event.target.value) },
                value === undefined ? h('option', { value: '', disabled: true }, t('effort.providerDefault')) : null,
                (option.options || []).map((choice) => h('option', { key: choice.id, value: choice.id }, choice.name || choice.label || choice.id))));
      }) : null,
      h(Button, {
        size: 'sm', disabled: locked, icon: h(IconSettingsOutline16, { size: 14 }),
        onClick: () => { dismiss(); if (!openAgentSettings()) reportFailure(t('error.settingsNav')); },
      }, t('menu.manageAgents')));
    }

    // Separate, durable reply content: delegation must remain visible when
    // the surrounding tool/process disclosure is collapsed.
    const delegationDefinition = {
      kind: 'acp-delegation', target: 'chat',
      match(event) {
        if (event.type === 'acp-delegation/start') return { id: event.data.runId, role: 'start' };
        if (event.type === 'acp-delegation/end') return { id: event.data.runId, role: 'update' };
        if (event.type === 'acp-delegation/state') return { id: event.data.runId, role: 'update' };
        return null;
      },
      start: (_context, match) => match.event.data,
      update: (context, match) => ({ ...context.state, ...match.event.data }),
      buildViewNode(context) {
        if (!context.start || !context.state) return null;
        const abandoned = ['interrupted', 'forked'].includes(context.start.location.turn?.end?.data.reason.kind);
        return {
          key: context.key, id: context.id, kind: 'acp-delegation', target: 'chat',
          anchorSeq: context.start.event.seq, location: context.start.location,
          visibility: 'visible', processVisibility: 'independent',
          data: { ...context.state, ...(abandoned && !context.state.endedAt ? { stopReason: 'aborted' } : {}) },
        };
      },
    };

    function DelegationRow({ node, openChild, readStatus, t }) {
      const [recovered, setRecovered] = useState(null);
      const data = { ...node.data, ...recovered };
      useEffect(() => {
        if (node.data.endedAt || !readStatus) return undefined;
        let active = true;
        readStatus(node.data).then((value) => { if (active && value) setRecovered(value); })
          .catch((error) => console.warn('Unable to read child status', error));
        return () => { active = false; };
      }, [node.data.runId, node.data.endedAt, readStatus]);
      const [now, setNow] = useState(Date.now);
      const [iconFailed, setIconFailed] = useState(false);
      const agentIcon = ADD_PROVIDER_CARDS.find((agent) => agent.id === data.agentId)?.icon;
      const status = !data.stopReason ? 'running'
        : data.stopReason === 'completed' ? 'completed'
          : data.stopReason === 'aborted' ? 'cancelled' : 'failed';
      useEffect(() => {
        if (status !== 'running') return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, [status]);
      const seconds = Math.max(0, Math.floor(((data.endedAt || now) - data.startedAt) / 1000));
      const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      const model = data.modelName || data.model;
      const agentName = data.agentName.replace(/\s*[（(]反重力[）)]/g, '').trim();
      const pendingLabel = data.pendingInteraction ? t(`delegate.waiting_${data.pendingInteraction.kind}`) : null;
      const details = [t('delegate.child'), agentName, model, data.task, pendingLabel || t(`delegate.${status}`), elapsed, data.diagnostic || data.preview].filter(Boolean).join(' · ');
      return h('section', { className: 'dsh-acp-child', 'data-acp-delegation': data.childId, 'data-status': status },
        h('button', {
          type: 'button', className: 'dsh-acp-child-open',
          onClick: () => openChild(data.childId), title: details,
          'aria-label': `${t('delegate.open')} · ${details}`,
        },
        h('span', { className: 'dsh-acp-child-icon', 'aria-hidden': true },
          agentIcon && !iconFailed
            ? h('img', { src: agentIcon, alt: '', onError: () => setIconFailed(true) })
            : h(IconAgentPresetOutlineRegular, { size: 16 })),
        h('span', { className: 'dsh-acp-child-identity' },
          h('span', { className: 'dsh-acp-child-agent' }, agentName),
          h('span', { className: 'dsh-acp-child-model' }, model)),
        h('span', { className: 'dsh-acp-child-task' }, status === 'failed' ? data.diagnostic || data.task : data.task),
        h('span', { className: 'dsh-acp-child-status', 'aria-live': 'polite' },
          h(StateDot, { state: status === 'running' ? 'ongoing' : status === 'completed' ? 'done' : status === 'failed' ? 'error' : 'warning', size: 6 }),
          pendingLabel || t(`delegate.${status}`)),
        h('span', { className: 'dsh-acp-child-elapsed' }, elapsed),
        h(IconChevronRightOutlineRegular, { size: 12 })));
    }

    function SettingsNavigationBridge({ actions, bind }) {
      useEffect(() => bind(actions), [actions, bind]);
      return null;
    }

    function apply(ctx) {
      injectCss();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-acp-agents: dictionaries');
      const t = ctx.locale.bind(NS);
      const connection = ctx.connection ?? ctx.get?.('connection');

      const rpc = async (endpoint, input = {}) =>
        rpcValue(await connection.rpc.call('/dsh-acp-agents', endpoint, input));

      let settingsActions;
      const bindSettingsActions = (actions) => {
        settingsActions = actions;
        return () => { if (settingsActions === actions) settingsActions = undefined; };
      };
      const openAgentSettings = () => {
        try {
          const nav = ctx.get('settingsNavigation');
          if (typeof nav?.open === 'function') {
            nav.open(SETTINGS_SECTION_ID);
            return true;
          }
          if (typeof settingsActions?.openSection === 'function') {
            settingsActions.openSection(SETTINGS_SECTION_ID);
            return true;
          }
          return false;
        } catch {
          return false;
        }
      };

      // Standard 0.2.2 owns navigation in the sidebar.settings root store.
      // Share its declared handle through a root slot so the renderer supplies
      // the live actions. Never create a second shell instance or claim its children.
      ctx.slots.inject('settings.section', () => ctx.slots.inject('shell.overlay', () => {
        let shell;
        let disposeBridge;
        const sync = () => {
          const next = ctx.slots.entriesOfSlot('sidebar.settings')[0];
          if (shell === next) return;
          disposeBridge?.();
          disposeBridge = undefined;
          settingsActions = undefined;
          shell = next;
          if (typeof shell?.store?.spec.actions.openSection !== 'function') return;
          disposeBridge = ctx.slots.register({
            name: 'shell.overlay', id: 'dsh-acp-settings-navigation',
            store: shell.store,
            inject: () => ({ bind: bindSettingsActions }),
          }, SettingsNavigationBridge);
        };
        const unsubscribe = ctx.slots.subscribe('sidebar.settings', sync);
        sync();
        return () => { unsubscribe(); disposeBridge?.(); settingsActions = undefined; };
      }));

      ctx.inject(['uiConversation', 'uiWorkspace'], (scope) => {
        scope.uiConversation.events.register(delegationDefinition);
        scope.slots.inject('conversation.chat.node', () => scope.slots.register({
          name: 'conversation.chat.node', key: 'acp-delegation', locale: NS,
          inject: (parentSessionId) => ({
            openChild: (childSessionId) => scope.uiWorkspace.openSession({ parentSessionId, childSessionId, mode: 'continuable' }),
            readStatus: (data) => rpc('delegation-status', { parentSessionId, runId: data.runId, childId: data.childId }),
          }),
        }, DelegationRow));
      });

      // 1. Register Settings -> Agent row (`settings.section` with id 'acp-agents').
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SETTINGS_SECTION_ID,
            order: 12,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ rpc, t }),
          },
          AgentsSettingsSection,
        ),
      );

      // Extend the host-owned menu. Re-declaring its children in a replacement
      // picker violates the standard slot's single-owner lifetime contract.
      ctx.inject(['slots', 'modelDirectories'], (scope) => {
        const models = scope.modelDirectories;
        scope.slots.inject('conversation.input.model.options', () =>
          scope.slots.register(
            {
              name: 'conversation.input.model.options',
              id: 'dsh-acp-options',
              order: 20,
              locale: NS,
              inject: (sessionId) => {
                const directory = models.directoryFor(sessionId);
                return {
                  sessionId,
                  directory: directory.store,
                  rpc,
                  openAgentSettings,
                  t,
                };
              },
            },
            AgentSessionOptions,
          ),
        );
      });
    }

    exports.name = NS;
    exports.inject = ['slots', 'locale', 'connection'];
    exports.apply = apply;
    return module.exports;
  },
});
