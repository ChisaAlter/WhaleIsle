# Feature: Desktop Live2D Pet (THA4 companion window)

| Field | Value |
| --- | --- |
| **id** | `desktop-live2d-pet` |
| **status** | `active` |
| **last verified** | 2026-10-02 — 投喂日志收缩复现旧版失败，新账本删除/恢复/重启与迁移定向验证通过；同 SHA CI 和新安装包验收待本轮候选完成。既有视觉行为本次未改动。 |

## User paths

1. 桌宠默认关闭；用户通过设置或托盘主动开启后，Harness ready 时桌面上出现一个置顶、透明、无边框的伙伴窗（DeepSeek 鲸鱼娘 / THA4 神经动画）；空闲时呼吸/眨眼/头部微动，视线跟随鼠标。已有明确保存的 `enabled=true` 保持开启。
2. 指针悬停在角色上时窗口恢复交互（可拖拽、点按触发反应动画）；指针移开后恢复点击穿透，不遮挡桌面操作。
3. 拖拽超过阈值提交新位置并持久化（`config.live2dPet.x/y`），重启后恢复；小位移视为点按。
4. 托盘/菜单开关控制 `live2dPet.enabled`；默认关闭时不创建窗口或启动成长扫描、日志尾随和光标轮询；从开启切到关闭时关闭窗口并停止上述定时任务。已在途的扫描允许完成。
5. 跨屏拖动正常但跳屏有去抖：光标须在目标显示器上**连续两次 relocate 轮询**（≈300ms）才 `setBounds` 跳屏——快速甩出擦过屏幕边缘不再把她丢到用户看不到的显示器上；轮询间隔超过 ~400ms 视为新拖拽会话、计数清零，防止上一次甩尾的擦边与本次首个越屏轮询叠加成单轮询跳屏。显示器拔除后持久化位置 clamp 回可见工作区。
6. 角色头部上方出现圆角对话气泡（本地离线、按场景分类的台词库）：拖拽/抛掷/落地/摸头/喂食/呼唤/逗弄/连戳生气/入睡/睡醒/点按/到点闲聊各有专属池；台词按类洗牌循环，一轮内不重复，且跨轮不出现首尾同句。头顶空间不足时气泡翻到角色下方并换指向；整只气泡（含尾巴与描边）始终限定在当前显示器内。
7. 右键角色弹出宠物游戏式状态卡（画布内绘制，游戏 UI 设计：分区线 + 槽填充结构 + 等级主题色）：头像裁切 + 名字 + **等级徽章**（填充当前级主题色，带描边）；亲密心形行；**成长进度条**（深色槽 + 等级色填充 + 10 个等间距阶梯节点标记，已达成节点实色/当前节点环形/未来节点暗色，填充=本级内进度）；**算力投喂区**——今日消耗 + 已投喂 + **[投喂 +N]** CTA 按钮（等级色渐变填充 + 描边 + 悬停加亮，无算力时置灰）；三条养成属性条（饱食/心情/亲密，深色槽 + 彩色填充，固定分栏防撞，QQ 宠物式配色——低于警戒线红、满值绿）；底部 2×3 动作格（💬 聊聊 / 👀 看看 / 🫳 摸摸头 / 💤 睡觉·叫醒 / ⚙ 设置 / 🫥 隐藏收尾，悬停时等级色描边；玩耍/逗她的数值收益仍在但入口收敛到直接交互；摸摸头走 `runAction('pat')`——与点她头顶扫动同一个摸头动作）。成长阶梯十级主题色：幼鲸淡蓝→小鲸海蓝→干饭鲸青→鲸鱼娘靛→大肥鱼紫→干饭大王绯→米饭女帝朱→鲸吞四海琥珀→星海饭皇金→干饭真神亮金，整张卡的色调随她成长而变。token 数字按 万/亿 简写显示。
8. 养成属性随时间衰减（饱食每小时下降、心情向基线回归、亲密长期保持；离线衰减封顶 72h）；摸头/逗她/玩耍/点按/抛掷/呼唤都会写入对应属性并有同类冷却（亲密度同类动作 10 分钟只涨一次）。玩耍耗饱食换心情；饿了闲聊会说饿、心情差时逗她可能炸毛、亲密高了会变黏。
9. 「⚙ 设置」格跳转主窗 Settings 的 `pet` 分区（`shell:live2d-open-settings` → `openHarnessSettings('pet')`；宠物窗自身不再有设置 UI）。该分区是**桌面自有**设置页（`ui-settings-general` 注册、仅当 `window.shell` 暴露 `saveLive2dPetSettings` 时挂载）：显示/隐藏桌宠、「体型与不透明度」一行双选（0.6–1.6 / 30%–100%）、性格四档（软萌/元气/傲娇/毒舌——**双人格唯一控件**，变更即经主进程镜像进助理 catalog，助理侧无第二个性格控件）、活跃频率三档（安静/均衡/活泼）、「自主行为」一行双开关（自言自语+乱逛）、「拖拽方式」三档单选（自由拖拽/按住 Shift/锁定位置，写回 `lockPosition`+`shiftToDrag` 一对）、省电模式（无交互 5min 降 ~10fps）、点击音效（WebAudio 合成）、快捷对话开关、**「看看模型」下拉**（数据源 `remote.session.modelCatalog()`，与 Models 区视觉选择器同源；只列 `inputModalities` 含 `image` 的模型，写入 `lookProvider`+`lookModel` 一对；目录里没有的已存路由以「provider / model」陈列保留不丢、选「关闭」清两者=面板不渲染「看看」格，选定后 `lookAvailable` 随 push 即时生效；选定路由的请求经 `dsh-whale` `pet/look` → `ctx.llm.stream` 按 provider 派发，目录暂不可用时已有选择不回弹）、恢复默认（`approvalButtons` 字段仍规范化持久化，但审批桥未接通前设置页不渲染该开关）；底部另有「鲸鱼娘助理」开关——写全局 `whaleAssistantEnabled`（非宠物设置），走通用 `shell:save-config`，主进程自动重启 Harness 生效（见 whale-assistant 卡）；「助理」组声明 `settings.pet.item` 子座（开关正下方渲染），助理启用后她的字段块挂进同组——同一角色一页设置，不再有独立分区。其余设置经 `shell:live2d-pet-settings`（HARNESS_ONLY）进宠物管理器统一规范化+持久化 `live2dPet.settings`+推送到宠物窗，即时生效。
10. 设置导航标题为「鲸鱼娘」；页签「聊天与能力」承载助理配置，「桌面形象与行为」承载上述宠物控制项。两页沿用 Setting-Cell、`SegmentedTabs` 与现有 token。活跃频率驱动两张随机间隔表——自言自语（安静 6–12min / 均衡 2–4min / 活泼 40–80s）与自主乱逛（10–20min / 5–9min / 2–4min）；乱逛是游动式（含垂直漂移）随机目标位移，不写持久位置但经 `shell:live2d-roam` 同步交互热区。睡觉/拖拽/抛掷/喂食/面板或设置页打开时自语与乱逛一律静默（不欠账补发）。

## Invariants

- Windows/Linux 原生窗口区域通过 `setShape` 限定到各绘制表面（含特效、气泡、卡片与菜单阴影），表面间空隙不得合并为可交互大矩形；整屏仅作绘图坐标。未绘制时用零面积区域，禁止 `setShape([])` 恢复整屏。显示/恢复使用 `showInactive`，聊天卡显式打开才取得键盘焦点。macOS 仍使用穿透开关。

- 动画身份以 `pet-live2d/avatar/character.png` 为准。24 个动作语义和 12 种表情使用 THA4 姿态空间驱动；新生成的关键姿态必须逐帧与约 130px 的待机母版对照，并检查边缘、身体比例、服装、鲸尾和连续播放，未通过时只留在 `docs/qa/whale-animation-review/candidates/`，不能改为运行时资产。当前 ImageGen 候选全部未通过身份审查；常用动作已接入实时程序，其余条目不得宣称是已完成逐帧美术。
- 闭眼保留母版眼距与宽度：全部姿态合成后，12/13 自然闭合逐渐减弱同侧其他眼形；双眼闭合退出共享瞳向，单眼眨眼保留另一眼的表情与视线，嘴部表情保留。睡眠另由入睡渐退至面部独占控制。
- 白米饭进食与甩出需要可辨的角色姿态，而非只移动道具或轻改表情；动态 WebP 的无空帧/无裁切检查不能代替待机母版一致性和动作美术验收。2026-09-25 浮动饭碗和额外空中表情已因视觉不合格回退。

- 宠物是桌面壳拥有的独立 `BrowserWindow`（`transparent`、`frame:false`、`alwaysOnTop`、`skipTaskbar`、`focusable:false`），不注入 Harness DOM、不作为 BrowserView 挂在主窗内。
- `live2dPet.enabled` 是显式 opt-in：缺失、非布尔或非 `true` 值归一化为关闭；已经持久化的布尔 `true` 不被迁移覆盖。
- 渲染页只经特权 `pet://` scheme 加载；protocol handler 只映射 `src/renderer/pet-live2d/**` 打包资产，拒绝路径穿越与未授权导航。
- 推理在渲染进程内进行：onnxruntime-web 优先 WebGPU（graph capture + GPU-buffer I/O），失败回落 WASM；不向主进程回传每帧数据。
- 角色渲染是 **live-first 双引擎**：主引擎 THA4 实时推理（`stepPose()` 45 维姿态通道→模型逐帧变形渲染，灵动感的原生来源），叠 Anime4K WebGL 着色器对裁剪区 390×492 做 2× 超分（`pet-live2d/anime4k.js` vendored，MIT；RGB 两轮模糊渗透防透明边暗晕、alpha 双线性 destination-in 保羽化边）。状态层是 `LIVE_STATES` 程序——往 pose 通道写目标值（表情在姿态空间里 morph，不是贴图跳变）+ 整帧变换 `liveFx`（旋转/位移/挤压/抓取点 pivot）覆盖睡觉/拎起/奔跑等模型表达不了的姿势；`stillCtl.alpha` 包络作插值权重，`LIVE_ENTRY` 标记入口统一门控/命中/弹道盒。**禁止**把状态改回静态贴图或刚性部件木偶作主渲染——用户已否决；`rig/` 部件与 `states/*.webp` 只作 live 初始化失败的降级链。推理节流 ~50ms（省电 110ms），ONNX 输出张量逐帧 dispose（泄漏曾 ~1MB/帧），整幅 clearRect（脏矩形漏清=透明窗上的可见碎片）。
- IPC 面收窄到 `shell:live2d-interactive` / `-drag-start` / `-drag-move` / `-drag-commit` / `-live2d-hide` / `-live2d-growth` / `-live2d-feed` / `-live2d-care` / `-live2d-settings-get`（宠物窗只读）/ `-live2d-open-settings`（⚙ 格 → `openHarnessSettings('pet')`）/ `-live2d-roam` / `-live2d-chat` / `-live2d-chat-focus` / `-live2d-chat-state` / `-live2d-chat-select-model` / `-live2d-open-whale` / `-live2d-look` / `-live2d-file-eat`（另有同名 `-growth`/`-settings`/`-dsh` 主→渲染推送，以及 `-cursor` 主→渲染光标推送），且校验 sender 属于宠物窗；pet preload 不暴露其它 shell API。设置写入只走主窗通道 `shell:live2d-pet-settings`（HARNESS_ONLY，`{enabled}`/`{patch}`/`{reset:true}` → 管理器规范化+持久化+推送），`whaleAssistantEnabled` 走通用 `shell:save-config`（白名单内、自动重启）；`live2dPet` 不在 save-config 渲染器白名单上。状态面板为渲染器内 canvas 实现；设置页在主窗 Settings shell（`pet` 分区），宠物窗无设置 UI。
- 畸形/非有限拖拽坐标被忽略（不跳到原点）；`drag-commit` 落点不在任何真实显示器内时先 clamp 回 overlay 所在显示器再持久化（`x:-69` 类死区坐标永不落盘）；持久化位置启动时经 `displayForPoint` 校验，失效则回默认位；渲染器收到任何 `live2d-move` 推送后一律 `clampDrawPos` 收进当前显示器。
- 默认 click-through：`setIgnoreMouseEvents(true, {forward:true})`。**穿透态下的光标输入不依赖 `forward` 转发**（实测 Windows/Electron 43 收不到转发 mousemove）——主进程以 ~30Hz 轮询 `screen.getCursorScreenPoint()` 把窗口坐标经 `shell:live2d-cursor` 推给渲染器，由渲染器的真实 bounds（含迟滞/拖拽守卫）决定是否请求交互态；光标离开 overlay 时推送 `inside:false` 兜底退出。
- 每分钟成长值重扫推送的普通快照只更新数值，不算用户互动、不得叫醒睡眠中的宠物；实际投喂或升级仍会唤醒并播放相应动作。
- 交互开关是**双写者合并**，不是单一来源：`interactive = rendererInteractive || cursorInPetFrame`。主进程热区 = `shell:live2d-roam` 上报的**身体轮廓矩形**（渲染器按实际绘制变换的 alpha bounds + 8px hover 余量，立绘姿态跟随——不是清屏方框或整个 pet 框架）外扩 ±8px；光标进入该区的当拍主进程即强制交互（不等渲染器回路——渲染进程被推理占满时回路延迟可达数百 ms）；光标停在该区域内时渲染器的退出请求不生效（她的 alpha bounds 在摇摆/跑动中会扫出停驻光标，接受那次退出会在飞行中的点击脚下穿洞）；光标离开该区域后渲染器标志重新说了算。热区内 pointerdown/dragover/drop 另有 `petBodyBounds` 命中门——环内按下不会抓她/算戳/吃掉拖放的文件（点击仍被 overlay 吞掉，只是不再误触发她）。渲染器侧 `contextmenu` 无交互门——右键不受 flag 时序影响。
- 不修改 `vendor/deepseek-harness/**`；与 `desktop-pet`（BrowserView Codex 宠物，feature 关闭）互不影响，二者不得同时可见。
- 设置持久化 `live2dPet.settings = {scale, opacity, personality, activity, selfTalk, wander, lockPosition, shiftToDrag, powerSave, clickSound, chatEnabled, approvalButtons, lookModel, lookProvider}`，经 `pet-settings.js` 纯函数规范化（非法值逐项回退默认）；`shell:live2d-roam {x,y,w,h}` 只更新交互热区判定，**永不写** `live2dPet.x/y`。
- 气泡仲裁：priority 0 自语 < 1 事件反应 < 2 DSH 提醒/审批；高级可抢占低级，同级排队（≤3）；`alertId` 幂等撤销；`holdBubbles` 声明占用期自语让路。**whale_notify（outbox `kind:'notify'`）是钉住气泡**：`until=Infinity` + 右上角 ✕，仅用户点击关闭才退场（关闭即按过期规则出队下一条），在钉住期间所有新气泡一律入队、不顶替；气泡矩形经 `interactiveBounds()` 并入悬停交互区但**不进 `petBounds()`**（气泡锚定 `petBounds`，并入会自反馈逐帧上移）。**对话卡打开期间她只在卡里说话**：priority<2 气泡一律丢弃（不显示不入队），开卡瞬间清掉在显的低优先级泡与队列；priority≥2 审批/提醒照常可达（可能带按钮）。**「看看」在途的 lookPin 加载气泡是仲裁特例**：请求结算前独占同一个气泡（`until=Infinity`，不按固定秒数消失；台词库未就绪时兜底「正在看屏幕」），普通台词丢弃不入队，priority≥2 提醒暂存队列且 alertId 去重/撤销照常，开卡清场不清 pin；结算时结果或错误原位顶掉 pin、清空 pin 队列副本并恢复普通仲裁，无台词落点时 pin 回落 6s 寿命防止滞留。**成功的「看看」结果自身是 pinned 气泡**（与 whale_notify 同机制：`until=Infinity` + 右上 ✕，priority 2 才能不被时限、同级顶替与开卡清场刷掉；仅用户点 ✕ 关闭并按过期规则出队下一条），带 `lookResult` 标记——再次「看看」时被新 pin 顶替入队的旧结果副本在结算时一并清除，不复活陈旧结果；失败台词仍是普通限时气泡。
- 对话气泡与角色共用 Canvas，圆角主体 + 指向尾巴是一条连续闭合轮廓（一次填充、一次描边）；不引入第二个无描边三角形，不扩大命中区。气泡视觉只引用 `src/shared/dsh-webui-tokens.css` 的 `--dsw-alias-*` / 字体 token，无字面颜色回退。
- 脏矩形纪律：每个绘制源（角色/立绘/粒子/投喂/气泡/面板）的墨迹必须完全落在自己登记的清屏矩形内——**禁止 `shadowBlur`/发光/超出矩形边界的任何绘制**（阴影溢出清屏区后会逐帧叠加成擦不掉的黑框，实测复现）；面板卡用扁平填充 + 1px 描边，无投影。
- 台词是外置数据：`src/renderer/dialogue/whale.json`（`{global, agents, idleTopics, timeOfDay}`；global 层为软萌默认人格共用池，`agents.{genki,tsundere,poison}` 为三个副人格覆盖层——`natural` 软萌不落 agents 键；去重后 ≥1000 条）经 `pet-dialogue.js` 加载，`phraseForAgent` 按 `agents[人格][类目] → global[类目]` 回退，洗牌袋按 `人格:类目` 复合键独立、同类不重复、跨轮不首尾同句；`{field}` 模板占位符仅解析白名单字段路径（为 Harness 事件元数据预留）。台词本体纯离线数据；仅「聊聊」快捷对话与「看看屏幕」在用户主动发起时出网（聊聊=助理共享会话或桌面凭据端点；看看=所选视觉 provider 端点，经 `dsh-whale` `pet/look` → `ctx.llm.stream`）。喂食分阶段台词（召唤/进食/吃完），到达用 `arrive` 池，闲聊从 `idleTopics` 六池中取、时段类目由 `timeOfDay` 区间表驱动。
- 拖拽/抛掷物理是 `src/renderer/pet-physics.js` 的纯函数层（与渲染解耦、独立测试）：拎起后身体点以过阻尼弹簧（k=200, c=30, ζ≈1.06）跟随光标；松手按拖尾时间窗估算初速（端点均速+峰值混合+末段加速增益，soft-knee 软上限）；超过死区速度（500px/s）进入弹道飞行——重力、屏幕边缘反弹（恢复系数 0.78）、地面摩擦，静止后才交还 live 模型落地。空中可被再次抓住（pointerdown 取消 thrown）。
- 成长值系统只聚合真实用量桶，在 worker 中扫描并按会话与 turn/step 去重；版本化 `growth.food` 持久化可用余额与已观察桶摘要。删除日志不撤销已赚取余额，恢复旧桶不重复发放，新增消费不受历史累计投喂量压制；迁移保留等级、累计投喂与原有可用余额，不补发历史积压。失败保存恢复前态以便重试。数字与 snapshot 不包含消息正文，单餐等级限制保持。详见 [投喂账本决定](../decisions/implemented/bug-fix/2026-10-02-pet-feed-ledger.md)。
- 养成属性系统是 `src/main/pet-stats.js` 的纯逻辑层：`live2dPet.stats = {satiety, mood, affection, lastTick, care{kind→ts}}`；饱食 −4/h、心情向 60 基线回归（±6/h 不越过基线）、亲密不衰减；离线补算按 `lastTick` 封顶 72h、未来时间戳忽略；每个 care 动作有有限增量表，亲密同类动作 10min 冷却；亲密度分五级称号（陌生→熟悉→亲近→信赖→形影不离）；`shell:live2d-care` 上报事件→衰减+增量+持久化，growth 快照携带 stats 推送渲染器。
- DSH 联动是 `src/main/pet-dsh-watch.js` 的增量尾随器：按 `live2dPet.dsh.files` 字节偏移续读 `sessions/**/*.jsonl.zstd` 追加段，只消费完整 zstd 帧（撕裂尾帧不推进偏移、下次补齐再读）；状态机由 `turn/start`→工作中、`turn/end reason.kind`→`dshDone`/`dshError`、`user/message`/`tool/call`/`step/start`→活跃心跳构成；**绝不解析** `user/message.data.content` 或 `tool/call.data.arguments`——只取事件类型与结构字段。概率门在事件发出前生效（working 0.5 / done 0.9 / error·milestone·rest·miss 1.0），`live2dPet.dsh` 持久化 `openTurns`/`dayTokens`/`milestoneMarks`/`activeSince`/`lastActiveAt`/`lastSeenAt`/`lastRestReminder`/`lastGreetDay`，跨重启不重发。里程碑=**当日**消耗 10万/50万/100万/500万/1000万 token；休息劝告=连续活跃 ≥45min 后每小时一次（>10min 静默且无开口回合视为间断）；久别=≥3 天无活动后首日见 `dshMiss`；`shell:live2d-dsh` 同时推送 `{state:'working'|'idle'}` 驱动状态卡名牌旁的陪伴点。watcher 追加尾随 `data/whale/pet-outbox.jsonl`（dsh-whale 插件的桌宠留言桥，纯 jsonl 非 zstd，撕裂行不消费、`text` 字段 ≤512 字符 + `kind` ≤32 字符透传）以 `dshWhale` 优先级-2 直推上汽泡（`kind:'notify'` 钉住，`say` 等其他 kind 保持限时）；反向把当日用量快照镜像到 `data/whale/usage-today.json` 供 `whale_usage_today` 工具读（计数变动才写）。
- 快捷对话 UI 是一张 DOM 对话卡（#pet-chat：头像+名字+关闭的头部、用户右/她左的消息线程、自动长高 textarea + 发送钮；Enter 发送 / Shift+Enter 换行 / Esc 关 / IME 组合期 Enter 不触发），每帧重锚定跟随角色（头顶优先、顶边不够翻到脚下），卡矩形并入 `petBounds` 交互区；宠物窗平时 `focusable:false`，开卡经 `shell:live2d-chat-focus` 临时 `setFocusable(true)+focus()`，关框还原并 `blur()`（Windows 上 blur 可能落空——若 120ms 后窗仍持焦，移交主窗，避免 noactivate 窗静默吃键）。**卡不自收**：窗口失焦（点到别的窗口）保持开卡，仅 ✕ / Esc / 再点「聊聊」显式收起，重获焦点时光标落回输入框。后端是 `src/main/pet-chat.js`：**助理开启时快聊就是她的常驻会话**——`pet/chat` RPC 把文本 `controller.prompt` 进共享会话并经 `session/event` 总线等本回合结束（按 `data.source.rpcId` 认领自己的 user/message、只数自己回合的 assistant/message；`turn/end` 带错误时如实返回，follow 流会随调用方生命周期提前关闭所以不走它）；传输层够不到插件时才退回 `${baseUrl}/chat/completions` 直连（凭据 `loadConfig()` 现取、人格 system prompt 由 `getWhaleSettings` 直读 `data/whale/settings.json` 生成——配置名/称呼/额外人设与会话同一份灵魂，文件缺席才回退内置 `PERSONA_PROMPTS`；内存 6 轮窗口**不落盘**、输入最多 2000 字符且超限拒绝、30s 超时、回复截 240 字符；凭据不发明文——off-host `http:` baseUrl 在外发前拒为 `cleartext-base-url`，回环 http 放行给本地网关）。她的回复按空行拆成多条气泡渲染（真人发消息节奏），聊天卡自身不自动收起（仅 ✕/Esc/再点「聊聊」）。共享模式下线程下方有桌面端式单枚模型入口，当前模型与思考档位并列；两级浮层首层选择模型/思考，次级按 provider 分组或列出中文档位，当前项勾选、限高滚动，开关菜单不改变卡片高度，重复点当前项只收菜单且不重置思考档位，Escape 逐层返回再关卡；完整模型名可悬停读取，隐藏 select 保持目录真实 id（`pet/state` 读 `controller.modelCatalog()` + 会话 `modelSelection` 投影，`pet/select-model` 以 `saveAsDefault:false` 写会话本地选择）+ ↗ 跳转钮（`shell:live2d-open-whale` → 主窗 `sessions.open` 同一会话）；开卡回填共享历史尾、每 3s 轮询增量——DSHD 侧发的消息会同步进卡（互通）。`chatEnabled=false` 时 IPC 直接返回 `{ok:false}`，渲染器落到 `chatFallback` 台词、不触网。
- 「看看屏幕」只在面板点击时触发，且**仅在视觉模型可用时存在入口**：settings get/push 载荷携带 `lookAvailable: Boolean(lookRouteOf().model)`（`lookRouteOf()` = `settings.{lookProvider,lookModel}` 归一值 → 兜底 `options.*` 同名对），为假时面板不渲染「看看」格，`shell:live2d-look` 在 `desktopCapturer` 之前返回 `{ok:false, reason:'no-vision-model'}`——无模型路径永不截屏；触发时 `desktopCapturer.getSources` 取宠物所在屏、缩到 ≤768px JPEG70；**请求路由**：所选 provider+model 经 loopback `pet/look` RPC 交给 `dsh-whale` 插件——harness 内 `ctx.llm.stream` 按 provider 解析 adapter 与凭据派发（桌面自己的 baseUrl 表达不了目录路由，这是 provider 选择真正生效的唯一路径）；截图经 `ctx.attachments.saveImages` 落内容寻址附件存 `$DSH_HOME/attachments/v1`（llm 消息只载 attachment ref，无内联图片路径——本地持久化是这条路线的固有代价，不外发给所选 provider 以外的任何人）；**一眼属于她的长期对话**：会话当前 provider/model 与所选视觉路由一致且模型原生声明 image 输入时，截图经 `controller.prompt` 入队跑真实回合——user 行=截图+指令、她的点评=真 turn 结算的 assistant 行（伪造结算事件会被重放校验拒绝、伪造 turn 外壳会让活 Agent lastTurn 过期，皆不可行）；会话路由不同或不具备原生视觉输入时，保持所选 look 模型的一次性视觉调用（visionFallback 不得改写截图供应商），成功的一眼落一条 `kind:'plugin'`+`form:'notice'` 折叠 context 行（括注点评、图片不入历史——否则后续每条请求在非视觉路由上 `UNSUPPORTED_CONTENT`）；记入失败不影响 look 应答；provider 已选但助理关闭/路由够不到 → `assistant-off` 如实返回（目录路由回不了 legacy 直连），端点/模型错误带 `detail` 回渲染端分池台词（`lookNoModel`/`lookAssistantOff`/`lookError`，不再一律「看不清」；`capture-failed`/`no-frame`/`no-capturer` 等截屏侧失败才回 `lookFallback`，无 `detail` 时 reason 码本身作括注）；模型声明 `off` 推理档时请求带 `reasoningEffort:'off'`——一瞥不需要 CoT，否则隐藏思考会烧光输出预算回空；`maxTokens` 1024，`max-tokens` 截断且无文本 → `OUTPUT_TRUNCATED` 可读错误、干净收尾无文本 → `empty-reply` 分流；点击立刻出 `looking` 加载气泡（`until=Infinity` 的 lookPin + 省略号逐帧动画），在途 pin 独占同一气泡——普通台词丢弃、priority≥2 提醒暂存可撤销、开对话卡不清 pin，重复点击（含期间改动 chatEnabled 等设置）不发第二次请求；结算（成功/失败/同步抛错/拒绝）释放重入锁并让结果或错误原位顶掉；仅无 provider 的旧式裸 model 配置才走 `${baseUrl}/chat/completions` 直连兜底；4s 冷却。

- 重要气泡队列保护固定通知与 priority≥2 提醒：普通闲聊只能替换普通待显示消息，不能挤掉未读提醒；仅普通消息沿用短队列上限。失败回合的部分回复保留在快捷聊天卡中，并另显示错误行。
- 观察器生命周期跟随桌宠管理器，隐藏时继续统计用量、暂停消费助理 outbox，销毁管理器才停止。快捷聊天输入上限为 2000 字符，界面与两端接口一致，接口不会静默截断。

## Allowed touch

- `src/main/desktop-live2d.js`, `src/main/desktop-live2d.test.js` — 窗口生命周期、`pet://` 协议、IPC 授权、位置持久化与 clamp。
- `src/main/config.js`, `src/main/config.test.js` — `live2dPet` 默认值、归一化与持久化。
- `src/main/pet-growth.js`, `src/main/pet-growth.test.js` — token 扫描/去重/成长模型与投喂。
- `src/main/pet-stats.js`, `src/main/pet-stats.test.js` — 养成属性（饱食/心情/亲密）衰减、增量、冷却与称号。
- `src/main/pet-settings.js`, `src/main/pet-settings.test.js` — 宠物设置默认值/规范化/钳制（纯函数）。
- `src/main/pet-dsh-watch.js`, `src/main/pet-dsh-watch.test.js` — 会话日志尾随 + DSH 状态机 + 水位线。
- `src/main/pet-dsh-watch-host.js`, `src/main/pet-dsh-watch-worker.js` — 生产环境每 2 秒最多一次在途的日志扫描，复用尾随器；主进程确认持久化成功后才镜像用量，停止时同步 checkpoint 并屏蔽旧 worker 的迟到事件。隐藏宠物仍继续助理用量更新。
- 审批桥接（R3：**无现行代码路径**）：本仓 harness 无 `/api/respond` REST 端点（审批走 typert Remote 进程内协议），审批桥接由 `dsh-whale` 插件落地为 jsonl 事件桥。`shell:live2d-respond` IPC 形状已预留；相关 R3 模块（规划名 `pet-dsh-mux`）尚未实现，实现落地前不列入本卡 touch 面。
- `src/main/pet-chat.js`, `src/main/pet-chat.test.js` — 对话/视觉请求封装（聊聊=whale `pet/chat` 优先、直连兜底；看看=whale `pet/look` 按所选 provider 路由，providerless 才直连）。
- `src/renderer/pet-live2d.html`, `src/renderer/pet-live2d.js`, `src/renderer/pet-live2d/**` — THA4 ONNX 渲染器、ORT/WebGPU 资产、模型与角色图、鲸鱼娘 fallback 资产、聊聊对话卡。
- `vendor/deepseek-harness/packages/client/ui-settings-general/src/client/PetSection*`、`desktop-shell.ts`、`locales.ts`、`index.ts` — 桌面自有 `pet` 设置分区（主窗 Settings shell），仅限该分区的增量改动（同 `dshbot`/`close-behavior` 行的桌面破例模式）；`vendor/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts` 的 `settings.pet.item` 槽型登记（与其它 `settings.*.item` 同例）。
- `src/renderer/pet-physics.js`, `src/renderer/pet-dialogue.js`, `src/renderer/pet-wander.js`, `src/renderer/dialogue/**` 及对应 `*.test.js` — 拖拽/抛掷纯物理层、台词数据与 sayer、自主乱逛纯逻辑层。
- `src/preload/index.js`（`pet-live2d` 角色）、`src/main/config.js`（`live2dPet` 段）、`src/main/index.js`（协议注册 + 生命周期接入 + watcher/mux 装配）、`src/main/tray-menu.js`（开关项）与 `src/main/tray.js`（菜单重建 `refreshTrayMenu`）。
- 对应 focused tests、`scripts/measure-whale-cdp.mjs`、`scripts/measure-whale-runtime.ps1` 与 `docs/qa/` 验收条目，仅用于复现性能样本。
- `scripts/after-pack.js` 与对应测试——仅限本次发布验收所暴露出的工作区和 vendored 运行时包选择、依赖图隔离及仅供测试的包排除；不得改动 Harness 源码。

## Do not touch

- `vendor/deepseek-harness/**`（Allowed touch 列出的桌面自有 `pet` 分区除外）、Harness DOM、插件/会话数据结构。
- `src/main/desktop-pet*.js`（Codex BrowserView 宠物是独立 feature）。
- 宠物商店/氪金道具/多宠物窗口；成长值只能来自真实 token 消耗（不得虚构或读消息正文）。
- **已批准破例（仅限下述形态）**：快捷对话=面板发起、桌面已配 DeepSeek 凭据、人格 system prompt、内存 6 轮不落盘——不是完整 AI 工作台；「看看屏幕」=仅手动触发、截图以内容寻址附件存本机 `$DSH_HOME/attachments/v1`（llm 协议要求，不外发）、成功的一眼记入她自己的常驻会话——视觉路由下经真实回合落成「截图 user 行 + 她的 assistant 点评行」，文本路由下落 `plugin/notice` 折叠行且不带图、不做自动识屏白名单；审批回写=气泡内【允许一次】【拒绝】手动按钮、`approvalButtons` 默认关、outcome 仅 `allowed-once`/`rejected`；声音=仅 WebAudio 合成点击音效（无素材文件）。**仍禁止**（宠物层）：DeepSeek 余额类 API、自动/持续识屏、question 气泡内作答（v1 只提醒）、替用户批准审批、宠物自身读取其他会话正文（pet-growth/watcher 仍只聚合用量桶）、完整 AI 对话工作台、语音、多宠。助理会话的统筹读/控权限另属 `whale-assistant` 卡——经 `whale_*` 工具与 `/desktop/*` 回环通道授予，不在这条宠物禁令内。
- 应用内 web overlay 形态（已按用户要求移除）。

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/pet-growth.test.js src/main/desktop-live2d.test.js src/main/config.test.js src/renderer/pet-live2d.test.js`；投喂模型/worker/配置定向验证 90/90 通过，旧版真实日志复现失败 |
| Manual / QA | 桌面可视验收：置顶透明窗、拖拽持久化、悬停交互/离开穿透、眨眼与视线跟随 |

## Sources

- Decision: [投喂余额与日志存量分离](../decisions/implemented/bug-fix/2026-10-02-pet-feed-ledger.md)

- Decision: [桌宠原生区域限定到绘制表面](../decisions/implemented/bug-fix/2026-09-29-pet-native-regions.md)

- Decision: [状态卡显示器像素密度与投喂留白](../decisions/implemented/bug-fix/2026-09-29-pet-canvas-density.md)

- Decision: [主题切换保留桌宠透明背板](../decisions/implemented/bug-fix/2026-09-29-pet-theme-transparency.md)

- Decision: [鲸鱼娘优化的局部回退与发布阻断](../decisions/implemented/architecture/2026-09-24-whale-performance-partial-rollback.md)

- Decision: [鲸鱼娘按变化持久化并合并画布绘制](../decisions/implemented/architecture/2026-09-24-whale-runtime-footprint.md)

- Decision: [鲸鱼娘聊聊选择器沿用桌面端浮层](../decisions/implemented/product/2026-09-24-whale-chat-floating-picker.md)
- Decision: [鲸鱼娘命中与气泡共用真实绘制几何](../decisions/implemented/bug-fix/2026-09-24-whale-hover-bubble-geometry.md)

- Decision: [2026-09-20-pet-part-rig](../decisions/archived/product/2026-09-20-pet-part-rig.md)
- Decision: [2026-09-18-pet-default-off](../decisions/implemented/product/2026-09-18-pet-default-off.md)

- Decision: [2026-09-17-pet-growth-scan-off-main-thread](../decisions/implemented/bug-fix/2026-09-17-pet-growth-scan-off-main-thread.md)

- Implementation entry: `src/main/desktop-live2d.js`, `src/renderer/pet-live2d.js`
- Plan: [docs/superpowers/plans/2026-09-14-pet-indesktop-integration.md](../superpowers/plans/2026-09-14-pet-indesktop-integration.md)
- Model pipeline: `C:\Ai\tha4` (Talking Head Anime 4 distillation → ONNX RGBA)
- 社区鲸鱼娘设定来源（非官方、社区创作；文档 CC-BY-NC-SA）：https://github.com/Neko3000/deepseek-whalechan/blob/main/README.zh.md — 米饭=算力、待机式慵懒、傲娇式温柔；https://github.com/Kaalia0912/dsh-whale-musume-persona — 自称「本鲸鱼娘/本小姐」、米饭、尾巴泄密情绪、否认胖而喷水。
- 台词库是我们基于上述意象原创的短场景文案，不是第三方台词清单或官方正典的照抄。
