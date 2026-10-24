# Feature: 自定义指令（每次请求随系统提示词发送）

| Field | Value |
| --- | --- |
| **id** | `custom-instructions` |
| **status** | `active` |
| **last verified** | 2026-09-16 — 首验通过：694 项 ui-conversation 测试 + host/client typecheck 通过；真实 Electron + 真实模型两轮请求，session 日志确认 system prompt 末尾含指令原文（`{{tone}}` 字面保留），模型两轮均以 `{{tone}} FOX` 结尾；settings.yaml 持久化确认 |

## User paths

1. 设置 → 通用：「自定义指令」块（标题 + 说明 + 多行文本框 + 右下角 `n / 1500` 字数计）。文本即写即存（去抖写入 `ui-conversation.customInstructions`），空文本等于未配置。
2. 已配置的文本作为系统提示词最后一个 section（`ui:custom-instructions`）随每次模型请求发送；运行中的会话在下一步即采用新值（`SystemPromptProjection` 对文本变化追加/替换 system 节点）。
3. 文本经 prompt 变量 `{{custom_instructions}}` 替入而非原样进 section，用户文本中的 `{{x}}` 不被二次扫描。

## Invariants

- 字段 `ui-conversation.customInstructions`：`z.string().max(1500)`，默认 `''`；`applies: live`（每次 `systemPrompt.assemble` 现读 `settings.get`）。
- 空白（含纯空格）文本不产生 prompt 内容；非空文本前有一行说明性引导句。
- 仅注册全局层 section/variable：对所有 scope（含子智能体）生效，除非该 scope 存在 `complete` section 或同名 shadow。
- 设置在「对话」分区以 `settings.conversation.item` 块行注册（id `custom-instructions`），不新增独立 section 页、不新增窗口。
- 文本框样式只用 `--dsw-alias-*` 令牌；文案经 `conversation` locale 命名空间（zh/en 双语键齐全）。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/`（submission-settings、host apply、submission-policy、settings/CustomInstructionsRow、locales、client apply、相关测试、README 双语段）
- `vendor/deepseek-harness/packages/core/system-prompt/src/index.ts`（SECTION_ORDERS 新增 `USER_INSTRUCTIONS` 一行）
- 本卡 `docs/features/custom-instructions.md`

## Do not touch

- `agent-instructions`（AGENTS.md 工作区指令）与 persona prefix/suffix 语义；本功能是用户设置项，不是工作区文件，不是部署人设。
- 其他 settings.conversation.item 条目的 id/order；系统提示词其他 section 的内容与排序。
- 桌面覆盖层与 `cordis.patch.yml`（本功能不新增插件行）。

## Gates

| Kind | What |
| --- | --- |
| Automated | `vendor/deepseek-harness`：ui-conversation `pnpm exec vitest run`（host / submission-policy / custom-instructions-row / apply-wiring）；`pnpm run typecheck` |
| Manual / QA | 设置 → 通用 编辑文本 → 新会话下一步请求的 system 消息含文本；清空后请求不再携带；`{{x}}` 文本不炸请求 |

## Sources

- Decision: none

- Implementation entry：`ui-conversation/src/submission-settings.ts`（字段与上限）、`ui-conversation/src/index.ts`（section/variable 注册）、`ui-conversation/src/client/settings/CustomInstructionsRow.tsx`（设置块）
- 参考截图：设置卡片形态（标题 + 说明 + textarea + `n / 1500` 计数）
