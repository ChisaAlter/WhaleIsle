# Feature: Background gradient effect

| Field | Value |
| --- | --- |
| **id** | `background-gradient` |
| **status** | `active` |
| **last verified** | 2026-09-23 |

历史验证与变更记录见 [docs/history/background-gradient.md](../history/background-gradient.md)。

## User paths

1. 设置 → 外观 →「背景特效」行：标题 + 说明 + 齿轮 + Switch（与「输入特效」同款收束行），安装默认开（极光方案）。无背景图时界面后铺缓慢流动的渐变光斑。
2. 齿轮打开「背景特效」弹窗：实时预览 + 方案卡片（跟随主题 / 极光 / 晚霞 / 海洋 / 樱花 / 自定义）+ 重置 / 取消 / 保存。预览共用画布光斑规则，随草稿配色、速度、数量、形态变化；预设只写配色；7 色槽、速度 20–300%、光斑 1–5、光斑形态四组控件常显可调，改任何一项即进入自定义方案，保存一次性写回。
3. 已设背景图：特效值保留但暂停绘制，行内提示背景图期间不生效；清除背景图后特效自动回到界面。
4. 关闭开关恢复无特效底；`prefers-reduced-motion` 下光斑动画全停。
5. 特效生效时聊天区右侧滚动条滑块默认隐藏，指针悬停到滑块命中区或拖动时才显示；输入框底部的渐变压暗带对特效同样放开（与壁纸一致）。

## Invariants

- 特效只在 `wallpaperImage` 为空时绘制；背景图始终优先。`data-dsh-gradient`（特效生效）与 `data-dsh-wallpaper`（图片生效）互斥。
- 持久化字段是 Host `ui-theme`：`backgroundEffect`（`'none' | 'gradient'`，默认 `gradient`）、`backgroundEffectColors`（≤7 槽 `#rrggbb` 或空，空回主题 token，尾空裁剪；默认极光色板 `DEFAULT_BACKGROUND_EFFECT_COLORS`）、`backgroundEffectSpeed`（20–300，默认 190；`NEUTRAL_BACKGROUND_EFFECT_SPEED=100` 是 `--dsh-gradient-speed` 除数基准，等于基准时省略内联变量）、`backgroundEffectCount`（1–5，默认 5）、`backgroundEffectPreset`（`BACKGROUND_EFFECT_PRESETS` 之一：default / aurora / sunset / ocean / sakura / custom，默认 `aurora`；运行期写入非法 id 回退 `custom`）、`backgroundEffectVariant`（`BACKGROUND_EFFECT_VARIANTS` 之一：orbs / aurora / chaos / rays，默认 orbs；运行期写入非法值回退 `orbs`）。全部走 `ThemeSettingsSchema`，运行期写入 sanitize/clamp；schema 非严格模式透传存量未知键，故旧字段 `backgroundEffectPointer` 已整字段移除、无兼容残留。
- 预设定义在 `src/client/effect-presets.ts`（id + 色槽的纯配色包，不写速度 / 数量 / 形态）；运行时只消费色槽/速度/数量/形态四个 tunables，preset id 是纯 UI 态。
- 光斑形态经 `#dsh-gradient[data-variant]` 切换：`orbs` 是默认光球；`aurora` 横向漂移的椭圆飘带；`chaos` 小光斑多轴乱序 + scale 脉动；`rays` conic-gradient 楔形光束绕中心旋转。全部变体仍只动 transform。
- 弹窗预览使用独立 ID 复用画布光斑选择器；弹窗开启期间，其他主题状态发布不得重置已编辑的草稿。保存才写入 Host，取消不落盘。
- 共享光斑几何与变体规则都作用 `[data-blob]`（画布和预览各有独立容器 ID）；变体的逐光斑选择器必须带容器 ID 前缀拉平优先级，否则被变体共享规则（双 ID）压过、逐光斑位置错开全部失效。
- DOM：复用 `#dsh-wallpaper` 固定层（不新开第二层），特效挂 `#dsh-gradient`；与图片壁纸共享透明底、`--dsw-alias-bg-mask-1` 压暗、`#root` 抬层规则。
- 颜色默认值只来自主题表 `--dsw-specific-gradient-*` token（`design-platform.css` 明、暗两半各一份）；用户覆盖写成 `#dsh-gradient` 内联 `--dsh-gradient-*` 变量，功能 CSS 用 `var(--dsh-*, var(--dsw-*))` 回退链，不写颜色字面量、不写明暗分支。速度覆盖是 `--dsh-gradient-speed` 除数。
- 动效只动 transform：光斑循环位移（20–40s 基准 ÷ 速度系数，设计值不进 token 表，登记在 motion.md 指示器家族）；`prefers-reduced-motion` 下光斑动画全停。
- 特效生效时 `mixWallpaperSurfaces` 按玻璃透明度混合表层（与壁纸同一套）；透明主题仍只认背景图，特效不算壁纸、不触发 0% 填充。
- 终端 pane（`--dsw-alias-terminal-pane`）同样参与混色，但保底 `TERMINAL_PANE_MIN_SOLIDITY`（75）实心度——无单元格背景的 TUI 选中行保持可读；Ghostty 画布 `{alpha:true}`，半透明底时重绘区 `clearRect` 回 DOM 填充（不二次合成），显式 SGR 背景仍实心。
- 设置 UI 是独立「背景特效」行（标题 + 说明 + 齿轮 + Switch），配置收进 `Modal` 弹窗（预览 + 预设卡片 + 自定义编辑器 + 重置/取消/保存），控件不进壁纸行、不在 Appearance 页内联展开。
- 会话骨架对特效一视同仁：`.composerSeat` 渐变压暗带在 `data-dsh-gradient` 下同样变透明；`.scrollBody` 的 WebKit 滑块默认透明，仅 `:hover`/`:active` 时着色（8px 槽位常留，不挪布局）。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`（`backgroundEffect` 字段 / schema / sanitize）
- `vendor/deepseek-harness/packages/client/ui-theme/src/wallpaper.ts`（特效层，和 `applyWallpaperLayer` 同层管理）
- `vendor/deepseek-harness/packages/client/ui-theme/src/appearance-apply.ts`、`src/client/index.ts`、`src/client/settings-store.ts` — 快照与持久化接线
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css`（`--dsw-specific-gradient-*` token）、`src/styles/wallpaper.css`
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/BackgroundEffectRow.tsx`、`effect-presets.ts`、`AppearanceSection.tsx`（仅特效行接线）、`AppearanceSection.module.css`、`locales.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css`（`.composerSeat` 特效放开、`.scrollBody` 滑块悬停显示）
- `vendor/deepseek-harness/packages/client/ui-trajectory/src/client/{views,TrajectoryTable,TrajectoryToolbar}.module.css`（轨迹画布去实底，透出 AppFrame 的 `bg-base` 混色）
- `vendor/deepseek-harness/packages/client/ui-user-terminal/src/client/terminal-theme.ts`、`src/client/ghostty/{core,renderer,surface}.ts` 及对应 `tests/`（pane 混色 alpha 读取、alpha 画布、清屏渲染）
- `vendor/deepseek-harness/.agents/notes/implemented/` 终端 pane 混色相关 note
- `vendor/deepseek-harness/packages/client/ui-theme/tests/` 相关 spec、`ui-layout/tests/theme-presenter.client.spec.ts` 快照字面量
- 本卡、[.cursor/rules/background-gradient-product.mdc](../../.cursor/rules/background-gradient-product.mdc)、design-language / motion 对应段落

## Do not touch

- 壁纸行（挑选 / 浏览 / 裁切 / frost / pixelate）的控件与图源边界；图源配置仍只在图库窗
- 透明主题的图片门槛；boot 预绘制路径（壁纸与特效都不进 boot payload）
- 为特效引入动画库、颜色字面量、第二套明暗分支或独立遮罩层
- 无关邻域：图库、主题库、boot 页、启动器

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-theme` wallpaper / appearance-apply / theme / appearance-section client specs |
| Manual / QA | [TC-APP-015](../qa/production-acceptance-test-cases.md)（§9 外观与壁纸图库） |

## Sources

- Decision: [背景特效预览复用画布规则](../decisions/implemented/bug-fix/2026-09-23-background-effect-preview.md)

- Reference: <https://ayase.cn/motion/#/component/background-gradient-animation>（Aceternity `BackgroundGradientAnimation` 移植；hard-light 循环光斑）
- Design language: [../design-language.md](../design-language.md)；motion: [../motion.md](../motion.md)
- Handbook: [../handbook/modules/wallpaper.md](../handbook/modules/wallpaper.md)
- Short rule: [.cursor/rules/background-gradient-product.mdc](../../.cursor/rules/background-gradient-product.mdc)
- Implementation: `applyWallpaperLayer`（`wallpaper.ts`）/ `BackgroundEffectRow.tsx` / `wallpaper.css`
