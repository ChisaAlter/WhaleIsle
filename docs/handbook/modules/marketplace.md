# 模块：插件市场

## 职责与非目标

**职责：** 桌面自有市场：设置 section `market`（`ui-settings-market` 桌面 fork 包）+ 主进程精选目录 / 安装引擎；目录浏览、搜索、按 catalog id 安装 / 更新 / 卸载。
**非目标：** 独立 Electron 市场窗；Composer 草稿安装旧路径；预置第三方 `dshmarket` 插件（已废止，见下）。

## 用户路径

见 [../flows/marketplace-install.md](../flows/marketplace-install.md)。Harness 未就绪时不应空开市场窗硬装。

## 架构要点

- UI：`vendor/deepseek-harness/packages/client/ui-settings-market`（桌面 fork 包，登记于
  `src/shared/harness-desktop-forks.js`），仅当 `window.shell` 暴露市场 API 时注册
  `settings.section` id `market`；纯 `dsh web` 浏览器无此分区。分区为「发现 / 已安装」
  双页签：发现页是搜索 + 分类 chips + 卡片网格（头像 / 星标 / 分类 / 主页 / 已弃用徽标），
  已安装页按目录分类分组 profile 插件行并逐行卸载（QA 走查 `market.discover` /
  `market.installed` 断言这套结构）。
- 更新：主进程只检查已安装且仍在目录中的插件。npm 比较已装 package version 与 registry
  `latest`（仅前向 semver），GitHub 比较 profile lockfile commit 与远端 HEAD；任一远端查询失败
  会传播为检查失败，不误报全部最新。更新按 catalog id
  执行，操作前快照 manifest / lockfile / workspace；失败、无实际变化、入口损坏或 loader id 冲突时回滚并
  重新安装旧状态。UI 在发现卡片和已安装行显示差异并支持逐项更新。
- 目录 / 安装：`marketplace-catalog.js`、`marketplace-install.js`、`marketplace-spec.js`、`marketplace-allowbuilds.js`。
  catalog / 会话内 / launcher 导入安装在执行 CLI 前保存元数据与完整 `node_modules` 本地快照；
  失败时通过隔离新目录、原地恢复快照保留旧物理安装，不依赖联网重装。
  Windows 快照中的可解析目录链接复用 `desktop-plugin-link.js` 创建 junction，普通用户无需额外
  symlink 权限；`.pnpm` 实体内容正常复制，外部 overlay 仅保留链接，不遍历其目标。
  链接目标位置若被未知普通目录占据即拒绝建立快照；失败前不执行 CLI，恢复失败保留备份。
  目录拉取流式封顶 8 MiB（`MAX_REGISTRY_BYTES`），超限走缓存 / 内置离线快照回退
  （`marketplace-registry-snapshot.json`：随包携带的极小精选子集，仅保证断网首启
  分区不空白，不是完整目录镜像；发版前用 `npm run refresh:marketplace-snapshot`
  从在线目录刷新精选子集，脚本会先按家族剔除退役行）。退役判定按家族 basename 匹配
  （`isDroppedPluginName`），换 scope / owner 的再发布不漏网；随包快照不携带退役行
  （回归测试把关）。
  发现页分页渲染（每页 60 张卡 + 加载更多），搜索 / 分类变化回第一页。
- 与上游分离：`dshmarket` 在 `DROPPED`（不挂载、目录隐藏、拒绝安装）；
  `dshmarket-preset.js` 只剩 `removeDshMarketPreset` 清理旧预置残留；
  `vendor/dshmarket` 只剩 attribution stub（LICENSE + `DESKTOP-FORK.md`），源码快照已删。
  上游主题商店 / 备份 / 诊断 / 无重启热替换等能力是明确不移植的产品裁剪（见 feature card Deferred）。
- Feature card：[../../features/marketplace-settings.md](../../features/marketplace-settings.md)

## 上游功能迁移（1.45.0）

桌面市场保留现有 IPC、profile、HarnessController 与 DSHD 设置视觉，仅迁移功能行为。
发现页增加收藏、排序和收录时间范围；详情使用 Modal + MarkdownText 显示目录截图、仓库 README、
npm manifest 的依赖声明。截图仅接受无凭据 HTTPS 地址；README 原始 HTML 不执行，相对链接由
MarkdownText 拒绝，完整文档保留项目主页入口。未验证宿主兼容性，不将作者声明显示成兼容徽标。

安装和卸载使用确认弹窗，明确本机代码执行与重启影响。操作记录由主进程写入
`userData/marketplace-state.json`，保留 30 条、每条日志 16,000 字符；常见 URL、Authorization、
npm/GitHub/API token 在落盘前脱敏，仍建议分享前复核用户自定义敏感内容。收藏上限 2,000 个 id。
操作页轮询主进程，离开设置不取消后台操作；应用崩溃后的运行中记录标记为中断，不自动恢复执行。

批量更新经 `shell:update-marketplace-plugins` 串行执行并共用安装锁，去重且最多 100 项。
成功项保留，普通失败项记录后继续；自动回滚失败则停止且不重启。只要有成功写入且无回滚失败，
主进程统一重启一次；部分失败仍返回失败结果。构建授权必须在单项操作中另行确认。
引擎区分网络、pnpm 目录不兼容、版本不可用等错误；不自动删除依赖目录或绕过发布时间保护。

未迁移：自动宿主兼容性判断 / 筛选、Release 预构建包安装、共享评论、跨插件公共更新 API、
任意操作排队 / 取消。它们与已有明确裁剪项分开记录，后续须具备独立数据和验证路径。

## 实现入口

- Main：上列 `src/main/marketplace-*.js`、`dshmarket-preset.js`、`desktop-install-control.js`
- Host：`src/host/install-dsh-plugin-client.js`
- Client：`vendor/deepseek-harness/packages/client/ui-settings-market/src/client/`

## 不变量

- 无独立市场窗口（`TC-EXT-002`）。
- 只有一个 `market` 分区：桌面自有 section 注册它，`DROPPED` 保证旧 dshmarket 不再挂载。
- 安装失败要可见失败反馈，不静默；`needsAllowBuilds` 走内联确认后重试。
- `dsh plugin --profile web` 打进 `userData/dsh-home/profiles/web`，不是官方 `~/.dsh`（[dsh-home.md](dsh-home.md)）。
- 重启归 HarnessController（`restartAfterProfileWrite`）。
- 桌面启动 Harness 和运行插件 CLI 时，经 `dsh-cli-runner.mjs` 向官方 `runCli` 传入内置 Node 与 pnpm 入口。两条安装路径均不依赖 `PATH` 中的 pnpm 或包含安装目录的批处理脚本，中文目录不受 Windows 控制台代码页影响。runner 通过 `asarUnpack` 提供给普通 Node 子进程。

## 官方自定义插件市场

官方的实验性「自定义插件市场」与桌面「设置 → 市场」独立：开启后在「插件 → 发现」显示。DSH 不提供官方市场或默认索引源；索引 URL 按当前 profile 保存，开启功能后仍须手工添加。官方机制及索引格式见 [DSH 用户指南](../../../vendor/deepseek-harness/docs/user/guide/plugin-market.zh.md)。

社区项目 [realguan/dsh-plugin-market](https://github.com/realguan/dsh-plugin-market) 提供 `format: 1` 索引，可在「插件 → 发现 → 添加索引源」填写下面任意一个地址；两者是同一份目录的不同分发地址，只需添加一个：

- `https://realguan.github.io/dsh-plugin-market/dsh-index.json`
- `https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json`

这些是第三方社区源。桌面市场使用的 `https://awesome-dsh-plugin.com/plugins.json` 是旧格式目录，不能填入官方的索引源输入框；官方新格式也不能直接用作桌面的 `DSHD_MARKETPLACE_REGISTRY_URL`。桌面不会自动添加或覆盖用户的官方市场源配置。

## 门槛

- QA：`TC-EXT-001` … `TC-EXT-005`

## 延伸阅读

- [../../superpowers/specs/2026-08-25-marketplace-desktop-integration.md](../../superpowers/specs/2026-08-25-marketplace-desktop-integration.md)
- [../../superpowers/specs/2026-08-18-marketplace-parity-design.md](../../superpowers/specs/2026-08-18-marketplace-parity-design.md)
