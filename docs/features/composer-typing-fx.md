# Feature: Composer 输入特效

| Field | Value |
| --- | --- |
| **id** | `composer-typing-fx` |
| **status** | `active` |
| **last verified** | 2026-09-13 |

历史验证与变更记录见 [docs/history/composer-typing-fx.md](../history/composer-typing-fx.md)。

## User paths

1. 设置 → 外观 → 底部「输入特效」行：Switch 总开关（默认关）+ 左侧齿轮打开配置弹窗。
2. 弹窗内实时预览区循环「打」示例文本，按当前草稿配置播 echo 与光标；控件含效果（落锤/上浮/闪现）、光标（跟随系统/方块/下划线）、闪烁开关、速度滑杆、颜色（跟随主题/6 个内置配色/自定义回显+光标+文本三色）；恢复默认/取消/保存；≤5 个具名预设；`dsh-typing-fx` v1 JSON 剪贴板导入导出。
3. 开启后在 composer 键入字符：新字符真实位置播一次性 echo（opacity/transform），光标为 `native` 之外时隐藏原生光标并渲染跟随选区的自定义光标。
4. 粘贴、撤销/重做、草稿种子/恢复、批量插入、删除不播 echo；IME 组合进行中不播，composition-end 提交把整段提交文本播一次 echo；ranged selection 或失焦隐藏自定义光标。
5. `prefers-reduced-motion: reduce`：不产 echo，光标动画停。

## Invariants

- **不碰 Lexical 托管文本 DOM**：不做逐字 split/setStyle 包装（碎片化 + 选区/历史/IME 风险）；特效全部是 `.grow` 内绝对定位叠加层（与 placeholder / DecoratorPortals 同级），只动 `opacity`/`transform`。
- echo 来自 `editor.registerUpdateListener` 的 prev/next 文本 diff；跳过 `PASTE_TAG`/`CUT_TAG`/`HISTORIC_TAG`/`HISTORY_MERGE_TAG`/`COMPOSITION_START_TAG`/`SKIP_COLLAB_TAG`、`editor.isComposing()`、>16 字符批量插入与纯空白；`COMPOSITION_END_TAG` 更新例外——对 composition-start 时的文本快照做整段 diff 播一次（中文 IME 提交也生效），无基准快照时回退自身 prev diff；并发池有上限。
- 设置行挂在**外观分区**，经 `settings.appearance.item` 行插槽（`settings.general.item`/`settings.interface.item` 同款：类型在 `ui-settings` contract，运行时 `children` 声明在 ui-theme 的 appearance section，注册方 ui-conversation）；设置持久化仍归 `ui-conversation` 命名空间，不跨包写 `ui-theme`。
- 行 UI 复刻 BeamRow：标题 + 描述 + `Tooltip` + 28px `IconSettingsOutline16` 齿轮（紧邻 Switch 左侧）+ `Switch`；`writable` gate。
- 弹窗复刻 BeamSettingsModal：sticky 预览区、分组控件、恢复默认/取消/保存、≤5 预设、`MAX_*_JSON_BYTES` 限幅的 v1 JSON envelope 导入导出；取消不写入，保存一次 namespace mutation 同提 style+presets。
- 默认 `typingFx=false`（新动效 opt-in）；旧设置缺字段取默认；错误/越界数据在 adopt 边界归一化。颜色三段（`theme`/`preset`/`custom` 三色）越界归 `theme`，解析后非主题色经 `--dsh-typing-fx-echo-color`/`--dsh-typing-fx-caret-color`/`--dsh-typing-fx-text-color` CSS 变量下发（text 染 `.input` 整体 color，不碰文本 DOM），主题色回落 `--dsw-alias-*` token；弹窗「自定义」芯片是独立记忆槽，选预设不重绘。
- 自定义光标激活时 `.input` `caret-color: transparent`（data 属性驱动）；`native` 不动原生光标。
- 无会话 workspace-trigger 态（editor 为 null）不挂层；mobile/web 不在范围。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts`（`settings.appearance.item` 条目）
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/index.ts`、`AppearanceSection.tsx`（仅插槽声明与渲染）
- `vendor/deepseek-harness/packages/client/ui-theme/tests/appearance-section.client.spec.tsx`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/submission-settings.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/submission-policy.ts`、`input/editor/typing-fx.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/TypingFxLayer.tsx`(+`.module.css`)、`skeleton/InputBar.tsx`(+`.module.css`)
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/settings/TypingFxRow.tsx`(+`.module.css`)、`TypingFxModal.tsx`(+`.module.css`)
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`、`apply.ts`、`locales.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/tests/`（typing-fx 相关 spec、chat-apply、submission-policy）
- `src/shared/harness-desktop-forks.js`、`harness-desktop-forks.test.js`
- 本卡、`docs/features/README.md`、`.cursor/rules/composer-typing-fx-product.mdc`、`docs/motion*.md`、`ui-conversation/README*.md`

## Do not touch

- Lexical 文本节点 split/包装式逐字入场；真实文本的 DOM 结构
- composer 提交/claim/queue/附件行为、placeholder 文案与判定、`text-ref`/`claim` transform
- AI 回复渲染（MarkdownText 增量解析）、beam、resize、统计行等邻域
- `ui-theme` 命名空间的写入方（仍只 ui-theme 自己）
- mobile/web composer

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor focused `typing-fx-*.client.spec.*` + `chat-apply`/`appearance-section`/`submission-policy`/`input-bar` 回归；包内 `tsc --noEmit`；桌面 `harness-desktop-forks.test.js` |
| Manual / QA | 外观开特效后打字 echo/光标生效；IME 中文组合、粘贴、撤销不播；reduced-motion 全停；弹窗 Save/Cancel/预设/JSON 往返与重开持久化 |

## Sources

- Decision: none

- Design: [设计语言](../design-language.md) / [动效规范](../motion.md)
- Visual reference: [ayase motion typewriter](https://ayase.cn/motion/#/component/typewriter)
- 模板先例：[composer-beam](composer-beam.md)（BeamRow / BeamSettingsModal / submission-settings）
- Implementation entry: `ui-conversation/src/client/skeleton/InputBar.tsx` / `TypingFxLayer.tsx` / `settings/TypingFxRow.tsx`
