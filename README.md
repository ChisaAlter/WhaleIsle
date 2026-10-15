<p align="center">
  <img src="assets/icon.png" width="80" alt="鲸屿 Whale Isle" />
</p>

<h1 align="center">鲸屿 Whale Isle</h1>

<p align="center">
  基于 DeepSeek Harness 的开源社区桌面客户端<br />
  AI 对话、文件预览、终端与 Git，一个窗口完成。
</p>

<p align="center">
  中文 · <a href="README.en.md">English</a> ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest">下载</a> ·
  <a href="https://cnb.cool/ayasealter/WhaleIsle/-/releases">国内镜像</a> ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/issues">反馈</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/WhaleIsle" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/WhaleIsle" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-ARM64-333333" alt="macOS ARM64" />
</p>

<p align="center">
  <img src="docs/images/v0.3.6/screenshot-macos.jpg" alt="Whale Isle 0.3.6 macOS 主界面" width="920" />
</p>

社区独立维护，非 DeepSeek 官方产品。基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，保留 AI 对话、工具调用、Agent 团队、MCP、技能与插件能力。

## 下载与开始使用

| 平台 | v0.3.8 |
| --- | --- |
| Windows 10+ · x64 | [下载安装包](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.8/Whale-Isle-Setup-0.3.8.exe) |
| macOS 14+ · Apple Silicon | [下载 ARM64 DMG](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.8/Whale-Isle-0.3.8-mac-arm64.dmg) |

[国内镜像](https://cnb.cool/ayasealter/WhaleIsle/-/releases/tag/v0.3.8) · [完整更新说明](https://github.com/ChisaAlter/WhaleIsle/releases/tag/v0.3.8)

Windows 包未签名，Mac 包未签名或公证；Mac 不包含 Windows 专用的内置 Office 运行时。发布页提供 `SHA512SUMS.txt` 校验文件。

1. 安装并打开应用。
2. 在「设置 → 模型」配置 API 服务；Windows 用户也可从启动器安装鲸桥，添加供应商／订阅账号。
3. 选择工作目录，或新建无工作区会话，开始对话。模型费用由服务商收取，本项目不提供额度。

## v0.3.6 更新

- 新增下一句提示：点击或 Tab 仅填入草稿，不自动发送。默认开启，可关闭；生成时会额外调用模型。
- 修复消息重编辑清理、退出二次确认和启动器间距。
- 提供 Mac ARM64 安装包，适配原生红黄绿按钮与全屏。

## 功能

- **对话与协作**：工作区和历史会话、工具调用与审批、消息编辑、Agent 团队及下一句提示。
- **文件、终端与 Git**：搜索与编辑文件、网页及 Diff 预览、运行命令、切换分支、提交与推送。
- **模型与扩展**：API 服务、MCP、技能、插件市场，以及 Windows 上按需安装的鲸桥模型接入组件。
- **外观与鲸鱼娘**：明暗与透明主题、壁纸、Live2D 桌宠及随 Token 用量成长的互动。
- **用量与远程**：Token 汇总、热力图、费用估算与导出；主动开启后可用手机访问桌面会话。
- **桌面管理**：托盘驻留、Windows 增量更新、数据导入与插件启动排查。

<p align="center">
  <img src="docs/images/v0.3.6/screenshot-launcher.jpg" alt="Whale Isle 0.3.6 Windows 启动器" width="800" /><br />
  Windows 启动器
</p>

鲸桥基于 [yetone / Magpie](https://github.com/yetone/magpie)，统一管理供应商、订阅账号、模型、路由与用量，目前提供 Windows 组件。它与 ChatGPT 插件均独立安装和更新，不随桌面包捆绑发布。详见[组件文档](docs/features/launcher-components.md)。Project 本地协调者与持续 Worker 未包含在 v0.3.6 中。

## 数据与排障

桌面数据使用独立目录，与官方 CLI 的 `~/.dsh` 分开；其中 `dsh-home` 保存会话与 Harness 配置：

- Windows：`%APPDATA%\Deepseek-Harness-Desktop`
- macOS：`~/Library/Application Support/Deepseek-Harness-Desktop`

覆盖安装可保留现有桌面数据；从官方 CLI 迁移请使用启动器「导入」。插件导致启动失败时，可在启动器「插件排查」中单独禁用，无需删除会话。API 报错先核对服务地址和协议；[反馈问题](https://github.com/ChisaAlter/WhaleIsle/issues/new/choose)时附上版本、复现步骤和错误信息，移除密钥等敏感内容。

## 从源码运行

需要 Git 和 Node.js 22.19+（22.x）或 24+，CI 版本见 [`.nvmrc`](.nvmrc)。

```shell
git clone https://github.com/ChisaAlter/WhaleIsle.git
cd WhaleIsle
npm ci
npm run setup:harness
npm start
```

首次 setup 会安装并构建 Harness。源码版与安装版共用单实例锁，运行前先退出安装版及其托盘。构建、测试和维护命令见[开发文档](docs/maintenance/README.md)及[构建指南](docs/handbook/modules/build-release.md)。

## 文档与社区

[产品手册](docs/handbook/README.md) · [功能说明](docs/features/README.md) · [贡献指南](CONTRIBUTING.md) · [发布流程](docs/handbook/modules/release-process.md)

<p align="center">
  <img src="assets/wechat-group.png" alt="微信交流群二维码" width="200" />
</p>

扫码加入交流群；二维码失效可通过 Issue 联系。感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、[yetone / Magpie](https://github.com/yetone/magpie) 与 [Linux.do](https://linux.do) 社区。

[MIT](LICENSE)
