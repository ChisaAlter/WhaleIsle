# Whale Isle 0.3.7

- **WhaleBridge downloads**: Read the component manifest from public release attachments and pin the download version, avoiding lookup, installation and update failures when the anonymous GitHub API quota is exhausted. File-size and SHA256 verification remain enabled.
- **Download routes**: The Components heading follows GitHub/CNB route changes immediately.
- **Interface feedback**: Fixes for confirmation dialog closing, reopening and focus handling. Account notifications disappear immediately after sign-out.
- **Web previews**: Fixes for the original page flashing during picture-in-picture transitions, selection cancellation incorrectly reporting failure, and the selection toolbar failing to load in sandboxed previews.
- **Desktop updates**: Full-installer handoff keeps the update pending until installation is confirmed, preventing premature completion notices.

This release provides the Windows 10+ x64 installer. WhaleBridge and the ChatGPT plugin are installed and updated independently, and are not bundled with the desktop package.
