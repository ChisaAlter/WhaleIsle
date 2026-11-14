# Local Projects

完整原生对话，加默认收起的右侧悬浮任务栏。Super Agent 负责理解、排期、分发、协调、验收和交付；原生 Team/Subagent 成员执行工作。[产品行为与证据](../../docs/features/projects.md) · [设计](../../docs/superpowers/specs/2026-11-13-project-superagent-redesign.md)。

## Runtime

插件消费 `ctx.agentTeams` 和原生持续 Subagent，只为 Project 主会话启用 Team。普通会话的工具、UI、默认值和用户 patch 不变；可选实验 Team 独立共存，不是 Project 的运行后端。

原生 spawn/fork 在启动前发出 `subagent/delegate`。Project 接纳调用，登记唯一授权工作，返回 activation/queued 身份；undefined 保持普通原生路径。原生 task ID 与 Project work ID 持久映射。修订复用原 workstream 与 Session。嵌套委派保留真实直接父会话、有效授权和文档路径，停止父工作覆盖登记后代。

主 Agent 预设只允许要求、调度、原生协作、验收和有界证据读取，没有实现、命令和无界写入工具。工作执行核对当前已消费委派、用户版本、范围、目录和停止状态；有未完成子任务的父成员不能越过它们写入或完成报告。原生审批继续生效。

## Scheduling and lifecycle

多个已接受目标同时活跃。模型决定分工与依赖；Host 检查精确授权、已验收前置结果、目录冲突和原生容量。只读不占目录；文档只预留精确路径；开发占重叠目录。准备目录后再次核对前置依据才创建成员。

原生任务 completed 不等于成果已验收。`project_review` 带证据接受或退回精确报告。持久化的 completed 交付也是最终验收；partial 或失败草稿不是。task board 容量含 completed 历史，与 activation 容量分开；停止/完成不删除历史腾位置。

输入框停止只取消当前主回合。单项停止覆盖登记后代；全停排空 Project 并挂起每个未完成目标。继续只恢复所选目标。恢复保留身份，不执行旧模型任务；用户可只汇总停止成果。

## Results and UI

复用完整原生聊天和输入框。Tasks 展开实际聊天列内的 312px 悬浮栏，宽列预留空间，窄列覆盖但避开实测输入框。折叠保留展开/滚动状态，不停止任务；已打开卡完成后不跳走，显式重开/分组刷新位置。列表真实分页。

任务卡提供实际工作及等待原因、原生成员对话、单项停止、目标取消/继续、目标/约束/条件/版本、交付证据/文件/页面、原始报告、变更和安全还原。已完成卡保留归档/恢复。资料含笔记、规则、偏好、研究网站、保存文档和报告历史。文件沿用原生预览和权限，保留资料草稿；汇总恢复发送普通用户消息，不替换草稿。

交付在工具成功、同回合可见最终回复、成功回合结束及持久化后提交。完整交付需检查证据和空 remainingIssues；部分交付保留未完成条件。旧报告和来源身份不改写。

## RPCs and checks

认证 `/dsh-project`：`list`, `create`, `detail`, `requests/list`, `requests/get`, `requests/queue`, `requests/attention`, `requests/archive`, `requests/restore`, `requests/changes`, `requests/revert`, `workstreams/list`, `workstreams/get`, `rename`, `stop`, `pause`, `resume`, `archive`, `restore`, `store/list`, `store/results`, `store/read`, `store/write`, `open`, `diff`。项目归档和卡片归档不同；委派、报告、验收、交付是角色工具，不是公共派单 API。

从桌面根目录运行 `node --test vendor/dsh-project/tests/*.test.mjs`，或选受影响 Host 场景。客户端：`node --test src/main/dsh-project-client.test.js src/main/dsh-project-desktop.test.js`。原生接点使用 Harness tool-subagent Vitest 套件。源码、脚本模型、实际 UI、真实模型和安装包证据分开记录在功能说明。本分支不增加版本，不代表发布或合入授权。
