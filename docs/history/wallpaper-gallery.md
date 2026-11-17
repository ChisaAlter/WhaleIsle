# wallpaper-gallery · 历史记录

自功能卡 [docs/features/wallpaper-gallery.md](../features/wallpaper-gallery.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-09-01 — pin 提交误截 UTF-8 后已从 `6e91ea69` 恢复 `appearance-section.client.spec.tsx`（保留 0.1.2 store/session 导入）；定向 vitest 31/31。此前 2026-08-25 — `qa:source` 首次云端全绿（出网 Linux + xvfb，英文局点）：`appearance.localCrop`/`gallery.confirmSet`/`appearance.frost` 三步 PASS（crop confirmed / Bing confirmed and cropped / frost+pixelate）。此前「3 项环境失败」根因 = walk 裁剪匹配器缺英文标题「Adjust wallpaper」（QA 基础设施缺口，已补；产品零改动）+ 旧无网环境缩略图不加载。此前 2026-08-24：SSRF 加固（封 CGNAT/benchmark 网段并在 DNS 解析后复检 IP）。2026-11-17 — #508：连接固定到 DNS 复检后的地址（每请求 dispatcher 自定义 `connect.lookup`，无二次解析），消除 rebind 窗口；`wallpaper-catalog.test.js` 新增 rebind 用例 |
