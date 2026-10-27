<div align="center">

# dsh-usage-panel

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Token 用量统计插件，在 Web GUI 的「设置 → 消耗统计」下展示。插件通过会话投影机制增量聚合持久化会话日志，永不写回任何数据。

[English](README.md) · [![npm](https://img.shields.io/npm/v/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![npm downloads](https://img.shields.io/npm/dm/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) [![CI](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfredChaos/dsh-usage-panel/actions/workflows/ci.yml) [![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin) [![Mentioned in Awesome DeepSeek Harness](https://awesome.re/mentioned-badge.svg)](https://github.com/0xsline/awesome-deepseek-harness)

<img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/demo.gif" width="620" alt="dsh-usage-panel v0.2 使用演示：加载、KPI 动画、热力图入场、悬停明细与时间范围切换" />

</div>

## 页面内容

- **汇总数据（全部历史）** —— 未缓存输入 **+** 输出 Token（与本地 Magpie 网关的口径一致；缓存读写是独立统计，显示在次级文字里）、会话数量（次级标注总会话数与主/子代理用量拆分）、最常用模型及其占比。
- **缓存命中率** —— `缓存读 ÷（未缓存输入 + 缓存读 + 缓存写）`，附读写绝对量。
- **费用合计（估算）** —— 按模型定价的全历史费用，附峰段/谷段拆分；详见「费用与计价」。
- **活跃热力图** —— 半年数据窗口内按 UTC 自然月展示（列为周、行为星期），‹ › 切换月份。按当月非零日用量的四分位分 4 级色阶。
- **每日柱状图** —— 按模型堆叠的每日用量，可切换最近 7 / 14 / 30 天。
- **会话用量排行** —— 最耗 Token 的 10 个会话（含折叠标题），每行按委派深度标注**主会话**或**子代理**，并带估算费用列。
- **服务商用量** —— 多 Provider 时以横向条形按路由展示各自 Token 消耗。
- **模型环形图** —— 各模型全历史占比，旁边列出前 5 名；每行带**缓存命中率**列，颜色与对应分段一致。
- **导出** —— 完整 JSON、每日 CSV、模型 CSV（防公式注入、RFC 4180、UTF-8 BOM；费用列以整数分计）。
- **计费设置** —— 导出旁的「设置」弹层：逐模型自定义价（模型列表与 DSH 提供商目录同步 + 用量中见过的模型）。它是全应用**唯一的价格编辑器**，harness 自带的价格面板已删除。价格持久化在 harness 的会话设置段，而不是本插件自有的记录——见「费用与计价」。

输入框下方的峰谷状态 / 当前会话费用行**不属于本插件**：由桌面 harness 的 `ui-conversation` `PeakValleyRow` 独占（界面设置 → 「会话累计费用」）。本插件不向 `conversation.composer.dock` 注册任何条目，避免同一行信息重复出现两次。

悬停柱子、热力图格子或环形图分段可以看到具体明细：

| 柱状图悬停 | 概览（KPI + 热力图） | 会话排行与服务商 |
| --- | --- | --- |
| <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-hover-bar.png" width="200" alt="柱状图悬停明细" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-overview.png" width="200" alt="KPI 卡片与热力图概览" /> | <img src="https://raw.githubusercontent.com/AlfredChaos/dsh-usage-panel/main/assets/screenshot-sessions.png" width="200" alt="会话用量排行与服务商用量" /> |

## 安装

插件以 bundle 形式发布：`dsh plugin add` 会把它追加到 profile 的 bundle 列表，patch 行负责挂载 Host 半。

```sh
# 从 npm 安装（推荐）
dsh plugin --profile web add dsh-usage-panel

# 或从 GitHub 安装
dsh plugin --profile web add github:AlfredChaos/dsh-usage-panel

# 或从本地目录安装
dsh plugin --profile web add ./dsh-usage-panel
```

重启 `dsh --profile web`，打开「设置 → 消耗统计」。npm 包内 `lib/` 下是预构建的纯 JavaScript 产物，无安装脚本；GitHub 安装同样不需要 pnpm 的构建放行，因为仓库里提交了相同的文件。卸载：

```sh
dsh plugin --profile web remove dsh-usage-panel
```

## 数据来源

Host 半聚合持久化会话日志：

- **主路径（增量）**：注册一个会话投影（`ctx.sessionProjections`，带 `stateVersion` 校验），把每个已提交事件折叠进四个互斥桶 —— 未缓存输入 / 输出 / 缓存读 / 缓存写 —— 以及按模型、按 Provider、按天（UTC）的映射。扫描读取宿主的精确会话观测及其投影，读完立即释放租约，复用宿主已准备的读取，避免复制整份日志并重复回放；首次冷读仍会解码并校验持久化历史。
- **回退路径（全量重扫）**：投影服务不可用时，同一套 reducer 通过只读 `sessionQuery` 服务重放每个会话日志。

记账规则：`request/header` 与 `request/context` 记录模型（context 打底、header 覆盖）；该步骤的 `assistant/message` 用量**替换**流式暂记用量（同一步重试的消息不会重复累计）；`llm/retry` 事件只计重试次数、不计 Token；`compaction/summary` 用量归属其自身模型并单独披露（且**绝不进入费用桶**）；reasoning token 已含于 output，绝不重复相加。

**总量口径**：载荷里每个 `total`（KPI、热力图/柱图、会话与项目排行、模型环形图、CSV 导出）都是**未缓存输入 + 输出**。缓存读 / 缓存写保留各自的桶并单独展示（KPI 次级文字、命中率卡、CSV 的 `cacheRead`/`cacheWrite` 列），**绝不并入任何 total**。缓存命中率仍是 `缓存读 ÷（未缓存输入 + 缓存读 + 缓存写）`。

**可选 Magpie 数据源**：本机 Magpie 网关保留用量账本时（`$MAGPIE_USAGE_FILE`，否则 `~/.config/magpie/usage.jsonl`），Host 折叠其中 `agent: "dsh"` 的行（即 `magpie usage` 里显示的「DeepSeek Harness」），总量 / 最近窗口 / 日桶 / 模型与 Provider 拆分都取自它。账本比会话日志活得更久，因此页面与 `magpie usage` 一致，而不是只报日志还留着的那段历史。模型键用网关的请求路由（`req`，如 `codex/gpt-6.1-sol`）——它正是 DSH 写进会话日志的模型 id，用实际服务的 id（`gpt-6.1-sol`）会对不上任何费用行。模型的 Provider 仍取日志侧（`magpie`，也就是保存价格的作用域键），仅当日志从未见过该模型时才用网关的上游 id（`codex`、`factory` 等）兜底。Provider 行是同一批模型桶的另一种分组，因此加起来仍等于总量。会话、项目、会话排行与费用桶始终来自日志：网关行没有会话身份，也没有计费时段。页面在标题下标注数据来源（折叠的调用数 + 覆盖的 UTC 区间，悬停可看文件路径）；文件缺失或不可读时直接回退到去重后的日志数字。不经网关的流量（例如直接配置的 Provider 路由）在账本作为数据源时不计入总量——这正是「与 `magpie usage` 一致」的含义；删除/改名账本文件即可切回日志口径。

**子会话（fork）去重**：宿主的 `inheritedEventCount` 精确排除继承前缀，fork 不会重复计算父会话用量。恢复时追加的 `session/end-seed` 不会遮掉本会话已有用量；缺少这份元数据的旧调用者保留标记边界规则。

**时区声明**：日桶与导出一律用 **UTC** 自然日（`YYYY-MM-DD`），热力图副标题声明所选月份与 UTC。计费时段使用**北京时间**（UTC+8、无夏令时）——见「费用与计价」。`magpie usage` 自己的按日数字用**本地日**分桶，因此某一天的数字可能相差一个时区偏移，而全历史数字完全一致。

由于从不写回，统计可跨重启存活，并覆盖安装插件之前的会话。

## 费用与计价

所有金额都是**估算，不是账单**——插件无法访问 DeepSeek 计费系统，数字为本地按用量计算。

- **时段（官方）**：高峰 = 北京时间周一至周五 09:00–12:00 与 14:00–18:00；其余一切时刻（周末、晚间、深夜、午间休息）为谷段，按官方空闲价计。官方声明空闲价 = 高峰价的一半。
- **官方价目表**：数据文件，`asOf 2026-08-17` + 官方来源链接，单测锁值。模型：`deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`;命中 / 未命中 / 输出 × 高峰 / 谷段。它是未定价的官方模型所依据的回退列；「计费设置」弹层不再重复渲染这张表（选中模型后，价格输入框里就是该模型的价目列）。
- **整步归类**：一次请求（step）按其 `step/start` 时刻判定时段——跨时段的步骤整步按其开始时刻计费。compaction 不入费用桶。
- **计价**：逐模型、在客户端按峰谷桶计算——改价即时重算所有数字，**绝不重放日志**。解析顺序：你的自定义价（provider 作用域键优先，裸模型兼容）→ 官方列 → **未定价**。未定价模型显示"设置价格"/"—"，绝不猜测；非 DeepSeek 模型须先设自定义价才会出现费用。
- **自定义价**：在用量统计页「计费设置」弹层编辑（每模型：命中 / 未命中 / 输出；可选显式谷段价；可选逐模型关闭「峰谷计价」按单一价计费）。关闭开关时该价格会**写入两列**（高峰与谷段同价）：harness 的记录没有 flat 字段，它把三个顶层数字读作**高峰列**，没有谷段列时按一半推导——所以只带高峰列的 flat 记录在谷段会被计成半价。持久化在 **harness 会话设置段** —— `ui-conversation.sessionCostPrices` —— 这也正是输入框状态条重新计价所读的记录，因此这里改价，状态条立即生效。绝不写入会话日志。
- **旧记录（仅导入）**：v0.3 及更早版本把价格存在本插件自有的 storage-domain 槽 `dsh_usage_panel_billing`。首次启动时该记录会被**一次性**并入上述设置段（键冲突以设置段为准），随后清空；此后插件不再写该域。导入在条件不满足时会推迟，并在后续读取时重试，直到设置段与域都已就绪。
- **峰谷开关**：逐模型，且**打开弹层时跟随该模型已存的记录** —— 存过「关闭峰谷计价」的记录重新打开即关闭，单行（标签为「价格」而非「空闲价格」）显示它自己的价；存过两列价的记录重新打开即开启并回填两行；legacy 单列记录重新打开即开启、空闲行预填高峰价的一半（正是 harness 对该形状的推导值）；无记录但官方有价列的模型重新打开即开启并回填官方两列。只有"无记录 + 官方无价列"才默认关闭且留空。模型下拉没有占位项：打开即选中当前供应商的第一个模型。全局开关已不存在（会话设置段没有该字段）：峰谷计价本身恒为开启，这也是输入框状态条与 KPI 的共同前提。
- **数学**：整数微元 + 最后单次舍入到分；CSV 导出费用列为整数分（未定价的行留空）。

**升级说明（v0.3）**：投影状态版本升至 2；升级后首次启动会对每个会话日志重折一次（分批让步执行，宿主保持响应——大语料不会假死，页面显示"后台更新中"），此后读取保持增量。

**升级说明（价格记录）**：价格现存放于 harness 的会话设置段，输入框状态条正是从该段重新计价。你在本插件更早版本里保存的价格会被一次性并入该段（键冲突以设置段为准），旧记录随后清空——无需重新录入。此前用「关闭峰谷计价」保存过的模型也会被一次性修复：单一价格同时写入谷段列，谷段不再按半价计。

## 加载策略

首次扫描由统计页的数据请求触发；应用启动、空闲和设置搜索的隐藏渲染不扫描历史语料。并发的总览与排行请求复用同一次扫描，已完成的结果复用 10 分钟。旧结果或刷新按钮会等待新的精确扫描，使总量、排行与修复候选对应同一轮已完成读取。浏览器在加载期间展示保存在 `localStorage` 的最近成功载荷（带版本号与结构校验），刷新失败时保留旧数据并如实标注，绝不伪装最新。设置搜索仅渲染统计页标题和偏好行，不加载统计。

## 单位

中文界面：不到 10 万显示整数；≥ 10 万用「万」；≥ 1 亿用「亿」。英文界面：K / M / B。

## 实现

源码为 TypeScript（strict）位于 `src/`，esbuild 构建；`lib/` 产物提交进仓库，安装无需构建步骤。

| 文件 | 说明 |
| --- | --- |
| `src/host/index.ts` → `lib/index.js` | Host 半（Cordis 插件）：投影注册、聚合、带预热的 RPC 缓存、fail-soft 回退、计费 RPC 端点 |
| `src/host/projection.ts` | 纯函数会话投影 reducer（四桶 + 峰谷桶、fork 去重、重试/压缩语义、UTC 日桶、step/start 时段判定） |
| `src/host/aggregate.ts` | 跨会话合并 → overview 载荷（含费用映射） |
| `src/host/magpie-usage.ts` | 可选 Magpie 网关账本数据源：路径解析（`MAGPIE_USAGE_FILE` → `~/.config/magpie/usage.jsonl`）、`agent === 'dsh'` 折叠（总量/byModel/byDay/上游 Provider）、mtime+size 缓存、不可用时干净返回 null |
| `src/host/prices-source.ts` | 价格记录：经 settings 服务读 `ui-conversation.sessionCostPrices`，用 `settings/updated` 保持快照新鲜，并把编辑写回 |
| `src/host/legacy-billing-import.ts` | 旧域 `dsh_usage_panel_billing` 并入设置段的纯函数合并 + 带前置条件的导入 |
| `src/host/billing-store.ts` | 已退役的插件自有价格记录：仅作旧记录读取（外加导入的清理写入） |
| `src/host/types.ts` | 无公开 host 类型包的服务的结构化声明（`connection`、`llm`、`settings`） |
| `src/client/*` → `lib/client.js` | Client 半（`./client` 导出，`__ModuleLoader__` bundle）：TSX 设置页 UI、设置弹层，`--dsw-*` 变量，中英双语 |
| `src/shared/contract.ts` | Host↔client wire 契约（单一来源） |
| `src/shared/pricing.ts` | 官方价目表（asOf + 来源）、解析器、价格校验 |
| `src/shared/billing.ts` | 峰谷窗口数学 + 倒计时 |
| `src/shared/cost.ts` | 整数费用数学（微元 → 分） |
| `src/shared/contract.ts` | host↔client wire 契约（单一来源） |
| `cordis.patch.yml` | Bundle patch：向 profile 组合插入 `usage-stats` 行 |

Host 通过 `ctx.connection.rpc.handle('/usage-stats', …, { authority: 'loopback' })` 提供 `overview` 端点，浏览器经 `rpc.call('/usage-stats', 'overview', …)` 调用。overview 载荷包含 `coverage`（总会话数、主/子代理用量拆分，以及总量来源 `source`/`magpie`）、`topSessions`、`providers`，并保留 v0.1.0 形态的 `days` / `totals` / `byModel` / `allTime`。基于 DeepSeek Harness `0.1.0-rc.6` 开发验证。测试使用 Node 内置 test runner（`npm test`）；CI 执行 typecheck + build + test + 打包门禁。

## License

[MIT](LICENSE)
