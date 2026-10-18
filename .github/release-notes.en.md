# Whale Isle 0.3.9

- **DeepSeek Harness 0.2.1-rc.2**: The bundled Harness is upgraded to `dsh-v0.2.1-rc.2`, keeping existing desktop features and settings.
- **Smoother first send**: Sending the first message from the draft page glides the composer straight to the bottom instead of pausing mid-page, and the session header and transcript fade in instead of flashing.
- **Reply actions stay visible**: After sending a new message, the previous reply keeps its copy and feedback buttons until the new reply completes.
- **Interactive pages in chat**: The assistant can render calculators, charts, maps, checklists and other interactive pages directly in a reply, with their state saved per conversation.
- **More reliable WhaleBridge startup**: The launcher recognizes stale running state and recovers, shows the end of the component log when startup fails, and removes extra old versions.
- **Project improvements**: The requirement queue and task cards are redesigned, and quitting or reloading waits for in-progress Project records to finish writing so they are not lost.
- **App updates**: When the local incremental-update cache is missing or for a different version, it is verified and restored from the saved installer of the current version instead of downloading the full package again. Update notes are split into 中文 / English tabs.

This release provides the Windows 10+ x64 installer and a macOS 14+ Apple Silicon ARM64 DMG. The Mac package retains native window buttons, titlebar safe areas and fullscreen support; it is unsigned and not notarized. WhaleBridge and the ChatGPT plugin are installed and updated independently and are not bundled with the desktop package; the latest WhaleBridge is 1.3.0 and can be updated from the launcher.
