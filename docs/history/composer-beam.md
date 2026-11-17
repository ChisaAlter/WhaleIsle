# composer-beam · 历史记录

自功能卡 [docs/features/composer-beam.md](../features/composer-beam.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-23 — 合并回归恢复 InputBar 的 `.cardBody` 层级与纵向布局；beam 定向 6/6 通过，真实像素门禁待重跑。此前 2026-09-12 — 设置面板预览区改为 `.previewStage` sticky 置顶（不透明 layer-2 底 + 底部发丝线，滚动调色板/控件区时预览常驻可视）；调色板色条按 `draft.hue` 同步 `hue-rotate`，色条所示即偏移后的实际生效色，消除"切换色板感觉没生效"的错觉；focused 3 文件 17/17 与包内 tsc --noEmit 通过。此前 2026-09-12 — 修复非 legacy 色板把无窗口整圈 conic 同时套到 inner 柔光与 bloom 光源上（inner 被淹没成整片饱和色、bloom 退化为整圈常亮晕）：拆出 `--dsh-composer-beam-inner-gradient`（原 4 团 radial 位置/透明度，色板取色）与 `--dsh-composer-beam-bloom-gradient`（原 58%–82% 行进亮峰窗口，色板取色），stroke 仍消费 `--dsh-composer-beam-palette-gradient` 并补齐首尾闭环；色板点选与其余控件一致标记 `custom` 模式；`run-composer-beam-corners.cjs` 变量清单同步。focused 6 文件 125/125 与包内 tsc --noEmit 通过。此前 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：上游引入官方 Switch primitive（与本卡既有 Switch AA 合并），保留 `.track` 注入 API 并对上游 `.switch .thumb` 应用设计语言 motion token；beam-row spec 与 Desktop tests 1450 全绿。此前 2026-09-08 — 第一批与第二批设置扩展已实现；补充修复 Interface 设置行操作区：齿轮置于 Switch 左侧，Switch 与同组设置行共用右侧对齐线。focused 3 文件 89/89、GUI 420 文件 / 5496 tests passed / 1 skipped、official build、client package verification、桌面 1447 passed / 2 skipped、fork markers 10/10 与 Electron Chromium 四角/8 套配色门禁通过。全局 i18n 与 web replay 的既有环境问题记录在 Agent Note。 |
