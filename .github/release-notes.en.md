- **Sidebar and glass**: The More hover area fills the footer when no status action is shown. Settings, menus and dialogs respond to glass opacity.
- **Windows and shutdown**: Transparent windows retain native Windows maximize, restore and minimize animations, with fixes for shutdown flashes and resource cleanup.
- **Conversations and files**: Approval cards match the resident composer dimensions, with performance improvements for large tables, highlighting, file previews and session queries.
- **Updates and recovery**: Unified connection and update controls, explicit differential or full downloads, and improved installation detection, shutdown and failure recovery.
- **Whale assistant**: Reduced idle rendering, repeated parsing and output overhead while preserving interaction responsiveness and cleaning up resources on exit.
- **Optional visual replies**: Added generated page replies, disabled by default, with isolated previews and retained conversation attachments.
- **WhaleBridge source**: Fixed quota displays and asynchronous editing state. The component remains separately built and is not bundled with the desktop installer.

Windows 10 or later x64 only; existing installations support in-place upgrades. Project mode (the local coordinator and persistent workers) is excluded. Harness remains at `0.2.1-alpha.1`. WhaleBridge is an optional launcher-installed component that runs and updates independently.
