# Feature: SettingsSelect（设置下拉）

| Field | Value |
| --- | --- |
| **id** | `settings-select` |
| **status** | `active` |
| **last verified** | 2026-09-23 — 同步 `dsh-v0.1.7-alpha.2` 后，ModelsSection 的 Add provider 值选择恢复 `SettingsSelect variant="block"`；模型设置与插件设置定向 Vitest 共 340/340 通过，官方构建和桌面源码冒烟通过，ui-primitives 全套 1226/1226 通过。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：上游把 Add provider 原生 `<select>` 收编进选择器场景，ModelsSection 的 add 卡选择器维持本卡 `SettingsSelect` 胶囊（官方 Switch primitive 同期并入，AA 合并保留 `.track` API 并对上游 `.switch .thumb` 应用 motion token）；上游新用例（settings namespace 可开编辑器的 provider 过滤）按本卡 menu/menuitem 驱动方式适配，components.client.spec 88/88。此前 2026-09-03 — 触发器标签接 `FlipText`（选值翻转，flip recipe）；vendor 选择器相关 spec 全过。2026-09-01 — HarnessRestartRow optimistic Switch（无 saving flash）；PriceSettingsPanel + ModelsSection add-provider `SettingsSelect`；alpha.4：SettingsSelect、Appearance 与模型设置回归通过。 |

## User paths

1. 设置 → 模型：视觉模型、提供方等表单下拉。
2. 设置 → MCP：传输方式；列表「启用状态」筛选。
3. 设置 → Skills：来源筛选。
4. 设置 → 通用 / 界面：语言、关闭窗口、Harness 恢复次数/延迟、忙碌时 Enter、新会话权限默认。
5. 外观图库：图源类型（浏览窗内）。
6. 价格设置面板：模型下拉。

打开列表是官方 `Menu`，不是系统原生 `<select>`。

## Invariants

- `SettingsSelect` 是 `ui-primitives` 公开原语（`variant="inline"|"block"`，`align`）。样式只用 `--dsw-alias-*` 与组件局部令牌，无字面颜色。`block` 触发器与打开列表都跟字段同宽（`Menu.matchAnchorWidth`），列表底用 `--dsw-alias-bg-module-platform`（与胶囊相同），不是 218px 玻璃卡片透壁纸。
- 菜单统一为 12px 圆角，条目使用 14px/22px 字级和 8px 圆角。块级列表通过共享 `MenuSurface material="solid"` 取得字段底色，不在功能样式里覆盖菜单材质。
- 选项集合与写入语义不变：只换触发器与打开面。
- 设置里的**值选择**走 `SettingsSelect`。行内操作菜单（删除确认、卡片展开、开关）不是下拉，不改。
- 触发器标签在选值替换时走 `FlipText`（flip recipe，400ms；减弱动效立即换文案），与 Composer 模型 / 权限芯片同一份动效合同（`docs/motion.md` flip 表）。
- Composer 模型座 / `/permission` 芯片不在本卡。
- 存在性由 `src/shared/harness-desktop-forks.js` 的 `FORK_FILE_MARKERS` 钉住。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-primitives/src/SettingsSelect.tsx` / `.module.css` / `index.ts` 与 `tests/settings-select.client.spec.tsx`
- `vendor/deepseek-harness/packages/client/ui-primitives/src/Menu.tsx` / `Menu.module.css`（仅 `matchAnchorWidth`）与 `tests/atoms.client.spec.tsx` 对应用例
- 各设置分区里的值选择：`ui-settings-mcp`、`ui-settings-skills`、`ui-settings-models`、`ui-settings-general`（关闭窗口 / Harness 恢复）、`locale` 语言行、`ui-conversation` Enter 行与 `PriceSettingsPanel`、`ui-permission-presets`、`ui-theme` `WallpaperSources`

## Do not touch

- 传输 / 权限 / 关闭行为等选项集合与语义
- Composer `ModelSelect`、会话 `/permission`、侧栏非设置菜单
- Appearance 图源 CRUD 规则（属 `wallpaper-gallery`）

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor：`settings-select`、`mcp-section`、`skills-section`、`close-behavior-row`、`language-row`、`enter-behavior-row`、`permission-presets-row` client spec。Desktop：`npm test`（fork 标记） |
| Manual / QA | 打开设置各分区，下拉均为官方胶囊 + Menu |

## Sources

- Decision: none

- Handbook: [../handbook/appendix/settings-sections.md](../handbook/appendix/settings-sections.md)
- Registry: `src/shared/harness-desktop-forks.js` `FORK_FILE_MARKERS`
- Implementation: `packages/client/ui-primitives/src/SettingsSelect.tsx`
