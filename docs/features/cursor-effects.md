# Feature: Cursor effects

| Field | Value |
| --- | --- |
| **id** | `cursor-effects` |
| **status** | `active` |
| **last verified** | 2026-09-15 |

历史验证与变更记录见 [docs/history/cursor-effects.md](../history/cursor-effects.md)。

## User paths

1. 设置 → 外观 →「指针特效」行：标题 + 说明 + 齿轮 + Switch（与「背景特效」「输入特效」同款收束行）。打开 Switch → 全屏叠加层在指针划过处绘制特效。
2. 齿轮打开「指针特效」弹窗：特效类型二选一卡片（像素拖尾 / 流体飞溅）+ 画布实时预览（预览区内移动指针即可试看）+ 方案卡片（跟随主题 / 彩虹 / 极光 / 晚霞 / 海洋 / 樱花 / 自定义）+ 重置 / 取消 / 保存。预设一次写齐配色 + 速度 + 大小；改任何一项进入自定义方案，保存一次性写回并启用开关（保存即应用）。
3. 关闭开关停绘并移除 DOM；所选特效、配色与滑块全部保留，再开恢复上次的样式。
4. `prefers-reduced-motion` 下不挂载；无 Canvas 2D / WebGL 时对应引擎静默不挂载、不留 DOM 残留。

## Invariants

- 持久化字段是 Host `ui-theme`：`cursorEffectEnabled`（默认 `false`）、`cursorEffect`（`'trail' | 'splash'`，默认 `trail`，非法值回退默认；首版遗留 slug `pixel-trail`/`splash-cursor` 在 `normalizeCursorEffect` 处迁移）、`cursorEffectColors`（≤6 槽 `#rrggbb`，空回主题 accent）、`cursorEffectSpeed`（20–300，默认 100）、`cursorEffectSize`（25–300，默认 100）、`cursorEffectPreset`（`CURSOR_EFFECT_PRESETS` 之一：default / rainbow / aurora / sunset / ocean / sakura / custom，默认 default，非法 id 回退 `custom`）。全部走 `ThemeSettingsSchema`；`setCursorFx` 是唯一写入路径，开关只写 enabled 位、不丢所选特效。
- 预设定义在 `src/client/cursor-fx-presets.ts`（id + 配色 + 速度 + 大小整包）；运行时只消费 effect / colors / speed / size 四个 tunables，preset id 是纯 UI 态。
- DOM：`#dsh-cursor-fx` 固定全屏层（`position: fixed; inset: 0; pointer-events: none; z-index 9999`，特效画在整个 UI 之上），`data-dsh-cursor-fx` 记当前特效。window 级 `pointermove` / `pointerdown` 监听随层挂卸；切特效重建 canvas，改 tunables 走引擎 `update` 热通道不重建。
- `trail`：2D canvas 网格，指针轨迹插值盖章、格子按速度时长淡出（ReactBits `PixelTrail` 的 2D 等价移植，不引 three.js）；`splash`：WebGL Navier-Stokes 染料模拟（移植自 ReactBits `SplashCursor` / Pavel Dobryakov MIT 流体），指针位移同时写速度场与染料。rAF 循环有 4s 闲置停帧与 `document.hidden` 暂停；两引擎同享 `mountCursorFx` / `CursorFxHandle` 契约，弹窗预览与全屏层跑同一引擎。
- 弹窗每次打开按 `key` 整体 remount（草稿只认打开时的存储值，发布期间不被重置）；预览 `<canvas>` 按 `draft.effect` 加 key——同一 canvas 元素绑定过 `2d`/`webgl` 后 `getContext` 换型必返 `null`，换型必须换新元素。
- 空配色回退 `--dsw-alias-brand-primary`（解析成 `#rrggbb` 进引擎）；设置控件与卡片只用 `--dsw-alias-*` token，不写颜色字面量、不写明暗分支、不引动画库。
- 设置 UI 是独立「指针特效」行，配置收进 `Modal`；不并进壁纸行 / 背景特效行、不在页内联展开。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`（`cursorEffect*` 字段 / schema / sanitize）
- `vendor/deepseek-harness/packages/client/ui-theme/src/cursor-fx.ts`（层管理 + 像素拖尾引擎）、`src/cursor-fluid.ts`（流体引擎）
- `vendor/deepseek-harness/packages/client/ui-theme/src/appearance-apply.ts`、`src/client/index.ts`、`src/client/settings-store.ts` — 快照与持久化接线
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/CursorEffectRow.tsx`、`cursor-fx-presets.ts`、`AppearanceSection.tsx`（仅特效行接线）、`AppearanceSection.module.css`、`locales.ts`
- `vendor/deepseek-harness/packages/client/ui-theme/tests/` 相关 spec
- 本卡、[.cursor/rules/cursor-effects-product.mdc](../../.cursor/rules/cursor-effects-product.mdc)、design-language / motion 对应段落

## Do not touch

- 背景特效 / 壁纸行 / 输入特效的字段与控件边界；指针特效不读壁纸状态、不与 `data-dsh-wallpaper` 互斥（叠加层在 UI 之上）
- boot 预绘制路径（特效不进 boot payload）
- 为特效引入 three.js / react-three-fiber / 动画库、颜色字面量、明暗分支、第二套遮罩层
- 无关邻域：图库、主题库、boot 页、启动器

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-theme` cursor-fx / appearance-apply / theme / settings-store / appearance-section client specs + `tsc -b packages/client/ui-theme` |
| Manual / QA | 设置 → 外观 →「指针特效」开关与弹窗实机验收（两特效预览、预设与自定义保存） |

## Sources

- Decision: none

- Reference: <https://ayase.cn/motion/#/component/pixel-trail>（ReactBits `PixelTrail`，three.js 网格拖尾 → 2D canvas 等价移植）、<https://ayase.cn/motion/#/component/splash-cursor>（ReactBits `SplashCursor`，WebGL 流体模拟移植）
- Design language: [../design-language.md](../design-language.md)；motion: [../motion.md](../motion.md)
- Short rule: [.cursor/rules/cursor-effects-product.mdc](../../.cursor/rules/cursor-effects-product.mdc)
- Implementation: `applyCursorFxLayer`（`cursor-fx.ts`）/ `mountFluidCursor`（`cursor-fluid.ts`）/ `CursorEffectRow.tsx`
