# Feature: 居中的会话统计与官方峰谷时状态行

| Field | Value |
| --- | --- |
| **id** | `composer-stats-peak-valley` |
| **status** | `active` |
| **last verified** | 2026-09-29 — 三开关并发修复：144 项定向测试、正式构建通过；实机全部 8 组合 / 24 次连续交错切换无回跳，保存重载一致（[连续切换](../qa/results/2026-09-29-session-stats/three-switch-stress.json)、[重载](../qa/results/2026-09-29-session-stats/three-switch-reload.json)）。此前同日即时开关修复：109 项定向测试通过，正式构建（含类型检查）通过；桌面重启后关闭 9ms / 开启 13ms，重新加载分别保留关闭 / 开启状态（[实机结果](../qa/results/2026-09-29-session-stats/result.json)）。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：峰谷 dock/settings 行与注入保持（chat-apply host spec 4/4，其 bench 需按 rc.1 keyed `'main'` 槽声明）；统计行引用随 StatsPills 更名更新。Desktop tests 1450 全绿。此前 2026-09-01 — 「会话累计费用」关闭时整条峰谷行（含空闲/高峰时段）隐藏；官方峰谷时只在费用开启后决定始终显示 vs DeepSeek 检测。此前同日：峰谷/费用 dock 改在 `slots.inject('conversation')` 内注册。 |

## User paths

1. 会话统计条与官方峰谷时状态行的盒宽与输入卡同步（`--dsh-composer-resized-width` 拖拽期间 / `--dsh-composer-card-max-width` 回退），左右边缘任何状态下都与卡片齐平；内容在盒内居中（统计 `text-align: center`，峰谷行 `justify-content: center`），纯 CSS、无测量代码。
2. 设置 → 「官方峰谷时」开关：仅在「会话累计费用」开启时生效。开启后，停靠态输入框下方（会话统计行之下）始终显示峰谷状态条。
3. 费用开启且未开「官方峰谷时」时，只要当前会话的模型路线是 DeepSeek API（`deepseek-official` / `deepseek`），状态条自动出现。费用关闭时整条隐藏（含空闲/高峰时段），官方峰谷时与 DeepSeek 检测都不能单独把它留住。
4. 状态条显示圆点 + 时段文案 + 「距离切换剩余时间：HH:MM:SS」每秒倒计时；跨过北京时间边界时自动切换文案与下一目标时段。圆点与时段文案仅在「官方峰谷时」开关开启时着时段色（空闲=绿 / 高峰=红）；仅检测路线时为中性色，时段色只是视觉提示。悬停时段文案出现内容相同的 tooltip。

## Invariants

- 「会话统计」开关与 `ActivityPill`、`UsagePill` 共享 `ComposerSubmissionPolicy.statsLine`，由 `conversation.composer.dock` 槽位注入传递；切换立即隐藏/恢复数字，不等待 Host 写回，关闭保留行间隔。0.2.1-alpha.1 起两颗统计胶囊分别注册为 activity（order 0）、usage（order 1），峰谷行以 order 2 注册并独占下一行。宽度跟随由 InputBar 的 dock 容器持有。
- 三个底栏偏好分别保护最新未确认选择，旧配置与旧请求不能回滚；Host 接受且镜像确认后解除保护，最新失败恢复已确认值，销毁后不发布。
- 峰谷规则：高峰 = 北京时间（UTC+8，Asia/Shanghai 无夏令时）工作日 09:00–12:00 与 14:00–18:00；其余全部时间（含周末）为空闲时段，按各自公布的时段价格计费（两段价格互不推导）。时段计算在 `peak-valley.ts` 纯函数内（Host 侧计费折算的孪生体在 `token-meter/src/billing-window.ts`，两处一起改）。
- 倒计时与整秒对齐、每秒更新；归零后按重算状态翻转，不显示负值。
- 宽度同步走 seat 发布的 `--dsh-composer-resized-width`（拖拽提交期间存在）+ `--dsh-composer-card-max-width` 回退，内容在盒内居中；纯 CSS，无 JS 测量。对齐契约由 [行居中 note](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-row-centering.md) 持有。
- 设置字段 `ui-conversation.officialPeakValley`（默认 `false` = 仅检测），走 `ComposerSubmissionPolicy`（live 先发布、Host 后写回、缺字段视为 false）。
- DeepSeek 路线事实经 `ctx.conversation.modelFacts`（blocks 推送模式）由 ui-model-selection 在目录每次变化时推送，scope 释放时清空为 `{ provider: null }`；provider 为 null 视为「未知」，不触发显示。该事实的形状恰好为 `{provider}`，模型 id 不在其中（费用功能的模型来源是助手节点 provenance）。
- 状态条只挂在 `conversation.composer.dock`（stats=0 / peak-valley=1）；hero（空状态）无 dock，因此不渲染，与统计条一致。
- 颜色只用 `--dsw-alias-state-success-primary` / `--dsw-alias-state-error-primary` 别名令牌，且经 `data-phase-color` 门控；文案经 `conversation` locale 命名空间（zh/en 双语键齐全）。
- 同一行可叠加会话累计费用与「设置价格」入口——由 [`session-cost-display`](session-cost-display.md) 卡拥有。`ui-conversation.sessionCost` 是整行门控：关闭则时段与费用一起消失。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/`（PeakValley 行、settings 行、submission-settings、policy、apply、locales、service、model-facts）
- `vendor/deepseek-harness/packages/client/ui-chat/src/client/chat/StatsPills.tsx`（会话统计药丸行；rc.1 由 StatsLine 重构而来，桌面契约随迁移）
- `vendor/deepseek-harness/packages/client/ui-chat/src/client/apply.ts`（统计条消费 dock 提供的即时开关状态；2026-09-29 用户授权扩展）
- `vendor/deepseek-harness/packages/client/ui-model-selection/src/client/service.ts`（推送事实）
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-peak-valley-status.*`
- 两包相关测试与本卡、README 双语段

## Do not touch

- token-meter / session-stats 投影与统计数字语义（usage-stats 卡的「只统计 Token 四桶」不变；余额与 CNY 计价展示由 [`session-cost-display`](session-cost-display.md) 卡拥有）
- 上游模型目录（ModelDirectory）与模型选择的交互行为；本功能只读事实、不回写
- hero 输入框、ApprovalPanel 接管、队列 dock 的布局

## Gates

| Kind | What |
| --- | --- |
| Automated | `vendor/deepseek-harness`：`pnpm exec vitest run`（peak-valley.math / row / settings-row / chat-apply / submission-policy / host / ui-model-selection）；`pnpm run test:gui` 触及包；`pnpm run typecheck` |
| Manual / QA | 拖拽输入框宽度时两行盒宽逐帧贴合、内容保持居中；跨 12:00（北京时间）观察颜色/文案/倒计时自动翻转；关闭「会话累计费用」后峰谷行整条消失 |

## Sources

- Decision: [会话统计即时开关](../decisions/implemented/bug-fix/2026-09-29-session-stats-live-toggle.md)

- Agent Note：[vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-peak-valley-status.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-peak-valley-status.md)
- Implementation entry：`ui-conversation/src/client/chat/PeakValleyRow.tsx`、`chat/peak-valley.ts`、`input/model-facts.ts`、`apply.ts`（settings 行 order 75 / dock 条目 order 2）；`ui-chat/src/client/chat/StatsPills.tsx`
- 相关决策：[interface-settings-chrome-visibility](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-19-interface-settings-chrome-visibility.md)、[projected-token-usage](../../vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-07-29-projected-token-usage-and-request-context.md)
