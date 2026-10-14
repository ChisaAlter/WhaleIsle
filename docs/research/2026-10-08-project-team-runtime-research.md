# Project 与智能体团队：运行时实现的一手源码研究

日期：2026-10-08。范围：团队身份、持续委派、持久化、取消、恢复与结果交接。

本报告为源码研究，不是第三方运行验收，也不代表鲸屿已实现这些能力。没有执行外部仓库代码，没有修改产品代码。官方文档解释概念，行为结论优先依据下列固定提交的实现。

用户已经明确要求 Project 与鲸屿智能体团队结合。下文把 Agent Teams 作为实施基础；此前“可选团队、Project 自建独立 worker 管理”的取舍不再作为目标。Project 提供长期工作产品体验，团队提供协作执行能力，两者不应各维护一份成员和任务事实。

## 1. 研究基线

三个 SHA 均由 `gh api repos/<owner>/<repo>/commits/HEAD --jq .sha` 当场获取。它们代表研究时的仓库 HEAD，不代表最新稳定发行版。

| 项目 | 固定提交 | 阅读重点 |
| --- | --- | --- |
| microsoft/autogen | [`027ecf0a379bcc1d09956d46d12d44a3ad9cee14`](https://github.com/microsoft/autogen/commit/027ecf0a379bcc1d09956d46d12d44a3ad9cee14) | 团队保存/加载、成员生命周期、暂停与取消的区别 |
| OpenHands/software-agent-sdk | [`69e26889401fe69157fff536e6a69049e6644cb3`](https://github.com/OpenHands/software-agent-sdk/commit/69e26889401fe69157fff536e6a69049e6644cb3) | 子会话创建、持续委派、事件提交顺序、实际停止边界 |
| langchain-ai/langgraph | [`40a2e6d845054cc0cc17a6a169ca6e7394e5231c`](https://github.com/langchain-ai/langgraph/commit/40a2e6d845054cc0cc17a6a169ca6e7394e5231c) | checkpoint、任务输出恢复、interrupt 重放与迟到写入 |

官方入口：[AutoGen 状态管理](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html)、[OpenHands SDK](https://docs.openhands.dev/sdk)、[LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence)、[LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)。OpenHands 旧 delegation 文档地址本次返回 404，因此委派结论直接引用当前源码，不使用搜索到的第三方镜像。

## 2. AutoGen：团队状态是成员状态加调度状态，但不是运行进程快照

### 已确认机制

- `save_state()` 分别调用每位参与者及 group-chat manager 的状态接口，按名字保存；它没有把整个 Python runtime 直接序列化。名字与运行时 agent ID 分离，使状态可载入重新建立的团队。[保存实现](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py#L748-L796)
- 保存方法明确警告运行中读取可能不一致，建议团队停止后保存。代码没有给多成员采样加分布式快照屏障；逐成员 await 不是原子快照。[一致性限制](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py#L773-L795)
- `load_state()` 拒绝运行中加载，要求保存状态中存在每位当前参与者及 manager；逐个装载，而非缺少谁就自动重建谁。[恢复校验](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py#L798-L834)
- `pause()` / `resume()` 通过 RPC 调用成员钩子。暂停不会使 `run_stream()` 返回，成员没有实现钩子时可以没有任何效果；源码仍标注为实验特性。[暂停与恢复](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py#L657-L745)
- `CancellationToken` 用于立即终止运行，但 API 明确警告可能留下不一致团队状态，并且可能不重置 termination condition；不能把它等同于可无损续接的暂停。[取消契约](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_base_group_chat.py#L247-L267)

### 鲸屿应借鉴什么

稳定成员身份、成员 Session 和调度事实必须能重新关联。用户续接的是同一项工作及其成员上下文，不是重新生成一段“你上次做了什么”的提示词。

“已停止”必须来自实际运行结算，不能来自保存了 `paused=true`。暂停 admission、取消活跃执行、等待排空、重新接纳新要求，是不同的内部步骤；界面可以只提供清晰的“停止/继续”。

### 不能照搬什么

不能把循环保存所有成员状态当成鲸屿的实时 checkpoint，也不能把 `pause()` 名称当成终端进程已经停止的证据。AutoGen 的成员状态接口不替鲸屿保管本地文件、PTY、Git worktree 或活动工具进程。上述边界需要沿用并补齐 Harness 原生生命周期。

## 3. OpenHands：可复用子会话有价值，但示例委派器不等于持久团队调度器

### 已确认机制

- `DelegateExecutor` 用 `_sub_agents` 内存字典关联可读名称与 `LocalConversation`，先 spawn 再 delegate；对已有实例的再次 delegate 会发送新消息并继续运行原会话。[身份映射](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L33-L77)、[续接实现](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L326-L340)
- agent factory 提供角色配置，子代理复制父 LLM 配置并重置统计；权限策略可以从角色定义取得，也可以继承父策略。角色能力与运行会话是两个层次。[角色与权限](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L175-L244)
- 父会话有 persistence directory 时，子会话保存到其 `subagents` 目录；父会话没有持久化时，子会话同样不落盘。[子会话存储](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L204-L234)
- 子会话都使用父会话的 `workspace.working_dir`。并发委派通过线程启动，同一工具调用等待所有线程 `join()`，不是返回 durable job handle 后让主对话自由继续。[共享目录](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L165-L170)、[线程与等待](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L353-L366)
- 结果从子会话事件中提取最终响应，逐成员收集异常，并汇总返回；没有最终响应时返回相应提示。累计子代理统计使用替换而非相加，避免再次委派重复计费统计。[结果与统计](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L338-L404)

### 真正重要的提交边界

`LocalConversation` 把事件 append 放在调用方 callbacks 之前：持久化 callback 抛错时，后续发布者不会得到事件。这让可被客户端依赖的通知落后于持久化。可视化器仍可以先渲染，因此本地看到一行并不等于 durable commit。[callback 顺序](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L424-L455)

`pause()` 在 run loop 下一轮检查时生效；当前 LLM 调用可以继续到结束。`interrupt()` 先取消工具可观察的 token，再取消异步 task；同步 `run()` 没有该 task 时回落到 pause。这是执行模式相关的边界，不是统一的瞬时强杀保证。[run loop](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L1902-L1945)、[pause/interrupt](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py#L2719-L2777)

### 鲸屿应借鉴什么

成员角色与 Session 分开保存；对同一工作追加内容时找到同一成员 Session；团队累计统计应按稳定身份替换/聚合。报告先持久提交，再通知协调者和 UI。

### 不能照搬什么

- 该 executor 的名称映射在构造时为空，本文件未实现从已保存子会话重新装配映射；“子会话在磁盘上”不能证明“重启后原名称自动续接”。这是对此 executor 的限定判断，不是断言整个 SDK 没有会话恢复能力。[内存映射](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L41-L50)
- 对已有名称重新 spawn 会替换并关闭旧会话；鲸屿的增量续接不能走这个分支。[替换行为](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L246-L250)
- 共享 cwd 的并行线程没有提供工作目录写入隔离，也没有代替鲸屿的 worktree 身份与清理规则。
- 默认无 confirmation handler 时，等待确认会继续 run。不能把此示例控制流照搬成鲸屿用户授权语义。[确认循环](https://github.com/OpenHands/software-agent-sdk/blob/69e26889401fe69157fff536e6a69049e6644cb3/openhands-tools/openhands/tools/delegate/impl.py#L111-L130)

## 4. LangGraph：恢复的是已提交计算状态，外部副作用仍需自己对账

### 已确认机制

- durability 分为 `sync`、`async`、`exit`，分别表示下一步前写完、执行下一步同时写、退出时才写。持久化窗口是显式选择，不能笼统宣传为每时每刻可恢复。[类型契约](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/types.py#L97-L114)
- `put_writes()` 按 task ID 保存任务写入；恢复时 `_reapply_writes_to_succeeded_nodes()` 把成功任务输出装回，失败/中断任务保持待运行。它避免因一个并行分支失败而把已经提交的其他分支全做一遍。[写入](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/pregel/_loop.py#L439-L481)、[恢复成功分支](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/pregel/_loop.py#L797-L829)
- `interrupt()` 通过可恢复异常暂停，恢复时从节点开头重执行；同一节点多个 interrupt 的值按顺序匹配，必须有 checkpointer。这不是恢复任意机器指令位置，也不是向正在运行的工具发送取消。[实际契约](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/types.py#L893-L915)
- timeout attempt scope 把 guarded writes 与 close 放在同一把锁下，关闭后不再接收该 attempt 写入。此处保护的是 graph 写入路径，不是回滚已经完成的磁盘或网络操作。[关闭与写入屏障](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/pregel/_retry.py#L211-L235)
- 重试先清空该 attempt 的待写输出，再重新调用节点；没有 retry policy 时异常直接抛出。清空内存 writes 不会撤销节点已经执行的外部动作。[重试路径](https://github.com/langchain-ai/langgraph/blob/40a2e6d845054cc0cc17a6a169ca6e7394e5231c/libs/langgraph/langgraph/pregel/_retry.py#L600-L645)

官方文档也明确要求 interrupt 前副作用幂等，或拆成独立步骤；持久化内存 saver 在进程退出后丢失。因此“有 checkpoint”不等于“任意工具恰好执行一次”。[副作用限制](https://docs.langchain.com/oss/python/langgraph/interrupts#side-effects-called-before-interrupt-must-be-idempotent)、[持久存储选择](https://docs.langchain.com/oss/python/langgraph/persistence)

### 鲸屿应借鉴什么

Team 任务、成员 Session、执行 run、交接结果各有稳定身份。恢复只重建未完成的后续步骤，不重新执行已确认完成的工作。旧 run 的迟到结果可以保存为历史，但不能推进已经接纳新指令的当前任务状态。

需要输入的等待状态必须带上等待内容、目标工作和恢复身份；用户补充回复后继续相应步骤，不通过“解除暂停”内部开关间接控制。

### 不能照搬什么

不要为采用 checkpoint 概念再接一套 Python 图执行器。鲸屿已有 Session 事件、Team journal 和原生执行生命周期；应在其边界上解决提交/重放问题。Git commit、创建 worktree、发布 PR、文件写入不能只靠节点重试或提示词去重。未知外部结果先对账，不能一律重新执行。

## 5. 鲸屿已有基础：不是从零再造一套团队

本节是当前工作树的源码观察，不是运行验证。相关源码仍在 experimental 包，成熟度不能从接口名推出。

| 当前基础 | 已看到的实现 | Project 接合点 |
| --- | --- | --- |
| TeamService | roster、mailbox、task board、runtime lifecycle 共同组装 | 协调者使用现有 Team lead，后台工作关联真实成员与 Team task |
| TeamJournal | 每个 Lead 串行事务；append 后 flush，之后才 onCommit | 复用提交顺序，避免 Project JSON 与 Team 事件各自推进同一任务 |
| TeamMailbox | queued、目标 user-message receipt、delivered 分层；恢复待送消息 | 续接要求与报告交接复用 durable 消息身份和确认 |
| TeamTaskBoard | expectedRevision 校验与 claim；writeScopes 明确是 advisory | 任务归属/版本可复用，写目录排他不能假装已经解决 |
| TeamRuntimeLifecycle | admission cutoff 与有界 settle | 可参考生命周期边界；插件 dispose 不是产品“停止此项目”API |

源码：[服务](../../vendor/deepseek-harness/packages/experimental/agent-team/src/index.ts)、[journal](../../vendor/deepseek-harness/packages/experimental/agent-team/src/journal.ts)、[mailbox](../../vendor/deepseek-harness/packages/experimental/agent-team/src/mailbox.ts)、[任务板](../../vendor/deepseek-harness/packages/experimental/agent-team/src/task-board.ts)、[生命周期](../../vendor/deepseek-harness/packages/experimental/agent-team/src/lifecycle.ts)。

以下是研究推导出的实施要求，不声称这些要求已经被现有 API 满足。

## 6. 应落到实现里的六个机制

### 6.1 一个权威执行来源

Project 保存目录关联、主对话、资料与成果索引；Team 保存成员、协作任务与消息。Project 工作进度从 Team 和原生运行状态投影，不能再拥有一份独立的 `running/completed` 工作引擎。需要项目语义时，为 Team 任务关联 Project 标识和结果引用，不复制整张任务表。

### 6.2 稳定工作身份与执行身份分开

同一 Team task 可以有多轮 run；追加条件关联原成员 Session 和新指令 revision。首轮委托与增量续接是不同输入，结果关联 task、成员、run、所处理指令。仅用 Session ID 无法识别“上一轮迟到结果”，仅用名字无法可靠重启恢复。

### 6.3 交接提交、投递、消费分别记账

成员报告提交后形成稳定结果 ID；通知主对话使用现有 mailbox 或原生结算的唯一通路，不能两路同时唤醒。主对话接收该结果后记录消费身份。通知丢失可重新投递，消费过则不重复插入；任务结果不会因 UI 关闭而丢失。

报告声称完成、运行已结算、成果可访问是三个证据。主对话只能在这些事实兼容时说完成；报告先于结算到达时保留待结算，而非立即释放写目录。

### 6.4 先封住新工作，再取消，最后确认排空

停止入口先关闭该 Project/Team task 的新执行接纳并确定指令截止点，再请求原生取消。保存状态或生成摘要失败不应阻止发出取消；保存失败也不能假装已持久停止。实际 runs/jobs 未排空期间保持“正在停止”，目录占用不释放。

重启后先读取 Team/Session 事实与实际任务归属，无法确认结束的工作标为待核对；不能只把全部 `running` 改成 `paused` 就宣称恢复完成。恢复新工作必须重新验证目录身份和权限，不重新取得用户已有授权。

### 6.5 并行来自真实隔离，不来自多开成员

只读调查可以并行；同一真实目录中的写入须由统一 admission/lease 控制，直到对应 run 实际结算才释放。确需并行写入时绑定独立 worktree，保留源仓库、目录、分支与创建凭据。Team advisory writeScopes 可以辅助计划，但不能作为排他锁。

### 6.6 文件成果与外部副作用单独核实

结果引用明确文件来源、运行身份、验证状态和已有缺口。共享目录的当前 Git diff 不能直接冒充某个成员的成果。创建 worktree、提交或 PR 后崩溃，恢复需根据稳定身份检查已发生什么；没有足够证据时保留不确定状态，禁止自动重放可能重复的外部动作。

## 7. 能区分实现是否有效的验收场景

这些是实现完成后的验收目标，当前没有为它们搭测试或声称通过。

1. 一次请求派生两个真实 Team 成员；用户追加要求后原成员收到增量，同一项工作不生成另一套 Project worker。
2. 成员报告已落盘、主对话尚未接收时退出；重启后结果不丢、不重复消费。
3. 主对话已接收报告、消费确认尚未完成时退出；恢复不得再次产出同一条用户总结。
4. 一项写入任务停止中，后一项排队；前者工具尚未结算时后者不能获得目录写权限。
5. 用户已发新要求，旧 run 此时到达报告；历史可查，但当前任务不能被旧报告标为完成。
6. 单个成员失败，已完成兄弟分支保留；协调者说明剩余工作并只续接需要处理的部分。
7. stop 时摘要写入失败；原生取消仍发出，界面说明存储错误与实际停止状态，不给出假成功。
8. 同一目录通过别名打开，或 worktree 分支被外部改变；续接依据真实目录身份处理，不能静默写到错误目标。

## 8. 结论与未验证边界

最值得借鉴的是稳定身份、持久事件后通知、分支结果恢复、明确取消边界和防止迟到写入，而不是引入更多面板或把第三方工具名换成 Project 前缀。

鲸屿现有 Agent Teams 已有 journal、mailbox、任务 revision 和成员 Session 基础；Project 应补长期工作产品语义及运行关联，团队层补必要的目录/运行契约。是否扩展 Team 通用接口，必须由实际 Project 路径证明缺口后决定，不能把所有产品字段塞入 Team。

三套外部项目的实时行为、本地完整团队链路、真实模型输出质量、进程级取消及安装包恢复，本次均未执行验收。本报告为下一步实现提供证据与边界，不作为完成证明。
