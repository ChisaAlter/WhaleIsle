# Android 原生聊天阶段验收，2026-09-29

Feature: `mobile-remote`。浏览器 Web 继续使用 `mobile/web` SPA；本轮 APK 在配对后由 Compose 绘制聊天，内置同源 WebView 只承担后台 E2EE/host RPC，显式「旧版工作页」仍可打开 Web UI。本记录是 debug APK 的部分真机验收，不是完整 T3 放行。

## 构建与资源

- `mobile/web/**/*.test.js`：315/315；Android `:protocol:test :app:testDebugUnitTest :app:assembleDebug --offline`：通过。
- [APK 资源审计](apk-audit.json)：49 项运行资源与源码逐字节一致，`missing`、`changed`、`unexpected` 均为 0。最终 debug APK SHA-256：`cf3f0363a1c9e3950a67b6fa7b7398e4e68c561fa8c7b09fcef81a5f33db81ef`。
- 设备 `23124RN87C`，ADB 序列号 `9TUCYX8TBI6DLRMZ`。首次 `adb install -r` 被 HyperOS 取消（`INSTALL_FAILED_USER_RESTRICTED`）；手机端放行后两次 `adb install -r` 均成功，未卸载、未清数据。最终包冷启动后保留原有 sticky 配对。

## 真机观察

| 场景 | 结果 | 证据/边界 |
| --- | --- | --- |
| 保存设备冷启动重连与 Compose 主界面 | Pass | [最终原生空会话](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/final-native-chat.png)。前一候选在桌面 `sessionController` 未就绪时显示可重试错误（[初始状态](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/cold-launch.png)）；只重启本仓库 Electron 后恢复。 |
| 会话目录与打开历史 | Pass | [原生目录](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/native-sessions.png)显示既有「你好」会话；[历史时间线](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/native-history.png)显示真实 assistant 文本与模型标签。富文本仍按纯文本投影，Markdown 符号可见。 |
| 软键盘与返回 | Pass | [输入卡与 IME](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/native-ime.png)：输入不遮挡工具行，`dumpsys input_method` 为 `mInputShown=true`；一次系统返回后为 `false`，草稿仍在原会话。 |
| 旧版工作页与草稿 | Pass | [显式 Web 入口](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/legacy-page.png)可用；[返回原生](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/return-draft.png)后 `QA_draft_123` 仍在 Compose 输入卡。结束时已删除该测试草稿，未发送。 |
| 后台 WebView 触控/无障碍隔离 | Pass（当前设备） | 原生页的 `uiautomator` 树中 WebView 节点数为 0，只有 Compose 菜单/输入；旧版页显式打开时 WebView 节点为 1。未进行真人 TalkBack 语音走查。 |
| 模型与权限选择层 | 部分 Pass | [模型列表](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-mobile-native-chat/model-picker.png)与权限列表能展示真实选项，返回不提交改变；未执行模型/权限切换的 host 写动作。 |
| 新消息发送/停止、流式增量、审批 | Not run | 为避免向用户既有会话写入测试消息或触发模型计费，本轮没有发起真实 prompt/审批。JS/JVM 单测及历史读取不能代替这些 T3 用例。 |
| 新配对扫码、正式签名升级、前后台长时重连 | Not run | 本轮验证的是保留 sticky 的 debug 覆盖安装与冷启动，不是生产签名兼容性或完整配对流程。 |

## 剩余边界

原生主路径已可见且可读，但本轮不是 Android 全功能替代：附件、完整工作区新会话/目录管理、搜索/归档/Git/文件等仍依赖标明的旧版工作页；原生时间线只投影最近约 200 行纯文本。后续须在独立 T3 场景验证发送/停止、流式、审批、跨会话草稿、长历史分页、WebView renderer 恢复及真人 TalkBack，不能继承旧版 T3 Deferred 或把本次部分 Pass 写成整轨 Pass。
