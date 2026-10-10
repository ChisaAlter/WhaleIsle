# 客户端性能改动与体验边界

2026-10-09。目标目录 `C:/AI/WhaleIsle-application-performance`，分支 `codex/application-performance-full`，基线 `26205a89fb7a6d416ef446d6281cb77afe610bcd`。本文记录 T08–T12 的客户端部分；未改 Host、usage 接口或主检出的用户修改，未 commit/push/创建 PR，未启动或关闭用户进程。

## T08 — 文件搜索：采用

负责 `vendor/deepseek-harness/packages/client/ui-files/src/client/FilesPanel.tsx` 和 `locales.ts`。

- 根列表、懒展开与搜索共用最多四个在途 `listDir` 请求。新请求有空槽时立即发起；排队请求在发起前检查取消。清除搜索、Refresh、切 cwd 或卸载后，旧搜索不再调度其后代；迟到展开不会写进新工作区。已经发出的 IPC 没有 AbortSignal，仍须等待其完成，不能声称取消了底层 I/O。
- 完整遍历没有深度/目录数截断。最终结果仍通过原树结构按原 DFS 顺序收集，再使用原子序列匹配和原 200 行显示上限；返回顺序不取决于并发回复顺序。
- 搜索显示“正在搜索文件…”及 `aria-busy`。该文本位于已有滚动内容区，复用已有 message 样式，工具栏与输入大小不变。没有渐进发布声称结果完整；遍历完成后发布本轮库存。
- 文件库存仅随 root/children 变化重算，连续查询复用库存；删除搜索模式不消费的树过滤计算。没有新增第二套文件索引。
- 子目录读取失败会显示已有错误信息，不把省略该目录的结果冒充完整搜索。

体验影响：首次搜索能重叠独立目录等待；快速重搜不会无限叠加 I/O。取消后的已发请求占用槽位直到结束，新工作可能等待这些请求。搜索中增加明确状态文字；点击、排序、完整匹配和 Refresh 仍按原契约。权限、symlink、忽略规则仍由原 `listDir` 权威实现负责，客户端没有自行绕过或缓存授权。

同条件对照使用精确基线组件和候选组件、同 React/jsdom、64 个目录、每次目录请求设 5ms 计时延迟，五组交替。每组均确认完整 64 行和相同顺序；实际 Windows 计时调度包含在 wall time 中。

| 指标 | 基线 | 候选 |
| --- | --- | --- |
| 查询请求数（包含两次根列表） | 66 | 66 |
| 最终结果行数 | 64 | 64 |
| 最大在途数 | 1 | 4 |
| 五组查询 wall time，ms | 1062.26 / 1023.06 / 1038.47 / 1029.19 / 1039.57 | 286.19 / 293.61 / 282.63 / 296.78 / 287.60 |
| 中位数，ms | 1038.47 | 287.60 |

这是具有人工请求延迟的组件对照，不能代替 native IPC、真实目录磁盘成本或用户输入 p95。临时基线组件和对照夹具已删除。第一轮取样的默认 1 秒元素等待不足以容纳基线串行遍历，后续改为等待真实完成；计时值仍完整报告，未缩小目录或放宽完整结果断言。

仍待真实界面：大目录首次/后续搜索、深层结果、搜索期间输入和清除、外部修改及 Refresh、快速切 cwd、移除工作区、权限撤销/symlink，以及窄栏 pending 状态不重叠、不裁切。

## T09 — 预览与草稿：采用

负责同包 `FilePreview.tsx`、`FloatingPreviewButton.tsx`、`SidebarFloatingPreviewAction.tsx`、`floating-preview.ts`、`desktop-file-state.ts`。

- FilePreview 不再订阅全部 Session catalog。独立预览按钮直接订阅资源所属 Session 的 cwd 字符串；普通、Sidebar 和绝对资源路径沿用原解析规则。
- Markdown labels 按翻译函数身份 memo，普通编辑器状态更新不再创建新 labels 使 Markdown 缓存失效；语言变化更新 copy/footnote 标签。
- 每次真实编辑仍在事件中同步写入 localStorage。DesktopFileState 只跳过已经成功持久化的相同 text/draft；失败不标记为成功，后续调用仍会尝试原写入。基线或草稿改变都立即写，成功保存/Discard 仍清除持久化草稿。删除地址不留成功标记，避免关闭过的文件地址在新集合中持续驻留。
- 未引入 debounce、异步存储迁移、延迟 flush 或较大的可丢草稿窗口。串行 FileSaveCoordinator、500ms文件自动保存、关闭确认与恢复格式保持。

体验影响：无关会话更新不再让正在阅读/编辑的文件预览提交 React 更新；资源 cwd 改变仍更新。独立窗口读取保存后的磁盘内容，打开时不清草稿。脏编辑、保存期间继续输入、失败关闭、刷新恢复及语言切换保持。

同条件计算取样从 `git show 26205a89` 与候选源码在同一 Node 进程转译并加载；真实 JSON serializer，Map 模拟存储。每组 50 次改变 512KiB 草稿，每次紧随一个相同值的 render echo；预热后五组交替，结束均从新 owner 恢复最新草稿。

| 指标 | 基线 | 候选 |
| --- | --- | --- |
| serialize/setItem 次数 | 100 | 50 |
| 序列化字符数（UTF-16 code units） | 104,859,980 | 52,429,990 |
| 五组总时间，ms | 180.10 / 212.28 / 184.46 / 171.13 / 197.66 | 111.38 / 116.78 / 88.59 / 88.05 / 96.46 |
| 中位数，ms | 184.46 | 96.46 |

这是重复序列化与写调用的计算对照，存储替身不含浏览器 localStorage、磁盘或输入至画面成本，不能按该比例承诺实际打字改善。框架真实 selector hook + React Profiler 检查确认无关 Session cwd 更新没有预览 commit；所属 cwd 更新仍有 commit并让独立预览请求使用新 cwd。

仍待真实界面：上限内大文本持续输入、每次编辑后刷新恢复、切会话/右栏折叠/浮窗、语言切换、保存中输入、写失败与关闭确认、图片与代码复制。存储载体迁移未采用；先取实际每键 localStorage 成本，再决定是否存在保留逐键恢复的必要方案。

## T10 — 流式 Markdown：当前不追加产品改动

已保留 microtask/rAF 通知合批、单节点 memo/窄订阅、增量 Markdown 冻结、流式高亮完成行缓存和共享 IntersectionObserver。T09 稳定预览 labels 已消除一个已确认的缓存失效来源。

`MarkdownText.tsx` 仍复制 frozen elements/children、引用表等数据；没有本轮前台 profile证明该复制比解析、高亮或布局更重。直接复用并修改已发布 children 数组会违反快照/React并发稳定性；改父节点或分组可能破坏冻结边界 DOM身份。未采用未经取样的数组改造、Worker 或再加缓存，也未截断工具原文。

可复用的构建后入口（在 vendor 根目录）：

```powershell
$env:DSH_SNAPSHOT='replay'
pnpm exec vitest run --config vitest.web.perf.config.ts apps/web/tests/complex-history.perf.ts --testNamePattern 'reports default 24-turn history plus eight continued turns'
pnpm exec vitest run --config vitest.web.perf.config.ts apps/web/tests/complex-history.perf.ts --testNamePattern 'reports fully expanded 500-turn history plus eight continued turns'
pnpm exec vitest run --config vitest.web-stress.config.ts apps/web/stress-tests/reasoning-chunks.stress.ts
```

前两个入口已有 CDP task/script/layout/recalcStyle、DOM/heap、mutation batches/records和持续流式数据；100 轮 soak 入口还量下一条 user-message 的 send→DOM/paint。stress 经真实 Host/Gateway/browser 发 100,000 个 reasoning chunk，记录 event-loop 最大延迟与预定交互延迟，既有250ms断言不能扩大。

这些入口不等于巨大可见单消息/未闭合 fence 的专项 profile；reasoning stress 保持 Think 折叠，不可把它当完整展开 Markdown 的绘制证据。真实候选用已有 DevTools Performance/React Profiler对同一巨大消息、fence 与完整工具详情取样，区分投影、解析、高亮、布局和 GC；输入、滚动、取消/审批和完整原文复制必须仍可用。没有明确热点便保留当前实现。

## T11 — 已加载历史/flat 列表：当前不采用窗口化

已加载聊天 entries 与 flat/全部展开会话仍整批挂载；默认50消息分页、分组默认5个 idle项和运行项/运行父项豁免保持。未实施虚拟化、content-visibility或猜测的 intrinsic height：尚未落实浏览器查找、跨消息选择、变高内容、prepend锚点和远处 turn跳转的等价行为，也没有本轮真实布局热点归因。

可复用 `complex-history.perf.ts` 的 `reports workspace, history, and trajectory cardinality costs`（1,000会话展开、内容搜索、Chat/Trajectory切换、分页）与 `reports fully expanded 500-turn history plus eight continued turns`。保留现有 cardinality断言；先对照24与500轮的 task/layout/style/DOM/heap，再在前台 DevTools看滚动长任务和视觉跳动。

已有入口：英文名称搜索 `Search name, keywords...`；Search results tree中的treeitem；Chat/Trajectory tab；`Load earlier`；`[data-chat-flow-key^="9:turn-tail"]` 计回合；`[data-streaming="true"]` 看流式；`[data-composer-input][contenteditable="true"]` 输入；`Send message` 按钮。

额外真实观察：展开代码/图片后保持阅读位置、加载旧历史不跳动、远处 turn定位、Ctrl+F查找已加载屏外文本、跨消息选择/复制、窄窗与右栏切换。不能行为等价时继续不采用窗口化。

## T12 — 隐藏页与主题：当前不追加产品改动

已有 `visible/active` 和 DockKit visited/keepMounted契约继续保留。FilePreview已按active读文件/注册保存快捷键；T09窄订阅同时减少保留文件页的无关React提交。隐藏页仍需要保存草稿、接收PTY/agent数据和保持guest身份，不能统一卸载。

流体指针已经4秒idle停rAF、hidden取消并按活动尾巴恢复；pixel trail仅在粒子存活时调度，以wall-clock过期并受容量限制；打字回声受容量/animationend/cancel限制，ComposerBeam仅发送/思考/流式期间启用，CSS有reduced-motion。pixel trail没有单独visibility guard，但本轮未量到足以证明需追加生命周期策略的实际后台成本。没有关闭默认效果、降DPI、改节拍、统一销毁右栏或新建状态桥。

复用 root 的 own-build Electron/CDP和 DevTools trace即可测：同效果/DPI/窗口尺寸下前台无输入→连续指针→停止4秒、输入echo/beam、隐藏/最小化/恢复；区分rAF、主线程、compositor/raster和GPU。另测visited右栏切tab/折叠/切Session前后的React提交、listener/timer/guest数量，恢复最新文件/PTY/浏览器。当前后台空闲rAF约1Hz、heap约29MiB、longtask0仅是旧空闲样本，不能归因任何新改动或替代前台观察。

## 定向检查与实际边界

vendor根目录曾完整执行下列6文件，113项通过，无unhandled errors：

```powershell
pnpm exec vitest run packages/client/ui-files/tests/files-panel.client.spec.tsx packages/client/ui-files/tests/desktop-file-state.client.spec.ts packages/client/ui-files/tests/floating-preview.client.spec.tsx packages/client/ui-files/tests/sidebar-files.client.spec.tsx packages/client/ui-files/tests/file-save-coordinator.client.spec.ts packages/client/ui-files/tests/project-file-picker.client.spec.ts
```

首次运行虽然断言通过，却有late unhandled rejection；原因是第一版调度延后初始listDir，已修正为有槽立即调用并附拒绝处理，之后上述命令无unhandled。后续移除已删除资源的成功标记，仅重跑desktop-file-state（12项）；新增真实语言切换回归后，仅重跑files-panel（67项），均通过。新增检查覆盖有界请求/乱序回复仍同序、取消后不调度后代、迟到展开隔离、逐键恢复/重复echo/失败后再次写、实际框架窄订阅和语言标签更新。没有添加skip或减少既有深层搜索场景。

临时组件性能对照另有1项完整结果检查通过；`git diff --check`通过。构建、真实Electron、安装包和布局观察由统一候选验证负责，本子任务未把单测/合成时间当成真实UI验收。

取样关联源码SHA256：FilesPanel `03DAC05016BA9AE7D1751E6365FAC8114B46B01F14A3AA1ACE63D3248D0F5A2B`；FilePreview `7CC8D8932F404DF928EC7943B78DF7FE66BEFBF3947A47FDBA8C6FA5F443E8C7`；DesktopFileState `3EEC60CF6DB55559BDB1C45A4D7E6AAC31A3BDE03423EF10E0CF6EF41E801732`（草稿计算取样后仅调整删除地址的标记释放，取样编辑路径不变）。

实际候选入口：`[data-files-panel] input[aria-label="搜索文件"]`（英语Search files）；Refresh的“刷新/Refresh”；普通树`[data-item-path="relative/path"]`；picker用文件名和完整相对path定位；`[data-file-preview] textarea[aria-label="relative/path"]`；“渲染/Rendered”“源码/Source”“保存/Save”；独立预览`button[data-floating-preview]`。pending文字位于Files滚动内容区，完整窄窗/右栏布局仍待真实画面判断。

## 首次构建后 T10/T11 历史诊断：夹具契约阻塞

2026-10-09 01:00:04 使用统一候选已完成的 Harness/client/web 构建产物运行现有 manual perf 入口，未再次构建。运行目录为本隔离目录的 `vendor/deepseek-harness`；仅由现有脚本 `chromium.launch()` 创建和关闭独立 headless Chromium，没有操作用户 Chrome 或应用。根代理同期准备 remote 依赖，可能存在 CPU/磁盘竞争，以下时长仅记录这次失败运行，不能作为 UI 性能或改动收益。

```powershell
$env:DSH_SNAPSHOT = 'replay'
pnpm exec vitest run --config vitest.web.perf.config.ts apps/web/tests/complex-history.perf.ts --testNamePattern 'reports (workspace, history, and trajectory cardinality costs|default 24-turn history plus eight continued turns|fully expanded 500-turn history plus eight continued turns)$'
```

退出码 1；1 个文件失败，筛选中的 3 个场景均失败，100-turn soak 由名称筛选排除（Vitest 显示 1 skipped），没有新增 skip。总时长 42.56s（transform 2.94s、import 12.09s、tests 29.55s）。未改负载、断言、夹具、配置或 CI，也未原样重试。

| 原场景 | 原始场景耗时 | 失败位置 | 结构与性能观测 |
| --- | --- | --- | --- |
| workspace/history/trajectory cardinality | 23,600ms | `complex-history.perf.ts:865`，首个 sidebar seed | 尚未创建场景页面，无指标 |
| default 24-turn + 8 continued turns | 2,790ms | `complex-history.perf.ts:869`，long-history seed | 尚未创建场景页面，无指标 |
| fully expanded 500-turn + 8 continued turns | 2,507ms | `complex-history.perf.ts:869`，long-history seed | 尚未创建场景页面，无指标 |

三个场景共同错误：

```text
Error: session snapshot line 1: system/message requires a protected first surface head
seedSession (apps/web/tests/scaffold.ts:1431)
→ parseSeedFixture (apps/web/tests/scaffold.ts:1351)
→ parseSessionFixture (packages/test-support/llm-replay/src/index.ts:284)
→ assertV4LifecycleRelationships
→ Relationships.foldSurface (packages/session/session-format-v3-to-v4/src/relationships.ts:127)
```

证据边界：现有 perf 生成器 `appendSystemPrompt` 在 `complex-history.perf.ts:200–205` 追加 `system/message`；当前 v4 校验在 `relationships.ts:126–130` 要求已有 surface 上的 system message 具有受保护的首个 head。失败发生于 seed 的解析校验，先于 `newEnglishPage`（:872）、`openPerformancePage` 和 CDP 取样。浏览器启动 hook 没有报告缺二进制或 native-policy 错误；阻塞是现有 manual perf 夹具与当前 session 生命周期契约不匹配。default/expanded 还报告 `AggregateError: web scaffold teardown failed`（`scaffold.ts:996`），输出没有提供其内部失败详情，不能假定清理成功或把它消音。

没有输出 `WEB_PERF_RESULT`，因此 task/script/layout/recalcStyle/devtools 时间、heap/heap delta、DOM nodes/listeners、mutation batches/records、send echo/first chunk/paint 均为**未取得**，不是零。原断言仍要求 1,000 sidebar sessions / 1,001 total sessions、500 history turns、500 tool calls、2,100 trajectory rows，以及续写 8 轮（其中 2 个工具轮）；这些是未缩水的目标负载，不能冒充本次页面实际达到的结构计数。

后续诊断需先让 manual perf 夹具遵守当前 v4 lifecycle，再用完全相同的 3 个场景测量，保留全部数量与内容断言；本轮禁止改夹具，因此保留该阻塞。`Measurement` 已以 CDP duration 差值乘 1,000 输出 ms，heap 数值实际以 1,048,576 字节换算 MiB；`retainedBefore/After` 是 `HeapProfiler.collectGarbage` 后样本，逐操作 heap 是未强制 GC 的快照，两者不能混为一谈。得到 source-web 诊断数据也只覆盖脚本中的 replay/Headless Chromium 路径；Electron 前台输入、滚动、Ctrl+F、跨消息选择、prepend 锚点和真实完整画面仍需统一候选直接观察。

本次原始输出保存在 `C:/Users/48818/AppData/Local/Temp/whaleisle-complex-history-20261009-owned-web-perf.log`。本轮仅追加此报告，没有再改前端产品。

## v4 夹具最小修正后的历史诊断：页面/replay 阻塞

统一候选随后授权修复现有诊断夹具的 v4 契约问题，以覆盖仍缺失的 500 轮实测。仅修改 `vendor/deepseek-harness/apps/web/tests/complex-history.perf.ts` 的两个生成器：将各自原有的 `step/start` 与首个 `appendSystemPrompt` 调用移到 `user/message` 前。没有增加、删除或缩短消息/事件、回合、工具、代码内容；没有改关系校验、原断言、默认值、测试配置、产品或 CI。

根因与同契约参考：`chat-scroll-fixture.ts:195–217` 采用 `turn/start → step/start → 首 system/message → user/message → request/header`，先建立受保护的 system surface head；`session-format-v3-to-v4/tests/developer-relationships.spec.ts:17–23,43–51` 亦以 turn/step/system 顺序 restore。原 perf 生成器先把 user 追加到 surface，之后才追加 system；`relationships.ts:126–130` 因而发现非空 surface 没有 protected head。这是生成顺序缺陷，修复沿用已有模式，不添加新抽象或绕过校验。

`git diff --check -- apps/web/tests/complex-history.perf.ts` 通过。按同一命令与 regex 仅执行一次新诊断（01:06:14 开始），不再 build，继续 `DSH_SNAPSHOT=replay`。取样期间根代理的 runtime prepare/pack 可与本任务竞争 CPU/磁盘；本次失败耗时不代表稳定的性能样本，也不构成整体加速对照。

| 原场景 | 原始场景耗时 | 实际新失败 |
| --- | --- | --- |
| workspace/history/trajectory cardinality | 260,997ms | `openPerformancePage` 等首个 `treeitem` 的 `textContent`，30,000ms locator timeout；断言栈位于 `complex-history.perf.ts:928–929` |
| default 24-turn + 8 continued turns | 65,333ms | cleanup 报 1 个 recorded replay script 从未绑定 live session；栈 `closePerformanceWorld` → `scaffold.close` → `llm-replay.assertConsumed` |
| fully expanded 500-turn + 8 continued turns | 66,336ms | 同上，recorded replay script 未绑定 |

原始结果：1 个文件失败，3 failed / 1 skipped（100-turn soak 仍仅被名称筛选排除），退出码 1。总时长 415.34s（transform 7.21s、import 20.39s、tests 393.14s），未放宽超时、扩大 skip 或重跑。

```text
TimeoutError: locator.textContent: Timeout 30000ms exceeded.
Call log: waiting for getByRole('treeitem').first()
openPerformancePage (apps/web/tests/complex-history.perf.ts:929)

Error: llm-replay: fixture not fully consumed — 1 recorded script(s) never bound
to a live session; the scenario drove fewer model calls than recorded
assertConsumed (packages/test-support/llm-replay/src/index.ts:1119)
→ Object.close (apps/web/tests/scaffold.ts:977)
→ closePerformanceWorld (apps/web/tests/complex-history.perf.ts:912)
```

首个 v4 阻塞已消除：cardinality 场景已越过完整 seed 循环和场景页面创建，进入 `openPerformancePage`；后两个场景也越过 seed 和 `newEnglishPage`，进入会清理 world 的测试主体。default/expanded 在 `finally` 中 await cleanup（:1358/:1404），清理抛错可覆盖更早的主体错误；现有输出没有保留其原始页面失败点，因此不能把 replay 未绑定直接归因为模型、Markdown 或 500 轮渲染瓶颈。

本次依然没有 `WEB_PERF_RESULT`。task/script/layout/recalcStyle、heap/retained heap、DOM/listeners、mutation、send echo/first chunk/paint 与实际浏览器结构计数全部**未取得**。1,000 sidebar、500 turn、500 tool call、2,100 trajectory row 和 8 轮续写断言仍完整保留，但未通过，不能作为页面已经完成这些负载的证据；无法据此比较 24 轮与 500 轮的成本。

按“遇第二类失败报告、不扩大 skip”的范围停止扩修。后续需定位当前已构建页面为何未呈现测试预期的 session tree，以及保留 default/expanded 主体与 cleanup 的各自错误，才可获得该入口的 profile；这一步没有在本轮实施。source-web 的诊断即便恢复也仍不替代 Electron 前台完整画面、滚动、查找、选择和输入验收。

新原始输出：`C:/Users/48818/AppData/Local/Temp/whaleisle-complex-history-20261009-v4-web-perf.log`。本轮交付仅含以上夹具顺序修正和报告补充，前端产品继续冻结。

## T13 补充：真实 Browser → PiP 用户路径与基线 preload 根因

本次只诊断真实公共入口，未修改产品、重建、复跑历史诊断或运行全 QA。此前 `whale-performance-native-paths.mjs` 直接调用 preview IPC 服务并开始录制，再打开 PiP 的 `ERR_FAILED(-2)` 仍只属于该探针上下文；不能据此宣称公共 Browser 面板的 PiP 导航失败。源码未提供它触发旧 owner 清理的证据：公共入口与探针均调用 `shell:preview-open-pip`，guest 的 http(s) 导航规则绑定 guest webContents，PiP 使用独立 BrowserWindow。真实入口在 `ui-preview/src/client/apply.ts:65–88` 注册 Browser 面板；`PreviewPanel.tsx:481` 提交地址、`:555` 的更多菜单调用 `previewOpenPictureInPicture(previewId)`。

使用已有构建的隔离候选标准 `.` 入口、共享 Electron 44.1.1，带 `--dshd-from-launcher`，清理启动环境中的 `ELECTRON_RUN_AS_NODE`/`DSH_HOME`/`DSHD_HOME`；新独立 profile 位于 `C:/Users/48818/AppData/Local/Temp/whale-performance-pip-ui-x2XQ2k/user-data`。仅复用旧 scratch workspace，不新增 workspace fixture、改工作区或接触用户进程。目标主进程 PID 2896，Harness 59153、CDP 59154、自己 HTTP 页面 59155。通过该窗口 CDP 依次操作可见右栏按钮 → 浏览器 → 地址输入及 Enter → 更多 → 打开独立预览窗口，仅打开一次 PiP，没有录制或 20 轮循环。

原生可见性单独核实：自己的主 HWND `7146000` 初始 `IsWindowVisible=false`、`IsIconic=false`，但 Harness DOM 为 `visibilityState=visible`、`hasFocus=true`、1441×920，因此 DOM 可见不能代表 OS 窗口已经显示。验证 HWND 仍属于 PID 2896 后，对它使用 `SW_SHOWNOACTIVATE(4)`；之后原生可见为 true、未最小化，`GetForegroundWindow` 前后相同，没有鼠标或焦点接管。完成菜单操作后，PiP HWND `8459034`（标题“预览 · PiP UI acceptance”）原生可见为 true、未最小化，rect 481×320；主 HWND 仍可见。此证据仅属于本次独立进程，不能补证此前 root 30 分钟 soak 的原生可见性。Harness 的 `Page.getLayoutMetrics`/innerWidth 非零已记录，但未直接取得主进程 BrowserView.getBounds；Electron CDP 不支持 `Browser.getWindowForTarget`，不能将源码中的 bounds 设置冒充实际对象观测。

真实 guest 已加载页面标题和完整文字“Whale browser preview / Readable text, correct spacing. / Public browser panel → PiP”，PiP data URL 完成导航，没有重现探针的 `ERR_FAILED(-2)`。但 PiP 实际截图已查看：黑底、broken-image 图标及 “Live browser preview” 占位文字，没有网页画面；15 次同一窗口状态样本均 `naturalWidth=0`/`naturalHeight=0`/`srcLength=0`。PiP document `readyState=complete`、`visibilityState=visible`、466×283，`typeof window.previewPictureInPicture?.onFrame === 'undefined'`。因此真实画面/质量验收**失败**，不能把导航成功称为 PiP 功能通过。

同一窗口启用 Runtime/Log 后取得已发生的控制台和异常，给出了具体根因链：

```text
Unable to load preload script: C:\AI\WhaleIsle-application-performance\src\main\preview-pip-preload.js
Error: module not found: ./preview-pip-protocol
  at preloadRequire (node:electron/js2c/sandbox_bundle)
  at src/main/preview-pip-preload.js:4:39
TypeError: Cannot read properties of undefined (reading 'onFrame')
  at PiP data URL document
```

`preview.js:945` 保持 `sandbox:true`；`preview-pip-preload.js:4` 使用相对 require，沙盒 preload 加载失败在 exposeInMainWorld 前中止；PiP document 在 `preview-pip-protocol.js:36` 调用该未建立的桥接 API。这已解释本次真实画面缺失。preload 工作树与基线 `26205a89f` 的 Git blob 都为 `2b8cc60e0efd8447ae9b4a972afe263e2f052e51`，`git diff` 空；基线 preview.js 同样设置 `sandbox:true`。所以该沙盒 preload 缺陷已存在于基线，不能归为本轮 T13 owner/导航/节流优化引入的回归。此前 bare-window 的 loadURL 成功也只证明导航，未证明 bridge 或帧显示。

界限：截图来自确实原生可见的目标 renderer，但没有 OS PrintWindow 全 BrowserView 合成截图。PiP 打开后 guest 的 DOM 为 hidden；对它尝试一次 `Page.captureScreenshot` 超时 30s，未重试，没有取得隐藏 guest 像素。这不影响已取得的 preload 错误证据，但也不提供捕获帧吞吐或质量数据。按根因停止条件结束，不改产品或放宽导航规则；PiP 未通过，因此未追加以“PiP通过”为前提的 Files scratch64 UI 验证。

最后通过自己 Harness 的公共 `window.shell.windowAction('close')` 关闭本次进程；启动脚本记录 `exit code=0, signal=null`，PID 2896 已不存在，自有 HTTP server 随子进程退出关闭。未关闭用户应用。原始证据目录 `C:/Users/48818/AppData/Local/Temp/whale-performance-pip-ui-x2XQ2k` 包含 `launch.json`、`actions.jsonl`、`native-own-windows-before-pip.json`、`native-main-window-inactive-shown.json`、`native-own-windows-after-pip.json`、`main-visibility-before-pip.json`、`pip-public-ui-result.json`、`pip-public-ui-console.json`、已实看的 `initial-harness.png`/`pip-public-ui.png` 与 `exit.json`。

## T13 已观察 preload 缺陷的最小修复：桥接恢复，帧质量仍未通过

统一候选随后将上述已确认的基线缺陷纳入本次修复。产品先改 `src/main/preview-pip-preload.js:4–6`：移除沙盒不支持的本地 require，直接声明同一固定 `dshd-preview-pip-frame` 常量，沿用主 preload 自包含频道写法。没有更改 sandbox/contextIsolation/Node 权限、IPC API、JPEG 80、12fps 调度、尺寸或导航规则，也没有加打包层或 fallback。

现有 `preview-pip-preload.test.js` 的加载夹具改用 VM，只允许 `require('electron')`，避免 Node 的完整 require 能力再次掩盖沙盒加载失败。原公共桥接断言继续保留：API 仅暴露 onFrame、不暴露 ipcRenderer；用 `preview-pip-protocol.js` 导出的频道实际发帧，收到数据、忽略 null、dispose 后不再接收，验证重复常量两端一致。执行 `node --test src/main/preview-pip-preload.test.js src/main/preview-pip-protocol.test.js`，6 项全部通过、无 skip，`git diff --check` 通过。

新独立 profile/样本位于 `C:/Users/48818/AppData/Local/Temp/whale-performance-pip-ui-v2bsgY`，复用相同现有 scratch workspace，标准 `.` 源入口、共享 Electron 44.1.1；主 PID 23204、Harness 50572、CDP 50573、自有 HTTP 50574。只开一轮真实 Browser → 地址 Enter → More → PiP。自己的主 HWND `18483414` 初始隐藏，验证归属后 `SW_SHOWNOACTIVATE(4)` 显示，之后 true/未最小化；PiP HWND `7475268` true/未最小化。此次 `GetForegroundWindow` 前后均返回 0，只能记录未观察到值变化，不能把它升级为已知前台窗口身份证明；没有发送 OS 鼠标/焦点操作。启动期 DOM visible/hidden 有延迟，公共入口在实际面板控件出现后继续；本轮主 DOM 最终 visible、1441×920。

修复效果已直接证实：PiP `onFrame` API 从 undefined 恢复为 function，Runtime 重放日志不再出现 preload 加载失败或 onFrame TypeError，document 完成导航。但这不是完整功能通过：10 个 500ms 间隔样本中的已加载 img 均 naturalWidth/naturalHeight=0、srcLength=0；随后同一窗口 4,014.4ms 的 src MutationObserver 记录 0 次更新。实际查看 `pip-public-ui-fixed.png`，仍是黑底/broken img/占位文字，没有页面图像。因而持续更新、图像尺寸和真实质量验收仍失败，没有估算性能收益，也未追加“PiP通过后”的 Files64 原生可见观察。

第二层的源码调查边界：打开 More 菜单使 `PreviewPanel.tsx:284–287` 的 overlayOpen 调用 previewHide，解释了 PiP 打开前 guest DOM hidden；`defaultAttach` 的 `setVisible(false)` 在 `preview.js:173–178` 移除 BrowserView，`openPictureInPicture:923` 再隐藏 guest，帧路径 `:462` 对该 guest 调用 capturePage、`:470–477` 过滤零尺寸。PiP 已原生 show，说明首次 await capture 已返回；是否返回零尺寸、捕获异常或发送前失效尚未通过主进程对象观测区分。此处保留失败边界，不把 detached guest 推断当成已测根因，不盲加 capture 参数、重试或权限修改。

原始数据 `pip-public-ui-fixed-result.json`、`pip-public-ui-console.json`、`guest-before-pip.json`、`native-own-window-show-inactive.json`、`native-own-windows-observed.json` 和已实看的 `pip-public-ui-fixed.png` 保存在上述目录。统一装配需包含新的 source preload，但不能以 6 项检查通过代替真实 PiP 帧质量通过。

本次 source preload SHA256 为 `3EBACD1D9063FA5C9AC511479A93A0975B2B37E2FB0E8F811A0F9F6AB3F3EEFC`。第二轮也已由自己 Harness 的公共 windowAction(close) 正常退出，记录 code 0/signal null、PID 23204 已不存在；没有保留诊断窗口或关闭用户进程。

## T13 第二层区分实验：附着时也无可捕获 display surface

按统一候选要求增加一个有停止条件的区分实验，只在启动参数加独立 main inspector；未改产品显示/节流/功耗或权限。新的独立 profile `C:/Users/48818/AppData/Local/Temp/whale-performance-pip-ui-8k2yZe`，自己的主 PID 29092，Harness 50067、renderer CDP 50068、main inspector 50069、同一自有 HTTP fixture 50070。main inspector 用 Electron 进程中的 builtin `createRequire(... )('electron')`，核实 process.pid 后，只筛选准确 fixture URL 的 guest；没有从绝对 npm 包导入 Electron。为在移除后仍能只读同一个 BrowserView，首次取样保留其 WeakRef，不修改 guest 方法/属性、owner 或产品调度。

本次主 BrowserWindow id2 的 `isVisible=true`、`isMinimized=false`、bounds 1441×920；准确 Harness BrowserView id3 实际 getBounds x0/y0/1441×920、附着 id2。自己的主 HWND `24252922` 经既有 SW_SHOWNOACTIVATE 显示；前台 API 两次为0，不能提供活动桌面前台身份。尽管这些原生值正确，Harness renderer 的 document.visibilityState 等待10秒仍 hidden。原生 Input.dispatchMouseEvent/Enter 未触发对应控件，所以诊断后续通过准确目标页面的公共 DOM button.click、URL输入与 form.requestSubmit 进入同一 Browser→More→PiP handler；不是直接 preview IPC，也不能将这条诊断路径冒充正常原生键鼠交互验收。

同一 guest id5（URL `http://127.0.0.1:50070/`）已加载 fixture 标题/正文。各状态仅手动取一帧，PiP 后另取一帧 stayHidden:true；没有重复4秒空图采样、stayAwake、方法包装或产品调整：

| 状态 | 实际 BrowserView.getBounds | getOwnerBrowserWindow / attachment | guest document | capturePage 返回 |
| --- | --- | --- | --- | --- |
| More 前 | x902/y98/539×822 | id2 / 1个，主窗 visible且非最小化 | hidden、complete、viewport539×788 | default立即抛 `Current display surface not available for capture`，记录0ms |
| More 遮罩后 | 同上 | null / 0个 | hidden、complete、同viewport | default同错误，0ms |
| PiP 后 | 同上 | null / 0个 | hidden、complete、同viewport | default同错误，0ms；stayHidden:true同错误，0ms |

这四次调用没有返回 NativeImage，因而 getSize/isEmpty/JPEG bytes 是**无返回对象、不可测**，不是0值。PiP 自己 HWND `61412162` 可见/未最小化，主 HWND 仍可见。More/PiP确实移除了 guest，但 More前的已附着状态也已失败；没有取得“before有图、after空图”的证据，不能支持 owner 修复或把 detach 宣称根因。读取失败准确区分了手动 capture 被调用而抛异常，未测量产品 interval 每次调用数或异常率。此前产品 `publishCapturedPreviewFrame` 会捕获并静默返回该类异常，实际无src更新与此相符，但该代码推断也不是 interval 取样证据。

目前最小下一判别是解释原生可见而 Chromium document 持续hidden：Win32直接 ShowWindow 可能只改变原生显示、没有经过 Electron 的页面可见通知（待验证推断）。在准确自有 BrowserWindow 上调用 Electron showInactive 后再观察已附着 guest 的单帧，能与 owner 假说区分；本次指令指定既有SW方法，所以先把证据与方案交根代理，尚未擅改QA显示方法。无需新增owner宿主、重试、fallback或权限。源产品增量仍仅前述自包含 PiP preload。

原始 `main-inspector-initial-state.json`、`capture-before-more.json`、`capture-more-hidden.json`、`capture-pip.json`、`native-own-window-show-inactive.json`、`native-own-windows-observed.json` 和 public DOM动作记录位于本实验目录；没有隐藏退出码或将捕获异常当成图片。此节点仍不能声称 PiP 帧质量通过。

统一候选随后授权最后一次区分：通过公共 More → 关闭独立预览窗口恢复 guest 附着；对核实 PID/准确 BrowserWindow id2/Harness URL 的主窗仅调用一次 Electron `showInactive()`，最多等待2秒，没有 focus、showMain、hide-show或额外权限。前后 Electron isVisible 都true、isMinimized都false、同 HWND24252922、主窗及HarnessView bounds不变，Harness document.hidden都true/visibilityState都hidden。原生读数也仍可见；前台 API仍为0，不能给出活动桌面的前台身份。

只追加这一轮授权的 More前单帧：guest id5 已恢复 ownerWindowId2、1个attachment、原实际539×822 bounds，fixture完整；default capture依旧立即抛同一 `Current display surface not available for capture`。未再More/PiP重采或尝试隐藏后重显，未新增owner产品策略。一次 Electron showInactive 未解决 display surface门槛，也未区分该门槛的环境/显示生命周期来源，所以不能声称“Win32显示未同步”已证实，也不能利用这次全程无图的实验判断原始 owner是否应改。

授权后的原始 `electron-showInactive-single-result.json`、`native-before-electron-showInactive.json`、`native-after-electron-showInactive.json`、`capture-before-more-after-showInactive.json` 与保留的 `native-after-capture-pip.json` 位于同目录；`capture-before-more.json` 已由这次最终授权取样更新，最初结果保留在执行输出与上表。最后公共 windowAction(close) 退出code0/signal null，PID29092已不存在、自有HTTP server随进程退出关闭；main inspector客户端也已断开，没有遗留诊断应用。第二层未作产品修改，完整PiP帧质量仍是明确的未通过边界；本轮不追加Files64观察。

root随后只读核实本工具进程的Windows环境：sessionId=1、Environment.UserInteractive=true，线程桌面与以READOBJECTS打开的输入桌面名称均为 `Default`，OpenInputDesktop错误码0。没有切换桌面、改变电源/锁屏、发送鼠标或抢焦点。此结果不能证明屏幕亮着或应用具有可捕获GPU显示表面，也不能归因产品；用户的实际屏幕/锁屏状态仍待回答，不能自行假定锁屏是根因。
