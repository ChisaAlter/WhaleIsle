# AGENTS.md — dsh-usage-panel

Maintenance authority: [WhaleIsle sole project policy](../../docs/maintenance/README.md). This file locates module contracts and mechanics; it cannot add independent maintenance gates, approvals or execution order.

DeepSeek Harness 的 Token 用量统计插件（设置页「消耗统计」）。Host 半只读重扫会话日志 + RPC，Client 半渲染 KPI / 热力图 / 堆叠柱图 / 环形图。本文档是给 AI 与协作者的项目说明书：开发策略 + 踩坑记录。**新坑踩到后必须即时回填本文档。**

## 1. 仓库与迭代规范

- **main 冻结**：每次发布后 main 即"已打包状态"，禁止直接在 main 上开发。新迭代一律：
  ```sh
  cd dsh-usage-panel
  git worktree add -b vX.Y.0 ../dsh-usage-panel-vX.Y main
  ```
  在 worktree 分支上开发 → 合并回 main → `npm version` → 发布 → 打 tag → `git worktree remove` 清理。
- 发布过的版本由 tag 保留（当前 `v0.1.0`）；紧急热修走 `vX.Y.1` 短分支，同样不碰 main 直接改。

## 2. 常用命令（v0.2.0 TS 化后）

```sh
npm install          # devDeps: typescript / esbuild / @types/react / @deepseek-ai/* (rc.6, 带 .d.ts)
npm run build        # esbuild: src/host → lib/index.js (ESM) + src/client → ModuleLoader CJS + 声明
npm run typecheck    # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test             # node --test（tests/ 纯函数单测，fixture 锁口径）
npm run check-pack   # 打包门禁（见 §3）
npm pack --dry-run   # 发布前人工确认清单
```

## 3. npm 打包与发布硬性规则

1. **禁止把 README 的静态资产打进 tarball**（`assets/` 下任何 gif/png 等）。`package.json` 的 `files` 白名单只含 `lib/`、`cordis.patch.yml`、`README.md`、`README.zh-CN.md`。
2. `assets/` 只存 git（GitHub 页面渲染用）；README 内图片一律引用 GitHub raw 绝对 URL（npm 页面不依赖 tarball 资产也能渲染）。
3. `scripts/check-pack.mjs` 门禁挂在 `prepublishOnly` 与 CI publish：解析 `npm pack --dry-run --json`，出现 `assets/` 前缀或图片扩展名即失败。**任何人不得绕过。**
4. 发布顺序：build → typecheck → test → check-pack → `npm publish`（OIDC Trusted Publishing，无 token）→ tag 推送。
5. 历史教训：v0.1.0 tarball 实测含 5 张图约 766KB（demo.gif 578KB），属于打包污染，v0.2.0 起修复。

## 4. 架构与代码规范

- 分层：`src/shared/`（双端纯函数，无 IO）→ `src/host/`（Cordis 插件，node ESM）→ `src/client/`（浏览器，React TSX）。
- **wire 契约单一来源**：host↔client 的载荷/错误码只定义在 `src/shared/contract.ts`，双端 import，禁止两端各自手写形状。
- 组件拆分：单文件 ≤ ~300 行（竞品 token-usage 的 1453 行 god component 是反面教材）。
- host 错误只返回**机器可读错误码**，client 按码查词典渲染——禁止 host 返回中文文案再由 client 正则匹配翻译（dashboard `i18n.tsx:26-45` 的脆做法）。
- 纯函数先行：聚合/单位换算/四分位/导出防护等逻辑必须先抽成纯函数 + 单测，再进 UI。
- 客户端 bundle 形态是硬契约：`window.__ModuleLoader__.load({ id: 'dsh-usage-panel', factory(require) })`，`exports.apply` + `exports.inject`。改这个形状等于破坏宿主加载。构建 = esbuild + `scripts/wrap-client.mjs`（wrapper 里 `var React = require('react')` 供经典 JSX transform 使用）。
- **数据路径二选一（同一 reducer）**：投影模式（`sessionProjections` + `sessionProjectionCache`，增量落盘）与全量重扫模式（`sessionQuery` 重放）共用 `src/host/projection.ts` 的 `applyEvent`。加记账逻辑只改 reducer + 单测，两路同时生效。模式切换在 `src/host/index.ts` 的 `mode` 判定，fail-soft（注册失败 → scan → none）。
- 测试：`tests/*.test.ts` 用 esbuild 编译后跑 Node 内置 test runner；fixture 锁口径（UTC 日桶、fork 去重、重试替换、压缩归因）。

## 5. 正确性红线（本项目的壁垒，任何重构不得破坏）

1. **fork 去重**：宿主提供 `inheritedEventCount` 时只计零基 `seq >= inheritedEventCount` 的用量，后续 end-seed 不得移动边界；旧调用者才回退标记/seedLength（见 §6.11）。
2. **双源模型归因**：`request/context.model` 打底，`request/header.config.model` 覆盖。
3. **四桶记账**：input/output/cacheRead/cacheWrite 分开；v0.2.0 起升级为落盘投影后：流式 `assistant/chunk` 的 provisional usage 必须被最终 `assistant/message` 覆盖；`llm/retry` 独立计数；`compaction/summary` 独立归因；reasoning 已含于 output，不重复加。
4. **日期口径 UTC**：dayKey 用 UTC 桶（v0.1.0 用本地时区，跨时区漂移），README 与 UI 必须显式声明口径。
5. **只读承诺**：永不写回原始会话日志；投影机制的落盘是框架对派生缓存的落盘，不触碰原始日志。**唯一例外(用户授权的自动修复)**：仅当框架报告某会话日志损坏(如 seq gap)时，用户从统计页显式点击「自动修复」→ 只重写该损坏工件(解码全部行→0 基连续重编号→重打包→原子替换)，先落 `.bak-<ts>` 备份；解码/序列化任一失败即中止不写；健康日志永不触碰。
6. **安全边界**：RPC `{ authority: 'loopback' }`，不开放裸 HTTP 端口。
7. **入口稳定**：`settings.section` id `usage-stats`、order 25、RPC 通道 `/usage-stats`——这些 id 被宿主配置引用，改名即破坏安装。
8. **总量口径 = 未缓存输入 + 输出**（`totalsFrom` / `sortedModels` / `buildDayWindow` / `recentTotals` / 手动 total / 会话排行 / 环形图 / CSV 导出）。缓存读/写只保留在自己的桶里单独展示，**绝不并入任何 total**；`UsageTotals` 的四个桶与费用数学不变，命中率公式不变。派生 total 只能出现在视图/派生层，投影状态里仍然没有 `total` 字段。
9. **Magpie 账本（可选源）不改变归因规则**：模型键必须是 DSH 日志里的模型 id（网关 `req`，如 `codex/gpt-6.1-sol`），Provider 取日志侧映射（如 `magpie`，即价格作用域键），网关上游 id 只作日志未见模型的兜底；账本不可用时干净回退日志，`coverage.source` 明示来源。

## 6. 踩坑记录（本项目真实踩过/分析确认的坑）

### 6.1 v0.1.0 数据正确性缺陷（v0.2.0 修复）

| 坑 | 现象 | 修复 |
|---|---|---|
| 静默吞错 | `catch (err) { continue }` 跳过坏会话，汇总永远像完整账单 | 覆盖度诊断：payload.coverage 计数 + 日志披露 + UI 声明"部分数据" |
| 本地时区 dayKey | "今天"边界随设备时区漂移 | UTC 桶 + 单测锁口径 |
| 重试重复累计 | 同一 step 多条 `assistant/message`（重试）被重复计入 | 落盘投影：authoritative 覆盖 + retry 独立 |
| 压缩混入普通用量 | compaction 产生的 token 计入常规输出 | 投影中 compaction 独立归因 |
| 缓存数据白采集 | cacheRead/cacheWrite 已采集但只并进"输入"展示 | 四桶独立露出 + 缓存命中率 KPI |

### 6.2 代码级边界坑（TS 重构时保留原注释，不得删）

- **React hook 顺序不变量**：KPI 的 `useCountUp` 必须在条件渲染分支之前无条件调用，否则 hook 顺序错乱。
- **环形图不能用 `transform` 属性定位段**：`dsw-ust-donut-spin` 关键帧拥有 rotation，CSS transform 会被覆盖；段定位只能靠 `strokeDashoffset`。
- **SVG circle 的 bbox 是整图**：donut tooltip 不能用 rect 锚定（所有段都会钉到同一位置），必须用 `e.clientX/Y` 跟随指针。
- **日期解析**：`new Date('YYYY-MM-DD')` 会按 UTC 解析导致非 UTC 时区日偏移；必须手动 `new Date(y, m-1, d)` 构造本地午夜。
- **SWR 竞态**：inflight 去重 + `disposed` 检查 + `ctx.effect` 清理定时器，三者缺一就会在卸载后回写缓存或泄漏定时器。
- **样式注入生命周期**：`<style data-plugin-css>` 挂 effect 清理；重复加载时先查现有 tag，否则 HMR/双挂载产生重复样式。

### 6.3 竞品红线（明确不吸收，见 iteration-strategy.md §6）

200 会话静默截断（token-stats）；裸 HTTP 无 authority（token-stats）；不看页面可见性的 10s 轮询（token-stats）；无 fork/seed 去重（dashboard）；硬编码虚构价格表（dashboard）；宿主 DOM 探测做悬浮窗（dashboard）；host 文案正则做 i18n（dashboard）；缓存字段白名单人工维护（dashboard）；1453 行 god component（token-usage）；install.js 字符串改用户 patch（token-stats）；tsdown 硬依赖 monorepo checkout（token-usage）。

### 6.4 v0.2.0 开发期踩坑（TS 化 + 投影期间真实踩过）

- **DSH locale ID 是 `'zh'` / `'en'`，不是 `'zh-CN'/'en-US'`**（真实事故：词典注册到错误 ID 下，页面全部显示原始键 `nav.label` 等）。注册用 `locale.register(NS, { zh: dict, en: dict })`；内部 Locale 类型 `'zh-CN'/'en-US'` 只是我们的归一化表示。
- **locale 运行时的 `translate` 找不到键时"fail loud"返回键本身**：`translated(key) || 本地词典` 这类兜底会被"键本身"这个真值绕过，必须显式 `text === key` 判失败再走本地词典；且 `translated` 调用不要传 params（插值统一由我们做）。
- **`i18n.locale` 必须是 getter**：字段快照在语言切换后保持旧值，格式化函数会一直用初始语言。
- **`ctx.on('locale/change', …)` 直接挂在 ctx 上**（cordis Context 就是 EventEmitter，没有 `ctx.events`）；更稳的是挂 `locale.subscribe(update)`（切换与迟到词典注册都会 bump revision）。
- **投影注册表的冷折叠是单趟**：`buildCell` = `init()` + 逐事件 `apply()`，无回看。种子边界因此用"武装"语义：看到最后一个 `session/end-seed` 之前**一律不计数**；`foldEvents`（自控路径）必须先预扫最后一个标记再折叠；`session/end-seed` 分支必须"last marker wins"（`seq <= seedEnd` 时保持原值），否则预置的 seedEnd 会被更早的标记覆盖。
- **step/start 仅在"计数历史"内武装**：种子里的 step/start 若入 `stepStart`，fork 会话（turn/step 重置）的活 step 会被种子时刻错误归类——`step/start` 分支先过 `isCounted`。`assistant/message` 覆盖时**继承已有 step 的峰谷快照**（消息晚于下一步 start 到达时不得重采样）。
- **storageDomain 域打开是 async，`apply` 不能 await**：BillingStore 先内存态、域打开后 `attachMedium` 升级（升级不清已有缓存，内存期保存不丢）；域/表名必须匹配 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`，无连字符）。
- **npm rc.6 类型面缺 `stateOf`/`listModels`**：桌面宿主有；沿用 `register()` 的既有先例——局部结构化断言，不依赖宿主类型包。
- **UI 偏好双面同步**：设置弹层与输入框条共用 bundle 内发布订阅（`billing-bus`），host JSON 是唯一持久源——条自行拉取一次，之后都由总线推送，改价零刷新即时生效。
- **弹层加载禁止"无 catch 的 Promise.all"**（真实事故）：计费弹层一度用 `Promise.all([billing.get, billing.models])` 且无 catch/finally，`billing.get` 一失败 `setLoading(false)` 永不执行 → 弹层永远"正在统计会话日志…"。规则：RPC 组合必须 allSettled / 独立 catch + 错误态/重试；模型目录（可能含死端点的 `listModels`）必须在 host 侧用 `withTimeout` 兜底、client 侧懒加载降级为空 + 手动添加。
- **大语料扫描必须让步**：`coldSnapshot` 版本不匹配时会从 seq 0 全量重折（同步循环）；扫描循环每批让步 `setImmediate` + 进度日志（`scanPacer`），投影/回退两条路径都有。
- **RPC 调用必须显式传 payload 对象**（真实事故）：传输层 `JSON.stringify` 会丢掉值为 `undefined` 的键，而宿主 envelope schema `clientRequestSchema` 的 `payload` 键必填 → 不带 payload 的 `rpc.call(channel, endpoint)` 一律报 `invalid client-request message`。规则：所有 `call*` 封装显式传 `{}`，禁止省略第三参。
- **竞品红线（计费口径）**：不猜价——未定价显示"设置价格"/"—"；非 DeepSeek 模型须自定义价；费用一律"估算,非账单"；高峰期窗口/官方价目是数据文件(asOf+来源+单测锁值)，绝无写死的假表。
- **`mergeSessionValue` 是纯函数**：返回值必须重新赋值（`a = mergeSessionValue(a, …)`），漏掉会静默丢数据——scan.ts 与 index.ts 都踩过。
- **zod v4 的 `z.record` 签名变了**：`z.record(valueSchema)` 在 v4 里被当作 key schema；必须 `z.record(z.string(), valueSchema)`。
- **`SessionId` 是品牌类型**：`readSession/readTitle/coldSnapshot` 拒绝裸 `string`；用 `header.id` 本体，别 `String()`。
- **修复 RPC 不得假设会话 ID 是 UUID**：桌面受管会话可用 `session-whale-<uuid>` 等前缀。校验应以本轮 `failedSessionIds` 的原始身份为准，并拒绝路径分隔符；工件目录先查完整 ID，旧 bare UUID 再兼容 `session-` 前缀。只靠 `/[0-9a-f-]+/` 会让页面修复按钮直接报 `invalid session id`。
- **`@deepseek-ai/cordis` 版本是 `^4.0.1`**（cordis v4 fork），不是 rc.6 号段；所有 dsh 包的 peer 都要求它。
- **投影状态里 `totals` 无 `total` 字段**（四桶即状态，total 是视图层派生）；断言/测试别直接读 `state.totals.total`。
- **TS 经典 JSX transform 需要 `import * as React`**（否则 TS2686 UMD global）；esbuild 产物引用 wrapper 的 `var React`，两者同一模块实例。
- **`node --test` 传目录不识别**：必须传 glob `'tests-dist/**/*.test.js'`（spawnSync 里字符串 glob 由 Node 展开）。
- **`createElement(ClassComp, props, children)` 类型报错时**：把 `children` 声明为可选即可（BoundaryProps）。
- **NODE_AUTH_TOKEN 与 OIDC provenance 互斥**：publish.yml 不设 token，npm 走 OIDC。
- **OIDC Trusted Publishing 必须在 npmjs.com 手动链接 trusted publisher，否则 `npm publish --provenance` 的 PUT 返 404**（真实事故：v0.2.0 tag 推送触发 publish.yml，provenance 签名成功但随后的 `PUT https://registry.npmjs.org/dsh-usage-panel` 报 `404 Not Found — 'is not in this registry'`）。前置条件（manual, once，写在 publish.yml 顶部注释里）：npmjs.com → 包页 → Settings/Publish access → 添加 Trusted Publisher（GitHub Actions，repo=`AlfredChaos/dsh-usage-panel`，workflow=`publish.yml`，environment 留空）。v0.1.0 当时是用 access token 手动发的，OIDC 链接从未真正配过 —— 所以 publish.yml 一直是「绿本地、红 CI」的隐式失效状态，直到 v0.2.0 首次走它才暴露。临时绕过：本地 `npm publish --access public`（**不带 `--provenance`**，provenance 溯源只能在 GitHub Actions 环境生成），但这是偏离 OIDC 架构的一次性手段，且 tarball 不带 provenance。根因修复只能去 npmjs.com 配 trusted publisher。

### 6.5 桌面 vendored pin（dsh-v0.1.2-rc.1）API 漂移坑（2026-09-04 真实事故）

面板 host 按 npm rc.6 类型面写服务调用，而桌面 vendored harness 的 `sessionProjectionCache` 在 alpha.2（2026-08-31）起改了签名，rc.1 沿用：

| rc.6（npm，旧） | rc.1（vendored，现行） |
|---|---|
| `async coldSnapshot(id, signal)` | 同步 `coldSnapshot(meta, inheritedEventCount, events)`——调用方自备完整日志 |
| `cachedSnapshot(header)` | `cachedSnapshot(meta, inheritedEventCount, keys?)` |
| `SessionLogSnapshot = { session, events }` | 增加 `inheritedEventCount` 字段 |

**症状与机理**（当时：dev checkout 上 195/195 会话「读取失败」、token 全 0、页面永远「更新失败于 {UTC 时间}」）：
- 1 参调用在 `SessionLogOffset(undefined)` 处立即抛错，被 `scanProjection` 的 per-session try/catch 吞成「读取失败」→ 聚合为空（全 0）；
- `deltaScan` 里 `cachedSnapshot(header)` 当时在 try/catch **之外** → 整个 delta 扫描 reject → overview RPC 报错 → 客户端 fallback 态；
- 「修复」按钮重写的是**健康日志**（修复用自己的 decode，两轮 100 个 .bak，47/50 复现失败），重启宿主同样无效——病在插件调用签名，不在日志；
- 时间线：面板 v0.3（08-31 17:58）提交时 pin 已先行 alpha.2（08-31 16:47），**dev checkout 上从未工作过**；0.2.8 安装包 pin 更老所以「曾经好过」。

**修复模式（现行合同）**：
- 服务 face 一律走 `src/host/types.ts` 的结构化声明（`HostProjectionCache` / `HostSessionQuery` / `HostSessionLogSnapshot`，镜像 vendored rc.1），获取点 `as unknown as` 一次断言；**npm rc.6 类型面对这些服务不可信**——它是给 npm 宿主用的，桌面快照跟随 vendored pin；
- 扫描读法：`sq.readSession(id)`（live-preferred + replay 校验，天然产出损坏日志的修复候选）→ `projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events)`（seed + 折叠 + 回写缓存行）；
- delta 探针 `cachedSnapshot(header, 0)`（未种子化会话 inheritedEventCount 恒 0，与 harness 自身 list.ts 先例一致；fork 会话身份失配 → 退化为重读，正确性不受影响）**必须裹 try/catch**：探针失败 = 退化重读，绝不 let it escape；
- `SESSION_QUERY_SESSION_NOT_FOUND` ≠ 修复候选（会话在 list 与 read 之间被删）：计 failed 但不入 failedSessionIds，sessionCost 直接 `found:false`；
- 客户端 `repairFirst` 的复查必须等 `load(true)` 真正 resolve（load 现在返回载荷），旧实现查 `dataRef.current` 是竞态——「修复已生效但提示仍在」的误导文案因此必现。

**为什么所有门禁都没拦住**：本仓库 tests/ 全是纯函数测试（无服务 mock），typecheck 走 npm rc.6 d.ts——签名漂移在这两条车道上不可见；桌面 `qa:source`/`test:gui` 只验面板能挂载渲染，全 0 + 修复提示照样「渲染正常」。教训：跨包签名漂移要靠**针对 vendored 运行时的契约测试**或桌面装配走查盯数字，不能只信面板自身门禁。

### 6.6 vendored `readSession` 用错 Session 构造器（2026-09-18 真实事故）

**症状**：面板「Updated at {time} · UTC」冻结在一个旧时刻；覆盖度固定报 N 个会话「读取失败」且永不减少。**机理**：vendored `sessionQuery.readSession` 读完全量日志后用 `Session.create`（fork 快照构造器）做 replay 校验——它要求 `seed.length === inheritedEventCount`（seed 只能是继承前缀）；而持久化的 seeded 日志 = 前缀 + `session/end-seed` + 自身事件，**任何 fork 过的会话落盘后即不可读**，必抛 `seeded session constructor seed must equal its inherited prefix`。这些会话每轮扫描都失败、永不成为 `deltaScan` 的 changed → `changed.length===0` 时直接返回旧 payload → `updatedAt` 冻结（日志完全健康）。**修复**（vendored 侧，Agent Note `2026-09-18-session-query-seeded-restore`）：replay 校验改 `Session.fromRestore`（完整存储日志恢复构造器，detached + 持久化 `inheritedEventCount`）；真实 25 会话语料 4 失败全为 seeded，修复后 25/25。**同坑另一处**：`locateSessionArtifact` 曾只认 `session.jsonl.zstd`/`session.jsonl`——持久化层早已代际化（`session.vN.jsonl.zstd`，后端取最高 canonical 代），修复按钮会去重写迁移遗留的 v0 旧代而非实读工件；现按后端语法解析目录选最高代（`.v0`/前导零/`.bak-*`/`.tmp` 均非 canonical）。**规则**：面板依赖 vendored 读路径的任何「全部/固定子集读取失败」，先用真实持久化层直放语料分辨「日志坏了」还是「读路径坏了」——后者绝不能进修复流程。

### 6.7 价格记录并入会话设置段（2026-09-13，方向反转后重做）

唯一价格记录 = harness 会话设置段 `ui-conversation.sessionCostPrices`（输入框状态条正是从该段重新计价，所以记录不能搬）；本插件的「计费设置」弹层是唯一编辑器，自有域 `dsh_usage_panel_billing` 降级为一次性导入。以下是这一轮**真实踩到**与**分析确认后写进代码/单测**的坑：

- **`settings/updated` 的 `next` 是"整段已解析值"，不是补丁——缺字段意味着"用户没有任何自定义价"**（真实踩到：单测先写成"载荷缺字段就忽略"，`adoptSection({})` 之后 snapshot 仍返回旧价，断言直接红）。规则：事件载荷整体覆盖缓存；只有"载荷不是对象"才忽略。段未注册时 `settings.get` 返回 `undefined`（不抛），而 `settings.update` 对未注册命名空间直接 reject（不是 no-op）——读路径要容忍并惰性重读，写路径要把"段已注册"当前置条件。
- **`settings` 服务不能进全局 `Events` 合并**：本包不依赖 `@deepseek-ai/dsh-settings`，而在一个程序里把 `'settings/updated'` 合并进 cordis `Events` 会与 harness 自己的声明撞车 → 沿用 `src/host/types.ts` 的 `Host*` 结构化 face（`HostSettings` / `HostSettingsEventSource`），调用点一次 `as unknown as` 断言。`inject` 因此新增 `'settings'`（服务缺失时插件保持 pending）。
- **memory 期读过一次就"永远没有旧价格"**（分析确认，单测锁死）：`BillingStore.load()` 缓存首次结果，`attachMedium` 又刻意保留缓存 → 导入的闸门必须是 `mode === 'durable'`，且闸门之前**连读都不读**。域未挂载 / 段未注册都是**推迟**，在后续 `billing.get` 重试，绝不标记完成。
- **先写段、后清旧记录**（单测锁事件序 `['section','clear']`）：反序在写段失败时直接丢数据——旧域是这些价格的唯一副本。
- **导入绝不把异常抛进 RPC**：`billing.get` 是弹层唯一读路径；失败只 warn（同一原因去重，避免每次 GET 刷屏）+ 下次重试。纯函数 `mergeLegacyPrices` 提供"设置段胜出"的合并语义（键冲突以段为准，只补旧域独有的键）。
- **双语词典成对编辑必须用"删除式"编辑**（真实踩到）：把 8 个键用插入式替换"搬走"会留下重复键——对象字面量重复键 TS 不报错、后者覆盖前者，`npm test` 照样绿；改完必须 grep 复核两本词典（这次 grep 才发现 refTitle…peakIdle 各存在两份）。
- **harness 侧该字段是刻意宽松的**（`z.any().required(false)`，避免 `z.dict` 把空对象写进注册默认值）：段不校验我们的记录，`parseSessionCostPrices` 是读/写两侧唯一的校验入口——一条坏记录会让整段价格按"无价格"处理（这是刻意的整体失败，不半应用）。
- **改 host 半后必须 `npm run build`**：桌面加载的是 `lib/`，`typecheck` / `test` 都不产出它，漏构建等于改动没上线（client 半同理）。

### 6.8 峰谷开关的"跟随已存记录"与 flat 记录的助记列（2026-09-13，弹层修复这一轮真实踩到）

- **开关状态必须是已存记录的函数，不能是常量**（真实缺陷：`bufferFromCustom()` 无条件 `idleChecked: true`，用户关了「峰谷计价」保存后再打开弹层，开关又亮了）。四种形状的优先级要在纯函数里写死、单测逐个锁：`flat === true` → 关（单行显示该记录自身三元组）；显式 `idle`（且非 flat）→ 开；两者都无（legacy 单列）→ 开且空闲行填"高峰的一半"——**这条绝不能改判为 flat**，harness 对该形状本来就推导一半，改判等于把谷段价翻倍；无记录 + 有官方列 → 开（官方是两列价，关掉的单列表示不了它）；无记录 + 无官方列 → 关、空、等用户填。`flat` 必须**先于** `idle` 判断（旧代码先查 `idle`）。
- **harness 记录里没有 `flat` 字段**：三个顶层数字被读作**高峰列**，`idle` 缺失时谷段按一半推导。因此"单价格"记录写成 `{hit,miss,out, flat:true}`（无 `idle`）时，用户填的价在谷段被计成**半价**（本机真实记录 `hohai/gpt-6-astra {inputCacheHit:2, inputCacheMiss:0.12, output:12, flat:true}` 就是这个形状）。现行合同：关开关时**两列都写**（顶层三元组 + `idle` 同值 + `flat: true` 标记），`flat` 仅作本插件恢复开关的标记、harness 忽略它。
- **修一次要分三处，缺一不可**：纯函数 `repairFlatEntries`（`src/shared/pricing.ts`，返回 `{prices, changed}`，二次运行 `changed:false`）→ ①`prices-source.save()` 每次写都过一遍（新坏形状不可再现）→ ②启动时对会话设置段做一次修复（`src/host/prices-repair.ts`）。**不要修非 flat 的单列记录**（它的"一半"就是语义），也不要动已带 `idle` 的 flat 记录。
- **一次性修复沿用 legacy import 的闸门**（这不是重复代码，是同一组陷阱）：段未注册 → 只 warn 一次（同一原因去重）并**推迟**，靠后续 `billing.get` 重试；**写完才算 done**（写失败保持 done=false，否则坏记录活到进程结束）；异常一律不进 RPC 路径。读路径不必修：`resolveModelPrice` 对 flat 本来就把三元组当两段价。
- **模型下拉一旦去掉占位项，"空选中"只剩一种成因**：provider 有 0 个模型（弹层从已存价合成的 `(unknown)`，或 `listModels` 失败/超时）。默认模型必须**走 `selectModel()`**（它就是播种价格行的那条路径，单设 `modelName` 会让下拉有值而输入框全空），且 `commitModel` 的 `modelName === ''` 分支要留着——它是该成因的唯一写入者，不能靠强选一个不存在的模型来"消灭"它。
- **行标签与颜色是同一个周期断言**：开关关掉后主行不再是谷段价，文案改「价格」（`billing.periodSingle`），`is-idle` 绿色类只在该行真的是谷段列时才挂——绿色等于宣称"谷段"，单价格行没这个断言。
- **双语词典成对增删后要跑一次脚本核对**（键数 + 重复键 + 左右差集），别靠肉眼看：本轮删除 `billing.pickModel` / `billing.pickModelHint` 并新增 3 个键，脚本一次给出 `zh 138 / en 138、无重复、无单边键`。

### 6.9 修复解码器不再 import 运行时包（2026-09-25，pin 0.1.7-rc.2 漂移）

**症状**：桌面端点「自动修复」必失败（用户截图报 `CallId`/`does not provide an export` 类链接错）。**机理**：`runtimeCodec()` 动态 `import('@deepseek-ai/dsh-session')` 只为取 `decodeStorageRecord`，但该导出在 vendored pin（0.1.7-rc.2）已被移除（解码移入 persistence format catalog，公开面没有它）；插件自身 `^0.1.0-rc.6` 规范可解析进 0.1.7 号段，混合树还会让 rc.6 的 session 包撞上只导出 `ToolCallId` 的新 `dsh-llm` → 模块链接期就抛错，修复在解码第一行之前失败。与 §6.5 同类：**运行时包面不可作依赖边界**。

**现行合同**：解码器内置为 `src/host/storage-rows.ts`——rc.6 `decodeStorageRecord` 的忠实移植（三种 `*-chunks` 打包行展开为 `assistant/chunk`，其余值原样透传）。存储行语法对既有文件不可变，所以内置是正确边界；`repairSessionLog(home, id, decode)` 保持注入式签名供单测。新增防护：未识别的 `-chunks` 标签**抛错中止**——那是更新的打包代际，重编号会写坏而非修复。连带收益：standalone npm 环境的修复也可用（工件不存在仍优雅报错），"仅桌面运行时可用"的约束随动态导入一起消失。回归锁定：`tests/storage-rows.test.ts` 锁三种展开/malformed/未知标签中止 + rebuildSessionLog 真实解码回环；本机 37 个真实工件全量 rebuild 0 错误。

### 6.10 "读取失败"可能是格式版本拒收，不是字节损坏（2026-09-25 实机发现）

**症状**：扫描把 `session-whale-12d39638-…` 计为读取失败，但该 `session.v3.jsonl.zstd` 94 个 zstd 帧完好、seq 连续。**机理**：当前构建只通过迁移链读 v3；迁移对不在冻结 `RELEASED_V3_EVENT_TYPES` 且未带 `ignorable` 的事件类型硬拒（`format v3 contains unknown event type`）——该日志的 `session/presentation`（鲸鱼插件写入）与 `user-questions/asked` 都是现行词表正式成员却不在 v3 released 集合（冻结早于桌面写盘）。**规则**：`rebuildSessionLog` 按头部 `version` 分路——`===3` 时只做准入重写（非 released 类型补 `ignorable: true`，seq/打包行/引用逐字节保留，由 harness 自己的迁移管道完成升级），`>4` 显式拒绝；只有 4/缺失/0–2 走解码+重编号。**判定"失败会话"先跑真实 `open('read')` 看拒绝文案再定修法**，别想当然全是 seq gap。

### 6.11 恢复时的 end-seed 不是继承边界（2026-09-29）

真实会话已产生 14,284 token，恢复后日志尾追加 `session/end-seed`；旧 reducer 等这个标记才武装，投影与回退扫描都得零。现行宿主 `init(header, inheritedEventCount)` 与 `readSession().inheritedEventCount` 才是准确边界。显式前缀优先，忽略后续标记，旧调用者仍兼容标记语义。新增 `explicitSeedBoundary` 状态并升 stateVersion 3，同时失效 checkpoint 与聚合缓存；不得通过改健康日志来修插件的计数错误。回归必须包含「已有用量后才出现标记」和「fork 前缀排除、边界上的事件计入」。

同轮发现 `deltaScan` 将整份投影再次加到上次聚合，刷新后数字翻倍。现每次扫描从空聚合开始，每会话合并一次（仍复用框架 checkpoint）；不能把 `mergeSessionValue` 当作替换接口。回归走实际 overview RPC，覆盖重复刷新、新用量和删除。

### 6.12 总量口径 6.9B vs 网关 223M，以及账本模型键的坑（2026-10-21 实机事故）

**症状**：用户对比 设置 → 用量统计 的「Token 总用量」≈6.9B 与 `magpie usage` 的 223M，相差 30 倍；面板还会漏掉 2026-10-12 之前的全部历史。

**机理（两件事叠加，缺一都不解释现象）**：
1. 旧 `totalsFrom` 把**四桶全加**（未缓存输入 + 输出 + 缓存读 + 缓存写）。本机账本里缓存读 10.7B 远超 in+out 的 0.22B，所以「总量」实际上被缓存读主导——**同一批请求的两种口径**，不是数据错。Magpie 的头条 token 恒为 `in + out`，缓存读/写是独立统计。
2. 面板只能读磁盘上还留着的会话日志（本机从 2026-10-12 起），更早的 DSH 用量只有网关账本还有。

**现行合同**：
- 派生 total 一律 `input + output`（`totalsFrom` / `sortedModels` / `totalsFromModels` / `buildDayWindow` / `recentTotals` / `sessionCost` 手动 total / CSV 导出）。缓存读写只在自己的桶里露出（KPI 次级文字第三段、命中率卡、CSV 列）。
- 账本折叠在 `src/host/magpie-usage.ts`：`$MAGPIE_USAGE_FILE` → `~/.config/magpie/usage.jsonl`，只取 `agent === 'dsh'`，`stat` 失败/解析失败/无 dsh 行 → `null` 回退日志；成功时按 mtime+size 缓存（账本每次请求都追加，缓存键必须含 size）。
- **模型键 = 行的 `req`（请求路由），不是 `model`（实际服务的 id）**。DSH 日志写的是 `codex/gpt-6.1-sol`、`clinepass/cline-pass/deepseek-v4.1-flash-1017`，而账本的 `model` 是 `gpt-6.1-sol`——用 `model` 当键会让 `sortedModels(gateway.byModel, a.allTimeCostByModel, …)` 一行也对不上，KPI 费用卡直接变「—」。本机真实日志模型 id 是从 `dsh-usage-panel.sqlite` 的缓存载荷里核对出来的。
- **Provider 取日志侧映射**（本机是 `magpie`，也正是用户价格的作用域键 `magpie/<model>`），网关的上游 id（`codex`/`factory`/`minimax-cn`…）只作为「日志从未见过该模型」的兜底；Provider 行由同一批模型桶按该映射分组，因此 `Σ providers == Σ byModel == allTime.total`（单测锁）。
- 账本口径下**不经网关的流量不计入总量**（本机 `stepfun/step-5-preview` 35.7M 就不在账本里）——这正是「与 `magpie usage` 一致」的含义，README/来源行必须写清；删/改名账本文件即回到日志口径。
- 账本按 UTC 日重分桶（面板契约），`magpie usage` 按本地日，所以单日数字可能差一个时区偏移，全历史完全一致。

**回归**：`tests/magpie-usage.test.ts`（agent 过滤、req 键、四桶、UTC 日桶、mtime+size 缓存、缺失/无 dsh 行/半行回退）、`tests/aggregate.test.ts`（账本覆盖总量/日桶/模型，日志 Provider 胜出，费用行 join 后 `sumCostCents` 非 null，`Σ providers` 守恒）、`tests/refresh.test.ts`（用 `MAGPIE_USAGE_FILE` 指向不存在文件，单测绝不可读开发者本机账本）。

### 6.13 启动与设置搜索不得全量扫描历史（2026-10-27）

601 份约 1.17GB 日志的实机副本中，启动扫描占用 Host 解码、整份日志复制和回放校验，使新会话与历史读取排队数秒。现仅统计数据请求触发扫描，并用 `sessionQuery.observeSession` 的投影及 disposable 租约复用精确读取，不读其完整 events；首次冷读仍有解码校验成本。设置搜索传 `indexOnly`，统计页只渲染可搜索标题和偏好行，不挂载发起 RPC 的内容。刷新仍精确读取，不能把仅按 header 校验的缓存投影当作日志末尾或健康性证明。

## 7. 文档同步义务

- 改功能必同步 README.md + README.zh-CN.md（双语等价、口径声明、安装方式不变）。
- 新增依赖/构建步骤 → 更新本文档 §2；新增踩坑 → 更新 §6；发布 → 检查 §3 门禁并核对 iteration-strategy.md 的完成定义。
