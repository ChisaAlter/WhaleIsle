# 鲸鱼娘个人助理

鲸鱼娘在桌面、桌宠和默认 IM 共用唯一常驻对话、人格与文件记忆。后台资料整理由同一插件的 `whaleTasks` 服务管理，不新建长期助理或独立进程。

## 后台资料整理

在设置 → 鲸鱼娘 → 聊天与能力 → 后台资料任务，填写目标和每行一个绝对文本文件路径，点击“开始只读整理”。也可在她的主窗或桌宠聊天明确发送：

```text
/task {"goal":"整理重点并列出来源","files":["C:\\资料\\notes.txt"]}
```

聊天入口提供 `whale_task_start/list/status/stop/resume`；范围直接从本轮 `/task` 原消息解析，模型不能添加其他文件。status/stop/resume 校验本轮真实用户指定的任务编号和对应动作；停止指令不能授权继续，同一来源不能更换动作，过期回合或旧任务版本不能解除 hold，控制指令不能改模型或资料。桌面按钮和飞书命令由可信入口生成动作授权。面板可刷新、看结果、停止和明确继续；长内容在弹窗内部滚动，标题/关闭留在滚动区外，任务动作位于结果之前，完整正文保留。普通聊天、观察、定时或任务结束事件不能创建新授权。

资料仅限 UTF-8 文本（txt/md/mdx/csv/json/log/rst），最多八个、单文件 100KB、总量 300KB。禁止链接重定向、鲸屿家目录、凭据/配置和完整 MEMORY。接纳时保存准确内容/hash；Worker 之后只读此快照，不重开原路径。文件写回和外发附件不在首期范围。

同一时刻最多一个任务。`whale-task-reader` 是隐藏执行预设，只有 `task_read_input`、`task_search_inputs`、`task_report`，没有 shell、文件系统、网络、插件、跨会话和记忆工具。发布前宿主安装模型、读取与工具限制；重新打开历史执行会话只用于查看，host guard 拒绝其启动模型/工具，继续必须从任务面板建立新执行代次。工具 guard 在执行端拒绝越权，不只隐藏目录。

首次模型/步骤请求最多 12 次，单请求输出 cap 2048、累计读取量 500KB、时限五分钟。底层模型适配器内部重试不等于新步骤；这些限制不是严格金额预算，也不能保证在途 provider 调用收到取消后立即停费。

## 飞书后台回传

首期参考适配器为飞书，未假定用户已配置它。桌面后台任务面板中明确填写飞书 `botId` 和个人 `open_id` 后授权；`*` 不能授权任务。可在同处撤销。现有渠道聊天 allowlist 不自动授予个人资料任务权限。

将文本文件发给机器人，**回复自己在同一会话发送的该文件消息**，写：

```text
/task {"goal":"概括这份资料","files":["notes.txt"]}
```

也接受平台交付的含文件块的富文本 `/task`。引用资料必须是同一个 actor 在原 chat 的文件。前台马上回任务编号与“已接纳”，执行结束才另行发送固定模板的摘要；没有复制主会话历史或 MEMORY 到自动摘要。仅文字回传，不发送文件。管理命令：

```text
/task {"action":"status","taskId":"task-..."}
/task {"action":"stop","taskId":"task-..."}
/task {"action":"resume","taskId":"task-..."}
```

目的地保存为原 bot 账号代次、actor、chatId、messageId；首期回原 chat，不声称飞书子线程回传。status/stop/resume 都重查个人授权、开关、预设、原 chat 与账号代次，拒绝后不交普通模型代读任务。status 结果通过受控 sender 返回。异步路线检查结束后及 SDK 调用前再次核对 Task 版本/hold、owner 授权代次和当前账号/开关/预设，撤权先关闭新的发送准入，失效不换收件人；已被 provider 接纳的在途请求无法撤回，仍如实保存回执。临时明确未发错误有界退避；投递后失去回执或应用在 sending 时退出会保留 unknown，不盲重发。平台 receipt 与用户已读不同。其他八种聊天 IM 的原有前台问答保留，尚无统一后台 Task adapter。

## 持久状态与停止

`whale_tasks` storage-domain 存 Task 聚合、可信入站来源和 owner 授权。Execution、Result 与各目标 Delivery 嵌入单 Task，一次更新提交结果和 outbox，不依赖跨表事务。Session 日志保存真实执行记录和 notice；不会伪造 assistant 消息或 turn。

accepted、turn/end、目标完成、发送成功和已读分开。完成须有结构化报告、实际正常终态、所有指定输入的读取与引用、无未满足条件。否则显示 failed/needs_user；语义结论仍需用户复核。主会话和 IM 各自有回执。

停止先建立内存 hold 并保存版本/代次，取消后等执行和投递真正结束，stopping 仍占并发。迟到结果不改回成功，不启动后继任务。应用关闭时停止自有执行；重启只对账，未完成任务变 interrupted 等用户继续，不自动运行或靠 Watchdog 复活。发送中的结果变 unknown。已持久完成结果可在原授权有效时恢复未发 effect。

任务创建通过 `desktopTaskAdmission` 与退出/更新锁对齐；inspection 包括任务状态。坏数据或依赖缺失使后台服务不可用、保留现场，原有聊天仍可使用。

## IM 共享绑定

九种聊天 IM 缺省仍优先进入 resident whale；有效人工绑定保留并优先。自动绑定记录 `whale-auto/auto` 来源及当时预设。关闭 IM/助理或改非 whale 预设后，旧自动绑定只在该聊天下失效，不删除历史。无来源的旧 resident whale 绑定在共享关闭时拒绝继续，要求 `/new` 或明确 `/session`；不猜测删除全表。人工绑定 whale 在关闭时也拒绝执行但保留映射。共享 id 失效不另建鲸鱼娘。显式其他预设、已核实的人工非 whale 绑定先判定，不依赖鲸鱼娘/桌面设置文件；相关 whale/default 路径遇坏设置明确失败，不能静默放行。`--default` 恢复缺省选择，`/new` 在共享有效时继续同一常驻身份。

## 验证入口与边界

```text
node --test src/main/dsh-whale-tasks.test.js src/main/dsh-whale-task-composition.test.js
node --test vendor/dsh-im/whale-routing-policy.test.mjs vendor/dsh-im/feishu-whale-tasks.test.mjs
```

真实 Loader 测试使用本仓库原生 storage/Session/Agent/tools，仅脚本化模型和假渠道，无外部发送。它不证明真实模型语义质量、真实飞书文件与投递或安装包界面。生产改动需重建 dsh-im 的 host lib，再在获指定测试对话时验真实平台；不向最近 sender 猜测发送。
