# Whale Isle 0.3.16

- **ACP 0.4.9 and Agent Teams**: Pick an agent first, then preview and choose its model and reasoning effort. The bundled ACP integration now supports Agent Teams.
- **Windows 11 window acrylic**: Enable native acrylic with rounded corners in Settings → Appearance. The transparency slider adjusts the main window only; dialogs and menus keep their default frosted finish. Wallpapers and animated gradients pause while acrylic is on and return when it is off. Requires Windows 11 22H2 or later.
- **Big Fish workspace**: The sidebar toggle matches the standard workspace, and you can drag the window from the empty titlebar area. Hide the IDE without stopping background work, then reopen it to the previous layout.
- **Interface fixes**: The two desktop titlebar overflow menus are hidden. Use `/export` to download a session log. The Plugins page now scrolls when its content exceeds the window height.
- **Whale assistant off by default**: New installs and configurations that never saved settings no longer mount it by default. Installs where it is already on keep it on, and you can toggle it any time in Settings → Whale; turning it off does not delete sessions or data.
- **Update downloads**: Set an HTTP proxy just for update downloads and see actionable errors when a download is blocked.
- **Harness 0.2.2-rc.2**: This release updates the bundled Harness. The retired standalone `dsh-with-chatgpt` plugin is no longer maintained or built here; existing standalone installations are not removed.

Installers are available for Windows x64 and macOS Apple Silicon. The Mac installer is unsigned. Android and WhaleBridge are released separately.
