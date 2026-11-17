# Feature: Wallpaper gallery

| Field | Value |
| --- | --- |
| **id** | `wallpaper-gallery` |
| **status** | `active` |
| **last verified** | 2026-09-01 |

历史验证与变更记录见 [docs/history/wallpaper-gallery.md](../history/wallpaper-gallery.md)。

## User paths

1. 设置 → 外观 → 壁纸行：本地挑选图片 → 裁剪（窗口比例 JPEG）→ 可选 frost / pixelate。
2. 同页点「浏览图库」→ 顶部分类页签 + 搜索，下方网格（含必应、Wallhaven、收藏）。
3. 星标收藏 → 点缩略图 → 确认设为壁纸 → 是 → 裁剪；否 → 图库仍开着且不换壁纸。
4. 图库窗内图源：新增 / 编辑 / 删除具名 HTTPS JSON 目录；Appearance 行不出现源列表或裸 URL。
5. 清除壁纸后恢复无壁纸底（已开启「背景特效」时回到特效底，见 [background-gradient](background-gradient.md)），frost / pixelate 仅在有图时可用。

## Invariants

- Appearance 壁纸行**只**做：挑选、浏览、裁剪、frost、pixelate。无源列表、无 JSON URL、无 Bing 开关堆在 Appearance。
- 浏览打开**同一产品窗**（非独立 Electron 市场窗）：分类 + 搜索在上，网格在下。
- 全部图源 CRUD 只在图库窗内；禁止把配置倾倒到 Appearance。
- 用户源为具名 HTTPS JSON 目录。主进程拒绝 loopback / RFC1918 / link-local / CGNAT（100.64.0.0/10）/ benchmark（198.18.0.0/15）/ 组播与保留段目录与下载——判定基于解析后的 IP（`net.BlockList`），IPv6 字面量的 `::/96`、`::ffff:0/96`、`64:ff9b::/96` 先还原成内嵌 IPv4；URL 不得携带 userinfo，且主机名在 DNS 解析后复检 IP、连接固定到已复检地址（自定义 `connect.lookup`，无二次解析；`DSHD_WALLPAPER_ALLOW_HTTP=1` 仅测试机）。
- 分类页签 = 当前源列表 + 收藏。
- Desktop 图源 catalog 拉取超时 30 s、单图下载 20 s（`src/main/wallpaper-catalog.js`，2026-08-22 由 8 s 调宽以容纳慢源）；改值须同步本卡。
- 禁源：Unsplash / Pexels / Pixabay Key、Timeline 登录、R18 开关不进产品。
- 视觉：`ui-primitives` + `--dsw-alias-*`；不抄 `marketplace.css` hex；不第二套皮肤。
- 无 desktop preload 时不显示「浏览」按钮。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-theme/src/client/Wallpaper*.tsx`（含 `WallpaperRow`、`WallpaperGalleryModal`、`WallpaperSources`、`WallpaperCropModal`）
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/AppearanceSection.tsx` 与 `.module.css` — **仅**壁纸行接线与样式，不新增 Appearance 图源 UI
- `vendor/deepseek-harness/packages/client/ui-theme/src/client/locales.ts`、`wallpaper-shell.ts`、`theme-settings` / wallpaper 相关纯逻辑
- `vendor/deepseek-harness/packages/client/ui-theme/tests/appearance-section.client.spec.tsx`（及相关壁纸单测）
- `src/main/wallpaper-catalog.js`（及 desktop preload / IPC 中壁纸 catalog / download 接线）
- 本卡与 [.cursor/rules/wallpaper-gallery-product.mdc](../../.cursor/rules/wallpaper-gallery-product.mdc)

## Do not touch

- 在 Appearance 上画图源列表、Bing 开关、裸 catalog URL 表
- 引入 Unsplash/Pexels/Pixabay/Timeline/R18 产品入口
- 新开独立 Electron 图库窗或市场皮肤
- 无关邻域：Models、MCP、Marketplace、Surfaces、boot 页（除非用户明确扩大 `Touching`）

## Gates

| Kind | What |
| --- | --- |
| Automated | Harness：`packages/client/ui-theme` 的 `tests/appearance-section.client.spec.tsx`（及壁纸相关 client 单测）。Desktop：`npm run qa:source` 覆盖图库入口存在性（不替代实机） |
| Manual / QA | [TC-APP-002](../qa/production-acceptance-test-cases.md) … [TC-APP-010](../qa/production-acceptance-test-cases.md)（§9 外观与壁纸图库；主题库 TC-APP-011 非本卡） |

关键手测最短路径：浏览 → 见分类/搜索/网格 → 收藏 → 确认设壁纸 → 裁剪生效；Appearance 无图源控件。

## Sources

- Decision: none

- Handbook: [../handbook/modules/wallpaper.md](../handbook/modules/wallpaper.md)、[../handbook/flows/wallpaper-set.md](../handbook/flows/wallpaper-set.md)
- Design language: [docs/design-language.md](../design-language.md)
- Spec: [docs/superpowers/specs/2026-08-19-wallpaper-gallery-window-design.md](../superpowers/specs/2026-08-19-wallpaper-gallery-window-design.md)
- Plan: [docs/superpowers/plans/2026-08-19-wallpaper-gallery-window.md](../superpowers/plans/2026-08-19-wallpaper-gallery-window.md)
- Agent Note: [vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-18-wallpaper-gallery-and-crop.md)
- Short rule: [.cursor/rules/wallpaper-gallery-product.mdc](../../.cursor/rules/wallpaper-gallery-product.mdc)
- Implementation: `WallpaperRow.tsx`、`WallpaperGalleryModal.tsx`、`src/main/wallpaper-catalog.js`
