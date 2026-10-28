# Whale Isle 0.3.11

- **The composer no longer jumps**: The task strip, goal strip and pending-message queue above the composer now fade and resize smoothly when they appear, disappear, expand or collapse, and the composer stays in place. Project request and team status also keep a fixed position, so status updates no longer push the input area. With Reduce Motion on, they settle immediately.
- **Settings groups and search**: Settings are regrouped and can be searched. The plugin store is back in Settings, and the settings navigation and scrollbars are clearer in the light theme.
- **Bots removed**: The Bots feature and its runtime have been removed from the desktop app and are no longer bundled. Existing local data such as conversations, memories and attachments is kept, not deleted.
- **Project**: Uses the native agent team, task list and member conversations. Project conversations gain the Git tools, member views return to the coordinator, and long conversations compact their context again.
- **Choosing a workspace folder**: On Windows you can switch to the native system folder picker, and the choice is remembered.
- **Faster and steadier**: Less repeated work when reading settings and switching conversations; usage scans no longer slow startup or settings search; older conversations open faster; switching conversations keeps your reading position in the one you left.
- **Launcher**: Updating, installing, switching versions, incremental updates and uninstalling no longer ask twice. Duplicate notices across the app are gone, and background connections no longer stall updates, stopping the desktop app or restarts after toggling a setting.
- **Tray**: Quitting from the tray takes a single click.
- **Data safety**: Settings and credentials that fail to load are no longer overwritten on save.
- **Remote and mobile**: Fixed remote pairing credentials, false QR-startup errors and relay connection replacement. A password-less remote daemon no longer accepts arbitrary web origins, and malformed requests no longer crash the relay process.
- **Interface details**: Generated interfaces have better spacing and default backgrounds; the Claude skin uses the Claude theme artwork.

This release provides the Windows 10+ x64 installer. The Android client is released separately and is not updated by this desktop version. WhaleBridge and the ChatGPT plugin are installed and updated independently and are not bundled with the desktop package.
