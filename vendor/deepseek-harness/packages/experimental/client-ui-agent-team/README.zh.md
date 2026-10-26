---
description: "使用并排查实验性 Web Agent Teams roster、共享任务板与 teammate 导航面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team

[English](README.md) | 中文

## 概述

本包向 Web 会话页头添加 Agent Teams action，并在右侧 Sidebar 提供同一个 Team 页面，让用户检查当前 roster、查看共享任务板并导航到 teammate 会话。它从共享 Session store 读取 Lead Session 的 `agentTeam` 投影，Host 投影 frame 使其保持最新而无需刷新控件，并让普通 child history 导航继续使用稳定的 addressed-subagent 路径。通过公开发布的实验性 Agent Teams bundle 选择本包。这个浏览器 projection 不扩展稳定 API Proxy、不存储 Team 状态，也不注册面向模型的输入。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.zh.md) 启用本包。这个组合包同时提供团队服务、工具与 Web 界面。Web Client loader 挂载 `/client` export；root Host export 不执行行为，本包也没有用户配置字段。

### 检查并导航 roster

面板从共享 Session store 展示 Lead Session 的 roster 与任务板。面板保持打开时，任务和成员更新会直接出现。打开面板不发起投影请求。会话或 Session 列表正在加载时，面板显示加载提示；加载结束后仍无 Team 值时，显示不可用提示。

Roster 行展示持久名称与阶段。provisioning 和 running 成员使用共享 ongoing loading，inactive 成员使用人物图标，failed 成员使用 error 红点。实时 Session 状态提供运行活动；共享 `modelSelection` 投影在可用时提供模型。Inactive 仅表示没有回合正在运行，不表示所负责的工作已完成。当前会话带有“当前会话”标签且不可选择。在 teammate 会话中选择 Lead 会直接打开 Lead Session。选择 active teammate 会打开其普通 continuable 子会话地址。Host 在打开历史时校验 parent、child 与 mode；后续人类提示词使用同一 addressed-subagent 会话。

Project 会话使用固定宽度的团队入口，运行人数始终占有固定槽位。人数按真实 roster 成员去重，合并正在运行的回合与所有者确认仍在运行或停止中的后台命令，排除协调者。视觉计数最多显示 `99+`，可访问名称保留准确人数。活动加载中、不可用或 Team 记录被拒绝时显示 `?`。Project 入口只在点击时打开浮层；悬停显示简短 Tooltip，移开指针不会关闭浮层。关闭按钮、点击外部或 Escape 可关闭。

### 让 Team 留在会话旁

组合了右侧 Sidebar 时，本包注册 `agent-team` 页面类型（`TEAM_SIDEBAR_KIND`）。页面渲染与页头面板相同的 roster 和任务板，成员在窄列中单列排列。Project 浮层中的“持续观察”显式打开这一原生 Sidebar 页面；“回到浮层”关闭当前 Team 标签并重新打开页头浮层。从停靠的观察页返回时，若当前 Session 的展开 Sidebar 只剩引导标签，则收起该侧栏；仍有其他内容标签或从浮动观察页返回时，保持原布局。两种展示共享 Project 的范围选择、历史搜索、分页、任务描述展开状态与阅读位置。关闭 Project 浮层时保留其隐藏内容树。注册页面和活动更新均不自动打开 Sidebar。浮层与 Sidebar 都将长内容限制在各自的内部滚动区。

在 Sidebar 中选择 teammate 会以 `subagentchat` Sidebar 标签在 Team 页面所在窗格中打开其 addressed 会话，使 Lead 会话保持可见、Team 只隔一个标签；选择 Lead 则打开 Lead Session。打开失败使用共享 Toast 浮层。淡出后，原成员按钮保留错误描边，并在 Tooltip 和 title 中保留原因；再次点击该按钮重试，仅在成功打开后清除标记。标记不改变按钮布局。其他插件可通过 `sidebarRight.openTabIn(sessionId, TEAM_SIDEBAR_KIND)` 为某个 Session 打开该页面。

### 按所有者的当前工作限定当前视图

本包提供 `ctx.agentTeamScopes`。会话所有者调用 `set(leadSessionId, taskIds)` 传入其当前工作的任务 id（最相关的在前），调用 `set(leadSessionId, undefined)` 清除。在 Project Lead 中，页头面板与 Sidebar 页面的当前视图随后只列出这些任务、运行中的成员及其负责人，较早或已取消工作的成员与未关闭任务保留在全部记录中。没有 scope 时，当前视图保持原有的运行中工作规则。

同一服务通过 `activitySource` 与 `setActivity(leadSessionId, facts)` 独立提供后台命令活动，不改变原有 `source` 与任务范围。`facts` 包含 `state`（`ready`、`loading` 或 `unavailable`）及 `runningJobSessionIds`，后者是拥有运行中或停止中后台命令的 Session id。所有者从权威活动读取发布这些 JSON 数据，读取不可用时保留上次确认的 id；`undefined` 清除该项。页头和 Sidebar 通过注入的 `useTeamActivity` 读取。已确认的 Job 在成员回合结束后仍使其保持可见并显示运行中；失败成员保留失败阶段，并单独显示仍在运行的命令。未确认数据在详情标记为上次确认记录，入口不将其显示为已确认人数。此服务不存储持久的 Team 或 Project 业务状态。

### 查看任务板

可开始的 pending 任务使用 idle 灰点，被依赖阻塞的 pending 任务使用 warning 橙点，in-progress 任务使用 ongoing loading，completed 任务使用 done 绿点。

只读任务板展示任务标识、负责人、依赖、就绪状态、提示性写入范围与重叠警告。超过两行的描述提供展开按钮。分区标题显示成员与任务数量；空任务板显示简短描述，只有一名成员且无任务时采用单列面板。Team agent 通过工具创建和更新任务；面板不提供任务修改控件。当投影报告某条持久 Team 记录被拒绝时，面板在最后有效的 roster 与任务上方显示该失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Client export 通过 Cordis effect 注册 locale dictionary 与一个 conversation-header slot，并在存在 `sidebarRight` 与 `sidebarRightTabs` 时注册 Sidebar 页面类型与页面 body；它不挂载任何 Remote namespace。Dispose plugin fiber 会移除全部 registration。

面板渲染在会话容器外，并保持在视口范围内。成员卡片在静止、选中和悬停状态下均使用共享 elevation 描边绘制轮廓。普通会话中，悬停触发按钮 150ms 后打开面板；指针离开触发按钮和面板后，经过 120ms 宽限关闭。点击会固定该浮层并移入焦点。页头较窄时，普通入口折叠为图标，只响应点击打开。Project 入口在窄宽度仍保留人数，并始终要求点击。

组件从 `useSessions`、`useSessionStatus` 与 `useSession` 座位派生每一行：Lead 身份来自当前 Session 的 subagent address，Team 视图来自 `projectionsBySession[lead].values.agentTeam`，成员活动来自 Session 状态并以列表摘要为后备，model 来自 `projectionsBySession[member].values.modelSelection.next`。明确的实时未运行状态优先于旧的运行中摘要。每个 roster 行只选择自己的运行状态。窄范围的注入回调打开 roster Session 或原生 Team Sidebar。两种 Project 展示由共享的 Session 级视图 store 连接。切换会话关闭浮层、清除导航失败，保留该会话的视图选择。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | locale、导航与 slot registration |
| [`src/client/TeamAction.tsx`](src/client/TeamAction.tsx) | `TeamBody`：由投影派生的 roster 与任务板；`TeamAction`：包裹它的页头弹出面板 |
| [`src/client/TeamSidebar.tsx`](src/client/TeamSidebar.tsx) | 包裹 `TeamBody` 的 Sidebar 页面，使用 Toast 显示导航失败并提供回到浮层操作 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文 panel 文案 |
| [`src/index.ts`](src/index.ts) | 不执行行为的 Host entry |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Teams bundle](../agent-team-profile/README.zh.md)——挂载本 Client plugin 的公开 opt-in bundle。
- [Agent Teams service](../agent-team/README.zh.md)——权威 roster、task 与投影行为。
- [会话 UI](../../client/ui-conversation/README.zh.md)——稳定 header slot 与 addressed-subagent 导航表层。
- [实验性包](../README.zh.md)——孵化状态与发布规则。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响，因为该浏览器 projection 不注册面向模型的输入。

#### KV Cache 影响

无直接影响；Team 工具与普通会话提交负责后续任何模型可见用途。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有 mailbox timeline**——投影视图只承载 roster 与任务；不显示 peer 消息。
- **晚启用插件** — 在已经打开的会话中启用 Agent Teams 后，需要刷新页面才能接收其 Team 投影。
- **模型可用性** — 仅当共享 store 包含该成员的持久选择或请求时才显示模型。冷缓存中缺少的值会保持缺失，直到正常 Session 加载或实时更新提供它们。
- **普通 child continuation**——导航后发送的人类消息使用稳定 addressed-subagent 提示词路径，而不是 Team peer mailbox。
- **没有 lifecycle 或 workspace control**——panel 不能 spawn、rename、delete 或 interrupt teammate，write scope 仍只是提示性 metadata。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
