# Feature: 透明主题（Transparent theme）

| Field | Value |
| --- | --- |
| **id** | `transparent-theme` |
| **status** | `active` |
| **last verified** | 2026-09-17 |

历史验证与变更记录见 [docs/history/transparent-theme.md](../history/transparent-theme.md)。

## User paths

1. 设置 → 外观 → 「玻璃透明度」区块底部：「透明主题」开关。
2. 已设背景图 + 开关开 → 侧栏、输入框、聊天画布、菜单、对话框、设置面板全部 0% 填充，壁纸压暗 mask 同时移除，壁纸色彩全量透出。
3. 未设背景图时开关可以打开但不生效（提示「需要先设置背景图」），玻璃滑杆保持可用。
4. 透明生效期间玻璃滑杆禁用（数值被旁路）；关掉开关立即恢复滑杆值。
5. 可读性靠壁纸「毛玻璃程度 / 像素化」滑杆调节；透明生效瞬间若毛玻璃低于 20% 会一次性提到 20%（`TRANSPARENT_MIN_BLUR`），之后用户可再调低，调低时提示文案换成低毛玻璃警告。
6. 同区块的「终端透明度」滑杆（40–100，默认 75）单独决定终端井实心度，不跟随玻璃滑杆；低于 75 时提示 TUI 选中行可读性但不钳制，无背景图且无流动渐变时数值保留但不生效。

## Invariants

- 持久化字段是 `ui-theme` 设置节的 `transparentTheme`（boolean，默认 false）；schema 在 `theme-settings.ts`。
- **壁纸门控**：无有效壁纸 data URL 时 flag 惰性 —— `--dsw-alias-glass-opacity` 与表面混色仍走玻璃滑杆，否则菜单/对话框会在不透明画布上隐形。
- 生效 = `mixWallpaperSurfaces(tokens, mode, TRANSPARENT_GLASS_SOLIDITY /* 0 */)` + `--dsw-alias-glass-opacity: 0%`；不是新皮肤，不新增 token 名。
- 终端 pane（`--dsw-alias-terminal-pane`）吃独立的 `terminalOpacity` 持久化字段（40–100，默认 `TERMINAL_PANE_MIN_SOLIDITY`=75），不随玻璃滑杆；本主题 0% 实心度输入下仍按该值混色 —— 75 只是默认与可读性提示线，低于它的显式取值被尊重，无单元格背景的 TUI 选中行由用户自担风险；显式 SGR 单元格背景仍画实心。
- 根属性 `data-dsh-transparent`（`TRANSPARENT_ATTR`）只在「flag 开 + 壁纸活」时置上；`wallpaper.css` 借它把 `#dsh-wallpaper::after` 的 `--dsw-alias-bg-mask-1` 压暗层置透明。Modal / lightbox 的 mask-1 遮罩**不**受影响。
- 壁纸下 composer seat 的实心 fade（`--dsw-static-neutral-bluish-00` / `-950`）**不**在透明主题生效时铺：选择器带 `:not([data-dsh-transparent])`。普通玻璃壁纸仍保留那条底板，避免 transcript 滚过输入条。
- **可读性 nudge 是一次性的，不是持续 clamp**：透明变为生效的两条路径（开关打开时已有壁纸 / 开关已开时设上壁纸）都经过 `nudgeTransparentBlur`——`wallpaperBlur < TRANSPARENT_MIN_BLUR /* 20 */` 时提到 20 并持久化；之后手动调低不再被顶回，Appearance 只显示 `glass.transparentBlurHint` 低毛玻璃提示。关掉开关不回写毛玻璃。不引入 text-shadow / 新 token。
- 启动脚本 payload（`buildThemeBootPayload`）在透明生效时嵌 0% 玻璃，避免预插件区间闪不透明 chrome。
- 桌面启动器 / boot 页不感知此设置（launcher 用官方明暗表，规则见 desktop-launcher-product.mdc）。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`、`wallpaper.ts`、`appearance-apply.ts`、`boot-theme.ts`
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/`（`index.ts` runtime、`AppearanceSection.tsx` + `.module.css`、`settings-store.ts`、`locales.ts`）
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/wallpaper.css` — 仅 `data-dsh-transparent` 分支
- `vendor/deepseek-harness/packages/client/ui-theme/tests/`（及 ui-layout `theme-presenter` spec 的快照字段）
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` — 仅壁纸 composer-seat fade 的 `:not([data-dsh-transparent])` 门控
- `vendor/deepseek-harness/packages/client/ui-conversation/tests/composer-seat-wallpaper.client.spec.ts`
- `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/terminal-theme.ts`、`src/client/ghostty/{core,renderer,surface}.ts` 及对应 `tests/`（pane 混色 alpha 读取与画布清屏）
- `vendor/deepseek-harness/.agents/notes/implemented/` 终端 pane 混色相关 note
- 本卡

## Do not touch

- 不给 launcher / boot 页涂透明或壁纸色（`--boot-*` 与官方明暗表不动）
- 不动 Modal / ImageLightbox / AppFrame 的 `--dsw-alias-bg-mask-1` 遮罩（对话框仍要可寻）
- 不引入文字描边 / text-shadow 等第二套皮肤手段；可读性走毛玻璃滑杆
- 不改玻璃滑杆的 40–100 范围或壁纸混色曲线本身

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor `pnpm run test:gui`；重点 spec：`theme.client.spec.ts`（0% 混色 + 持久化 + 毛玻璃 nudge 一次性）、`wallpaper.client.spec.ts`（mask 置透明 + 0% solidity）、`appearance-apply.client.spec.ts`（根属性门控）、`appearance-section.client.spec.tsx`（开关 + 滑杆禁用 + 低毛玻璃提示）、`boot-theme.client.spec.ts`（boot 0% 玻璃）、`composer-seat-wallpaper.client.spec.ts`（透明主题不铺 seat 实心底） |
| Manual / QA | 验收用例 TC-APP-012/013/014（[docs/qa/production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) §9）：设壁纸 → 开透明主题 → 侧栏/输入框/菜单全透、壁纸不再压暗、毛玻璃自动提到 ≥20%；清壁纸 → 界面回不透明且提示需要壁纸 |

## Sources

- Decision: none

- Design language: [docs/design-language.md](../design-language.md)
- 上游 Agent Note（玻璃/壁纸混色背景）: [vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-14-theme-family-appearance-system.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-14-theme-family-appearance-system.md)
- Implementation entry: `ThemeRuntime.setTransparentTheme` / `composeActive`（`ui-theme/src/client/index.ts`）、`TRANSPARENT_ATTR` / `TRANSPARENT_GLASS_SOLIDITY`（`ui-theme/src/wallpaper.ts`）
