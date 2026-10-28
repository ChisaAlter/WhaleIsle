<p align="center">
  <img src="assets/icon.png" width="80" alt="鲸屿 Whale Isle" />
</p>

<h1 align="center">鲸屿 Whale Isle</h1>

<p align="center">
  基于 DeepSeek Harness 的开源社区客户端<br />
  AI 对话、文件预览、终端与 Git，一个窗口完成。
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a> ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/tag/v0.3.11">更新说明</a> ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/issues">反馈</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/WhaleIsle" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/WhaleIsle" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-ARM64-333333" alt="macOS ARM64" />
  <img src="https://img.shields.io/badge/Android-8.0%2B-3DDC84" alt="Android 8.0+" />
</p>

<p align="center">
  <img src="docs/images/v0.3.10/screenshot-desktop.jpg" alt="Whale Isle 0.3.10 macOS 主界面" width="920" />
</p>

社区独立维护，非 DeepSeek 官方产品。基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

## 下载 v0.3.11

| 平台 | GitHub | 国内镜像 |
| --- | --- | --- |
| Windows 10+ · x64 | [安装包](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.11/Whale-Isle-Setup-0.3.11.exe) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v0.3.11/Whale-Isle-Setup-0.3.11.exe) |
| macOS 14+ · Apple Silicon（0.3.10） | [ARM64 DMG](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.10/Whale-Isle-0.3.10-mac-arm64.dmg) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v0.3.10/Whale-Isle-0.3.10-mac-arm64.dmg) |
| Android 8.0+（0.3.10） | [APK](https://github.com/ChisaAlter/WhaleIsle/releases/download/android-v0.3.10/Whale-Isle-0.3.10-android.apk) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/android-v0.3.10/Whale-Isle-0.3.10-android.apk) |

Windows 包未签名；Mac 包未签名、未公证，不含 Windows 专用 Office 运行时，0.3.11 暂未提供 Mac 包；Android 为正式签名 APK，独立发布。各发布页提供 SHA512 校验清单。

1. 安装桌面端，在「设置 → 模型」配置 API 服务。
2. 选择工作目录，或新建无工作区会话，开始对话。
3. 手机使用 Android 客户端，扫描桌面「远程」二维码连接。

模型费用由服务商收取，本项目不提供额度。Android 验证范围见[发布说明](https://github.com/ChisaAlter/WhaleIsle/releases/tag/android-v0.3.10)。

## 功能

- **对话与协作**：工具调用、审批、Agent 团队；Project 可在设置中开启。
- **文件与开发**：文件编辑、网页与 Diff 预览、终端、Git。
- **实时面板**：内置悬浮面板，可用命令、HTTP 或 AI 持续刷新；支持交互式 Whale UI。
- **模型与扩展**：API 服务、MCP、技能、插件市场；Windows 可按需安装鲸桥。
- **外观与用量**：Codex / Claude 皮肤、壁纸、Live2D 鲸鱼娘、Token 与费用统计。

<table>
  <tr><th>0.3.10 启动器 · macOS</th><th>Android 连接页</th></tr>
  <tr>
    <td align="center"><img src="docs/images/v0.3.10/screenshot-launcher.jpg" alt="Whale Isle 0.3.10 macOS 启动器" width="650" /></td>
    <td align="center"><img src="docs/images/v0.3.10/screenshot-android.png" alt="Whale Isle 0.3.10 Android 连接页" width="240" /></td>
  </tr>
</table>

鲸桥与 ChatGPT 插件独立安装、更新，不随桌面包捆绑。详见[组件文档](docs/features/launcher-components.md)。

## 从源码运行

需要 Git 和 Node.js 22.19+（22.x）或 24+，CI 版本见 [.nvmrc](.nvmrc)。

```shell
git clone https://github.com/ChisaAlter/WhaleIsle.git
cd WhaleIsle
npm ci
npm run setup:harness
npm start
```

首次 setup 会构建 Harness。源码版与安装版共用单实例锁，运行前先退出安装版及托盘。

## 数据与文档

桌面数据保存在 Windows `%APPDATA%\Deepseek-Harness-Desktop` 或 macOS `~/Library/Application Support/Deepseek-Harness-Desktop`。覆盖安装保留数据；官方 CLI 数据可用启动器「导入」，插件故障可用「插件排查」。

[产品手册](docs/handbook/README.md) · [开发文档](docs/maintenance/README.md) · [贡献指南](CONTRIBUTING.md) · [反馈问题](https://github.com/ChisaAlter/WhaleIsle/issues/new/choose)

<p align="center">
  <img src="assets/wechat-group.png" alt="微信交流群二维码" width="180" />
</p>

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[yetone / Magpie](https://github.com/yetone/magpie) 与 [Linux.do](https://linux.do) 社区。· [MIT](LICENSE)
