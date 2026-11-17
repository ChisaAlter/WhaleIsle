# harness-upstream-sync · 历史记录

自功能卡 [docs/features/harness-upstream-sync.md](../features/harness-upstream-sync.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (release catalog)** | 2026-09-29 — 会话统计 dock 的 `statsLine` 注入同步到官方生成的 slot catalog；`gen-client-catalog --check` 与 `gen-third-party-notices --check` 通过。仅生成产物补齐，见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified (window gate)** | 2026-09-29 — 新增 Windows HWND 样式/真实 IPC 回归与可见动画验收要求；本次未变更上游 pin。 |
| **last verified** | 2026-11-08 — 将 `dsh-v0.2.2-rc.1`（`66491b0`，上游 11/4，仅预发布）从 rc.4 pin 三方合并至桌面树，329 处冲突按下方合并裁定解决；lockfile、client slot catalog、persistence 目录、prompt 与 snapshot 重新生成，pin 在合并树应用后才更新。官方构建 `build:official` 通过；客户端与宿主 vitest 911 个文件 14931 项通过、3 项失败（`present-open.host` 需要 Windows 符号链接权限、`document-preview-license-bundle` 需要 pnpm 的 `npm_execpath`、`menu-surfaces` 在负载下超时，单独运行通过）；Project 宿主组合 39/39、桌面插件兼容（含真实 Loader 启动 SSH / ChatGPT 插件）2/2、差异标记 15/15、`test:whale-ui` 176/176、task-control 27/27；`check-skip-compose-contract.js`、`check-built-shell.mjs`、`docs:check` 通过；源码应用 `smoke:source`（真实窗口、标题栏命中、PTY）通过。合并中发现并修复：rc.1 的 WebServer 兜底座位可以是 `{ resource }`，dsh-task-control 原先只包装函数形态，会让每个静态请求返回 400、桌面启动超时。首次 CI 的 Core behavior tests 失败 32 项（桌面独有测试没跟上 rc.1：`AgentRegistry` 需要先有 `sessionProjections`、循环需要工具执行器插件、分叉不再记录 `parentSession`、账单用量投影与目录行字段；装配器对失败流不再因缺少调用 id 抛错，改为丢弃该调用），已修；第二次 CI 又卡死在 Project 宿主组合用例：rc.1 在应用销毁时先关闭 initiator 作用域，团队成员唤醒 Lead 会让 `ReactLoopAgent.wakeDriver` 的 `withInitiator` 同步抛错，已占用的驱动预约永不释放，`fiber.dispose()` 永远等不到空闲（rc.1 上游原有缺陷，rc.4 上同一用例 6/6 通过，rc.1 上约一半挂起），桌面树里让 `wakeDriver` 释放预约并回到空闲，补回归用例 `wake-closing.spec.ts`（旧代码上失败），建议向上游反馈。CI 命令的完整 Core 测试集本机全过。**本机未验证**：依赖 bash 工具的 e2e（caption-drag 后台任务、approval-resize，仅 Linux CI 可跑）、需要符号链接权限的 14 项桌面测试及 present-open、package-reload、deliverables 的相关用例、`ci-isolation` 的 pnpm 版本；`verify-package-dependencies` 在 `ui-codex-sidebar` 上失败，合并前就存在。未发布，pin 变化只在草稿 PR 中。更早记录见本文件 Git 历史。 |
