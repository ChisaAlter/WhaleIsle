# desktop-build-runtime · 历史记录

自功能卡 [docs/features/desktop-build-runtime.md](../features/desktop-build-runtime.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (release process)** | 2026-10-02 — 固定源码 SHA、CI 前置和原包晋级定向验证、文档门禁通过，详见 [发布流程验证记录](../features/release-process.md)。未重建正式发行包，未运行新的 GitHub Actions。 |
| **last verified (archive and stage identity)** | 2026-09-30 — 提取/装配/归档摘要定向 73/73、阶段凭据 15/15；同长度 tar 内容变更刷新、旧戳迁移、无变化启动不读大归档、摘要损坏保留旧树、helper/vendor 输入失效与平台 native 产物归属通过。未重建正式发行包。 |
| **last verified (CI candidate)** | 2026-09-29 — `47222716ae8` 的 Desktop tests 与 Windows 构建均成功；CI packaged smoke、原始 artifact 摘要与发布资产校验通过。完整安装版验收未执行，身份见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified (release preflight)** | 2026-09-29 — Node 24.21.0 桌面 2863 通过/2 跳过；治理 6/6、文档 7/7；主窗与启动器四角合成检查通过。新候选与正式验收状态见 [发布记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified (async links)** | 2026-09-29 — 启动链接操作改为异步 I/O；慢盘取消、路径边界、最终链接失败回滚与装配定向测试 148/148。数千链接响应性演练及全量结果见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)，不代表 WER 根因已确认或新包已发布。 |
| **last verified (extraction recovery)** | 2026-09-29 — 临时解压、空间预检、最终路径 junction 重建与中断替换恢复回归通过；本地旧归档真实提取/复用成功，未改装配内容或重建发行包，见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)。 |
| **last verified (window bridge)** | 2026-09-29 — Koffi 生产闭包/双方解包契约通过全量测试；slim 启动器打包成功，ASAR 内 Koffi + win32 模块解析及真实 HWND 样式桥通过。见 [QA](../qa/results/2026-09-29-corner-motion/README.md)；不代替完整桌面发布验收 |
| **last verified** | 2026-09-30 — 归档内容身份及阶段输入/产物归属修复；提取/装配/共享摘要 73/73、阶段凭据 15/15。未重建正式发行包。此前 2026-09-29 — Node 24.21.0 LTS 全量构建和本地 NSIS 成功，包内 Node 版本核实；桌面 2809 通过/2 跳过，打包 P0（界面、Git/PTY、Ghostty、旧运行时替换）通过。CI 同 SHA 正式验收仍未完成。此前 2026-09-28 — 一源一目录装配通过 747 包 / 3602 边验证；tar 搬迁、循环与严格身份回归通过。桌面 2765 通过/2 跳过；源码与安装树冒烟、NSIS 与资产校验通过。ws 与平台会话资源已随包。当前仅本地演练，CI 同 SHA 候选与正式生产验收未完成。 |
