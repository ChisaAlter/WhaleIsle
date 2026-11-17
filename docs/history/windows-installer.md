# windows-installer · 历史记录

自功能卡 [docs/features/windows-installer.md](../features/windows-installer.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (release process)** | 2026-10-02 — 原始包身份、验收校验和单次 smoke 工作流接线定向验证通过，详见 [发布流程验证记录](../features/release-process.md)。本机 3 项符号链接测试受 EPERM 限制；未生成或安装新候选。 |
| **last verified** | 2026-09-20 — 晋级前资产核对收敛到共享只读校验器 `scripts/check-release-assets.mjs`（32 项单测含四条变异检验全绿；`ci-isolation.test.js` 静态钉住 publish.yml 顺序 / 稀疏检出 / `npm ci --ignore-scripts` / 无 `npx` / 缺 helper 时显式失败），`release.yml` 与 `publish.yml` 的 action 引用钉到不可变 SHA。本轮**未**调度 `publish.yml`（需真实候选 run 与 tag），也**未**做安装器实机走查。旧记录：2026-09-18 — 应用、窗口/任务栏、托盘、安装器共用用户提供的头像 `assets/whale-head.png`，包在白色圆角方形底板内（22% 圆角、四边 4% 内缩）；`npm run icon` 生成 PNG/多尺寸 ICO，`installer:assets` 生成品牌 BMP。宠物生成器不再改写应用图标；32 项定向测试与治理/文档门禁通过，源图 hash 一致，桌面/开始菜单快捷方式图标已更新。旧记录：2026-09-12 — 新增 `customInit` 注册表净化（死 InstallLocation/UninstallString 记录删除 + `$INSTDIR` 按 `/D`>活记录>卸载器目录>默认 重算 + 绝对性兜底），修复损坏/陈旧安装记录劫持升级目标的问题（事故：mangled 记录把 0.3.0 装进 `tmp\inst-verify`）。真实 Setup 七场景 29 项实机验证全过（fresh `/D`、drive-relative 记录、wiped-tmp 记录、原地升级、UninstallString 兜底、mangled `/D`、带空格 `/D`、静默卸载自清）；makensis 编译通过。旧记录：2026-09-06 — Windows `v2.9` 已按维护者明确授权公开为 Latest。固定源码 `583b6fa92d93df2ee56363e96e2891b356af75b9` 的 Desktop tests `34015974835` attempt 2 与 Windows build/packaged smoke `34015983516` 均成功；Setup SHA256 `1eb5bd7c3769e1d09a6e863f8948706359f255a91608f0989e7982d19c380117`，版本资源 `0.2.9`，未做 Authenticode 签名。三个发布资产与本机已校验 CI 文件逐项匹配；自动触发的重复构建 `34018917540` 已取消。新包完整实机 P0 未完成，不继承 [旧 e11fb52 安装验证](../qa/results/2026-09-06/candidate-e11fb52/WINDOWS-CANDIDATE.md)。授权与发布证明见 [发布记录](../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。 |
