# Feature: Plugin Marketplace

桌面商店恢复「设置 → 市场」入口，托盘 / 菜单「插件市场」跳转到该分区；原有发现、已安装、收藏、操作记录和安装 / 更新 / 卸载 UI 恢复使用。官方「插件 → 发现」同时保留，桌面仍默认启用官方市场和 realguan 社区索引，既有源、后续源编辑及停用选择不变。当前路径与配置规则见[市场安装流程](../handbook/flows/marketplace-install.md)和[插件市场模块](../handbook/modules/marketplace.md)。下文的桌面商店功能与不变量适用于设置市场；官方发现页使用自身的 UI 和安装流程。

| Field | Value |
| --- | --- |
| **id** | `marketplace-settings` |
| **status** | `active` |
| **last verified** | 2026-09-30 — Windows 普通用户的安装快照保留目录 junction，不再经 `fs.cp` 转成需额外权限的目录 symlink；pnpm 实体文件和包链接失败恢复、成功清理时外部目录保护、快照目标被未知普通目录占据时拒绝覆盖均通过。`marketplace-install.test.js` + `plugins.test.js` 共 85 项通过，无跳过；未运行真实联网 pnpm 或活跃 profile。2026-09-28 — A6：catalog / 会话内 / launcher 导入安装在 CLI 或验证失败后离线恢复安装前元数据和物理依赖，不再 remove 旧安装；快照失败不进 CLI，恢复失败保留备份。原审计覆盖安装探针复跑后 manifest / 包 manifest / 入口 SHA-256 一致。2026-09-14 — 全部安装/更新通道新增 manifest 身份校验（非空 `name` + `version`），堵 versionless 包打爆请求 inventory 的残余路径。2026-09-08 — 迁移 dshmarket 1.45.0 的收藏、排序 / 时间过滤、截图 / README / manifest 声明详情、安装卸载确认、批量更新和持久脱敏操作记录，保留桌面 IPC / profile / HarnessController / DSHD 视觉。来源一致性与模糊 lock commit 判定 fail closed，回滚失败停止批次。桌面 / IPC / preload 141 项、市场 52 项、完整 GUI 5483 项（1 跳过）、市场与滚动条聚焦 73 项、client typecheck、官方 Web 构建及 Electron 源码 smoke 通过。全仓 Web 回放在聊天滚动、设置、PTC 等场景出现失败和长时间超时后主动中止，未通过，未与基线对照确认归因；国际化全仓剩余 25 条其他模块违规，市场无违规。 |

## User paths

1. 设置 → 市场（`market`，由桌面自有包 `ui-settings-market` 注册）：「发现」页浏览目录、搜索、分类过滤、刷新；卡片带作者头像、星标、分类标签、主页链接与已弃用徽标。
2. 按 catalog id 安装 → 见进度行 → 成功则卡片标「已安装」；失败有 `role="alert"` 反馈。
3. `needsAllowBuilds` 时出现内联确认（列出 allowBuilds key），允许后自动重试。
4. 「已安装」页签（标签带数量）按目录分类分组列出 profile 插件行（目录外归「未分组」），逐行卸载后列表更新且应用仍可用；空态指回「发现」页。
5. 已安装且仍在目录中的插件自动检查更新：npm 显示已装版本 → `latest`，GitHub 显示锁定 commit → HEAD；可逐项更新。更新成功后 Harness 自动重启，失败保留原版本并显示回滚结果。
6. 托盘 / 菜单「插件市场」进入设置市场分区，不出现独立 BrowserWindow。
7. 发现页支持星标 / 收录时间排序、7 / 30 天时间过滤；收藏通过桌面 userData 持久化，收藏页复用目录筛选。
8. 详情弹窗显示来源、目录截图、按需获取的仓库 README 和 npm 作者依赖声明；声明不构成兼容性保证。
9. 安装 / 卸载须确认来源和重启影响；已安装页可筛选可更新 / 检查失败，批量更新前列出目录 id 并确认。
10. 操作记录显示最近 30 项操作及脱敏日志，离开市场和 Harness 重启不丢失；桌面进程中断的操作标为已中断。
11. 官方「插件 → 发现」继续提供独立的索引浏览与安装流程；源配置层优先级、已有自定义源和显式空列表保持不变。停用官方自定义插件市场会隐藏其发现页签、保留源配置，普通重启不重新启用；不影响桌面「设置 → 市场」。

## Invariants

- **桌面设置商店是桌面自有代码**：UI 是 `vendor/deepseek-harness/packages/client/ui-settings-market`
  （桌面 fork 包，登记于 `harness-desktop-forks.js`），引擎是主进程
  `marketplace-catalog.js` / `marketplace-install.js`。不再预置安装第三方 `dshmarket`
  插件；`vendor/dshmarket` 只剩 attribution stub（LICENSE + `DESKTOP-FORK.md` +
  marker `package.json`，源码快照已删），不打包、不自动装。
- `dshmarket` 在 `DROPPED` 名单：Loader 不挂载它（含用户旧装副本），保证只有一个
  `market` 分区；磁盘文件不删除。启动时 `removeDshMarketPreset` 只清理桌面预置残留
  （受管 patch 块、`desktop-plugins/dshmarket` 副本、预置 symlink）。
- 桌面启动时启用 `ui-settings-market` 的受管 overlay，恢复设置内 `market` section 及其原有 UI；托盘 / 菜单「插件市场」跳转该分区，**无**独立 Electron 市场窗。
- 官方「插件 → 发现」与桌面设置商店并存；其 bundle 启用迁移、索引配置层优先级和用户停用行为不因恢复设置商店而改变。
- 安装走桌面 IPC / catalog id（`shell:install-marketplace-plugin`），不往 Composer 塞安装草稿。
- 未安装卡片只在可安装时提供「安装」按钮：`deprecated` 或空 `installSpec` 的行不出安装入口；
  主进程 `installMarketplacePlugin` 在进 CLI 之前同样拒绝已弃用行与无法解析的规格
  （已装行不受影响，仍显示「已安装」标记 + 卸载）。
- 已安装 ↔ 目录行的规格匹配走 `spec-match.ts` 的 owner/repo 整段边界匹配
  （`packageName` 精确匹配优先），不做子串 `includes`。
- 所有安装通道（catalog id / in-chat `install_dsh_plugin` / launcher 导入 / 更新）在
  `add` 成功后统一校验新装包有可加载入口且 manifest 携带非空 `name` + `version`
  ——缺 `version` 的包会在请求期打爆 plugin inventory（`REQUEST_EXTENSION`），
  校验不过即回滚；覆盖安装不能通过 `remove` 删除原有包。即使此次安装新增其他依赖，
  也必须校验被覆盖的目标包，不能以新依赖可加载代替目标验证。
- catalog / 会话内 / launcher 导入安装在写入 allowBuilds 和执行 `add` **之前**保存
  `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 与完整 `node_modules`
  （含 `.pnpm` 实体文件、传递依赖及原链接）的本地快照；快照失败不执行安装。
  `add` 返回失败或抛异常、成功后入口 / manifest / catalog loader 冲突验证失败，均恢复旧规格、
  锁定及物理安装，同时撤回新增文件；回滚不调用联网安装或 `remove`。
  仅安装提交成功或全部恢复成功后清理快照；恢复失败返回 `rolledBack: false` / `rollbackError`、
  保留备份路径并禁用构建授权重试提示，不能清掉唯一旧安装备份。
  快照不跟随 `node_modules` 内指向外部目录的链接；外部源码、安装脚本任意副作用及进程崩溃自动恢复不在本事务保证内。
  Windows 上可解析的目录链接使用共享目录链接工具创建 junction，无需开发者模式或管理员 symlink 权限；
  快照目标若已被未知普通目录占据则拒绝覆盖，不将链接目标复制或清理为实体目录。
- 更新检查只覆盖已安装且仍在精选目录中的行。npm 仅当 registry `latest` 的 semver
  严格高于已装版本时标记更新，无法判定或较低版本不提供更新；GitHub 用 profile
  `pnpm-lock.yaml` 的锁定 commit（或 manifest 中的 commit pin）与远端 HEAD 比较；
  任一远端版本查询失败必须显示检查失败，不得误报为全部最新。
- 更新入口只上传 catalog id，主进程重新校验目录、退役状态、已装身份和目标版本 / commit。
  更新前快照 profile `package.json`、`pnpm-lock.yaml` 与 `pnpm-workspace.yaml`；CLI 失败、无实际版本变化、插件入口
  不可加载或 loader id 冲突时恢复快照并执行 profile install，失败反馈必须说明回滚是否成功。
- npm 更新须验证已安装依赖确实来自 registry，不得用同名 npm 包替换 Git / URL / 本地依赖。
- 批量更新最多 100 个目录 id，全程持有共用安装锁；逐项失败可继续，但回滚失败立即停止。
  有成功写入且无回滚失败时只重启一次；授权项不自动放行，回滚失败不能被授权确认 UI 遮蔽。
- 收藏 / 操作记录归主进程 `marketplace-state.js`；日志持久化前脱敏且逐条封顶 16,000 字符。
  详情只接受目录 id，固定公共 GitHub / npm 端点，不转发用户 token；每响应 256 KiB、最多 4 个详情并发。
- 退役判定按**家族**而非精确名：`isDroppedPluginName`（`plugins.js`）对 `DROPPED`
  精确名之外再按去 scope 的 basename 整段匹配（`DROPPED_BASENAMES`），目录隐藏与
  两条安装入口（catalog id / 直接 spec）一致执行；换 scope、换 GitHub owner 或
  `#path:` 尾段命中家族名的再发布一律拒绝，相似但不同段的名字不受影响。
- 目录拉取有硬上限：`fetchRegistry` 流式读取且封顶 `MAX_REGISTRY_BYTES`（8 MiB），
  超限按拉取失败处理（缓存 / 快照回退），不允许远端响应无界占用内存。
- 随包离线快照（`marketplace-registry-snapshot.json`）是断网首启兜底的精选子集，
  **不携带退役家族行**（快照刷新时由回归测试把关）。
- 「发现」页分页渲染：每页 `DISCOVER_PAGE_SIZE`（60）张卡 + 「加载更多」按钮，
  搜索 / 分类变化重置回第一页；计数行始终报全量过滤总数。
- 安装落点是桌面 `dsh-home/profiles/web`，不是官方 `~/.dsh`（见 [dsh-home](dsh-home.md)）。
- 重启归 HarnessController（`restartAfterProfileWrite` → `startHarness`），无游离 dshmarket 重启路径。
- Harness 未就绪时不以空市场窗硬装。
- 失败可见（`role="alert"` / 进度行），不静默；「已写入 profile 但 Harness 未起」也要提示。
  目录刷新失败时保留已展示的目录并给出可重试的 `role="alert"` 行（只有首次加载才落纯错误态）；
  刷新进行中按钮禁用并改标「刷新中…」。

## 安装通道治理（`install_dsh_plugin` 会话内工具）

会话内模型可见的安装工具由桌面自有 Host 插件 `dshd-desktop-plugin-install`
（`src/host/install-dsh-plugin.mjs`）注册；`@deepseek-ai/dsh-tools` 从运行中的
Harness 解析，解析失败只跳过注册、不拖垮 Host。

- **注册条件**：仅当主进程 `desktop-install-control.js` 把回环控制端点注入环境
  （`DSH_DESKTOP_INSTALL_URL` / `DSH_DESKTOP_INSTALL_TOKEN`）时注册。端点只听
  `127.0.0.1` 随机端口，鉴权是每次启动新生成的 64-hex Bearer token，body 上限 64 KiB。
- **通道范围 github-only**：工具客户端与端点两侧共用同一份 `isValidGithubSpec`
  （`src/host/install-dsh-plugin-client.js`）校验 `github:owner/repo[#ref]`
  （owner/repo/ref 全模式校验；`..`、`@{`、尾 `.` / `/` 拒绝）。npm 名、tarball、
  本地路径、git URL、`#path:` monorepo 规格一律进不了该通道——`#path:` 只能走
  curated 目录 `installMarketplacePlugin(id)`（`shell:install-marketplace-plugin`）。
- **allowBuilds 白名单**：`normalizeAllowBuilds` 上限 32 条，仅接受合法包名 /
  `github.com/owner/repo` / `name@git+https://github.com/owner/repo.git` 三种 key；
  非法整体拒绝，不进 CLI。`needsAllowBuilds` 握手：pnpm 拦下 prepare scripts 时
  工具返回 key 列表，模型必须先问用户、再带获批 allowBuilds 重试。
- **信任边界在主进程**：端点内 `installPlugin` 独立复验（github-only +
  `isDroppedInstallSpec` 退役家族拒绝 + 与市场安装共享 `withPluginLock` 互斥）；
  Host 工具侧校验只是提前失败，不是安全边界。
- 安装成功（且无 needsAllowBuilds）后由 `startHarness` 延迟重启：HTTP 响应先
  flush、工具结果先落会话日志，再触发重启。

Gate：`src/host/install-dsh-plugin-client.test.js`、`src/main/desktop-install-control.test.js`、
`marketplace-install.test.js` 的 `installPlugin` 拒绝面。

## Deferred（明确不移植 — 产品裁剪）

以下裁剪仅适用于桌面设置商店；官方「插件 → 发现」的索引源管理保持不变。

主题商店、备份 / Gist、诊断面板、无需重启的插件热替换、多 registry 源管理、试用通道：
**won't port**，不是待办。桌面自有市场提供精选目录浏览 / 搜索 / 安装 / 版本更新 / 卸载；
版本更新完成后统一重启 Harness，不恢复旧 `dshmarket` 的 HMR / 热禁用运行时。
`vendor/dshmarket` 的源码快照已删除（只剩 attribution stub）；若未来某项能力重新立项，
从上游仓库取参考、按 `ui-settings-market` 第一切片的模式新写 desktop fork 包 + 桌面 IPC，
先开新 feature card，不回退到预置插件。

## Allowed touch

- `src/main/dsh-market-desktop.js`（桌面内置市场 overlay 与源码/打包 runtime 包解析）及对应测试
- `src/main/marketplace-*.js`、`dshmarket-preset.js`（清理模块）、`desktop-install-control.js`、`plugins.js`（DROPPED 行）
- `src/main/ipc.js`、`src/preload/index.js`（市场更新 IPC / preload 暴露）
- `scripts/after-pack.js` 的 `assertDesktopForkRuntime` 打包门禁（只加断言，不动装配逻辑）
- `src/host/install-dsh-plugin-client.js`
- `vendor/deepseek-harness/packages/client/ui-settings-market/`（桌面自有市场 UI）
- `src/shared/harness-desktop-forks.js`（登记行）与 web-app bundle 的注册三件套
- `vendor/dshmarket/`（attribution stub：LICENSE + DESKTOP-FORK.md + marker package.json；不得恢复源码快照或自动安装）
- 相关桌面测试与本卡 / handbook 市场章

## Do not touch

- 恢复独立市场 BrowserWindow
- 恢复 `ensureDshMarketPlugin` 预置安装或 extraResources 打包 dshmarket
- 无关邻域：壁纸、Surfaces、Models（除非用户扩大 Touching）

## Gates

| Kind | What |
| --- | --- |
| Automated | `src/main/marketplace-*.test.js`、`dshmarket-preset.test.js`（清理语义）、`harness-desktop-forks.test.js`（vendor 注册三件套）；vendor `ui-settings-market` client specs；`npm run qa:source` 市场分区存在性 |
| Manual / QA | `TC-EXT-001` … `TC-EXT-005`；`TC-DESK-002`（托盘进市场） |

## Sources

- Decision: [2026-09-28-launcher-audit-closeout-fixes](../decisions/implemented/bug-fix/2026-09-28-launcher-audit-closeout-fixes.md)
- Decision: [2026-09-30-project-audit-fixes](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Handbook：[../handbook/modules/marketplace.md](../handbook/modules/marketplace.md)、[../handbook/flows/marketplace-install.md](../handbook/flows/marketplace-install.md)
- Spec：[../superpowers/specs/2026-08-25-marketplace-desktop-integration.md](../superpowers/specs/2026-08-25-marketplace-desktop-integration.md)、[../superpowers/specs/2026-08-18-marketplace-parity-design.md](../superpowers/specs/2026-08-18-marketplace-parity-design.md)
- Agent note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-desktop-owned-market-section.md`
