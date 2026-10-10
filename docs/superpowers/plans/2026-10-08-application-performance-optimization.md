# WhaleIsle 全应用性能优化实施计划

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when the user authorizes implementation. 本计划受当前用户指令、AGENTS.md 与 docs/maintenance/README.md 约束；不授权立即实施、创建 PR、发布或中断现有任务。先实现产品，再准备必要验证，不套用默认 TDD。

**Goal:** 降低整个桌面应用的启动等待、交互延迟、CPU/GPU 开销、内存驻留和无效磁盘写入，同时保留功能、数据、权限、画质与后台工作语义。

**Architecture:** 保留 Electron 壳、Harness Host、官方客户端及插件的现有职责。逐批去掉同步阻塞和重复工作，复用权威会话投影与既有生命周期信号；跨线程只移动确有成本的解析和计算。每批独立实现、测量、验收与评审，最后在同一候选版本验证组合结果。

**Tech Stack:** Electron 44.1.1、Node.js、TypeScript、React/Cordis、SQLite、PTY/Ghostty、WebGPU/ONNX Runtime Web 1.22.0、WebGL/Anime4K。

**Spec:** 本轮用户请求“制定一个完全优化计划，不止鲸鱼娘，整个应用都需要性能优化”；产品契约以 `docs/handbook/`、`docs/features/` 与当前源码为准。以下范围、预算、任务和验收共同构成可执行计划，无需另建形式重复的规格或 Issue。

## 1. 范围与当前证据

覆盖启动器、冷/热启动、Electron 主线程与 IPC、会话加载/搜索/统计、流式对话和长历史、文件树/搜索/编辑/草稿、Git/终端、右栏与独立预览/PiP/Office、主题与动效、桌宠、插件/WhaleBridge/daemon、SSH/手机远程、运行时装配和安装包。

当前主检出为 `codex/plugin-startup-guidance`，HEAD `26205a89fb7a6d416ef446d6281cb77afe610bcd`，已有用户未提交修改；本轮不改动这些产品文件。日常源码实例来自 `whale-integration`，HEAD `765624f12774862a36c5b63b4126ed0d845608b8`，CDP 9338。两者不是同一交付版本。桌宠相关核心文件已核对一致，其他模块不能用另一检出的实测替代。

| 证据 | 已确认内容 | 不能据此声称 |
| --- | --- | --- |
| 本轮桌宠隔离取样 | WebGPU 与 Anime4K 使用 RTX 3060；50ms 控制节拍约 19.8 帧/秒；整帧处理 p50 36.1ms、p95 45.8ms | 完整桌面显示帧率、安装版原问题已修复或节电百分比 |
| GPU 时间戳短样本 | 模型内核约 27–33ms/帧；一组取样矩阵乘加约占 76% | `getData()` 等待全部是拷贝成本；开启 profiling 后的数字等同正常长期负载 |
| 当前主界面 8 秒后台空闲取样 | 未聚焦、rAF 约 1Hz、JS heap 约 29MiB、没有 long task | 前台流式、滚动、大历史、大文件或长期内存表现合格 |
| 源码审查 | 已定位同步持久化、日志处理、状态探测、重复统计读取及预览抓帧重叠路径 | 各候选实际耗时排行或预估收益已测量 |

实施开始时锁定目标 worktree、提交和未提交改动、构建输出、安装包、运行入口、profile、窗口可见性与 DPI。源码、合成数据、真实 Electron 和安装包证据分别记录。

当前两份检出未装配 `vendor/dsh-project`。若最终候选采用 Project 分支，将其纳入 T15 的任务/worker 生命周期与最终组合验收；不把未运行功能虚报为当前资源大户，也不为本计划擅自合并该分支。

## 2. Global Constraints

- 保留现有功能和默认视觉效果，不通过静态贴图替代桌宠、减少日志/会话内容、降低 Office 清晰度、关闭用户插件或远程能力获得成绩。
- 保留原始会话、fork 继承边界、事件顺序、审批、取消、编辑重发、草稿恢复、统计与投喂账本语义。
- 不能用截断历史、缩小既有性能场景、扩大 skip、丢终端输出或过期搜索结果制造通过。
- 保护主检出的脏文件和用户 profile。产品实施使用合适的隔离工作分支；不 switch/reset/stash 用户检出，不清理 ignored 文件或其他运行任务。
- 主线程 I/O 优先用既有异步接口；CPU 解析确实占用线程时才移至 worker，不为每个模块新增服务、配置和通用缓存层。
- 缓存依据现有权威身份/修订失效；外部修改、权限撤销、路径别名/symlink、服务替换必须继续可见。缓存命中不能代表数据当前有效。
- 隐藏视觉表面可暂停绘制；模型请求、后台 agent、PTY、远程通道、PiP/录制不得因 UI 隐藏而被停止。
- 清理仅作用于当前 manager/run/window 拥有的资源，不按进程名称批量终止 Electron、WhaleBridge、shell 或 worker。
- 性能取样默认关闭、按需开启，复用现有脚本和 DevTools；不新增常驻遥测平台或固定审批台账。
- 不绕过 Windows Application Control、凭据加密、工作区授权、任务保护或 stop/drain。
- 已有无阻塞更新检查、输入/投影合批、Markdown 增量解析、PTY 背压、Office 队列与缓存、安装运行时快速复用继续保留。
- 2026-09-24 回退的默认 60fps 限制、睡眠 200ms 推理、Anime4K 延迟加载不直接恢复；相关新实验必须保留当前视觉/节拍并重新实机验收。
- WhaleIsle 开发 CI 可提供反馈。构建和绿色 CI 不代替用户路径；不恢复已废止的最终手动 CI、QA 证书或累计次数审批。
- 本计划只交付规划。实施完成并通过必要验证/评审后，仍须用户明确同意当前目标创建 PR；不预先创建草稿 PR。

## 3. 指标、工作负载与完成条件

### 测量方法

同机、同版本、同数据与功能开关做修改前后对照。单次实验只改变一个因素，先记录预计改善的指标，再测量。完成一次有效对照便停止；只有新改动、新失败、数据污染或具体未覆盖风险才追加。

按进程角色记录 CPU 单核百分比、私有内存、working set、renderer heap、主线程阻塞、React commit、DOM/布局成本、磁盘写入和子进程生命周期。GPU 内核时间、GPU engine 使用率、GPU 进程 CPU 与共享显存不能混为一项，更不能全归因桌宠。

启动记录命令启动→窗口出现→Harness 就绪→客户端就绪→第一帧→可输入的分段时间；不能用只显示启动页缩短“启动时间”。交互记录点击/输入/切换到实际画面变化的 p50/p95。网络模型首 token 和本地渲染延迟分开归因。

### 覆盖场景

| 场景 | 必须观察 |
| --- | --- |
| 已安装候选冷/热启动、重启、失败恢复 | 各启动阶段、插件装配、WhaleBridge、启动动画和首次操作；复用/修复路径分别记录 |
| 正常前台待机、后台/托盘闲置 | 各角色 CPU、磁盘写入、仍运行的计时器/视觉任务；标记任务和宠物开关 |
| 小会话及既有 1,000 会话/500 轮长历史 | 切换、分页/跳转、滚动锚点、DOM、heap、打开工具详情与引用 |
| 流式回复、长推理、工具/代码/图片混合 | 输入响应、React commit、Markdown/高亮、审批/取消/编辑；复用既有压力场景 |
| 文件树、首次与后续搜索、大文件编辑 | 目录规模、取消/切 cwd、完整结果、每键持久化、保存失败与恢复 |
| 多工作区/Git 与高输出终端 | 并发取证/网络 fetch、输出字节、ACK backlog、parser/绘制、尾部与 exit 顺序 |
| 右栏/浮窗/PiP/录制/Office | 隐藏后保留工作、capture 在途数、编码、转换/字体/cache 驻留、清晰度 |
| 壁纸/指针/输入效果、正常/窄窗、高 DPI | 原效果与布局、前台 compositor、遮挡/隐藏/恢复、减少动态 |
| 桌宠清醒/睡眠/省电及完整交互 | 真实可见帧节拍、推理阶段、拖拽/抛掷/投喂、气泡/卡片、跨屏与显卡 |
| 插件、WhaleBridge、SSH/手机远程 | 冷复用、断线/重连、身份、后台工作、配置切换、版本更新和 drain |
| 长时间组合使用 | 20 次打开/关闭受影响表面后资源数量；稳定使用至少 30 分钟的驻留趋势 |

既有 C1 的 1,000 小会话、8MiB 单长日志和 100/1,000 文件场景只回答宿主函数成本，不能替代真实启动、IPC、界面和安装包观察。30 分钟观察属于组合版本收尾，不在每个小任务重复。

### 预算与放行

以下是实施目标，不是已经实现或预估的收益：

- 正常前台本地输入/开卡/切页交互 p95 目标 ≤100ms；网络、首次 Office 转换与全库任务单列，不计入该承诺。
- 正常场景中，归因于新增/保留后台重活的主线程连续阻塞目标不超过 50ms；拆工作或移出线程，不能仅增加 loading 掩盖冻结。
- 视觉绘制按实际刷新预算评估，60/120/165Hz 分别约 16.7/8.3/6.1ms；桌宠模型约 20fps 的推理节拍独立于显示变换节拍。
- 业务不变时无配置/凭据/统计镜像无效写入；合法活动检查点、真实事件游标和日志写入另计。
- 打开关闭循环后，不出现持续增长的监听器、计时器、guest、PTY、转换进程和在途队列；有意保留的缓存必须有清楚的身份、容量与释放位置。
- 每个热点批次以其目标路径 p95 或 CPU/写盘/驻留指标改善为验收；20% 可作为优先追求的改善目标，但不要求所有模块凭空达到同一比例。收益低于噪声或带来回归的实验不纳入候选。
- 组合版本启动、前台交互和非目标路径不能出现有统计意义的退化；先以同条件结果判断，不把一次速度波动当回归或收益。
- 功能、布局或视觉有必要缺口时不能标记完成。全部采用的优化必须在同一最终候选通过受影响用户路径与安装包观察。

## 4. 实施顺序与任务

顺序：T00 锁定基线 → T01/T02/T03/T05 处理已有明确的重复和阻塞 → T04/T06–T15 按测量推进 → T16 模型/GPU → T17 分发 → T18 组合验收。

T01 和 T02 的持久化接口、T03 和 T04 的会话查询契约、T05 和 T07 的组件生命周期、T10 和 T11 的滚动/消息身份由各自负责者统一改动。只并行没有共享写文件或接口依赖的批次；不让多个代理同时改公共状态和生命周期。

### T00 — 固定目标与获取够用的性能基线

**Files:** 复用 `scripts/measure-desktop-lifecycle.mjs`、`scripts/lib/desktop-perf-worker.cjs`、`scripts/measure-whale-runtime.ps1`、`scripts/measure-whale-cdp.mjs`；Harness 的 `apps/web/tests/complex-history.perf.ts`、`packages/client/ui-conversation/tests/history-transport.perf.client.ts`、`apps/web/stress-tests/reasoning-chunks.stress.ts`。

**Interfaces:** 消费最终候选源码/构建与现有测量接口；产出按用户路径、进程角色和版本归属的短基线及热点列表，不新增产品遥测 API。

- [ ] 确认优化候选的完整功能集合和用户既有修改归属，在隔离分支准备对应版本；不自动合并其他聊天的 worktree。
- [ ] 复用已有脚本/DevTools 取得启动、前台、后台、大数据和压力路径必要样本。没有热点的路径保留现状。
- [ ] 每个后续任务选一个可反驳其解释的指标；后续新增验证只能填现有方法遗漏的真实行为。

### T01 — 按实际变化保存配置与凭据

**Files:** `src/main/config.js:349,436,511`；必要时 `src/main/desktop-live2d.js` 的同操作重复保存消费者。

**Interfaces:** 保持 `loadConfig()` / `saveConfig(next)` 及现有规范化、原子写入和加密语义；公共配置层与凭据层分别判断变化，不引入全局永久读缓存。

- [ ] 实现同值不写、普通设置不重加密凭据；必要时合并同一用户操作的重复保存，保留必须即时持久化的事实。
- [ ] 产品完成后复用 `config.test.js` / `config-credentials.test.js`，补真实未覆盖的写入/外部修改情形。
- [ ] 实机改普通设置、改凭据、重启恢复、观察无关写盘与最后值，保留错误可见性。

**Dependency/rollback:** 无前置；后续持久化消费者依赖该契约。回退实现，不重置用户配置/凭据。

### T02 — 日志尾随离开主线程，成长只处理真实变化

**Files:** `src/main/pet-dsh-watch.js:155,312,337`、`desktop-live2d.js:189,1299`、`pet-growth.js:235,263,443`、`pet-growth-scan-worker.js`。

**Interfaces:** 保持原事件、提醒、游标、统计与投喂快照；worker 结果绑定当前目录/会话/扫描代际，不让迟到结果覆盖新状态。

- [ ] 将同步读取/解压/解析移到既有或任务专用 worker；活动文件索引只减少重复枚举，不丢新会话、轮转、删除与恢复。
- [ ] 仅在宠物和助理相关消费者均关闭时停止不需要的观察；成长缓存只回传必要变化，变化日志的增量解码保留完整 frame/去重语义。
- [ ] 实现完成后复用 watcher/growth 定向检查，并实际边生成边拖窗/发送、删除恢复日志、投喂和重启。

**Dependency/rollback:** T01；不能截断持久化 `food.seen` 换内存，不能为了停止 watcher 让助理用量失效。回退 worker/缓存实现并保留账本。

### T03 — 用量统计消除重复全库读取

**Files:** `vendor/dsh-usage-panel/src/host/index.ts:198,237,293,691`；Harness `packages/session-query/session-query/src/{index,corpus,observation,config}.ts`、`packages/session/session-projection-cache/src/index.ts`。

**Interfaces:** 保持 overview/session cost、价格、fork 继承前缀与修复接口；整会话统计是替换旧值，不能将总量再次当增量累计。

- [ ] 先消除“每个冷会话再 list 整个目录”和重复日志复制；稳定的一次扫描共享已验证库存，不增加另一套日志解析器。
- [ ] 再评估 `observeSession(sessionId, {signal, projectionMode})` 的投影复用。先证明 usagePanel、继承边界、中断 turn、空会话和服务替换与当前 `readSession → coldSnapshot` 等价。
- [ ] 按权威会话修订复用逐会话聚合，删除/修复/变化会话替换对应贡献；公开 observation 不含 persistence identity，不能凭空拿它作外层缓存键。
- [ ] 实现后复用插件的 inherited-boundary/refresh/projection/session-repair 与 Harness observation 检查；真实打开统计同时发送和搜索，核对总量及响应。

**Dependency/rollback:** T00。prepared cache 默认只有 5 个，单纯换 API 不保证全库周期扫描免重放；现有“会话数+最大创建时间”不能证明内容没变。回退查询/聚合实现，不修改原日志。

### T04 — 会话搜索索引的修订与事务成本

**Files:** Harness `packages/session-query/session-query-sqlite/src/index.ts:407,454,510,528,582` 与相关索引检查。

**Interfaces:** 保持 stable observation、live 优先、revision/generation/cursor、索引 ownership、事务 rollback、取消与排序。

- [ ] 量首次搜索、索引 reconciliation 和变化会话同步事务占用；若为热点，减少未变行处理并将同步重建移离 Host 事件循环。
- [ ] 不删稳定库存的验证，不用后台旧索引冒充实时搜索；变更边界复用 T03 确认的权威身份。
- [ ] 产品完成后验证首次大库搜索、生成中搜索、删除/修复后的结果、快速取消和服务更换。

**Dependency/rollback:** 与 T03 的查询契约协调后实施；索引可重建，用户日志不可被清理。未成为热点时不改该路径。

### T05 — 启动器状态取证与日志去同步阻塞

**Files:** `src/launcher/launcher-service.js:82,609`、`whalebridge.js:75,126`、`components/lifecycle.js:18`、`forensics-log.js:25,49,82`；`src/main/ipc-components.js:110`。

**Interfaces:** 保持 status/row/forensics 的身份、进度、最新错误；组件生命周期提供当前状态，外部 PID 接管保留 management API/版本校验。

- [ ] 消除状态请求内同步 `tasklist`；一次请求使用一致快照，相同在途请求仅在确有重复时合并。
- [ ] 日志采用有界串行异步写入和轮转，保留输出顺序、错误尾部与退出前必要 flush。
- [ ] 实现后实际打开启动器、触发组件退出/恢复、产生突发日志，确认诊断最新且聊天窗口保持响应。

**Dependency/rollback:** 不依赖 T01，但可利用其减少配置重读成本。当前没有固定 launcherStatus IPC 轮询，不新增轮询或虚报每秒后台扫描；回退取证/写日志实现。

### T06 — 启动关键链路与插件装配

**Files:** `src/main/{index,launcher-gate,harness-controller,dsh,harness-extract,plugins,window}.js`；`plugins.js:268`、`dsh.js:918`、`src/launcher/whalebridge.js:182`；`src/renderer/boot.*`。

**Interfaces:** 保持启动 in-flight 合并、旧进程退出等待、插件顺序/错误恢复、skip 模式、第一帧揭示与首次请求 readiness。

- [ ] 依据启动分段找真正 critical path；插件未变的安装文件复制变成可靠 no-op，内容改变和修复仍同步正确版本。
- [ ] 分别量鲸桥健康复用、冷启动与失败等待；只有证明不被首次渠道请求依赖的部分才能后移/并行。
- [ ] 非必要模块按真实入口加载；不把必要插件装配或账户/渠道就绪错误藏到主界面之后。
- [ ] 产品完成后观察安装版冷/热启动、重启、缺 payload、插件失败恢复、第一次发送/工具请求以及完整揭示动画。

**Dependency/rollback:** T05；公共配置补丁不能无条件并行。更新检查不阻塞自动启动、安装路径复用与提取取消已存在，不重新实现。回退启动调度，保留恢复资料。

### T07 — 组件安装/更新目录 I/O

**Files:** `src/launcher/components/index.js:143`、`components/lifecycle.js:163,177` 及 staging/安装消费者。

**Interfaces:** 保持每组件锁、ASAR 可读遍历、staging 校验、原子版本切换、最后可用版本与用户数据目录。

- [ ] 同步递归复制/删除改用异步 I/O，CPU 工作只有量到成本才移入 worker。
- [ ] 产品完成后实际安装/更新较大组件，失败与取消保留旧可用版本；操作期间测聊天、窗口和启动器响应。

**Dependency/rollback:** 与 T05 生命周期接口串行整合；不关闭正在服务的实例、不随便删组件数据。回退复制调度，而非回滚用户目录。

### T08 — 工作区文件访问与完整、可取消的搜索

**Files:** `src/main/{workspace-fs,workspace-authority}.js`；Harness `packages/client/ui-files/src/client/FilesPanel.tsx:172`、`packages/context/file-reference-local/src/search.ts`。

**Interfaces:** 保持物理路径授权、忽略规则、搜索完整性、排序、cwd/request 身份与取消；区分 Files 首次 DFS 和已有 bounded 文件补全索引。

- [ ] 量目录访问的同步成本和注册表重复解析；必要时减少同请求重复读/解析，权限与 symlink 复查继续执行。
- [ ] 优化 Files 首次全树搜索为可取消、分批/有界并发的遍历或现有权威索引复用；渐进结果必须说明尚在搜索，不静默截断嵌套匹配。
- [ ] 产品完成后验证大目录、外部修改、Refresh、深层匹配、切 cwd、工作区移除、symlink 与权限撤销，观察前台搜索响应。

**Dependency/rollback:** T01 可改善注册表读取；保持现有文件补全的上限/取消/后台刷新，不为同一目录再造重复索引。回退搜索实现，保留文件。

### T09 — 文件预览窄订阅与大草稿持久化

**Files:** Harness `packages/client/ui-files/src/client/FilePreview.tsx:243,383,672,692`、同目录 `desktop-file-state.ts:72`、`fileSaveCoordinator.ts`；MarkdownText 只由 T10 负责公共变更。

**Interfaces:** 保持文件/Session/revision 身份、语言切换、脏草稿、串行保存、刷新/崩溃恢复与关闭确认。

- [ ] 缩窄全部 sessions 的广订阅，稳定 Markdown labels 对象，消除无关会话变化触发的重新解析。
- [ ] 量大文件每键完整序列化/localStorage 写入；若构成热点，改变持久化调度/载体而不扩大可丢草稿窗口。
- [ ] 实现后实测大文件输入、切会话/浮窗、语言切换、保存中继续输入、失败关闭、刷新恢复，核对代码/图片/复制与最新草稿。

**Dependency/rollback:** 窄订阅可独立推进；持久化迁移须与现有恢复契约协调。保留旧草稿可读，不能为回退清空 localStorage。

### T10 — 流式消息、Markdown 与工具详情

**Files:** Harness `packages/client/ui-chat/src/client/chat/`、`ui-conversation/src/client/`、`ui-primitives/src/markdown/MarkdownText.tsx:119,136` 及高亮/工具详情模块；`packages/api/session-controller/src/client/` 的 notifier/snapshot 消费者。

**Interfaces:** 保持事件与节点身份、最终 DOM/文本、工具完整原文、审批/取消/编辑重发与引用/图片链接。

- [ ] 先 profile 巨大单消息、未闭合代码 fence、推理片段和完整工具详情，定位剩余数组复制、解析、高亮/订阅或布局热点。
- [ ] 只对热点降低重复 work，必要时将纯计算移到现有 worker 路径，流式尾部和终态修复仍一致。
- [ ] 产品完成后复用增量/DOM parity/高亮/投影检查，真实流式时输入、滚动、审批、取消和打开完整详情。

**Dependency/rollback:** T00。已有 microtask/rAF 通知合批、单节点 memo/窄订阅、Markdown 增量冻结、流式高亮缓存和共享 IntersectionObserver；不从零再加这些机制，不再次截断工具输出。回退解析/投影优化。

### T11 — 已加载长历史与展开会话列表

**Files:** Harness `packages/client/ui-chat/src/client/chat/ChatView.tsx:67`、相关 viewport/navigation 模块；`packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx:780`。

**Interfaces:** 保持历史分页、变高消息、滚动锚点、turn 跳转、折叠、运行项/子任务父项、排序/拖动、键盘与选区复制。

- [ ] 先比较已加载历史/flat 列表的 DOM/layout 与计算成本，决定是否引入局部窗口化或跳过屏外布局；正常小列表不增加复杂度。
- [ ] 先落实浏览器查找、跨消息选择和引用定位对未挂载内容的规则，再实现视口方案。
- [ ] 产品完成后真实 prepend 历史、展开代码/图片、跳到远处回合、搜索/排序/拖动、多次切会话；正常/窄窗及右栏开关检查完整布局。

**Dependency/rollback:** T10 的节点/内容通知契约。保留默认 50 消息分页、默认 5 个 idle 会话折叠和运行项豁免；不把隐藏内容或减少夹具规模当提速。达不到行为等价时撤回窗口化。

### T12 — 隐藏页面与主题/视觉任务生命周期

**Files:** Harness `packages/client/ui-dockkit/src/components/TabLayout.tsx:42,102`、`ui-sidebar-right/src/client/tab-info.ts:46`、`ui-theme/src/{cursor-fluid,cursor-fx}.ts`、壁纸/输入效果；桌面 `src/main/window.js` 与 `src/renderer/boot.*` 的必要状态桥。

**Interfaces:** 复用现有 visible、active、reduced-motion 和 manager 生命周期；keepMounted 保留数据/草稿/guest/终端身份，视觉任务分别暂停和恢复。

- [ ] 列出实际隐藏/被覆盖表面仍执行的工作，量 CSS 动画 compositor/raster 和保留页 React/计时器成本。
- [ ] 只暂停无消费者的视觉 work；恢复显示当前数据。启动页被主界面覆盖后不能继续消耗无用绘制，但失败恢复仍可重新显示。
- [ ] 产品完成后观察切 tab/折叠右栏/托盘/最小化/遮挡/锁屏与恢复，核对草稿、终端、浏览器和视觉质量。

**Dependency/rollback:** 与 T13/T14 的消费者分类协调。流体指针已 4 秒 idle 停机并 hidden 暂停，粒子只在存活时调度；不能从零再加停机或统一销毁右栏。回退可见性调度。

### T13 — Browser/PiP/录制与 Office 预览

**Files:** `src/main/preview.js:418,435`、`preview-pip-protocol.js:9`、`preview-file-window.js`、`office-runtime.js`；Harness `packages/document/office-to-pdf/src/{queue,identity}.ts`。

**Interfaces:** 保持共享 capture、消费者身份、帧序/尺寸、录制质量、工作区授权、转换取消及 render/font generation。

- [ ] 固定 12fps capture 改成单次在途，跳过过期结果；PiP 目标尺寸优化只有清晰度和编码成本对照支持时采用。
- [ ] 量 Office 冷首次预览、连续预览后的转换/字体驻留和 cache 命中，再调真实热点；已有 2 并发、8 排队与 128MiB cache 上限不是预留 RSS。
- [ ] 实现后实际看高分辨率网页/视频 PiP、同时录制、切页/关闭重开及 PDF/DOCX/PPTX/表格，检查文本、字体与清晰度。

**Dependency/rollback:** T12 的可见性不能暂停仍被 PiP/录制消费的隐藏 guest。保持路径/源版本/执行环境/授权 scope 的缓存隔离；回退调度或优化，不删除文件/录制。

### T14 — 终端高输出与 Git/多工作区

**Files:** `src/main/pty.js:35,51`、`git-fetch.js:36,45`、`workspace-authority.js`；Harness `packages/client/ui-user-terminal/src/client/ghostty/` 与 GitActionsControl。

**Interfaces:** 保持 seq ACK、高低水位 pause/resume、输出顺序/尾部、renderer 代际、PTY 进程与 common-dir+remote 身份。

- [ ] 量 PTY 吞吐/backlog/ACK/parser/dirty-row 绘制和隐藏恢复；只改剩余热点，不重做现有 8ms/32KiB 合批与 256/64KiB 背压。
- [ ] 量多窗口同 key 并发 fetch，确实重复时才共享在途请求；保留 15 秒成功冷却、失败退避与本地修改实时读取。
- [ ] 产品完成后实测高输出/Unicode/控制序列、exit 前尾部、切 drawer/会话/后台、外部 Git 修改/多 worktree 与网络失败。

**Dependency/rollback:** T08/T12。Git 是 focus/visibility 恢复 debounce，不新增固定轮询；关闭 drawer 不 kill PTY。回退热点优化，保留工作。

### T15 — 插件、daemon、WhaleBridge 与远程运行资源

**Files:** `src/main/{dshd-daemon-runner.mjs,dshd-daemon-hooks.mjs,remote.js,dshd-remote.js,dsh-remote-desktop.js,mobile-web-server.js}`、`harness-controller.js`、`src/launcher/components/`、`vendor/dsh-remote`、`vendor/chisacode-remote/packages/server`、`vendor/dsh-whale`、`vendor/dsh-task-control`；daemon 源码由 `chisacode-remote` 装配到安装包的 `resources/vendor/dshd-remote`，不能混用源码/包内路径。采用 Project 候选时加入其实际入口。

**Interfaces:** 保持 daemon 配置身份复用、SSE 多路复用、连接/请求代际、账号鉴权、远程路由与 stop/drain；资源清理绑定当前拥有者。

- [ ] 盘点真实候选的进程/监听/连接数量和工作消费者，区分必须常驻、按需启动、仅视图驻留。
- [ ] 量配置切换、断线/重连、插件重载与组件更新后的资源数量，只清理已确认不再被消费者使用的资源。
- [ ] 产品完成后真实 SSH/手机远程请求、后台生成、切连接/重载插件/升级、取消与停止保护，保证没有丢工作或跨实例晚回调。

**Dependency/rollback:** T05/T06/T07 的管理身份。不能仅凭进程数量关闭能力；不能暂停后台 agent、强制升级忙碌组件或清理 Project worktree 的 ignored/活跃文件。回退生命周期变更。

### T16 — 桌宠 GPU 计算、输出与重复绘制

**Files:** `src/renderer/pet-live2d.js:304,3549,4448`、`pet-live2d/avatar/model.onnx`、`pet-live2d/anime4k.js`、`src/main/{desktop-live2d,pet-settings}.js`。

**Interfaces:** 保持 live-first、45 维 pose、透明边缘/命中区、Anime4K 当前锐度、50ms 正常/110ms 现有省电推理和显示变换节拍。

- [ ] 独立记录实际 EP/adapter/fallback，双 GPU 机器核实高性能偏好；不把本机已经使用独显误报成待修复问题，不全局强制所有窗口独显。
- [ ] 针对 GPU profile 的矩阵乘加热点比较兼容的导出/kernel 方案；模型已混合 FP16，ORT 升级要先检查 device/API/capture 和降级兼容，不直接替换最新版。
- [ ] 优化 GPU→CPU→GPU 输出链，评估保留 GPU 后处理或紧凑 NHWC/uint8；保持 Uint8ClampedArray 的钳制/舍入、alpha 与视觉等价，收益不能按数据量四倍外推。
- [ ] 评估同一刷新周期重复绘制、稳定气泡/卡片缓存和固定尺寸 SR 上传；维持完整清屏防残影与当前动作节拍。
- [ ] 产品完成后在真实可见桌宠做同条件对照，覆盖待机/睡眠/省电、拖拽/抛掷/投喂、菜单/聊天、跨屏/DPI及关闭恢复，完整画面与动作合格后才采用。

**Dependency/rollback:** T01/T02 已减少周边干扰。任何白帧、闪烁、身体比例/眼形/边缘变化、动作延迟、热区错位或用户路径缺口都撤回实验实现；不恢复静态主渲染或旧默认降频策略。

### T17 — 包体、解析与运行时装配

**Files:** `package.json`、`scripts/{production-runtime.js,after-pack.js,runtime-instance-graph.js}`、`src/main/harness-extract.js`、宠物 ORT/Anime4K 的构建入口与现有过滤。

**Interfaces:** 保持真实 resolved source/peer identity、公开子路径、native/WASM 降级、许可证、首次安装/更新/修复与原包分发流程。

- [ ] 分别统计源码、staging resources、asar、NSIS、首次提取、用户数据与可选组件；不将这些重叠体积相加。
- [ ] 优先裁剪确实未用的 Anime4K 静态算法与 ORT 算子，保留同一锐化算法/加载时序和全部已承诺降级。
- [ ] 对其他重型模块按真实导入与首用路径审查；已有 closure/tar/快速复用保留，不按包名/版本硬合并依赖实例。
- [ ] 实现后跑受影响装配契约并启动实际新安装包，验证首用、离线、缺组件恢复、升级及旧用户数据。

**Dependency/rollback:** 对应产品方案稳定后做裁剪，T16 可能改变模型算子集合。回退资产/构建变更，不清除用户运行时和配置。

### T18 — 同版本组合验收与交付

**Files:** 最终分支的完整产品 diff、相关现有测试、现有 smoke/QA 与构建入口；产品事实改变时更新其负责手册/功能页。

- [ ] 汇总每批采用/撤回项和同条件对照；排除仅噪声改善、缩减功能和证据不足的实验。
- [ ] 固定同一候选重新观察组合启动、前台混合工作、后台闲置及 30 分钟驻留趋势；只补组合产生的交互风险，不重复全部已通过局部检查。
- [ ] 在真实完整画面核对正常/窄窗、右栏/终端开关、长内容、DPI和实际操作；性能提升不能掩盖布局、草稿或任务回归。
- [ ] 对行为/布局/跨模块最终 diff 做 Standards 与 Spec 两条独立只读评审，包含所有交付的未提交文件与实际验收证据。
- [ ] 构建并启动实际安装候选，验证受影响用户入口。准确区分源码通过、CI、安装包和最终用户确认。
- [ ] 提供实际变化、性能对照和剩余边界；全部完成且用户明确同意后才创建 PR，合并由用户决定。

**Rollback:** 每批独立工作提交；撤回实现不撤回用户数据。遇到任务保护、数据正确性、权限、视觉或必要用户验收失败时停止该项推进，保留分支与明确缺口。

## 5. 现有验证入口与执行限制

以下是可复用入口，不是每批必跑全量表。本次制定计划未运行这些检查。

| 负责问题 | 入口 |
| --- | --- |
| 桌面相关行为 | 仓库根 `node --test` 加本批的 `src/main/*.test.js` / `src/launcher/**/*.test.js` 具体文件；不默认全仓 `npm test` |
| 用量插件 | `npm test --prefix vendor/dsh-usage-panel`；必要时 `npm run build --prefix vendor/dsh-usage-panel` |
| Harness 查询/客户端行为 | 在 vendor 根使用既有 Vitest 项目选择对应 observation、索引、投影、scroll-follow、turn-navigator、Markdown、files、ghostty 与 theme 测试文件；UI 包没有单独 test script |
| 宿主函数基线 | `node scripts/measure-desktop-lifecycle.mjs --profile c1 --source-root <目标检出绝对路径> --out <新的临时结果目录>`；不测真实启动、IPC或界面 |
| 长历史/内存 | vendor 根 `npm run test:web:perf:built`；已构建目标与 replay 数据匹配时运行，配置采用诊断用 forced-GC，不能代替自然长期驻留 |
| 推理片段压力 | vendor 根 `npm run test:web:stress`；仅对应压力/组合风险需要时运行，不修改其默认工作负载 |
| 桌宠 | 目标检出的 `measure-whale-cdp.mjs` / `measure-whale-runtime.ps1`；normal/sleep 脚本会改变状态，只对隔离或明确授权实例运行并恢复 |
| 运行入口 | 产品代码改变后按现行启动规则重启目标仓库应用；文档/工具改动不因此启动产品。处理 stale TS 增量按 AGENTS 既有清理命令，不改项目文件列表隐藏错误 |

每批执行次序是：实施对应产品修改 → 选择/补充必要验证 → 测同条件结果 → 实际用户路径/完整画面 → 适用评审。指标缺数据记“未测”，工具失败记具体边界，不记 0 或通过。无关分支、旧安装包、后台 1Hz 或合成组件截图不能替代最终用户结果。

## 6. Review Focus 与计划自检

1. **迟到工作结果：** 切 cwd/会话/连接、插件重载、组件版本切换后，旧 worker、索引、capture 或 RPC 不能覆盖新实例。分别由 T02/T04/T08/T13/T15 验证。
2. **用户数据保持：** fork、删除/修复日志、草稿新输入与保存失败、统计/投喂去重必须保持。分别由 T01/T02/T03/T09/T10 验证。
3. **隐藏仍有消费者：** 终端、agent、远程、PiP/录制与 keepMounted 表面的业务工作继续，恢复不丢状态。由 T12–T15 验证。
4. **完整视觉：** 高刷新/DPI、窄窗、右栏/底栏、长内容与桌宠连续动作，没有裁切、遮挡、残影、错位和画质退化。由 T11–T13/T16/T18 验证。
5. **缓存与装配身份：** 权限撤销/外部修改/持久化服务更换/同名依赖不同实例不能被缓存和去重掩盖。由 T03/T04/T08/T15/T17 验证。

自检结论：上述范围均有任务和真实观察入口；基线与候选身份已区分；已做的分页、合批、缓存、背压和生命周期机制列为保留项；未知收益保留测量决策；没有把本轮计划写成已经实施或性能通过。执行中若范围/实际契约改变，只更新受影响任务和验收，不用旧计划覆盖用户新要求。

## 7. 参考依据

- `docs/maintenance/README.md`、`docs/handbook/flows/boot-to-ready.md`、`docs/handbook/modules/{boot-lifecycle,surfaces,terminal,usage-stats,desktop-pet}.md`。
- `docs/decisions/implemented/architecture/2026-09-24-whale-performance-partial-rollback.md`；历史收益不冒充当前证据。
- [Electron 官方性能指南](https://www.electronjs.org/docs/latest/tutorial/performance)：按运行 profile 找热点、避免主进程同步 I/O、按实际入口加载。
- [ONNX Runtime Web GPU 数据与绑定](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)、[当前使用的 ORT 1.22 env 定义](https://raw.githubusercontent.com/microsoft/onnxruntime/v1.22.0/js/common/lib/env.ts)：区分异步提交、GPU 完成和 CPU 下载，选卡设置的初始化边界按实际版本处理。

**制定计划时的状态：** 当时只新增本计划，尚未改产品。本计划后续已获用户授权实施；当前采用项和逐项体验结论以同目录之外 `docs/research/application-performance-results.md` 的实际观察为准，待验项不视为完成，不预先承诺节省比例。
