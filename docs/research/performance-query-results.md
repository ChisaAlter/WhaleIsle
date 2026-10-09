# T03 / T04 / T17 性能结果

目标目录：`C:/AI/WhaleIsle-application-performance`，分支 `codex/application-performance-full`，基线 `26205a89`。取样时间为 2026-10-08 至 2026-10-09，源码测量 Node.js v24.19.0，实际打包和 packaged smoke 使用 v24.21.0。只在隔离目录修改、运行源码检查、自有夹具及目录包；未访问或启停用户实例。该轮性能取样与目录包验收阶段没有 PR、推送或提交；后续 Git 状态另在交付回复中报告。

## T03 — 采用点查询和去除第二次事件复制

- `SessionCorpus.load` 冷读取改用现有 `sessionPersistence.stat(id, {signal})`，不再为每个 id 列完整库存；库存/header 相容性检查、live owner 优先和读句柄清理保留。
- `readSession` 的事件已由 corpus 逐条深复制，返回前使用 `adoptSessionEvent` 验证并冻结 message，避免再次 `structuredClone`。临时 detached restore 未进入 SessionStore，事件壳和嵌套数据的脱离语义不依赖第二次复制。
- 未新增公开 API，未迁移 `observeSession`；未增加逐会话统计缓存，未将旧 count/max-created watermark 当成内容版本。原统计 checkpoint、全会话替换聚合、价格、fork 边界、修复接口和错误覆盖度维持原实现。prepared cache 只有五个，不据此宣称全库重扫免重放。

同进程、同数据，五次成对 baseline/候选，交替执行顺序。1000 个冷小会话各含一条 128 个填充字符的 user message；8MiB 场景是一条 8MiB ASCII 填充 message。内存 persistence 返回完整独立事件，测时不含构造夹具、结果哈希和 context disposal。

| 场景 | 原中位 | 候选中位 | 改善 | 调用变化 |
| --- | ---: | ---: | ---: | --- |
| 1000 冷小会话完整读 | 3614.835ms | 172.056ms | 95.2% | list 1001→1；stat 0→1000；完整 read 仍 1000 |
| 8MiB 完整日志读 | 24.418ms | 16.251ms | 33.4% | list 2→1；stat 0→1；完整 read 仍 1 |

全部成对返回摘要相同；检测了返回事件壳可修改且不改持久化工件、identified message/content 深冻结、后续独立读取不被污染。这是宿主源码函数成本和调用数证据，不能将 95.2% 当作真实统计 UI、真实 JSONL I/O 或整应用速度提升。

## T04 — 部分采用，无数组摘要与事务内 statement 复用

采用：
- 摘要保留首个 FTS match、Unicode code point 上限、空白归一化和省略号规则，用原生字符串归一化、code point 计数与范围切片替代两份完整字符数组。
- 文档 `codepoint_length` 无数组计数，保留代理项语义。
- 一次 reconciliation transaction 的所有 changed persisted sessions 复用四条 prepared statements；statement 只属于该次事务，不跨数据库、schema、服务或 generation 常驻缓存。
- stable before/after persistence observation、live 优先、revision/generation/cursor、排序、删除/替换、事务 rollback 和取消均不改。

同机三次成对 baseline/候选，交替顺序，SQLite `:memory:`、相同 fixture 和 `match` 查询，分别首次、未变和一个 revision 改变。所有对应返回 items SHA256 相同。6000 个 Unicode、组合字符、孤立 UTF-16 代理项、标记、空白和长度组合与旧 snippet 算法逐个相同。

| 场景 | 原中位 | 候选中位 | 改善 |
| --- | ---: | ---: | ---: |
| 1000 小会话首次搜索 | 486.339ms | 322.418ms | 33.7% |
| 1000 小会话未变搜索 | 29.428ms | 32.024ms | -8.8%，绝对差 2.596ms |
| 1000 小会话一个变更 | 33.554ms | 32.003ms | 4.6% |
| 8MiB 单文档首次搜索 | 1030.455ms | 408.095ms | 60.4% |
| 8MiB 单文档未变搜索 | 821.374ms | 326.241ms | 60.3% |
| 8MiB 单文档一个变更 | 1012.211ms | 461.648ms | 54.4% |

小会话未变取样区间原 27.5–39.9ms、候选 27.5–37.5ms，相互覆盖；三组不足以判断显著收益或退化，不能抹掉这项差异。1000 首次同步 replacement 累计约 360.8→205.8ms；8MiB 未变结果构造约 584.0→79.9ms，但 SQL/FTS highlight 仍约 245.5ms。**这条极端长单文档和大库同步事务未达到 50ms 连续阻塞目标。** 未采用新的 worker、延迟旧索引、历史/摘要截断或整份查询结果缓存。完整 SQL worker 需要同时拥有 persisted/TEMP live 数据和装配协议，本轮没有冒充完成该部分。

## 检查与实际体验边界

产品后执行：
- Harness 最初四个定向文件 141 项中 140 通过；唯一失败是已改为 stat 的 exact lookup 仍只注入 listFailure。将已有故障夹具同步为 statFailure，保留原失败断言和取消清理检查，单独重跑 session-query 44 项通过。
- 最终 SQLite `sqlite.spec.ts` + `query.spec.ts` 72 项通过；未改平台 skip。加上已经通过、未受最后 SQL 改动影响的 observation，共 143 项受影响 Harness 检查。
- 现有 usage 插件测试 191 项通过，含 refresh/inherited/projection/session-repair；插件代码未改。 shell 无 npm 命令时直接执行已有 `node vendor/dsh-usage-panel/scripts/run-tests.mjs`。
- `node --test scripts/production-runtime.test.mjs` 原九项通过，含 peer/optional/native closure、nested subpaths、license、实际 Electron builder file collection 和 Office staged trimming。
- `git diff --check` 通过。一次性 `__perf` 源码/夹具已删除；下方保存测量数据，没有新增常驻遥测。

实际用户路径未验：本候选中的统计页同时发送/搜索、真实 JSONL 冷库、真实 Electron 搜索/切换/生成中操作。下方 T17 补了实际目录包首次 runtime 提取和启动，现有 packaged smoke 的右侧栏探针仍失败；未通过整体验收。根代理负责统一真实画面/行为检查；源码和合成结果不能代替这些验收。

## T17 — 本轮无新增裁剪

本候选 tracked checkout（按当前文件字节；不跟随整个开发依赖树）：
- 排除路径内 `node_modules`：23,197 文件、477,343,354B。
- Git 跟踪的插件 `node_modules`：11,971 文件、225,980,453B。
- 上述数值含源码、文档、已有插件产物和素材；不含未跟踪 pnpm store、构建缓存或后来生成的 staging。它们不是安装大小，也不能与 NSIS/asar/提取结果相加。

`src/renderer/pet-live2d` 原始素材 64,564,092B；按当前 package.json pet 排除项，14,528,111B 已排除，50,035,981B 仍纳入配置。这里只是未压缩文件集合，尚未证明最终 staging/asar 字节。

| 集合 | 源字节 | 既有排除 | 配置保留字节 |
| --- | ---: | ---: | ---: |
| avatar | 8,468,440 | 3,804,822（HD 模型/图） | 4,663,618 |
| ORT 五文件 | 33,944,790 | 0 | 33,944,790 |
| Anime4K + license | 9,458,559 | 0 | 9,458,559 |
| rig | 11,753,161 | 10,723,289 | 1,029,872 |
| states | 939,142 | 0 | 939,142 |

ORT、Anime4K、SD model、rig/states fallback 本轮没有裁剪。SD model 4,614,932B；HD model 3,650,011B 已由原过滤排除。静态算法/算子裁剪仍需保留当前算法、加载时序和 WASM fallback，并与 T16 的模型集合协调，未据源码大小认定可删。

现有 coverage：`production-runtime.js` 从 CLI 与 19 个显式 desktop roots 遍历 required、存在的 optional 和 peer production edges；根据真实 resolved source 保留依赖实例。`runtime-instance-graph.js`、after-pack 继续保护 realpath/peer identity，包的公开子路径、许可证和 native/WASM 降级；已有 map/types/build metadata、已识别 dev trees、非目标 native 和 Office tests/可替代 pyc 裁剪保留。没有按包名/版本硬合并或新增目录黑名单。

上述源码取样时 `build/office-runtime`、`vendor/dshd-remote` 和 `vendor/whalebridge/.runtime` 不存在；`vendor/chisacode-remote` 是源码，不作 daemon 包内体积。下方为后续实际目录装配、首次提取及包内 daemon 的分层数据；NSIS、升级/恢复仍未验。

### T17 — 2026-10-09 实际目录装配与首次提取

本次实际目录输出为 `dist/win-unpacked/Whale Isle.exe`，桌面版本仍为 **0.3.3**，Electron 44.1.1。没有生成或安装 NSIS，没有升级用户 0.3.4，没有提交、推送或 PR。以下为候选包自身的数据，不能与上方源码取样相加。

构建输入与隔离环境：

- 构建进程使用 `%TEMP%/whale-performance-node-bin.txt` 中既有 Node 24.21.0/npm，只改当前进程 PATH。启动实际包前清除 `ELECTRON_RUN_AS_NODE`、`NODE_PATH`、`ELECTRON_PATH`，防止外部开发依赖掩盖包内缺资源。
- 第一轮 `npm run pack` 在 remote 的 better-sqlite3 Electron rebuild 前失败：node-gyp 未发现 Python。使用自有 Office payload 的 Python 3.12.14 设置当前进程 `PYTHON` 后，真实 Electron/Node ABI 检查、remote runtime 装配和自有 daemon start/stop 探针通过；不是 native policy 拒绝，也没有绕过系统策略。
- 第一轮进入 builder 时，根开发依赖 junction 令 collector 出现 7 条 `undefined` 依赖警告，随后只取消了已核实属于本次构建的 builder 进程树，旧装配没有完成。曾用 `@electron/asar.statFile` 的正斜杠成员路径在 Windows 下得出过“所有根生产包缺失”的错误结论，现已更正：该 API 要求本机 `path.sep`；旧 ASAR 已覆盖，不能据此追认旧包全缺失。真实 collector 警告仍保留在旧日志，属于隔离依赖输入问题。
- 对原 junction 的 `Remove-Item` 被自动审批拒绝（返回通用 `blocked by policy`，未给具体原因），未换壳重试删除。核对自有源、目标和原 Target 后，将 junction 移到自有 `.tmp/root-node-modules-shared-link`，保留其原 `C:/AI/Deepseek-Harness-Desktop/node_modules` Target。自有根目录执行同锁 `npm ci --offline --omit=dev --ignore-scripts --no-audit --no-fund` 成功，21 个包；锁文件 SHA256 前后均为 `0D7056305DBB8FC3FF5E897471B7F829D28D0B74B7A67721EA9545CBDC0C199F`。
- after-pack 的 `copyBundledPnpm` 直接读取 projectDir 下文件，因此将锁定的既有 pnpm 11.22.0 的 `package.json/bin/dist/LICENSE` 从原目录只读复制到自有真实 `node_modules/pnpm`，没有改 package 或锁版本。构建工具通过只读 `NODE_PATH` 复用原开发依赖，Electron 明确复用原 44.1.1 dist。
- CLI 短参数 `-c.electronVersion` 曾被解析为配置文件名而在装配前 ENOENT；改为现有 builder 支持的长参数后成功。最后仅运行现有目录 builder，复用已完成的 remote/Office 输入，没有重复强制重编：

```powershell
node scripts/run-electron-builder.cjs --dir --publish never --config.electronDist=C:/AI/Deepseek-Harness-Desktop/node_modules/electron/dist --config.electronVersion=44.1.1
```

最后 builder **exit 0**，542.378s；afterPack 日志 403.1s。其他代理的 soak/QA 同时运行，这不是可比的速度基线。现有装配验证得到 309 个选择的 workspace packages、623 个依赖实例和 3038 条链接，真实 CLI `dump-config` skip/full 两轮通过。Office kit 0.1.5/win32-x64 引擎闭包通过；输入 payload digest `a7dddb0dc2b5035d86c7f39a4e2c688ccf531a3ba11d0737d441d6376500c14e` 经既有 staged trim 按实际文件绑定为 `21b86026bc5d21f9c12d94d2a0403c799311f72a073972e53cf867d4ecad441d`，不据此更改锁定 input identity。

实际文件统计使用 lstat/Dirent，不跟随链接，所有 bytes 是文件逻辑长度，未测 NTFS 分配块或安装器压缩率。父子行包含同一批文件，不可相加：

| 实际集合 | 文件数 | 字节 | 链接数 |
| --- | ---: | ---: | ---: |
| 整个 win-unpacked | 16,047 | 1,186,198,883 | 0 |
| resources | 16,028 | 851,214,413 | 0 |
| app.asar 物理归档 | 1 | 62,481,714 | 0 |
| app.asar 逻辑成员（含 unpacked 标记） | 734 | 66,047,811 | 0 |
| app.asar.unpacked | 103 | 3,757,821 | 0 |
| resources/runtime | 5,560 | 253,822,432 | 0 |
| 其中 Office primary-runtime | 5,553 | 253,774,671 | 0 |
| resources/pnpm | 439 | 18,549,744 | 0 |
| resources/vendor | 9,924 | 512,491,629 | 0 |
| 其中 deepseek-harness.tar | 1 | 406,501,376 | 0 |
| 首次提取 runtime/0.3.3 | 14,812 | 392,713,101 | 3,038 |
| 首次 smoke 完成后的整个隔离 user-data | 14,916 | 409,762,177 | 3,044 |
| 其中 dsh-home | 34 | 139,471 | 6 |

tar 实际 18,957 条目，其中 14,811 普通文件；解压后多出的 runtime identity 文件另计。实际恢复链接数量与装配图相同；启动日志明确走归档校验、首次解压、链接恢复/校验，随后加载提取目录内的 CLI。归档清单和提取 identity 的 archiveBytes 均为 406,501,376，archiveSha256 均为 `efafb12f570d0ba9a1bb1c6395adb35043183e09d5811de12912a8dd82b2320e`。日志只有“已用时 5 秒”的进度，没有可靠的最终提取耗时；115.583s 的整个 smoke 包含启动、探针和退出，不能作为提取耗时。

实际插件资源分别为：usage 399 文件/3,884,679B；dsh-im 949/34,012,996B；dshbot 474/6,474,104B；task-control 10/35,565B；platform-session 5/4,688B；dsh-whale 749/11,769,321B；dsh-remote 428/3,846,585B；dshd-remote 6,907/45,962,015B。它们包括各自真实生产依赖，不代表同名依赖可以无损合并。原剪枝移除 usage 165、dsh-im 83、dsh-remote 2 个非生产包，其余日志为 0；本轮没有新增剪枝。包内 JS test 条目为 0；实际 ASAR pet 22 文件共 50,035,981B，HD model 未进入包，ORT/Anime4K/SD model/rig/states 保留，符合上方既有过滤。

watcher 实际闭包：

| 文件 | 实际位置 | 与候选源码 SHA256 一致 |
| --- | --- | --- |
| pet-dsh-watch-host.js | ASAR | 是 |
| pet-dsh-watch-worker.js | app.asar.unpacked | 是 |
| pet-dsh-watch.js | app.asar.unpacked | 是 |
| pet-growth.js | app.asar.unpacked | 是 |
| pet-growth-scan-worker.js | app.asar.unpacked | 是 |
| pet-settings.js | app.asar.unpacked | 是 |
| smoke/index.js（含 dispose drain） | ASAR | 是 |

实际解包后的 watch worker 用自有空目录执行 poll，收到 `{type:"result",id:1,ok:true}`，证明 worker 和 require 闭包可加载；它不证明完整用户事件/累计统计/长期重载语义。builder 根生产包集合含 updater、node-pty、koffi 等 21 个包，最终 collector 无上述旧 undefined 警告。

`npm run smoke:packaged` 通过现有 `DSHD_SMOKE_EXISTING_WORKSPACE` 使用自有本地 sparse clone（基线 HEAD，没有新 commit），脚本自建 profile：
`C:/Users/48818/AppData/Local/Temp/dsh-packaged-smoke-ZVs5vw`。没有访问真实用户 remote，未接管 OS 鼠标。实际结果 **exit 1，ok:false**，不是通过：

- 首次 runtime 提取成功、Web UI ready、`last-desktop-start.json ok:true`、scoped Harness/boot shell API、标题栏和 PTY `echoed:ok`、`pageErrors:[]`。
- 标题栏 hits 为 surfaces=1、branch=0、git=0；现有探针失败：`rightbar did not open inner=1441 frame=1441 collapsed=false surfacesCollapsed=true rightbarWidth=0`。没有弱化断言或重跑相同失败。
- 本次 normal exit 1 没有出现旧 0xc0000409 快退结果；这不能单独证明旧 native 崩溃根因已确定或所有退出路径安全。
- `packagedP0:null`；真实 Office 文档预览、升级/恢复、非空真实 JSONL 库、真实用量统计/搜索并行用户路径及完整画面质量仍未验。根代理的 source soak/pet/outbox 证据属于另一条验证，不能冒充这个 packaged smoke 通过。

保留日志：`.tmp-performance-pack.log`（首轮 Python 未发现）、`.tmp-performance-pack-python.log`（旧 collector + 主动取消）、`.tmp-performance-root-production-deps.log`、`.tmp-performance-builder-real-deps.log`（短参数误用）、`.tmp-performance-builder-real-deps-long.log`（成功目录装配）、`.tmp-performance-packaged-smoke.log`（实际探针失败）。profile 保留给根代理继续定位；本报告不附含 token/credential 的原始完整 boot log。

### T17 — 最终冻结源码的目录包（后续重包）

上一轮数据与失败为历史记录。PiP sandbox preload 的固定 channel 内联修复经两轴审查后，根代理冻结源码并授权这一轮重包；T11 仅调整 performance fixture，runtime/query/Harness 构建输入未再改变。没有新增 owner、权限、功耗或捕获策略，也没有再次 force remote/Office 编译。

使用同一受验证命令、Node 24.21.0 和只读 Electron 44.1.1/devtools 输入运行完整现有 builder；保留 afterPack、ASAR integrity 与全部装配校验，没有手工替换 ASAR、复用未验证归档或跳过校验。最终 **builder exit 0，563.540s；afterPack 403.0s**。日志 `.tmp-performance-builder-final.log` 再次证明 309 个选择的 workspace 包、623 个依赖实例、3038 条链接、Office kit 0.1.5 引擎闭包，以及真实 CLI skip/full compose 两轮通过。Office staged digest 仍为 `21b86026bc5d21f9c12d94d2a0403c799311f72a073972e53cf867d4ecad441d`，根锁 SHA256 未变。

实际 ASAR/解包后的全部 **153 个 src/main 生产 JS 文件与当前源码逐字节相同**。其中 watch host、watch worker、watch 实现、growth/scan worker、settings、smoke/index、preview 和 protocol 与装配启动前冻结快照的哈希一致；preload 的包内和源码 SHA256 均为：
`3ebacd1d9063fa5c9ac511479a93a0975b2b37e2fb0e8f811a0f9f6ab3f3eefc`。
新 preload 是 651B、位于 ASAR；watcher 的解包集合与上一轮相同。这是最终包确含冻结代码的证据，不能据此称 PiP 帧质量通过。

| 最终实际集合 | 文件数 | 字节 | 链接数 |
| --- | ---: | ---: | ---: |
| win-unpacked | 16,047 | 1,186,198,983 | 0 |
| resources | 16,028 | 851,214,513 | 0 |
| app.asar 物理归档 | 1 | 62,481,814 | 0 |
| app.asar 逻辑成员 | 734 | 66,047,911 | 0 |
| app.asar.unpacked | 103 | 3,757,821 | 0 |
| resources/runtime | 5,560 | 253,822,432 | 0 |
| 其中 Office primary-runtime | 5,553 | 253,774,671 | 0 |
| deepseek-harness.tar | 1 | 406,501,376 | 0 |
| 本轮首次提取 runtime/0.3.3 | 14,812 | 392,713,101 | 3,038 |
| 本轮 smoke 结束后的 user-data | 14,917 | 409,764,100 | 3,044 |
| 其中 dsh-home | 34 | 139,468 | 6 |

统计仍不跟随链接、不是 NTFS 分配量；父子行不可相加。目录包与 ASAR 比前轮增加 100B，其他装配集合规模相同。重建 tar 的新 archiveSha256 为 `8d856aa78cd115c5c007b63f4cc7267aa39d1785e390b0ed8694f840ab778f7f`；实际首次提取的 `.dshd-runtime.json` 与当前包的归档 identity 同值，3038 条链接恢复完成，随后 Web UI ready。日志只有阶段进度，没有单独最终提取耗时；不将整个 smoke 140.490s 解释为提取耗时或速度变化。

冻结后的实际目录包只运行一次原 `smoke:packaged`。仍使用自有本地 workspace、清除外部 `NODE_PATH/ELECTRON_PATH/ELECTRON_RUN_AS_NODE`，创建独立 profile `C:/Users/48818/AppData/Local/Temp/dsh-packaged-smoke-3v4heU` 并保留 artifacts；桌面版本仍为 0.3.3。**最终 smoke exit 1（应用 code 1，signal null）、ok:false，未通过**：

- `last-desktop-start.json ok:true`；首次归档校验/提取/链接恢复、服务和 Web UI ready、scoped Harness/boot API、PTY `echoed:ok`、`pageErrors:[]` 均有实际新包证据。
- hits 仍为 surfaces=1、branch=0、git=0；失败仍是 `rightbar did not open inner=1441 frame=1441 collapsed=false surfacesCollapsed=true rightbarWidth=0`。没有删断言、扩大 skip、原样重跑或隐藏退出码；应用正常失败退出，没有本次 0xc0000409 快退结果。
- 现有 smoke 在 hidden 运行方式下操作渲染目标；本轮没有取得独立 OS 原生可见性/完整画面验收，不能根据 DOM frame/API 宣称真实画面良好，也不假设用户锁屏。
- `packagedP0:null`。此包没有另做 PiP 帧质量、Office 预览、升级恢复或非空真实日志统计/搜索验收。根代理最后的 source 公共 PiP 路径已恢复 bridge/无 preload 异常，但仍 0 帧/黑占位、`Current display surface not available for capture`，native showInactive 后亦未通过；不据该现象再猜测或放宽 sandbox/权限/功耗，也不能由新包 hash/基础 boot 推翻该失败边界。

本轮最终日志为 `.tmp-performance-builder-final.log` 和 `.tmp-performance-packaged-smoke-final.log`。前轮报告与 profile 保留，但当前 dist 文件是这一轮最新输出。没有 NSIS、安装、版本提升、提交、推送或 PR；没有启停用户实例。报告只保留所需无 token 摘要，完整 smoke artifacts 留在自有 profile 中。builder、smoke 与一次性量化命令均已返回；最后一次仅按自有 win-unpacked 路径及这两个 smoke profile 定向读取进程，存活数量为 0，没有再启动产品或清理用户进程。

## 测量 JSON

以下为本轮有效对照数据；相同 phase 的 resultDigest 用于核对输出，fixture 不含用户日志或 remote。

```json
{
  "node": "v24.19.0",
  "base": "26205a89fb7a6d416ef446d6281cb77afe610bcd",
  "query": {
    "1000-small": {
      "beforeMs": [
        4645.572899999999,
        3337.5830000000005,
        3614.8351000000002,
        3925.9284000000007,
        3546.0577999999987
      ],
      "afterMs": [
        206.0625999999993,
        172.0561000000016,
        154.09119999999893,
        161.53989999999976,
        211.2017999999989
      ],
      "beforeCalls": {
        "list": 1001,
        "stat": 0,
        "read": 1000
      },
      "afterCalls": {
        "list": 1,
        "stat": 1000,
        "read": 1000
      },
      "equalResultDigest": "d83824f9c9608237f0571e6fe62827d709f96309f682ee782ea2e6cc26281c23"
    },
    "8MiB-log": {
      "beforeMs": [
        24.181400000001304,
        26.59129999999641,
        24.418099999998958,
        27.110500000002503,
        23.29399999999805
      ],
      "afterMs": [
        19.277500000000146,
        16.36909999999989,
        16.2512999999999,
        15.83259999999791,
        15.063100000003033
      ],
      "beforeCalls": {
        "list": 2,
        "stat": 0,
        "read": 1
      },
      "afterCalls": {
        "list": 1,
        "stat": 1,
        "read": 1
      },
      "equalResultDigest": "e42370a918ea2c546cedc590f35f4bb8dd65c9c6bdfc3bdde09a64fed6553bea"
    }
  },
  "snippetComparisons": 6000,
  "search": {
    "search-1000-small": [
      {
        "trial": 0,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 457.68780000000015,
            "replacementMs": 332.036299999997,
            "sqlMs": 18.256399999999758,
            "snippetMs": 0.32709999999951833,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 27.489199999999983,
            "replacementMs": 0,
            "sqlMs": 13.535200000000259,
            "snippetMs": 0.25369999999884385,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 33.55420000000004,
            "replacementMs": 0.5578000000000429,
            "sqlMs": 13.521899999999732,
            "snippetMs": 0.27539999999999054,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      },
      {
        "trial": 0,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 305.6507999999999,
            "replacementMs": 185.3920000000021,
            "sqlMs": 12.927799999999934,
            "snippetMs": 0.20850000000018554,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 27.496399999999994,
            "replacementMs": 0,
            "sqlMs": 14.794400000000223,
            "snippetMs": 0.16249999999899956,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 32.003099999999904,
            "replacementMs": 0.4796000000001186,
            "sqlMs": 14.612299999999777,
            "snippetMs": 0.20269999999982247,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      },
      {
        "trial": 1,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 322.4178999999999,
            "replacementMs": 205.77259999998296,
            "sqlMs": 14.071600000000217,
            "snippetMs": 0.19520000000056825,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 32.02399999999989,
            "replacementMs": 0,
            "sqlMs": 16.485299999999825,
            "snippetMs": 0.26430000000027576,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 31.54359999999997,
            "replacementMs": 0.6313999999997577,
            "sqlMs": 15.875500000000102,
            "snippetMs": 0.26330000000007203,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      },
      {
        "trial": 1,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 489.6028000000001,
            "replacementMs": 347.2346000000098,
            "sqlMs": 21.458400000000438,
            "snippetMs": 0.29109999999855063,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 29.42790000000059,
            "replacementMs": 0,
            "sqlMs": 15.57799999999952,
            "snippetMs": 0.28370000000086293,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 29.59320000000025,
            "replacementMs": 0.46200000000044383,
            "sqlMs": 14.202800000000025,
            "snippetMs": 0.23670000000038272,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      },
      {
        "trial": 2,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 486.33929999999964,
            "replacementMs": 360.77290000000994,
            "sqlMs": 16.53309999999965,
            "snippetMs": 0.2833999999984371,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 39.85940000000028,
            "replacementMs": 0,
            "sqlMs": 14.751099999999497,
            "snippetMs": 0.5824000000002343,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 36.74489999999969,
            "replacementMs": 0.80370000000039,
            "sqlMs": 20.269200000000637,
            "snippetMs": 0.29390000000057626,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      },
      {
        "trial": 2,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 377.85699999999997,
            "replacementMs": 216.69459999999617,
            "sqlMs": 18.065099999999802,
            "snippetMs": 0.18729999999959546,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1000
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "unchanged",
            "ms": 37.54029999999966,
            "replacementMs": 0,
            "sqlMs": 20.013299999999617,
            "snippetMs": 0.19959999999809952,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          },
          {
            "phase": "one-changed",
            "ms": 37.61110000000008,
            "replacementMs": 0.39320000000043365,
            "sqlMs": 18.500199999999495,
            "snippetMs": 0.19319999999788706,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "56bf9b5a0fa3475e95209ac5fb6d3b57ed3725b74ac22233e3f27efff262c283"
          }
        ]
      }
    ],
    "search-8MiB-log": [
      {
        "trial": 0,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 1296.9105,
            "replacementMs": 140.6305000000002,
            "sqlMs": 352.7399000000005,
            "snippetMs": 740.7357000000002,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 1181.0593,
            "replacementMs": 0,
            "sqlMs": 329.1397999999999,
            "snippetMs": 850.9283999999998,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 1212.8604999999998,
            "replacementMs": 149.452299999999,
            "sqlMs": 311.59170000000086,
            "snippetMs": 691.5224999999991,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      },
      {
        "trial": 0,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 614.7276999999995,
            "replacementMs": 83.81759999999849,
            "sqlMs": 392.9920000000002,
            "snippetMs": 80.73019999999997,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 404.48109999999906,
            "replacementMs": 0,
            "sqlMs": 311.78429999999935,
            "snippetMs": 91.81720000000132,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 461.64849999999933,
            "replacementMs": 87.21609999999964,
            "sqlMs": 267.9233000000004,
            "snippetMs": 56.157100000000355,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      },
      {
        "trial": 1,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 402.8114999999998,
            "replacementMs": 55.1857,
            "sqlMs": 247.91860000000088,
            "snippetMs": 57.804699999998775,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 308.91350000000057,
            "replacementMs": 0,
            "sqlMs": 250.70919999999933,
            "snippetMs": 57.378999999998996,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 430.60479999999916,
            "replacementMs": 78.09079999999994,
            "sqlMs": 250.8173999999999,
            "snippetMs": 59.040499999999156,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      },
      {
        "trial": 1,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 1004.0097999999998,
            "replacementMs": 116.51250000000073,
            "sqlMs": 265.52800000000025,
            "snippetMs": 578.189699999999,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 779.0383000000002,
            "replacementMs": 0,
            "sqlMs": 230.5018999999993,
            "snippetMs": 547.5501999999997,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 1012.2114999999994,
            "replacementMs": 123.46600000000035,
            "sqlMs": 239.29149999999936,
            "snippetMs": 604.5259999999998,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      },
      {
        "trial": 2,
        "variant": "before",
        "phases": [
          {
            "phase": "first",
            "ms": 1030.4552000000003,
            "replacementMs": 115.91790000000037,
            "sqlMs": 311.22940000000017,
            "snippetMs": 561.6588000000011,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 821.3735000000015,
            "replacementMs": 0,
            "sqlMs": 236.5020999999997,
            "snippetMs": 583.9526000000005,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 949.2201000000023,
            "replacementMs": 118.8060000000005,
            "sqlMs": 243.3013000000028,
            "snippetMs": 540.7785000000003,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      },
      {
        "trial": 2,
        "variant": "after",
        "phases": [
          {
            "phase": "first",
            "ms": 408.09539999999834,
            "replacementMs": 58.16929999999775,
            "sqlMs": 252.11169999999765,
            "snippetMs": 59.252300000000105,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "unchanged",
            "ms": 326.2412000000004,
            "replacementMs": 0,
            "sqlMs": 245.5025999999998,
            "snippetMs": 79.87319999999818,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 0
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          },
          {
            "phase": "one-changed",
            "ms": 513.2027999999991,
            "replacementMs": 88.37249999999767,
            "sqlMs": 320.89550000000236,
            "snippetMs": 60.48199999999997,
            "calls": {
              "list": 2,
              "stat": 0,
              "read": 1
            },
            "resultDigest": "cf2e01849d1f1450cdce1e3c67db869beadeac96f0d853331b1425ed9d21bb9b"
          }
        ]
      }
    ]
  }
}
```
