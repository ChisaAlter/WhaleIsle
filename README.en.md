<p align="center">
  <img src="assets/icon.png" width="88" alt="Whale Isle" />
</p>

<h1 align="center">Whale Isle</h1>

<p align="center">
  An open-source, community-enhanced desktop client for DeepSeek Harness<br />
  Chat with AI, explore projects, run commands, and manage Git in one window.
</p>

<p align="center">
  <a href="README.md">中文</a> · English
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest">Download</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases">Changelog</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ChisaAlter/WhaleIsle/issues">Report an issue</a>
</p>

<p align="center">
  <a href="https://github.com/ChisaAlter/WhaleIsle/releases/latest"><img src="https://img.shields.io/github/v/release/ChisaAlter/WhaleIsle" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ChisaAlter/WhaleIsle" alt="License" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0A66C2" alt="Windows x64" />
</p>

<p align="center">
  <img src="docs/images/v0.3.5/screenshot-home.jpg" alt="Whale Isle main window" width="920" />
</p>

**Whale Isle is an open-source, community-enhanced desktop client built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), independently maintained and not an official DeepSeek product.** The official Harness's core features are also available here: AI conversations, tool calls, Agent Teams, terminal and Git, MCP, skills, and plugins.

Whale Isle builds on these capabilities with an expanded desktop experience:

- **WhaleBridge model access**: An optional component for API providers, subscription accounts, models, and routes.
- **More appearance options**: Transparent themes, custom wallpapers, frosted glass, and animated backgrounds to make the workspace your own.
- **Whale-girl desktop pet**: An interactive companion with head pats, feeding, and growth tied to actual token usage.
- **Extended usage statistics**: Cross-session token totals, activity heatmaps, cost estimates, and data export for a clearer view of usage.
- **Mobile remote access**: Enable it when needed and scan a QR code to access desktop sessions from a mobile browser.

Sessions and settings live in a separate data directory, with official CLI data import and plugin troubleshooting available through the launcher.

## Current release: v0.3.5

This release updates conversation tools, context usage in the composer, and sidebar file previews; adds WhaleBridge component management; and improves the launcher and plugin startup recovery. Screenshots show the v0.3.5 public build. WhaleBridge updates through a separate component channel. See the [v0.3.5 release notes](https://github.com/ChisaAlter/WhaleIsle/releases/tag/v0.3.5) for the full changes.

## Features

- **AI conversations**: Organize workspaces and chat history, inspect tool calls, approve actions, and edit and resend messages — with Agent Teams and parallel subagents.
- **Project tools**: Search and edit files, inspect diffs, preview web pages, and add file or terminal selections to a conversation. Browser previews can move into a chat-area mini-player.
- **Terminal and Git**: Run commands, switch branches, commit changes, push code, and open pull requests without leaving the app.
- **Models and extensions**: Configure model providers directly or manage API providers, subscription accounts, and routes through WhaleBridge; manage MCP servers, skills, and plugins, and install extensions from the built-in marketplace. A built-in Bots tab orchestrates multi-bot sessions.
- **Usage statistics**: View token usage across sessions, activity heatmaps, and session costs estimated against peak/valley price windows, with data export support.
- **Desktop pet** <img src="assets/pet-head.png" width="18" alt="whale-girl pet" />: A Live2D whale-girl lives on the desktop, grows with your token usage, pushes pinned notifications, and supports "take a look", chat, and head-pat interactions.
- **Appearance**: Light, dark, and transparent themes; a wallpaper gallery (Bing daily, Wallhaven, and custom HTTPS catalogs) with frosted-glass, pixelation, and ambient-gradient backgrounds; independent terminal opacity and button-sheen controls.
- **Remote access**: Enable remote connections when needed and scan a QR code to access desktop sessions from a mobile browser. Remote listening is off by default.
- **Desktop integration**: System tray support, differential updates (only changed installer blocks are downloaded), and a launcher for data import and plugin troubleshooting.

## How It Works

- **Local-first**: Sessions, settings, and plugin configuration live in a desktop-specific `dsh-home`, separate from the official CLI's `~/.dsh`.
- **One workspace flow**: Conversations, files, Browser, diffs, terminal, and Git share the active workspace. File references and terminal selections can return directly to the Composer.
- **Extensible runtime**: Model providers, MCP, skills, and plugins use DeepSeek Harness's plugin architecture. Desktop-owned features are attached through controlled desktop plugins.
- **Desktop safety boundary**: High-impact tool actions follow Harness approval and permission policies. Remote access requires an explicit opt-in.

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/images/v0.3.5/screenshot-launcher.jpg" alt="v0.3.5 launcher and component management" /><br />Launcher and components</td>
    <td align="center" width="50%"><img src="docs/images/v0.3.5/screenshot-surfaces.jpg" alt="v0.3.5 conversation and file preview" /><br />Conversation and file preview</td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/images/v0.3.5/screenshot-whalebridge.jpg" alt="WhaleBridge provider, subscription and model management" /><br />WhaleBridge model access</td>
    <td align="center" width="50%"><img src="docs/images/v0.3.5/screenshot-appearance.jpg" alt="v0.3.5 appearance settings" /><br />Themes and appearance</td>
  </tr>
</table>

## WhaleBridge

WhaleBridge is an optional model-access component for API providers, subscription sign-in, multiple keys, model catalogs, routes, and usage. It synchronizes models into Whale Isle, with advanced provider options, model scopes, and lists grouped by channel and provider.

**Upstream attribution**: WhaleBridge is developed from **Magpie by yetone**, retaining its provider, subscription, model, routing, and usage capabilities while focusing client integration on DSH and using Whale Isle's management interface. The upstream MIT copyright and license are retained in the source and component distribution.

Upstream project: [yetone / Magpie](https://github.com/yetone/magpie)

1. Install WhaleBridge from Components in the launcher.
2. Open its settings and add an API provider or authorize a supported subscription account.
3. Select a synchronized WhaleBridge model in Whale Isle. Installed components also have a Settings entry in the sidebar account menu.

WhaleBridge runs and updates independently and is not bundled in the desktop installer. It continues serving desktop conversations after the launcher closes. Active requests and pending tool results must finish before stopping, updating, or uninstalling it. Component data can be retained on uninstall. API and subscription fees are charged by the provider; WhaleBridge does not supply free model credits. See the [component and WhaleBridge documentation](docs/features/launcher-components.md).

## Download and Install

| Platform | Download |
| --- | --- |
| Windows 10 or later · x64 | [Download latest public release](https://github.com/ChisaAlter/WhaleIsle/releases/latest) |

Public distribution currently focuses on a Windows x64 installer. Other platforms can run or build from source as described below. See [Releases](https://github.com/ChisaAlter/WhaleIsle/releases) for versions and release notes.

> [!NOTE]
> The Windows installer is not digitally signed, so Windows may display a security warning. Download only from this repository. The release page provides `SHA512SUMS.txt` for integrity checks.

### Getting Started

1. Install and open the app. Wait for the launcher to open the main window.
2. Configure an API provider in Settings → Models, or install WhaleBridge from the launcher and add a provider or subscription account. For a custom API service, check that its URL matches the selected protocol.
3. Select a project directory as your workspace, or start a conversation without a workspace.

If you have used the official CLI, choose the data you want to migrate on the launcher's Import page.

## FAQ

### Do I need my own API key?

Direct API access requires a key for the chosen provider. WhaleBridge can also use supported subscription accounts with the provider’s required authorization. This project does not supply model credits or subscriptions; fees are charged by the provider.

### What if a conversation fails with `DeepSeek Messages request failed (404)`?

Confirm that you are using the [latest public release](https://github.com/ChisaAlter/WhaleIsle/releases/latest), then check the provider, API URL, and protocol in Settings → Models. The DeepSeek integration uses the Messages API; a third-party service that only supports Chat Completions needs a matching provider configuration.

If it still fails, [open an issue](https://github.com/ChisaAlter/WhaleIsle/issues/new/choose) with the app version, provider name, API URL (remove sensitive parameters), selected protocol, and complete error message. Do not include your API key. A 404 alone cannot identify whether the cause is configuration or the service.

### How do I upgrade?

The app checks for updates at startup. Upgrades ride a differential channel that downloads only changed installer blocks, falling back to a full download if that fails. You can also install a newer package over the existing version. Desktop installations normally keep their data during upgrades. Back up your data directory before upgrading.

To migrate from the official CLI or an older desktop installation, use Import in the launcher. Do not overwrite databases or copy the entire `profiles` directory. After importing, add the original workspace path again to find its conversations.

### Where is my data stored?

The desktop app uses a separate data directory and does not directly read the official CLI's `~/.dsh`. Open it from Settings > About > Open runtime directory.

| Platform | Sessions and settings directory |
| --- | --- |
| Windows | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home` |
| macOS (source builds) | `~/Library/Application Support/Deepseek-Harness-Desktop/dsh-home` |

### What if the desktop pet cannot be fed after clearing session logs?

Update to v0.3.3 or later. Version 0.3.3 fixes lifetime feeding totals blocking newly earned food, while preserving growth and lifetime feeding records. New usage after upgrading can be fed, and restoring old logs does not generate food twice. If the problem persists, open an issue with your app version and reproduction steps.

### What if a plugin prevents startup?

Disable the affected plugin in the launcher's troubleshooting tools, then restart. Older dshbot versions may be incompatible with the newer Harness and can be disabled individually the same way, without deleting settings or conversations.

## Run from Source

Requirements: Windows 10+ or macOS 14+ (Apple Silicon), Git, and Node.js 22.x starting at 22.19 or version 24+. See [`.nvmrc`](.nvmrc) for the CI Node.js version. The root dependencies provide pnpm; a separate global installation is unnecessary.

```shell
git clone https://github.com/ChisaAlter/WhaleIsle.git
cd WhaleIsle
npm ci
npm run setup:harness
npm start
```

`setup:harness` installs the vendored Harness dependencies from its lockfile and builds the profile used by the desktop app, which may take a while initially. `npm start` rebuilds stale client output before launching. Source and installed builds share a single-instance lock, so quit the installed app, including its tray process, before starting a source build.

```shell
npm test            # Desktop and mobile behavior tests
npm run test:tools  # Build, release, and maintenance tool tests
npm run docs:check  # Check relative documentation links
npm run dist        # Build the Windows installer
npm run dist:mac    # Build the macOS installer; requires macOS
```

## Documentation

- [Product and architecture handbook](docs/handbook/README.md) (Chinese)
- [Design guidelines](docs/design-language.en.md) · [Motion guidelines](docs/motion.en.md)
- [Feature contracts](docs/features/README.md) (Chinese)
- [Development and maintenance](docs/maintenance/README.md) (Chinese)
- [Build guide](docs/handbook/modules/build-release.md) · [CI and automatic releases](docs/handbook/modules/release-process.md) (Chinese)

## Contributing

Issues and pull requests are welcome for features, bug fixes, and documentation. Use a work branch and explain the request, changes, and relevant validation in your PR; the maintainer decides whether to merge. Development CI runs automatically, and successful main builds publish when the version increases. Documentation-only changes do not start product builds. See the [contribution guide](CONTRIBUTING.en.md).

When reporting a problem, include the app version, operating system, reproduction steps, expected and actual behavior, and relevant screenshots or logs. Remove API keys and other sensitive information before sharing them.

## Community

<p align="center">
  <img src="assets/wechat-group.png" alt="WeChat community QR code" width="240" />
</p>

Scan to join the Chinese-language WeChat group. If the QR code has expired, contact the maintainer through an [Issue](https://github.com/ChisaAlter/WhaleIsle/issues).

## Acknowledgments

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the foundation, [yetone / Magpie](https://github.com/yetone/magpie) for WhaleBridge’s upstream model-access capabilities, and to the [Linux.do](https://linux.do) community for its support.

## License

[MIT](LICENSE)
