# composer-stats-peak-valley · 历史记录

自功能卡 [docs/features/composer-stats-peak-valley.md](../features/composer-stats-peak-valley.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-29 — 三开关并发修复：144 项定向测试、正式构建通过；实机全部 8 组合 / 24 次连续交错切换无回跳，保存重载一致（[连续切换](../qa/results/2026-09-29-session-stats/three-switch-stress.json)、[重载](../qa/results/2026-09-29-session-stats/three-switch-reload.json)）。此前同日即时开关修复：109 项定向测试通过，正式构建（含类型检查）通过；桌面重启后关闭 9ms / 开启 13ms，重新加载分别保留关闭 / 开启状态（[实机结果](../qa/results/2026-09-29-session-stats/result.json)）。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：峰谷 dock/settings 行与注入保持（chat-apply host spec 4/4，其 bench 需按 rc.1 keyed `'main'` 槽声明）；统计行引用随 StatsPills 更名更新。Desktop tests 1450 全绿。此前 2026-09-01 — 「会话累计费用」关闭时整条峰谷行（含空闲/高峰时段）隐藏；官方峰谷时只在费用开启后决定始终显示 vs DeepSeek 检测。此前同日：峰谷/费用 dock 改在 `slots.inject('conversation')` 内注册。 |
