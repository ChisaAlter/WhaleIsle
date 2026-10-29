<p align="center">
  <img src="assets/icon.png" width="80" alt="Whale Isle" />
</p>

<h1 align="center">Whale Isle</h1>

<p align="center">
  An open-source community client built on DeepSeek Harness<br />
  AI conversations, file previews, terminal and Git in one window.
</p>

<p align="center">
  <a href="README.md">中文</a> · English ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/tag/v0.3.13">Release notes</a> ·
  <a href="https://github.com/ChisaAlter/WhaleIsle/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/WhaleIsle" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/WhaleIsle" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-ARM64-333333" alt="macOS ARM64" />
  <img src="https://img.shields.io/badge/Android-8.0%2B-3DDC84" alt="Android 8.0+" />
</p>

<p align="center">
  <img src="docs/images/v0.3.13/screenshot-desktop.png" alt="Whale Isle 0.3.13 main window on Windows" width="920" />
</p>

Independently maintained by the community, not an official DeepSeek product.

## Download v0.3.13

| Platform | GitHub | CNB mirror |
| --- | --- | --- |
| Windows 10+ · x64 | [Installer](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.13/Whale-Isle-Setup-0.3.13.exe) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v0.3.13/Whale-Isle-Setup-0.3.13.exe) |
| macOS 14+ · Apple Silicon | [ARM64 DMG](https://github.com/ChisaAlter/WhaleIsle/releases/download/v0.3.13/Whale-Isle-0.3.13-mac-arm64.dmg) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/v0.3.13/Whale-Isle-0.3.13-mac-arm64.dmg) |
| Android 8.0+ | [APK](https://github.com/ChisaAlter/WhaleIsle/releases/download/android-v0.3.11/Whale-Isle-0.3.11-android.apk) | [CNB](https://cnb.cool/ayasealter/WhaleIsle/-/releases/download/android-v0.3.11/Whale-Isle-0.3.11-android.apk) |

The desktop installers are unsigned; on a Mac, right-click and choose Open the first time. Android is released separately. Each release provides SHA512 checksums.

## Getting started

1. Install the desktop app and configure an API service in Settings → Models (your model provider charges for usage).
2. Choose a workspace, or start a conversation right away.
3. On Android, install the app and scan the QR code in the desktop app's Remote dialog.

## Features

- **Conversations and collaboration**: Tool calls, approvals, Agent Teams and Project.
- **Files and development**: File editing, web and diff previews, terminal and Git.
- **Live panels**: Floating panels refreshed by commands, HTTP or AI.
- **Extensions**: MCP, skills and the plugin marketplace; optional [WhaleBridge](docs/features/launcher-components.md) on Windows.
- **Appearance and usage**: Codex / Claude skins, wallpapers, a Live2D whale companion, token and cost statistics.

<table>
  <tr><th>Launcher</th><th>Android connection screen</th></tr>
  <tr>
    <td align="center"><img src="docs/images/v0.3.13/screenshot-launcher.png" alt="Whale Isle 0.3.13 launcher on Windows" width="650" /></td>
    <td align="center"><img src="docs/images/v0.3.10/screenshot-android.png" alt="Whale Isle Android connection screen" width="240" /></td>
  </tr>
</table>

## Run from source

Requires Git and Node.js 22.19+ or 24+ (the CI version is in [.nvmrc](.nvmrc)). Quit the installed app, including its tray process, first: both share a single-instance lock.

```shell
git clone https://github.com/ChisaAlter/WhaleIsle.git
cd WhaleIsle
npm ci
npm run setup:harness
npm start
```

## Data and documentation

Data lives in `%APPDATA%\Deepseek-Harness-Desktop` on Windows or `~/Library/Application Support/Deepseek-Harness-Desktop` on macOS and is kept across in-place upgrades.

[Product handbook](docs/handbook/README.md) · [Development](docs/maintenance/README.md) · [Contributing](CONTRIBUTING.en.md) · [Report an issue](https://github.com/ChisaAlter/WhaleIsle/issues/new/choose)

<p align="center">
  <img src="assets/wechat-group.png" alt="WeChat community QR code" width="180" />
</p>

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), [yetone / Magpie](https://github.com/yetone/magpie) and the [Linux.do](https://linux.do) community. · [MIT](LICENSE)
