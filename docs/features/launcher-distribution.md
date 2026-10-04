# Feature: Launcher distribution（轻量分发、双线路与独立增量包）

| Field | Value |
| --- | --- |
| **id** | `launcher-distribution` |
| **status** | `proposed` |
| **last verified** | 2026-09-24 — 计划与拟议契约已立；功能尚未交付，未运行产品测试。 |

## User paths

1. 用户安装轻量 Launcher，首次使用选择 GitHub（国外）或 CNB（国内）线路，由 Launcher 下载并校验完整 DSHD Setup 后完成安装；已有安装直接识别采用。
2. 用户在版本页检查更新；若已验证的旧 Setup 缓存与独立增量包匹配，则重建并校验目标 Setup 后更新，否则下载同目标版本完整包。
3. 用户可切换线路、取消或重试下载；离线、断流或镜像滞后时保留当前可运行的 DSHD。

## Invariants

- 新发行包使用 Whale Isle 名称；桌面安装检测和更新下载仍兼容旧版 Deepseek-Harness-Desktop 的安装记录及资产。

- 只重构现有 `src/renderer/launcher.*`；五个分区与 Recovery Board 保留，所有入口共用同一份启动器 UI，禁止以隐藏旧窗或空壳冒充完成。
- 启动器对桌面端的现有控制不降级：启停（启动/停止/跳过用户插件启动/完整重试）、版本（安装识别、正式版列表、指定版本安装切换、卸载入口）、插件（名单、归因、逐项/批量禁用、移除）、导入与设置，在拆分前后均可实际操作；未安装态按前置条件标注而非删除功能。
- Launcher 为独立轻量包：独立 appId、安装目录、卸载记录与单实例锁；包白名单剔除 Harness 归档与桌面插件。身份、锁、配置与卸载迁移经验证后落地。
- 两条线路传输同一候选构建的原始字节；签名清单是唯一版本权威。CNB 被选中时检查与下载不依赖 GitHub API。
- 独立增量包以固定版本及 Setup SHA-256 为基线，只重建目标完整 Setup，不直接写已安装目录；整包校验成功前不得运行安装器。
- 缺基线、补丁不适用、损坏或无收益时下载同目标版本完整包；未完成文件不得作为可信缓存。
- CNB 线路在真实大文件、匿名下载、国内网络与哈希复核通过前不向用户展示。
- 已安装应用内的 electron-updater blockmap 差量通道保留，与独立增量包分层共存，互不冒充。

## Allowed touch

- `src/launcher/` — 发布清单与分发服务，不承载第二套 main/preload/renderer 产品入口
- `src/main/index.js`、`ipc.js`、`window.js`、`launcher-gate.js`、`update.js` 及提取出的启动器服务、`src/preload/index.js`、`src/renderer/launcher.*` — 现有启动器原地重构；现行行为遵循 `desktop-launcher` 卡
- `scripts/` 与 `.github/workflows/` — 双制品构建、校验、候选晋级与镜像
- `package.json` 与 Launcher 专用 electron-builder 配置 — 独立打包身份与资源白名单
- `docs/design-language.md` 与 Launcher UI — 先定视觉角色，再实现线路/安装页
- `docs/features/desktop-build-runtime.md`、`windows-installer.md`、`desktop-launcher.md` — 迁移时同步现行合同

## Do not touch

- DSHD 的 `dsh-home`、Harness 插件市场及完整离线 Setup 的现有安装语义
- 把私钥、CNB token 或未验证的镜像资产写进仓库/客户端

## Gates

| Kind | What |
| --- | --- |
| Automated | 清单签名/哈希/回放负路径；增量重建；包白名单与 appId；候选资产与两镜像一致性 |
| Manual / QA | GitHub/CNB 首装、既有安装采用、断流、切源、增量失败回退、安装后版本与卸载路径，均绑定同一 CI SHA |

## Sources

- Decision: [启动器独立分发架构](../decisions/proposed/architecture/2026-09-24-launcher-standalone-distribution.md)
- Plan: [启动器重构计划](../superpowers/plans/2026-09-24-launcher-refactor.md)
