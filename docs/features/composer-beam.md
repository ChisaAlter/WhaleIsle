# Feature: Composer 思考炫光

| Field | Value |
| --- | --- |
| **id** | `composer-beam` |
| **status** | `active` |
| **last verified** | 2026-09-23 |

历史验证与变更记录见 [docs/history/composer-beam.md](../history/composer-beam.md)。

## User paths

1. 智能体发送、思考或流式输出时，输入卡四边与四个圆角播放连续彩色边光；界面设置关闭「发送消息时的思考炫光」后不绘制。
2. 运行态仍可点击草稿、附件、权限、模型与 Stop；边光不覆盖输入框上方 dock、下方留白或相邻内容。
3. 设置 → 界面中，用户可从开关左侧的齿轮打开思考炫光弹窗；开关右边界与其他设置行保持一致。用户可使用同源预览配置方向（顺/逆/往返）、周期、强度、bloom、色相、呼吸、色相循环、模式、色板 / 自定义颜色、track width、blur、夜间调暗、缓动与最多 5 个预设；可通过 v1 JSON 剪贴板导入导出。取消不写入，恢复默认回到当前 legacy 基线效果。

## Invariants

- 静止卡只用 `inset 0 0 12px 1px rgba(255, 255, 255, 0.25)` + elevation hairline，不画外白光或 elevation-soft。
- `.beamLayer` 是未滤镜、`pointer-events: none`、`z-index: 0` 的 4px 外扩圆角裁切壳；`.cardBody` 保持 `z-index: 1`。
- 卡片、裁切壳、stroke、inner 与 bloom 光源均明确使用 `corner-shape: round`，不受全局 superellipse 影响；测试加载真实全局圆角与 elevation 样式，并将 CSS 坐标映射到设备像素。
- stroke / inner 精确回到 22px 卡边；stroke 透明度为 0.6，inner 共享同方向双 conic 旋转窗口；bloom 的 masked 光源与 `blur(8px)` 容器分层，0.36 透明度只在 4px 壳内外溢。壳宽小于 6px composer stack gap。
- 运行态 stroke 固定为 2px，并使用 Libraries.dev Rotate 参考的 conic 强度窗口；透明尾迹是动效的一部分，静态 rim 才负责常驻整圈。stroke 只使用 `border-radius + 两层 ring mask`，不叠加重复 `clip-path`。
- 24 个冻结角度内，四个 22px 圆角弧都必须至少有一帧达到高可见覆盖，同时各角至少有一帧回落为暗态；这同时防止圆角被几何切断和动效退化成整圈等亮。
- `prefers-reduced-motion: reduce` 隐藏完整 beam；开关和运行状态语义不变。
- 自定义只通过 CSS 变量调整现有 beam profile：track width 允许 0.5～4px，bloom blur 允许 0～12px；1.5px bloom 光源、4px 裁切壳、22px 圆角、两层 ring mask 和 conic 强度窗口固定不变；默认 legacy 配置必须与改动前逐像素等价。
- 设置行使用 `Tooltip` + 28px `IconSettingsOutline16` 图标按钮 + `Switch`；齿轮紧邻 Switch 左侧，Switch 的右边界与同组其他设置行对齐。设置面使用可滚动 `Modal`，含同源实时预览、分组 profile 控件、颜色输入、恢复默认、取消、保存、预设管理与 JSON 剪贴板导入导出。
- active 偏好持久化在 `ui-conversation.composerBeamStyle`，用户预设持久化在 `ui-conversation.composerBeamPresets`，保存时两者通过一次 namespace mutation 一起提交；旧设置缺字段时采用默认值，错误或越界数据在采用边界被归一化，预设库最多 5 项。
- 模式只描述视觉 / 运动 profile；不读取聚焦、输入、发送、完成、失败等业务状态，也不新增状态灯。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/ComposerBeam.tsx`、`ComposerBeam.module.css`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/submission-settings.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/submission-policy.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/contract/slots.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/settings/BeamRow.tsx`、`BeamRow.module.css`、`BeamSettingsModal.tsx`、`BeamSettingsModal.module.css`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/locales.ts`
- `vendor/deepseek-harness/packages/client/ui-conversation/tests/input-bar-beam.client.spec.ts`、`composer-beam-settings.client.spec.ts`、`input-bar.client.spec.tsx`
- `vendor/deepseek-harness/packages/client/ui-conversation/tests/beam-row.client.spec.tsx`、`submission-policy.client.spec.ts`、`host.client.spec.ts`、`chat-apply.client.spec.tsx`
- `vendor/deepseek-harness/packages/client/ui-conversation/README*.md`
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-composer-beam-settings.*`
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-08-composer-beam-settings-expansion.*`
- `vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-28-composer-beam-pointer-events.*`
- `src/shared/harness-desktop-forks.js`、`harness-desktop-forks.test.js`
- `scripts/run-composer-beam-corners.cjs`、`package.json`（Chromium 像素门禁）
- 本卡、`docs/features/README.md`、`docs/design-language*.md`、`docs/motion*.md`

## Do not touch

- composer 运行状态与发送 / Queue / Stop 行为。
- 6px stack gap、统计 / 峰谷行布局与 composer resize 几何。
- `mobile/web` beam；手机端只共享时间值，本修复不改变其暂停期界面。

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor focused `beam-row.client.spec.tsx` + `submission-policy.client.spec.ts` + `host.client.spec.ts` + `input-bar-beam.client.spec.ts` + `input-bar.client.spec.tsx`；`pnpm run test:gui`；桌面 fork marker tests；Electron Chromium 在实际 654×193 半透明壁纸卡上的默认与极值整轮四角亮峰覆盖 / 暗帧对比 |
| Manual / QA | 设置弹窗 Save / Cancel / Reset 与重开持久化；深色与壁纸模式各触发默认及自定义思考态：四角无平切、dock 不染色、toolbar 与 Stop 可点击 |

## Sources

- Decision: none

- Design: [设计语言](../design-language.md) / [动效规范](../motion.md)
- Agent Note: [Composer thinking beam must not capture toolbar clicks](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-28-composer-beam-pointer-events.md)
- Agent Note: [Composer beam settings](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-composer-beam-settings.md)
- Agent Note: [Composer beam settings expansion](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-08-composer-beam-settings-expansion.md)
- Implementation entry: `ui-conversation/src/client/skeleton/InputBar.tsx` / `ui-conversation/src/client/ComposerBeam.tsx`
- Visual reference: [Libraries.dev Border Beam](https://libraries.dev/beam)
