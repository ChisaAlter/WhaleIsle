# Whale Isle 0.3.4

[中文](release-notes.md) | English

This update brings together desktop features and fixes since 0.3.3. The source baseline is DeepSeek Harness `0.2.1-alpha.1` (upstream commit `5badb15009ae1756c3afe0ae0cef1faafc290ccc`), retaining Whale Isle's desktop work loops, bundled plugins and data contracts.

## What's new

- **WhaleBridge component**: Install and manage WhaleBridge from the launcher to connect API providers, subscription accounts, models and routes to DSH. Installed components also have a Settings entry in the sidebar account menu. WhaleBridge runs and updates independently; closing the launcher does not stop its service.
- **Explicit connection results**: Saving a provider or completing subscription authorization keeps a result dialog open with the provider, account identity and model-sync details. Choose Done or View providers. Reauthorization reports an updated authorization, and completing a successful result does not save again or send a cancellation request.
- **WhaleBridge interface**: Improved dynamic forms, advanced options, routes and long-name layouts. Its management window shares desktop and launcher window controls and supports light, dark and narrow layouts. The component version in this update is `1.0.6`; it is distributed through its own release and update channel, not bundled in the desktop installer.
- **Launcher**: Reorganized the home and component management views. Action feedback preserves button geometry and focus, with long-running progress shown in place. Desktop and WhaleBridge home cards no longer repeat avatars; sidebar branding and component-list icons remain. Confirmation overlays stay within rounded window corners.
- **Plugin startup recovery**: Retains the original startup failure and offers explicit disable-and-restart guidance when logs identify installed user plugins. Skip mode persists until an explicit full retry. Cancellation remains visibly incomplete; writing disabled-plugin settings is not reported as complete recovery, and user data is retained.
- **Session archives and narrow windows**: Restored Hide archived / All conversations / Archived only filters for lists and search. Archived items can be unarchived or deleted; clicking an archived row does not restore or open it. Fixed session menus, header actions and title-bar drag regions in narrow windows.
- **Whale assistant reliability**: Fixed memory, reminders and shared-session paths, retaining failed-turn status in chat history. Added a running whale animation beside thinking status and a smooth curtain-style desktop reveal.
- **Domestic update channel**: Moved the domestic update source and release mirror to CNB. Mirrors reuse and verify GitHub's original assets individually, showing only fully synchronized stable releases. WhaleBridge component releases do not replace the latest desktop release.
- **Installation and runtime**: Distribution trees follow production dependencies. Windows Harness and Office share a standalone Node runtime. Installation extracts into a same-volume staging directory before switching applications; fixes cover directory-link cleanup, migration and rollback while preserving user data and recoverable old directories.
- **Compatibility**: Integrated the newer Harness baseline and fixed remote-plugin compatibility, Creator draft selection, desktop log readers and installed subscription-adapter selection. Desktop surfaces, permissions and plugin contracts remain in place.

## Install and upgrade

Windows 10 or later x64 users can download `Whale-Isle-Setup-0.3.4.exe` from [Releases](https://github.com/ChisaAlter/WhaleIsle/releases) and verify it with that version's `SHA512SUMS.txt`. Existing installations can be upgraded in place; use Import in the launcher to migrate another environment. The installer is not Authenticode-signed, so Windows may show a security warning.

WhaleBridge is an optional component installed through the launcher. Its updates and rollbacks do not change the desktop version. Provider keys stay in component data; saving settings synchronizes only WhaleBridge-owned DSH channels without replacing other providers or the default model. Active requests and pending tool results prevent stop, update and uninstall operations.

Git operations require a Git CLI that the desktop application process can find. Git availability in a development terminal does not establish that dependency for a desktop-launched application.

## Platforms and known boundaries

- This desktop distribution includes only a Windows x64 installer. Android native-client source changes do not mean an APK is included; macOS and the second Web client are outside this installer set.
- The upstream baseline is an alpha version. Retaining desktop differences does not establish exhaustive verification of upstream features, third-party plugins or external subscription authorization.
- Remote access requires explicit pairing opt-in. The LAN static page uses HTTP; Settings explains the scope of end-to-end encryption and relay TLS.
- If Windows Explorer has cached an old notification shortcut, the taskbar may retain an old name or white icon after upgrading. Signing in again or restarting Explorer can restore it; the application does not restart Explorer itself.

## Verification and publication

Development CI selects behavior tests, the official profile build, native-window checks, Windows installer packaging and packaged application startup according to the changed scope. Automatic publication reuses only the original assets from a successful main build, checking versions, update metadata and checksums. The CNB mirror separately verifies downloaded bytes.

These checks do not certify every install or upgrade path, external subscription authorization or paid model request. Installer availability, update endpoints and mirror completion are established by the actual workflows and public Release.

## Feedback

Report issues through [Issues](https://github.com/ChisaAlter/WhaleIsle/issues) with your OS, reproduction steps and logs. Remove keys and other sensitive data before sharing.
