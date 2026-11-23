'use strict';

/**
 * Side-effect registry for every model-callable tool the desktop ships and
 * for every model-reachable route on the install-control loopback channel.
 *
 * Levels:
 *   read             — returns data, no side effect
 *   local            — local, reversible change
 *   destructive      — destroys data or revokes access irreversibly
 *   external         — exposes local content or authority to the outside
 *   code             — executes code or out-of-sandbox commands on this machine
 *   harness-governed — capability already governed by Harness sandbox/approval
 *
 * `confirm`:
 *   true       — the tool calls the desktop confirm endpoint before acting
 *   'endpoint' — the loopback endpoint itself serializes a desktop confirm
 *   'keys'     — only some parameter keys gate a confirm (see `keys`)
 *   false      — no desktop confirm required
 */

const LEVELS = Object.freeze(['read', 'local', 'destructive', 'external', 'code', 'harness-governed']);

/**
 * @typedef {Object} ToolEffect
 * @property {string} level
 * @property {boolean | 'endpoint' | 'keys'} confirm
 * @property {string} reason
 * @property {string[]} [keys]
 * @property {Record<string, { level: string, reason: string }>} [actions]
 */

/** @type {Readonly<Record<string, ToolEffect>>} */
const TOOLS = Object.freeze({
  // ---------- dsh-whale (resident whale assistant, preset-scoped) ----------
  whale_list_sessions: { level: 'read', confirm: false, reason: '只读会话列表。' },
  whale_send_to_session: {
    level: 'external', confirm: true, reason: '以用户名义向其他会话注入消息。',
    actions: {
      send: { level: 'external', reason: '以用户名义向目标会话投递一条消息。' },
    },
  },
  whale_new_session: {
    level: 'code', confirm: true, reason: '在指定 cwd 打开新会话，其中代理获得该目录的执行能力。',
    actions: {
      create: { level: 'code', reason: '创建会话即授予代理该目录的执行能力。' },
    },
  },
  whale_usage_today: { level: 'read', confirm: false, reason: '只读用量快照。' },
  whale_notify: { level: 'local', confirm: false, reason: '桌宠气泡通知，可随时关闭。' },
  whale_pet_say: { level: 'local', confirm: false, reason: '桌宠气泡台词。' },
  whale_remember: { level: 'local', confirm: false, reason: '写原子记忆文件并维护窄索引，可逆。' },
  whale_memory_search: { level: 'read', confirm: false, reason: '按需检索分层记忆文件。' },
  whale_memory_read: { level: 'read', confirm: false, reason: '读取单个原子记忆文件。' },
  whale_memory_supersede: { level: 'local', confirm: false, reason: '将过期记忆标记为 superseded 归档，不物理删除。' },
  whale_list_workspaces: { level: 'read', confirm: false, reason: '只读已登记工作区列表。' },
  whale_list_models: { level: 'read', confirm: false, reason: '只读可用模型目录。' },
  whale_list_presets: { level: 'read', confirm: false, reason: '只读可见 Agent 预设列表。' },
  whale_archive_session: { level: 'local', confirm: false, reason: '归档已完成普通会话，可恢复且不删数据。' },
  whale_search_sessions: { level: 'read', confirm: false, reason: '跨会话全文检索。' },
  whale_read_session: { level: 'read', confirm: false, reason: '读会话消息历史。' },
  whale_session_queue: { level: 'read', confirm: false, reason: '读排队消息与后台任务。' },
  whale_recent_events: { level: 'read', confirm: false, reason: '读事件环形缓冲。' },
  whale_watch: { level: 'local', confirm: false, reason: '添加/移除会话观察，可逆。' },
  whale_schedule: { level: 'local', confirm: false, reason: '添加/移除自我唤醒，可逆。' },
  whale_cancel_session: { level: 'local', confirm: false, reason: '取消进行中的回合，不删数据。' },
  whale_rename_session: { level: 'local', confirm: false, reason: '改标题，可逆。' },
  whale_fork_session: { level: 'local', confirm: false, reason: '复制出新会话，不动原会话。' },
  whale_delete_session: {
    level: 'destructive', confirm: true, reason: '永久删除已归档会话及其子代理，不可恢复。',
    actions: {
      delete: { level: 'destructive', reason: '永久删除已归档会话及其子代理。' },
    },
  },
  whale_select_model: { level: 'local', confirm: false, reason: '改会话内模型选择。' },
  whale_update_queue: {
    level: 'local', confirm: true, reason: 'remove 丢弃一条排队消息；steer/edit 以用户名义改写待注入内容。',
    actions: {
      steer: { level: 'external', reason: '把排队消息以用户名义并入当前回合。' },
      edit: { level: 'external', reason: '改写排队消息文本，按用户原话生效。' },
      remove: { level: 'local', reason: '丢弃一条未送达的排队消息。' },
    },
  },
  whale_todo_create: { level: 'local', confirm: false, reason: '创建统一受管任务卡，不自动执行。' },
  whale_todo_list: { level: 'read', confirm: false, reason: '读受管任务卡列表。' },
  whale_todo_inspect: { level: 'read', confirm: false, reason: '读单张任务卡详情、尝试记录与产物。' },
  whale_todo_update: { level: 'local', confirm: false, reason: '修改待执行任务卡字段或置顶/归档。' },
  whale_todo_start: { level: 'harness-governed', confirm: false, reason: '在独立隔离会话启动任务卡；其审批通过 Harness 委托审批直通主对话。' },
  whale_todo_stop: { level: 'local', confirm: false, reason: '停止正在执行的任务卡并排空 jobs，历史保留。' },
  whale_todo_continue: { level: 'harness-governed', confirm: false, reason: '在原任务会话续接追问修订；仍受 Harness 沙箱与委托审批管理。' },
  whale_list_projects: { level: 'read', confirm: false, reason: '只读桌面已绑定 Project 摘要列表。' },
  whale_inspect_project: { level: 'read', confirm: false, reason: '只读单个 Project 的状态与最近交付。' },
  whale_handoff_to_project: {
    level: 'code', confirm: true, reason: '经桌面显式确认后将任务移交给目录绑定型 Project 协调员执行。',
    actions: {
      handoff: { level: 'code', reason: '向目标 Project 协调会话投递用户授权需求并在其绑定目录内推进。' },
    },
  },
  whale_task_start: { level: 'local', confirm: false, reason: '接纳资料整理任务；worker 无 shell/fs/网络工具。' },
  whale_task_list: { level: 'read', confirm: false, reason: '读后台任务列表。' },
  whale_task_status: { level: 'read', confirm: false, reason: '读单个后台任务结果。' },
  whale_task_stop: { level: 'local', confirm: false, reason: '停止任务，历史保留。' },
  whale_task_resume: { level: 'local', confirm: false, reason: '在用户新指令后续接任务。' },
  task_read_input: { level: 'read', confirm: false, reason: '任务 worker 读取获准资料快照。' },
  task_search_inputs: { level: 'read', confirm: false, reason: '任务 worker 搜索获准资料快照。' },
  task_report: { level: 'local', confirm: false, reason: '任务 worker 提交摘要并结束回合。' },
  whale_profile_settings: { level: 'local', confirm: false, reason: '改助理自身名称/称呼/人设/默认模型。' },
  whale_sticker: { level: 'local', confirm: false, reason: '从贴纸库挑图并返回 markdown。' },
  whale_pet_settings: { level: 'local', confirm: false, reason: '桌宠外观与行为设置，白名单内可逆。' },
  whale_desktop_state: { level: 'read', confirm: false, reason: '读桌面状态与非秘密配置。' },
  whale_marketplace: { level: 'read', confirm: false, reason: '读插件目录。' },
  whale_desktop_config: {
    level: 'local', confirm: 'keys',
    keys: ['githubToken', 'remoteWorkspaceEnabled', 'dshImEnabled', 'openAtLogin', 'autoStartDesktop', 'openDevTools', 'downloadRoute', 'projectEnabled', 'whaleAssistantEnabled'],
    reason: '普通外观/策略键本地可逆；列出的键写凭据、改变对外暴露边界或切换内置能力。',
    actions: {
      patch: { level: 'external', reason: '写敏感键（对外暴露边界、内置能力或启动项）；"始终允许"按实际写入的键集合记忆。' },
      'patch-credentials': { level: 'destructive', reason: '写入或替换凭据键（githubToken）会覆盖既有凭据，每次单独确认。' },
    },
  },
  whale_desktop_plugin: {
    level: 'read', confirm: 'endpoint', reason: 'list 只读；install/remove/disable/enable 由 /desktop/plugin 端点弹桌面确认。',
    actions: {
      list: { level: 'read', reason: '列出已装插件。' },
      install: { level: 'code', reason: '安装会在本机运行第三方代码并重启。' },
      remove: { level: 'destructive', reason: '卸载插件并重启。' },
      disable: { level: 'destructive', reason: '停用插件并重启。' },
      enable: { level: 'code', reason: '启用插件代码并重启。' },
    },
  },

  // ---------- dsh-pad ----------
  pad_list: { level: 'read', confirm: false, reason: '列面板。' },
  pad_get: { level: 'read', confirm: false, reason: '读面板定义与最新数据。' },
  pad_test_source: {
    level: 'code', confirm: true, reason: '试跑数据源：本机命令或带 {{env:}} 密钥的请求。',
    actions: {
      'run-sources': { level: 'code', reason: '试跑即在本机执行命令数据源或携带密钥的请求。' },
    },
  },
  pad_models: { level: 'read', confirm: false, reason: '列可用模型。' },
  pad_create: {
    level: 'local', confirm: true, reason: '建面板本身可逆；附带数据源会运行时先经桌面确认。',
    actions: {
      'run-sources': { level: 'code', reason: '新面板的数据源在本机运行命令或携带密钥发出请求。' },
    },
  },
  pad_update: {
    level: 'local', confirm: true, reason: '改面板可撤销；数据源变更会运行时先经桌面确认。',
    actions: {
      'run-sources': { level: 'code', reason: '变更后的数据源在本机运行命令或携带密钥发出请求。' },
    },
  },
  pad_refresh: { level: 'local', confirm: false, reason: '只重跑已获批准的数据源。' },
  pad_delete: {
    level: 'destructive', confirm: true, reason: '删除面板及其配置。',
    actions: {
      delete: { level: 'destructive', reason: '删除面板及其配置。' },
    },
  },
  pad_submit_data: { level: 'local', confirm: false, reason: '面板刷新代理提交数据。' },
  pad_report_failure: { level: 'local', confirm: false, reason: '面板刷新代理上报失败原因。' },

  // ---------- dsh-project ----------
  projects_list: { level: 'read', confirm: false, reason: '只读列出本机 Project 列表与状态摘要。' },
  projects_get: { level: 'read', confirm: false, reason: '只读查看单个 Project 详情、任务列表与记忆索引。' },
  projects_create: { level: 'local', confirm: false, reason: '在本机 Project 目录中创建新项目记录。' },
  projects_update: { level: 'local', confirm: false, reason: '更新项目指令、并发、模型、审批模式、暂停或归档状态。' },
  projects_add_task: { level: 'local', confirm: false, reason: '在项目内登记新任务及依赖，不直接执行外部命令。' },
  projects_update_task: { level: 'local', confirm: false, reason: '更新任务描述、备注、依赖、路由或验收状态。' },
  projects_memory: { level: 'local', confirm: false, reason: '读写或整理项目专属共享记忆目录内的主题文件。' },
  projects_dispatch: { level: 'harness-governed', confirm: false, reason: '派发或续跑 Project 子任务；子会话的 shell/fs 由 Harness 沙箱与审批管理。' },

  // ---------- dsh-deepseek-tools ----------
  deepseek_tts: {
    level: 'external', confirm: true, reason: '把文本上传到付费 DeepSeek API。',
    actions: { request: { level: 'external', reason: '上传文本到付费 DeepSeek TTS 接口。' } },
  },
  deepseek_asr: {
    level: 'external', confirm: true, reason: '把本地音频文件上传到 DeepSeek API。',
    actions: { request: { level: 'external', reason: '上传本地音频文件到 DeepSeek ASR 接口。' } },
  },
  deepseek_ocr: {
    level: 'external', confirm: true, reason: '把本地文档/图片上传到 DeepSeek API。',
    actions: { request: { level: 'external', reason: '上传本地文档/图片到 DeepSeek OCR 接口。' } },
  },

  // ---------- dsh-acp ----------
  acp_agents: { level: 'read', confirm: false, reason: '列已配置编码代理。' },
  acp_delegate: {
    level: 'code', confirm: true, reason: '在已配置代理上启动子任务，该代理可执行命令；dsh 工具与 whaleisle MCP 端点两条入口都确认。',
    actions: {
      delegate: { level: 'code', reason: '启动一个可执行命令的代理子任务。' },
    },
  },
  acp_cancel: { level: 'local', confirm: false, reason: '取消子任务及其排队工作。' },
  acp_result: { level: 'read', confirm: false, reason: '读已完成子任务结果。' },

  // ---------- whaleisle MCP endpoint (delegated external agent facing) ----------
  send_message: { level: 'local', confirm: false, reason: '已确认委派的子代理向自己的父/子会话发送任务消息，属委派树内既有通道。' },
  list_agents: { level: 'read', confirm: false, reason: '读自己的直接子代理列表。' },
  interrupt_agent: { level: 'local', confirm: false, reason: '暂停自己的子代理，可逆。' },
  whaleisle_skill_list: { level: 'read', confirm: false, reason: '列宿主技能目录。' },
  whaleisle_skill_get: { level: 'read', confirm: false, reason: '读单个技能说明。' },
  whaleisle_present: { level: 'local', confirm: false, reason: '把子代理产出的文件在桌面显示为交付卡片。' },

  // ---------- src/host ----------
  install_dsh_plugin: { level: 'code', confirm: 'endpoint', reason: '安装在本机运行的插件代码；/install 端点弹桌面确认。' },

  // ---------- dsh-im ----------
  dsh_im_return_file: {
    level: 'external', confirm: true, reason: '把本地文件经当前 IM 渠道发出。',
    actions: {
      send: { level: 'external', reason: '把本地文件经当前 IM 渠道发出。' },
    },
  },
});

// Separately installed dsh-with-chatgpt bundles still use the confirmation endpoint.
/** @type {Readonly<Record<string, ToolEffect>>} */
const LEGACY_TOOLS = Object.freeze({
  chatgpt_connection: {
    level: 'read', confirm: true, reason: 'status/prefs/tunnel_status 只读；其余动作建立或改变对 ChatGPT 的公开连接。',
    actions: {
      status: { level: 'read', reason: '读连接状态。' },
      prefs: { level: 'read', reason: '读偏好。' },
      prefs_set: { level: 'external', reason: '改连接偏好（含开发者模式）。' },
      setup: { level: 'external', reason: '创建桥接与配对码，可开启公网连接。' },
      doctor: { level: 'external', reason: '诊断默认会修复，可能重建公开连接；diagnoseOnly 为只读。' },
      pair: { level: 'external', reason: '生成配对码，授权 ChatGPT 访问工作区；配对码只经桌面弹窗展示。' },
      unpair: { level: 'external', reason: '吊销本工作区的 ChatGPT 访问令牌。' },
      tunnel_status: { level: 'read', reason: '读隧道状态。' },
      tunnel_choose: { level: 'external', reason: '切换公开隧道地址。' },
    },
  },
  chatgpt_browser: {
    level: 'read', confirm: true, reason: 'snapshot/read_reply 只读、close 本地；navigate/click/fill/press 向 ChatGPT 提交内容。',
    actions: {
      snapshot: { level: 'read', reason: '读页面快照。' },
      read_reply: { level: 'read', reason: '读 ChatGPT 回复。' },
      close: { level: 'local', reason: '释放浏览器所有权，保留登录数据。' },
      navigate: { level: 'external', reason: '控制专用浏览器打开地址。' },
      click: { level: 'external', reason: '在 ChatGPT 页面执行点击。' },
      fill: { level: 'external', reason: '向 ChatGPT 页面填入文本。' },
      press: { level: 'external', reason: '在 ChatGPT 页面按键提交。' },
    },
  },
  chatgpt_checkpoint: {
    level: 'read', confirm: false, reason: 'get 只读；set/start 写本地检查点状态。',
    actions: {
      get: { level: 'read', reason: '读检查点。' },
      set: { level: 'local', reason: '写本地协作检查点。' },
      start: { level: 'local', reason: '开启本地协作检查点。' },
    },
  },
  chatgpt_record: {
    level: 'external', confirm: true, reason: '把本地迭代记录与输出文件登记为 ChatGPT 可读。',
    actions: {
      record: { level: 'external', reason: '登记一次迭代的变更与输出为 ChatGPT 可读。' },
    },
  },
});

/** @type {Readonly<Record<string, ToolEffect>>} */
const ENDPOINTS = Object.freeze({
  'POST /install': { level: 'code', confirm: 'endpoint', reason: '安装插件代码并重启；端点内串行桌面确认。' },
  'POST /desktop/plugin': { level: 'code', confirm: 'endpoint', reason: '插件 install/remove/disable/enable；端点内串行桌面确认。' },
  'POST /desktop/confirm': { level: 'local', confirm: false, reason: '确认通道本身；只返回用户决定，不执行副作用。' },
  'POST /desktop/show-secret': { level: 'local', confirm: false, reason: '只在桌面弹窗向用户展示秘密，不产生业务副作用。' },
  'GET /desktop/state': { level: 'read', confirm: false, reason: '读桌面状态与非秘密配置。' },
  'GET /desktop/marketplace': { level: 'read', confirm: false, reason: '读插件目录。' },
  'POST /desktop/config': { level: 'local', confirm: false, reason: '应用 renderer 白名单配置补丁；敏感键在上游工具确认。' },
  'GET /desktop/pet-settings': { level: 'read', confirm: false, reason: '读桌宠设置。' },
  'POST /desktop/pet-settings': { level: 'local', confirm: false, reason: '写桌宠外观/行为白名单字段。' },
  'POST /desktop/project': { level: 'local', confirm: false, reason: 'Project 环境桥（含 revert/cleanup），由 Project 服务自身授权模型驱动，非模型直连。' },
  'POST /desktop/html-preview': { level: 'local', confirm: false, reason: '本地渲染 HTML 预览截图。' },
});

// New Orca-ported Bots native tools (registered in dsh-whale's bots runtime).
// Kept in a dedicated table while Wave 2 wires the tool modules so /desktop/confirm
// enforces authoritative side-effect levels immediately without flagging unregistered
// entries as stale during incremental rollout.
/** @type {Readonly<Record<string, ToolEffect>>} */
const BOT_TOOLS = Object.freeze({
  bot_work_start: {
    level: 'harness-governed',
    confirm: false,
    reason: '在目标项目工作目录启动受 Harness 沙箱与聊天内审批管理的编码 Worker 子会话。',
    actions: {
      start: { level: 'harness-governed', reason: '在目标工作目录启动由 Harness 沙箱与聊天内审批管理的编码 Worker 子会话。' },
    },
  },
  bot_send: {
    level: 'harness-governed',
    confirm: false,
    reason: '在本机大肥鱼队友间传递协作消息，目标队友会话仍受 Harness 沙箱与审批管理。',
    actions: {
      send: { level: 'harness-governed', reason: '在本机大肥鱼队友间传递协作消息并由 Harness 治理目标会话。' },
    },
  },
  bot_tools_manage: {
    level: 'read',
    confirm: true,
    reason: 'list 只读；add/update 接入可在本机执行命令或访问外部服务的 MCP 工具，remove 卸载工具。',
    actions: {
      list: { level: 'read', reason: '列出当前机器人配置的 MCP 工具。' },
      add: { level: 'code', reason: '为机器人新增 MCP 工具服务器（可能在本机执行命令或携带凭据）。' },
      update: { level: 'code', reason: '修改机器人 MCP 工具服务器配置或命令。' },
      remove: { level: 'destructive', reason: '移除机器人 MCP 工具服务器配置。' },
    },
  },
  bot_automation_create: {
    level: 'local',
    confirm: false,
    reason: '创建、修改或删除本机队友定时自动化，可逆；触发后的会话由 Harness 沙箱与审批管理。',
    actions: {
      create: { level: 'local', reason: '创建本机队友定时或事件驱动自动化任务，可随时修改或删除。' },
      update: { level: 'local', reason: '修改本机队友自动化任务配置。' },
      delete: { level: 'local', reason: '删除本机队友自动化任务配置。' },
    },
  },
  bot_reply: {
    level: 'external',
    confirm: true,
    reason: '经外部连接器或 IM 渠道对外发送机器人回复。',
    actions: {
      reply: { level: 'external', reason: '通过外部连接器或 IM 渠道向外部对话发送消息。' },
    },
  },
  bot_new_chat: {
    level: 'harness-governed',
    confirm: false,
    reason: '为当前队友创建新的本地支线会话，其内部工具执行由 Harness 沙箱与审批管理。',
    actions: {
      create: { level: 'harness-governed', reason: '为当前队友创建新的本地支线会话，工具执行由 Harness 治理。' },
    },
  },
  bot_memory_search: {
    level: 'read',
    confirm: false,
    reason: '按三层作用域（bot/team/project）只读检索本机记忆索引。',
    actions: {
      search: { level: 'read', reason: '只读检索本机记忆全文索引。' },
    },
  },
  bot_decision_append: {
    level: 'local',
    confirm: false,
    reason: '向当前工作项的本地 decisions/<itemUid>.tsv 追加一条审计决策记录，只追加不删改历史。',
    actions: {
      append: { level: 'local', reason: '向工作项本地决策日志追加一条可追溯记录。' },
    },
  },
  bot_crew_adopt: {
    level: 'local',
    confirm: false,
    reason: '将已有本地普通会话登记或解除为当前队友的船员映射，不修改原会话权限或内容。',
    actions: {
      adopt: { level: 'local', reason: '登记已有本地普通会话为船员映射。' },
      release: { level: 'local', reason: '解除普通会话的船员映射，保留原会话数据。' },
    },
  },
});

// Ordering used when an action the registry does not know has to fall back
// to the strictest level the tool can reach.
/** @type {Readonly<Record<string, number>>} */
const LEVEL_RANK = Object.freeze({
  read: 0,
  'harness-governed': 0,
  local: 1,
  external: 2,
  destructive: 3,
  code: 4,
});

// destructive and code effects never offer a run-scoped "always allow":
// every invocation asks the user again.
const NEVER_ALWAYS_LEVELS = new Set(['destructive', 'code']);

/**
 * @param {string} toolName
 * @param {string} [action]
 * @returns {string | undefined}
 */
function effectOf(toolName, action) {
  const entry = TOOLS[toolName] ?? BOT_TOOLS[toolName] ?? LEGACY_TOOLS[toolName];
  if (!entry) return undefined;
  if (action === undefined) return entry.level;
  const actionEntry = entry.actions?.[action];
  if (actionEntry) return actionEntry.level;
  // An action the registry does not know never falls back to the entry level:
  // that underclassifies e.g. a code-level 'run-sources' confirm as the tool's
  // 'local' headline. With no actions table the action is unverifiable, so the
  // caller fails closed to 'code' like an unregistered tool. With a table the
  // unknown action gets the strictest level the tool can still reach.
  if (!entry.actions) return undefined;
  return Object.values(entry.actions).reduce(
    (strictest, sub) => (LEVEL_RANK[sub.level] > LEVEL_RANK[strictest] ? sub.level : strictest),
    entry.level,
  );
}

module.exports = { LEVELS, TOOLS, BOT_TOOLS, LEGACY_TOOLS, ENDPOINTS, effectOf, NEVER_ALWAYS_LEVELS };
