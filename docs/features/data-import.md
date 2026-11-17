# Feature: Official home import

| Field | Value |
| --- | --- |
| **id** | `data-import` |
| **status** | `active` |
| **last verified (optional entry)** | 2026-09-29 — 可选来源不再阻断自动启动或覆盖首页；中断恢复与不可读 journal 仍 fail-closed。启动门禁和恢复定向 75/75；导入扫描与迁移逻辑未改变。2026-09-29 实机复测：隔离空桌面在有 72 个可导入 `~/.agents/skills` 技能时仍直接进入工作区并记录 `ok:true`，未跳导入页。见 `docs/qa/results/2026-09-29-four-fix-live/`。 |
| **last verified (A1/A5 data preservation)** | 2026-09-28 — MCP / 设置 / 凭据读取仅 ENOENT 视为空；独占随机 0600 临时文件、fd 写入并 fsync 后同目录 rename 发布；文件 / 父目录链接与检查错误拒写，异常清理只处理本次持有的暂存文件。新增真实 `runImport` 故障注入回归 63 项；联合 data-import / import-transaction / import-crash / import-guard / IPC 定向 201/201 通过。统一门禁、决策记录和应用重启由主代理完成。 |
| **last verified (remediation)** | 2026-09-28 — 审计整改十轮。Iter1（F1–F4/F7/F8）：journaled 三段式替换、附件合并、同名技能拒绝、附件失败计入 `ok`、task-protection 区间、IPC catch/aria-live。Iter2（R1–R8 首轮）：`needsRecovery` 跨阶段传播并写 `blocked`；`txnPathsOwned` 信任边界；commit 改 controller 级 `stopDesktop`+cleanup；冻结 targetVersion、空目标 fail-closed；预检同名技能零写；`retryFullPluginsSlim` 占单槽；诊断持久化+progress 带 `op`；radio `keydown` 只绑一次；`<ul>` 恢复原生 list 外层 tabpanel。Iter3（复审收口）：`txnJournalOwnsPath` 物理父目录绑定 + tmp/bak 精确 opId 派生名 + `decideTxnResolution`；`blockedStartError` 准入；`normalizeVersionString` 双向归一；live `existsSync` 冲突复查；`return await` 持槽至 spawn；`cancelImport` opId 校验；roving tabindex + `lastIssuedRoute` 去重。Iter4（共享维护槽+全准入）：新建 `import-guard.js` 单例槽，install/start/retry/import 全部 ACQUIRE 同一槽双向互斥；`readImportJournal` 区分 ENOENT 与不可读（`unreadable:true`）；`txnPathsOwned` 加 `canonicalParentChain`/`isInsideCanonical`/`parentChainIsLinkFree`；`cleanupDesktopResources` 改 Promise 并 await；`waitForInstall` 预置 aborted 提前返回；renderer `cancelImport` 快照 `cancellingOpId`+识别 resolved `{ok:false}`；route save 失败重置 `lastIssuedRoute`+popup/radio 共用 `issueRouteSave`。Iter5（owner-aware delegation+write-ahead inventory+真谓词导出）：`journalIsBlocked` 加进 `module.exports`（service/index 去 fallback 直调、`launcher-gate` 注入同一谓词），`recoverInterruptedImport` 先判 `unreadable`/shape 再比 `destHome`；`replaceDirJournaled`/`commitStagedDir` 调 `parentChainIsLinkFree` 拒 junction dest 父链写；opId 改 write-ahead 注册、blocked journal 保留 `txnIds`、空 `allowedOpIds`=零授权、async reconciler 同步接 `allowedOpIds`；`importGuard.holdsMaintenance` owner-aware delegation（`restartWithCleanup(delegatedToken)` 同 owner 放行、`startDesktopFromLauncher` 透传 `maintenanceToken`、`shell:restart`/`recordBootRestart` 前置准入、`removePluginOp`/profile-ops ACQUIRE 持到 deferred align）；import 移除 `preConfirmed:true`（恢复正常 protected-import decision）；空 `targetVersion` 在 `installFromAsset` 前拒绝 + 同版本要求 stamp 前进 AND child 未报失败；renderer `cancelImport` 两分支过 `stillOwns()`；`issueRouteSave` 识别 resolved `{ok:false}` 按失败 + `pickDownloadRoute` 去 `routeId===current` 早退。Iter6（fail-closed 形状校验+嵌套 owner 透传+slot 泄漏封堵+测试 stub 补全）：`readImportJournal` 加 `isUsableJournalShape`——`null`/`[]`/`{}`/不合规 JSON 归一 `{unreadable:true,invalid:true}`；`registerTxnId` 改 REQUIRED 抛错、`mergeDirJournaled` staging 前先 `parentChainIsLinkFree`；`alignHarnessAfterProfileChange` 透传 ownerToken、同步段 `transferred` 标志封堵 slot 泄漏、非 launcher `shell:retry-full-plugins` 走 `recordBootRestart` 准入；同版本 `settled=false` 恒等+installer 生命周期 `onInstallerLaunch` 即捕获；`ipc.test.js` stub 补 `readImportJournal`/`journalIsBlocked`。Iter7（完整 journal 校验+零授权 legacy+入口真正 acquire）：`isUsableJournalShape` 升级完整契约（phase 枚举+destHome+txnIds string 数组）；无 `txnIds` 字段的 legacy journal 授权集=空 Set 零授权；新增 `txnDests` opId→dest 绑定；`isLinkLike`/`canonicalParentChain` 仅 ENOENT 放行、其余检查错误 fail-closed；`recordBootRestart`/`restartWithCleanup`/`startDesktopFromLauncher` 独立入口真正 acquire；`profile-ops` 加 `configureProfileOps({journalBlocked})` 写前先判 blocked journal。Iter8（destination 绑定强制+overlay 检查错误中止+reload/removal 准入）：inventory 模式下 opId 必须有合法 `txnDests` 绑定且匹配 dest（缺失/畸形/不匹配记 `unbound-destination`）；`classifyLink` 四态——overlay 对 `error` 中止不重演 F1、对 `link` 按 overwrite 处理；`reloadWithCleanup` 区分真 reload 与会 start（后者走 blocked journal+`acquireMaintenance`）；`removePluginOp` 首副作用前判 `blockedStartError`。Iter9（reload dispatch 拒绝传播）：commit 内拒绝写局部 `dispatchRefusal` 外层 `.then` 优先返回——coordinator 丢弃 commit 返回值不再把 refusal resolve 成正常完成。Iter10（reload 可测 seam+fixture/生产路径补全）：新建 `desktop-reload.js` 依赖注入 `createReloadWithCleanup` + `desktop-reload.test.js` 4 用例（真 `createTaskProtection`+deferred cleanup ready→idle race）；`refuses opId that mismatches` 补 ownership 落 `untrusted-journal`；`importSessions` 注入 staged tmp lstatSync 错误验证 merge 中止不发布。**2621/2623 全量单测（0 FAIL）**、聚焦 260/260、`check:governance` 6/6、`doc-sync` 8/8、`pack:launcher` 打包成功。 |
| **last verified (import task ownership)** | 2026-09-24 — 主进程在停内核前占用单任务锁；并发请求返回 `import-in-progress`，异常后可重试；空选择不创建 journal。`ipc` + `data-import` 89/89 通过。 |
| **last verified (v3 gate)** | 2026-09-23 — `session.v3.jsonl(.zstd)` 与旧名共同参与浅探针、导入扫描和冲突识别；真实桌面 home 的 `probeImportHold` 为 `hold:false`，`data-import` + `launcher-gate` 51/51 通过。 |
| **last verified** | 2026-09-20 — C1 性能基线（仅测量，无产品行为变更）：`probeImportHold` / `scanImport` / `listDir` 的函数级测量与判定见 `docs/decisions/proposed/testing/2026-09-20-desktop-performance-measurement.md` 与审计计划 Phase 6。此前 2026-09-20 — B3 持久化负路径：取消发生在最后一个会话拷贝之后或后续 skills/plugins/settings 阶段时，journal 必须保持 `copying` 供冷启动恢复，不能提前写 `done`；未完成会话只留完整已拷贝项与可清理的 `.import-tmp` 暂存目录。`node --test src/main/data-import.test.js` 26/26 通过。此前 2026-09-15 — 导入改异步可取消（`966bd84`）：拷贝阶段让出事件循环、逐项间响应 `shell:cancel-import`；启动器按阶段显示进度并给可续跑提示。`node --test data-import.test.js ipc.test.js` 81/81 通过。此前 2026-09-05 — 历史会话恢复与插件归因定向检查：Harness 工作区/API/旧缓存 121 项、桌面导入/恢复/打包单测 171 项通过；重新登记已有目录接纳导入历史，缓存格式错误不归咎用户插件。未执行候选安装包升级实测。此前：2026-08-25 — 新增设置白名单节 / 引用凭据 / `.agent-presets` / home `AGENTS.md` 导入；冷启动闸门改 shallow probe；导入页展示「将迁移/不迁移」说明 |

会话 JSONL/zstd 的只读展示元数据解析位于 `src/main/data-import-session-meta.js`；扫描、导入与事务编排保留在 `data-import.js`。

## User paths

1. 启动器「导入」自动只读扫描官方 `~/.dsh`（会话、附件、`profiles/web/package.json` 插件名单、`skills/`、`mcp-servers.yaml`）以及 `~/.agents/skills`。
2. 「选择目录」另加一个按 home 布局扫描的来源；「添加技能目录」把含 `SKILL.md` 的根并入技能列表。不扫项目仓库，除非用户主动选中该文件夹。
3. 导入页用分类页签勾选会话 / 技能 / 插件 / MCP / 设置 / 预设，默认可导入项全勾。会话按工作区分组：展示真实 `cwd` 或「无工作区」、对话标题（否则 id）；≥8 项的组默认折叠。扫描**不列出** harness 预设夹 `_no-cwd/preset-*`（非用户对话）。空选点导入 = 不写盘。落点固定桌面 `userData/dsh-home`。导入页固定展示「将迁移/不迁移」说明（不迁移：工作区工程树、`profiles/`、`node_modules`、`storages/` 内部状态、旧 SQLite 会话库、OAuth 会话态、未被引用的凭据）。
4. 插件只按名单 `dsh plugin add` 重装，不拷 `node_modules` / `desktop-plugins`。支持两条受控通道：`github:owner/repo[#ref]` 与官方 registry semver（重装为 `name@<semver>`，含 `^`/`~`）。本地 `file:` / `link:` / `workspace:`、模板包、已下架包、其余规格（tarball URL、dist-tag、npm alias 等）在扫描时预标禁用行（`unsupported`），UI 灰置并给理由，勾不了也不会送进 `pnpm add`。已安装项标「已安装」。
5. MCP 按 id merge 进桌面 `mcp-servers.yaml`（含 header/token）；UI 与日志不展示密钥，列表标启用/停用。附件整树拷 `attachments/`。
6. 设置页签列出官方 `settings.yaml` 中存在的**白名单节**（`llm-deepseek` 模型与提供方、`llm-pi-ai` 自定义提供方、`agent-default-model` 默认模型、`vision-fallback` 视觉回退、`ui-theme` 主题）以及 home 级 `AGENTS.md`（全局指令）。整节**文本级**搬运进桌面 `settings.yaml`：目标已有同名节默认跳过，勾选覆盖才替换；不做字段级 merge。勾选含 `llm-deepseek` / `llm-pi-ai` 的节时，自动同步这些节**引用到**的 `.credentials.yaml` `refs` 凭据条目（`apiKeyEnv`，`llm-deepseek` 隐式默认 `DEEPSEEK_API_KEY`）；密钥只落盘（0600），UI / 日志 / journal 只出现引用名。
7. 预设页签列出官方 `.agent-presets/<id>/`（含 `agent.cordis.yml` 的目录，id 须匹配官方 `[a-z0-9][a-z0-9-]*`），按目录拷贝到桌面 `.agent-presets/`，冲突默认 skip，路径安全同 skills。
8. 导入时若桌面端在跑：先停内核。导入本身幂等（conflict 默认 skip）。导入异步执行、逐项间可取消（`shell:cancel-import`），启动器按阶段显示进度与可安全重跑提示。崩溃续跑：冷启动闸门消费 `phase:'copying'` 的 journal——清理桌面 home 下残留 `.import-tmp` staging 目录、journal 改写为 `recovered`、启动器停在导入页并提示可安全重跑。

## Invariants

- 桌面 home 中已有 `session.v3.jsonl` 或 `session.v3.jsonl.zstd` 时，首次导入闸门不得误判为空；官方来源的 v3 会话须进入导入扫描，旧 `session.jsonl(.zstd)` 仍受支持。
- 官方 `~/.dsh` 与 `~/.agents` **只读**：不写、不删、不清理。
- Harness / PTY / Electron `process.env.DSH_HOME` 仍不准指向官方 home。
- 不拷工作区工程树、项目 `.dsh/skills`（除非用户把该目录选进来源）、`profiles/`、`storages/` 内部状态、旧 SQLite 会话库。`settings.yaml` 只迁移上述白名单节（整节文本级，非白名单节永不写入）；凭据只同步被所选 llm 节引用的 `refs` 条目，`.credentials.yaml` 的 `records`（OAuth 会话态 / 刷新令牌）与未引用条目不迁移。
- 设置节与凭据条目为**文本级**搬运：不解析嵌套字段、不改写来源文本；跨节 YAML 锚点引用不受支持（已知限制）。凭据只接受 `refs` 下的单行标量条目；目标 `.credentials.yaml` 以 0600 写入。
- MCP / 设置 / 凭据在扫描与实际合并时均只把 `ENOENT` 当空，权限、I/O、路径错误必须失败关闭；凭据合并解析同一次目标读取的文本，避免二次读取不一致。写入共享单文件原子发布：同目录随机临时文件以 `wx` / 0600 独占创建，通过 fd 写入、fsync、关闭后 rename；发布前复查目标与暂存文件及父目录链，拒绝 symlink / junction / 文件硬链接与未知检查状态。异常清理仅删除本次创建且身份一致的暂存文件，不截断原文件、不删除预置临时链接或其他未归属文件。
- 上述原子性按**单个文件**生效，不是设置与凭据的跨文件事务：先前完成的文件仍保留。路径复查不能消除外部进程在检查和 rename / unlink 之间替换父路径的竞态；进程被强制终止可能留下私有暂存文件，无法验证归属或无法清理时保留并报错，不声称冷恢复会清理这些随机暂存文件。故障注入覆盖正常异常展开与恢复前后旧字节保全，不等同断电耐久性验收。
- 冷启动不扫描可选来源，不因 `destEmpty && sourceHasData` 跳转导入或阻断桌面；中断导入恢复与未决 journal 仍阻断。`probeImportHold` 保留为导入状态查询的浅探针，完整 `scanImport` 只在导入页使用。
- 不改会话文件夹名、不改写 jsonl。旧 rc `.db` 标不兼容并跳过。
- 导入会话保留原 `cwd`；已有桌面工作区不会触发首次启动的历史分组。导入后通过重新添加原目录恢复归属（新建或已登记目录均刷新索引，见 [no-directory-sessions](no-directory-sessions.md)）；不猜测迁移后的盘符或目录，不导入来源工作区内部 storage。
- 列表展示可读写会话 header / `session/title`（明文 jsonl 或 Node 内置 zstd）；勾选与拷贝键仍是 sessions 相对路径 `rel`，不得用标题改名落盘。
- `runImport` 必收勾选；省略选择 = 零写入。路径穿越与源根外技能路径拒绝落盘。
- 目录替换走 `import-transaction.js` 的 journaled 三段式（staging→dest→bak→commit→cleanup）；恢复只调和 journal 状态，不删无 journal 的 staging/backup（可能是唯一副本），未决事务阻塞后续导入（journal `blocked`）。附件按 dest∪source 合并 staging 后发布：dest-only 文件恒保留，`overwrite` 只影响同名冲突。
- 事务替换失败且无法安全回滚时 `error.needsRecovery` 跨阶段传播，`runImport` 立即中止剩余写入并落 `phase:'blocked'`（绝不写 `done`）；`recoverInterruptedImport` 处理 `copying`/`blocked` journal，pending 未清时持续 `recovered:false` 阻断启动（含直接启动路径与恢复异常 fail-closed）；恢复前校验 `txnPathsOwned`（opId↔文件名、dest/tmp/bak 绑定同父目录且在 sweep root），不信任的 journal 保留不跟随。
- 同一 `destName` 被多个来源根同时选中（如 `home:x` + `agents:x`）拒绝为 `ambiguous-destination`，`overwrite` 不消解歧义；附件或任一类目失败使 `runImport().ok=false`。
- 非空导入在 task-protection 协调的非终态 commit 内完成「停内核→拷贝」；空选择不写盘也不停内核。导入期间 `startDesktop`/`startSkipped`/`retryFullPlugins` 返回 `import-in-progress`。slim 包无跨进程静止能力：扫描只读可用，非空导入返回 `slim-import-unsupported`。slim 恢复完整插件会先停外部桌面端、严格读桌面 `config.json`、只清 `pluginRecovery`（保留 `disabledPlugins` 等）、原子落盘并验证后再启动。
- `shell:run-import` 只允许一个 active 任务，取消只作用于当前任务；完成或异常后释放任务锁。空选择也不创建 `userData/import-journal.json`。
- 插件重装规格只允许 `github:owner/repo[#ref]` 或 `name@<semver>`（`installImportPlugin` 受控通道，仅主进程 LAUNCHER IPC 使用）；渲染进程 / 工具的 `installPlugin` 通道保持 github-only。
- journal 在 `userData/import-journal.json`，不在 `dsh-home/sessions` 里。`recoverInterruptedImport` 只清 journal 自己的 destHome 且必须等于当前桌面 home；官方来源仍只读。
- 已知权衡（MCP 凭据）：MCP merge 原样拷贝 header/token 进桌面 `mcp-servers.yaml`（明文，与官方 CLI 相同的落盘形态）；OAuth 类服务器的会话态/刷新令牌不迁移，导入后可能需在桌面端重新授权。桌面不回写官方文件。
- 已知限制（storages）：官方 `storages/`（storage-json / storage-sqlite 后端的插件内部状态）**不迁移**——格式归 harness 内部所有、可能跨版本变更，且与会话数据不同没有稳定的冲突键；导入后相关插件从空状态重建。

## Allowed touch

- `src/main/data-import.js` 与其单测
- `src/main/import-transaction.js` 与其单测
- 启动器导入页 UI（`src/renderer/launcher.*`）
- `src/main/ipc.js`、`src/preload/index.js` 与其单测
- `src/launcher/launcher-service.js` 导入/启停入口、`src/launcher/runtime-install.js` 安装等待
- `docs/features/dsh-home.md` / `desktop-launcher.md` 只读扫描例外
- `.cursor/rules/data-import-product.mdc`

## Do not touch

- vendor 会话格式
- 自动静默迁移（无用户确认不得拷）
- 把桌面 `DSH_HOME` 指回 `~/.dsh`

## Gates

| Kind | What |
| --- | --- |
| Automated | `data-import`、`data-import-integrity` 真实文件系统故障注入与 IPC 勾选转发单测 |
| Manual / QA | `TC-LAUNCH-004` |

## Sources

- Decision: [可选导入不抢占冷启动](../decisions/implemented/bug-fix/2026-09-29-optional-import-startup.md)

- Decision: [启动器审计收尾修复](../decisions/implemented/bug-fix/2026-09-28-launcher-audit-closeout-fixes.md)
- Decision: [启动器更新确认与导入任务归属](../decisions/implemented/bug-fix/2026-09-24-launcher-update-import-ownership.md)
- Decision: [v3 会话日志参与桌面导入闸门](../decisions/implemented/bug-fix/2026-09-23-v3-session-import-gate.md)

- Implementation：`src/main/data-import.js`、`src/renderer/launcher.js`
