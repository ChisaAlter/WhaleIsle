# Project 简化：DeepSeek Super-agent 一手源码参考

研究日期：2026-11-13。用途：为 Project 的产品设计和开发计划提供机制依据；下文记录调研基线，当前实施状态见[功能说明](../features/projects.md)。

## 结论：复用工作机制，不照搬整套部署

推荐以 Harness rc.2 原生 Team/Subagent 为执行底座，在 Project 中实现持续对话、任务调度和主 Agent 验收。参考 Super-agent 的工作授权、任务与执行分离、异步结果回收、结构化待处理事项和持久消息机制；不把它的 GitHub/飞书入口、管理后台和整套工单术语搬入当前界面。

官方公开项目是 [`deepseek-ai/dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype)。本次读取固定提交 **`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`**，不运行其安装或部署脚本。README 将它定义为研究原型，明确公开代码与内部实现、文章描述不完全相同，文章中的部分方向尚未实现。[S1]

当前桌面候选固定 Harness **`dsh-v0.2.2-rc.2` / `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`**，来自 `vendor/harness-upstream.json`。以下原生接口结论同时核对了本地候选源码；研究笔记不代表 Project 已按新设计改造。

## 原型已实现什么，以及对 Project 有什么用

| 机制 | 原型的实际做法 | Project 应采用的部分 |
| --- | --- | --- |
| 同一讨论承载多项工作 | 一个 Thread 可有多个 Ticket；Ticket 有自己的授权 Mandate，先后执行记录放在 Assignment 中。Ticket 的结束不跟随 Session 的忙闲。[S2] | 一个 Project 主对话可承载多个要求与任务；执行成员空闲、一次模型回复结束都不能直接显示“已验收”。沿用仓库的要求、工作、成员报告、交付术语。 |
| 主执行分工 | 主 Session 路由候选、派发、转发消息；worker 负责读取源码、判断技术方案、实现和验证。[S3][S4] | 把开发留给成员，主 Agent 保持可交互。但用户要求主 Agent 排期和验收，比原型的纯路由职责更强，需单独实现。 |
| 独立执行身份 | 每个 Ticket 有稳定的 worker Session 和执行目录；可配置准备命令创建 worktree，未配置时为空目录。[S3][S5] | 持续工作绑定真实成员会话、工作目录与执行记录，续作不得错接别的任务。目录隔离按实际冲突需要决定，不要求所有任务自动建 worktree。 |
| 有界并发 | WorkerSlots 在启动/唤醒前同步占位；运行中的 turn 及 turn 后仍工作的 jobs/subagents 持有槽位。排队等待空位；人的追问可使用一个额外槽位并优先于新任务。[S3][S5] | 派发时明确排队原因；持续聊天不能被新任务淹没。人类消息优先这一目标值得保留，但不能复制额外槽位后越过原生容量限制。 |
| 异步回收 | worker 报告、追问和后台结果自动回到主 Session；主 Session 被要求结束本轮而不是 sleep/轮询等待。[S4][S6] | 派发成功后主 Agent 可继续服务用户，结果回来再验收，不在主对话长时间等待单个成员。 |
| 结构化状态 | 阶段由 Attention、报告状态、Assignment 与输入投递事实推导；问题通过报告的结构化字段提出，不解析自由文本猜测“等用户”。[S2][S3][S7] | 卡片展示真实执行/排队/等待依赖/待处理/待验收状态，并附原因。模型的一句“完成了”只能产生报告，不能直接成为验收事实。 |
| 持久投递与恢复 | 副作用先落盘再执行；effects 保存启动、消息投递、转发等工作。重启区分已有等待/结果与中断执行，恢复提示要求先检查已有成果，避免重复外部操作。[S3][S8] | 任务、报告、验收、未送达消息在重启后可追溯。恢复策略需遵循桌面既有停止/权限约定，不能照搬原型自动恢复所有工作。 |
| 人的注意力 | 面板围绕需要人决定的事项与实际工作状态组织；通知在有可用结果或确需行动时发送。[S4][S9] | 任务栏保持小而可折叠，常规进度留在卡片；聊天中重点呈现问题、决策和交付。 |

### 不能把原型当成已完成的 Project 实现

1. **原型主 Session 没有原生 Subagent 工具。** 它的 router preset 不含 subagents；worker preset 才包含 `tool-subagent` 与控制工具。主 Session 通过自身的派工机制启动 worker。当前用户要求 Project 主 Agent 直接使用原生 Team/Subagent，必须重接派发入口。[S6]
2. **原型没有强制“主 Agent 不执行命令”。** router preset 保留 shell、只读文件和 job 工具，源码 guard 主要阻止长时间等待；不做代码调查等要求还有提示词约束。Project 的主 Agent 不参与实际工作，需要在 Project 角色工具权限中落实，而不是直接复制此 preset。[S6]
3. **原型的主 Session 不是技术验收者。** 提示词要求它不添加实施方案、不做技术决策；worker 自己实现和验证。原型中带 PR 的 `ready` 报告表现为等待人的 review，无 PR 的 `ready` 可以结束 Ticket。Project 需要单独的“成员报告 → 主 Agent 检查证据/委派复核 → 接受或退回”过程。[S3][S4][S7]
4. **原型的队列主要解决容量，不解决所有写冲突。** WorkerSlots 的输入是已运行任务和并发上限，没有任务文件范围或依赖图参数；其 worktree 准备约定也不能取代共享服务、端口、数据库等资源协调。[S5]
5. **原型的恢复、重试、无人值守权限是特定部署选择。** 它允许 worker 以操作系统用户身份无需审批执行命令，并实现特定网络/模型错误重试与重启恢复。当前 Project 必须继续遵守用户设置的权限和明确停止，不因参考原型就扩大权限或自动恢复已停止任务。[S3]
6. **GitHub/飞书订阅不是本期必要前提。** 原型的 Source、Trigger、Channel 和 Subscription 用于外部事件与回信；当前用户直接从主对话发起工作，后续接入 GitHub 时再处理外部身份、权限来源、幂等接单和回信。[S1][S2]

## rc.2 原生能力已经覆盖的部分

### Team 与 Subagent 本来就是配套关系

原生 `agentTeams` 通过 `subagents.rootOf(caller)` 找到同一 Agent 树的根，成员就是 Subagent；Team 负责共享任务板，不另建一套独立成员运行时。Team 模式保存在根 Session 的 `team/mode` 中；`setEnabled()` 更改模式不停止成员、不删除任务。`defaultEnabled` 全局默认值是 false。[H1]

因此，Project 可以对自己的主会话启用 Team，而不改变普通会话的默认设置，也不需要关闭原生 Subagent 才能使用 Project。Project 特有的是任务目标、排期、验收与展示，不是第二个成员管理系统。

### 原生任务板有依赖，但写范围只是提示

原生任务有 `pending / in_progress / completed / deleted`、稳定任务 ID、版本号、owner、`blockedBy`、`writeScopes`。任务领取与指派检查未完成依赖，更新使用 `expectedRevision` 拒绝过期修改。[H2][H3]

`taskReady()` 只检查依赖是否完成；`writeScopeWarnings` 比较进行中任务的路径前缀并给出提示，**不会阻止两个写范围重叠的任务同时运行**。它也不是对真实文件访问的强制锁。[H3]

Project 应优先复用这些任务身份和依赖事实；若需要确保共享写区不重叠，必须在 Project 的派发/准入处落实资源占用规则，不能把 warnings 解释为已经串行化，也不能把“同仓库”一概当成冲突。

### Subagent 提供执行、续接和结果，不提供业务队列

原生 Subagent 具有 provider 注册、Activation、持久子会话目录、父子/根身份检查、消息、停止及结果返回。local spawn/fork 子会话可续接，部分外部 provider 只支持一次运行。子会话可以保存自己的 cwd，冷恢复使用保存的 preset 与权限策略。[H4]

`maxActiveSubagents` 以根树计数，默认 8；容量满时返回 `ACTIVATION_LIMIT_REACHED`，不在该层排队。Project 需要把暂未派发工作保持为排队，等实际容量释放后再接纳；停止中的 Activation 尚未清理时不能提前把容量当成已释放。[H4]

## 调研基线中的 Project 改造缺口

以下是实施前根据用户目标及已查接口得到的开发任务，不是上游已实现的功能。独立开发分支现已替换 Project 对 experimental Team 的执行消费，接入原生 Team/Subagent；此处保留原问题及研究依据，不描述当前候选状态：

- **解除旧耦合。** 调研基线的 `vendor/dsh-project/package.json` 仍依赖 experimental Team，`src/main/dsh-project-desktop.js` 装配其 UI；`packages/experimental/agent-team-profile/cordis.patch.yml` 明确禁用原生 Subagent/Team 重叠工具。改造应替换 Project 对旧模型的消费，不能继续用关闭原生入口换兼容。
- **限定 Project 角色。** 主 Agent 保留对话、任务分发、排期、读成果和验收能力；移除实际开发/任意命令执行入口。工作成员继续按原生 preset、用户权限与工具能力执行，不能把主 Agent 的禁写规则施加到全体成员。
- **接纳多个要求。** 取消“一个 Project 只有一个完整要求在执行”的旧产品限制；独立要求可同时推进，真正相关的修订接回原工作，而不是把每句话都建新任务。
- **加入实际调度。** 主 Agent 判断依赖和并行机会，Host 检查已声明的任务身份、容量、授权和资源占用；未接纳不应显示运行中。共享写区、同一服务等冲突有具体原因，停止/取消只作用于目标工作及其必要后代。
- **报告与验收分离。** 报告保存原执行身份、产物位置、验证和遗留问题；主 Agent 可以读取并委派验证，接受或退回。有完成报告不等于卡片已交付；依赖应按需要的成果/验收条件释放，不能只看成员是否 idle。
- **普通对话页与任务栏复用现有载体。** 原型管理后台不是目标 UI。右侧悬浮任务栏折叠后，主聊天和输入仍完整可用；卡片详情引用原生任务/会话与 Project 验收事实，避免维护另一份可漂移的成员状态。
- **数据迁移与恢复单独设计。** 保留原主会话、历史任务、成员报告、文件和草稿；旧记录缺少新字段时呈现真实历史状态，不伪造验收或重新启动旧工作。

## 实施时优先验证的五个问题

1. 两个无依赖任务能否各自启动，同时主对话接收第三条用户消息？
2. 相同写区/共享服务发生真实冲突时，是否只排队受影响任务，独立调查仍可继续？
3. 成员报告完成后，主 Agent 是否能检查证据并退回修改，而不是立即把卡片标为交付？
4. 取消一个任务、重启或成员异常后，任务身份、报告和未送达消息能否正确对应，且不复活明确停止的工作？
5. 原生 Team/Subagent 在 Project 中是否仍可用，普通会话的默认模式和工具权限是否保持原样？

这些应成为后续实现的行为验收，不在文档阶段预报测试通过。

## 固定源码索引

### Super-agent prototype：`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`

- [S1 · README：研究原型与部署范围](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/README.md)
- [S2 · docs/001-domain.md：任务、授权、执行与订阅](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/001-domain.md)
- [S3 · docs/003-execution.md：并发、目录、结果与恢复](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/003-execution.md)
- [S4 · docs/004-prompts.md：角色、沟通与交付原则](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/004-prompts.md)
- [S5 · src/executor/dsh.ts：WorkerSlots 与执行器](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L165-L235)
- [S6 · cordis.patch.yml：router/worker preset](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/cordis.patch.yml)；[src/app/sessions.ts：工具集合、消息和等待 guard](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/sessions.ts)
- [S7 · src/core/assignments.ts：报告和 Attention](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts)；[src/core/stage.ts：状态派生](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/stage.ts)
- [S8 · docs/007-architecture.md：持久化、Effects、角色和接口](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/007-architecture.md)
- [S9 · docs/005-panel.md：面板的信息层次](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/005-panel.md)

### Harness rc.2：`ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`

- [H1 · agent-team/src/index.ts：根树、模式与任务服务](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/team/agent-team/src/index.ts)
- [H2 · agent-team/src/types.ts：任务、投影与更新契约](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/team/agent-team/src/types.ts)
- [H3 · agent-team/src/task-view.ts：依赖与警告派生](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/team/agent-team/src/task-view.ts)；[task-board.ts：领取、指派与版本检查](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/team/agent-team/src/task-board.ts)
- [H4 · subagent/README.md：Activation、容量、目录和恢复](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/subagent/subagent/README.md)；[src/index.ts：执行入口与身份检查](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/subagent/subagent/src/index.ts)
