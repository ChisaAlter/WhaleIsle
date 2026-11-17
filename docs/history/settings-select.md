# settings-select · 历史记录

自功能卡 [docs/features/settings-select.md](../features/settings-select.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-23 — 同步 `dsh-v0.1.7-alpha.2` 后，ModelsSection 的 Add provider 值选择恢复 `SettingsSelect variant="block"`；模型设置与插件设置定向 Vitest 共 340/340 通过，官方构建和桌面源码冒烟通过，ui-primitives 全套 1226/1226 通过。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：上游把 Add provider 原生 `<select>` 收编进选择器场景，ModelsSection 的 add 卡选择器维持本卡 `SettingsSelect` 胶囊（官方 Switch primitive 同期并入，AA 合并保留 `.track` API 并对上游 `.switch .thumb` 应用 motion token）；上游新用例（settings namespace 可开编辑器的 provider 过滤）按本卡 menu/menuitem 驱动方式适配，components.client.spec 88/88。此前 2026-09-03 — 触发器标签接 `FlipText`（选值翻转，flip recipe）；vendor 选择器相关 spec 全过。2026-09-01 — HarnessRestartRow optimistic Switch（无 saving flash）；PriceSettingsPanel + ModelsSection add-provider `SettingsSelect`；alpha.4：SettingsSelect、Appearance 与模型设置回归通过。 |
