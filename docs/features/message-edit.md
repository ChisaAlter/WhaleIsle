# Feature: 最新用户消息「撤回重编辑」（当前会话重发）

| Field | Value |
| --- | --- |
| **id** | `message-edit` |
| **status** | `active` |
| **last verified** | 2026-09-19 — 同步 `dsh-v0.1.5-rc.1` 后保留同会话编辑语义并修复一处合并引入的静默失败：surface replace op 随上游改 `startSeq/endSeq`、busy guard 改 `inbox.nextTurn/nextStep`；rc.1 把系统提示词移上表面节点 0 且受保护（仅 system/message 单节点事件可改写），编辑走影回溯曾把节点 0 卷入替换范围导致 turn 静默中止 → 回溯遇 `system/message` 即停。message-edit.host.spec 6/6（含身份行容忍断言）、official build、Desktop tests 全过。此前 2026-09-07 — 同步 `dsh-v0.1.3-alpha.1` 并迁移 Session v2 嵌入式 assistant stream 后，当前会话重发语义保留；Host / Client build、含 ui-message-edit、ui-chat 与 ui-conversation 的重点 Client 101 文件 / 1279 项、Desktop tests 1425 passed / 2 skipped。此前 2026-09-06 的 keyless edit e2e 证据仍有效，本次未重跑。 |

## User paths

1. 会话空闲时，最新一条用户消息的操作条出现铅笔（历史消息没有）；点击**不 fork**，而是把**底部常驻 composer** 晋升为编辑会话：composer 收起当前草稿与图片、播种原文、聚焦且光标在末尾、卡片上出现「正在重新编辑此消息」横幅（带取消）；该气泡就地换成编辑态标记（原文变暗 +「正在下方输入框中重新编辑」+ 取消）。
2. 编辑面就是真 composer：装饰／引用、图片附件、词表、Enter/Shift+Enter/IME 策略、提示通道、尺寸调整全部原生可用。编辑期间斜杠不触发命令裁决（修订就是普通消息），命令认领被拒绝，草稿持久化镜像被抑制。
3. 取消有方向：composer 横幅取消或 IME 安全的 Escape 结束会话、焦点留在 composer；气泡侧取消结束会话并把焦点交还铅笔。两侧都恢复收起的草稿与图片。
4. composer 发送即确认：Client 与 Host 复查「仍是最新 + 当前会话空闲」，通过后在同一 Session ID 内提交修订；首条及后续消息走同一路径，侧栏不新增、不切换会话。模型上下文替换被编辑轮次，聊天隐藏该轮旧问答、错误、重试、进度及工具信息，同时关闭属于该轮的额度通知；更早轮次及其他会话的通知保持不变。刷新或加载历史后也不恢复被替换轮次的内容。
5. 发送失败／当前作用域缺失／守卫不再成立：composer 出本地化错误提示，编辑会话带草稿继续待命，可重试或取消。
6. 会话运行中或消息含非文本块：铅笔可见但禁用，tooltip 说明原因。

## Invariants

- 铅笔只出现在**最新**已定稿用户消息上；点击铅笔不产生任何 Host 写入，确认编辑不调用 fork。
- 编辑面必须是 `conversation.composer.bar` 路径上的真 composer（`SessionInput.beginEdit` 编辑会话）；**禁止**在气泡里再造第二个简化编辑器。
- Session ID、工作区及模型选择不因编辑改变；编辑不主动重命名或增加分支标题后缀。原始日志保持追加式，修订使用既有 surface replacement；旧提示词与其回答不进入后续模型上下文，刷新后聊天仍显示修订结果。旧轮次已执行的工具副作用不回滚。
- 从 Session scope 获取 conversation 使用 `scope.get('conversation')`，不得直接读取该作用域未声明 inject 的属性；测试替身须保留此限制。
- 失败路径不丢草稿、不留 pending 锁死；「仅限最新 + 空闲」在确认时刻仍然成立（stale/running 守卫）。「最新」与铅笔一致：指最后一条**开启轮次**的用户消息；同轮内后到的插件注入上下文与 steering 不构成「更新的消息」。
- 编辑会话的开始／结束必须到达订阅者（composer 横幅、编辑态气泡），不得依赖草稿文本恰好发生变化。
- 编辑会话存续期间：submit 改道到编辑汇、斜杠裁决跳过、命令认领拒绝、持久化镜像抑制；结束（成功或取消）恢复收起的草稿与图片。
- 底部 composer 不经 `conversation.blocks` 禁用；一切 UI 仅官方 tokens（`--dsw-alias-*`／`--dsw-specific-*`）。
- 文案中英齐备（`messageEdit` 命名空间 + ui-conversation 的 `input.editCancel`）；产品文案中文、代码注释英文。

## Allowed touch

2026-09-06 用户确认扩权：编辑始终保留当前会话。允许以下必要跨层修改，不涉及无关会话功能。

- `vendor/deepseek-harness/packages/api/session-controller/` — 编辑发送准入、Client prompt 参数、Host 校验与测试
- `vendor/deepseek-harness/packages/core/agent/`、`vendor/deepseek-harness/packages/core/agent-loop/` — pre-step 的逐消息 surface intent 与测试
- `vendor/deepseek-harness/packages/client/ui-chat/` — 修订消息投影、旧轮次隐藏与测试
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/service.ts` 与 `contract/` — 编辑发送沿用图片准入与草稿生命周期
- 以上模块的 README、架构参考、生成的 Remote 类型及编辑 e2e fixtures — 契约同步

- `vendor/deepseek-harness/packages/client/ui-message-edit/` — 插件本体（铅笔、编辑态气泡、store、文案、样式、测试）
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/`（contract/facade 的编辑会话）、`skeleton/InputBar.tsx|.module.css`（编辑横幅）、`locales.ts`、`src/client/index.ts` 导出与相应测试
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/chat/` 消息气泡组件 与 `contract/slots.ts` 中 `user-actions`/`user-editor` 座位 — 仅在座位契约确需扩展时（原 `MessageItem.tsx` 已在上游拆分为更细的气泡组件，不再有单一入口文件）
- `vendor/deepseek-harness/apps/web/tests/message-edit.e2e.ts` 与其 aria 预期
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-inline-user-message-edit*`、`2026-08-25-message-edit-production-polish*`、`2026-08-25-message-edit-composer-edit-session*` — 事实保鲜

## Do not touch

- 不物理改写或删除已定稿事件；不改会话日志格式。
- 不改独立 fork 操作的语义；编辑不再走 fork。
- 不回退到气泡内 textarea／独立编辑器（产品明令否决）。
- 历史消息编辑、多模态（图片入口）编辑、trajectory/waterfall 视图 — 除非用户明确扩权。
- `MessageIconActions` 内不得出现编辑存根（已被 2026-07-31 简化记录移除）。

## Gates

| Kind | What |
| --- | --- |
| Automated | `pnpm vitest run packages/client/ui-message-edit`；Host `message-edit.host.spec.ts`、Chat `conversation-node-definitions.client.spec.ts`、composer `input-edit-session.client.spec.ts` / `service-orchestration.client.spec.ts` / `input-bar.client.spec.tsx`；`pnpm run test:gui`；`pnpm run build:official` 后 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/message-edit.e2e.ts`（首条及后续消息同会话重发、连续编辑、两侧取消、草稿恢复、刷新、原日志保留）；CI 保持 `test:coverage` per-file 100% 门槛 |
| Manual / QA | 首条及后续消息→等空闲→点铅笔→composer 回填→改字→发送：同一会话继续、侧栏数量不变、旧轮问答隐藏、刷新仍显示新结果；Escape/横幅取消恢复原气泡且草稿复原；运行中铅笔禁用 |

本次附加检查未全绿：Oxlint 类型感知检查对 `ui-message-edit` 的 `ctx.sessions` 报 `error typed`，独立 TypeScript 检查通过；`verify-type-equiv` 的阻断为未改动的 `docs/subsystems/llm-streaming.md` 中 `GenerateOptions.purpose` 与源码不一致。本次未运行全量覆盖率和 CI 安装包实机验收，未生成新安装包。

## Sources

- Decision: none

- Agent Note: [2026-08-25-message-edit-composer-edit-session](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-message-edit-composer-edit-session.md)（现行）、[2026-08-15-inline-user-message-edit](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-inline-user-message-edit.md)、[2026-08-25-message-edit-production-polish](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-message-edit-production-polish.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-message-edit/src/client/` 与 `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/`
- Package README: [ui-message-edit README](../../vendor/deepseek-harness/packages/client/ui-message-edit/README.md)
