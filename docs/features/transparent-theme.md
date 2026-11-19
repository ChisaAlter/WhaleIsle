# Feature: 透明主题（Transparent theme）

| Field | Value |
| --- | --- |
| **id** | `transparent-theme` |
| **status** | `active` |
| **last verified** | 2026-11-18 |

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
- 根属性 `data-dsh-transparent`（`TRANSPARENT_ATTR`）只在「flag 开 + 壁纸活」时置上 —— 窗口毛玻璃生效期间壁纸层暂停，属性随之不置；`wallpaper.css` 借它把 `#dsh-wallpaper::after` 的 `--dsw-alias-bg-mask-1` 压暗层置透明。Modal / lightbox 的 mask-1 遮罩**不**受影响。
- 壁纸下 composer seat 的实心 fade（`--dsw-static-neutral-bluish-00` / `-950`）**不**在透明主题生效时铺：选择器带 `:not([data-dsh-transparent])`。普通玻璃壁纸仍保留那条底板，避免 transcript 滚过输入条。
- **可读性 nudge 是一次性的，不是持续 clamp**：透明变为生效的两条路径（开关打开时已有壁纸 / 开关已开时设上壁纸）都经过 `nudgeTransparentBlur`——`wallpaperBlur < TRANSPARENT_MIN_BLUR /* 20 */` 时提到 20 并持久化；毛玻璃生效期间透明暂停，两条路径均不触发。之后手动调低不再被顶回，Appearance 只显示 `glass.transparentBlurHint` 低毛玻璃提示。关掉开关不回写毛玻璃。不引入 text-shadow / 新 token。
- 启动脚本在透明主题生效时用 0% 底色；支持窗口毛玻璃且开启时，弹窗等内部表层从启动起就用原有磨砂底色。
- 桌面启动器 / boot 页不感知此设置（launcher 用官方明暗表，规则见 desktop-launcher-product.mdc）。

## 窗口毛玻璃（Windows Acrylic）

### User paths

1. 设置 → 外观 → 「玻璃透明度」区块：「窗口毛玻璃」开关，只在支持的 Windows 桌面端渲染（`src/main/window.js` 在创建 Harness `BrowserView` 时经 `additionalArguments` 传入 `--dshd-window-material=acrylic` 广告支持，`src/preload/index.js` 在 Harness 主框架置 `data-window-material-supported`，`AppearanceSection` 读一次决定显隐）。
2. 开启后主窗口显示经 Windows 合成器模糊的真实桌面。默认皮肤降低「玻璃透明度」数值，会让聊天区和侧栏透出更多桌面；拉到 100% 时画布为实色。滑杆只调整窗口底色，弹窗和菜单保留原有磨砂底色和模糊。常态保留 20px 透明四角；最大化和全屏铺满。关闭后原背景立即恢复，无需重启。
3. 生效期间壁纸层与流动渐变层暂停渲染（存储值保留，关闭后恢复），避免盖住原生模糊；依赖壁纸的「透明主题」一并暂停 —— `data-dsh-transparent` 不置、不触发 blur nudge。极简模式同样挂起毛玻璃。

### Invariants

- 持久化字段是 `ui-theme` 设置节的 `windowAcrylic`（boolean，默认 false）；schema 在 `theme-settings.ts`。
- 生效 = `windowAcrylic && data-window-material-supported && !minimalMode`；三个条件缺一则 flag 存储但惰性（不支持的平台 / 非 Windows / 极简模式）。
- 支持门槛：Windows 11 22H2 及以上（build ≥ 22621）且主窗口成功建立合成目标。不支持时 main 不传参数，页面继续使用普通背景。
- `wallpaper.css` 只在 `data-dsh-window-material="acrylic"` 时将 `html` / `body` / `#root` / `#dshd-frame-canvas` 置透明。`src/preload/index.js` 观察属性，经 `shell:window-material`（`IPC_ROLES.HARNESS` 主框架同源校验）通知 main。
- 主窗口不调用 Electron 的矩形 HWND `setBackgroundMaterial`。`src/native/window-acrylic.cpp` 将 Windows 的 `HostBackdropBrush` 放在 Chromium 内容之后，并在该材质层按物理 DPI 裁切 20px 圆角；不改变 HWND 样式、窗控或输入区域。关闭 Acrylic（包括 `hideHarnessView` 返回 boot 页）只卸下合成视觉层，原有全透明底色和壁纸路径不变。
- Acrylic 是背景源：生效时 `composeActive` 的 `backdropLive` 包含它。默认皮肤让 `AppFrame` 只绘制一层画布底色，标题栏和聊天区不再叠涂同类底色；显示侧栏背景时只加一层侧栏填充。毛玻璃画布在滑杆 40% / 80% / 100% 时分别保留 6% / 30% / 100% 底色。壁纸和流动渐变的曲线不变；壁纸暂停期间不走 `TRANSPARENT_GLASS_SOLIDITY` 的 0% 语义，毛玻璃关闭后随壁纸恢复。
- boot payload 带 `windowAcrylic`：启动脚本在 preload 已置支持标记时同步落 `data-dsh-window-material`；拿不到标记时不置，客户端激活后兜底 —— 不支持的机器永不启动透明。
- macOS / Linux 行为不变；欢迎窗口等独立辅助窗口不受此开关影响。

## Allowed touch

- `src/main/window-material.js`、`src/main/window-acrylic.js`、`src/native/window-acrylic.cpp`、`src/main/window.js`、`src/main/chrome.js`、`src/preload/index.js`、`src/shared/ipc-contract.js`
- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`、`wallpaper.ts`、`appearance-apply.ts`、`boot-theme.ts`、`index.ts`
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/`（`index.ts` runtime、`AppearanceSection.tsx` + `.module.css`、`settings-store.ts`、`locales.ts`）
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/wallpaper.css` — `data-dsh-transparent` 与 `data-dsh-window-material` 分支
- `vendor/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.module.css` 与 `ui-sidebar/src/client/SidebarRoot.module.css` 的窗口毛玻璃填充分工
- `vendor/deepseek-harness/packages/client/ui-theme/tests/`（及 `ui-layout`、`ui-sidebar-terminal`、`ui-directory-picker-native`、`cordis-client-runner` 对应快照/类型目录与 mock）
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
| Automated | 宿主单测：`src/main/window-material.test.js`、`src/main/chrome-theme.test.js`、`src/preload/shell-api.test.js`、`src/shared/ipc-contract.test.js`；vendor 客户端 spec：`theme.client.spec.ts`、`wallpaper.client.spec.ts`、`appearance-apply.client.spec.ts`、`appearance-section.client.spec.tsx`、`boot-theme.client.spec.ts`、`settings-store.client.spec.ts`、`config.host.spec.ts`、`composer-seat-wallpaper.client.spec.ts` |
| Manual / QA | 验收用例 TC-APP-012/013/014（[docs/qa/production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md) §9）：设壁纸 → 开透明主题 → 侧栏/输入框/菜单全透、壁纸不再压暗、毛玻璃自动提到 ≥20%；清壁纸 → 界面回不透明且提示需要壁纸。Windows：先 `node scripts/build-window-acrylic.cjs`，再 `node scripts/run-window-motion-qa.mjs --composed`，直接采样开关前后真实桌面模糊和四角。 |

## Sources

- Decision: none

- Design language: [docs/design-language.md](../design-language.md)
- 上游 Agent Note（玻璃/壁纸混色背景）: [vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-14-theme-family-appearance-system.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-14-theme-family-appearance-system.md)
- Implementation entry: `ThemeRuntime.setTransparentTheme` / `composeActive`（`ui-theme/src/client/index.ts`）、`TRANSPARENT_ATTR` / `TRANSPARENT_GLASS_SOLIDITY`（`ui-theme/src/wallpaper.ts`）
