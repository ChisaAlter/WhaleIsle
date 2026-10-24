# 模块：dsh-whale 内置鲸鱼娘助理

`dsh-whale` 是随桌面安装包交付的第一方插件（`vendor/dsh-whale`），提供一个恒定的 `whale-girl` 会话、侧栏入口和 preset 作用域统筹工具面。默认**开启**（`whaleAssistantEnabled: true`），已有显式关闭配置继续生效。设置导航为「鲸鱼娘」，助理开关位于「聊天与能力」页。

## 挂载路径

`src/main/dsh-whale-desktop.js` 的 `ensureDesktopDshWhale` 准备该插件的桌面挂载：strip 用户层 `cordis.patch.yml` 受管块 → junction `profiles/web/node_modules/dsh-whale` → `vendor/dsh-whale` → 写桌面 overlay `desktop-plugins/dsh-whale/desktop-dsh-whale.patch.yml`（insert id `dsh-whale`，按包名装载）。overlay 仅在 `whaleAssistantEnabled` 为 true 时随每次启动（全量 + skip 恢复）经 `--patch` 传入；关闭时 ensure 删 overlay、跳过 vendor 校验、不阻断启动。启用态下 vendor 源缺文件/缺运行时依赖即 fail-closed 阻断启动。

`dsh-whale` 入 `DROPPED`/`DROPPED_BASENAMES`（市场同名包隐藏、拒绝安装、manifest 剥离），disable 名单免疫（`withoutDshWhaleAliases`，config 归一化剔除）。改动 `whaleAssistantEnabled` 经 `ipc.js` 走 Harness 重启对齐。重启获准后先显示现有恢复页，再异步查询并停止旧进程；新进程等待停止完成，主线程不等待同步系统命令。桌宠卡仍每 3 秒拉取共享会话尾；历史请求与模型目录请求分别去重，目录慢时历史仍继续同步。目录只在开卡及约每分钟刷新，空目录记为已加载，重开卡时的强制刷新在既有目录请求后补做；目录失败保留旧缓存并在下轮重试。

## 插件内部

| 件 | 文件 | 机制 |
|---|---|---|
| 宿主 | `lib/index.js` | `dsh-whale` 设置命名空间（name/personality/personaText/model*/imDefault/sessionId）；`systemPrompt.section` `dsh-whale:persona` 按会话运行时解析（改配置即时生效）；`/dsh-whale` RPC（`ctx.inject?.(['connection'])` 子 ctx，`host.effect` 包裹）；`ctx.inject?.(['sessionController'])` 里 ensure 常驻会话 |
| 会话 | `ensureAssistantSession` | `sessionController.create({sessionId, cwd: data/whale, agentPreset: 'whale-girl', presentation:{owner:'dsh-whale:assistant', title:'🐳 '+name}})`（不带 composer——`managed` 会裁掉模型座/dock/header actions）；sessionId 存 catalog，重启复用；改名经 `setPresentation` 同步标题（list 行 presentation 在 `projections.values.sessionListMetadata` 下）；旧 `managed` 帧启动时迁掉；模型在建会话后 `selectModel`（`saveAsDefault:false`） |
| 预设播种 | `lib/preset.js` | `$DSH_HOME/.agent-presets/whale-girl/`（字节比对刷新，`__WHALE_SKILLS_DIR__` 占位符替换为绝对路径）+ `$DSH_HOME/data/whale/`（AGENTS.md/MEMORY.md/skills/skills-disabled/stickers/pet-outbox.jsonl，存在不覆盖） |
| 人格 | `lib/persona.js`、`lib/preset.js` | 四档性格（natural/genki/tsundere/poison）风格行 + 职责清单 + 用户追加文本；`name` 明确作为当前自称。预设空 prefix 只遮蔽部署默认人格，不能设 `complete:true`，否则组装器把 `dsh-whale:persona` 整段丢掉；动态 section 每轮读取 catalog，改名下轮生效。 |
| 工具 | `lib/tools.js` | preset 行 `dsh-whale/tools` 会话作用域注册：`whale_list_sessions`（仅元数据）、`whale_send_to_session`（`resolveAgent`+`agent.followup`+`createUserMessage{kind:'plugin',form:'relay'}`，prompt 要求先确认）、`whale_new_session`、`whale_usage_today`（读 `usage-today.json` 镜像）、`whale_pet_say`/`whale_notify`（写 pet-outbox）、`whale_remember`（追加 MEMORY.md ≤40k）、`whale_sticker`（`lib/sticker-tools.js`：挑鲸鱼娘表情包返回 `![名](/根锚定路径)` markdown，她写进回复即经客户端 `localPathMediaUrl`→`/api/file` 渲染成图；内置库 `vendor/dsh-whale/stickers/` + 家目录 `stickers/` 自增池，12 格最近队列防连发） |
| IM 接入 | `vendor/dsh-im/src/channels/shared/whale-session.mjs` | 助理启用时 `imDefault` 默认 true；bot 未显式选择其他预设时读取鲸鱼娘持久 `sessionId`，不同聊天共享它。沿用渠道既有访问规则；缺会话时报错，不逐聊天新建；显式其他预设沿用独立会话。 |
| client | `client/client.js` | `__ModuleLoader__.load({id:'dsh-whale'})`；`settings.pet.item` id `whale`——字段块挂进主窗 `pet` 分区「助理」组、总开关正下方：紧凑行逐个 write-through（名字+称呼一行双输入 blur/Enter 提交、默认模型+推理强度一行双下拉、IM 默认行内开关），额外人设/长期记忆/技能收 `ui-primitives` Modal 弹窗（人设·记忆显式保存、技能开关即时）；无性格控件——桌宠性格由主进程 `applySettings` 经 `/dsh-whale` `settings/update` 镜像进 catalog；不注册独立 `settings.section`；侧栏「新会话」下方 `sidebar.panellist` 面板行（label 跟随配置名 + `IconSparkle16` glyph）+ `main` keyed 重定向（选中即 `sessions.open` 她的会话并 `selectPanel(null)`），经 `slots.spec`+`subscribe` 门控注册，无 panellist 的宿主回落 `sidebar.footer.action`；会话头部 `conversation.session.header.actions` 注册 ⚙ 齿轮（`presentation.owner` 门控）→ `settingsNavigation.open('pet')` 直达设置 |

## 宠物桥

`pet-dsh-watch.js` 在会话日志尾随之外追加尾随 `data/whale/pet-outbox.jsonl`（纯 jsonl，非 zstd）：撕裂行不消费、偏移量复用 `dsh.files` 游标表、渲染端 `dshWhale` 事件直推 `text` 上汽泡（优先级-2 提醒）。`usage-today.json` 是反向镜像——watcher 轮询时把当日用量快照写进去供 `whale_usage_today` 读，避免插件重扫会话日志。

反向是桌宠「聊聊」对话卡：宠物 preload 三条 IPC（`live2d-chat-state` / `-chat-select-model` / `-open-whale`，外加 `-chat` 发送）经主进程 POST `/dsh-whale` 的 `pet/state`、`pet/select-model`、`pet/chat` 端点。「看看屏幕」另走 `pet/look`：主进程截屏 base64 + 所选 `lookProvider`/`lookModel` 一并上送，插件内 `ctx.llm.stream` 按 provider 解析 adapter 派发（截图先经 `ctx.attachments.saveImages` 落成内容寻址附件 ref），一次性调用不进会话日志。`pet/chat` = `controller.prompt` 进常驻会话 + `ctx.on('session/event',{global:true})` 总线等本回合 `turn/end`（`data.source.rpcId` 认领自己的 user/message，只数那之后的 turn 的 assistant/message；Remote `follow` 流会随调用方生命周期早关，等回合不走它）。`pet/state` 的模型表来自 `controller.modelCatalog()`，当前选择读快照 `projections.values.modelSelection`（pending ?? lastUsed）；`pet/select-model` 走 `controller.selectModel` 且 `saveAsDefault:false`——卡里的模型选择只影响她自己的会话。卡片 ↗ 钮经 `openWhaleAssistant` 回调让主窗 `sessions.open` 同一会话，两边消息走同一份持久日志（卡侧 3s 轮询 `pet/state` 增量回填）。Remote 方法第二参须给真 `AbortSignal`——实现内部裸调 `signal.throwIfAborted()`。

## 设置与开关链路

设置页在原 `pet` 分区内分「聊天与能力」和「桌面形象与行为」。插件贡献的 `settings.pet.item` 在前一页，宠物管理器控制项在后一页。鲸鱼娘可用 `whale_pet_settings` 经鉴权 `/desktop/pet-settings` 读改宠物设置，`whale_profile_settings` 读改自身名字、称呼、人设和默认模型；原 `whale_desktop_config` 管理全局白名单设置。

主窗 Settings `pet` 分区「鲸鱼娘助理」开关 → preload `saveConfig` → `shell:save-config`（白名单含 `whaleAssistantEnabled`）→ 主进程自动 `restartWithCleanup()`。开关放桌面自有分区，插件未挂载时仍可开启；启用后她的字段块经 `settings.pet.item` 挂入「聊天与能力」。

- 契约：[whale-assistant](../../features/whale-assistant.md)；通用会话展示：[plugin-session-navigation](../../features/plugin-session-navigation.md)；桌宠侧：[desktop-pet](desktop-pet.md)
