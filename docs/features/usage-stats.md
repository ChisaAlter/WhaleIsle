# Feature: 用量统计

| Field | Value |
| --- | --- |
| **id** | `usage-stats` |
| **status** | `active` |
| **last verified** | 2026-10-21 |

历史验证与变更记录见 [docs/history/usage-stats.md](../history/usage-stats.md)。

## User paths

1. 设置 → 「用量统计」（`usage-stats`）：KPI（含估算费用卡）、182 天 UTC 窗口的贡献图热力图（周列×星期行，月份标签置顶；单击选日、Shift+单击选段、方向键导航）、按模型柱/环、Top 会话（含费用列）、导出（含费用列）、「设置」弹层（模型多选 + 峰谷开关 + 自定义价）。热力图点选范围只影响本卡汇总；KPI 和排行榜继续展示全部历史，独立每日图保留自己的 7/14/30 天切换。
2. 会话输入框下方的峰谷状态 / 当前会话费用行**不属于本插件**：由 harness 侧 `PeakValleyRow` 独占（[session-cost-display](session-cost-display.md)，「会话累计费用」开关在本分区顶部）。本插件不得再向 `conversation.composer.dock` 注册条目，否则同一信息会出现两行。
3. 无计费用量（含仅空白会话）走空态文案；扫描失败仍出仪表盘，不挡启动。
4. 刷新从 host RPC 重扫；每轮从空聚合合并当前会话投影各一次，重复刷新不得累加旧总数，不写回日志。

## Invariants

- 计数边界优先使用宿主 inheritedEventCount：只计零基 seq 大于等于继承前缀的事件，恢复追加的 end-seed 不得覆盖边界；缺元数据的旧调用者保留标记兼容。投影 stateVersion 3。

- 预置包名 `dsh-usage-panel`；设置 section id `usage-stats`；投影 key `usagePanel`。同一 profile 只挂一份。
- **桌面内置模块（dsh-im 模式）**：挂载走桌面自有 overlay（`desktop-usage-panel.patch.yml`，**每轮启动**都经 `--patch` 传，含 skip 模式），不写 `cordis.patch.yml` 受管块（该文件纯用户所有，见 desktop-launcher 卡）。`dsh-usage-panel` 在 `DROPPED` 名单：市场/用户 bundle 安装被启动时 `stripDroppedPlugins` 清除，insert + bundle 双挂载不会发生。
- **不可禁用、不可移除**：config `normalizeDisabledPlugins` 剥离别名（禁用名单永不生效），IPC `shell:disable-plugin` 返回 `desktop-builtin`，`shell:remove-plugin` 返回 `preset`；forensics 标记为 `inBox`（桌面内置组件）。
- 只统计 Token 四桶；**总量口径 = 未缓存输入 + 输出**（与本地 Magpie 网关 `magpie usage` 的头条数字同口径）；缓存读/写保留独立桶并单独展示（KPI 次级文字、命中率卡、CSV 列），**绝不并入任何 total**；命中率仍是 `缓存读 ÷（未缓存输入 + 缓存读 + 缓存写）`。**计费为估算**（费用 = 峰谷桶 × 用户价格，全部本地计算,非账单）;不做余额 API。
- **可选 Magpie 数据源（2026-10-21）**：`$MAGPIE_USAGE_FILE` 或 `~/.config/magpie/usage.jsonl` 存在时，host 折叠 `agent === 'dsh'` 行，总量 / 最近窗口 / 日桶 / 模型与 Provider 拆分取自账本，因此页面与 `magpie usage` 一致（日志历史被轮转后不再少报）。模型键用网关的 `req`（`codex/gpt-6.1-sol`，即 DSH 日志的模型 id），Provider 取日志侧（`magpie`，价格作用域键），仅日志未见过的模型用网关上游 id 兜底；Provider 行由同一批模型桶分组，和恒等于总量。会话/项目/会话排行/费用桶仍来自日志（网关行无会话身份、无计费时段）。文件缺失或不可解析即回退到去重后的日志数字。`coverage.source` = `logs|magpie` + `coverage.magpie`（calls/from/to/file）在标题下方明示来源；不经网关的直连 Provider 流量在账本口径下不计入总量。
- 峰谷口径：北京时间 UTC+8 无夏令时,周一至五 09:00–12:00、14:00–18:00 高峰;整步按 step/start 时刻归类;compaction 不入费用桶;官方价目 asOf 2026-08-17 + 来源链接 + 单测锁值。
- 不猜价：未定价模型显示"设置价格"/"—",绝不编造数字(竞品红线延续)。
- 日桶 UTC；字幕声明 UTC。
- 颜色只走 `--dsw-alias-*` / `--dsw-static-deepseek-*`；刷新/导出/设置弹层用 `ui-primitives`；零 DOM 探测。客户端只注册 `settings.section`，**不注册** `conversation.composer.dock`（`src/shared/composer-family-width.test.js` 钉死）。
- 价格持久化 = 插件自有 JSON(storageDomain 域 `dsh_usage_panel_billing`),不写入会话日志;记录形状 `{prices, peakValleyEnabled}`，旧字段 `stripVisible`/`peakHintVisible` 只读容忍、不再写出。
- **损坏日志修复(用户授权,只读承诺的唯一例外)**:扫描失败的会话 id 在覆盖度中列出;页面显式「自动修复」→ 仅重写该损坏工件——即后端实读的**最高 canonical 代**(`session.vN.jsonl.zstd`,v0 为 `session.jsonl.zstd`),不碰迁移遗留旧代(解码全部行→0 基连续重编号→重打包 zstd→原子替换,先备份 `.bak-<ts>`);解码失败即中止;健康日志永不触碰。解码器为插件内置 `src/host/storage-rows.ts`(rc.6 `decodeStorageRecord` 忠实移植,未识别的 `-chunks` 标签中止),不 import `@deepseek-ai/dsh-session`——vendored pin 已删该导出,混合树会撞 `CallId`/`ToolCallId` 漂移;standalone npm 同样可用(找不到工件仍优雅报错)。
- **v3 工件走准入重写而非重编号(2026-09-25)**:头部 `version:3` 的日志由迁移链代读,迁移对不在冻结 `RELEASED_V3_EVENT_TYPES` 且未标 `ignorable` 的事件类型硬拒(`session/presentation`、`user-questions/asked` 即此类桌面期类型);修复对这类工件只补 `ignorable: true`——seq/`sourceEventSeqs`/`surfaceOp` 引用与打包行逐字节保留,由 harness 自身迁移管道在 read 时升级、write 时落盘 v4。版本 > 4 显式拒绝,绝不按本版假设改写外来格式。
- 修复 RPC 只接受本轮扫描报告为失败且不含路径分隔符的会话 ID；身份可以是 `session-whale-<uuid>`、普通 `session-<uuid>` 或旧的裸 UUID，不能用十六进制字符表限制真实身份。目录定位优先完整 ID。
- 安装落点是桌面 `dsh-home/profiles/web`，不是 `~/.dsh`（见 [dsh-home](dsh-home.md)）。
- 预置失败硬失败，挡 `dsh web`（桌面运行时损坏，skip 模式无法修复）。
- **挂载用链接，不维护 profile 副本（2026-09-22）**：`profiles/web/node_modules/dsh-usage-panel` 是指向 runtime 目录（`vendor/dsh-usage-panel`，打包后为 resources 内同路径）的 junction/symlink；`desktop-plugins/dsh-usage-panel/` 只存 overlay 文件。前提是**面板运行时代码只读**——可写状态（`prices` / `peakValleyEnabled`）只落 `dsh_usage_panel_billing` storage domain，不得写进自身安装目录。链接目标未变时不得 unlink/relink。旧版本留在 `desktop-plugins/dsh-usage-panel` 的整份副本在首次启动删除（迁移）。`missingRuntimeFiles` 的 fail-closed 依赖检查不因链接而放宽。

## Allowed touch

- `src/main/usage-panel-preset.js`、`harness-controller.js`、`index.js`（启动接线）
- `vendor/dsh-usage-panel/`（预置插件源与改版 client）
- `scripts/setup-harness.js`、`scripts/after-pack.js`、`package.json` extraResources
- 相关桌面测试、本卡、handbook 用量章、QA `TC-EXT-008`

## Do not touch

- 上游 token-meter / StatsPills / ContextMeter — 例外：StatsPills 宽度联动由 [composer-family-width](composer-family-width.md) 卡拥有
- 账户余额 API、/user/balance、侧栏 footer 的余额能力
- 无关邻域：市场窗、壁纸、Surfaces（除非用户扩大 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/usage-panel-preset.test.js`、`harness-controller.test.js` 接线、extraResources / gitignore 钉死；`qa:source` / `release-ui-walk` 的 `usage-stats` 分区存在 |
| Manual / QA | `TC-EXT-008`（空态含仅空白会话算通过）；有用量时 KPI 整数（不到 10 万）为 P1 |

## Sources

- Decision: [用量统计以宿主继承前缀判定计数边界](../decisions/implemented/bug-fix/2026-09-29-usage-inherited-boundary.md)

- Decision: [用量统计面板改挂运行时链接，不再维护 profile 副本](../decisions/proposed/architecture/2026-09-22-usage-panel-runtime-link.md)
- Decision: [紧凑月历与会话修复身份](../decisions/implemented/product/2026-09-23-usage-calendar-repair.md)
- Decision: [用量热力图改贡献图、会话修复解码器内置](../decisions/implemented/product/2026-09-25-usage-heatmap-graph-repair-codec.md)
- Decision: [上游 0.1.7 后内置插件契约漂移的统一修复与回归闸门](../decisions/implemented/bug-fix/2026-09-25-vendored-plugins-017-contract-drift.md)

- Handbook：[../handbook/modules/usage-stats.md](../handbook/modules/usage-stats.md)
- Spec：[../superpowers/specs/2026-08-23-usage-stats-design.md](../superpowers/specs/2026-08-23-usage-stats-design.md)
- Implementation entry：`src/main/usage-panel-preset.js` `ensureUsagePanelPlugin`
