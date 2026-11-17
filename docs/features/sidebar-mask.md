# Feature: 隐藏侧栏遮罩（Hide sidebar mask）

| Field | Value |
| --- | --- |
| **id** | `sidebar-mask` |
| **status** | `active` |
| **last verified** | 2026-09-14 |

历史验证与变更记录见 [docs/history/sidebar-mask.md](../history/sidebar-mask.md)。

## User paths

1. 设置 → 外观 →「玻璃透明度」区块、「透明主题」之下：「隐藏侧栏遮罩」开关，默认开。
2. 打开后左侧栏不再叠加自己的遮罩填充，透出 `.frame` 的画布底色与工作区完全对齐，只保留右缘分割线；无背景、背景特效、壁纸三种底下都生效。
3. 关掉立即恢复侧栏自身填充（主题 token 或壁纸玻璃混合）。

## Invariants

- 持久化字段是 `ui-theme` 设置节的 `sidebarMaskHidden`（boolean，默认 true）；schema 在 `theme-settings.ts`。
- 生效 = `composeActive` 在家族 token、壁纸/特效 `mixWallpaperSurfaces`、override 层**之后**把 rail 铬面间接 token `--dsh-sidebar-rail-fill`（`SIDEBAR_RAIL_FILL_TOKEN`）写为 `transparent`（`SIDEBAR_UNMASKED_FILL`，theme-family.ts）。不新增表面、不动 `.sidebarCol` 的 `border-right` 分割线。
- rail 铬面（`.sidebarCol`、`SidebarRoot`、phone drawer 渐变、会话列表底部 fade）按 `var(--dsh-sidebar-rail-fill, var(--dsw-specific-sidebar-fill))` 解析，惯例同 `--dsh-scrollbar-*` 重绑定对。必须写 `transparent` 而不是画布色：rail 故意把 sidebar-fill 叠两层（"stays thicker than the chat"），半透明画布色二次叠加深化、永远比工作区暗；透明才透出 `.frame` 的 `bg-base` 精确对齐。
- `--dsw-specific-sidebar-fill` 本体不重写：`TrajectoryTable` 吸顶表头等非 rail 消费者继续读原值（透明会让滚动内容穿透表头）。
- 与「透明主题」独立：不动 `TRANSPARENT_ATTR`、`--dsw-alias-bg-mask-1`、玻璃滑杆、sidebar 混合曲线；透明主题下两者等价无害。
- 启动脚本 payload（`buildThemeBootPayload` → `tokensFor`）在开关开时把同一重写嵌进 light/dark tokens，预插件区间不闪回遮罩。
- 桌面启动器 / boot 页不感知此设置。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`、`theme-family.ts`、`boot-theme.ts`
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/`（`index.ts` runtime、`settings-store.ts`、`AppearanceSection.tsx`、`locales.ts`）
- `vendor/deepseek-harness/packages/extensions/cordis-client-runner/src/client/api-catalog.ts` — ThemeSnapshot 声明串
- `vendor/deepseek-harness/packages/client/ui-theme/tests/`、`vendor/deepseek-harness/packages/client/ui-layout/tests/theme-presenter.client.spec.ts` 快照字段
- 本卡、[.cursor/rules/sidebar-mask-product.mdc](../../.cursor/rules/sidebar-mask-product.mdc)、design-language token 表对应行

## Do not touch

- 不给侧栏造第三种填充或独立透明度滑杆；隐藏 = 跟画布同色
- 不动分割线（`.sidebarCol` `border-right`）、Modal / phone drawer 的 mask-1 遮罩
- 不动 `mixWallpaperSurfaces` 的 sidebar 混合曲线（关开关时行为不变）
- 无关邻域：壁纸行、背景特效、透明主题门控、boot 页 / 启动器

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor `packages/client/ui-theme` theme / settings-store / appearance-section / boot-theme client specs；ui-layout `theme-presenter.client.spec.ts` |
| Manual / QA | 开开关 → 无背景 / 特效 / 壁纸三种底下侧栏与工作区同底、只剩分割线；关开关恢复侧栏填充 |

## Sources

- Decision: none

- Design language: [docs/design-language.md](../design-language.md)
- Implementation entry: `ThemeRuntime.setSidebarMask` / `composeActive`（`ui-theme/src/client/index.ts`）、`SIDEBAR_FILL_TOKEN` / `SIDEBAR_UNMASKED_FILL`（`ui-theme/src/theme-family.ts`）
